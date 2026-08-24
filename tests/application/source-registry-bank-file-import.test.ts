import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { initializeAndUpgradeSqliteApplication, createSqliteApplication } from "../../src/application/application.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";
import { findOperation } from "../../src/transport/catalog.ts";
import { mcpTools } from "../../src/transport/mcp-server.ts";

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
      "1234567890,Source Co,\"12 Main St, Mumbai\",INR,01 Apr 2026,\"Opening, receipt\",0.00,100.00,1100.00",
      "1234567890,Source Co,\"12 Main St, Mumbai\",INR,02 Apr 2026,Payment,50.00,0.00,1050.00",
      "1234567890,Source Co,\"12 Main St, Mumbai\",INR,02 Apr 2026,Closing Balance,,,1050.00",
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
    const filePath = join(sourceRoot, "craze.csv"); await writeFile(filePath, ["Date,Party Name,Transaction Type,Description,Status,Debit,Credit,Balance", '"May 01, 2026",Wallet,TRANSFER,Top up,SETTLED,0.00,250.50,1250.50', '"May 2, 2026",Wallet,TRANSFER,Fee,SETTLED,10.50,0.00,1240.00'].join("\n"));
    const base = { tenantId: created.tenantId, bookSetId: created.defaultBookSetId, bankAccountId: created.seedAccountIds.cash, parserId: "CRAZE_VIRTUAL_ACCOUNT_CSV_V1" as const, filePath };
    const preview = await app.bankStatement.inspectFile(envelope(created.tenantId, created.defaultBookSetId, base)); expect(preview.transactionCount).toBe(2); expect(preview.closingBalanceMinor).toBe(124_000);
    await writeFile(filePath, ["Date,Party Name,Transaction Type,Description,Status,Debit,Credit,Balance", '"May 01, 2026",Wallet,TRANSFER,Top up,SETTLED,1.00,2.00,100.00'].join("\n"));
    await expect(app.bankStatement.inspectFile(envelope(created.tenantId, created.defaultBookSetId, base))).rejects.toMatchObject({ code: "INVALID_BANK_ROW" });
    await writeFile(filePath, ["Date,Party Name,Transaction Type,Description,Status,Debit,Credit,Balance", '"Jax 01, 2026",Wallet,TRANSFER,Top up,SETTLED,,250.50,1250.50'].join("\n"));
    await expect(app.bankStatement.inspectFile(envelope(created.tenantId, created.defaultBookSetId, base))).rejects.toMatchObject({ code: "INVALID_DATE" });
    const outside = join(directory!, "outside.csv"); await writeFile(outside, "not used");
    await expect(app.bankStatement.inspectFile(envelope(created.tenantId, created.defaultBookSetId, { ...base, filePath: outside }))).rejects.toMatchObject({ code: "SOURCE_PATH_OUTSIDE_ROOT" });
  });

  it("imports a continuity-proven subset while registering the complete source and distinguishes range replays", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-subset-")); const sourceRoot = join(directory, "sources"); await mkdir(sourceRoot, { recursive: true }); const dbPath = join(directory, "books.sqlite");
    const bootstrap = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const created = JSON.parse((await bootstrap.tenant.create(envelope("bootstrap", "ignored", { kind: "COMPANY", name: "Subset Co" }))).resultJson) as { tenantId: string; defaultBookSetId: string }; const app = createSqliteApplication(dbPath, 1, 1, sourceRoot);
    const account = await app.account.create(envelope(created.tenantId, created.defaultBookSetId, { code: "1020", name: "Subset Bank", accountType: "ASSET", kind: "BANK" })); const bankAccountId = (JSON.parse(account.resultJson) as { accountId: string }).accountId;
    const filePath = join(sourceRoot, "scb-subset.csv"); await writeFile(filePath, ["Account Number,Account Name,Address,Currency,Date,Description,Withdrawal,Deposit,Balance", "9876543210,Subset Co,Private,INR,01 Apr 2026,Before,0.00,100.00,1100.00", "9876543210,Subset Co,Private,INR,02 Apr 2026,Inside,50.00,0.00,1050.00", "9876543210,Subset Co,Private,INR,02 Apr 2026,Closing Balance,0.00,0.00,1050.00"].join("\n"));
    const base = { tenantId: created.tenantId, bookSetId: created.defaultBookSetId, bankAccountId, parserId: "SCB_TRANSACTION_CSV_V1" as const, filePath, periodStart: "2026-04-02", periodEnd: "2026-04-02" };
    const preview = await app.bankStatement.inspectFile(envelope(created.tenantId, created.defaultBookSetId, base)); expect(preview.fullSourceRowCount).toBe(3); expect(preview.fullSourceTransactionCount).toBe(2); expect(preview.importedRowCount).toBe(1); expect(preview.excludedPrePeriodRowCount).toBe(1); expect(preview.excludedPostPeriodRowCount).toBe(0); expect(preview.openingBalanceMinor).toBe(110_000); expect(preview.closingBalanceMinor).toBe(105_000); expect(preview.rows[0]?.transactionDate).toBe("2026-04-02");
    const imported = await app.bankStatement.importFile(envelope(created.tenantId, created.defaultBookSetId, base, "subset-import")); const result = JSON.parse(imported.resultJson) as { sourceId: string; statementId: string; importedRowCount: number; fullSourceRowCount: number }; expect(result.importedRowCount).toBe(1); expect(result.fullSourceRowCount).toBe(3); expect((await app.bankStatement.get(created.tenantId as never, created.defaultBookSetId as never, result.statementId)).lines).toHaveLength(1);
    const conflict = { ...base, periodStart: "2026-04-01", periodEnd: "2026-04-02" }; await expect(app.bankStatement.importFile(envelope(created.tenantId, created.defaultBookSetId, conflict, "subset-import"))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const full = await app.bankStatement.importFile(envelope(created.tenantId, created.defaultBookSetId, conflict, "full-import")); expect(JSON.parse(full.resultJson).sourceId).toBe(result.sourceId); expect(JSON.parse(full.resultJson).statementId).not.toBe(result.statementId);
    await expect(app.bankStatement.inspectFile(envelope(created.tenantId, created.defaultBookSetId, { ...base, periodStart: "2026-03-30", periodEnd: "2026-03-31" }))).rejects.toMatchObject({ code: "IMPORT_PERIOD_UNPROVABLE" });
  });

  it("excludes 52 post-financial-year Craze rows from an FY subset", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-fy-")); const sourceRoot = join(directory, "sources"); await mkdir(sourceRoot, { recursive: true }); const dbPath = join(directory, "books.sqlite");
    const bootstrap = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const created = JSON.parse((await bootstrap.tenant.create(envelope("bootstrap", "ignored", { kind: "COMPANY", name: "FY Co" }))).resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { cash: string } }; const app = createSqliteApplication(dbPath, 1, 1, sourceRoot);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; const crazeDate = (date: Date) => `${monthNames[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, "0")}, ${date.getUTCFullYear()}`;
    const rows = ['"Date",Party Name,Transaction Type,Description,Status,Debit,Credit,Balance', `"Apr 01, 2025",Wallet,TRANSFER,FY opening,SETTLED,0.00,100.00,100.00`, `"Mar 31, 2026",Wallet,TRANSFER,FY closing,SETTLED,0.00,50.00,150.00`];
    for (let index = 0; index < 52; index += 1) rows.push(`"${crazeDate(new Date(Date.UTC(2026, 3, 1 + index)))}",Wallet,TRANSFER,Post FY ${index + 1},SETTLED,0.00,1.00,${151 + index}.00`);
    const filePath = join(sourceRoot, "craze-fy.csv"); await writeFile(filePath, rows.join("\n"));
    const base = { tenantId: created.tenantId, bookSetId: created.defaultBookSetId, bankAccountId: created.seedAccountIds.cash, parserId: "CRAZE_VIRTUAL_ACCOUNT_CSV_V1" as const, filePath, periodStart: "2025-04-01", periodEnd: "2026-03-31" };
    const preview = await app.bankStatement.inspectFile(envelope(created.tenantId, created.defaultBookSetId, base)); expect(preview.fullSourceRowCount).toBe(54); expect(preview.importedRowCount).toBe(2); expect(preview.excludedPrePeriodRowCount).toBe(0); expect(preview.excludedPostPeriodRowCount).toBe(52); expect(preview.closingBalanceMinor).toBe(15_000); expect(preview.rows.at(-1)?.transactionDate).toBe("2026-03-31");
  });

  it("advertises the optional inclusive period filter in the shared CLI/MCP operation schemas", () => {
    for (const operationId of ["source.inspect-file", "bank-statement.import-file"]) {
      const operation = findOperation(operationId); const payload = operation?.inputSchema.properties?.payload as { properties?: Record<string, unknown>; required?: string[] };
      expect(payload.properties?.periodStart).toEqual({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }); expect(payload.properties?.periodEnd).toEqual({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }); expect(payload.required).not.toContain("periodStart"); expect(payload.required).not.toContain("periodEnd");
      const mcpTool = mcpTools().find((tool) => tool.name === operationId); expect((mcpTool?.inputSchema.properties?.payload as { properties?: Record<string, unknown> }).properties?.periodStart).toEqual({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
    }
  });
});
