import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSqliteApplication, initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { OFFICIAL_DRIZZLE_MIGRATIONS } from "../../src/infrastructure/services/drizzle-baseline.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

function envelope(tenantId: string, requestId: string, payload: unknown, actor: "HUMAN" | "AGENT" = "HUMAN", source: "CLI" | "MCP" = "CLI") {
  return { schemaVersion: 1 as const, tenantId, requestId, actor: { kind: actor, id: `${actor.toLowerCase()}-facts` }, source, reason: "personal tax facts test", payload } as never;
}

async function scope(app: ReturnType<typeof createSqliteApplication>, suffix: string) {
  const tenant = JSON.parse((await app.tenant.create(envelope(`tenant-${suffix}`, randomUUID(), { kind: "INDIVIDUAL", name: `Individual ${suffix}` }))).resultJson);
  await app.tenant.activate(envelope(tenant.tenantId, randomUUID(), { defaultBookSetId: tenant.defaultBookSetId }));
  await app.tenant.pan.set(envelope(tenant.tenantId, randomUUID(), { pan: `ABCDE${suffix.padStart(4, "0").slice(-4)}F` }));
  const taxCaseId = `case-${suffix}`;
  await app.taxCase.create(envelope(tenant.tenantId, randomUUID(), { taxCaseId, financialYear: "2025-26", taxPeriod: "2025-26", filingTrigger: "ANNUAL", bookSetIds: [tenant.defaultBookSetId] }));
  const bytes = Buffer.from(`AIS artifact ${suffix}`);
  const source = JSON.parse((await app.taxCase.source.import(envelope(tenant.tenantId, randomUUID(), { taxCaseId, sourceKind: "AIS", mediaType: "text/plain", originalFilename: "ais.txt", contentBase64: bytes.toString("base64") }))).resultJson);
  return { tenantId: tenant.tenantId, bookSetId: tenant.defaultBookSetId, taxCaseId, sourceId: source.sourceId, artifactId: source.artifact.artifactId };
}

function factPayload(s: Awaited<ReturnType<typeof scope>>, key = "row-1", grossAmountMinor = 1000) {
  return { taxCaseId: s.taxCaseId, sourceId: s.sourceId, artifactId: s.artifactId, sourceRecordKey: key, kind: "TDS_CREDIT", rawSourceLabel: "TDS credit", rawSourceLocator: "page=1,row=1", eventDate: "2025-06-30", periodStart: "2025-04-01", periodEnd: "2026-03-31", originalCurrency: "INR", grossAmountMinor, taxAmountMinor: 100, counterpartyDisplay: { name: "Deductor" }, parserIdentity: "test-parser", parserVersion: "1", provenance: { agent: "test" }, normalizedPayload: { sourceValue: grossAmountMinor } };
}

async function journalLine(dbPath: string, s: Awaited<ReturnType<typeof scope>>, amountMinor = 1000) {
  const native = new Database(dbPath, { safeIntegers: true }); native.exec("PRAGMA foreign_keys = ON");
  const cash = native.query("SELECT id FROM accounts WHERE tenant_id = ? AND book_set_id = ? AND code = '1100'").get(s.tenantId, s.bookSetId) as { id: string };
  const equity = native.query("SELECT id FROM accounts WHERE tenant_id = ? AND book_set_id = ? AND code = '3000'").get(s.tenantId, s.bookSetId) as { id: string };
  const entryId = randomUUID(); const lineId = randomUUID();
  native.query("INSERT INTO journal_entries (id, tenant_id, book_set_id, posting_date, status, created_at, posted_at) VALUES (?, ?, ?, '2025-06-30', 'POSTED', ?, ?)").run(entryId, s.tenantId, s.bookSetId, "2025-06-30T00:00:00.000Z", "2025-06-30T00:00:00.000Z");
  native.query("INSERT INTO journal_lines (id, tenant_id, book_set_id, journal_entry_id, account_id, debit_minor, credit_minor) VALUES (?, ?, ?, ?, ?, ?, 0)").run(lineId, s.tenantId, s.bookSetId, entryId, cash.id, amountMinor);
  native.query("INSERT INTO journal_lines (id, tenant_id, book_set_id, journal_entry_id, account_id, debit_minor, credit_minor) VALUES (?, ?, ?, ?, ?, 0, ?)").run(randomUUID(), s.tenantId, s.bookSetId, entryId, equity.id, amountMinor);
  native.close(); return lineId;
}

describe("Personal Tax facts and reconciliation V1", () => {
  test("shows agent proposals, blocks agent decisions, confirms human facts, and reconciles without posting", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-facts-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "facts" }); const s = await scope(app, "1001");
      const proposed = JSON.parse((await app.taxCase.fact.propose(envelope(s.tenantId, "fact-propose", factPayload(s), "AGENT"))).resultJson);
      expect(proposed.lifecycle).toBe("PROPOSED"); expect(proposed.reviewStatus).toBe("REVIEW_REQUIRED"); expect(proposed.sourceId).toBe(s.sourceId); expect(proposed.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(await app.taxCase.fact.summary(s.tenantId, s.taxCaseId)).toMatchObject({ total: 1, proposed: 1, reviewRequired: 1, unmatched: 0, matched: 0 });
      await expect(app.taxCase.fact.confirm(envelope(s.tenantId, "agent-confirm", { taxCaseId: s.taxCaseId, factId: proposed.factId, reason: "agent" }, "AGENT"))).rejects.toMatchObject({ code: "TAX_FACT_HUMAN_REQUIRED" });
      const confirmed = JSON.parse((await app.taxCase.fact.confirm(envelope(s.tenantId, "human-confirm", { taxCaseId: s.taxCaseId, factId: proposed.factId, reason: "reviewed source" }))).resultJson); expect(confirmed.lifecycle).toBe("HUMAN_CONFIRMED");
      const lineId = await journalLine(dbPath, s); const before = new Database(dbPath, { readonly: true, safeIntegers: true }); const journalBefore = before.query("SELECT COUNT(*) AS count FROM journal_entries WHERE tenant_id = ? AND book_set_id = ?").get(s.tenantId, s.bookSetId); before.close();
      const partial = JSON.parse((await app.taxCase.reconciliation.record(envelope(s.tenantId, "recon-partial", { taxCaseId: s.taxCaseId, factId: proposed.factId, bookSetId: s.bookSetId, journalLineId: lineId, allocatedAmountMinor: 400, currency: "INR", reason: "partial match" }))).resultJson); expect(partial.posted).toBe(false);
      expect((await app.taxCase.fact.list(s.tenantId, s.taxCaseId))[0]).toMatchObject({ reconciliationStatus: "PARTIALLY_MATCHED", allocatedAmountMinor: 400, amountMismatch: true });
      await app.taxCase.reconciliation.record(envelope(s.tenantId, "recon-final", { taxCaseId: s.taxCaseId, factId: proposed.factId, bookSetId: s.bookSetId, journalLineId: lineId, allocatedAmountMinor: 600, currency: "INR", reason: "final match" }));
      expect((await app.taxCase.fact.summary(s.tenantId, s.taxCaseId))).toMatchObject({ total: 1, confirmed: 1, matched: 1, partiallyMatched: 0, amountMismatch: 0 });
      const after = new Database(dbPath, { readonly: true, safeIntegers: true }); expect(after.query("SELECT COUNT(*) AS count FROM journal_entries WHERE tenant_id = ? AND book_set_id = ?").get(s.tenantId, s.bookSetId)).toEqual(journalBefore); expect(after.query("PRAGMA foreign_key_check").all()).toEqual([]); after.close();
      const backupPath = join(directory, "facts.backup.sqlite"); const restoredPath = join(directory, "facts.restored.sqlite"); const backup = new BackupService(dbPath); await backup.createBackup(backupPath); await backup.restoreFromBackup(backupPath, restoredPath);
      const restored = new Database(restoredPath, { readonly: true, safeIntegers: true }); expect(restored.query("SELECT COUNT(*) AS count FROM tax_case_facts WHERE tenant_id = ?").get(s.tenantId)).toEqual({ count: 1n }); expect(restored.query("SELECT COUNT(*) AS count FROM tax_case_fact_reconciliations WHERE tenant_id = ?").get(s.tenantId)).toEqual({ count: 2n }); expect(restored.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: BigInt(OFFICIAL_DRIZZLE_MIGRATIONS.length) }); expect(restored.query("PRAGMA foreign_key_check").all()).toEqual([]); restored.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("deduplicates exact source payloads, conflicts on changed payloads, and preserves correction lineage", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-facts-dedupe-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "facts-dedupe" }); const s = await scope(app, "1002");
      const first = JSON.parse((await app.taxCase.fact.propose(envelope(s.tenantId, "fact-one", factPayload(s), "AGENT"))).resultJson);
      const duplicate = JSON.parse((await app.taxCase.fact.propose(envelope(s.tenantId, "fact-two", factPayload(s), "AGENT"))).resultJson); expect(duplicate).toMatchObject({ factId: first.factId, duplicate: true });
      const distinct = JSON.parse((await app.taxCase.fact.propose(envelope(s.tenantId, "fact-distinct", factPayload(s, "row-2", 1000), "AGENT"))).resultJson); expect(distinct.factId).not.toBe(first.factId);
      await expect(app.taxCase.fact.propose(envelope(s.tenantId, "fact-three", factPayload(s, "row-1", 2000), "AGENT"))).rejects.toMatchObject({ code: "TAX_FACT_DUPLICATE_CONFLICT" });
      const correction = JSON.parse((await app.taxCase.fact.propose(envelope(s.tenantId, "fact-four", { ...factPayload(s, "row-1", 2000), supersedesFactId: first.factId }, "AGENT"))).resultJson); expect(correction.supersedesFactId).toBe(first.factId); expect((await app.taxCase.fact.list(s.tenantId, s.taxCaseId))).toHaveLength(3);
      await expect(app.taxCase.fact.reject(envelope(s.tenantId, "reject-correction", { taxCaseId: s.taxCaseId, factId: correction.factId, reason: "not supported" }))).resolves.toBeDefined(); expect(await app.taxCase.fact.summary(s.tenantId, s.taxCaseId)).toMatchObject({ rejected: 1, proposed: 2 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("rejects cross-tenant and cross-BookSet references and keeps CLI/MCP parity", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-facts-scope-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "facts-scope" }); const first = await scope(app, "1003"); const second = await scope(app, "1004");
      await expect(app.taxCase.fact.propose(envelope(first.tenantId, "cross-source", { ...factPayload(first), sourceId: second.sourceId, artifactId: second.artifactId }, "AGENT"))).rejects.toMatchObject({ code: "TAX_SOURCE_NOT_FOUND" });
      const dispatcher = new OperationDispatcher({ databasePath: dbPath, source: "CLI", allowOperatorOperations: false }); const payload = { ...factPayload(first), sourceRecordKey: "transport" }; const cli = await dispatcher.dispatch("tax-case.fact.propose", envelope(first.tenantId, "transport-fact", payload, "AGENT")); expect(cli.ok).toBe(true);
      const mcp = await new OperationDispatcher({ databasePath: dbPath, source: "MCP", allowOperatorOperations: false }).dispatch("tax-case.fact.list", { tenantId: first.tenantId, taxCaseId: first.taxCaseId }); expect(mcp.ok).toBe(true); expect((mcp as { result: unknown[] }).result).toHaveLength(1);
      const foreignLine = await journalLine(dbPath, second); const proposed = JSON.parse((cli as { resultJson?: string }).resultJson ?? JSON.stringify((cli as { result?: { factId: string } }).result));
      await expect(app.taxCase.fact.confirm(envelope(first.tenantId, "transport-confirm", { taxCaseId: first.taxCaseId, factId: proposed.factId, reason: "human" }))).resolves.toBeDefined();
      await expect(app.taxCase.reconciliation.record(envelope(first.tenantId, "cross-bookset", { taxCaseId: first.taxCaseId, factId: proposed.factId, bookSetId: first.bookSetId, journalLineId: foreignLine, allocatedAmountMinor: 1, currency: "INR", reason: "wrong scope" }))).rejects.toMatchObject({ code: "TAX_RECONCILIATION_JOURNAL_LINE" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
