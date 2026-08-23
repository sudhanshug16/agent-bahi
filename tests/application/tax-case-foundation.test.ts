import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSqliteApplication, initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

function envelope(tenantId: string, requestId: string, payload: unknown) {
  return { schemaVersion: 1 as const, tenantId, requestId, actor: { kind: "HUMAN" as const, id: "tax-owner" }, source: "CLI" as const, reason: "tax case foundation test", payload } as never;
}

describe("Personal TaxCase foundation", () => {
  test("enforces eligibility, immutable membership versions, revision staleness, and shared transport parity", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-tax-case-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "tax-case" });
      const company = JSON.parse((await app.tenant.create(envelope("bootstrap", randomUUID(), { kind: "COMPANY", name: "Company" }))).resultJson);
      await expect(app.taxCase.create(envelope(company.tenantId, randomUUID(), { taxCaseId: "company-case", financialYear: "2025-26", taxPeriod: "2025-26", filingTrigger: "ANNUAL", bookSetIds: [company.defaultBookSetId] }))).rejects.toMatchObject({ code: "TAX_CASE_TENANT_KIND_FORBIDDEN" });

      const individual = JSON.parse((await app.tenant.create(envelope("bootstrap", randomUUID(), { kind: "INDIVIDUAL", name: "Individual" }))).resultJson);
      await expect(app.taxCase.create(envelope(individual.tenantId, randomUUID(), { taxCaseId: "missing-pan", financialYear: "2025-26", taxPeriod: "2025-26", filingTrigger: "ANNUAL", bookSetIds: [individual.defaultBookSetId] }))).rejects.toMatchObject({ code: "TAX_CASE_PAN_REQUIRED" });
      await app.tenant.activate(envelope(individual.tenantId, randomUUID(), { defaultBookSetId: individual.defaultBookSetId }));
      await app.tenant.pan.set(envelope(individual.tenantId, randomUUID(), { pan: "ABCDE1234F" }));
      const prop = JSON.parse((await app.bookSet.create(envelope(individual.tenantId, randomUUID(), { kind: "PROPRIETORSHIP", displayName: "Side business" }))).resultJson);
      await expect(app.taxCase.create(envelope(individual.tenantId, randomUUID(), { taxCaseId: "missing-prop", financialYear: "2025-26", taxPeriod: "2025-26", filingTrigger: "ANNUAL", bookSetIds: [individual.defaultBookSetId] }))).rejects.toMatchObject({ code: "TAX_CASE_BOOKSET_SET_MISMATCH" });
      await expect(app.taxCase.create(envelope(individual.tenantId, randomUUID(), { taxCaseId: "extra-bookset", financialYear: "2025-26", taxPeriod: "2025-26", filingTrigger: "ANNUAL", bookSetIds: [individual.defaultBookSetId, company.defaultBookSetId] }))).rejects.toMatchObject({ code: "TAX_CASE_BOOKSET_SET_MISMATCH" });

      const requestId = randomUUID();
      const createPayload = { taxCaseId: "case-1", financialYear: "2025-26", taxPeriod: "2025-26", filingTrigger: "ANNUAL", bookSetIds: [individual.defaultBookSetId, prop.bookSetId] };
      const first = await app.taxCase.create(envelope(individual.tenantId, requestId, createPayload));
      const replay = await app.taxCase.create(envelope(individual.tenantId, requestId, { ...createPayload, bookSetIds: [prop.bookSetId, individual.defaultBookSetId] }));
      expect(replay.resultJson).toBe(first.resultJson);
      expect(replay.replayed).toBe(true);
      await expect(app.taxCase.create(envelope(individual.tenantId, requestId, { ...createPayload, filingTrigger: "CORRECTION" }))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

      const status = await app.taxCase.status(individual.tenantId, "case-1");
      expect(status.status).toBe("CURRENT");
      expect(status.membershipVersion).toBe(1);
      expect(status.bookSets.map((bookSet) => bookSet.bookSetId)).toEqual([individual.defaultBookSetId, prop.bookSetId].sort());
      const noOp = await app.taxCase.membershipRefresh(envelope(individual.tenantId, randomUUID(), { taxCaseId: "case-1" }));
      expect(JSON.parse(noOp.resultJson)).toMatchObject({ changed: false, membershipVersion: 1 });
      const prop2 = JSON.parse((await app.bookSet.create(envelope(individual.tenantId, randomUUID(), { kind: "PROPRIETORSHIP", displayName: "Second business" }))).resultJson);
      const addedStale = await app.taxCase.status(individual.tenantId, "case-1");
      expect(addedStale.status).toBe("STALE");
      expect(addedStale.reasons).toEqual(["ELIGIBLE_BOOKSET_ADDED"]);
      await expect(app.taxCase.membershipRefresh(envelope(individual.tenantId, randomUUID(), { taxCaseId: "case-1", bookSetIds: [individual.defaultBookSetId, prop.bookSetId] }))).rejects.toMatchObject({ code: "TAX_CASE_BOOKSET_SET_MISMATCH" });
      const changed = await app.taxCase.membershipRefresh(envelope(individual.tenantId, randomUUID(), { taxCaseId: "case-1" }));
      expect(JSON.parse(changed.resultJson)).toMatchObject({ changed: true, membershipVersion: 2 });
      await app.bookSet.archive(envelope(individual.tenantId, randomUUID(), { bookSetId: prop2.bookSetId }));
      const archivedStale = await app.taxCase.status(individual.tenantId, "case-1");
      expect(archivedStale.status).toBe("STALE");
      expect(archivedStale.reasons).toEqual(["ELIGIBLE_BOOKSET_ARCHIVED"]);

      const native = new Database(dbPath, { safeIntegers: true });
      native.exec("PRAGMA foreign_keys = ON");
      const version2 = native.query("SELECT id FROM tax_case_membership_versions WHERE tenant_id = ? AND tax_case_id = ? AND version = 2").get(individual.tenantId, "case-1") as { id: string };
      expect(native.query("SELECT seal_state, membership_count FROM tax_case_membership_versions WHERE id = ?").get(version2.id)).toEqual({ seal_state: "SEALED", membership_count: 3n });
      expect(() => native.query("INSERT INTO tax_case_memberships (id, tax_case_id, tenant_id, membership_version_id, version, book_set_id, ledger_revision, created_at) VALUES (?, ?, ?, ?, 2, ?, 0, ?)").run(randomUUID(), "case-1", individual.tenantId, version2.id, prop.bookSetId, "2026-08-23T00:00:00.000Z")).toThrow();
      const member = native.query("SELECT id FROM tax_case_memberships WHERE membership_version_id = ? LIMIT 1").get(version2.id) as { id: string };
      expect(() => native.query("UPDATE tax_case_memberships SET ledger_revision = 99 WHERE id = ?").run(member.id)).toThrow();
      expect(() => native.query("DELETE FROM tax_case_memberships WHERE id = ?").run(member.id)).toThrow();
      expect(() => native.query("UPDATE tax_case_membership_versions SET membership_count = 99 WHERE id = ?").run(version2.id)).toThrow();
      expect(() => native.query("DELETE FROM tax_case_membership_versions WHERE id = ?").run(version2.id)).toThrow();
      expect(() => native.query("UPDATE tax_cases SET lifecycle = 'ARCHIVED' WHERE id = ?").run("case-1")).toThrow();
      expect(() => native.query("UPDATE tax_cases SET request_id = 'mutated' WHERE id = ?").run("case-1")).toThrow();
      expect(() => native.query("DELETE FROM tax_cases WHERE id = ?").run("case-1")).toThrow();
      const before = native.query("SELECT revision FROM book_set_ledger_revisions WHERE tenant_id = ? AND book_set_id = ?").get(individual.tenantId, individual.defaultBookSetId) as { revision: bigint };
      const cash = native.query("SELECT id FROM accounts WHERE tenant_id = ? AND book_set_id = ? AND code = '1100'").get(individual.tenantId, individual.defaultBookSetId) as { id: string };
      const equity = native.query("SELECT id FROM accounts WHERE tenant_id = ? AND book_set_id = ? AND code = '3000'").get(individual.tenantId, individual.defaultBookSetId) as { id: string };
      const journalId = randomUUID();
      native.query("INSERT INTO journal_entries (id, tenant_id, book_set_id, posting_date, status, created_at, posted_at) VALUES (?, ?, ?, '2026-08-23', 'POSTED', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')").run(journalId, individual.tenantId, individual.defaultBookSetId);
      native.query("INSERT INTO journal_lines (id, tenant_id, book_set_id, journal_entry_id, account_id, debit_minor, credit_minor) VALUES (?, ?, ?, ?, ?, 1, 0)").run(randomUUID(), individual.tenantId, individual.defaultBookSetId, journalId, cash.id);
      native.query("INSERT INTO journal_lines (id, tenant_id, book_set_id, journal_entry_id, account_id, debit_minor, credit_minor) VALUES (?, ?, ?, ?, ?, 0, 1)").run(randomUUID(), individual.tenantId, individual.defaultBookSetId, journalId, equity.id);
      const afterDirectInsert = native.query("SELECT revision FROM book_set_ledger_revisions WHERE tenant_id = ? AND book_set_id = ?").get(individual.tenantId, individual.defaultBookSetId) as { revision: bigint };
      expect(afterDirectInsert.revision).toBe(before.revision + 1n);
      native.exec("BEGIN IMMEDIATE");
      native.query("INSERT INTO journal_entries (id, tenant_id, book_set_id, posting_date, status, created_at, posted_at) VALUES (?, ?, ?, '2026-08-24', 'POSTED', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z')").run(randomUUID(), individual.tenantId, individual.defaultBookSetId);
      const duringRollback = native.query("SELECT revision FROM book_set_ledger_revisions WHERE tenant_id = ? AND book_set_id = ?").get(individual.tenantId, individual.defaultBookSetId) as { revision: bigint };
      expect(duringRollback.revision).toBe(afterDirectInsert.revision + 1n);
      native.exec("ROLLBACK");
      const afterRollback = native.query("SELECT revision FROM book_set_ledger_revisions WHERE tenant_id = ? AND book_set_id = ?").get(individual.tenantId, individual.defaultBookSetId) as { revision: bigint };
      expect(afterRollback.revision).toBe(afterDirectInsert.revision);
      expect(native.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(native.query("SELECT COUNT(*) AS count FROM audit_records WHERE tenant_id = ? AND command LIKE 'tax-case.%'").get(individual.tenantId)).toEqual({ count: 3n });
      expect(native.query("SELECT COUNT(*) AS count FROM idempotency_records WHERE tenant_id = ?").get(individual.tenantId)).toEqual({ count: 8n });
      native.close();

      const stale = await app.taxCase.status(individual.tenantId, "case-1");
      expect(stale.status).toBe("STALE");
      expect(stale.bookSets.find((bookSet) => bookSet.bookSetId === individual.defaultBookSetId)?.reasons).toEqual(["LEDGER_REVISION_ADVANCED"]);
      const dispatcher = new OperationDispatcher({ databasePath: dbPath, source: "MCP", allowOperatorOperations: false });
      const viaMcp = await dispatcher.dispatch("tax-case.status", { tenantId: individual.tenantId, taxCaseId: "case-1" });
      expect(viaMcp.ok).toBe(true);
      expect((viaMcp as { result?: unknown }).result).toEqual(stale);
      const viaCli = await new OperationDispatcher({ databasePath: dbPath, source: "CLI", allowOperatorOperations: false }).dispatch("tax-case.status", { tenantId: individual.tenantId, taxCaseId: "case-1" });
      expect(viaCli).toEqual(viaMcp);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
