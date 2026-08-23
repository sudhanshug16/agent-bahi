import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database as BunDatabase } from "bun:sqlite";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";

describe("Period Close V1", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function setup() {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-period-close-"));
    const dbPath = join(directory, "books.sqlite");
    const application = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "backup.sqlite"), cliVersion: "test", buildId: "period-close" });
    const created = await application.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "Close Co" } });
    const data = JSON.parse(created.resultJson) as { tenantId: string; defaultBookSetId: string };
    const cash = await application.account.getByCode("1100", data.tenantId as any, data.defaultBookSetId as any);
    const equity = await application.account.getByCode("3000", data.tenantId as any, data.defaultBookSetId as any);
    return { application, dbPath, tenantId: data.tenantId, bookSetId: data.defaultBookSetId, cash: cash!.id, equity: equity!.id };
  }

  function journal(input: Awaited<ReturnType<typeof setup>>, requestId = randomUUID(), date = "2026-03-31", amount = 100) {
    return input.application.journal.post({ schemaVersion: 1, tenantId: input.tenantId as any, bookSetId: input.bookSetId as any, requestId, actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "period close test", payload: { postingDate: date, lines: [{ accountId: input.cash as any, debitMinor: amount }, { accountId: input.equity as any, creditMinor: amount }] } });
  }

  it("previews, closes inclusively, blocks journal writes, reopens, and replays exactly", async () => {
    const input = await setup();
    await journal(input);
    const preview = await input.application.periodClose.preview(input.tenantId as any, input.bookSetId as any, "2026-01-01", "2026-03-31");
    expect(preview.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.snapshot.ledger.trialBalance.isBalanced).toBe(true);
    expect(preview.status).toBe("OPEN");

    const close = { schemaVersion: 1 as const, tenantId: input.tenantId as any, bookSetId: input.bookSetId as any, requestId: "close-1", actor: { kind: "HUMAN" as const, id: "owner" }, source: "CLI" as const, reason: "owner approved close", payload: { periodStart: "2026-01-01", periodEnd: "2026-03-31", planHash: preview.planHash, confirm: true } };
    const committed = await input.application.periodClose.close(close);
    const replay = await input.application.periodClose.close(close);
    expect(replay.replayed).toBe(true);
    expect(replay.resultJson).toBe(committed.resultJson);
    await expect(journal(input, randomUUID(), "2026-01-01")).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    await expect(journal(input, randomUUID(), "2026-03-31")).rejects.toMatchObject({ code: "PERIOD_CLOSED" });

    const status = await input.application.periodClose.status(input.tenantId as any, input.bookSetId as any);
    expect(status).toEqual([expect.objectContaining({ periodStart: "2026-01-01", periodEnd: "2026-03-31", status: "CLOSED" })]);
    const reopenPreview = await input.application.periodClose.reopenPreview(input.tenantId as any, input.bookSetId as any, "2026-01-01", "2026-03-31");
    const reopened = await input.application.periodClose.reopen({ ...close, requestId: "reopen-1", payload: { ...close.payload, planHash: reopenPreview.planHash, reason: "owner approved correction" } });
    expect(JSON.parse(reopened.resultJson).eventType).toBe("REOPENED");
    await journal(input, randomUUID(), "2026-03-31", 1);
  });

  it("rejects stale plans, non-human confirmation, overlap, and direct SQL mutation", async () => {
    const input = await setup();
    const initial = await input.application.periodClose.preview(input.tenantId as any, input.bookSetId as any, "2026-01-01", "2026-03-31");
    await journal(input, randomUUID(), "2026-02-01");
    await expect(input.application.periodClose.close({ schemaVersion: 1, tenantId: input.tenantId as any, bookSetId: input.bookSetId as any, requestId: "stale", actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "close", payload: { periodStart: "2026-01-01", periodEnd: "2026-03-31", planHash: initial.planHash, confirm: true } })).rejects.toMatchObject({ code: "PERIOD_PLAN_STALE" });
    const current = await input.application.periodClose.preview(input.tenantId as any, input.bookSetId as any, "2026-01-01", "2026-03-31");
    await expect(input.application.periodClose.close({ schemaVersion: 1, tenantId: input.tenantId as any, bookSetId: input.bookSetId as any, requestId: "agent-confirm", actor: { kind: "AGENT", id: "agent" }, source: "MCP", reason: "close", payload: { periodStart: "2026-01-01", periodEnd: "2026-03-31", planHash: current.planHash, confirm: true } })).rejects.toMatchObject({ code: "HUMAN_CONFIRMATION_REQUIRED" });
    const closeRequestId = randomUUID();
    await input.application.periodClose.close({ schemaVersion: 1, tenantId: input.tenantId as any, bookSetId: input.bookSetId as any, requestId: closeRequestId, actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "close", payload: { periodStart: "2026-01-01", periodEnd: "2026-03-31", planHash: current.planHash, confirm: true } });
    const db = new BunDatabase(input.dbPath);
    expect(() => db.query(`UPDATE period_close_events SET reason = 'tamper' WHERE request_id = '${closeRequestId}'`).run()).toThrow();
    expect(() => db.query(`DELETE FROM period_close_events WHERE request_id = '${closeRequestId}'`).run()).toThrow();
    db.close();
    const adjacent = await input.application.periodClose.preview(input.tenantId as any, input.bookSetId as any, "2026-04-01", "2026-06-30");
    expect(adjacent.status).toBe("OPEN");
    await expect(input.application.periodClose.close({ schemaVersion: 1, tenantId: input.tenantId as any, bookSetId: input.bookSetId as any, requestId: "overlap", actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "overlap", payload: { periodStart: "2026-03-31", periodEnd: "2026-04-01", planHash: (await input.application.periodClose.preview(input.tenantId as any, input.bookSetId as any, "2026-03-31", "2026-04-01")).planHash, confirm: true } })).rejects.toMatchObject({ code: "PERIOD_OVERLAP" });
  });

  it("requires an explicit override for unresolved reconciliation findings and isolates tenant scope", async () => {
    const input = await setup();
    const imported = await input.application.bankStatement.import({
      schemaVersion: 1,
      tenantId: input.tenantId as any,
      bookSetId: input.bookSetId as any,
      requestId: randomUUID(),
      actor: { kind: "HUMAN", id: "owner" },
      source: "CLI",
      reason: "period close checklist",
      payload: { bankAccountId: input.cash as any, externalStatementId: "CLOSE-CHECK", periodStart: "2026-02-01", periodEnd: "2026-02-28", openingBalanceMinor: 0, closingBalanceMinor: 1, rows: [{ lineNumber: 1, transactionDate: "2026-02-15", description: "Unmatched fictional line", signedAmountMinor: 1 }] },
    });
    expect(JSON.parse(imported.resultJson).statementId).toBeString();
    const preview = await input.application.periodClose.preview(input.tenantId as any, input.bookSetId as any, "2026-01-01", "2026-03-31");
    expect(preview.snapshot.checklist).toEqual([expect.objectContaining({ code: "BANK_RECONCILIATION_UNRESOLVED", count: 1 })]);
    const base = { schemaVersion: 1 as const, tenantId: input.tenantId as any, bookSetId: input.bookSetId as any, actor: { kind: "HUMAN" as const, id: "owner" }, source: "CLI" as const, reason: "owner approved close", payload: { periodStart: "2026-01-01", periodEnd: "2026-03-31", planHash: preview.planHash, confirm: true } };
    await expect(input.application.periodClose.close({ ...base, requestId: randomUUID() })).rejects.toMatchObject({ code: "PERIOD_CLOSE_OVERRIDE_REQUIRED" });
    const closed = await input.application.periodClose.close({ ...base, requestId: randomUUID(), payload: { ...base.payload, overrideReason: "Owner accepted unmatched fictional bank line for review" } });
    expect(JSON.parse(closed.resultJson)).toMatchObject({ eventType: "CLOSED", status: "CLOSED" });
    await expect(input.application.periodClose.preview("other-tenant" as any, input.bookSetId as any, "2026-01-01", "2026-03-31")).rejects.toMatchObject({ code: "BOOK_SET_NOT_FOUND" });
  });
});
