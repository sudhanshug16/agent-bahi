import { describe, expect, it } from "bun:test";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { Database as BunDatabase } from "bun:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function envelope(tenantId: string, bookSetId: string, requestId: string, payload: any) {
  return { schemaVersion: 1 as const, tenantId: tenantId as never, bookSetId: bookSetId as never, requestId, actor: { kind: "HUMAN" as const, id: "test" }, source: "CLI" as const, reason: "payroll test", payload };
}

async function payrollFixture() {
  const dbPath = join(tmpdir(), `payroll-regression-${randomUUID()}.sqlite`);
  const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(tmpdir(), `payroll-regression-backup-${randomUUID()}.sqlite`), cliVersion: "test", buildId: "payroll-regression-test" });
  const tenantResult = await app.tenant.create({ schemaVersion: 1, tenantId: `payroll-regression-${randomUUID()}` as never, requestId: "tenant", actor: { kind: "HUMAN", id: "test" }, source: "CLI", reason: "payroll test", payload: { kind: "COMPANY", name: "Payroll regression test" } });
  const tenant = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { expenses: string; liabilities: string } };
  const scope = (requestId: string, payload: unknown) => envelope(tenant.tenantId, tenant.defaultBookSetId, requestId, payload);
  const employee = await app.payroll.employee.create(scope("employee", { employeeCode: "E-1", legalName: "Regression Employee", joiningDate: "2026-04-01", workState: "KA", workLocation: "Bengaluru" }));
  const employeeId = JSON.parse(employee.resultJson).employeeId as string;
  const structure = await app.payroll.salary.structure(scope("structure", { name: "Monthly" }));
  const structureId = JSON.parse(structure.resultJson).structureId as string;
  const version = await app.payroll.salary.version(scope("version", { structureId, versionNumber: 1, effectiveFrom: "2026-04-01" }), [{ componentCode: "BASIC", label: "Basic", kind: "EARNING", basisType: "FIXED_MINOR", fixedMinor: 100_000, expenseAccountId: tenant.seedAccountIds.expenses, payableAccountId: tenant.seedAccountIds.liabilities }]);
  const versionId = JSON.parse(version.resultJson).versionId as string;
  return { app, dbPath, tenant, scope, employeeId, versionId };
}

describe("payroll V1", () => {
  it("lists an empty payroll register for a scoped BookSet", async () => {
    const fixture = await payrollFixture();
    try {
      await expect(fixture.app.payroll.register(fixture.tenant.tenantId as never, fixture.tenant.defaultBookSetId as never)).resolves.toEqual([]);
    } finally {
      new BunDatabase(fixture.dbPath).close();
    }
  });

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

  it("rejects multiple effective verified SALARY_TDS snapshots before pay-run persistence", async () => {
    const fixture = await payrollFixture();
    try {
      const createSalaryTdsRule = (requestId: string, jurisdiction = "IN") => fixture.app.payroll.ruleSnapshot.create(fixture.scope(requestId, { jurisdiction, ruleType: "SALARY_TDS", effectiveFrom: "2026-04-01", officialSource: "https://incometaxindia.gov.in/test", lawReference: "Income-tax Act 2025 s392", ruleVersion: requestId, applicabilityFacts: { tenantFacts: "test" }, basis: "TAXABLE_INCOME", status: "VERIFIED", salaryTdsFacts: { annualProjectedTaxMinor: 10_000, priorDeductionMinor: 0, remainingPeriods: 12, currentAllocationMinor: 100, paymentLaw: "INCOME_TAX_ACT_2025_S392" } }));
      const firstRule = JSON.parse((await createSalaryTdsRule("salary-tds-1")).resultJson).ruleSnapshotId as string;
      const secondRule = JSON.parse((await createSalaryTdsRule("salary-tds-2", "KA")).resultJson).ruleSnapshotId as string;

      await expect(fixture.app.payroll.payRun.prepare(fixture.scope("prepare-duplicate-salary-tds", { periodStart: "2026-04-01", periodEnd: "2026-04-30", paymentDate: "2026-05-01", employees: [{ employeeId: fixture.employeeId, salaryVersionId: fixture.versionId, payableDays: 30, periodDays: 30, ruleSnapshotIds: [firstRule, secondRule] }] }))).rejects.toMatchObject({ code: "MULTIPLE_SALARY_TDS_RULES", message: "at most one effective SALARY_TDS rule snapshot may apply to an employee pay run" });

      const db = new BunDatabase(fixture.dbPath, { readonly: true });
      try {
        const count = db.query("SELECT COUNT(*) AS count FROM payroll_pay_runs").get() as { count: number };
        expect(Number(count.count)).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      new BunDatabase(fixture.dbPath).close();
    }
  });

  it("accepts one SALARY_TDS snapshot alongside another non-TDS snapshot", async () => {
    const fixture = await payrollFixture();
    try {
      const salaryTds = await fixture.app.payroll.ruleSnapshot.create(fixture.scope("salary-tds", { jurisdiction: "IN", ruleType: "SALARY_TDS", effectiveFrom: "2026-04-01", officialSource: "https://incometaxindia.gov.in/test", lawReference: "Income-tax Act 2025 s392", ruleVersion: "salary-tds", applicabilityFacts: { tenantFacts: "test" }, basis: "TAXABLE_INCOME", status: "VERIFIED", salaryTdsFacts: { annualProjectedTaxMinor: 10_000, priorDeductionMinor: 0, remainingPeriods: 12, currentAllocationMinor: 100, paymentLaw: "INCOME_TAX_ACT_2025_S392" } }));
      const epf = await fixture.app.payroll.ruleSnapshot.create(fixture.scope("epf", { jurisdiction: "IN", ruleType: "EPF", effectiveFrom: "2026-04-01", officialSource: "https://epfindia.gov.in/test", lawReference: "EPF Act test", ruleVersion: "epf", applicabilityFacts: { tenantFacts: "test" }, basis: "GROSS", status: "VERIFIED" }));
      const salaryTdsId = JSON.parse(salaryTds.resultJson).ruleSnapshotId as string;
      const epfId = JSON.parse(epf.resultJson).ruleSnapshotId as string;

      const prepared = await fixture.app.payroll.payRun.prepare(fixture.scope("prepare-mixed-rules", { periodStart: "2026-04-01", periodEnd: "2026-04-30", paymentDate: "2026-05-01", employees: [{ employeeId: fixture.employeeId, salaryVersionId: fixture.versionId, payableDays: 30, periodDays: 30, ruleSnapshotIds: [salaryTdsId, epfId] }] }));
      const payRunId = JSON.parse(prepared.resultJson).payRunId as string;
      expect(JSON.parse(prepared.resultJson).status).toBe("PREPARED");

      const db = new BunDatabase(fixture.dbPath, { readonly: true });
      try {
        const employeeRun = db.query("SELECT employee_deduction_minor, net_minor FROM payroll_pay_run_employees WHERE pay_run_id = ?").get(payRunId) as { employee_deduction_minor: number; net_minor: number };
        expect(Number(employeeRun.employee_deduction_minor)).toBe(100);
        expect(Number(employeeRun.net_minor)).toBe(99_900);
      } finally {
        db.close();
      }
    } finally {
      new BunDatabase(fixture.dbPath).close();
    }
  });
});
