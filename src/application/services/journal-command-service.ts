import { randomUUID } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { AccountId, BookSetId, TenantId } from "../../core/types.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";
import { assertPeriodOpen } from "./period-close-service.ts";

export interface JournalLinePayload {
  accountId: AccountId;
  description?: string;
  debitMinor?: number;
  creditMinor?: number;
}

export interface JournalPostPayload {
  postingDate: string;
  reference?: string;
  narration?: string;
  lines: JournalLinePayload[];
}

export interface JournalPostResult {
  journalId: string;
  postingDate: string;
  totalDebitMinor: number;
  totalCreditMinor: number;
  status: "POSTED";
}

interface StoredIdempotency {
  requestHash: string;
  resultJson: string;
  resultHash: string;
}

export interface InSessionJournalPost {
  tenantId: TenantId;
  bookSetId: BookSetId;
  postingDate: string;
  reference?: string;
  narration?: string;
  lines: JournalLinePayload[];
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateMinor(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new DomainError("INVALID_JOURNAL_AMOUNT", `${field} must be a positive safe integer minor amount`);
  }
  return value;
}

function validatePayload(payload: JournalPostPayload): void {
  if (!isIsoDate(payload.postingDate)) {
    throw new DomainError("INVALID_POSTING_DATE", "postingDate must be a valid ISO date (YYYY-MM-DD)");
  }
  if (!Array.isArray(payload.lines) || payload.lines.length < 2) {
    throw new DomainError("INVALID_JOURNAL_LINES", "journal must contain at least two lines");
  }
  let debitTotal = 0;
  let creditTotal = 0;
  for (const [index, line] of payload.lines.entries()) {
    if (!line || typeof line.accountId !== "string" || line.accountId.length === 0) {
      throw new DomainError("INVALID_JOURNAL_ACCOUNT", `lines[${index}].accountId is required`);
    }
    const hasDebit = line.debitMinor !== undefined;
    const hasCredit = line.creditMinor !== undefined;
    if (hasDebit === hasCredit) {
      throw new DomainError("INVALID_JOURNAL_LINE_SIDE", `lines[${index}] must specify exactly one of debitMinor or creditMinor`);
    }
    if (hasDebit) debitTotal += validateMinor(line.debitMinor, `lines[${index}].debitMinor`);
    if (hasCredit) creditTotal += validateMinor(line.creditMinor, `lines[${index}].creditMinor`);
    if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal)) {
      throw new DomainError("INVALID_JOURNAL_AMOUNT", "journal totals must remain safe integers");
    }
  }
  if (debitTotal === 0 || debitTotal !== creditTotal) {
    throw new DomainError("UNBALANCED_POSTING", "debit and credit totals must be equal and non-zero", { debitTotal, creditTotal });
  }
}

async function lookupIdempotency(session: BusinessSession, tenantId: TenantId, requestId: string): Promise<StoredIdempotency | undefined> {
  const row = await session.querySingle(
    "SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?",
    [tenantId, requestId],
  );
  if (!row) return undefined;
  return {
    requestHash: String(row.request_hash),
    resultJson: String(row.result_json),
    resultHash: String(row.result_hash),
  };
}

async function assertScope(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, lines: JournalLinePayload[]): Promise<void> {
  const bookSet = await session.querySingle(
    "SELECT id, tenant_id, lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?",
    [bookSetId, tenantId],
  );
  if (!bookSet) throw new DomainError("BOOK_SET_NOT_FOUND", `BookSet not found: ${bookSetId}`);
  if (String(bookSet.lifecycle) !== "ACTIVE") throw new DomainError("BOOK_SET_INACTIVE", "BookSet must be ACTIVE for journal posting");

  for (const line of lines) {
    const account = await session.querySingle(
      "SELECT id, tenant_id, book_set_id, archived_at FROM accounts WHERE id = ? AND tenant_id = ? AND book_set_id = ?",
      [line.accountId, tenantId, bookSetId],
    );
    if (!account) throw new DomainError("ACCOUNT_SCOPE_MISMATCH", `Account does not belong to tenant and BookSet: ${line.accountId}`);
    if (account.archived_at !== null && account.archived_at !== undefined) {
      throw new DomainError("ACCOUNT_ARCHIVED", `Cannot post to archived account: ${line.accountId}`);
    }
  }
}

/** Post a validated journal inside the caller's existing BusinessSession. */
export async function postJournalInSession(session: BusinessSession, posting: InSessionJournalPost): Promise<string> {
  validatePayload({ postingDate: posting.postingDate, reference: posting.reference, narration: posting.narration, lines: posting.lines });
  await assertPeriodOpen(session, posting.tenantId, posting.bookSetId, posting.postingDate);
  await assertScope(session, posting.tenantId, posting.bookSetId, posting.lines);
  const journalId = randomUUID();
  const now = new Date().toISOString();
  await session.execute(
    `INSERT INTO journal_entries
     (id, tenant_id, book_set_id, posting_date, reference, narration, status, created_at, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, 'POSTED', ?, ?)`,
    [journalId, posting.tenantId, posting.bookSetId, posting.postingDate, posting.reference ?? null, posting.narration ?? null, now, now],
  );
  for (const line of posting.lines) {
    await session.execute(
      `INSERT INTO journal_lines
       (id, tenant_id, book_set_id, journal_entry_id, account_id, description, debit_minor, credit_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), posting.tenantId, posting.bookSetId, journalId, line.accountId, line.description ?? null, line.debitMinor ?? 0, line.creditMinor ?? 0],
    );
  }
  return journalId;
}

export async function executeJournalPost(
  sessionRunner: BusinessSessionRunner,
  envelope: CommandEnvelope<JournalPostPayload> & { bookSetId: BookSetId },
): Promise<CommandResult<JournalPostResult>> {
  validateCommandEnvelope(envelope);
  if (!envelope.bookSetId || typeof envelope.bookSetId !== "string") {
    throw new DomainError("INVALID_BOOK_SET_ID", "bookSetId is required for journal.post");
  }
  validatePayload(envelope.payload);
  const requestHash = computeCommandHash("journal.post", envelope, envelope.payload);

  return sessionRunner.withBusinessSession("write", async (session) => {
    const existing = await lookupIdempotency(session, envelope.tenantId, envelope.requestId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
      if (computeResultHash(existing.resultJson) !== existing.resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
      return { resultJson: existing.resultJson, resultHash: existing.resultHash, replayed: true };
    }

    await assertScope(session, envelope.tenantId, envelope.bookSetId, envelope.payload.lines);
    const now = new Date().toISOString();
    let totalDebitMinor = 0;
    let totalCreditMinor = 0;
    for (const line of envelope.payload.lines) {
      totalDebitMinor += line.debitMinor ?? 0;
      totalCreditMinor += line.creditMinor ?? 0;
    }

    const journalId = await postJournalInSession(session, {
      tenantId: envelope.tenantId,
      bookSetId: envelope.bookSetId,
      postingDate: envelope.payload.postingDate,
      reference: envelope.payload.reference,
      narration: envelope.payload.narration,
      lines: envelope.payload.lines,
    });

    const result: JournalPostResult = { journalId, postingDate: envelope.payload.postingDate, totalDebitMinor, totalCreditMinor, status: "POSTED" };
    const resultJson = canonicalJson(result);
    const resultHash = computeResultHash(resultJson);
    await session.execute(
      `INSERT INTO audit_records
       (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id,
        canonical_before_hash, canonical_after_hash, change_summary, committed_at, created_at)
       VALUES (?, ?, ?, 'journal.post', 'journal.post', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      [randomUUID(), envelope.tenantId, envelope.bookSetId, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, resultHash, JSON.stringify({ journalId, status: "POSTED" }), now, now],
    );
    await session.execute(
      `INSERT INTO idempotency_records
       (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now],
    );
    return { resultJson, resultHash };
  });
}
