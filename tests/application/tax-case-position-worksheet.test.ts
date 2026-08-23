import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSqliteApplication, initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

function envelope(tenantId: string, requestId: string, payload: unknown, actor: "HUMAN" | "AGENT" = "HUMAN", source: "CLI" | "MCP" = "CLI"): any {
  return { schemaVersion: 1 as const, tenantId, requestId, actor: { kind: actor, id: `${actor.toLowerCase()}-position` }, source, reason: "position worksheet test", payload };
}

async function scope(app: ReturnType<typeof createSqliteApplication>, suffix: string, dbPath: string) {
  const tenant = JSON.parse((await app.tenant.create(envelope(`bootstrap-${suffix}`, randomUUID(), { kind: "INDIVIDUAL", name: `Individual ${suffix}` }))).resultJson);
  await app.tenant.activate(envelope(tenant.tenantId, randomUUID(), { defaultBookSetId: tenant.defaultBookSetId }));
  await app.tenant.pan.set(envelope(tenant.tenantId, randomUUID(), { pan: `ABCDE${suffix.padStart(4, "0").slice(-4)}F` }));
  const prop = JSON.parse((await app.bookSet.create(envelope(tenant.tenantId, randomUUID(), { kind: "PROPRIETORSHIP", displayName: `Business ${suffix}` }))).resultJson);
  const native = new Database(dbPath); const now = new Date().toISOString(); const accounts = [["1000", "Assets", "ASSET", null], ["1100", "Cash", "ASSET", "1000"], ["2000", "Liabilities", "LIABILITY", null], ["3000", "Equity", "EQUITY", null], ["4000", "Income", "INCOME", null], ["5000", "Expenses", "EXPENSE", null]] as const;
  const accountIds = new Map<string, string>(); for (const [code] of accounts) accountIds.set(code, randomUUID());
  for (const [code, name, accountType, parentCode] of accounts) native.query("INSERT INTO accounts (id, tenant_id, book_set_id, code, name, account_type, parent_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(accountIds.get(code)!, tenant.tenantId, prop.bookSetId, code, name, accountType, parentCode ? accountIds.get(parentCode)! : null, now, now); native.close();
  const cash = await app.account.getByCode("1100", tenant.tenantId, prop.bookSetId);
  const revenue = await app.account.getByCode("4000", tenant.tenantId, prop.bookSetId);
  const expense = await app.account.getByCode("5000", tenant.tenantId, prop.bookSetId);
  await app.journal.post({ ...envelope(tenant.tenantId, randomUUID(), { postingDate: "2025-06-30", lines: [{ accountId: cash!.id, debitMinor: 1_000 }, { accountId: revenue!.id, creditMinor: 1_000 }] }), bookSetId: prop.bookSetId } as never);
  await app.journal.post({ ...envelope(tenant.tenantId, randomUUID(), { postingDate: "2025-07-01", lines: [{ accountId: expense!.id, debitMinor: 250 }, { accountId: cash!.id, creditMinor: 250 }] }), bookSetId: prop.bookSetId } as never);
  const taxCaseId = `case-${suffix}`;
  await app.taxCase.create(envelope(tenant.tenantId, randomUUID(), { taxCaseId, financialYear: "2025-26", taxPeriod: "2025-26", filingTrigger: "ANNUAL", bookSetIds: [tenant.defaultBookSetId, prop.bookSetId] }));
  return { tenantId: tenant.tenantId, personalBookSetId: tenant.defaultBookSetId, propBookSetId: prop.bookSetId, taxCaseId };
}

async function readySource(app: ReturnType<typeof createSqliteApplication>, s: Awaited<ReturnType<typeof scope>>, suffix: string) {
  const source = JSON.parse((await app.taxCase.source.import(envelope(s.tenantId, `source-${suffix}`, { taxCaseId: s.taxCaseId, sourceKind: "AIS", sourcePeriod: "2025-26", mediaType: "text/plain", originalFilename: "ais.txt", contentBase64: Buffer.from(`AIS ${suffix}`).toString("base64") }))).resultJson);
  const facts: string[] = [];
  for (const [index, kind] of ["INTEREST_INCOME", "TDS_CREDIT", "TCS_CREDIT", "TAX_PAYMENT", "BUSINESS_RECEIPT", "SECURITIES_TRANSACTION"] .entries()) {
    const fact = JSON.parse((await app.taxCase.fact.propose(envelope(s.tenantId, `fact-${suffix}-${index}`, { taxCaseId: s.taxCaseId, sourceId: source.sourceId, artifactId: source.artifact.artifactId, sourceRecordKey: `row-${index}`, kind, rawSourceLabel: kind, rawSourceLocator: `row=${index}`, eventDate: "2025-08-01", originalCurrency: "INR", grossAmountMinor: (index + 1) * 10, parserIdentity: "test", parserVersion: "1", normalizedPayload: { index } }, "AGENT"))).resultJson);
    await app.taxCase.fact.confirm(envelope(s.tenantId, `confirm-${suffix}-${index}`, { taxCaseId: s.taxCaseId, factId: fact.factId, reason: "reviewed" })); facts.push(fact.factId);
  }
  facts.sort(); const prepared = JSON.parse((await app.taxCase.source.assessment.prepare(envelope(s.tenantId, `assessment-${suffix}`, { taxCaseId: s.taxCaseId, sourceId: source.sourceId, artifactId: source.artifact.artifactId, contentHash: source.artifact.contentHash, parserIdentity: "ais-reader", parserVersion: "1", modelDescriptor: "test", extractionMode: "AGENT_ASSISTED", sourceKind: "AIS", sourcePeriod: "2025-26", factIds: facts, recordCount: facts.length, coverage: { recordCount: facts.length }, issues: [], warnings: [], outcomeCandidate: "FACTS_PRESENT" }, "AGENT"))).resultJson);
  await app.taxCase.source.assessment.confirm(envelope(s.tenantId, `assessment-confirm-${suffix}`, { taxCaseId: s.taxCaseId, sourceId: source.sourceId, assessmentId: prepared.assessmentId, expectedAssessmentHash: prepared.assessmentHash, reason: "human reviewed" }));
}

describe("Personal Tax Position Worksheet V1", () => {
  test("derives exact business P&L, dispatches through CLI and MCP, and replays idempotently", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-position-basic-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "position" }); const s = await scope(app, "4001", dbPath);
      const snapshotPreview = await app.taxCase.filingSnapshot.preview(s.tenantId, s.taxCaseId); const snapshot = JSON.parse((await app.taxCase.filingSnapshot.seal(envelope(s.tenantId, "seal-4001", { taxCaseId: s.taxCaseId, candidateHash: snapshotPreview.candidateHash }))).resultJson);
      const preview = await app.taxCase.position.preview(s.tenantId, s.taxCaseId, snapshot.snapshotId); expect(preview.businessBookProfitLossMinor).toMatchObject({ totalMinor: 750 }); expect(preview.preliminaryKnownIncomeMinor).toBe(750); expect(preview.taxCreditsMinor.totalMinor).toBe(0); expect(preview.scope).toBe("PRELIMINARY_KNOWN_INCOME_ONLY");
      const generated = await app.taxCase.position.generate(envelope(s.tenantId, "generate-4001", { taxCaseId: s.taxCaseId, filingSnapshotId: snapshot.snapshotId }, "AGENT")); const result = JSON.parse(generated.resultJson); expect(result.status).toBe("CURRENT");
      const replay = await app.taxCase.position.generate(envelope(s.tenantId, "generate-4001", { taxCaseId: s.taxCaseId, filingSnapshotId: snapshot.snapshotId }, "AGENT")); expect(replay.replayed).toBe(true); expect(replay.resultJson).toBe(generated.resultJson);
      const cli = await new OperationDispatcher({ databasePath: dbPath, source: "CLI", allowOperatorOperations: false }).dispatch("tax-case.position.status", { tenantId: s.tenantId, taxCaseId: s.taxCaseId, worksheetId: result.worksheetId }); const mcp = await new OperationDispatcher({ databasePath: dbPath, source: "MCP", allowOperatorOperations: false }).dispatch("tax-case.position.status", { tenantId: s.tenantId, taxCaseId: s.taxCaseId, worksheetId: result.worksheetId }); expect(cli).toEqual(mcp); expect((cli as { result: { status: string } }).result.status).toBe("CURRENT");
      const native = new Database(dbPath, { safeIntegers: true }); expect(native.query("SELECT COUNT(*) AS count FROM personal_tax_position_worksheets").get()).toEqual({ count: 1n }); expect(() => native.query("UPDATE personal_tax_position_worksheets SET output_hash = output_hash WHERE id = ?").run(result.worksheetId)).toThrow(); expect(() => native.query("DELETE FROM personal_tax_position_worksheets WHERE id = ?").run(result.worksheetId)).toThrow(); native.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("groups confirmed facts without adding credits or business receipts and leaves securities unresolved", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-position-facts-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const s = await scope(app, "4002", dbPath); await readySource(app, s, "4002");
      const native = new Database(dbPath, { readonly: true, safeIntegers: true }); const journalLine = native.query("SELECT jl.id FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id AND a.book_set_id = jl.book_set_id WHERE jl.tenant_id = ? AND jl.book_set_id = ? AND a.code = '4000' LIMIT 1").get(s.tenantId, s.propBookSetId) as { id: string }; native.close();
      for (const fact of await app.taxCase.fact.list(s.tenantId, s.taxCaseId)) await app.taxCase.reconciliation.record(envelope(s.tenantId, `reconcile-4002-${fact.factId}`, { taxCaseId: s.taxCaseId, factId: fact.factId, bookSetId: s.propBookSetId, journalLineId: journalLine.id, allocatedAmountMinor: fact.grossAmountMinor, currency: "INR", reason: "supporting reconciliation" }));
      const candidate = await app.taxCase.filingSnapshot.preview(s.tenantId, s.taxCaseId); const snapshot = JSON.parse((await app.taxCase.filingSnapshot.seal(envelope(s.tenantId, "seal-4002", { taxCaseId: s.taxCaseId, candidateHash: candidate.candidateHash }))).resultJson); const position = await app.taxCase.position.preview(s.tenantId, s.taxCaseId, snapshot.snapshotId);
      expect(position.personalIncomeFactsMinor.byKind.INTEREST_INCOME.totalMinor).toBe(10); expect(position.taxCreditsMinor.totalMinor).toBe(90); expect(position.supportingBusinessReceiptMinor.totalMinor).toBe(50); expect(position.preliminaryKnownIncomeMinor).toBe(760); expect(position.unresolved.items).toEqual([expect.objectContaining({ kind: "SECURITIES_TRANSACTION", reasonCode: "SECURITIES_COST_BASIS_REQUIRED" })]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("rejects stale snapshots and derives the persisted worksheet STALE after a later journal", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-position-stale-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const s = await scope(app, "4003", dbPath); const candidate = await app.taxCase.filingSnapshot.preview(s.tenantId, s.taxCaseId); const snapshot = JSON.parse((await app.taxCase.filingSnapshot.seal(envelope(s.tenantId, "seal-4003", { taxCaseId: s.taxCaseId, candidateHash: candidate.candidateHash }))).resultJson); const generated = JSON.parse((await app.taxCase.position.generate(envelope(s.tenantId, "generate-4003", { taxCaseId: s.taxCaseId, filingSnapshotId: snapshot.snapshotId }))).resultJson);
      const cash = await app.account.getByCode("1100", s.tenantId, s.propBookSetId); const equity = await app.account.getByCode("3000", s.tenantId, s.propBookSetId); await app.journal.post({ ...envelope(s.tenantId, "later-journal-4003", { postingDate: "2025-08-02", lines: [{ accountId: cash!.id, debitMinor: 1 }, { accountId: equity!.id, creditMinor: 1 }] }), bookSetId: s.propBookSetId } as never);
      expect(await app.taxCase.position.status(s.tenantId, s.taxCaseId, generated.worksheetId)).toMatchObject({ status: "STALE" }); await expect(app.taxCase.position.generate(envelope(s.tenantId, "generate-stale-4003", { taxCaseId: s.taxCaseId, filingSnapshotId: snapshot.snapshotId }))).rejects.toMatchObject({ code: "TAX_POSITION_SNAPSHOT_NOT_CURRENT" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
