import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database as BunDatabase } from "bun:sqlite";
import { bootstrapSqliteApplication } from "../../src/application/application.ts";

describe("journal.post and ledger reports", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("posts through the public facade and reports balanced books", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-journal-"));
    const dbPath = join(directory, "ledger.sqlite");
    const application = await bootstrapSqliteApplication(dbPath, {
      backupDestinationPath: join(directory, "bootstrap.sqlite"),
      cliVersion: "test",
      buildId: "journal-test",
    });
    const created = await application.tenant.create({
      schemaVersion: 1,
      tenantId: "bootstrap" as any,
      requestId: randomUUID(),
      actor: { kind: "SYSTEM", id: "test" },
      source: "INTERNAL",
      reason: "create ledger tenant",
      payload: { kind: "COMPANY", name: "Ledger Co", baseCurrency: "INR" },
    });
    const createdData = JSON.parse(created.resultJson) as { tenantId: string; defaultBookSetId: string };
    const cash = await application.account.getByCode("1100", createdData.tenantId as any, createdData.defaultBookSetId as any);
    const equity = await application.account.getByCode("3000", createdData.tenantId as any, createdData.defaultBookSetId as any);
    const expense = await application.account.getByCode("5000", createdData.tenantId as any, createdData.defaultBookSetId as any);
    expect(cash?.name).toBe("Cash");
    expect(equity?.name).toBe("Equity");
    expect(expense?.name).toBe("Expenses");

    const envelope = (requestId: string, lines: { accountId: any; debitMinor?: number; creditMinor?: number }[]) => ({
      schemaVersion: 1 as const,
      tenantId: createdData.tenantId as any,
      bookSetId: createdData.defaultBookSetId as any,
      requestId,
      actor: { kind: "HUMAN" as const, id: "owner" },
      source: "CLI" as const,
      reason: "manual journal",
      payload: { postingDate: "2026-08-23", lines },
    });

    const first = await application.journal.post(envelope(randomUUID(), [
      { accountId: cash!.id, debitMinor: 100_000 },
      { accountId: equity!.id, creditMinor: 100_000 },
    ]));
    const second = await application.journal.post(envelope(randomUUID(), [
      { accountId: expense!.id, debitMinor: 25_000 },
      { accountId: cash!.id, creditMinor: 25_000 },
    ]));
    expect(JSON.parse(first.resultJson).status).toBe("POSTED");
    expect(JSON.parse(second.resultJson).status).toBe("POSTED");
    const writable = new BunDatabase(dbPath);
    expect(() => writable.query("UPDATE journal_entries SET narration = 'changed' WHERE id = ?").run(JSON.parse(first.resultJson).journalId)).toThrow();
    writable.close();

    const trialBalance = await application.ledger.trialBalance(createdData.tenantId as any, createdData.defaultBookSetId as any, "2026-08-23");
    expect(trialBalance.totalDebitMinor).toBe(125_000);
    expect(trialBalance.totalCreditMinor).toBe(125_000);
    expect(trialBalance.isBalanced).toBe(true);

    const profitAndLoss = await application.ledger.profitAndLoss(createdData.tenantId as any, createdData.defaultBookSetId as any, "2026-01-01", "2026-08-23");
    expect(profitAndLoss.expenseMinor).toBe(25_000);
    expect(profitAndLoss.netProfitLossMinor).toBe(-25_000);

    const balanceSheet = await application.ledger.balanceSheet(createdData.tenantId as any, createdData.defaultBookSetId as any, "2026-08-23");
    expect(balanceSheet.assets.find((row) => row.code === "1100")?.balanceMinor).toBe(75_000);
    expect(balanceSheet.totalEquityMinor).toBe(100_000);
    expect(balanceSheet.currentPeriodResultMinor).toBe(-25_000);
    expect(balanceSheet.isBalanced).toBe(true);
  });

  it("rejects invalid and cross-BookSet posts without side effects", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-journal-reject-"));
    const dbPath = join(directory, "ledger.sqlite");
    const application = await bootstrapSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const created = await application.tenant.create({
      schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "INDIVIDUAL", name: "Reject Co" },
    });
    const data = JSON.parse(created.resultJson) as { tenantId: string; defaultBookSetId: string };
    const cash = await application.account.getByCode("1100", data.tenantId as any, data.defaultBookSetId as any);
    const equity = await application.account.getByCode("3000", data.tenantId as any, data.defaultBookSetId as any);
    const base = { schemaVersion: 1 as const, tenantId: data.tenantId as any, bookSetId: data.defaultBookSetId as any, actor: { kind: "HUMAN" as const, id: "owner" }, source: "CLI" as const, reason: "reject test", payload: { postingDate: "2026-08-23", lines: [{ accountId: cash!.id, debitMinor: 10 }, { accountId: equity!.id, creditMinor: 9 }] } };
    await expect(application.journal.post({ ...base, requestId: randomUUID() })).rejects.toMatchObject({ code: "UNBALANCED_POSTING" });

    const secondBookSet = await application.bookSet.create({
      schemaVersion: 1, tenantId: data.tenantId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "owner" }, source: "CLI", reason: "create second BookSet", payload: { kind: "PROPRIETORSHIP", displayName: "Other books" },
    });
    const secondBookSetId = JSON.parse(secondBookSet.resultJson).bookSetId;
    await expect(application.journal.post({ ...base, bookSetId: secondBookSetId, requestId: randomUUID(), payload: { ...base.payload, lines: [{ accountId: cash!.id, debitMinor: 10 }, { accountId: equity!.id, creditMinor: 10 }] } })).rejects.toMatchObject({ code: "ACCOUNT_SCOPE_MISMATCH" });

    const native = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
    expect(native.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual({ count: 0n });
    expect(native.query("SELECT COUNT(*) AS count FROM audit_records WHERE command = 'journal.post'").get()).toEqual({ count: 0n });
    native.close();
  });

  it("replays a journal command with the exact stored result", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-journal-replay-"));
    const dbPath = join(directory, "ledger.sqlite");
    const application = await bootstrapSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const created = await application.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "Replay Co" } });
    const data = JSON.parse(created.resultJson) as { tenantId: string; defaultBookSetId: string };
    const cash = await application.account.getByCode("1100", data.tenantId as any, data.defaultBookSetId as any);
    const equity = await application.account.getByCode("3000", data.tenantId as any, data.defaultBookSetId as any);
    const command = { schemaVersion: 1 as const, tenantId: data.tenantId as any, bookSetId: data.defaultBookSetId as any, requestId: randomUUID(), actor: { kind: "HUMAN" as const, id: "owner" }, source: "CLI" as const, reason: "replay", payload: { postingDate: "2026-08-23", lines: [{ accountId: cash!.id, debitMinor: 1_000 }, { accountId: equity!.id, creditMinor: 1_000 }] } };
    const first = await application.journal.post(command);
    const replay = await application.journal.post(command);
    expect(replay.replayed).toBe(true);
    expect(replay.resultJson).toBe(first.resultJson);
    expect(replay.resultHash).toBe(first.resultHash);
  });
});
