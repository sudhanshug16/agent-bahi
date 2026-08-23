import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

function envelope(tenantId: string, requestId: string, payload: unknown, actor: "HUMAN" | "AGENT" = "HUMAN"): any {
  return { schemaVersion: 1 as const, tenantId, requestId, actor: { kind: actor, id: `${actor.toLowerCase()}-return-test` }, source: "CLI" as const, reason: "TEST_ONLY return artifact pack", payload };
}

const references = ["LAW", "RULES", "SCHEMA", "INSTRUCTION"].map((kind) => ({ kind, sourceUrl: "https://example.invalid/test-only", sourceTitle: "TEST_ONLY", officialReleaseIdentifier: "TEST_ONLY", officialReleaseDate: "2024-04-01", sha256: "a".repeat(64) }));

describe("Personal Tax Return Artifact V1", () => {
  test("registers and human-verifies a constrained TEST_ONLY schema pack through shared dispatch", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-return-schema-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
      const tenant = JSON.parse((await app.tenant.create(envelope("tenant-return", "tenant", { kind: "INDIVIDUAL", name: "TEST_ONLY return taxpayer" }))).resultJson);
      const authority = JSON.parse((await app.taxAuthority.pack.register(envelope(tenant.tenantId, "authority-register", { jurisdiction: "IN", authority: "INCOME_TAX", financialYear: "2024-25", assessmentYear: "2025-26", filingTypes: ["ANNUAL"], effectiveFrom: "2024-04-01", releasedAt: "2024-04-01", releaseIdentifier: "TEST_ONLY", artifactReferences: references, packVersion: "TEST_ONLY-1", candidateForms: ["ITR-1"], ruleAst: { forms: [{ form: "ITR-1", rule: { op: "fact", field: "is_resident", test: "exists" } }] } }, "AGENT"))).resultJson);
      await app.taxAuthority.pack.verify(envelope(tenant.tenantId, "authority-verify", { packId: authority.packId, expectedPackHash: authority.canonicalHash, reason: "TEST_ONLY human verification" }));
      const schema = { type: "object", properties: { pan: { type: "string", pattern: "^[A-Z]{5}[0-9]{4}[A-Z]$" }, amount: { type: "integer", integerEncoding: "DECIMAL_STRING" } }, required: ["pan", "amount"], additionalProperties: false };
      const mapping = { type: "object", properties: { pan: { type: "pointer", pointer: "/identity/pan" }, amount: { type: "constant", value: "0", convert: "integer" } } };
      const registered = JSON.parse((await app.taxAuthority.returnSchemaPack.register(envelope(tenant.tenantId, "schema-register", { authorityPackId: authority.packId, authorityPackHash: authority.canonicalHash, itrForm: "ITR-1", filingType: "ANNUAL", financialYear: "2024-25", assessmentYear: "2025-26", artifactReferences: references, packVersion: "TEST_ONLY-schema-1", validationSchema: schema, mappingSpec: mapping }, "AGENT"))).resultJson);
      expect(registered.lifecycle).toBe("REGISTERED");
      const verified = await app.taxAuthority.returnSchemaPack.verify(envelope(tenant.tenantId, "schema-verify", { packId: registered.packId, expectedPackHash: registered.canonicalHash, reason: "TEST_ONLY human schema verification" }));
      expect(JSON.parse(verified.resultJson)).toMatchObject({ lifecycle: "HUMAN_VERIFIED", itrForm: "ITR-1" });
      const cli = await new OperationDispatcher({ databasePath: dbPath, allowOperatorOperations: false }).dispatch("tax-authority.return-schema-pack.show", { packId: registered.packId });
      expect(cli.ok).toBe(true);
      const native = new Database(dbPath, { readonly: true, safeIntegers: true });
      expect(native.query("SELECT event_type FROM personal_tax_return_schema_pack_events WHERE pack_id = ? ORDER BY created_at").all(registered.packId)).toEqual([{ event_type: "REGISTERED" }, { event_type: "HUMAN_VERIFIED" }]);
      native.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("prepares, validates, exports, masks, supersedes, and isolates immutable artifacts", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-return-artifact-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
      const tenant = JSON.parse((await app.tenant.create(envelope("tenant-artifact", "tenant", { kind: "INDIVIDUAL", name: "TEST_ONLY artifact taxpayer" }))).resultJson);
      await app.tenant.activate(envelope(tenant.tenantId, "activate", { defaultBookSetId: tenant.defaultBookSetId }));
      await app.tenant.pan.set(envelope(tenant.tenantId, "pan", { pan: "ABCDE1234F" }));
      const taxCaseId = "return-case";
      await app.taxCase.create(envelope(tenant.tenantId, "case", { taxCaseId, financialYear: "2024-25", taxPeriod: "2024-25", filingTrigger: "ANNUAL", bookSetIds: [tenant.defaultBookSetId] }));
      const candidate = await app.taxCase.filingSnapshot.preview(tenant.tenantId, taxCaseId);
      const snapshot = JSON.parse((await app.taxCase.filingSnapshot.seal(envelope(tenant.tenantId, "seal", { taxCaseId, candidateHash: candidate.candidateHash }))).resultJson);
      const worksheet = JSON.parse((await app.taxCase.position.generate(envelope(tenant.tenantId, "worksheet", { taxCaseId, filingSnapshotId: snapshot.snapshotId }, "AGENT")).then((result) => result.resultJson)));
      const authority = JSON.parse((await app.taxAuthority.pack.register(envelope(tenant.tenantId, "authority", { jurisdiction: "IN", authority: "INCOME_TAX", financialYear: "2024-25", assessmentYear: "2025-26", filingTypes: ["ANNUAL"], effectiveFrom: "2024-04-01", releasedAt: "2024-04-01", releaseIdentifier: "TEST_ONLY", artifactReferences: references, packVersion: "TEST_ONLY-artifact-authority", candidateForms: ["ITR-1"], ruleAst: { forms: [{ form: "ITR-1", rule: { op: "eq", field: "is_resident", value: true } }] } }, "AGENT"))).resultJson);
      await app.taxAuthority.pack.verify(envelope(tenant.tenantId, "authority-verify", { packId: authority.packId, expectedPackHash: authority.canonicalHash, reason: "TEST_ONLY authority review" }));
      await app.taxCase.eligibilityFacts.record(envelope(tenant.tenantId, "eligibility-fact", { taxCaseId, filingSnapshotId: snapshot.snapshotId, worksheetId: worksheet.worksheetId, snapshotCandidateHash: snapshot.candidateHash, worksheetOutputHash: worksheet.canonicalOutputHash, fieldName: "is_resident", valueType: "BOOLEAN", value: true, provenanceKind: "HUMAN_ASSERTION", provenance: { source: "TEST_ONLY" } }));
      const evaluation = JSON.parse((await app.taxCase.itrEligibility.evaluate(envelope(tenant.tenantId, "eligibility", { taxCaseId, filingSnapshotId: snapshot.snapshotId, worksheetId: worksheet.worksheetId, packId: authority.packId }, "AGENT"))).resultJson);
      const selection = JSON.parse((await app.taxCase.itrForm.select(envelope(tenant.tenantId, "selection", { taxCaseId, evaluationId: evaluation.evaluationId, expectedEvaluationHash: evaluation.evaluationHash, selectedForm: "ITR-1" }))).resultJson);
      const program = { nodes: [{ name: "zero", op: "constant", value: "0" }, { name: "gross", op: "final", arg: "zero" }, { name: "credits", op: "final", arg: "zero" }, { name: "net", op: "final", arg: "zero" }], outputs: [{ name: "grossTaxMinor", ref: "gross" }, { name: "creditsMinor", ref: "credits" }, { name: "netPayableMinor", ref: "net" }] };
      const computationPack = JSON.parse((await app.taxAuthority.computationPack.register(envelope(tenant.tenantId, "computation-pack", { authorityPackId: authority.packId, authorityPackHash: authority.canonicalHash, financialYear: "2024-25", assessmentYear: "2025-26", itrForm: "ITR-1", packVersion: "TEST_ONLY-artifact-computation", provenanceArtifacts: references, declaredInputs: [{ name: "is_resident", valueType: "BOOLEAN" }], namedSchedules: ["TEST_ONLY"], program }, "AGENT"))).resultJson);
      await app.taxAuthority.computationPack.verify(envelope(tenant.tenantId, "computation-pack-verify", { packId: computationPack.packId, expectedPackHash: computationPack.canonicalHash, reason: "TEST_ONLY computation review" }));
      const inputSet = JSON.parse((await app.taxCase.computationInputs.record(envelope(tenant.tenantId, "computation-inputs", { taxCaseId, filingSnapshotId: snapshot.snapshotId, worksheetId: worksheet.worksheetId, evaluationId: evaluation.evaluationId, selectionId: selection.selectionId, computationPackId: computationPack.packId, inputs: { is_resident: { valueType: "BOOLEAN", value: true, provenance: { source: "TEST_ONLY" }, verified: true } } }))).resultJson);
      const computation = JSON.parse((await app.taxCase.computation.generate(envelope(tenant.tenantId, "computation", { taxCaseId, filingSnapshotId: snapshot.snapshotId, worksheetId: worksheet.worksheetId, evaluationId: evaluation.evaluationId, selectionId: selection.selectionId, computationPackId: computationPack.packId, inputSetId: inputSet.inputSetId, inputs: { is_resident: { valueType: "BOOLEAN", value: true, provenance: { source: "TEST_ONLY" }, verified: true } } }, "AGENT"))).resultJson);
      await app.taxCase.computation.approve(envelope(tenant.tenantId, "computation-approve", { taxCaseId, computationId: computation.computationId, expectedComputationHash: computation.computationHash, reason: "TEST_ONLY human approval" }));
      const schema = { type: "object", properties: { pan: { type: "string", pattern: "^[A-Z]{5}[0-9]{4}[A-Z]$" }, amount: { type: "integer", integerEncoding: "DECIMAL_STRING", minimum: "0", maximum: "10" } }, required: ["pan", "amount"], additionalProperties: false };
      const mapping = { type: "object", properties: { pan: { type: "pointer", pointer: "/identity/pan" }, amount: { type: "constant", value: "0", convert: "integer" } } };
      const schemaPack = JSON.parse((await app.taxAuthority.returnSchemaPack.register(envelope(tenant.tenantId, "schema", { authorityPackId: authority.packId, authorityPackHash: authority.canonicalHash, itrForm: "ITR-1", filingType: "ANNUAL", financialYear: "2024-25", assessmentYear: "2025-26", artifactReferences: references, packVersion: "TEST_ONLY-artifact-schema", validationSchema: schema, mappingSpec: mapping }, "AGENT"))).resultJson);
      await app.taxAuthority.returnSchemaPack.verify(envelope(tenant.tenantId, "schema-verify", { packId: schemaPack.packId, expectedPackHash: schemaPack.canonicalHash, reason: "TEST_ONLY schema review" }));
      const binding = { taxCaseId, filingSnapshotId: snapshot.snapshotId, worksheetId: worksheet.worksheetId, evaluationId: evaluation.evaluationId, selectionId: selection.selectionId, computationId: computation.computationId, schemaPackId: schemaPack.packId };
      const preview = await app.taxCase.returnArtifact.preview(tenant.tenantId, binding);
      expect(preview.content).toEqual({ pan: "ABCDE1234F", amount: "0" });
      expect((await app.taxCase.returnArtifact.preview(tenant.tenantId, binding)).contentHash).toBe(preview.contentHash);
      const prepared = JSON.parse((await app.taxCase.returnArtifact.prepare(envelope(tenant.tenantId, "prepare", binding, "AGENT"))).resultJson);
      expect((await app.taxCase.returnArtifact.prepare(envelope(tenant.tenantId, "prepare", binding, "AGENT"))).replayed).toBe(true);
      const valid = JSON.parse((await app.taxCase.returnArtifact.validate(envelope(tenant.tenantId, "validate", { taxCaseId, artifactId: prepared.artifactId, expectedArtifactHash: prepared.contentHash }, "AGENT"))).resultJson);
      expect(valid.status).toBe("LOCAL_VALID");
      expect((await app.taxCase.returnArtifact.content(tenant.tenantId, taxCaseId, prepared.artifactId)).revealed).toBe(false);
      await expect(app.taxCase.returnArtifact.content(tenant.tenantId, taxCaseId, prepared.artifactId, true, "AGENT")).rejects.toMatchObject({ code: "RETURN_ARTIFACT_SENSITIVE_HUMAN_REQUIRED" });
      expect((await app.taxCase.returnArtifact.content(tenant.tenantId, taxCaseId, prepared.artifactId, true, "HUMAN")).content).toEqual({ pan: "ABCDE1234F", amount: "0" });
      const exported = JSON.parse((await app.taxCase.returnArtifact.export(envelope(tenant.tenantId, "export", { taxCaseId, artifactId: prepared.artifactId, expectedArtifactHash: prepared.contentHash, expectedValidationHash: valid.validationHash }))).resultJson);
      expect(exported).toMatchObject({ status: "EXPORTED", submitted: false, accepted: false });
      expect((await app.taxCase.returnArtifact.export(envelope(tenant.tenantId, "export", { taxCaseId, artifactId: prepared.artifactId, expectedArtifactHash: prepared.contentHash, expectedValidationHash: valid.validationHash }))).replayed).toBe(true);
      const replacement = JSON.parse((await app.taxAuthority.returnSchemaPack.register(envelope(tenant.tenantId, "schema-replacement", { authorityPackId: authority.packId, authorityPackHash: authority.canonicalHash, itrForm: "ITR-1", filingType: "ANNUAL", financialYear: "2024-25", assessmentYear: "2025-26", artifactReferences: references, packVersion: "TEST_ONLY-artifact-schema-2", validationSchema: schema, mappingSpec: mapping, supersedesPackId: schemaPack.packId }, "AGENT"))).resultJson);
      await app.taxAuthority.returnSchemaPack.verify(envelope(tenant.tenantId, "schema-replacement-verify", { packId: replacement.packId, expectedPackHash: replacement.canonicalHash, reason: "TEST_ONLY schema replacement review" }));
      expect((await app.taxAuthority.returnSchemaPack.show(schemaPack.packId)).lifecycle).toBe("SUPERSEDED");
      expect((await app.taxCase.returnArtifact.status(tenant.tenantId, taxCaseId, prepared.artifactId)).status).toBe("STALE");
      await expect(app.taxCase.returnArtifact.show("other-tenant" as never, taxCaseId, prepared.artifactId)).rejects.toMatchObject({ code: "RETURN_ARTIFACT_NOT_FOUND" });
      const native = new Database(dbPath, { safeIntegers: true });
      expect(() => native.query("UPDATE personal_tax_return_artifacts SET content_json = '{}' WHERE id = ?").run(prepared.artifactId)).toThrow();
      expect(native.query("SELECT COUNT(*) AS count FROM personal_tax_return_export_activities WHERE artifact_id = ?").get(prepared.artifactId)).toEqual({ count: 1n });
      native.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("rejects unsupported schema keywords and unsafe pointers before persistence", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-return-schema-invalid-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
      const tenant = JSON.parse((await app.tenant.create(envelope("tenant-return-invalid", "tenant", { kind: "INDIVIDUAL", name: "TEST_ONLY invalid return taxpayer" }))).resultJson);
      const payload = { authorityPackId: "missing", authorityPackHash: "a".repeat(64), itrForm: "ITR-1", filingType: "ANNUAL", financialYear: "2024-25", assessmentYear: "2025-26", artifactReferences: references, packVersion: "TEST_ONLY-invalid", validationSchema: { type: "object", unevaluatedProperties: false }, mappingSpec: { type: "pointer", pointer: "/unsafe/sql" } };
      await expect(app.taxAuthority.returnSchemaPack.register(envelope(tenant.tenantId, "invalid-schema", payload, "AGENT"))).rejects.toMatchObject({ code: "RETURN_SCHEMA_UNSUPPORTED_KEYWORD" });
      const native = new Database(dbPath, { readonly: true, safeIntegers: true });
      expect(native.query("SELECT COUNT(*) AS count FROM personal_tax_return_schema_packs").get()).toEqual({ count: 0n });
      native.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
