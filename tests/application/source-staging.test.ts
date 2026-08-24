import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createSqliteApplication, initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import type { SourceStagingPayload } from "../../src/application/services/source-staging-service.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

const header = "entity,bank,account_alias,statement_period,record_type,transaction_date,value_date,description,debit_inr,credit_inr,balance_inr,source_pdf,source_gmail_message_id,parse_status,classification,reconciliation_status";
function envelope(tenantId: string, bookSetId: string, payload: SourceStagingPayload, requestId = "stage-1") { return { schemaVersion: 1 as const, tenantId: tenantId as never, bookSetId: bookSetId as never, requestId, actor: { kind: "HUMAN" as const, id: "source-stage-test" }, source: "CLI" as const, reason: "privacy-safe source staging test", payload }; }

describe("Source Staging V1", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it("previews and stages only valid derived CSV rows, replays without duplication, and never posts a journal", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-stage-"));
    const sourceRoot = join(directory, "sources"); await mkdir(sourceRoot);
    const csv = join(sourceRoot, "derived.csv"); await writeFile(csv, `${header}\nentity,bank,alias,2025-26,TRANSACTION,2025-04-01,2025-04-01,private description,10.00,,100.00,private.pdf,message,PARSED,OTHER,UNMATCHED\nentity,bank,alias,2025-04-02,TRANSACTION,2025-04-02,2025-04-02,private description,,10.00,110.00,private.pdf,message,PARSED,OTHER,UNMATCHED\nentity,bank,alias,2025-04-03,TRANSACTION,2025-04-03,2025-04-03,private description,bad,,120.00,private.pdf,message,PARSED,OTHER,UNMATCHED\n`);
    const dbPath = join(directory, "books.sqlite"); const bootstrap = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenant = JSON.parse((await bootstrap.tenant.create({ schemaVersion: 1, tenantId: "source-test" as never, requestId: "tenant", actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "test", payload: { kind: "COMPANY", name: "Source Fixture" } })).resultJson) as { tenantId: string; defaultBookSetId: string };
    const app = createSqliteApplication(dbPath, 1, 1, sourceRoot); const command = envelope(tenant.tenantId, tenant.defaultBookSetId, { sourcePath: csv, parserId: "SCB_DERIVED_TRANSACTION_CSV_V1" });
    const preview = app.sourceStaging.preview(command); expect(preview.headerFingerprint).toBe("e0b16c6c30e57b0de33410c4d4bd03905ff7da123e0803a1ec740b6dbb60c978"); expect(preview.rows).toEqual({ staged: 2, rejected: 1, unsupported: 0 }); expect(preview.facts[0]?.fact).not.toHaveProperty("description");
    const staged = await app.sourceStaging.stage(command); const report = JSON.parse(staged.resultJson) as { stagingId: string; rows: { staged: number; rejected: number; unsupported: number }; postsJournal: false }; expect(report.rows).toEqual({ staged: 2, rejected: 1, unsupported: 0 }); expect(report.postsJournal).toBe(false);
    const exactReplay = await app.sourceStaging.stage(command); expect(exactReplay.replayed).toBe(true); expect(exactReplay.resultJson).toBe(staged.resultJson); const replay = await app.sourceStaging.stage(envelope(tenant.tenantId, tenant.defaultBookSetId, { sourcePath: csv, parserId: "SCB_DERIVED_TRANSACTION_CSV_V1" }, "stage-2")); expect(replay.replayed).toBe(true); expect(replay.resultJson).toBe(staged.resultJson);
    const status = await app.sourceStaging.status(tenant.tenantId as never, tenant.defaultBookSetId as never, report.stagingId); expect(status.reportHash).toMatch(/^[0-9a-f]{64}$/);
    const native = new Database(dbPath, { readonly: true, safeIntegers: true }); expect(native.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual({ count: 0n }); expect(native.query("SELECT COUNT(*) AS count FROM source_staging_facts").get()).toEqual({ count: 2n }); native.close();
    const cliEnvelope = await new OperationDispatcher({ databasePath: dbPath, sourceRoot, source: "CLI" }).dispatch("source-staging.status", { tenantId: tenant.tenantId, bookSetId: tenant.defaultBookSetId, stagingId: report.stagingId });
    const mcpEnvelope = await new OperationDispatcher({ databasePath: dbPath, sourceRoot, source: "MCP" }).dispatch("source-staging.status", { tenantId: tenant.tenantId, bookSetId: tenant.defaultBookSetId, stagingId: report.stagingId }); expect(mcpEnvelope).toEqual(cliEnvelope);
  });

  it("rejects unsafe roots and source symlinks without exposing source content", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-stage-path-")); const root = join(directory, "sources"); await mkdir(root); const outside = join(directory, "outside.csv"); await writeFile(outside, `${header}\n`); const link = join(root, "link.csv"); await symlink(outside, link);
    const dbPath = join(directory, "books.sqlite"); const bootstrap = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const tenant = JSON.parse((await bootstrap.tenant.create({ schemaVersion: 1, tenantId: "source-path-test" as never, requestId: "tenant", actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "test", payload: { kind: "COMPANY", name: "Path Fixture" } })).resultJson) as { tenantId: string; defaultBookSetId: string }; const app = createSqliteApplication(dbPath, 1, 1, root);
    expect(() => app.sourceStaging.preview(envelope(tenant.tenantId, tenant.defaultBookSetId, { sourcePath: link, parserId: "SCB_DERIVED_TRANSACTION_CSV_V1" }))).toThrow(/source file must be an existing regular non-symlink file/); expect(() => app.sourceStaging.preview(envelope(tenant.tenantId, tenant.defaultBookSetId, { sourcePath: outside, parserId: "SCB_DERIVED_TRANSACTION_CSV_V1" }))).toThrow(/outside the explicit operator sourceRoot/);
    expect(await readFile(outside, "utf8")).toContain("entity,bank");
  });

  it("stages only exact Munim receipt rows and ignores unrelated dates", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-receipt-parser-"));
    const sourceRoot = join(directory, "sources"); await mkdir(sourceRoot);
    const source = join(sourceRoot, "payment-received.pdf"); await writeFile(source, "synthetic receipt fixture");
    const extractor = join(directory, "extract-receipt-text.sh");
    const extracted = [
      "Payment Received Report",
      "Report date: 24-08-2026",
      "Period: 01-04-2025 to 31-03-2026",
      "01-04-2025 Customer One Other",
      "R1001",
      "01-04-2025 Customer Two NEFT",
      "R1002",
      "02-04-2025 Customer Three Net banking",
      "R1003",
      "03-04-2025 Customer Four Other",
      "R1004",
      "04-04-2025 Customer Five NEFT",
      "R1005",
      "05-04-2025 Customer Six Other",
      "R1006",
      "06-04-2025 Customer Seven NEFT",
      "R1007",
      "07-04-2025 Customer Eight Other",
      "R1008",
      "08-04-2025 Customer Nine NEFT",
      "R1009",
      "09-04-2025 Customer Ten Other",
      "R1010",
      "10-04-2025 Customer MissingId NEFT",
      "31-02-2025 Customer InvalidDate Other",
      "R1011",
      "12-04-2025 Customer BadMode Cash",
      "R1012",
      "Invoice Date: 13-04-2025",
      "Generated on: 14-04-2025",
      "Footer 15-04-2025",
    ].join("\n");
    await writeFile(extractor, `#!/bin/sh\nprintf '%s' '${extracted}'\n`); await chmod(extractor, 0o755);
    const dbPath = join(directory, "books.sqlite"); const bootstrap = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenant = JSON.parse((await bootstrap.tenant.create({ schemaVersion: 1, tenantId: "receipt-parser-test" as never, requestId: "tenant", actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "test", payload: { kind: "COMPANY", name: "Receipt Fixture" } })).resultJson) as { tenantId: string; defaultBookSetId: string };
    const previousExtractor = process.env.AGENT_BAHI_PDFTOTEXT; process.env.AGENT_BAHI_PDFTOTEXT = extractor;
    try {
      const app = createSqliteApplication(dbPath, 1, 1, sourceRoot); const command = envelope(tenant.tenantId, tenant.defaultBookSetId, { sourcePath: source, parserId: "MUNIM_PAYMENT_RECEIVED_PDF_V1" });
      const preview = app.sourceStaging.preview(command);
      expect(preview.rows).toEqual({ staged: 10, rejected: 3, unsupported: 0 });
      expect(preview.facts.filter((fact) => fact.outcome === "STAGED").map((fact) => fact.rowNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(preview.facts.filter((fact) => fact.outcome === "REJECTED").map((fact) => fact.reason)).toEqual(["MALFORMED_RECEIPT_ROW", "MALFORMED_RECEIPT_ROW", "MALFORMED_RECEIPT_ROW"]);
      expect(preview.facts.filter((fact) => fact.outcome === "STAGED").map((fact) => fact.fact.date)).toEqual(["2025-04-01", "2025-04-01", "2025-04-02", "2025-04-03", "2025-04-04", "2025-04-05", "2025-04-06", "2025-04-07", "2025-04-08", "2025-04-09"]);
      const staged = await app.sourceStaging.stage(command); expect(JSON.parse(staged.resultJson).rows).toEqual({ staged: 10, rejected: 3, unsupported: 0 });
      const native = new Database(dbPath, { readonly: true, safeIntegers: true }); expect(native.query("SELECT COUNT(*) AS count FROM source_staging_facts").get()).toEqual({ count: 10n }); expect(native.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual({ count: 0n }); native.close();
    } finally { if (previousExtractor === undefined) delete process.env.AGENT_BAHI_PDFTOTEXT; else process.env.AGENT_BAHI_PDFTOTEXT = previousExtractor; }
  });
});
