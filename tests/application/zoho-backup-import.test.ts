import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database as BunDatabase } from "bun:sqlite";
import { createSqliteApplication, initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { parseZohoCsv } from "../../src/application/services/zoho-backup-import-service.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

function envelope<T>(tenantId: string, bookSetId: string, payload: T, requestId: string = randomUUID()) { return { schemaVersion: 1 as const, tenantId: tenantId as never, bookSetId: bookSetId as never, requestId, actor: { kind: "HUMAN" as const, id: "zoho-test" }, source: "CLI" as const, reason: "synthetic Zoho fixture", payload }; }

describe("Zoho Books backup/CSV import V1", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it("parses multiline RFC4180 cells and preserves duplicate headers by ordinal", () => {
    const parsed = parseZohoCsv(new TextEncoder().encode('id,Payment Type,Payment Type,note\n1,CARD,CASH,"line 1\nline 2"\n'));
    expect(parsed.headers).toEqual(["id", "Payment Type", "Payment Type", "note"]);
    expect(parsed.rows[0]).toEqual(["1", "CARD", "CASH", "line 1\nline 2"]);
  });

  it("previews and human-confirms a privacy-safe synthetic 44-file export without posting", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-zoho-"));
    const sourceRoot = join(directory, "sources"); await mkdir(sourceRoot, { recursive: true });
    const names = ["Account", "Activity", "Attachment", "BankCharges", "Bill", "BillLineItem", "Contact", "CreditMemo", "Credit_Note", "Currency", "Customer", "CustomerDocument", "Customer_Payment", "Deal", "Deposit", "Document", "Estimate", "EstimateLineItem", "ExpenseCategory", "ExportHistory", "FiscalYear", "Invoice", "InvoiceLineItem", "ItemGroup", "Journal", "JournalLineItem", "LineItemTax", "Note", "Organisation", "Payment", "PaymentItem", "PaymentMethod", "PurchaseOrder", "PurchaseOrderLineItem", "SalesOrder", "SalesOrderLineItem", "SalesReceipt", "SalesReceiptLineItem", "TaxItem", "TaxRate", "User", "UserRole", "VendorCredit", "Warehouse"];
    for (const [index, name] of names.entries()) { const header = name === "Customer_Payment" ? "id,Payment Type,Payment Type,amount,Date" : "id,status,amount,Date"; const row = name === "Customer_Payment" ? `z-${index},CARD,CASH,10.00,2026-04-01` : `z-${index},ACTIVE,10.00,2026-04-01`; await writeFile(join(sourceRoot, `${name}.csv`), `${header}\n${row}\n`); }
    const dbPath = join(directory, "books.sqlite"); const bootstrap = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const created = JSON.parse((await bootstrap.tenant.create(envelope("bootstrap", "ignored", { kind: "COMPANY", name: "Zoho Fixture Co" }))).resultJson) as { tenantId: string; defaultBookSetId: string };
    const app = createSqliteApplication(dbPath, 1, 1, sourceRoot); const payload = { sourcePath: sourceRoot, periodStart: "2026-04-01", periodEnd: "2026-04-30", entityName: "Synthetic Fixture" };
    const preview = await app.zohoBackup.preview(envelope(created.tenantId, created.defaultBookSetId, payload));
    expect(preview.files).toHaveLength(44); expect(preview.rows.staged).toBe(13); expect(preview.rows.unsupported).toBe(31); expect(preview.rows.rejected).toBe(0); expect(preview.postsJournal).toBe(false); expect(preview.warnings.some((warning) => warning.includes("DUPLICATE_HEADER"))).toBe(true); expect(preview.files.find((file) => file.objectType === "Customer_Payment")?.outcomes).toEqual({ accepted: 0, staged: 1, rejected: 0, unsupported: 0, reasons: { SOURCE_STAGED_NO_POSTING_SEMANTICS: 1 } });
    const before = new BunDatabase(dbPath, { readonly: true, safeIntegers: true }); expect(before.query("SELECT COUNT(*) AS count FROM zoho_backup_imports").get()).toEqual({ count: 0n }); before.close();
    const imported = await app.zohoBackup.import(envelope(created.tenantId, created.defaultBookSetId, { ...payload, confirm: true }, "zoho-import-1")); const report = JSON.parse(imported.resultJson) as { importId: string; status: string; posted: number; stagedOnly: number };
    expect(report.status).toBe("PARTIAL"); expect(report.posted).toBe(0); expect(report.stagedOnly).toBe(13);
    expect((await app.zohoBackup.status(created.tenantId as never, created.defaultBookSetId as never, report.importId)).reportHash).toMatch(/^[0-9a-f]{64}$/);
    const replay = await app.zohoBackup.import(envelope(created.tenantId, created.defaultBookSetId, { ...payload, confirm: true }, "zoho-import-1")); expect(replay.replayed).toBe(true); expect(replay.resultJson).toBe(imported.resultJson);
    const transport = await new OperationDispatcher({ databasePath: dbPath, sourceRoot, source: "CLI" }).dispatch("zoho-backup.status", { tenantId: created.tenantId, bookSetId: created.defaultBookSetId, importId: report.importId }); expect(transport.ok).toBe(true);
  });

  it("fails closed for malformed CSV, cross-entity evidence, and non-human import confirmation", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-zoho-negative-")); const sourceRoot = join(directory, "sources"); await mkdir(sourceRoot, { recursive: true }); const dbPath = join(directory, "books.sqlite");
    const bootstrap = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const created = JSON.parse((await bootstrap.tenant.create(envelope("bootstrap", "ignored", { kind: "COMPANY", name: "Zoho Negative Co" }))).resultJson) as { tenantId: string; defaultBookSetId: string }; const app = createSqliteApplication(dbPath, 1, 1, sourceRoot);
    const bad = join(sourceRoot, "Invoice.csv"); await writeFile(bad, "id,status\n\"unterminated\n"); await expect(app.zohoBackup.preview(envelope(created.tenantId, created.defaultBookSetId, { sourcePath: bad }))).rejects.toMatchObject({ code: "MALFORMED_CSV" });
    await writeFile(bad, "id,organization_id,status,amount,Date\ninv-1,other-org,ACTIVE,1.00,2026-04-01\n"); await expect(app.zohoBackup.preview(envelope(created.tenantId, created.defaultBookSetId, { sourcePath: bad, entityId: "this-org" }))).rejects.toMatchObject({ code: "CROSS_ENTITY_SOURCE" });
    await writeFile(bad, "id,status,amount,Date\ninv-1,ACTIVE,1.00,2026-04-01\n"); const agent = { ...envelope(created.tenantId, created.defaultBookSetId, { sourcePath: bad, confirm: true }), actor: { kind: "AGENT" as const, id: "agent" } }; await expect(app.zohoBackup.import(agent)).rejects.toMatchObject({ code: "HUMAN_CONFIRMATION_REQUIRED" });
  });

  it("stages real Zoho export labels without treating rates, quantities, or tax names as currency", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-zoho-labels-")); const sourceRoot = join(directory, "sources"); await mkdir(sourceRoot, { recursive: true }); const dbPath = join(directory, "books.sqlite");
    const bootstrap = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const created = JSON.parse((await bootstrap.tenant.create(envelope("bootstrap", "ignored", { kind: "COMPANY", name: "Zoho Labels Fixture" }))).resultJson) as { tenantId: string; defaultBookSetId: string }; const app = createSqliteApplication(dbPath, 1, 1, sourceRoot);
    await writeFile(join(sourceRoot, "Deposit.csv"), "Transaction Date,From Account,To Account,Tax,Bank Charges,Total\n2025-04-01,Cash,Revenue,GST 18%,N/A,10.00\n");
    await writeFile(join(sourceRoot, "Invoice.csv"), "Invoice Date,Invoice ID,Tax Name,Tax Amount,Quantity,Rate,Item Total\n2025-04-02,invoice-1,GST 18%,not-a-number,1.000,123.4567,10.00\n");
    await writeFile(join(sourceRoot, "Journal.csv"), "Journal ID,Status,Tax Amount\njournal-1,PUBLISHED,-\n");
    const preview = await app.zohoBackup.preview(envelope(created.tenantId, created.defaultBookSetId, { sourcePath: sourceRoot }));
    expect(preview.rows).toEqual({ accepted: 0, staged: 3, rejected: 0, unsupported: 0 });
    expect(preview.files.find((file) => file.objectType === "Deposit")?.outcomes.reasons).toEqual({ SOURCE_ROW_FINGERPRINT_ID: 1 });
    expect(preview.files.find((file) => file.objectType === "Invoice")?.outcomes.reasons).toEqual({ "SOURCE_STAGED_WITH_UNVALIDATED_FIELD:tax_amount": 1 });
    expect(preview.files.find((file) => file.objectType === "Journal")?.outcomes.reasons).toEqual({ SOURCE_STAGED_WITH_UNSUPPORTED_STATUS: 1 });
  });
});
