import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { calculateBookDepreciation } from "../../src/application/services/fixed-assets-service.ts";

describe("fixed assets V1", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it("calculates integer straight-line and caps the final remainder", () => {
    const first = calculateBookDepreciation({ costMinor: 1_000, residualMinor: 1, accumulatedMinor: 0, method: "STRAIGHT_LINE", usefulLifeMonths: 3, periodStart: "2024-01-01", periodEnd: "2024-01-31", putToUseDate: "2024-01-01", prorataConvention: "MONTHLY", roundingPolicy: "PAISE_HALF_UP" });
    expect(first.amountMinor).toBe(333);
    const final = calculateBookDepreciation({ costMinor: 1_000, residualMinor: 1, accumulatedMinor: 998, method: "STRAIGHT_LINE", usefulLifeMonths: 3, periodStart: "2024-03-01", periodEnd: "2024-03-31", putToUseDate: "2024-01-01", prorataConvention: "MONTHLY", roundingPolicy: "PAISE_HALF_UP" });
    expect(final.amountMinor).toBe(1);
    expect(final.closingAccumulatedMinor).toBe(999);
  });

  it("requires a posted acquisition journal for manual registration and posts disposal", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-assets-"));
    const app = await initializeAndUpgradeSqliteApplication(join(directory, "books.sqlite"), { backupDestinationPath: join(directory, "backup.sqlite") });
    const created = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "asset test", payload: { kind: "COMPANY", name: "Asset Co" } });
    const data = JSON.parse(created.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { assets: string; cash: string; expenses: string; equity: string } };
    const envelope = (payload: unknown) => ({ schemaVersion: 1 as const, tenantId: data.tenantId as any, bookSetId: data.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN" as const, id: "owner" }, source: "INTERNAL" as const, reason: "asset test", payload });
    const taxRule = await app.fixedAssets.taxRule.create({ schemaVersion: 1, tenantId: data.tenantId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "owner" }, source: "INTERNAL", reason: "tax rule", payload: { lawName: "Income-tax Act", ruleReference: "s32/rule25", version: "test", sourceUrl: "https://example.test/rule", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", blockCode: "BLK-1", rateBps: 1000, halfRateCondition: "NONE", sourceVerified: true } });
    const ruleId = JSON.parse(taxRule.resultJson).ruleSnapshotId;
    const block = await app.fixedAssets.taxBlock.register(envelope({ blockCode: "BLK-1", ruleSnapshotId: ruleId, openingWdvMinor: 0 }) as any);
    const blockId = JSON.parse(block.resultJson).blockId;
    await expect(app.fixedAssets.register(envelope({ assetNumber: "FA-1", acquisitionDate: "2026-01-01", putToUseDate: "2026-01-01", description: "Machine", costMinor: 10_000, businessUseBps: 10_000, assetAccountId: data.seedAccountIds.assets, accumulatedDepreciationAccountId: data.seedAccountIds.assets, depreciationExpenseAccountId: data.seedAccountIds.expenses, gainLossAccountId: data.seedAccountIds.expenses, bookPolicy: { framework: "AS_10", sourceReference: "policy", effectiveFrom: "2026-01-01", method: "STRAIGHT_LINE", usefulLifeMonths: 12, residualMinor: 0, prorataConvention: "MONTHLY", roundingPolicy: "PAISE_HALF_UP", remainderPolicy: "FINAL_PERIOD", justification: "test" } }) as any)).rejects.toMatchObject({ code: "ASSET_EVIDENCE_REQUIRED" });
    const journal = await app.journal.post(envelope({ postingDate: "2026-01-01", lines: [{ accountId: data.seedAccountIds.assets, debitMinor: 10_000 }, { accountId: data.seedAccountIds.cash, creditMinor: 10_000 }] }) as any);
    const asset = await app.fixedAssets.register(envelope({ assetNumber: "FA-1", acquisitionDate: "2026-01-01", putToUseDate: "2026-01-01", description: "Machine", costMinor: 10_000, businessUseBps: 10_000, assetAccountId: data.seedAccountIds.assets, accumulatedDepreciationAccountId: data.seedAccountIds.assets, depreciationExpenseAccountId: data.seedAccountIds.expenses, gainLossAccountId: data.seedAccountIds.expenses, taxBlockId: blockId, acquisitionJournalId: JSON.parse(journal.resultJson).journalId, evidenceReference: "opening-evidence", bookPolicy: { framework: "AS_10", sourceReference: "policy", effectiveFrom: "2026-01-01", method: "STRAIGHT_LINE", usefulLifeMonths: 12, residualMinor: 0, prorataConvention: "MONTHLY", roundingPolicy: "PAISE_HALF_UP", remainderPolicy: "FINAL_PERIOD", justification: "test" } }) as any);
    const assetId = JSON.parse(asset.resultJson).assetId;
    const tax = await app.fixedAssets.tax.compute(envelope({ periodStart: "2026-01-01", periodEnd: "2026-12-31" }) as any);
    expect(JSON.parse(tax.resultJson).lines[0].depreciationMinor).toBe(1_000);
    await expect(app.fixedAssets.tax.compute(envelope({ periodStart: "2026-01-01", periodEnd: "2027-01-01" }) as any)).rejects.toMatchObject({ code: "TAX_RULE_NOT_EFFECTIVE" });
    const depreciation = await app.fixedAssets.depreciation.post(envelope({ periodStart: "2026-01-01", periodEnd: "2026-01-31" }) as any);
    expect(JSON.parse(depreciation.resultJson).totalMinor).toBe(833);
    const disposed = await app.fixedAssets.dispose(envelope({ assetId, disposalDate: "2026-02-01", proceedsMinor: 9_500, proceedsAccountId: data.seedAccountIds.cash, evidenceReference: "disposal-evidence" }) as any);
    expect(JSON.parse(disposed.resultJson).status).toBe("DISPOSED");
    const noOpEnvelope = envelope({ periodStart: "2026-03-01", periodEnd: "2026-03-31" });
    const noOp = await app.fixedAssets.depreciation.post(noOpEnvelope as any);
    const noOpResult = JSON.parse(noOp.resultJson) as { status: string; totalMinor: number; lines: unknown[]; journalId?: string };
    expect(noOpResult).toMatchObject({ status: "NO_OP", totalMinor: 0, lines: [] });
    expect(noOpResult.journalId).toBeUndefined();
    const noOpReplay = await app.fixedAssets.depreciation.post(noOpEnvelope as any);
    expect(noOpReplay.resultJson).toBe(noOp.resultJson);
  });

  it("uses component-specific reducing rates and rejects invalid component rates", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-assets-components-"));
    const app = await initializeAndUpgradeSqliteApplication(join(directory, "books.sqlite"), { backupDestinationPath: join(directory, "backup.sqlite") });
    const created = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "asset component test", payload: { kind: "COMPANY", name: "Component Co" } });
    const data = JSON.parse(created.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { assets: string; cash: string; expenses: string } };
    const envelope = (payload: unknown) => ({ schemaVersion: 1 as const, tenantId: data.tenantId as any, bookSetId: data.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN" as const, id: "owner" }, source: "INTERNAL" as const, reason: "asset component test", payload });
    const journal = await app.journal.post(envelope({ postingDate: "2026-01-01", lines: [{ accountId: data.seedAccountIds.assets, debitMinor: 1_000 }, { accountId: data.seedAccountIds.cash, creditMinor: 1_000 }] }) as any);
    const base = { assetNumber: "FA-COMP", acquisitionDate: "2026-01-01", putToUseDate: "2026-01-01", description: "Composite machine", costMinor: 1_000, businessUseBps: 10_000, assetAccountId: data.seedAccountIds.assets, accumulatedDepreciationAccountId: data.seedAccountIds.assets, depreciationExpenseAccountId: data.seedAccountIds.expenses, gainLossAccountId: data.seedAccountIds.expenses, acquisitionJournalId: JSON.parse(journal.resultJson).journalId, evidenceReference: "component-evidence", bookPolicy: { framework: "AS_10", sourceReference: "policy", effectiveFrom: "2026-01-01", method: "STRAIGHT_LINE", usefulLifeMonths: 12, residualMinor: 0, prorataConvention: "MONTHLY", roundingPolicy: "PAISE_HALF_UP", remainderPolicy: "FINAL_PERIOD", justification: "test" } };
    await expect(app.fixedAssets.register(envelope({ ...base, components: [{ description: "Straight", costMinor: 500, residualMinor: 0, usefulLifeMonths: 12, method: "STRAIGHT_LINE", reducingRateBps: 1 }, { description: "Reducing", costMinor: 500, residualMinor: 0, usefulLifeMonths: 12, method: "REDUCING_BALANCE" }] }) as any)).rejects.toMatchObject({ code: "INVALID_COMPONENTS" });
    await expect(app.fixedAssets.register(envelope({ ...base, components: [{ description: "Straight", costMinor: 500, residualMinor: 0, usefulLifeMonths: 12, method: "STRAIGHT_LINE" }, { description: "Reducing", costMinor: 500, residualMinor: 0, usefulLifeMonths: 12, method: "REDUCING_BALANCE", reducingRateBps: 2_000 }] }) as any)).resolves.toBeDefined();
    const depreciation = await app.fixedAssets.depreciation.post(envelope({ periodStart: "2026-01-01", periodEnd: "2026-01-31" }) as any);
    expect(JSON.parse(depreciation.resultJson).totalMinor).toBe(50);
  });
});
