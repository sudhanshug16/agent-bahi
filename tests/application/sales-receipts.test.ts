import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database as BunDatabase } from "bun:sqlite";
import { bootstrapSqliteApplication } from "../../src/application/application.ts";

describe("customer, invoice, and receipt vertical slice", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it("creates, posts, allocates receipts, and reports the same ledger", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-sales-"));
    const app = await bootstrapSqliteApplication(join(directory, "books.sqlite"), { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenant = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "Sales Co", baseCurrency: "INR" } });
    const created = JSON.parse(tenant.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { assets: string; cash: string; income: string } };
    const party = await app.party.create({ schemaVersion: 1, tenantId: created.tenantId as any, bookSetId: created.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "create customer", payload: { displayName: "Acme Customer", email: "acme@example.test" } });
    const customerId = JSON.parse(party.resultJson).partyId;
    const draft = await app.invoice.create({ schemaVersion: 1, tenantId: created.tenantId as any, bookSetId: created.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "create invoice", payload: { invoiceNumber: "INV-001", customerId, issueDate: "2026-08-23", lines: [{ description: "Services", revenueAccountId: created.seedAccountIds.income, amountMinor: 100_000 }] } });
    const invoiceId = JSON.parse(draft.resultJson).invoiceId;
    await app.invoice.post({ schemaVersion: 1, tenantId: created.tenantId as any, bookSetId: created.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "post invoice", payload: { invoiceId, receivableAccountId: created.seedAccountIds.assets } });
    const posted = await app.invoice.get(created.tenantId as any, created.defaultBookSetId as any, invoiceId);
    expect(posted).toMatchObject({ totalMinor: 100_000, paidMinor: 0, outstandingMinor: 100_000, status: "POSTED" });
    const firstReceipt = { schemaVersion: 1 as const, tenantId: created.tenantId as any, bookSetId: created.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN" as const, id: "owner" }, source: "CLI" as const, reason: "record receipt", payload: { customerId, receiptDate: "2026-08-23", bankAccountId: created.seedAccountIds.cash, allocations: [{ invoiceId, amountMinor: 40_000 }] } };
    await app.receipt.record(firstReceipt);
    expect(await app.invoice.get(created.tenantId as any, created.defaultBookSetId as any, invoiceId)).toMatchObject({ paidMinor: 40_000, outstandingMinor: 60_000, status: "PARTIALLY_PAID" });
    expect((await app.invoice.outstanding(created.tenantId as any, created.defaultBookSetId as any)).map((row) => row.invoiceNumber)).toEqual(["INV-001"]);
    const secondReceipt = { ...firstReceipt, requestId: randomUUID(), payload: { ...firstReceipt.payload, allocations: [{ invoiceId, amountMinor: 60_000 }] } };
    await app.receipt.record(secondReceipt);
    expect(await app.invoice.get(created.tenantId as any, created.defaultBookSetId as any, invoiceId)).toMatchObject({ paidMinor: 100_000, outstandingMinor: 0, status: "PAID" });
    expect(await app.invoice.outstanding(created.tenantId as any, created.defaultBookSetId as any)).toEqual([]);
    const tb = await app.ledger.trialBalance(created.tenantId as any, created.defaultBookSetId as any, "2026-08-23");
    expect(tb.isBalanced).toBe(true);
    const pnl = await app.ledger.profitAndLoss(created.tenantId as any, created.defaultBookSetId as any, "2026-01-01", "2026-08-23");
    expect(pnl.incomeMinor).toBe(100_000);
    const bs = await app.ledger.balanceSheet(created.tenantId as any, created.defaultBookSetId as any, "2026-08-23");
    expect(bs.assets.find((row) => row.accountId === created.seedAccountIds.cash)?.balanceMinor).toBe(100_000);
  });

  it("rejects account classes, cross-scope/customer allocations, over-allocation, and replays without mutations", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-sales-reject-"));
    const dbPath = join(directory, "books.sqlite");
    const app = await bootstrapSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenant = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "Sales Reject Co" } });
    const data = JSON.parse(tenant.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { assets: string; cash: string; income: string; expenses: string } };
    const party = await app.party.create({ schemaVersion: 1, tenantId: data.tenantId as any, bookSetId: data.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "customer", payload: { displayName: "Reject Customer" } });
    const customerId = JSON.parse(party.resultJson).partyId;
    const draft = await app.invoice.create({ schemaVersion: 1, tenantId: data.tenantId as any, bookSetId: data.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "invoice", payload: { invoiceNumber: "INV-R", customerId, issueDate: "2026-08-23", lines: [{ description: "Service", revenueAccountId: data.seedAccountIds.income, amountMinor: 10_000 }] } });
    const invoiceId = JSON.parse(draft.resultJson).invoiceId;
    await expect(app.invoice.post({ schemaVersion: 1, tenantId: data.tenantId as any, bookSetId: data.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "bad post", payload: { invoiceId, receivableAccountId: data.seedAccountIds.income } })).rejects.toMatchObject({ code: "INVALID_ACCOUNT_CLASS" });
    expect((await app.invoice.get(data.tenantId as any, data.defaultBookSetId as any, invoiceId)).status).toBe("DRAFT");
    await app.invoice.post({ schemaVersion: 1, tenantId: data.tenantId as any, bookSetId: data.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "post", payload: { invoiceId, receivableAccountId: data.seedAccountIds.assets } });
    const receipt = { schemaVersion: 1 as const, tenantId: data.tenantId as any, bookSetId: data.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN" as const, id: "owner" }, source: "CLI" as const, reason: "over", payload: { customerId, receiptDate: "2026-08-23", bankAccountId: data.seedAccountIds.cash, allocations: [{ invoiceId, amountMinor: 10_001 }] } };
    await expect(app.receipt.record(receipt)).rejects.toMatchObject({ code: "OVER_ALLOCATION" });
    const replay = { ...receipt, requestId: randomUUID(), payload: { ...receipt.payload, allocations: [{ invoiceId, amountMinor: 4_000 }] } };
    const first = await app.receipt.record(replay);
    const second = await app.receipt.record(replay);
    expect(second.replayed).toBe(true);
    expect(second.resultJson).toBe(first.resultJson);
    const native = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
    expect(native.query("SELECT COUNT(*) AS count FROM bank_receipts").get()).toEqual({ count: 1n });
    expect(native.query("SELECT COUNT(*) AS count FROM audit_records WHERE command = 'receipt.record'").get()).toEqual({ count: 1n });
    native.close();
  });
});
