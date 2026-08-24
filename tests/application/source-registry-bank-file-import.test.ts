import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { initializeAndUpgradeSqliteApplication, createSqliteApplication } from "../../src/application/application.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

function envelope<T>(tenantId: string, bookSetId: string, payload: T, requestId: string = randomUUID()) {
  return { schemaVersion: 1 as const, tenantId: tenantId as never, bookSetId: bookSetId as never, requestId, actor: { kind: "HUMAN" as const, id: "source-test" }, source: "CLI" as const, reason: "synthetic source fixture", payload };
}

describe("local source registry and bank file import V1", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it("previews quoted SCB rows, excludes the closing-only row, and imports without journals", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-"));
    const sourceRoot = join(directory, "sources"); await mkdir(sourceRoot, { recursive: true });
    const dbPath = join(directory, "books.sqlite");
    const bootstrap = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const created = JSON.parse((await bootstrap.tenant.create(envelope("bootstrap", "ignored", { kind: "COMPANY", name: "Source Co" }))).resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { cash: string } };
    const filePath = join(sourceRoot, "scb.csv");
    await writeFile(filePath, [
      "Account Number,Account Name,Address,Currency,Date,Description,Withdrawal,Deposit,Balance",
      "1234567890,Source Co,\"12 Main St, Mumbai\",INR,2026-04-01,\"Opening, receipt\",,100.00,1100.00",
      "1234567890,Source Co,\"12 Main St, Mumbai\",INR,2026-04-02,Payment,50.00,,1050.00",
      "1234567890,Source Co,\"12 Main St, Mumbai\",INR,,,,,1050.00",
    ].join("\n"));
    const app = createSqliteApplication(dbPath, 1, 1, sourceRoot);
    const account = await app.account.create(envelope(created.tenantId, created.defaultBookSetId, { code: "1010", name: "Operating Bank", accountType: "ASSET", kind: "BANK" }));
    const bankAccountId = (JSON.parse(account.resultJson) as { accountId: string }).accountId;
    const base = { tenantId: created.tenantId, bookSetId: created.defaultBookSetId, bankAccountId, parserId: "SCB_TRANSACTION_CSV_V1" as const, filePath };
    const preview = await app.bankStatement.inspectFile(envelope(created.tenantId, created.defaultBookSetId, base));
    expect(preview.status).toBe("PREVIEW"); expect(preview.postsJournal).toBe(false); expect(preview.transactionCount).toBe(2); expect(preview.closingBalanceRowExcluded).toBe(true); expect(preview.rows[0]?.description).toBe("Opening, receipt"); expect(preview.openingBalanceMinor).toBe(100_000); expect(preview.closingBalanceMinor).toBe(105_000);
    const imported = await app.bankStatement.importFile(envelope(created.tenantId, created.defaultBookSetId, base, "file-import-1"));
    const result = JSON.parse(imported.resultJson) as { sourceId: string; statementId: string; postsJournal: boolean; sourceContentHash: string };
    expect(result.postsJournal).toBe(false); expect(result.sourceContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await app.bankStatement.get(created.tenantId as never, created.defaultBookSetId as never, result.statementId)).lines).toHaveLength(2);
    const replay = await app.bankStatement.importFile(envelope(created.tenantId, created.defaultBookSetId, base, "file-import-2")); expect(JSON.parse(replay.resultJson).sourceId).toBe(result.sourceId);
    const transportPreview = await new OperationDispatcher({ databasePath: dbPath, sourceRoot, source: "CLI" }).dispatch("source.inspect-file", envelope(created.tenantId, created.defaultBookSetId, base, "transport-preview"));
    expect(transportPreview.ok).toBe(true);
  });

  it("parses CRAZE files and rejects malformed, imbalanced, duplicate, and unsafe inputs", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-negative-")); const sourceRoot = join(directory, "sources"); await mkdir(sourceRoot, { recursive: true }); const dbPath = join(directory, "books.sqlite");
    const bootstrap = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const created = JSON.parse((await bootstrap.tenant.create(envelope("bootstrap", "ignored", { kind: "COMPANY", name: "Craze Co" }))).resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { cash: string } }; const app = createSqliteApplication(dbPath, 1, 1, sourceRoot);
    const filePath = join(sourceRoot, "craze.csv"); await writeFile(filePath, ["Date,Party Name,Transaction Type,Description,Status,Debit,Credit,Balance", "2026-05-01,Wallet,TRANSFER,Top up,SETTLED,,250.50,1250.50", "2026-05-02,Wallet,TRANSFER,Fee,SETTLED,10.50,,1240.00"].join("\n"));
    const base = { tenantId: created.tenantId, bookSetId: created.defaultBookSetId, bankAccountId: created.seedAccountIds.cash, parserId: "CRAZE_VIRTUAL_ACCOUNT_CSV_V1" as const, filePath };
    const preview = await app.bankStatement.inspectFile(envelope(created.tenantId, created.defaultBookSetId, base)); expect(preview.transactionCount).toBe(2); expect(preview.closingBalanceMinor).toBe(124_000);
    await writeFile(filePath, ["Date,Party Name,Transaction Type,Description,Status,Debit,Credit,Balance", "2026-05-01,Wallet,TRANSFER,Top up,SETTLED,1.00,2.00,100.00"].join("\n"));
    await expect(app.bankStatement.inspectFile(envelope(created.tenantId, created.defaultBookSetId, base))).rejects.toMatchObject({ code: "INVALID_BANK_ROW" });
    const outside = join(directory!, "outside.csv"); await writeFile(outside, "not used");
    await expect(app.bankStatement.inspectFile(envelope(created.tenantId, created.defaultBookSetId, { ...base, filePath: outside }))).rejects.toMatchObject({ code: "SOURCE_PATH_OUTSIDE_ROOT" });
  });
});
