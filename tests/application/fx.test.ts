import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database as BunDatabase } from "bun:sqlite";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";

describe("foreign-currency invoice and settlement", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it("preserves original currency, posts exact base amounts, and realizes the settlement difference", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-fx-"));
    const dbPath = join(directory, "books.sqlite");
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "backup.sqlite") });
    const envelope = (tenantId: string, bookSetId: string, payload: any) => ({ schemaVersion: 1 as const, tenantId: tenantId as any, bookSetId: bookSetId as any, requestId: randomUUID(), actor: { kind: "SYSTEM" as const, id: "fx-test" }, source: "INTERNAL" as const, reason: "FX test", payload });
    const tenant = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "fx-test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "FX Co", baseCurrency: "INR" } });
    const created = JSON.parse(tenant.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { assets: string; cash: string; income: string; expenses: string } };
    await app.tenant.activate({ schemaVersion: 1, tenantId: created.tenantId as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "fx-test" }, source: "INTERNAL", reason: "activate", payload: { defaultBookSetId: created.defaultBookSetId as any } });
    await app.fx.currency.register({ schemaVersion: 1, tenantId: created.tenantId as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "fx-test" }, source: "INTERNAL", reason: "register USD", payload: { currencyCode: "USD", exponent: 2 } });
    const bookRate = await app.fx.rate.create(envelope(created.tenantId, created.defaultBookSetId, { foreignCurrencyCode: "USD", foreignExponent: 2, rateDecimal: "83.125", source: "MANUAL", purpose: "BOOK_INITIAL", effectiveDate: "2026-08-23", verified: true, evidence: { reference: "test" } }));
    const settlementRate = await app.fx.rate.create(envelope(created.tenantId, created.defaultBookSetId, { foreignCurrencyCode: "USD", foreignExponent: 2, rateDecimal: "90", source: "MANUAL", purpose: "SETTLEMENT", effectiveDate: "2026-08-23", verified: true, evidence: { reference: "test" } }));
    const party = await app.party.create(envelope(created.tenantId, created.defaultBookSetId, { displayName: "USD Customer", role: "CUSTOMER" }));
    const customerId = JSON.parse(party.resultJson).partyId;
    const invoice = await app.invoice.create(envelope(created.tenantId, created.defaultBookSetId, { invoiceNumber: "FX-001", customerId, issueDate: "2026-08-23", lines: [{ description: "Services", revenueAccountId: created.seedAccountIds.income, amountMinor: 10_000, foreignAmountMinor: 10_000 }], fx: { currencyCode: "USD", exponent: 2, rateSnapshotId: JSON.parse(bookRate.resultJson).rateSnapshotId, roundingPolicy: "HALF_UP" } }));
    const invoiceId = JSON.parse(invoice.resultJson).invoiceId;
    await app.invoice.post(envelope(created.tenantId, created.defaultBookSetId, { invoiceId, receivableAccountId: created.seedAccountIds.assets }));
    expect((await app.invoice.get(created.tenantId as any, created.defaultBookSetId as any, invoiceId)).totalMinor).toBe(831_250);
    await app.receipt.record(envelope(created.tenantId, created.defaultBookSetId, { customerId, receiptDate: "2026-08-23", bankAccountId: created.seedAccountIds.cash, allocations: [{ invoiceId, amountMinor: 900_000, fx: { foreignAmountMinor: 10_000, actualBankBaseMinor: 900_000, settlementRateSnapshotId: JSON.parse(settlementRate.resultJson).rateSnapshotId, realizedGainLossAccountId: created.seedAccountIds.expenses } }] }));
    expect(await app.fx.exposure(created.tenantId as any, created.defaultBookSetId as any)).toEqual([]);
    const db = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
    expect(db.query("SELECT currency_code, total_foreign_minor, total_base_minor FROM fx_document_facts").get()).toEqual({ currency_code: "USD", total_foreign_minor: 10000n, total_base_minor: 831250n });
    expect(db.query("SELECT foreign_minor, carrying_base_minor, actual_bank_base_minor, realized_gain_loss_minor FROM fx_allocation_facts").get()).toEqual({ foreign_minor: 10000n, carrying_base_minor: 831250n, actual_bank_base_minor: 900000n, realized_gain_loss_minor: 68750n });
    db.close();
  });
});
