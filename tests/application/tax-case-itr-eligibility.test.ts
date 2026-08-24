import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSqliteApplication, initializeAndUpgradeSqliteApplication, initializeSqliteDatabase, upgradeSqliteDatabase } from "../../src/application/application.ts";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { OFFICIAL_DRIZZLE_MIGRATIONS } from "../../src/infrastructure/services/drizzle-baseline.ts";
import { brandTenantId } from "../../src/core/types.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

type App = ReturnType<typeof createSqliteApplication>;
type Scope = { tenantId: ReturnType<typeof brandTenantId>; taxCaseId: string; snapshotId: string; snapshotCandidateHash: string; worksheetId: string; worksheetOutputHash: string };

function envelope(tenantId: string, requestId: string, payload: unknown, actor: "HUMAN" | "AGENT" = "HUMAN", source: "CLI" | "MCP" = "CLI"): any {
  return { schemaVersion: 1 as const, tenantId, requestId, actor: { kind: actor, id: `${actor.toLowerCase()}-itr-test` }, source, reason: "TEST_ONLY authority pack fixture", payload };
}

const artifacts = ["LAW", "RULES", "SCHEMA", "INSTRUCTION"].map((kind) => ({ kind, sourceUrl: "https://example.invalid/test-only", sourceTitle: "TEST_ONLY authority artifact", officialReleaseIdentifier: "TEST_ONLY", officialReleaseDate: "2024-04-01", sha256: "a".repeat(64) }));

function packPayload(ruleAst: unknown, overrides: Record<string, unknown> = {}) {
  return { jurisdiction: "IN" as const, authority: "INCOME_TAX" as const, financialYear: "2024-25", assessmentYear: "2025-26", filingTypes: ["ANNUAL"], effectiveFrom: "2024-04-01", releasedAt: "2024-04-01", releaseIdentifier: "TEST_ONLY", artifactReferences: artifacts, packVersion: `TEST_ONLY-${randomUUID()}`, candidateForms: ["ITR-1"], ruleAst, ...overrides };
}

async function scope(app: App, suffix: string): Promise<Scope> {
  const tenant = JSON.parse((await app.tenant.create(envelope(`bootstrap-${suffix}`, randomUUID(), { kind: "INDIVIDUAL", name: `TEST_ONLY taxpayer ${suffix}` }))).resultJson);
  await app.tenant.activate(envelope(tenant.tenantId, randomUUID(), { defaultBookSetId: tenant.defaultBookSetId }));
  await app.tenant.pan.set(envelope(tenant.tenantId, randomUUID(), { pan: `ABCDE${suffix.padStart(4, "0").slice(-4)}F` }));
  const taxCaseId = `case-${suffix}`;
  await app.taxCase.create(envelope(tenant.tenantId, randomUUID(), { taxCaseId, financialYear: "2024-25", taxPeriod: "2024-25", filingTrigger: "ANNUAL", bookSetIds: [tenant.defaultBookSetId] }));
  const preview = await app.taxCase.filingSnapshot.preview(tenant.tenantId, taxCaseId);
  const snapshot = JSON.parse((await app.taxCase.filingSnapshot.seal(envelope(tenant.tenantId, `seal-${suffix}`, { taxCaseId, candidateHash: preview.candidateHash })).then((result) => result.resultJson)));
  const worksheet = JSON.parse((await app.taxCase.position.generate(envelope(tenant.tenantId, `worksheet-${suffix}`, { taxCaseId, filingSnapshotId: snapshot.snapshotId }, "AGENT")).then((result) => result.resultJson)));
  return { tenantId: brandTenantId(tenant.tenantId), taxCaseId, snapshotId: snapshot.snapshotId, snapshotCandidateHash: snapshot.candidateHash, worksheetId: worksheet.worksheetId, worksheetOutputHash: worksheet.canonicalOutputHash };
}

async function registerAndVerify(app: App, tenantId: string, requestPrefix: string, ruleAst: unknown, overrides: Record<string, unknown> = {}) {
  const registered = JSON.parse((await app.taxAuthority.pack.register(envelope(tenantId, `${requestPrefix}-register`, packPayload(ruleAst, overrides), "AGENT"))).resultJson);
  const verified = JSON.parse((await app.taxAuthority.pack.verify(envelope(tenantId, `${requestPrefix}-verify`, { packId: registered.packId, expectedPackHash: registered.canonicalHash, reason: "human verified TEST_ONLY fixture" }))).resultJson);
  return { ...registered, ...verified };
}

async function fact(app: App, s: Scope, requestId: string, fieldName: string, valueType: "BOOLEAN" | "STRING" | "INTEGER_MINOR", value: boolean | string, provenanceKind: "HUMAN_ASSERTION" | "AGENT_ASSERTION" = "HUMAN_ASSERTION") {
  const actor = provenanceKind === "AGENT_ASSERTION" ? "AGENT" : "HUMAN";
  return JSON.parse((await app.taxCase.eligibilityFacts.record(envelope(s.tenantId, requestId, { taxCaseId: s.taxCaseId, filingSnapshotId: s.snapshotId, worksheetId: s.worksheetId, snapshotCandidateHash: s.snapshotCandidateHash, worksheetOutputHash: s.worksheetOutputHash, fieldName, valueType, value, provenanceKind, provenance: { source: "TEST_ONLY" } }, actor)).then((result) => result.resultJson)));
}

describe("Personal Tax ITR Eligibility Authority Pack V1", () => {
  test("recognizes the fresh schema, upgrades a 0026-shaped database, and preserves the pack tables through backup/restore", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-itr-migration-")); const dbPath = join(directory, "books.sqlite");
    try {
      await initializeSqliteDatabase(dbPath, { cliVersion: "test", buildId: "itr-migration" });
      const fresh = new Database(dbPath, { readonly: true, safeIntegers: true });
      expect(fresh.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: BigInt(OFFICIAL_DRIZZLE_MIGRATIONS.length) });
      expect(fresh.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'personal_tax_authority_packs'").get()).toEqual({ name: "personal_tax_authority_packs" });
      fresh.close();

      const downgrade = new Database(dbPath, { safeIntegers: true }); downgrade.exec("PRAGMA foreign_keys = OFF");
      for (const table of ["tax_case_itr_form_selections", "tax_case_itr_eligibility_evaluations", "tax_case_itr_eligibility_fact_events", "tax_case_itr_eligibility_facts", "personal_tax_authority_pack_events", "personal_tax_authority_packs"]) downgrade.exec(`DROP TABLE ${table}`);
      const laterPrefixes = ["gst_gstr3b_", "gst_gstr1_", "gst_return_schema_", "withholding_statement_", "personal_tax_computation_", "personal_tax_return_", "tax_case_itr_", "personal_tax_authority_"];
      const laterObjects = downgrade.query("SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'index', 'table') AND (" + laterPrefixes.map(() => "name LIKE ?").join(" OR ") + ") ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name DESC").all(...laterPrefixes.map((prefix) => `${prefix}%`)) as Array<{ type: string; name: string }>;
      for (const object of laterObjects) downgrade.exec(`DROP ${object.type.toUpperCase()} "${object.name.replaceAll('"', '""')}"`);
      const targetCount = OFFICIAL_DRIZZLE_MIGRATIONS.findIndex((migration) => migration.id === "0026_personal_tax_position_worksheet_v1") + 1; const previous = OFFICIAL_DRIZZLE_MIGRATIONS[targetCount - 1]!;
      downgrade.query("DELETE FROM __drizzle_migrations WHERE id > ?").run(targetCount); downgrade.query("UPDATE database_control SET last_migration_id = ?, last_migration_checksum = ? WHERE id = 1").run(previous.id, previous.hash); downgrade.close();
      await upgradeSqliteDatabase(dbPath, { backupDestinationPath: join(directory, "0026.backup"), cliVersion: "test", buildId: "itr-upgrade" });
      const backupPath = join(directory, "itr.backup"); const restoredPath = join(directory, "itr-restored.sqlite"); const backup = new BackupService(dbPath); await backup.createBackup(backupPath); expect(await backup.verifyBackup(backupPath)).toBe(true); expect(await backup.restoreFromBackup(backupPath, restoredPath)).toBe(true);
      const restored = new Database(restoredPath, { readonly: true, safeIntegers: true }); expect(restored.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: BigInt(OFFICIAL_DRIZZLE_MIGRATIONS.length) }); expect(restored.query("SELECT COUNT(*) AS count FROM personal_tax_authority_packs").get()).toEqual({ count: 0n }); expect(restored.query("PRAGMA foreign_key_check").all()).toEqual([]); restored.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("audits lifecycle, supersession, CAS, idempotency, and direct-SQL immutability", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-itr-lifecycle-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const s = await scope(app, "5101");
      const basePayload = packPayload({ forms: [{ form: "ITR-1", rule: { op: "eq", field: "is_resident", value: true } }] });
      const first = JSON.parse((await app.taxAuthority.pack.register(envelope(s.tenantId, "pack-register", basePayload, "AGENT"))).resultJson); const replay = await app.taxAuthority.pack.register(envelope(s.tenantId, "pack-register", basePayload, "AGENT")); expect(replay.replayed).toBe(true); expect(JSON.parse(replay.resultJson).packId).toBe(first.packId);
      await expect(app.taxAuthority.pack.register(envelope(s.tenantId, "pack-register", { ...basePayload, packVersion: "TEST_ONLY-conflict" }, "AGENT"))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      await expect(app.taxAuthority.pack.verify(envelope(s.tenantId, "agent-verify", { packId: first.packId, expectedPackHash: first.canonicalHash, reason: "agent" }, "AGENT"))).rejects.toMatchObject({ code: "AUTHORITY_PACK_HUMAN_REQUIRED" });
      await expect(app.taxAuthority.pack.verify(envelope(s.tenantId, "bad-cas", { packId: first.packId, expectedPackHash: "0".repeat(64), reason: "wrong" }))).rejects.toMatchObject({ code: "AUTHORITY_PACK_CAS_MISMATCH" });
      await app.taxAuthority.pack.verify(envelope(s.tenantId, "pack-verify", { packId: first.packId, expectedPackHash: first.canonicalHash, reason: "human" }));
      const replacement = JSON.parse((await app.taxAuthority.pack.register(envelope(s.tenantId, "replacement-register", packPayload({ forms: [{ form: "ITR-1", rule: { op: "eq", field: "is_resident", value: false } }] }, { supersedesPackId: first.packId }), "AGENT"))).resultJson); expect(replacement.lifecycle).toBe("PROPOSED");
      const native = new Database(dbPath); expect(native.query("SELECT event_type FROM personal_tax_authority_pack_events WHERE pack_id = ? ORDER BY rowid").all(first.packId)).toEqual([{ event_type: "REGISTERED" }, { event_type: "HUMAN_VERIFIED" }, { event_type: "SUPERSEDED" }]); expect(() => native.query("UPDATE personal_tax_authority_packs SET pack_version = pack_version WHERE id = ?").run(first.packId)).toThrow(); expect(() => native.query("DELETE FROM personal_tax_authority_pack_events WHERE pack_id = ?").run(first.packId)).toThrow(); native.close();
      await app.taxAuthority.pack.verify(envelope(s.tenantId, "replacement-verify", { packId: replacement.packId, expectedPackHash: replacement.canonicalHash, reason: "human" })); expect((await app.taxAuthority.pack.show(replacement.packId)).lifecycle).toBe("HUMAN_VERIFIED");
      const rejected = JSON.parse((await app.taxAuthority.pack.register(envelope(s.tenantId, "reject-register", packPayload({ forms: [{ form: "ITR-1", rule: { op: "fact", field: "is_resident", test: "exists" } }] }), "AGENT"))).resultJson); await expect(app.taxAuthority.pack.reject(envelope(s.tenantId, "agent-reject", { packId: rejected.packId, expectedPackHash: rejected.canonicalHash, reason: "agent" }, "AGENT"))).rejects.toMatchObject({ code: "AUTHORITY_PACK_HUMAN_REQUIRED" }); expect((JSON.parse((await app.taxAuthority.pack.reject(envelope(s.tenantId, "human-reject", { packId: rejected.packId, expectedPackHash: rejected.canonicalHash, reason: "human rejected TEST_ONLY fixture" }))).resultJson))).toMatchObject({ eventType: "REJECTED" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("rejects unsupported AST operators, fields, types, and depth before persistence", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-itr-invalid-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const tenant = JSON.parse((await app.tenant.create(envelope("bootstrap-invalid", "tenant", { kind: "INDIVIDUAL", name: "TEST_ONLY taxpayer" }))).resultJson);
      await expect(app.taxAuthority.pack.register(envelope(tenant.tenantId, "bad-op", packPayload({ forms: [{ form: "ITR-1", rule: { op: "eval", field: "is_resident" } }] }), "AGENT"))).rejects.toMatchObject({ code: "INVALID_ITR_RULE_OPERATOR" });
      await expect(app.taxAuthority.pack.register(envelope(tenant.tenantId, "bad-field", packPayload({ forms: [{ form: "ITR-1", rule: { op: "eq", field: "untrusted_field", value: true } }] }), "AGENT"))).rejects.toMatchObject({ code: "INVALID_ITR_RULE_FIELD" });
      await expect(app.taxAuthority.pack.register(envelope(tenant.tenantId, "bad-type", packPayload({ forms: [{ form: "ITR-1", rule: { op: "int_cmp", field: "total_income_minor", comparator: "lte", value: 2 } }] }), "AGENT"))).rejects.toMatchObject({ code: "INVALID_ITR_RULE_TYPE" });
      let rule: any = { op: "fact", field: "is_resident", test: "exists" }; for (let index = 0; index < 13; index += 1) rule = { op: "not", rule };
      await expect(app.taxAuthority.pack.register(envelope(tenant.tenantId, "bad-depth", packPayload({ forms: [{ form: "ITR-1", rule }] }), "AGENT"))).rejects.toMatchObject({ code: "ITR_RULE_AST_DEPTH_EXCEEDED" });
      const native = new Database(dbPath, { safeIntegers: true }); expect(native.query("SELECT COUNT(*) AS count FROM personal_tax_authority_packs").get()).toEqual({ count: 0n }); native.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("evaluates eligible, ineligible, and unknown traces with exact integer strings, provenance, period, isolation, and shared dispatch", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-itr-evaluate-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const s = await scope(app, "5102");
      const pack = await registerAndVerify(app, s.tenantId, "evaluate-pack", { forms: [
        { form: "ITR-1", rule: { op: "all", rules: [{ op: "eq", field: "is_resident", value: true }, { op: "int_cmp", field: "total_income_minor", comparator: "lte", value: "9007199254740994" }] } },
        { form: "ITR-2", rule: { op: "eq", field: "is_director", value: true } },
        { form: "ITR-3", rule: { op: "fact", field: "has_foreign_asset", test: "exists" } },
      ] }, { candidateForms: ["ITR-1", "ITR-2", "ITR-3"] });
      const resident = await fact(app, s, "resident-human", "is_resident", "BOOLEAN", true); const agentIncome = await fact(app, s, "income-agent", "total_income_minor", "INTEGER_MINOR", "9007199254740993", "AGENT_ASSERTION"); await fact(app, s, "director-human", "is_director", "BOOLEAN", false);
      expect(resident.verificationState).toBe("HUMAN_VERIFIED"); expect(agentIncome.verificationState).toBe("UNVERIFIED");
      await expect(app.taxCase.eligibilityFacts.record(envelope(s.tenantId, "wrong-binding", { taxCaseId: s.taxCaseId, filingSnapshotId: s.snapshotId, worksheetId: s.worksheetId, snapshotCandidateHash: "0".repeat(64), worksheetOutputHash: s.worksheetOutputHash, fieldName: "is_resident", valueType: "BOOLEAN", value: true, provenanceKind: "HUMAN_ASSERTION" }))).rejects.toMatchObject({ code: "ITR_ELIGIBILITY_BINDING_MISMATCH" });
      const cli = await new OperationDispatcher({ databasePath: dbPath, source: "CLI", allowOperatorOperations: false }).dispatch("tax-case.itr-eligibility.evaluate", envelope(s.tenantId, "evaluate-unknown", { taxCaseId: s.taxCaseId, filingSnapshotId: s.snapshotId, worksheetId: s.worksheetId, packId: pack.packId }, "AGENT", "CLI")); expect(cli.ok).toBe(true); const first = (cli as { result: any }).result; expect(first.results).toEqual(expect.arrayContaining([expect.objectContaining({ form: "ITR-1", status: "UNKNOWN", reasonCodes: expect.arrayContaining(["FACT_UNVERIFIED"]) }), expect.objectContaining({ form: "ITR-2", status: "INELIGIBLE" }), expect.objectContaining({ form: "ITR-3", status: "UNKNOWN", reasonCodes: expect.arrayContaining(["FACT_MISSING"]) })]));
      const mcp = await new OperationDispatcher({ databasePath: dbPath, source: "MCP", allowOperatorOperations: false }).dispatch("tax-case.itr-eligibility.show", { tenantId: s.tenantId, taxCaseId: s.taxCaseId, evaluationId: first.evaluationId }); expect(mcp.ok).toBe(true); expect((mcp as { result: any }).result.status).toBe("CURRENT");
      await fact(app, s, "income-human", "total_income_minor", "INTEGER_MINOR", "9007199254740993"); const evaluated = JSON.parse((await app.taxCase.itrEligibility.evaluate(envelope(s.tenantId, "evaluate-eligible", { taxCaseId: s.taxCaseId, filingSnapshotId: s.snapshotId, worksheetId: s.worksheetId, packId: pack.packId }, "AGENT"))).resultJson); expect(evaluated.results).toEqual(expect.arrayContaining([expect.objectContaining({ form: "ITR-1", status: "ELIGIBLE", reasonCodes: expect.arrayContaining(["INTEGER_COMPARISON_TRUE"]) }), expect.objectContaining({ form: "ITR-2", status: "INELIGIBLE" }), expect.objectContaining({ form: "ITR-3", status: "UNKNOWN" })]));
      const replay = await app.taxCase.itrEligibility.evaluate(envelope(s.tenantId, "evaluate-eligible", { taxCaseId: s.taxCaseId, filingSnapshotId: s.snapshotId, worksheetId: s.worksheetId, packId: pack.packId }, "AGENT")); expect(replay.replayed).toBe(true); await expect(app.taxCase.itrEligibility.evaluate(envelope(s.tenantId, "evaluate-eligible", { taxCaseId: s.taxCaseId, filingSnapshotId: s.snapshotId, worksheetId: s.worksheetId, packId: "different-pack" }, "AGENT"))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      const otherTenant = JSON.parse((await app.tenant.create(envelope("bootstrap-other", "other-tenant", { kind: "INDIVIDUAL", name: "Other TEST_ONLY taxpayer" }))).resultJson); await expect(app.taxCase.itrEligibility.show(otherTenant.tenantId, s.taxCaseId, evaluated.evaluationId)).rejects.toMatchObject({ code: "ITR_ELIGIBILITY_EVALUATION_NOT_FOUND" });
      const mismatchPack = await registerAndVerify(app, s.tenantId, "period-mismatch", { forms: [{ form: "ITR-1", rule: { op: "fact", field: "is_resident", test: "exists" } }] }, { financialYear: "2025-26", assessmentYear: "2026-27" }); await expect(app.taxCase.itrEligibility.evaluate(envelope(s.tenantId, "period-mismatch-evaluate", { taxCaseId: s.taxCaseId, filingSnapshotId: s.snapshotId, worksheetId: s.worksheetId, packId: mismatchPack.packId }, "AGENT"))).rejects.toMatchObject({ code: "ITR_ELIGIBILITY_PERIOD_MISMATCH" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("requires explicit HUMAN selection, preserves CAS/idempotency, and derives stale after pack or fact changes", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-itr-selection-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const s = await scope(app, "5103");
      const pack = await registerAndVerify(app, s.tenantId, "selection-pack", { forms: [{ form: "ITR-1", rule: { op: "eq", field: "is_resident", value: true } }, { form: "ITR-2", rule: { op: "eq", field: "is_resident", value: true } }] }, { candidateForms: ["ITR-1", "ITR-2"] }); await fact(app, s, "selection-resident", "is_resident", "BOOLEAN", true);
      const evaluation = JSON.parse((await app.taxCase.itrEligibility.evaluate(envelope(s.tenantId, "selection-evaluate", { taxCaseId: s.taxCaseId, filingSnapshotId: s.snapshotId, worksheetId: s.worksheetId, packId: pack.packId }, "AGENT"))).resultJson); expect(evaluation.results.every((result: any) => result.status === "ELIGIBLE")).toBe(true);
      await expect(app.taxCase.itrForm.select(envelope(s.tenantId, "agent-select", { taxCaseId: s.taxCaseId, evaluationId: evaluation.evaluationId, expectedEvaluationHash: evaluation.evaluationHash, selectedForm: "ITR-1" }, "AGENT"))).rejects.toMatchObject({ code: "ITR_FORM_SELECTION_HUMAN_REQUIRED" }); await expect(app.taxCase.itrForm.select(envelope(s.tenantId, "bad-select-cas", { taxCaseId: s.taxCaseId, evaluationId: evaluation.evaluationId, expectedEvaluationHash: "0".repeat(64), selectedForm: "ITR-1" }))).rejects.toMatchObject({ code: "ITR_FORM_SELECTION_CAS_MISMATCH" });
      const selected = JSON.parse((await app.taxCase.itrForm.select(envelope(s.tenantId, "human-select", { taxCaseId: s.taxCaseId, evaluationId: evaluation.evaluationId, expectedEvaluationHash: evaluation.evaluationHash, selectedForm: "ITR-1" }))).resultJson); expect(selected.eligibleForms).toEqual(["ITR-1", "ITR-2"]); expect((await app.taxCase.itrForm.status(s.tenantId, s.taxCaseId, selected.selectionId)).status).toBe("CURRENT"); const selectionReplay = await app.taxCase.itrForm.select(envelope(s.tenantId, "human-select", { taxCaseId: s.taxCaseId, evaluationId: evaluation.evaluationId, expectedEvaluationHash: evaluation.evaluationHash, selectedForm: "ITR-1" })); expect(selectionReplay.replayed).toBe(true);
      const replacement = await registerAndVerify(app, s.tenantId, "selection-replacement", { forms: [{ form: "ITR-1", rule: { op: "eq", field: "is_resident", value: true } }] }, { supersedesPackId: pack.packId }); expect((await app.taxCase.itrEligibility.show(s.tenantId, s.taxCaseId, evaluation.evaluationId)).status).toBe("STALE"); expect((await app.taxCase.itrForm.status(s.tenantId, s.taxCaseId, selected.selectionId)).status).toBe("STALE"); await expect(app.taxCase.itrForm.select(envelope(s.tenantId, "stale-select", { taxCaseId: s.taxCaseId, evaluationId: evaluation.evaluationId, expectedEvaluationHash: evaluation.evaluationHash, selectedForm: "ITR-1" }))).rejects.toMatchObject({ code: "ITR_FORM_SELECTION_EVALUATION_STALE" }); expect(replacement.lifecycle).toBe("HUMAN_VERIFIED");
      await fact(app, s, "selection-fact-change", "is_director", "BOOLEAN", false); expect((await app.taxCase.itrEligibility.show(s.tenantId, s.taxCaseId, evaluation.evaluationId)).status).toBe("STALE");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
