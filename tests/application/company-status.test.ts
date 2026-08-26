import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { defaultBackupDirectory } from "../../src/infrastructure/services/backup-paths.ts";

type TenantData = {
  tenantId: string;
  defaultBookSetId: string;
  seedAccountIds: { assets: string; cash: string; liabilities: string; equity: string; income: string; expenses: string };
};

function envelope<T>(tenantId: string, bookSetId: string, payload: T) {
  return { schemaVersion: 1 as const, tenantId: tenantId as any, bookSetId: bookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN" as const, id: "status-test" }, source: "INTERNAL" as const, reason: "company status test", payload };
}

describe("company.status", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function fixture() {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-company-status-"));
    const dbPath = join(directory, "books.sqlite");
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    return { app, dbPath };
  }

  async function activeTenant(app: Awaited<ReturnType<typeof initializeAndUpgradeSqliteApplication>>, name: string, kind: "COMPANY" | "INDIVIDUAL" = "COMPANY"): Promise<TenantData> {
    const created = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "status-test" }, source: "INTERNAL", reason: "create status tenant", payload: { kind, name } });
    const data = JSON.parse(created.resultJson) as TenantData;
    await app.tenant.activate({ schemaVersion: 1, tenantId: data.tenantId as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "status-test" }, source: "INTERNAL", reason: "activate status tenant", payload: { defaultBookSetId: data.defaultBookSetId as any } });
    return data;
  }

  it("auto-selects one active tenant and reports balanced ledger, drafts, overdue amounts, and deterministic drill-downs", async () => {
    const { app } = await fixture();
    const tenant = await activeTenant(app, "Status Co");
    const customer = JSON.parse((await app.party.create(envelope(tenant.tenantId, tenant.defaultBookSetId, { displayName: "Customer", role: "CUSTOMER" }))).resultJson).partyId as string;
    const vendor = JSON.parse((await app.party.create(envelope(tenant.tenantId, tenant.defaultBookSetId, { displayName: "Vendor", role: "VENDOR" }))).resultJson).partyId as string;
    const draftInvoice = await app.invoice.create(envelope(tenant.tenantId, tenant.defaultBookSetId, { invoiceNumber: "DRAFT-1", customerId: customer, issueDate: "2026-08-01", dueDate: "2026-08-10", lines: [{ description: "Draft", revenueAccountId: tenant.seedAccountIds.income, amountMinor: 500 }] }));
    expect(JSON.parse(draftInvoice.resultJson).status).toBe("DRAFT");
    const invoice = await app.invoice.create(envelope(tenant.tenantId, tenant.defaultBookSetId, { invoiceNumber: "POSTED-1", customerId: customer, issueDate: "2026-08-01", dueDate: "2026-08-10", lines: [{ description: "Sale", revenueAccountId: tenant.seedAccountIds.income, amountMinor: 1_000 }] }));
    await app.invoice.post(envelope(tenant.tenantId, tenant.defaultBookSetId, { invoiceId: JSON.parse(invoice.resultJson).invoiceId, receivableAccountId: tenant.seedAccountIds.assets }));
    const draftBill = await app.bill.create(envelope(tenant.tenantId, tenant.defaultBookSetId, { billNumber: "DRAFT-BILL", vendorId: vendor, billDate: "2026-08-01", dueDate: "2026-08-10", lines: [{ description: "Draft", expenseAccountId: tenant.seedAccountIds.expenses, amountMinor: 700 }] }));
    expect(JSON.parse(draftBill.resultJson).status).toBe("DRAFT");
    const bill = await app.bill.create(envelope(tenant.tenantId, tenant.defaultBookSetId, { billNumber: "POSTED-BILL", vendorId: vendor, billDate: "2026-08-01", dueDate: "2026-08-10", lines: [{ description: "Expense", expenseAccountId: tenant.seedAccountIds.expenses, amountMinor: 2_000 }] }));
    await app.bill.post(envelope(tenant.tenantId, tenant.defaultBookSetId, { billId: JSON.parse(bill.resultJson).billId, payableAccountId: tenant.seedAccountIds.liabilities }));

    const result = await app.company.status({ asOfDate: "2026-08-23" });
    expect(result.selectedTenant.tenantId).toBe(tenant.tenantId);
    expect(result.summaries).toHaveLength(1);
    const summary = result.summaries[0]!;
    expect(summary.ledger.isBalanced).toBe(true);
    expect(summary.receivables).toMatchObject({ count: 1, totalMinor: 1_000, overdue: { count: 1, amountMinor: 1_000 } });
    expect(summary.payables).toMatchObject({ count: 1, totalMinor: 2_000, overdue: { count: 1, amountMinor: 2_000 } });
    expect(summary.drafts).toEqual({ invoiceCount: 1, billCount: 1 });
    expect(summary.cashBank).toEqual({ status: "UNAVAILABLE", reason: "ACCOUNT_CLASSIFICATION_UNAVAILABLE" });
    expect(result.issues.map((issue) => issue.code)).toEqual(["PAYABLES_OVERDUE", "RECEIVABLES_OVERDUE", "CASH_BANK_UNAVAILABLE"]);
    expect(result.drillDown.map((entry) => entry.operationId)).toEqual([
      "ledger.trial-balance", "ledger.balance-sheet", "ledger.profit-and-loss", "invoice.outstanding", "bill.outstanding", "bank-statement.list", "gst.registration.list", "asset.register.report", "asset.depreciation.report", "asset.tax.report", "payroll.register", "payroll.payslip.list", "expense.claim.list", "expense.open-items", "expense.evidence-exceptions",
    ]);
  });

  it("summarizes multiple active tenants with masked identifiers without mutation", async () => {
    const { app } = await fixture();
    const first = await activeTenant(app, "First");
    const second = await activeTenant(app, "Second");
    const result = await app.company.status({ asOfDate: "2026-08-23", asOfTimestamp: "2026-08-23T12:00:00.000Z" });
    expect(result.statusVersion).toBe(2);
    expect(result.scope.global).toBe(true);
    expect(result.tenants).toHaveLength(2);
    expect(result.tenants.map((tenant) => tenant.tenantId)).not.toContain(first.tenantId);
    expect(result.tenants.map((tenant) => tenant.tenantId)).not.toContain(second.tenantId);
    expect(result.cards.map((card) => card.id)).toEqual(expect.arrayContaining(["database", "tenant-bookset", "journal-reports", "gst", "personal-tax", "skills", "remote-mcp"]));
    expect(result.cards.every((card) => card.asOfTimestamp === "2026-08-23T12:00:00.000Z")).toBe(true);
  });

  it("keeps multiple BookSets separate and reports an unreconciled latest bank statement", async () => {
    const { app } = await fixture();
    const tenant = await activeTenant(app, "Books Co", "INDIVIDUAL");
    const second = await app.bookSet.create({ schemaVersion: 1, tenantId: tenant.tenantId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "status-test" }, source: "INTERNAL", reason: "second books", payload: { kind: "PROPRIETORSHIP", displayName: "Second Books" } });
    const secondBookSetId = JSON.parse(second.resultJson).bookSetId as string;
    await app.bankStatement.import(envelope(tenant.tenantId, tenant.defaultBookSetId, { bankAccountId: tenant.seedAccountIds.cash, externalStatementId: "statement-1", periodStart: "2026-08-01", periodEnd: "2026-08-23", openingBalanceMinor: 0, closingBalanceMinor: 1_000, rows: [{ lineNumber: 1, transactionDate: "2026-08-10", description: "Unmatched", signedAmountMinor: 1_000 }] }));
    const result = await app.company.status({ tenantId: tenant.tenantId as any, asOfDate: "2026-08-23" });
    expect(result.summaries.map((summary) => summary.bookSet.bookSetId)).toEqual([tenant.defaultBookSetId, secondBookSetId].sort());
    const first = result.summaries.find((summary) => summary.bookSet.bookSetId === tenant.defaultBookSetId)!;
    expect(first.bankReconciliation.latestByBankAccount[0]).toMatchObject({ matchedCount: 0, unmatchedCount: 1, isReconciled: false });
    expect(result.issues.some((issue) => issue.code === "BANK_RECONCILIATION_REVIEW")).toBe(true);
    expect(result.summaries.find((summary) => summary.bookSet.bookSetId === secondBookSetId)!.bankReconciliation.latestByBankAccount).toEqual([]);
  });

  it("surfaces applicable GST activity and pending ITC review risk without filing claims", async () => {
    const { app } = await fixture();
    const tenant = await activeTenant(app, "GST Status Co");
    const vendor = JSON.parse((await app.party.create(envelope(tenant.tenantId, tenant.defaultBookSetId, { displayName: "GST Vendor", role: "VENDOR" }))).resultJson).partyId as string;
    const registration = await app.gst.registration.create({ schemaVersion: 1, tenantId: tenant.tenantId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "status-test" }, source: "INTERNAL", reason: "status GST registration", payload: { gstin: "27AAPFU0939F1ZV", effectiveFrom: "2026-01-01" } });
    const registrationId = JSON.parse(registration.resultJson).registrationId as string;
    const profile = await app.gst.partyProfile.create(envelope(tenant.tenantId, tenant.defaultBookSetId, { partyId: vendor, gstin: "27AAPFU0939F1ZV", treatment: "REGISTERED", stateCode: "27", effectiveFrom: "2026-01-01" }));
    const profileId = JSON.parse(profile.resultJson).profileId as string;
    const bill = await app.bill.create(envelope(tenant.tenantId, tenant.defaultBookSetId, {
      billNumber: "GST-PENDING",
      vendorId: vendor,
      billDate: "2026-08-01",
      lines: [{ description: "Taxable purchase", expenseAccountId: tenant.seedAccountIds.expenses, amountMinor: 10_000 }],
      gst: { buyerRegistrationId: registrationId, buyerGstin: "27AAPFU0939F1ZV", sellerProfileId: profileId, sellerGstin: "27AAPFU0939F1ZV", localComponent: "SGST", itcTreatment: "PENDING_REVIEW", lines: [{ lineNumber: 1, classification: "9983", rateBps: 1800, evidenceIds: ["evidence-1"] }] },
    }));
    await app.bill.post(envelope(tenant.tenantId, tenant.defaultBookSetId, { billId: JSON.parse(bill.resultJson).billId, payableAccountId: tenant.seedAccountIds.liabilities }));
    const summary = (await app.company.status({ tenantId: tenant.tenantId as any, asOfDate: "2026-08-23" })).summaries[0]!;
    expect(summary.gst.registrationsApplicableAsOf.count).toBe(1);
    expect(summary.gst.postedPurchaseActivity).toEqual({ count: 1, taxMinor: 1_800 });
    expect(summary.gst.pendingReviewItc).toEqual({ count: 1, amountMinor: 1_800, risk: "REVIEW_REQUIRED" });
  });

  it("supports deterministic card focus and rejects unknown focus without mutation", async () => {
    const { app } = await fixture();
    const tenant = await activeTenant(app, "Focused Status Co");
    const focused = await app.company.status({ tenantId: tenant.tenantId as any, bookSetId: tenant.defaultBookSetId as any, asOfDate: "2026-08-23", asOfTimestamp: "2026-08-23T12:00:00.000Z", focus: "unreconciled-bank" });
    expect(focused.cards).toHaveLength(1);
    expect(focused.cards[0]).toMatchObject({ id: "bank", asOfDate: "2026-08-23", asOfTimestamp: "2026-08-23T12:00:00.000Z" });
    expect(focused.cards[0]!.drillDowns.every((drilldown) => ["company.status", "database.compatibility", "bank-statement.list", "bank-reconciliation.status"].includes(drilldown.operationId))).toBe(true);
    await expect(app.company.status({ tenantId: tenant.tenantId as any, asOfDate: "2026-08-23", focus: "not-a-card" })).rejects.toMatchObject({ code: "INVALID_STATUS_FOCUS" });
  });

  it("reports a verified canonical local backup as healthy", async () => {
    const { app, dbPath } = await fixture();
    await activeTenant(app, "Verified Backup Co");
    const backupDirectory = defaultBackupDirectory(dbPath);
    await mkdir(backupDirectory, { recursive: true });
    const backupPath = join(backupDirectory, "company-status.backup");
    await new BackupService(dbPath).createBackup(backupPath);

    const result = await app.company.status({ asOfDate: "2026-08-23" });
    const database = result.cards.find((card) => card.id === "database")!;
    expect(database).toMatchObject({ status: "HEALTHY", counts: { latestVerifiedBackup: 1, backupCandidates: 1, verifiedBackups: 1 }, actionCodes: [], blockerCodes: [] });
    expect(JSON.stringify(result)).not.toContain(dbPath);
  });

  it("blocks status when a canonical local backup candidate is tampered", async () => {
    const { app, dbPath } = await fixture();
    await activeTenant(app, "Tampered Backup Co");
    const backupDirectory = defaultBackupDirectory(dbPath);
    await mkdir(backupDirectory, { recursive: true });
    const backupPath = join(backupDirectory, "company-status.backup");
    await new BackupService(dbPath).createBackup(backupPath);
    const tampered = await readFile(backupPath);
    tampered[100] = (tampered[100] ?? 0) ^ 0xff;
    await writeFile(backupPath, tampered);

    const result = await app.company.status({ asOfDate: "2026-08-23" });
    const database = result.cards.find((card) => card.id === "database")!;
    expect(database).toMatchObject({ status: "BLOCKED", counts: { latestVerifiedBackup: 0, backupCandidates: 1, verifiedBackups: 0 }, blockerCodes: ["BACKUP_VERIFICATION_FAILED"] });
    expect(result.overallStatus).toBe("BLOCKED");
    expect(result.overallReadiness).toBe("BLOCKED");
    expect(JSON.stringify(result)).not.toContain(dbPath);
  });

  it("keeps status unknown when no canonical local backup candidate exists", async () => {
    const { app, dbPath } = await fixture();
    await activeTenant(app, "No Backup Co");
    const result = await app.company.status({ asOfDate: "2026-08-23" });
    const database = result.cards.find((card) => card.id === "database")!;
    expect(database).toMatchObject({ status: "UNKNOWN", counts: { latestVerifiedBackup: 0, backupCandidates: 0, verifiedBackups: 0 }, actionCodes: ["BACKUP_STATUS_UNAVAILABLE"], blockerCodes: [] });
    expect(result.overallStatus).toBe("UNKNOWN");
    expect(JSON.stringify(result)).not.toContain(dbPath);
  });
});
