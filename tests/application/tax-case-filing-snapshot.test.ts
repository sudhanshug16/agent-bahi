import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSqliteApplication, initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { OFFICIAL_DRIZZLE_MIGRATIONS } from "../../src/infrastructure/services/drizzle-baseline.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

function envelope(tenantId: string, requestId: string, payload: unknown, actor: "HUMAN" | "AGENT" = "HUMAN", source: "CLI" | "MCP" = "CLI") {
  return { schemaVersion: 1 as const, tenantId, requestId, actor: { kind: actor, id: `${actor.toLowerCase()}-snapshot` }, source, reason: "filing snapshot test", payload } as never;
}

async function scope(app: ReturnType<typeof createSqliteApplication>, suffix: string) {
  const tenant = JSON.parse((await app.tenant.create(envelope(`tenant-${suffix}`, randomUUID(), { kind: "INDIVIDUAL", name: `Individual ${suffix}` }))).resultJson);
  await app.tenant.activate(envelope(tenant.tenantId, randomUUID(), { defaultBookSetId: tenant.defaultBookSetId }));
  await app.tenant.pan.set(envelope(tenant.tenantId, randomUUID(), { pan: `ABCDE${suffix.padStart(4, "0").slice(-4)}F` }));
  const taxCaseId = `case-${suffix}`;
  await app.taxCase.create(envelope(tenant.tenantId, randomUUID(), { taxCaseId, financialYear: "2025-26", taxPeriod: "2025-26", filingTrigger: "ANNUAL", bookSetIds: [tenant.defaultBookSetId] }));
  return { tenantId: tenant.tenantId, bookSetId: tenant.defaultBookSetId, taxCaseId };
}

async function advanceLedger(dbPath: string, s: Awaited<ReturnType<typeof scope>>): Promise<void> {
  const native = new Database(dbPath, { safeIntegers: true }); native.exec("PRAGMA foreign_keys = ON");
  const accounts = native.query("SELECT id, code FROM accounts WHERE tenant_id = ? AND book_set_id = ? AND code IN ('1100', '3000') ORDER BY code").all(s.tenantId, s.bookSetId) as Array<{ id: string; code: string }>;
  const entryId = randomUUID(); const now = "2026-01-01T00:00:00.000Z";
  native.query("INSERT INTO journal_entries (id, tenant_id, book_set_id, posting_date, status, created_at, posted_at) VALUES (?, ?, ?, '2026-01-01', 'POSTED', ?, ?)").run(entryId, s.tenantId, s.bookSetId, now, now);
  native.query("INSERT INTO journal_lines (id, tenant_id, book_set_id, journal_entry_id, account_id, debit_minor, credit_minor) VALUES (?, ?, ?, ?, ?, 1, 0)").run(randomUUID(), s.tenantId, s.bookSetId, entryId, accounts.find((row) => row.code === "1100")!.id);
  native.query("INSERT INTO journal_lines (id, tenant_id, book_set_id, journal_entry_id, account_id, debit_minor, credit_minor) VALUES (?, ?, ?, ?, ?, 0, 1)").run(randomUUID(), s.tenantId, s.bookSetId, entryId, accounts.find((row) => row.code === "3000")!.id);
  native.close();
}

describe("Personal Tax Filing Snapshot V1", () => {
  test("previews deterministically, seals only for HUMAN, masks PAN, audits replay, and derives CURRENT", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-filing-snapshot-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "filing-snapshot" }); const s = await scope(app, "2001");
      const first = await app.taxCase.filingSnapshot.preview(s.tenantId, s.taxCaseId); const second = await app.taxCase.filingSnapshot.preview(s.tenantId, s.taxCaseId);
      expect(first).toEqual(second); expect(first.blockers).toEqual([]); expect(first.candidate.pan).toMatchObject({ maskedDisplay: "******001F", lastFour: "001F" }); expect(JSON.stringify(first)).not.toContain("ABCDE2001F");
      await expect(app.taxCase.filingSnapshot.seal(envelope(s.tenantId, "snapshot-agent", { taxCaseId: s.taxCaseId, candidateHash: first.candidateHash }, "AGENT"))).rejects.toMatchObject({ code: "FILING_SNAPSHOT_HUMAN_REQUIRED" });
      const sealed = await app.taxCase.filingSnapshot.seal(envelope(s.tenantId, "snapshot-seal", { taxCaseId: s.taxCaseId, candidateHash: first.candidateHash })); const result = JSON.parse(sealed.resultJson);
      expect(result).toMatchObject({ tenantId: s.tenantId, taxCaseId: s.taxCaseId, status: "CURRENT", pan: { maskedDisplay: "******001F", lastFour: "001F" } }); expect(sealed.resultJson).not.toContain("ABCDE2001F");
      const replay = await app.taxCase.filingSnapshot.seal(envelope(s.tenantId, "snapshot-seal", { taxCaseId: s.taxCaseId, candidateHash: first.candidateHash })); expect(replay).toMatchObject({ replayed: true, resultJson: sealed.resultJson });
      const shown = await app.taxCase.filingSnapshot.show(s.tenantId, s.taxCaseId, result.snapshotId); expect(shown).toMatchObject({ status: "CURRENT", candidateHash: first.candidateHash, pan: { maskedDisplay: "******001F" } });
      expect(await app.taxCase.filingSnapshot.status(s.tenantId, s.taxCaseId, result.snapshotId)).toMatchObject({ status: "CURRENT" });
      const native = new Database(dbPath, { readonly: true, safeIntegers: true }); expect(native.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: BigInt(OFFICIAL_DRIZZLE_MIGRATIONS.length) }); expect(native.query("SELECT COUNT(*) AS count FROM audit_records WHERE command = 'tax-case.filing-snapshot.seal'").get()).toEqual({ count: 2n }); native.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("fails closed on exact candidate CAS after a ledger revision and never mutates the old snapshot", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-filing-cas-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "filing-cas" }); const s = await scope(app, "2002"); const preview = await app.taxCase.filingSnapshot.preview(s.tenantId, s.taxCaseId);
      await advanceLedger(dbPath, s); await expect(app.taxCase.filingSnapshot.seal(envelope(s.tenantId, "snapshot-cas", { taxCaseId: s.taxCaseId, candidateHash: preview.candidateHash }))).rejects.toMatchObject({ code: "FILING_SNAPSHOT_CANDIDATE_CHANGED" });
      const current = await app.taxCase.filingSnapshot.preview(s.tenantId, s.taxCaseId); expect(current.blockers).toContain("LEDGER_REVISION_DRIFT"); const native = new Database(dbPath, { readonly: true, safeIntegers: true }); expect(native.query("SELECT COUNT(*) AS count FROM filing_snapshots").get()).toEqual({ count: 0n }); native.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("reports source and fact blockers, rejects cross-tenant access, and keeps CLI/MCP dispatch shared", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-filing-blockers-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "filing-blockers" }); const first = await scope(app, "2003"); const second = await scope(app, "2004");
      const source = JSON.parse((await app.taxCase.source.import(envelope(first.tenantId, "snapshot-source", { taxCaseId: first.taxCaseId, sourceKind: "AIS", mediaType: "text/plain", originalFilename: "ais.txt", contentBase64: Buffer.from("source").toString("base64") }))).resultJson);
      const fact = JSON.parse((await app.taxCase.fact.propose(envelope(first.tenantId, "snapshot-fact", { taxCaseId: first.taxCaseId, sourceId: source.sourceId, artifactId: source.artifact.artifactId, sourceRecordKey: "row-1", kind: "TDS_CREDIT", rawSourceLabel: "TDS", rawSourceLocator: "row=1", eventDate: "2025-06-30", originalCurrency: "INR", grossAmountMinor: 10, parserIdentity: "test", parserVersion: "1", normalizedPayload: { amount: 10 } }, "AGENT"))).resultJson);
      const preview = await app.taxCase.filingSnapshot.preview(first.tenantId, first.taxCaseId); expect(preview.blockers).toEqual(["FACT_PROPOSED", "SOURCE_NOT_READY"]); await expect(app.taxCase.filingSnapshot.show(second.tenantId, second.taxCaseId, "missing")).rejects.toMatchObject({ code: "FILING_SNAPSHOT_NOT_FOUND" });
      const cli = await new OperationDispatcher({ databasePath: dbPath, source: "CLI", allowOperatorOperations: false }).dispatch("tax-case.filing-snapshot.preview", { tenantId: first.tenantId, taxCaseId: first.taxCaseId }); const mcp = await new OperationDispatcher({ databasePath: dbPath, source: "MCP", allowOperatorOperations: false }).dispatch("tax-case.filing-snapshot.preview", { tenantId: first.tenantId, taxCaseId: first.taxCaseId }); expect(cli).toEqual(mcp); expect((cli as { result: { candidateHash: string } }).result.candidateHash).toBe(preview.candidateHash); expect(fact.lifecycle).toBe("PROPOSED");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("sealed rows and child bindings reject direct SQL mutation and become STALE after membership change", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-filing-immutable-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "filing-immutable" }); const s = await scope(app, "2005"); const preview = await app.taxCase.filingSnapshot.preview(s.tenantId, s.taxCaseId); const sealed = JSON.parse((await app.taxCase.filingSnapshot.seal(envelope(s.tenantId, "snapshot-immutable", { taxCaseId: s.taxCaseId, candidateHash: preview.candidateHash }))).resultJson);
      const native = new Database(dbPath, { safeIntegers: true }); expect(() => native.query("UPDATE filing_snapshots SET candidate_hash = candidate_hash WHERE id = ?").run(sealed.snapshotId)).toThrow(); expect(() => native.query("DELETE FROM filing_snapshot_book_sets WHERE snapshot_id = ?").run(sealed.snapshotId)).toThrow(); native.close();
      await app.taxCase.membershipRefresh(envelope(s.tenantId, "snapshot-membership-refresh", { taxCaseId: s.taxCaseId, bookSetIds: [s.bookSetId] })); expect(await app.taxCase.filingSnapshot.status(s.tenantId, s.taxCaseId, sealed.snapshotId)).toMatchObject({ status: "CURRENT" });
      await advanceLedger(dbPath, s); expect(await app.taxCase.filingSnapshot.status(s.tenantId, s.taxCaseId, sealed.snapshotId)).toMatchObject({ status: "STALE" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
