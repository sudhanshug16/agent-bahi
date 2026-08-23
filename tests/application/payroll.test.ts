import { describe, expect, it } from "bun:test";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { Database as BunDatabase } from "bun:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function envelope(tenantId: string, bookSetId: string, requestId: string, payload: any) {
  return { schemaVersion: 1 as const, tenantId: tenantId as never, bookSetId: bookSetId as never, requestId, actor: { kind: "HUMAN" as const, id: "test" }, source: "CLI" as const, reason: "payroll test", payload };
}

describe("payroll V1", () => {
  it("runs a scoped rule-gated payroll through posting and deterministic payslip", async () => {
    const dbPath = join(tmpdir(), `payroll-${randomUUID()}.sqlite`);
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(tmpdir(), `payroll-backup-${randomUUID()}.sqlite`), cliVersion: "test", buildId: "payroll-test" });
    try {
      const tenantResult = await app.tenant.create({ schemaVersion: 1, tenantId: "payroll-tenant" as never, requestId: "tenant", actor: { kind: "HUMAN", id: "test" }, source: "CLI", reason: "test", payload: { kind: "COMPANY", name: "Payroll test" } });
      const tenant = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { expenses: string; liabilities: string } };
      const scope = (requestId: string, payload: unknown) => envelope(tenant.tenantId, tenant.defaultBookSetId, requestId, payload);
      const employee = await app.payroll.employee.create(scope("employee", { employeeCode: "E-1", legalName: "Masked Employee", joiningDate: "2026-04-01", workState: "KA", workLocation: "Bengaluru", panLastFour: "1234", bankLastFour: "6789" }));
      const employeeId = JSON.parse(employee.resultJson).employeeId as string;
      expect((await app.payroll.employee.get(tenant.tenantId as never, tenant.defaultBookSetId as never, employeeId)).pan).toBe("PAN ****1234");
      const structure = await app.payroll.salary.structure(scope("structure", { name: "Monthly" }));
      const structureId = JSON.parse(structure.resultJson).structureId as string;
      const version = await app.payroll.salary.version(scope("version", { structureId, versionNumber: 1, effectiveFrom: "2026-04-01", prorationPolicy: "PAYABLE_DAYS_OVER_PERIOD_DAYS" }), [{ componentCode: "BASIC", label: "Basic", kind: "EARNING", basisType: "FIXED_MINOR", fixedMinor: 100000, expenseAccountId: tenant.seedAccountIds.expenses, payableAccountId: tenant.seedAccountIds.liabilities }]);
      const versionId = JSON.parse(version.resultJson).versionId as string;
      const rule = await app.payroll.ruleSnapshot.create(scope("rule", { jurisdiction: "IN", ruleType: "SALARY_TDS", effectiveFrom: "2026-04-01", officialSource: "https://incometaxindia.gov.in/w/section-392-5", lawReference: "Income-tax Act 2025 s392", ruleVersion: "2026.1", applicabilityFacts: { tenantFacts: "test" }, basis: "TAXABLE_INCOME", status: "VERIFIED", salaryTdsFacts: { annualProjectedTaxMinor: 0, priorDeductionMinor: 0, remainingPeriods: 12, currentAllocationMinor: 0, paymentLaw: "INCOME_TAX_ACT_2025_S392" } }));
      const ruleId = JSON.parse(rule.resultJson).ruleSnapshotId as string;
      const prepared = await app.payroll.payRun.prepare(scope("prepare", { periodStart: "2026-04-01", periodEnd: "2026-04-30", paymentDate: "2026-05-01", employees: [{ employeeId, salaryVersionId: versionId, payableDays: 30, periodDays: 30, ruleSnapshotIds: [ruleId] }] }));
      expect(JSON.parse(prepared.resultJson).status).toBe("PREPARED");
      const payRunId = JSON.parse(prepared.resultJson).payRunId as string;
      await app.payroll.payRun.approve(scope("approve", { payRunId }));
      const posted = await app.payroll.payRun.post(scope("post", { payRunId }));
      expect(JSON.parse(posted.resultJson).status).toBe("POSTED");
      const slips = await app.payroll.payslip.list(tenant.tenantId as never, tenant.defaultBookSetId as never, payRunId);
      expect(slips).toHaveLength(1);
      expect(String(slips[0]?.rendered_text)).toContain("Net pay: 100000");
      expect(String(slips[0]?.rendered_text)).not.toContain("123456789");
      const writable = new BunDatabase(dbPath);
      expect(() => writable.query("UPDATE payroll_pay_runs SET status = 'PREPARED' WHERE id = ?").run(payRunId)).toThrow();
      expect(() => writable.query("DELETE FROM payroll_payslips WHERE id = ?").run(String(slips[0]?.id))).toThrow();
      writable.close();
    } finally {
      new BunDatabase(dbPath).close();
    }
  });
});
