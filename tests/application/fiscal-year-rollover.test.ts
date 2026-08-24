import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import type { CommandEnvelope } from "../../src/application/commands.ts";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import type { JournalLinePayload } from "../../src/application/services/journal-command-service.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";
import { findOperation } from "../../src/transport/catalog.ts";
import type { BookSetId } from "../../src/core/types.ts";

describe("Fiscal Year Rollover V1", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function fixture() {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-fiscal-year-rollover-"));
    const dbPath = join(directory, "books.sqlite");
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "fiscal-year-rollover" });
    const created = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "rollover-test" }, source: "INTERNAL", reason: "create rollover tenant", payload: { kind: "COMPANY", name: "Rollover Co" } });
    const tenant = JSON.parse(created.resultJson) as { tenantId: string; defaultBookSetId: string };
    const cash = await app.account.getByCode("1100", tenant.tenantId as any, tenant.defaultBookSetId as any);
    const equity = await app.account.getByCode("3000", tenant.tenantId as any, tenant.defaultBookSetId as any);
    const income = await app.account.getByCode("4000", tenant.tenantId as any, tenant.defaultBookSetId as any);
    const expense = await app.account.getByCode("5000", tenant.tenantId as any, tenant.defaultBookSetId as any);
    return { app, dbPath, tenant, cash: cash!.id, equity: equity!.id, income: income!.id, expense: expense!.id };
  }

  function envelope<T extends Record<string, unknown>>(input: Awaited<ReturnType<typeof fixture>>, requestId: string, payload: T, actor: "HUMAN" | "AGENT" = "HUMAN"): CommandEnvelope<T> & { bookSetId: BookSetId } {
    return { schemaVersion: 1 as const, tenantId: input.tenant.tenantId as any, bookSetId: input.tenant.defaultBookSetId as any, requestId, actor: { kind: actor, id: "rollover-owner" }, source: "CLI" as const, reason: "owner approved fiscal year rollover", payload };
  }

  async function post(input: Awaited<ReturnType<typeof fixture>>, requestId: string, postingDate: string, lines: JournalLinePayload[]) {
    return input.app.journal.post(envelope(input, requestId, { postingDate, lines }));
  }

  it("previews India FY balances, finalizes an immutable carry-forward snapshot, and exports deterministically", async () => {
    const input = await fixture();
    await post(input, "opening", "2025-03-31", [{ accountId: input.cash, debitMinor: 100_000 }, { accountId: input.equity, creditMinor: 100_000 }]);
    await post(input, "income", "2025-04-01", [{ accountId: input.cash, debitMinor: 25_000 }, { accountId: input.income, creditMinor: 25_000 }]);
    await post(input, "expense", "2025-04-02", [{ accountId: input.expense, debitMinor: 5_000 }, { accountId: input.cash, creditMinor: 5_000 }]);

    const closePreview = await input.app.periodClose.preview(input.tenant.tenantId as any, input.tenant.defaultBookSetId as any, "2025-04-01", "2026-03-31");
    await input.app.periodClose.close({ ...envelope(input, "close-fy", { periodStart: "2025-04-01", periodEnd: "2026-03-31", planHash: closePreview.planHash, confirm: true }), payload: { periodStart: "2025-04-01", periodEnd: "2026-03-31", planHash: closePreview.planHash, confirm: true } } as any);
    const closePack = await input.app.closePack.export({ ...envelope(input, "pack-fy", { periodStart: "2025-04-01", periodEnd: "2026-03-31", asOfDate: "2026-03-31", basis: "ACCRUAL" }), payload: { periodStart: "2025-04-01", periodEnd: "2026-03-31", asOfDate: "2026-03-31", basis: "ACCRUAL" } } as any);
    const pack = JSON.parse(closePack.resultJson) as { manifestId: string; manifestHash: string };

    const preview = await input.app.fiscalYearRollover.preview(input.tenant.tenantId as any, input.tenant.defaultBookSetId as any, "2025-26");
    expect(preview.financialYear).toBe("2025-2026");
    expect(preview.periodClose.status).toBe("CLOSED");
    expect(preview.closePack).toMatchObject({ manifestId: pack.manifestId, manifestHash: pack.manifestHash, periodCloseLabel: "CLOSED" });
    expect(preview.profitAndLoss.netProfitLossMinor).toBe(20_000);
    expect(preview.closingTrialBalance.isBalanced).toBe(true);
    expect(preview.balanceSheet.isBalanced).toBe(true);
    expect(preview.accounts.find((row) => row.code === "1100")).toMatchObject({ openingBalanceMinor: 100_000, closingBalanceMinor: 120_000 });
    expect(preview.accounts.find((row) => row.code === "4000")?.openingBalanceMinor).toBe(0);
    expect(preview.continuity).toEqual({ syntheticJournalsCreated: false, retainedEarningsDoubleCounted: false, nextYearBalanceSheet: "CONTINUES_FROM_LEDGER", nextYearProfitAndLoss: "RESETS_BY_REPORT_DATE_RANGE" });

    const finalized = await input.app.fiscalYearRollover.finalize(envelope(input, "rollover-finalize", { financialYear: "2025-26", previewHash: preview.previewHash, ledgerRevision: preview.ledgerRevision, closePackManifestId: pack.manifestId, closePackManifestHash: pack.manifestHash, confirm: true }));
    const result = JSON.parse(finalized.resultJson) as { rolloverId: string; snapshotHash: string };
    expect(result.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await input.app.fiscalYearRollover.finalize(envelope(input, "rollover-finalize", { financialYear: "2025-26", previewHash: preview.previewHash, ledgerRevision: preview.ledgerRevision, closePackManifestId: pack.manifestId, closePackManifestHash: pack.manifestHash, confirm: true })))).toMatchObject({ replayed: true, resultJson: finalized.resultJson });

    const shown = await input.app.fiscalYearRollover.show(input.tenant.tenantId as any, input.tenant.defaultBookSetId as any, "2025-2026", result.rolloverId);
    expect(shown).toMatchObject({ status: "FINALIZED", snapshotHash: result.snapshotHash, submitted: false, governmentFiling: false });
    expect((await input.app.fiscalYearRollover.status(input.tenant.tenantId as any, input.tenant.defaultBookSetId as any, "2025-2026"))).toMatchObject({ status: "FINALIZED" });
    const csv = await input.app.fiscalYearRollover.export(input.tenant.tenantId as any, input.tenant.defaultBookSetId as any, "2025-2026", result.rolloverId, "CSV");
    const csvAgain = await input.app.fiscalYearRollover.export(input.tenant.tenantId as any, input.tenant.defaultBookSetId as any, "2025-2026", result.rolloverId, "CSV");
    expect(csv).toEqual(csvAgain);
    expect(csv).toMatchObject({ format: "CSV", contentType: "text/csv" });
    expect(String(csv.content)).toContain("Opening Balance (Minor Units)");
    expect((await input.app.fiscalYearRollover.export(input.tenant.tenantId as any, input.tenant.defaultBookSetId as any, "2025-2026", result.rolloverId, "JSON")).content).toContain("CONTINUES_FROM_LEDGER");

    const db = new Database(input.dbPath);
    expect(db.query("SELECT COUNT(*) AS count FROM fiscal_year_rollovers WHERE tenant_id = ? AND book_set_id = ?").get(input.tenant.tenantId, input.tenant.defaultBookSetId)).toEqual({ count: 1 });
    expect(db.query("SELECT COUNT(*) AS count FROM journal_entries WHERE tenant_id = ? AND book_set_id = ?").get(input.tenant.tenantId, input.tenant.defaultBookSetId)).toEqual({ count: 3 });
    expect(db.query("SELECT COUNT(*) AS count FROM audit_records WHERE command = 'fiscal-year.rollover.finalize'").get()).toEqual({ count: 1 });
    expect(() => db.query("UPDATE fiscal_year_rollovers SET reason = 'tampered'").run()).toThrow();
    expect(() => db.query("DELETE FROM fiscal_year_rollovers").run()).toThrow();
    db.close();
  });

  it("fails closed for stale revisions, requires human confirmation, and marks finalized snapshots stale after later ledger activity", async () => {
    const input = await fixture();
    await post(input, "opening-stale", "2025-03-31", [{ accountId: input.cash, debitMinor: 10 }, { accountId: input.equity, creditMinor: 10 }]);
    const preview = await input.app.fiscalYearRollover.preview(input.tenant.tenantId as any, input.tenant.defaultBookSetId as any, "2025-2026");
    await post(input, "later-stale", "2026-04-01", [{ accountId: input.cash, debitMinor: 1 }, { accountId: input.equity, creditMinor: 1 }]);
    await expect(input.app.fiscalYearRollover.finalize(envelope(input, "stale-finalize", { financialYear: "2025-2026", previewHash: preview.previewHash, ledgerRevision: preview.ledgerRevision, closePackManifestId: "missing", closePackManifestHash: "0".repeat(64), confirm: true }))).rejects.toMatchObject({ code: "FISCAL_YEAR_ROLLOVER_LEDGER_REVISION_CHANGED" });
    await expect(input.app.fiscalYearRollover.finalize(envelope(input, "agent-finalize", { financialYear: "2025-2026", previewHash: preview.previewHash, ledgerRevision: preview.ledgerRevision, closePackManifestId: "missing", closePackManifestHash: "0".repeat(64), confirm: true }, "AGENT"))).rejects.toMatchObject({ code: "FISCAL_YEAR_ROLLOVER_HUMAN_REQUIRED" });
    expect((await input.app.fiscalYearRollover.status(input.tenant.tenantId as any, input.tenant.defaultBookSetId as any, "2025-2026"))).toMatchObject({ status: "NOT_FINALIZED" });
  });

  it("preserves the rollover through a verified backup and exposes identical catalog semantics to CLI and MCP dispatchers", async () => {
    const input = await fixture();
    for (const operationId of ["fiscal-year.rollover.preview", "fiscal-year.rollover.finalize", "fiscal-year.rollover.show", "fiscal-year.rollover.status", "fiscal-year.rollover.export"]) {
      expect(findOperation(operationId)).toBeDefined();
    }
    const preview = await new OperationDispatcher({ databasePath: input.dbPath, source: "CLI" }).dispatch("fiscal-year.rollover.preview", { tenantId: input.tenant.tenantId, bookSetId: input.tenant.defaultBookSetId, financialYear: "2025-2026" });
    const mcp = await new OperationDispatcher({ databasePath: input.dbPath, source: "MCP" }).dispatch("fiscal-year.rollover.preview", { tenantId: input.tenant.tenantId, bookSetId: input.tenant.defaultBookSetId, financialYear: "2025-2026" });
    expect(mcp).toEqual(preview);
    const backup = join(directory!, "rollover.backup.sqlite");
    const restored = join(directory!, "rollover.restored.sqlite");
    await new BackupService(input.dbPath).createBackup(backup);
    expect(await new BackupService(input.dbPath).restoreFromBackup(backup, restored)).toBe(true);
    const db = new Database(restored, { readonly: true });
    expect(db.query("SELECT COUNT(*) AS count FROM fiscal_year_rollovers").get()).toEqual({ count: 0 });
    expect(db.query("SELECT type FROM sqlite_master WHERE name = 'fiscal_year_rollovers_no_delete'").get()).toEqual({ type: "trigger" });
    db.close();
  });
});
