import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database as BunDatabase } from "bun:sqlite";
import { bootstrapSqliteApplication } from "../../src/application/application.ts";

function envelope<T>(tenantId: string, bookSetId: string, payload: T, requestId: string = randomUUID()) {
  return {
    schemaVersion: 1 as const,
    tenantId: tenantId as any,
    bookSetId: bookSetId as any,
    requestId,
    actor: { kind: "HUMAN" as const, id: "owner" },
    source: "CLI" as const,
    reason: "purchase slice test",
    payload,
  };
}

describe("vendor bill and payment vertical slice", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("creates, posts, partially pays, settles, and reports a vendor bill", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-purchase-"));
    const dbPath = join(directory, "books.sqlite");
    const app = await bootstrapSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenantResult = await app.tenant.create({
      schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "Purchase Co", baseCurrency: "INR" },
    });
    const created = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { cash: string; equity: string; expenses: string; liabilities: string } };
    const vendorResult = await app.party.create(envelope(created.tenantId, created.defaultBookSetId, { displayName: "Acme Vendor", role: "VENDOR" }));
    const vendorId = JSON.parse(vendorResult.resultJson).partyId as string;

    await app.journal.post(envelope(created.tenantId, created.defaultBookSetId, {
      postingDate: "2026-08-23",
      lines: [{ accountId: created.seedAccountIds.cash, debitMinor: 100_000 }, { accountId: created.seedAccountIds.equity, creditMinor: 100_000 }],
    }) as any);
    const billResult = await app.bill.create(envelope(created.tenantId, created.defaultBookSetId, {
      billNumber: "BILL-001", vendorId, billDate: "2026-08-23", dueDate: "2026-09-22", narration: "Office supplies",
      lines: [{ description: "Supplies", expenseAccountId: created.seedAccountIds.expenses, amountMinor: 50_000 }],
    }));
    const billId = JSON.parse(billResult.resultJson).billId as string;
    const posted = await app.bill.post(envelope(created.tenantId, created.defaultBookSetId, { billId, payableAccountId: created.seedAccountIds.liabilities }));
    expect(JSON.parse(posted.resultJson)).toMatchObject({ billId, totalMinor: 50_000, status: "POSTED" });
    expect(await app.bill.get(created.tenantId as any, created.defaultBookSetId as any, billId)).toMatchObject({ billNumber: "BILL-001", totalMinor: 50_000, paidMinor: 0, outstandingMinor: 50_000, status: "POSTED" });

    const pnlAfterBill = await app.ledger.profitAndLoss(created.tenantId as any, created.defaultBookSetId as any, "2026-01-01", "2026-08-23");
    expect(pnlAfterBill.expenseMinor).toBe(50_000);
    expect(pnlAfterBill.netProfitLossMinor).toBe(-50_000);
    const bsAfterBill = await app.ledger.balanceSheet(created.tenantId as any, created.defaultBookSetId as any, "2026-08-23");
    expect(bsAfterBill.liabilities.find((row) => row.accountId === created.seedAccountIds.liabilities)?.balanceMinor).toBe(50_000);
    expect(bsAfterBill.isBalanced).toBe(true);

    const firstPayment = await app.vendorPayment.record(envelope(created.tenantId, created.defaultBookSetId, { vendorId, paymentDate: "2026-08-23", bankAccountId: created.seedAccountIds.cash, reference: "PAY-001", allocations: [{ billId, amountMinor: 20_000 }] }));
    expect(JSON.parse(firstPayment.resultJson).amountMinor).toBe(20_000);
    expect(await app.bill.get(created.tenantId as any, created.defaultBookSetId as any, billId)).toMatchObject({ paidMinor: 20_000, outstandingMinor: 30_000, status: "PARTIALLY_PAID" });
    expect((await app.bill.outstanding(created.tenantId as any, created.defaultBookSetId as any)).map((bill) => bill.billNumber)).toEqual(["BILL-001"]);

    await app.vendorPayment.record(envelope(created.tenantId, created.defaultBookSetId, { vendorId, paymentDate: "2026-08-23", bankAccountId: created.seedAccountIds.cash, reference: "PAY-002", allocations: [{ billId, amountMinor: 30_000 }] }));
    expect(await app.bill.get(created.tenantId as any, created.defaultBookSetId as any, billId)).toMatchObject({ paidMinor: 50_000, outstandingMinor: 0, status: "PAID" });
    expect(await app.bill.outstanding(created.tenantId as any, created.defaultBookSetId as any)).toEqual([]);

    const trialBalance = await app.ledger.trialBalance(created.tenantId as any, created.defaultBookSetId as any, "2026-08-23");
    expect(trialBalance.isBalanced).toBe(true);
    const pnl = await app.ledger.profitAndLoss(created.tenantId as any, created.defaultBookSetId as any, "2026-01-01", "2026-08-23");
    expect(pnl.expenseMinor).toBe(50_000);
    const balanceSheet = await app.ledger.balanceSheet(created.tenantId as any, created.defaultBookSetId as any, "2026-08-23");
    expect(balanceSheet.liabilities.find((row) => row.accountId === created.seedAccountIds.liabilities)?.balanceMinor).toBe(0);
    expect(balanceSheet.assets.find((row) => row.accountId === created.seedAccountIds.cash)?.balanceMinor).toBe(50_000);
    expect(balanceSheet.isBalanced).toBe(true);
  });

  it("rejects wrong classes, scope/vendor mismatches, over-allocation, and conflicting replays without purchase mutations", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-purchase-reject-"));
    const dbPath = join(directory, "books.sqlite");
    const app = await bootstrapSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenantResult = await app.tenant.create({
      schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "INDIVIDUAL", name: "Purchase Reject Co" },
    });
    const data = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { cash: string; equity: string; expenses: string; liabilities: string; income: string } };
    const vendorResult = await app.party.create(envelope(data.tenantId, data.defaultBookSetId, { displayName: "Reject Vendor", role: "VENDOR" }));
    const vendorId = JSON.parse(vendorResult.resultJson).partyId as string;
    const secondBookSetResult = await app.bookSet.create({ schemaVersion: 1, tenantId: data.tenantId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "second book set", payload: { kind: "PROPRIETORSHIP", displayName: "Other books" } });
    const secondBookSetId = JSON.parse(secondBookSetResult.resultJson).bookSetId as string;
    const otherVendorResult = await app.party.create(envelope(data.tenantId, secondBookSetId, { displayName: "Other Vendor", role: "VENDOR" }));
    const otherVendorId = JSON.parse(otherVendorResult.resultJson).partyId as string;

    const wrongScopeBill = envelope(data.tenantId, data.defaultBookSetId, { billNumber: "BILL-SCOPE", vendorId: otherVendorId, billDate: "2026-08-23", lines: [{ description: "Bad scope", expenseAccountId: data.seedAccountIds.expenses, amountMinor: 1_000 }] });
    await expect(app.bill.create(wrongScopeBill)).rejects.toMatchObject({ code: "VENDOR_SCOPE_MISMATCH" });
    const billResult = await app.bill.create(envelope(data.tenantId, data.defaultBookSetId, { billNumber: "BILL-R", vendorId, billDate: "2026-08-23", lines: [{ description: "Expense", expenseAccountId: data.seedAccountIds.expenses, amountMinor: 10_000 }] }));
    const billId = JSON.parse(billResult.resultJson).billId as string;
    const badPost = envelope(data.tenantId, data.defaultBookSetId, { billId, payableAccountId: data.seedAccountIds.income });
    await expect(app.bill.post(badPost)).rejects.toMatchObject({ code: "INVALID_ACCOUNT_CLASS" });
    expect((await app.bill.get(data.tenantId as any, data.defaultBookSetId as any, billId)).status).toBe("DRAFT");
    const nativeBefore = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
    expect(nativeBefore.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual({ count: 0n });
    expect(nativeBefore.query("SELECT COUNT(*) AS count FROM vendor_payments").get()).toEqual({ count: 0n });
    nativeBefore.close();

    const postCommand = envelope(data.tenantId, data.defaultBookSetId, { billId, payableAccountId: data.seedAccountIds.liabilities });
    const post = await app.bill.post(postCommand);
    const postReplay = await app.bill.post(postCommand);
    expect(postReplay.replayed).toBe(true);
    expect(postReplay.resultJson).toBe(post.resultJson);
    const over = envelope(data.tenantId, data.defaultBookSetId, { vendorId, paymentDate: "2026-08-23", bankAccountId: data.seedAccountIds.cash, allocations: [{ billId, amountMinor: 10_001 }] });
    await expect(app.vendorPayment.record(over)).rejects.toMatchObject({ code: "OVER_ALLOCATION" });
    const wrongVendor = envelope(data.tenantId, data.defaultBookSetId, { vendorId: otherVendorId, paymentDate: "2026-08-23", bankAccountId: data.seedAccountIds.cash, allocations: [{ billId, amountMinor: 1_000 }] });
    await expect(app.vendorPayment.record(wrongVendor)).rejects.toMatchObject({ code: "VENDOR_SCOPE_MISMATCH" });

    const payment = envelope(data.tenantId, data.defaultBookSetId, { vendorId, paymentDate: "2026-08-23", bankAccountId: data.seedAccountIds.cash, allocations: [{ billId, amountMinor: 4_000 }] }, "payment-replay");
    const first = await app.vendorPayment.record(payment);
    const replay = await app.vendorPayment.record(payment);
    expect(replay.replayed).toBe(true);
    expect(replay.resultJson).toBe(first.resultJson);
    const conflict = { ...payment, payload: { ...payment.payload, allocations: [{ billId, amountMinor: 3_000 }] } };
    await expect(app.vendorPayment.record(conflict)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await app.bill.get(data.tenantId as any, data.defaultBookSetId as any, billId)).toMatchObject({ paidMinor: 4_000, outstandingMinor: 6_000, status: "PARTIALLY_PAID" });

    const native = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
    expect(native.query("SELECT COUNT(*) AS count FROM vendor_payments").get()).toEqual({ count: 1n });
    expect(native.query("SELECT COUNT(*) AS count FROM audit_records WHERE command = 'vendorPayment.record'").get()).toEqual({ count: 1n });
    expect(native.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual({ count: 2n });
    native.close();
  });
});
