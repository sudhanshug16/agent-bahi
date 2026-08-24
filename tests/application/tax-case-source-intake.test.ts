import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSqliteApplication, initializeAndUpgradeSqliteApplication, initializeSqliteDatabase, upgradeSqliteDatabase } from "../../src/application/application.ts";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { OFFICIAL_DRIZZLE_MIGRATIONS } from "../../src/infrastructure/services/drizzle-baseline.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

function envelope(tenantId: string, requestId: string, payload: unknown, source: "CLI" | "MCP" = "CLI") {
  return { schemaVersion: 1 as const, tenantId, requestId, actor: { kind: "HUMAN" as const, id: "tax-owner" }, source, reason: "source intake test", payload } as never;
}

async function individualCase(app: ReturnType<typeof createSqliteApplication>, tenantId: string, suffix: string) {
  const tenant = JSON.parse((await app.tenant.create(envelope(tenantId, randomUUID(), { kind: "INDIVIDUAL", name: `Individual ${suffix}` }))).resultJson);
  await app.tenant.activate(envelope(tenant.tenantId, randomUUID(), { defaultBookSetId: tenant.defaultBookSetId }));
  await app.tenant.pan.set(envelope(tenant.tenantId, randomUUID(), { pan: `ABCDE${suffix.padStart(4, "0").slice(-4)}F` }));
  const taxCaseId = `case-${suffix}`;
  await app.taxCase.create(envelope(tenant.tenantId, randomUUID(), { taxCaseId, financialYear: "2025-26", taxPeriod: "2025-26", filingTrigger: "ANNUAL", bookSetIds: [tenant.defaultBookSetId] }));
  return { tenantId: tenant.tenantId, taxCaseId };
}

describe("Personal Tax source evidence intake V1", () => {
  test("stores exact bytes, hashes and lists masked inventory without journal mutation", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-intake-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "source-intake" });
      const scope = await individualCase(app, `tenant-${randomUUID()}`, "0001");
      const bytes = Buffer.from([0, 1, 2, 255, 10, 20, 30]);
      const before = new Database(dbPath, { readonly: true, safeIntegers: true });
      const journalBefore = before.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get() as { count: bigint };
      before.close();
      const result = await app.taxCase.source.import(envelope(scope.tenantId, "source-1", { taxCaseId: scope.taxCaseId, sourceKind: "AIS", sourcePeriod: "2025-26", sourceAsOf: "2026-04-01", mediaType: "application/pdf", originalFilename: "ais.pdf", contentBase64: bytes.toString("base64") }));
      const view = JSON.parse(result.resultJson);
      expect(view.status).toBe("INCOMPLETE");
      expect(view.parser.status).toBe("UNSUPPORTED");
      expect(view.artifact.contentHash).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(view.artifact.byteSize).toBe(bytes.length);
      expect(view.nextAction).toContain("deterministic parser");
      const native = new Database(dbPath, { readonly: true, safeIntegers: true });
      const artifact = native.query("SELECT bytes, content_hash, byte_size FROM personal_tax_source_artifacts WHERE tenant_id = ?").get(scope.tenantId) as { bytes: Uint8Array; content_hash: string; byte_size: bigint };
      expect(Buffer.from(artifact.bytes)).toEqual(bytes);
      expect(artifact.content_hash).toBe(view.artifact.contentHash);
      expect(artifact.byte_size).toBe(BigInt(bytes.length));
      expect(native.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual(journalBefore);
      native.close();
      expect(await app.taxCase.source.list(scope.tenantId, scope.taxCaseId)).toEqual([expect.objectContaining({ sourceId: view.sourceId, status: "INCOMPLETE", artifact: expect.objectContaining({ contentHash: view.artifact.contentHash, byteSize: bytes.length, deduplicated: false }) })]);
      expect(await app.taxCase.source.status(scope.tenantId, scope.taxCaseId, view.sourceId)).toEqual(expect.objectContaining({ sourceId: view.sourceId, nextAction: view.nextAction }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("deduplicates only within a tenant and preserves request replay/conflict semantics", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-dedupe-"));
    try {
      const dbPath = join(directory, "books.sqlite");
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "source-dedupe" });
      const firstScope = await individualCase(app, `tenant-${randomUUID()}`, "0002");
      const secondScope = await individualCase(app, `tenant-${randomUUID()}`, "0003");
      const contentBase64 = Buffer.from("same exact bytes").toString("base64");
      const payload = { taxCaseId: firstScope.taxCaseId, sourceKind: "TIS", mediaType: "text/plain", originalFilename: "tis.txt", contentBase64 };
      const first = await app.taxCase.source.import(envelope(firstScope.tenantId, "same-request", payload));
      await expect(app.taxCase.source.import(envelope(firstScope.tenantId, "same-request", payload))).resolves.toMatchObject({ replayed: true, resultJson: first.resultJson });
      await expect(app.taxCase.source.import(envelope(firstScope.tenantId, "same-request", { ...payload, contentBase64: Buffer.from("changed").toString("base64") }))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      const duplicate = JSON.parse((await app.taxCase.source.import(envelope(firstScope.tenantId, "new-request", payload))).resultJson);
      expect(duplicate.artifact).toMatchObject({ artifactId: JSON.parse(first.resultJson).artifact.artifactId, deduplicated: true });
      const otherTenant = JSON.parse((await app.taxCase.source.import(envelope(secondScope.tenantId, "other-request", { ...payload, taxCaseId: secondScope.taxCaseId }))).resultJson);
      expect(otherTenant.artifact.artifactId).not.toBe(duplicate.artifact.artifactId);
      const native = new Database(dbPath, { readonly: true, safeIntegers: true });
      expect(native.query("SELECT COUNT(*) AS count FROM personal_tax_source_artifacts").get()).toEqual({ count: 2n });
      native.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects invalid content boundaries and unsafe files", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-invalid-"));
    try {
      const dbPath = join(directory, "books.sqlite");
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "source-invalid" });
      const scope = await individualCase(app, `tenant-${randomUUID()}`, "0004");
      const base = { taxCaseId: scope.taxCaseId, sourceKind: "OTHER", mediaType: "text/plain", originalFilename: "other.txt" };
      await expect(app.taxCase.source.import(envelope(scope.tenantId, "invalid-1", { ...base }))).rejects.toMatchObject({ code: "TAX_SOURCE_CONTENT_EXACTLY_ONE" });
      await expect(app.taxCase.source.import(envelope(scope.tenantId, "invalid-2", { ...base, filePath: join(directory, "missing.txt"), contentBase64: "YQ==" }))).rejects.toMatchObject({ code: "TAX_SOURCE_CONTENT_EXACTLY_ONE" });
      await expect(app.taxCase.source.import(envelope(scope.tenantId, "invalid-3", { ...base, contentBase64: "not base64" }))).rejects.toMatchObject({ code: "INVALID_TAX_SOURCE_BASE64" });
      await expect(app.taxCase.source.import(envelope(scope.tenantId, "invalid-4", { ...base, contentBase64: "" }))).rejects.toMatchObject({ code: "INVALID_TAX_SOURCE_INPUT" });
      await expect(app.taxCase.source.import(envelope(scope.tenantId, "invalid-5", { ...base, filePath: directory }))).rejects.toMatchObject({ code: "UNSAFE_TAX_SOURCE_PATH" });
      const filePath = join(directory, "source.txt");
      await writeFile(filePath, "file bytes");
      const fileResult = await app.taxCase.source.import(envelope(scope.tenantId, "file-request", { ...base, filePath }));
      expect(JSON.parse(fileResult.resultJson).artifact.byteSize).toBe(10);
      await expect(app.taxCase.source.import(envelope(scope.tenantId, "invalid-6", { ...base, contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64") }))).rejects.toMatchObject({ code: "TAX_SOURCE_TOO_LARGE" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("preserves source bytes through backup/restore and upgrades a 0023 fixture to the current official migration", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-backup-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      await initializeSqliteDatabase(dbPath, { cliVersion: "test", buildId: "source-upgrade" });
      const downgrade = new Database(dbPath, { safeIntegers: true });
      downgrade.exec("DROP TRIGGER gst_gstr3b_export_activities_no_delete; DROP TRIGGER gst_gstr3b_export_activities_no_update; DROP TRIGGER gst_gstr3b_validation_runs_no_delete; DROP TRIGGER gst_gstr3b_validation_runs_no_update; DROP TRIGGER gst_gstr3b_artifacts_no_delete; DROP TRIGGER gst_gstr3b_artifacts_no_update; DROP TRIGGER gst_gstr3b_fact_events_no_delete; DROP TRIGGER gst_gstr3b_fact_events_no_update; DROP TRIGGER gst_gstr3b_facts_no_delete; DROP TRIGGER gst_gstr3b_facts_no_update; DROP TRIGGER gst_gstr3b_schema_pack_events_no_delete; DROP TRIGGER gst_gstr3b_schema_pack_events_no_update; DROP TRIGGER gst_gstr3b_schema_packs_no_delete; DROP TRIGGER gst_gstr3b_schema_packs_no_update; DROP TABLE gst_gstr3b_export_activities; DROP TABLE gst_gstr3b_validation_runs; DROP TABLE gst_gstr3b_artifacts; DROP TABLE gst_gstr3b_fact_events; DROP TABLE gst_gstr3b_facts; DROP TABLE gst_gstr3b_schema_pack_events; DROP TABLE gst_gstr3b_schema_packs; DROP TRIGGER personal_tax_position_worksheets_no_delete; DROP TRIGGER personal_tax_position_worksheets_no_update; DROP TABLE personal_tax_position_worksheets; DROP TRIGGER tax_case_source_assessment_events_no_delete; DROP TRIGGER tax_case_source_assessment_events_no_update; DROP TRIGGER tax_case_source_assessments_no_delete; DROP TRIGGER tax_case_source_assessments_no_update; DROP TABLE tax_case_source_assessment_events; DROP TABLE tax_case_source_assessments; DROP TRIGGER filing_snapshot_reconciliations_no_delete; DROP TRIGGER filing_snapshot_reconciliations_no_update; DROP TRIGGER filing_snapshot_facts_no_delete; DROP TRIGGER filing_snapshot_facts_no_update; DROP TRIGGER filing_snapshot_sources_no_delete; DROP TRIGGER filing_snapshot_sources_no_update; DROP TRIGGER filing_snapshot_book_sets_no_delete; DROP TRIGGER filing_snapshot_book_sets_no_update; DROP TRIGGER filing_snapshots_no_delete; DROP TRIGGER filing_snapshots_no_update; DROP TABLE filing_snapshot_reconciliations; DROP TABLE filing_snapshot_facts; DROP TABLE filing_snapshot_sources; DROP TABLE filing_snapshot_book_sets; DROP TABLE filing_snapshots; DROP INDEX uq_tax_case_fact_reconciliations_id_scope;");
      const laterPrefixes = ["gst_gstr3b_", "gst_gstr1_", "gst_return_schema_", "withholding_statement_", "personal_tax_authority_", "personal_tax_computation_", "personal_tax_itr_", "personal_tax_return_", "tax_case_itr_", "mca_", "fiscal_year_rollovers", "uq_fiscal_year_rollover", "idx_fiscal_year_rollovers", "payroll_statutory_", "source_"];
      const laterObjects = downgrade.query("SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'index', 'table') AND (" + laterPrefixes.map(() => "name LIKE ?").join(" OR ") + ") ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name DESC").all(...laterPrefixes.map((prefix) => `${prefix}%`)) as Array<{ type: string; name: string }>;
      for (const object of laterObjects) downgrade.exec(`DROP ${object.type.toUpperCase()} "${object.name.replaceAll('"', '""')}"`);
      const targetCount = OFFICIAL_DRIZZLE_MIGRATIONS.findIndex((migration) => migration.id === "0023_personal_tax_facts_reconciliation_v1") + 1;
      downgrade.query("DELETE FROM __drizzle_migrations WHERE id > ?").run(targetCount);
      const previous = OFFICIAL_DRIZZLE_MIGRATIONS[targetCount - 1]!;
      downgrade.query("UPDATE database_control SET last_migration_id = ?, last_migration_checksum = ? WHERE id = 1").run(previous.id, previous.hash);
      downgrade.close();
      await upgradeSqliteDatabase(dbPath, { backupDestinationPath: join(directory, "0023.backup"), cliVersion: "test", buildId: "source-upgrade" });
      const app = createSqliteApplication(dbPath);
      const scope = await individualCase(app, `tenant-${randomUUID()}`, "0005");
      const imported = JSON.parse((await app.taxCase.source.import(envelope(scope.tenantId, "restore-source", { taxCaseId: scope.taxCaseId, sourceKind: "AIS", mediaType: "application/octet-stream", originalFilename: "raw.bin", contentBase64: Buffer.from([8, 7, 6, 0, 5]).toString("base64") }))).resultJson);
      const backupPath = join(directory, "source.backup");
      const backup = new BackupService(dbPath);
      await backup.createBackup(backupPath);
      const restoredPath = join(directory, "restored.sqlite");
      await backup.restoreFromBackup(backupPath, restoredPath);
      const restored = new Database(restoredPath, { readonly: true, safeIntegers: true });
      const artifact = restored.query("SELECT bytes, content_hash, byte_size FROM personal_tax_source_artifacts WHERE tenant_id = ?").get(scope.tenantId) as { bytes: Uint8Array; content_hash: string; byte_size: bigint };
      expect(Buffer.from(artifact.bytes)).toEqual(Buffer.from([8, 7, 6, 0, 5]));
      expect(artifact.content_hash).toBe(imported.artifact.contentHash);
      expect(artifact.byte_size).toBe(5n);
      expect(restored.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(restored.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: BigInt(OFFICIAL_DRIZZLE_MIGRATIONS.length) });
      restored.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("keeps CLI and stdio-MCP dispatcher views on the same source catalog", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-transport-"));
    try {
      const dbPath = join(directory, "books.sqlite");
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "source-transport" });
      const scope = await individualCase(app, `tenant-${randomUUID()}`, "0006");
      const imported = await new OperationDispatcher({ databasePath: dbPath, source: "CLI", allowOperatorOperations: false }).dispatch("tax-case.source.import", envelope(scope.tenantId, "transport-source", { taxCaseId: scope.taxCaseId, sourceKind: "OTHER", mediaType: "text/plain", originalFilename: "note.txt", contentBase64: Buffer.from("transport").toString("base64") }));
      expect(imported.ok).toBe(true);
      const input = { tenantId: scope.tenantId, taxCaseId: scope.taxCaseId };
      const cli = await new OperationDispatcher({ databasePath: dbPath, source: "CLI", allowOperatorOperations: false }).dispatch("tax-case.source.list", input);
      const mcp = await new OperationDispatcher({ databasePath: dbPath, source: "MCP", allowOperatorOperations: false }).dispatch("tax-case.source.list", input);
      expect(cli).toEqual(mcp);
      expect((cli as { result: unknown[] }).result).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
