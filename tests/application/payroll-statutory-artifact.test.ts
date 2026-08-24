import { describe, expect, it } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { OFFICIAL_DRIZZLE_MIGRATIONS } from "../../src/infrastructure/services/drizzle-baseline.ts";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";
import { findOperation } from "../../src/transport/catalog.ts";

function envelope(tenantId: string, bookSetId: string, requestId: string, payload: any, actorKind: "HUMAN" | "AGENT" = "HUMAN") {
  return { schemaVersion: 1 as const, tenantId: tenantId as never, bookSetId: bookSetId as never, requestId, actor: { kind: actorKind, id: "statutory-test" }, source: "CLI" as const, reason: "statutory artifact test", payload };
}

describe("Payroll Statutory Artifacts V1", () => {
  it("prepares, validates, exports, and replays a semantic quarterly statement and annual certificate", async () => {
    const dbPath = join(tmpdir(), `payroll-statutory-${randomUUID()}.sqlite`);
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(tmpdir(), `payroll-statutory-backup-${randomUUID()}.sqlite`), cliVersion: "test", buildId: "payroll-statutory" });
    try {
      const tenantResult = await app.tenant.create({ schemaVersion: 1, tenantId: `statutory-${randomUUID()}` as never, requestId: "tenant", actor: { kind: "HUMAN", id: "test" }, source: "CLI", reason: "test", payload: { kind: "COMPANY", name: "Statutory test" } });
      const tenant = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { expenses: string; liabilities: string } };
      const scope = (id: string, payload: unknown) => envelope(tenant.tenantId, tenant.defaultBookSetId, id, payload);
      const employeeResult = await app.payroll.employee.create(scope("employee", { employeeCode: "E-1", legalName: "Tax Employee", joiningDate: "2026-04-01", workState: "KA", workLocation: "Bengaluru", panLastFour: "1234", panFingerprint: "pan-fingerprint", panVerificationStatus: "VERIFIED" }));
      const employeeId = JSON.parse(employeeResult.resultJson).employeeId as string;
      const structureId = JSON.parse((await app.payroll.salary.structure(scope("structure", { name: "Monthly" }))).resultJson).structureId as string;
      const versionId = JSON.parse((await app.payroll.salary.version(scope("version", { structureId, versionNumber: 1, effectiveFrom: "2026-04-01" }), [
        { componentCode: "BASIC", label: "Basic", kind: "EARNING", basisType: "FIXED_MINOR", fixedMinor: 100_000, expenseAccountId: tenant.seedAccountIds.expenses, payableAccountId: tenant.seedAccountIds.liabilities },
        { componentCode: "SALARY_TDS", label: "Salary TDS", kind: "EMPLOYEE_DEDUCTION", basisType: "FIXED_MINOR", fixedMinor: 100, liabilityAccountId: tenant.seedAccountIds.liabilities },
      ])).resultJson).versionId as string;
      const ruleId = JSON.parse((await app.payroll.ruleSnapshot.create(scope("rule", { jurisdiction: "IN", ruleType: "SALARY_TDS", effectiveFrom: "2026-04-01", officialSource: "source", lawReference: "law", ruleVersion: "v1", applicabilityFacts: { verified: true }, basis: "TAXABLE_INCOME", status: "VERIFIED", salaryTdsFacts: { annualProjectedTaxMinor: 1200, priorDeductionMinor: 0, remainingPeriods: 12, currentAllocationMinor: 0, paymentLaw: "INCOME_TAX_ACT_2025_S392" } }))).resultJson).ruleSnapshotId as string;
      const preparedRun = await app.payroll.payRun.prepare(scope("run-prepare", { periodStart: "2026-04-01", periodEnd: "2026-04-30", paymentDate: "2026-04-30", employees: [{ employeeId, salaryVersionId: versionId, payableDays: 30, periodDays: 30, ruleSnapshotIds: [ruleId] }] }));
      const payRunId = JSON.parse(preparedRun.resultJson).payRunId as string;
      const approvalDb = new BunDatabase(dbPath); approvalDb.query("UPDATE payroll_pay_runs SET status = 'APPROVED', approved_at = ? WHERE id = ?").run(new Date().toISOString(), payRunId); approvalDb.close(); await app.payroll.payRun.post(scope("run-post", { payRunId }));
      const remittance = JSON.parse((await app.payroll.remittance.create(scope("remittance", { ruleType: "SALARY_TDS", periodStart: "2026-04-01", periodEnd: "2026-04-30", liabilityAccountId: tenant.seedAccountIds.liabilities, amountMinor: 100 }))).resultJson).remittanceId as string;
      const db = new BunDatabase(dbPath); db.query("UPDATE payroll_remittances SET status = 'ACKNOWLEDGED', evidence_id = 'challan-1' WHERE id = ?").run(remittance); db.query("INSERT INTO payroll_remittance_allocations (id, tenant_id, book_set_id, remittance_id, pay_run_id, amount_minor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), tenant.tenantId, tenant.defaultBookSetId, remittance, payRunId, 100, new Date().toISOString()); db.close();
      const pack = JSON.parse((await app.payroll.statutory.pack.register(scope("pack-register", { semanticKind: "SALARY_TDS_QUARTERLY_STATEMENT", applicableFrom: "2026-04-01", applicableTo: "2027-03-31", officialFormCode: "OFFICIAL-QUARTERLY", officialFormVersion: "2026.1", authorityReference: "verified-source", validatorVersion: "validator-1", validationSchema: { type: "object" }, mappingSpec: { type: "pointer", pointer: "/artifact" } }))).resultJson);
      await app.payroll.statutory.pack.verify(scope("pack-verify", { packId: pack.packId, expectedPackHash: pack.canonicalHash, reason: "human verified" }));
      const binding = { bookSetId: tenant.defaultBookSetId, semanticKind: "SALARY_TDS_QUARTERLY_STATEMENT", financialYear: "2026-27", quarter: "Q1", payRunIds: [payRunId], schemaPackId: pack.packId };
      const prepared = JSON.parse((await app.payroll.statutory.artifact.prepare(scope("artifact-prepare", binding))).resultJson);
      expect(prepared.status).toBe("PREPARED"); expect(prepared.governmentContentHash).toMatch(/^[0-9a-f]{64}$/);
      const validated = JSON.parse((await app.payroll.statutory.artifact.validate(scope("artifact-validate", { bookSetId: tenant.defaultBookSetId, artifactId: prepared.artifactId, expectedArtifactHash: prepared.governmentContentHash }))).resultJson);
      expect(validated.status).toBe("LOCAL_VALID");
      const exported = JSON.parse((await app.payroll.statutory.artifact.export(scope("artifact-export", { bookSetId: tenant.defaultBookSetId, artifactId: prepared.artifactId, expectedArtifactHash: prepared.governmentContentHash, expectedValidationHash: validated.validationHash }))).resultJson);
      expect(exported).toMatchObject({ status: "EXPORTED", submitted: false, issued: false });
      expect(JSON.parse((await app.payroll.statutory.artifact.prepare(scope("artifact-prepare", binding))).resultJson).artifactId).toBe(prepared.artifactId);
      const annualPack = JSON.parse((await app.payroll.statutory.pack.register(scope("annual-pack-register", { semanticKind: "SALARY_TDS_ANNUAL_CERTIFICATE", applicableFrom: "2026-04-01", applicableTo: "2027-03-31", officialFormCode: "OFFICIAL-ANNUAL", officialFormVersion: "2026.1", authorityReference: "verified-source", validatorVersion: "validator-1", validationSchema: { type: "object" }, mappingSpec: { type: "pointer", pointer: "/artifact" } }))).resultJson);
      await app.payroll.statutory.pack.verify(scope("annual-pack-verify", { packId: annualPack.packId, expectedPackHash: annualPack.canonicalHash, reason: "human verified" }));
      const certificate = JSON.parse((await app.payroll.statutory.artifact.prepare(scope("certificate-prepare", { bookSetId: tenant.defaultBookSetId, semanticKind: "SALARY_TDS_ANNUAL_CERTIFICATE", financialYear: "2026-27", employeeId, payRunIds: [payRunId], schemaPackId: annualPack.packId }))).resultJson);
      expect(certificate.semanticKind).toBe("SALARY_TDS_ANNUAL_CERTIFICATE");
    } finally { new BunDatabase(dbPath).close(); }
  });

  it("fails closed before persistence for an unverified pack and unreconciled remittance", async () => {
    const dbPath = join(tmpdir(), `payroll-statutory-blocked-${randomUUID()}.sqlite`);
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(tmpdir(), `payroll-statutory-blocked-backup-${randomUUID()}.sqlite`), cliVersion: "test", buildId: "payroll-statutory-blocked" });
    try {
      const tenantResult = await app.tenant.create({ schemaVersion: 1, tenantId: `blocked-${randomUUID()}` as never, requestId: "tenant", actor: { kind: "HUMAN", id: "test" }, source: "CLI", reason: "test", payload: { kind: "COMPANY", name: "Blocked statutory test" } });
      const tenant = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string };
      const scope = (id: string, payload: unknown) => envelope(tenant.tenantId, tenant.defaultBookSetId, id, payload);
      const pack = JSON.parse((await app.payroll.statutory.pack.register(scope("pack-register", { semanticKind: "SALARY_TDS_QUARTERLY_STATEMENT", applicableFrom: "2026-04-01", officialFormCode: "FORM-X", officialFormVersion: "1", authorityReference: "source", validatorVersion: "v1", validationSchema: { type: "object" }, mappingSpec: { type: "pointer", pointer: "/artifact" } }))).resultJson);
      await expect(app.payroll.statutory.artifact.prepare(scope("artifact-prepare", { bookSetId: tenant.defaultBookSetId, semanticKind: "SALARY_TDS_QUARTERLY_STATEMENT", financialYear: "2026-27", quarter: "Q1", payRunIds: ["missing"], schemaPackId: pack.packId }))).rejects.toMatchObject({ code: "PAYROLL_STATUTORY_PACK_NOT_VERIFIED" });
    } finally { new BunDatabase(dbPath).close(); }
  });

  it("keeps the migration, catalog, transport, and backup boundaries explicit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "payroll-statutory-boundaries-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "payroll-statutory-boundaries" });
      const native = new BunDatabase(dbPath, { safeIntegers: true });
      expect(native.query("SELECT id, hash FROM __drizzle_migrations ORDER BY rowid DESC LIMIT 1").get()).toEqual({ id: BigInt(OFFICIAL_DRIZZLE_MIGRATIONS.length), hash: OFFICIAL_DRIZZLE_MIGRATIONS.at(-1)!.hash });
      expect(native.query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'payroll_statutory_%'").get()).toEqual({ count: 5n });
      expect(native.query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'payroll_statutory_%'").get()).toEqual({ count: 10n });
      expect(native.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: BigInt(OFFICIAL_DRIZZLE_MIGRATIONS.length) });
      native.close();
      for (const operationId of ["payroll.statutory-pack.register", "payroll.statutory-pack.verify", "payroll.statutory-pack.show", "payroll.statutory-artifact.preview", "payroll.statutory-artifact.prepare", "payroll.statutory-artifact.validate", "payroll.statutory-artifact.export", "payroll.statutory-artifact.show", "payroll.statutory-artifact.status", "payroll.statutory-artifact.content"]) expect(findOperation(operationId)).toBeDefined();

      const tenantResult = await app.tenant.create({ schemaVersion: 1, tenantId: `boundary-${randomUUID()}` as never, requestId: "tenant", actor: { kind: "HUMAN", id: "test" }, source: "CLI", reason: "test", payload: { kind: "COMPANY", name: "Boundary test" } });
      const tenant = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string };
      const pack = JSON.parse((await app.payroll.statutory.pack.register(envelope(tenant.tenantId, tenant.defaultBookSetId, "pack-register", { semanticKind: "SALARY_TDS_QUARTERLY_STATEMENT", applicableFrom: "2026-04-01", officialFormCode: "BOUNDARY-FORM", officialFormVersion: "1", authorityReference: "source", validatorVersion: "v1", validationSchema: { type: "object" }, mappingSpec: { type: "pointer", pointer: "/artifact" } }))).resultJson);
      const cli = await new OperationDispatcher({ databasePath: dbPath, source: "CLI", allowOperatorOperations: false }).dispatch("payroll.statutory-pack.show", { packId: pack.packId });
      const mcp = await new OperationDispatcher({ databasePath: dbPath, source: "MCP", allowOperatorOperations: false }).dispatch("payroll.statutory-pack.show", { packId: pack.packId });
      expect(mcp).toEqual(cli);

      const backupPath = join(directory, "statutory.backup.sqlite");
      const restoredPath = join(directory, "statutory.restored.sqlite");
      const backup = new BackupService(dbPath);
      await backup.createBackup(backupPath);
      expect(await backup.restoreFromBackup(backupPath, restoredPath)).toBe(true);
      const restored = new BunDatabase(restoredPath, { readonly: true, safeIntegers: true });
      expect(restored.query("SELECT COUNT(*) AS count FROM payroll_statutory_packs").get()).toEqual({ count: 1n });
      expect(restored.query("SELECT type FROM sqlite_master WHERE name = 'payroll_statutory_artifacts_no_update'").get()).toEqual({ type: "trigger" });
      expect(restored.query("PRAGMA foreign_key_check").all()).toEqual([]);
      restored.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
