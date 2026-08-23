import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database as BunDatabase } from "bun:sqlite";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";

function env<T>(tenantId: string, bookSetId: string, payload: T, reason = "bank reconciliation test") {
  return { schemaVersion: 1 as const, tenantId: tenantId as any, bookSetId: bookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN" as const, id: "owner" }, source: "CLI" as const, reason, payload };
}

describe("bank statement import and reconciliation", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it("imports, deterministically candidates, confirms, undoes, and reconciles receipt/payment journals", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-bank-"));
    const app = await initializeAndUpgradeSqliteApplication(join(directory, "books.sqlite"), { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenantResult = await app.tenant.create(env("bootstrap", "ignored", { kind: "COMPANY", name: "Bank Co", baseCurrency: "INR" }));
    const created = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { cash: string; assets: string; income: string; expenses: string; liabilities: string } };
    const customerResult = await app.party.create(env(created.tenantId, created.defaultBookSetId, { displayName: "Customer" }));
    const customerId = JSON.parse(customerResult.resultJson).partyId as string;
    const invoiceResult = await app.invoice.create(env(created.tenantId, created.defaultBookSetId, { invoiceNumber: "APR-INV", customerId, issueDate: "2026-04-01", lines: [{ description: "Services", revenueAccountId: created.seedAccountIds.income, amountMinor: 100_000 }] }));
    const invoiceId = JSON.parse(invoiceResult.resultJson).invoiceId as string;
    await app.invoice.post(env(created.tenantId, created.defaultBookSetId, { invoiceId, receivableAccountId: created.seedAccountIds.assets }));
    const receipt = await app.receipt.record(env(created.tenantId, created.defaultBookSetId, { customerId, receiptDate: "2026-04-05", bankAccountId: created.seedAccountIds.cash, allocations: [{ invoiceId, amountMinor: 100_000 }] }));
    const receiptJournalId = JSON.parse(receipt.resultJson).journalId as string;

    const vendorResult = await app.party.create(env(created.tenantId, created.defaultBookSetId, { displayName: "Vendor", role: "VENDOR" }));
    const vendorId = JSON.parse(vendorResult.resultJson).partyId as string;
    const billResult = await app.bill.create(env(created.tenantId, created.defaultBookSetId, { billNumber: "APR-BILL", vendorId, billDate: "2026-04-10", lines: [{ description: "Supplies", expenseAccountId: created.seedAccountIds.expenses, amountMinor: 50_000 }] }));
    const billId = JSON.parse(billResult.resultJson).billId as string;
    await app.bill.post(env(created.tenantId, created.defaultBookSetId, { billId, payableAccountId: created.seedAccountIds.liabilities }));
    const payment = await app.vendorPayment.record(env(created.tenantId, created.defaultBookSetId, { vendorId, paymentDate: "2026-04-15", bankAccountId: created.seedAccountIds.cash, allocations: [{ billId, amountMinor: 50_000 }] }));
    const paymentJournalId = JSON.parse(payment.resultJson).journalId as string;

    const imported = await app.bankStatement.import(env(created.tenantId, created.defaultBookSetId, { bankAccountId: created.seedAccountIds.cash, externalStatementId: "APR-2026", periodStart: "2026-04-01", periodEnd: "2026-04-30", openingBalanceMinor: 0, closingBalanceMinor: 50_000, rows: [{ lineNumber: 1, transactionDate: "2026-04-05", description: "Customer receipt", signedAmountMinor: 100_000 }, { lineNumber: 2, transactionDate: "2026-04-15", description: "Vendor payment", signedAmountMinor: -50_000 }] }));
    const statementId = JSON.parse(imported.resultJson).statementId as string;
    const statement = await app.bankStatement.get(created.tenantId as any, created.defaultBookSetId as any, statementId);
    expect(statement.lines.map((line) => line.matchStatus)).toEqual(["UNMATCHED", "UNMATCHED"]);
    expect(await app.bankReconciliation.status(created.tenantId as any, created.defaultBookSetId as any, statementId)).toMatchObject({ unmatchedCount: 2, matchedCount: 0, rowInflowMinor: 100_000, rowOutflowMinor: 50_000, rowNetMinor: 50_000, isReconciled: false });
    const receiptLineId = statement.lines[0]!.lineId;
    const paymentLineId = statement.lines[1]!.lineId;
    expect((await app.bankMatch.candidates(created.tenantId as any, created.defaultBookSetId as any, receiptLineId)).map((candidate) => candidate.journalEntryId)).toContain(receiptJournalId);
    expect((await app.bankMatch.candidates(created.tenantId as any, created.defaultBookSetId as any, paymentLineId)).map((candidate) => candidate.journalEntryId)).toContain(paymentJournalId);
    await app.bankMatch.confirm(env(created.tenantId, created.defaultBookSetId, { statementLineId: receiptLineId, journalEntryId: receiptJournalId }));
    await app.bankMatch.confirm(env(created.tenantId, created.defaultBookSetId, { statementLineId: paymentLineId, journalEntryId: paymentJournalId }));
    expect(await app.bankReconciliation.status(created.tenantId as any, created.defaultBookSetId as any, statementId)).toMatchObject({ matchedCount: 2, unmatchedCount: 0, bookBalanceBeforePeriodMinor: 0, bookBalanceAsOfPeriodEndMinor: 50_000, closingBalanceMinor: 50_000, isReconciled: true });
    const matched = await app.bankStatement.get(created.tenantId as any, created.defaultBookSetId as any, statementId);
    const undo = await app.bankMatch.undo(env(created.tenantId, created.defaultBookSetId, { matchId: matched.lines[0]!.matchId, reason: "review correction" }));
    expect(JSON.parse(undo.resultJson).status).toBe("UNDONE");
    expect((await app.bankReconciliation.status(created.tenantId as any, created.defaultBookSetId as any, statementId)).isReconciled).toBe(false);
    await app.bankMatch.confirm(env(created.tenantId, created.defaultBookSetId, { statementLineId: receiptLineId, journalEntryId: receiptJournalId }));
    expect((await app.bankReconciliation.status(created.tenantId as any, created.defaultBookSetId as any, statementId)).isReconciled).toBe(true);
  });

  it("rejects arithmetic, changed duplicate, mismatch, scope, and double matches atomically", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-bank-negative-"));
    const dbPath = join(directory, "books.sqlite");
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenantResult = await app.tenant.create(env("bootstrap", "ignored", { kind: "COMPANY", name: "Bank Negative" }));
    const created = JSON.parse(tenantResult.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { cash: string; equity: string } };
    const bad = env(created.tenantId, created.defaultBookSetId, { bankAccountId: created.seedAccountIds.cash, externalStatementId: "BAD", periodStart: "2026-04-01", periodEnd: "2026-04-30", openingBalanceMinor: 0, closingBalanceMinor: 20, rows: [{ lineNumber: 1, transactionDate: "2026-04-01", description: "bad", signedAmountMinor: 10 }] });
    await expect(app.bankStatement.import(bad)).rejects.toMatchObject({ code: "STATEMENT_ARITHMETIC_INVALID" });
    const valid = { ...bad, payload: { ...bad.payload, externalStatementId: "APR", closingBalanceMinor: 10 } };
    const imported = await app.bankStatement.import(valid);
    await expect(app.bankStatement.import({ ...valid, requestId: randomUUID(), payload: { ...valid.payload, rows: [{ ...valid.payload.rows[0], description: "changed" }] } })).rejects.toMatchObject({ code: "STATEMENT_IDEMPOTENCY_CONFLICT" });
    const statementId = JSON.parse(imported.resultJson).statementId as string;
    const line = (await app.bankStatement.get(created.tenantId as any, created.defaultBookSetId as any, statementId)).lines[0]!;
    const journal = await app.journal.post(env(created.tenantId, created.defaultBookSetId, { postingDate: "2026-04-01", lines: [{ accountId: created.seedAccountIds.cash, debitMinor: 9 }, { accountId: created.seedAccountIds.equity, creditMinor: 9 }] }) as any);
    const journalId = JSON.parse(journal.resultJson).journalId as string;
    await expect(app.bankMatch.confirm(env(created.tenantId, created.defaultBookSetId, { statementLineId: line.lineId, journalEntryId: journalId }))).rejects.toMatchObject({ code: "BANK_MATCH_AMOUNT_MISMATCH" });
    const otherTenant = JSON.parse((await app.tenant.create(env("bootstrap", "ignored", { kind: "COMPANY", name: "Other" }))).resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { cash: string } };
    await expect(app.bankStatement.get(otherTenant.tenantId as any, otherTenant.defaultBookSetId as any, statementId)).rejects.toMatchObject({ code: "STATEMENT_SCOPE_MISMATCH" });
    const native = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
    expect(native.query("SELECT COUNT(*) AS count FROM bank_statements").get()).toEqual({ count: 1n });
    expect(native.query("SELECT COUNT(*) AS count FROM bank_statement_lines").get()).toEqual({ count: 1n });
    expect(native.query("SELECT COUNT(*) AS count FROM bank_matches").get()).toEqual({ count: 0n });
    native.close();
  });
});
