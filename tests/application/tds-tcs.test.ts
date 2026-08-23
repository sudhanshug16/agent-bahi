import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database as BunDatabase } from "bun:sqlite";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";

function scoped<T>(tenantId: string, bookSetId: string, payload: T, requestId = randomUUID()) {
  return { schemaVersion: 1 as const, tenantId: tenantId as any, bookSetId: bookSetId as any, requestId, actor: { kind: "HUMAN" as const, id: "owner" }, source: "CLI" as const, reason: "TDS/TCS test", payload };
}
function tenant<T>(tenantId: string, payload: T) {
  return { schemaVersion: 1 as const, tenantId: tenantId as any, requestId: randomUUID(), actor: { kind: "HUMAN" as const, id: "owner" }, source: "CLI" as const, reason: "TDS/TCS test", payload };
}

describe("non-payroll TDS/TCS V1", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it("posts a source-verified TDS bill, preserves vendor outstanding, deposits, and registers", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-tds-"));
    const dbPath = join(directory, "books.sqlite");
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenantResult = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "TDS Co", baseCurrency: "INR" } });
    const data = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { expenses: string; liabilities: string; cash: string } };
    const vendor = JSON.parse((await app.party.create(scoped(data.tenantId, data.defaultBookSetId, { displayName: "Vendor", role: "VENDOR" }))).resultJson) as { partyId: string };
    const rule = JSON.parse((await app.tax.ruleSnapshot.create(tenant(data.tenantId, { taxKind: "TDS", sourceUrl: "https://www.incometaxindia.gov.in/w/section-393-5", sourceDocument: "Income-tax Act 2025", sourceVersion: "2026-04-01", sectionReference: "393", categoryCode: "TEST", effectiveFrom: "2026-04-01", eventTiming: "CREDIT", rateBps: 1000, applicabilityFacts: { source: "fixture" }, tanRequired: true, tanExceptionAllowed: false, statementRoute: "REVIEW_ONLY", statementForm: "NOT_CLAIMED", roundingMode: "HALF_UP", sourceVerified: true }))).resultJson) as { ruleSnapshotId: string };
    const bill = JSON.parse((await app.bill.create(scoped(data.tenantId, data.defaultBookSetId, { billNumber: "TDS-1", vendorId: vendor.partyId, billDate: "2026-08-23", lines: [{ description: "Services", expenseAccountId: data.seedAccountIds.expenses, amountMinor: 100_000 }] }))).resultJson) as { billId: string };
    const posted = JSON.parse((await app.bill.post(scoped(data.tenantId, data.defaultBookSetId, { billId: bill.billId, payableAccountId: data.seedAccountIds.liabilities, withholding: { taxKind: "TDS", ruleSnapshotId: rule.ruleSnapshotId, taxBaseMinor: 100_000, thresholdApplicabilityEvidenceReferences: ["evidence:tds-test"], liabilityAccountId: data.seedAccountIds.liabilities, calculationFacts: { roundingMode: "HALF_UP", basis: "credit" } } }))).resultJson) as { totalMinor: number };
    expect(posted.totalMinor).toBe(100_000);
    expect(await app.bill.get(data.tenantId as any, data.defaultBookSetId as any, bill.billId)).toMatchObject({ totalMinor: 100_000, outstandingMinor: 90_000, paidMinor: 0 });
    await app.vendorPayment.record(scoped(data.tenantId, data.defaultBookSetId, { vendorId: vendor.partyId, paymentDate: "2026-08-23", bankAccountId: data.seedAccountIds.cash, allocations: [{ billId: bill.billId, amountMinor: 90_000 }] }));
    expect(await app.bill.get(data.tenantId as any, data.defaultBookSetId as any, bill.billId)).toMatchObject({ outstandingMinor: 0, status: "PAID" });
    expect(await app.bill.outstanding(data.tenantId as any, data.defaultBookSetId as any)).toEqual([]);
    const native = new BunDatabase(dbPath);
    expect(() => native.query("UPDATE vendor_bills SET status = 'POSTED' WHERE id = ?").run(bill.billId)).toThrow();
    native.close();
    const registerBefore = await app.tax.register(data.tenantId as any, data.defaultBookSetId as any, "TDS");
    expect(registerBefore).toMatchObject([{ taxAmountMinor: 10_000, depositedMinor: 0, outstandingMinor: 10_000 }]);
    await app.tax.deposit(scoped(data.tenantId, data.defaultBookSetId, { taxKind: "TDS", liabilityAccountId: data.seedAccountIds.liabilities, bankAccountId: data.seedAccountIds.cash, depositDate: "2026-08-23", amountMinor: 10_000, allocations: [{ eventId: registerBefore[0]!.eventId, amountMinor: 10_000 }], cin: "CIN-1", evidenceReference: "evidence:challan" }));
    expect((await app.tax.register(data.tenantId as any, data.defaultBookSetId as any, "TDS"))[0]!.outstandingMinor).toBe(0);
    expect((await app.ledger.trialBalance(data.tenantId as any, data.defaultBookSetId as any, "2026-08-23")).isBalanced).toBe(true);
  });

  it("fails closed for unverified, ineffective, and payment-only rules before posting", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-tds-gates-"));
    const app = await initializeAndUpgradeSqliteApplication(join(directory, "books.sqlite"), { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenantResult = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "Gates Co" } });
    const data = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { expenses: string; liabilities: string } };
    const vendor = JSON.parse((await app.party.create(scoped(data.tenantId, data.defaultBookSetId, { displayName: "Vendor", role: "VENDOR" }))).resultJson) as { partyId: string };
    const rule = JSON.parse((await app.tax.ruleSnapshot.create(tenant(data.tenantId, { taxKind: "TDS", sourceUrl: "https://example.invalid/rule", sourceDocument: "Review source", sourceVersion: "2026", sectionReference: "393", categoryCode: "TEST", effectiveFrom: "2027-01-01", eventTiming: "PAYMENT", rateBps: 1000, applicabilityFacts: {}, tanRequired: true, tanExceptionAllowed: false, statementRoute: "REVIEW_ONLY", statementForm: "NOT_CLAIMED", roundingMode: "HALF_UP", sourceVerified: false }))).resultJson) as { ruleSnapshotId: string };
    const bill = JSON.parse((await app.bill.create(scoped(data.tenantId, data.defaultBookSetId, { billNumber: "GATE-1", vendorId: vendor.partyId, billDate: "2026-08-23", lines: [{ description: "Services", expenseAccountId: data.seedAccountIds.expenses, amountMinor: 1_000 }] }))).resultJson) as { billId: string };
    await expect(app.bill.post(scoped(data.tenantId, data.defaultBookSetId, { billId: bill.billId, payableAccountId: data.seedAccountIds.liabilities, withholding: { taxKind: "TDS", ruleSnapshotId: rule.ruleSnapshotId, taxBaseMinor: 1_000, thresholdApplicabilityEvidenceReferences: ["evidence:gate"], liabilityAccountId: data.seedAccountIds.liabilities, calculationFacts: {} } }))).rejects.toMatchObject({ code: "TAX_RULE_UNVERIFIED" });
    expect((await app.bill.get(data.tenantId as any, data.defaultBookSetId as any, bill.billId)).status).toBe("DRAFT");
  });

  it("posts a source-verified TCS invoice with customer collection and a balanced register", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-tcs-"));
    const app = await initializeAndUpgradeSqliteApplication(join(directory, "books.sqlite"), { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenantResult = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "TCS Co" } });
    const data = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { assets: string; income: string; liabilities: string; cash: string } };
    const customer = JSON.parse((await app.party.create(scoped(data.tenantId, data.defaultBookSetId, { displayName: "Customer", role: "CUSTOMER" }))).resultJson) as { partyId: string };
    const rule = JSON.parse((await app.tax.ruleSnapshot.create(tenant(data.tenantId, { taxKind: "TCS", sourceUrl: "https://www.incometaxindia.gov.in/w/section-397-5", sourceDocument: "Income-tax Act 2025", sourceVersion: "2026-04-01", sectionReference: "397", categoryCode: "TEST", effectiveFrom: "2026-04-01", eventTiming: "CREDIT", rateBps: 500, applicabilityFacts: { source: "fixture" }, tanRequired: true, tanExceptionAllowed: false, statementRoute: "REVIEW_ONLY", statementForm: "NOT_CLAIMED", roundingMode: "HALF_UP", sourceVerified: true }))).resultJson) as { ruleSnapshotId: string };
    const invoice = JSON.parse((await app.invoice.create(scoped(data.tenantId, data.defaultBookSetId, { invoiceNumber: "TCS-1", customerId: customer.partyId, issueDate: "2026-08-23", lines: [{ description: "Collection", revenueAccountId: data.seedAccountIds.income, amountMinor: 100_000 }] }))).resultJson) as { invoiceId: string };
    const posted = JSON.parse((await app.invoice.post(scoped(data.tenantId, data.defaultBookSetId, { invoiceId: invoice.invoiceId, receivableAccountId: data.seedAccountIds.assets, withholding: { taxKind: "TCS", ruleSnapshotId: rule.ruleSnapshotId, taxBaseMinor: 100_000, thresholdApplicabilityEvidenceReferences: ["evidence:tcs-test"], liabilityAccountId: data.seedAccountIds.liabilities, calculationFacts: { roundingMode: "HALF_UP", basis: "credit" } } }))).resultJson) as { totalMinor: number };
    expect(posted.totalMinor).toBe(105_000);
    expect(await app.invoice.get(data.tenantId as any, data.defaultBookSetId as any, invoice.invoiceId)).toMatchObject({ totalMinor: 105_000, outstandingMinor: 105_000 });
    const register = await app.tax.register(data.tenantId as any, data.defaultBookSetId as any, "TCS");
    expect(register).toMatchObject([{ taxAmountMinor: 5_000, depositedMinor: 0, outstandingMinor: 5_000, documentType: "SALE" }]);
    await app.tax.deposit(scoped(data.tenantId, data.defaultBookSetId, { taxKind: "TCS", liabilityAccountId: data.seedAccountIds.liabilities, bankAccountId: data.seedAccountIds.cash, depositDate: "2026-08-23", amountMinor: 5_000, allocations: [{ eventId: register[0]!.eventId, amountMinor: 5_000 }], cin: "CIN-TCS-1", evidenceReference: "evidence:tcs-challan" }));
    expect((await app.tax.register(data.tenantId as any, data.defaultBookSetId as any, "TCS"))[0]!.outstandingMinor).toBe(0);
    expect((await app.ledger.trialBalance(data.tenantId as any, data.defaultBookSetId as any, "2026-08-23")).isBalanced).toBe(true);
  });

  it("validates and masks effective-dated PAN/TAN profiles", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-tax-profiles-"));
    const app = await initializeAndUpgradeSqliteApplication(join(directory, "books.sqlite"), { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenantResult = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "Profile Co" } });
    const data = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string };
    const party = JSON.parse((await app.party.create(scoped(data.tenantId, data.defaultBookSetId, { displayName: "Profile Party", role: "VENDOR" }))).resultJson) as { partyId: string };
    await app.tax.deductorProfile.create(tenant(data.tenantId, { pan: "ABCDE1234F", tan: "ABCD12345E", verificationStatus: "VERIFIED", evidenceReference: "evidence:deductor", effectiveFrom: "2026-04-01" }));
    await app.tax.partyProfile.create(scoped(data.tenantId, data.defaultBookSetId, { partyId: party.partyId, residency: "RESIDENT", pan: "PQRSX9876L", verificationStatus: "VERIFIED", evidenceReference: "evidence:party", effectiveFrom: "2026-04-01" }));
    expect(await app.tax.deductorProfile.list(data.tenantId as any, "2026-08-23")).toMatchObject([{ pan: "****234F", tan: "****345E", verificationStatus: "VERIFIED" }]);
    expect(await app.tax.partyProfile.list(data.tenantId as any, data.defaultBookSetId as any, party.partyId, "2026-08-23")).toMatchObject([{ pan: "****876L", verificationStatus: "VERIFIED" }]);
    await expect(app.tax.deductorProfile.create(tenant(data.tenantId, { pan: "ABCDE1234", effectiveFrom: "2027-01-01" }))).rejects.toMatchObject({ code: "INVALID_PAN" });
    await expect(app.tax.deductorProfile.create(tenant(data.tenantId, { effectiveFrom: "2026-06-01" }))).rejects.toBeDefined();
  });

  it("uses paid plus withholding for partial, fully withheld, and company payable settlement", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-tds-settlement-"));
    const app = await initializeAndUpgradeSqliteApplication(join(directory, "books.sqlite"), { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenantResult = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "Settlement Co" } });
    const data = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { expenses: string; liabilities: string; cash: string } };
    await app.tenant.activate({ schemaVersion: 1, tenantId: data.tenantId as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "activate tenant", payload: { defaultBookSetId: data.defaultBookSetId as any } });
    const vendor = JSON.parse((await app.party.create(scoped(data.tenantId, data.defaultBookSetId, { displayName: "Settlement Vendor", role: "VENDOR" }))).resultJson) as { partyId: string };
    const rule = JSON.parse((await app.tax.ruleSnapshot.create(tenant(data.tenantId, { taxKind: "TDS", sourceUrl: "https://www.incometaxindia.gov.in/w/section-393-5", sourceDocument: "Income-tax Act 2025", sourceVersion: "2026-04-01", sectionReference: "393", categoryCode: "PARTIAL", effectiveFrom: "2026-04-01", eventTiming: "CREDIT", rateBps: 1000, applicabilityFacts: { source: "fixture" }, tanRequired: true, tanExceptionAllowed: false, statementRoute: "REVIEW_ONLY", statementForm: "NOT_CLAIMED", roundingMode: "HALF_UP", sourceVerified: true }))).resultJson) as { ruleSnapshotId: string };
    const fullRule = JSON.parse((await app.tax.ruleSnapshot.create(tenant(data.tenantId, { taxKind: "TDS", sourceUrl: "https://www.incometaxindia.gov.in/w/section-393-5", sourceDocument: "Income-tax Act 2025", sourceVersion: "2026-04-01", sectionReference: "393", categoryCode: "FULL", effectiveFrom: "2026-04-01", eventTiming: "CREDIT", rateBps: 10000, applicabilityFacts: { source: "fixture" }, tanRequired: true, tanExceptionAllowed: false, statementRoute: "REVIEW_ONLY", statementForm: "NOT_CLAIMED", roundingMode: "HALF_UP", sourceVerified: true }))).resultJson) as { ruleSnapshotId: string };
    const postBill = async (billNumber: string, ruleSnapshotId: string, taxBaseMinor = 100_000) => {
      const bill = JSON.parse((await app.bill.create(scoped(data.tenantId, data.defaultBookSetId, { billNumber, vendorId: vendor.partyId, billDate: "2026-08-23", dueDate: "2026-08-23", lines: [{ description: billNumber, expenseAccountId: data.seedAccountIds.expenses, amountMinor: taxBaseMinor }] }))).resultJson) as { billId: string };
      await app.bill.post(scoped(data.tenantId, data.defaultBookSetId, { billId: bill.billId, payableAccountId: data.seedAccountIds.liabilities, withholding: { taxKind: "TDS", ruleSnapshotId, taxBaseMinor, thresholdApplicabilityEvidenceReferences: [`evidence:${billNumber}`], liabilityAccountId: data.seedAccountIds.liabilities, calculationFacts: { roundingMode: "HALF_UP", basis: "credit" } } }));
      return bill.billId;
    };
    const partialBillId = await postBill("SETTLE-PARTIAL", rule.ruleSnapshotId);
    await app.vendorPayment.record(scoped(data.tenantId, data.defaultBookSetId, { vendorId: vendor.partyId, paymentDate: "2026-08-23", bankAccountId: data.seedAccountIds.cash, allocations: [{ billId: partialBillId, amountMinor: 80_000 }] }));
    expect(await app.bill.get(data.tenantId as any, data.defaultBookSetId as any, partialBillId)).toMatchObject({ status: "PARTIALLY_PAID", outstandingMinor: 10_000 });
    const fullyWithheldBillId = await postBill("SETTLE-FULL", fullRule.ruleSnapshotId);
    expect(await app.bill.get(data.tenantId as any, data.defaultBookSetId as any, fullyWithheldBillId)).toMatchObject({ status: "PAID", outstandingMinor: 0 });
    expect((await app.bill.outstanding(data.tenantId as any, data.defaultBookSetId as any)).map((bill) => bill.billId)).toEqual([partialBillId]);
    expect((await app.company.status({ tenantId: data.tenantId as any, bookSetId: data.defaultBookSetId as any, asOfDate: "2026-08-23" })).summaries[0]!.payables).toMatchObject({ count: 1, totalMinor: 10_000 });
    await app.vendorPayment.record(scoped(data.tenantId, data.defaultBookSetId, { vendorId: vendor.partyId, paymentDate: "2026-08-23", bankAccountId: data.seedAccountIds.cash, allocations: [{ billId: partialBillId, amountMinor: 10_000 }] }));
    expect(await app.bill.get(data.tenantId as any, data.defaultBookSetId as any, partialBillId)).toMatchObject({ status: "PAID", outstandingMinor: 0 });
    expect(await app.bill.outstanding(data.tenantId as any, data.defaultBookSetId as any)).toEqual([]);
    expect((await app.company.status({ tenantId: data.tenantId as any, bookSetId: data.defaultBookSetId as any, asOfDate: "2026-08-23" })).summaries[0]!.payables).toMatchObject({ count: 0, totalMinor: 0 });
  });
});
