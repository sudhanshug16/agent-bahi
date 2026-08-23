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
    await app.fx.currency.register({ schemaVersion: 1, tenantId: created.tenantId as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "fx-test" }, source: "INTERNAL", reason: "register INR", payload: { currencyCode: "INR", exponent: 2 } });
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

  it("uses JPY exponent 0 and KWD exponent 3 for conversion, settlement, and revaluation", async () => {
    const scenarios = [
      { baseCurrency: "JPY", baseExponent: 0, bookRate: "110", settlementRate: "111", expectedBase: 11_000, partialActual: 5_550, partialCarrying: 5_500, gain: 50 },
      { baseCurrency: "KWD", baseExponent: 3, bookRate: "0.307", settlementRate: "0.31", expectedBase: 30_700, partialActual: 15_500, partialCarrying: 15_350, gain: 150 },
    ] as const;
    for (const scenario of scenarios) {
      directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", `agent-bahi-fx-${scenario.baseCurrency.toLowerCase()}-`));
      const dbPath = join(directory, "books.sqlite");
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "backup.sqlite") });
      const envelope = (tenantId: string, bookSetId: string, payload: any) => ({ schemaVersion: 1 as const, tenantId: tenantId as any, bookSetId: bookSetId as any, requestId: randomUUID(), actor: { kind: "SYSTEM" as const, id: "fx-exponent-test" }, source: "INTERNAL" as const, reason: "FX exponent test", payload });
      const tenant = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "fx-exponent-test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: `${scenario.baseCurrency} Co`, baseCurrency: scenario.baseCurrency } });
      const created = JSON.parse(tenant.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { assets: string; cash: string; income: string; expenses: string } };
      await app.tenant.activate({ schemaVersion: 1, tenantId: created.tenantId as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "fx-exponent-test" }, source: "INTERNAL", reason: "activate", payload: { defaultBookSetId: created.defaultBookSetId as any } });
      await app.fx.currency.register({ schemaVersion: 1, tenantId: created.tenantId as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "fx-exponent-test" }, source: "INTERNAL", reason: "register base", payload: { currencyCode: scenario.baseCurrency, exponent: scenario.baseExponent } });
      await app.fx.currency.register({ schemaVersion: 1, tenantId: created.tenantId as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "fx-exponent-test" }, source: "INTERNAL", reason: "register USD", payload: { currencyCode: "USD", exponent: 2 } });
      const bookRate = await app.fx.rate.create(envelope(created.tenantId, created.defaultBookSetId, { foreignCurrencyCode: "USD", foreignExponent: 2, rateDecimal: scenario.bookRate, source: "MANUAL", purpose: "BOOK_INITIAL", effectiveDate: "2026-08-23", verified: true, evidence: { reference: "exponent-test" } }));
      const settlementRate = await app.fx.rate.create(envelope(created.tenantId, created.defaultBookSetId, { foreignCurrencyCode: "USD", foreignExponent: 2, rateDecimal: scenario.settlementRate, source: "MANUAL", purpose: "SETTLEMENT", effectiveDate: "2026-08-23", verified: true, evidence: { reference: "exponent-test" } }));
      const periodRate = await app.fx.rate.create(envelope(created.tenantId, created.defaultBookSetId, { foreignCurrencyCode: "USD", foreignExponent: 2, rateDecimal: scenario.settlementRate, source: "MANUAL", purpose: "PERIOD_END", effectiveDate: "2026-08-23", verified: true, evidence: { reference: "exponent-test" } }));
      const party = await app.party.create(envelope(created.tenantId, created.defaultBookSetId, { displayName: `${scenario.baseCurrency} Customer`, role: "CUSTOMER" }));
      const customerId = JSON.parse(party.resultJson).partyId;
      const invoice = await app.invoice.create(envelope(created.tenantId, created.defaultBookSetId, { invoiceNumber: `${scenario.baseCurrency}-001`, customerId, issueDate: "2026-08-23", lines: [{ description: "Services", revenueAccountId: created.seedAccountIds.income, amountMinor: 10_000, foreignAmountMinor: 10_000 }], fx: { currencyCode: "USD", exponent: 2, rateSnapshotId: JSON.parse(bookRate.resultJson).rateSnapshotId, roundingPolicy: "HALF_UP" } }));
      const invoiceId = JSON.parse(invoice.resultJson).invoiceId;
      await app.invoice.post(envelope(created.tenantId, created.defaultBookSetId, { invoiceId, receivableAccountId: created.seedAccountIds.assets }));
      expect((await app.invoice.get(created.tenantId as any, created.defaultBookSetId as any, invoiceId)).totalMinor).toBe(scenario.expectedBase);
      const allocation = (foreignAmountMinor: number, actualBankBaseMinor: number) => ({ invoiceId, amountMinor: actualBankBaseMinor, fx: { foreignAmountMinor, actualBankBaseMinor, settlementRateSnapshotId: JSON.parse(settlementRate.resultJson).rateSnapshotId, realizedGainLossAccountId: created.seedAccountIds.expenses } });
      if (scenario.baseCurrency === "KWD") {
        const policy = await app.fx.revaluation.policy(envelope(created.tenantId, created.defaultBookSetId, { policyCode: "IND_AS_21", unrealizedGainLossAccountId: created.seedAccountIds.expenses, arAdjustmentAccountId: created.seedAccountIds.assets, apAdjustmentAccountId: created.seedAccountIds.assets }));
        const policyId = JSON.parse(policy.resultJson).policyId;
        const revaluation = await app.fx.revaluation.post(envelope(created.tenantId, created.defaultBookSetId, { policyId, asOfDate: "2026-08-23", rateSnapshotIds: { USD: JSON.parse(periodRate.resultJson).rateSnapshotId } }));
        const runId = JSON.parse(revaluation.resultJson).runId;
        const db = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
        expect(db.query("SELECT base_exponent, revalued_base_minor FROM fx_revaluation_lines").get()).toEqual({ base_exponent: 3n, revalued_base_minor: 31_000n });
        db.close();
        await expect(app.receipt.record(envelope(created.tenantId, created.defaultBookSetId, { customerId, receiptDate: "2026-08-23", bankAccountId: created.seedAccountIds.cash, allocations: [allocation(5_000, scenario.partialActual)] }))).rejects.toMatchObject({ code: "FX_REVALUATION_REVERSE_REQUIRED" });
        await app.fx.revaluation.reverse(envelope(created.tenantId, created.defaultBookSetId, { policyId, runId, asOfDate: "2026-08-23", rateSnapshotIds: {} }));
      }
      await app.receipt.record(envelope(created.tenantId, created.defaultBookSetId, { customerId, receiptDate: "2026-08-23", bankAccountId: created.seedAccountIds.cash, allocations: [allocation(5_000, scenario.partialActual)] }));
      await app.receipt.record(envelope(created.tenantId, created.defaultBookSetId, { customerId, receiptDate: "2026-08-23", bankAccountId: created.seedAccountIds.cash, allocations: [allocation(5_000, scenario.partialActual)] }));
      expect(await app.fx.exposure(created.tenantId as any, created.defaultBookSetId as any)).toEqual([]);
      const db = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
      expect(db.query("SELECT base_exponent, total_base_minor FROM fx_document_facts").get()).toEqual({ base_exponent: BigInt(scenario.baseExponent), total_base_minor: BigInt(scenario.expectedBase) });
      expect(db.query("SELECT base_exponent, carrying_base_minor, actual_bank_base_minor FROM fx_allocation_facts ORDER BY created_at").all()).toEqual([{ base_exponent: BigInt(scenario.baseExponent), carrying_base_minor: BigInt(scenario.partialCarrying), actual_bank_base_minor: BigInt(scenario.partialActual) }, { base_exponent: BigInt(scenario.baseExponent), carrying_base_minor: BigInt(scenario.partialCarrying), actual_bank_base_minor: BigInt(scenario.partialActual) }]);
      db.close();
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });
});
