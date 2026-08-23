import { randomUUID } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";

export interface BankStatementRowPayload {
  lineNumber: number;
  transactionDate: string;
  description: string;
  reference?: string;
  signedAmountMinor: number;
}
export interface BankStatementImportPayload {
  bankAccountId: string;
  externalStatementId: string;
  periodStart: string;
  periodEnd: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  rows: BankStatementRowPayload[];
}
export type BankStatementEnvelope = CommandEnvelope<BankStatementImportPayload> & { bookSetId: BookSetId };
export interface BankStatementImportResult { statementId: string; externalStatementId: string; lineIds: string[]; status: "IMPORTED"; }
export interface BankStatementLineView { lineId: string; lineNumber: number; transactionDate: string; description: string; reference?: string; signedAmountMinor: number; matchStatus: "MATCHED" | "UNMATCHED"; matchId?: string; journalEntryId?: string; }
export interface BankStatementView { statementId: string; tenantId: string; bookSetId: string; bankAccountId: string; externalStatementId: string; periodStart: string; periodEnd: string; openingBalanceMinor: number; closingBalanceMinor: number; lines: BankStatementLineView[]; }

export interface BankMatchConfirmPayload { statementLineId: string; journalEntryId: string; }
export interface BankMatchUndoPayload { matchId?: string; statementLineId?: string; reason?: string; }
export type BankMatchConfirmEnvelope = CommandEnvelope<BankMatchConfirmPayload> & { bookSetId: BookSetId };
export type BankMatchUndoEnvelope = CommandEnvelope<BankMatchUndoPayload> & { bookSetId: BookSetId };
export interface BankMatchResult { matchId: string; statementLineId: string; journalEntryId: string; status: "ACTIVE" | "UNDONE"; }
export interface BankMatchCandidate { journalEntryId: string; postingDate: string; reference?: string; narration?: string; amountMinor: number; dayDistance: number; }
export interface BankReconciliationStatus {
  statementId: string; tenantId: string; bookSetId: string; bankAccountId: string; periodStart: string; periodEnd: string;
  openingBalanceMinor: number; closingBalanceMinor: number; rowInflowMinor: number; rowOutflowMinor: number; rowNetMinor: number;
  matchedCount: number; unmatchedCount: number; matchedInflowMinor: number; matchedOutflowMinor: number; matchedNetMinor: number;
  unmatchedInflowMinor: number; unmatchedOutflowMinor: number; unmatchedNetMinor: number;
  bookBalanceBeforePeriodMinor: number; bookBalanceAsOfPeriodEndMinor: number; openingDifferenceMinor: number; closingDifferenceMinor: number;
  arithmeticValid: boolean; isReconciled: boolean;
}
type ScopedEnvelope<P> = CommandEnvelope<P> & { bookSetId: BookSetId };
interface StoredIdempotency { requestHash: string; resultJson: string; resultHash: string; }

function date(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("INVALID_DATE", `${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date`);
}
function safeInteger(value: unknown, field: string, allowZero = true): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (!allowZero && value === 0)) throw new DomainError("INVALID_AMOUNT", `${field} must be a safe integer${allowZero ? "" : " and non-zero"}`);
  return value;
}
function text(value: unknown, field: string, max = 1024): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new DomainError("INVALID_FIELD", `${field} must be nonblank and bounded`);
  return value;
}
function numeric(value: unknown): number {
  const result = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  if (!Number.isSafeInteger(result)) throw new DomainError("AMOUNT_UNSAFE", "stored amount exceeds safe integer range");
  return result;
}
function add(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new DomainError("AMOUNT_UNSAFE", "amount total exceeds safe integer range");
  return result;
}
function replayOrThrow(existing: StoredIdempotency | undefined, requestHash: string): CommandResult<unknown> | undefined {
  if (!existing) return undefined;
  if (existing.requestHash !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
  if (computeResultHash(existing.resultJson) !== existing.resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson: existing.resultJson, resultHash: existing.resultHash, replayed: true };
}
async function existingCommand(session: BusinessSession, tenantId: TenantId, requestId: string): Promise<StoredIdempotency | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  return row ? { requestHash: String(row.request_hash), resultJson: String(row.result_json), resultHash: String(row.result_hash) } : undefined;
}
async function assertBookSet(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId): Promise<void> {
  const row = await session.querySingle("SELECT id, lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?", [bookSetId, tenantId]);
  if (!row) throw new DomainError("BOOK_SET_NOT_FOUND", "BookSet does not belong to tenant");
  if (String(row.lifecycle) !== "ACTIVE") throw new DomainError("BOOK_SET_INACTIVE", "BookSet must be ACTIVE");
}
async function assertBankAccount(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, accountId: string): Promise<void> {
  const row = await session.querySingle("SELECT account_type, archived_at FROM accounts WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [accountId, tenantId, bookSetId]);
  if (!row) throw new DomainError("ACCOUNT_SCOPE_MISMATCH", "bank account does not belong to tenant and BookSet");
  if (row.archived_at !== null && row.archived_at !== undefined) throw new DomainError("ACCOUNT_ARCHIVED", "bank account is archived");
  if (String(row.account_type) !== "ASSET") throw new DomainError("INVALID_ACCOUNT_CLASS", "bank account must be ASSET");
}
async function finish<T>(session: BusinessSession, envelope: ScopedEnvelope<unknown>, command: string, requestHash: string, result: T, entityType: string, entityId: string, now: string): Promise<CommandResult<T>> {
  const resultJson = canonicalJson(result);
  const resultHash = computeResultHash(resultJson);
  await session.execute(`INSERT INTO audit_records
    (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id, canonical_before_hash, canonical_after_hash, change_summary, committed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    [randomUUID(), envelope.tenantId, envelope.bookSetId, command, command, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, resultHash, JSON.stringify({ entityType, entityId }), now, now]);
  await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]);
  return { resultJson, resultHash };
}

function validateImport(payload: BankStatementImportPayload): void {
  text(payload.bankAccountId, "bankAccountId"); text(payload.externalStatementId, "externalStatementId"); date(payload.periodStart, "periodStart"); date(payload.periodEnd, "periodEnd");
  if (payload.periodStart > payload.periodEnd) throw new DomainError("INVALID_DATE_RANGE", "periodStart must not be after periodEnd");
  safeInteger(payload.openingBalanceMinor, "openingBalanceMinor"); safeInteger(payload.closingBalanceMinor, "closingBalanceMinor");
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) throw new DomainError("INVALID_STATEMENT_ROWS", "statement must contain at least one row");
  let sum = 0; let previous = 0;
  for (const [index, row] of payload.rows.entries()) {
    const line = row as BankStatementRowPayload;
    const lineNumber = safeInteger(line?.lineNumber, `rows[${index}].lineNumber`, false);
    if (lineNumber <= previous) throw new DomainError("INVALID_LINE_ORDER", "statement rows must have strictly increasing lineNumber values");
    previous = lineNumber; date(line?.transactionDate, `rows[${index}].transactionDate`);
    if (line.transactionDate < payload.periodStart || line.transactionDate > payload.periodEnd) throw new DomainError("DATE_OUTSIDE_PERIOD", `rows[${index}].transactionDate is outside the statement period`);
    text(line?.description, `rows[${index}].description`); if (line.reference !== undefined) text(line.reference, `rows[${index}].reference`);
    sum = add(sum, safeInteger(line?.signedAmountMinor, `rows[${index}].signedAmountMinor`, false));
  }
  if (add(payload.openingBalanceMinor, sum) !== payload.closingBalanceMinor) throw new DomainError("STATEMENT_ARITHMETIC_INVALID", "opening balance plus statement rows must equal closing balance");
}
function importContentHash(payload: BankStatementImportPayload): string { return computeResultHash(canonicalJson(payload)); }

export async function executeBankStatementImport(sessionRunner: BusinessSessionRunner, envelope: BankStatementEnvelope): Promise<CommandResult<BankStatementImportResult>> {
  validateCommandEnvelope(envelope); validateImport(envelope.payload);
  const requestHash = computeCommandHash("bankStatement.import", envelope, envelope.payload); const contentHash = importContentHash(envelope.payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const replay = replayOrThrow(await existingCommand(session, envelope.tenantId, envelope.requestId), requestHash); if (replay) return replay as CommandResult<BankStatementImportResult>;
    await assertBookSet(session, envelope.tenantId, envelope.bookSetId); await assertBankAccount(session, envelope.tenantId, envelope.bookSetId, envelope.payload.bankAccountId);
    const existing = await session.querySingle("SELECT id, content_hash FROM bank_statements WHERE tenant_id = ? AND book_set_id = ? AND bank_account_id = ? AND external_statement_id = ?", [envelope.tenantId, envelope.bookSetId, envelope.payload.bankAccountId, envelope.payload.externalStatementId]);
    if (existing) {
      if (String(existing.content_hash) !== contentHash) throw new DomainError("STATEMENT_IDEMPOTENCY_CONFLICT", "external statement already exists with different content");
      const lines = await session.query("SELECT id FROM bank_statement_lines WHERE tenant_id = ? AND book_set_id = ? AND statement_id = ? ORDER BY line_number", [envelope.tenantId, envelope.bookSetId, String(existing.id)]);
      return finish(session, envelope, "bankStatement.import", requestHash, { statementId: String(existing.id), externalStatementId: envelope.payload.externalStatementId, lineIds: lines.rows.map((row) => String(row.id)), status: "IMPORTED" }, "bank_statement", String(existing.id), new Date().toISOString()).then((result) => ({ ...result, replayed: true }));
    }
    const statementId = randomUUID(); const lineIds: string[] = []; const now = new Date().toISOString();
    await session.execute("INSERT INTO bank_statements (id, tenant_id, book_set_id, bank_account_id, external_statement_id, period_start, period_end, opening_balance_minor, closing_balance_minor, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [statementId, envelope.tenantId, envelope.bookSetId, envelope.payload.bankAccountId, envelope.payload.externalStatementId, envelope.payload.periodStart, envelope.payload.periodEnd, envelope.payload.openingBalanceMinor, envelope.payload.closingBalanceMinor, contentHash, now]);
    for (const row of envelope.payload.rows) { const lineId = randomUUID(); lineIds.push(lineId); await session.execute("INSERT INTO bank_statement_lines (id, tenant_id, book_set_id, statement_id, line_number, transaction_date, description, reference, signed_amount_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [lineId, envelope.tenantId, envelope.bookSetId, statementId, row.lineNumber, row.transactionDate, row.description, row.reference ?? null, row.signedAmountMinor]); }
    return finish(session, envelope, "bankStatement.import", requestHash, { statementId, externalStatementId: envelope.payload.externalStatementId, lineIds, status: "IMPORTED" }, "bank_statement", statementId, now);
  });
}

async function loadStatement(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, statementId: string): Promise<BankStatementView> {
  const row = await session.querySingle("SELECT id, tenant_id, book_set_id, bank_account_id, external_statement_id, period_start, period_end, opening_balance_minor, closing_balance_minor FROM bank_statements WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [statementId, tenantId, bookSetId]);
  if (!row) throw new DomainError("STATEMENT_SCOPE_MISMATCH", "statement does not belong to tenant and BookSet");
  const lines = await session.query(`SELECT bsl.id, bsl.line_number, bsl.transaction_date, bsl.description, bsl.reference, bsl.signed_amount_minor,
    bm.id AS match_id, bm.journal_entry_id FROM bank_statement_lines bsl
    LEFT JOIN bank_matches bm ON bm.statement_line_id = bsl.id AND bm.tenant_id = bsl.tenant_id AND bm.book_set_id = bsl.book_set_id AND bm.status = 'ACTIVE'
    WHERE bsl.tenant_id = ? AND bsl.book_set_id = ? AND bsl.statement_id = ? ORDER BY bsl.line_number`, [tenantId, bookSetId, statementId]);
  return { statementId: String(row.id), tenantId: String(row.tenant_id), bookSetId: String(row.book_set_id), bankAccountId: String(row.bank_account_id), externalStatementId: String(row.external_statement_id), periodStart: String(row.period_start), periodEnd: String(row.period_end), openingBalanceMinor: numeric(row.opening_balance_minor), closingBalanceMinor: numeric(row.closing_balance_minor), lines: lines.rows.map((line) => ({ lineId: String(line.id), lineNumber: numeric(line.line_number), transactionDate: String(line.transaction_date), description: String(line.description), ...(line.reference == null ? {} : { reference: String(line.reference) }), signedAmountMinor: numeric(line.signed_amount_minor), matchStatus: line.match_id == null ? "UNMATCHED" : "MATCHED", ...(line.match_id == null ? {} : { matchId: String(line.match_id), journalEntryId: String(line.journal_entry_id) }) })) };
}
export async function getBankStatement(sessionRunner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, statementId: string): Promise<BankStatementView> { return sessionRunner.withBusinessSession("read", async (session) => { await assertBookSet(session, tenantId, bookSetId); return loadStatement(session, tenantId, bookSetId, text(statementId, "statementId")); }); }
export async function listBankStatements(sessionRunner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, filter?: { statementId?: string }): Promise<BankStatementView[]> { return sessionRunner.withBusinessSession("read", async (session) => { await assertBookSet(session, tenantId, bookSetId); const rows = await session.query("SELECT id FROM bank_statements WHERE tenant_id = ? AND book_set_id = ? AND (? IS NULL OR id = ?) ORDER BY period_start, external_statement_id, id", [tenantId, bookSetId, filter?.statementId ?? null, filter?.statementId ?? null]); const result: BankStatementView[] = []; for (const row of rows.rows) result.push(await loadStatement(session, tenantId, bookSetId, String(row.id))); return result; }); }

export async function executeBankMatchConfirm(sessionRunner: BusinessSessionRunner, envelope: BankMatchConfirmEnvelope): Promise<CommandResult<BankMatchResult>> {
  validateCommandEnvelope(envelope); text(envelope.payload.statementLineId, "statementLineId"); text(envelope.payload.journalEntryId, "journalEntryId"); const requestHash = computeCommandHash("bankMatch.confirm", envelope, envelope.payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const replay = replayOrThrow(await existingCommand(session, envelope.tenantId, envelope.requestId), requestHash); if (replay) return replay as CommandResult<BankMatchResult>;
    await assertBookSet(session, envelope.tenantId, envelope.bookSetId);
    const line = await session.querySingle(`SELECT bsl.id, bsl.statement_id, bsl.signed_amount_minor, bs.bank_account_id FROM bank_statement_lines bsl JOIN bank_statements bs ON bs.id = bsl.statement_id AND bs.tenant_id = bsl.tenant_id AND bs.book_set_id = bsl.book_set_id WHERE bsl.id = ? AND bsl.tenant_id = ? AND bsl.book_set_id = ?`, [envelope.payload.statementLineId, envelope.tenantId, envelope.bookSetId]);
    if (!line) throw new DomainError("STATEMENT_LINE_SCOPE_MISMATCH", "statement line does not belong to tenant and BookSet");
    const activeLine = await session.querySingle("SELECT id FROM bank_matches WHERE statement_line_id = ? AND tenant_id = ? AND book_set_id = ? AND status = 'ACTIVE'", [envelope.payload.statementLineId, envelope.tenantId, envelope.bookSetId]); if (activeLine) throw new DomainError("BANK_LINE_ALREADY_MATCHED", "statement line is already matched");
    const journal = await session.querySingle("SELECT id, posting_date, status FROM journal_entries WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [envelope.payload.journalEntryId, envelope.tenantId, envelope.bookSetId]); if (!journal) throw new DomainError("JOURNAL_SCOPE_MISMATCH", "journal entry does not belong to tenant and BookSet"); if (String(journal.status) !== "POSTED") throw new DomainError("JOURNAL_NOT_POSTED", "only posted journal entries can be matched");
    const aggregateRows = await session.query("SELECT debit_minor, credit_minor FROM journal_lines WHERE tenant_id = ? AND book_set_id = ? AND journal_entry_id = ? AND account_id = ?", [envelope.tenantId, envelope.bookSetId, envelope.payload.journalEntryId, String(line.bank_account_id)]);
    let aggregate = 0; for (const row of aggregateRows.rows) aggregate = add(aggregate, numeric(row.debit_minor) - numeric(row.credit_minor));
    if (aggregate !== numeric(line.signed_amount_minor)) throw new DomainError("BANK_MATCH_AMOUNT_MISMATCH", "journal bank-account aggregate does not equal statement amount");
    const paired = await session.querySingle("SELECT id FROM bank_matches WHERE journal_entry_id = ? AND bank_account_id = ? AND tenant_id = ? AND book_set_id = ? AND status = 'ACTIVE'", [envelope.payload.journalEntryId, String(line.bank_account_id), envelope.tenantId, envelope.bookSetId]); if (paired) throw new DomainError("JOURNAL_ALREADY_MATCHED", "journal entry and bank account are already matched");
    const matchId = randomUUID(); const now = new Date().toISOString(); await session.execute("INSERT INTO bank_matches (id, tenant_id, book_set_id, statement_id, statement_line_id, bank_account_id, journal_entry_id, status, confirmed_at, undone_at, undo_reason) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, NULL)", [matchId, envelope.tenantId, envelope.bookSetId, String(line.statement_id), envelope.payload.statementLineId, String(line.bank_account_id), envelope.payload.journalEntryId, now]);
    return finish(session, envelope, "bankMatch.confirm", requestHash, { matchId, statementLineId: envelope.payload.statementLineId, journalEntryId: envelope.payload.journalEntryId, status: "ACTIVE" }, "bank_match", matchId, now);
  });
}

export async function executeBankMatchUndo(sessionRunner: BusinessSessionRunner, envelope: BankMatchUndoEnvelope): Promise<CommandResult<BankMatchResult>> {
  validateCommandEnvelope(envelope); const target = envelope.payload.matchId ?? envelope.payload.statementLineId; text(target, "matchId or statementLineId"); const reason = text(envelope.payload.reason ?? envelope.reason, "reason", 512); const requestHash = computeCommandHash("bankMatch.undo", envelope, envelope.payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const replay = replayOrThrow(await existingCommand(session, envelope.tenantId, envelope.requestId), requestHash); if (replay) return replay as CommandResult<BankMatchResult>;
    await assertBookSet(session, envelope.tenantId, envelope.bookSetId);
    const match = envelope.payload.matchId
      ? await session.querySingle("SELECT id, statement_line_id, journal_entry_id, status FROM bank_matches WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [target, envelope.tenantId, envelope.bookSetId])
      : await session.querySingle("SELECT id, statement_line_id, journal_entry_id, status FROM bank_matches WHERE statement_line_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY id LIMIT 1", [target, envelope.tenantId, envelope.bookSetId]);
    if (!match) throw new DomainError("BANK_MATCH_NOT_FOUND", "bank match does not belong to tenant and BookSet"); if (String(match.status) !== "ACTIVE") throw new DomainError("BANK_MATCH_NOT_ACTIVE", "bank match is already undone");
    const now = new Date().toISOString(); await session.execute("UPDATE bank_matches SET status = 'UNDONE', undone_at = ?, undo_reason = ? WHERE id = ? AND tenant_id = ? AND book_set_id = ? AND status = 'ACTIVE'", [now, reason, String(match.id), envelope.tenantId, envelope.bookSetId]);
    return finish(session, envelope, "bankMatch.undo", requestHash, { matchId: String(match.id), statementLineId: String(match.statement_line_id), journalEntryId: String(match.journal_entry_id), status: "UNDONE" }, "bank_match", String(match.id), now);
  });
}

export async function bankMatchCandidates(sessionRunner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, statementLineId: string): Promise<BankMatchCandidate[]> {
  return sessionRunner.withBusinessSession("read", async (session) => {
    await assertBookSet(session, tenantId, bookSetId); const line = await session.querySingle(`SELECT bsl.transaction_date, bsl.signed_amount_minor, bs.bank_account_id FROM bank_statement_lines bsl JOIN bank_statements bs ON bs.id = bsl.statement_id AND bs.tenant_id = bsl.tenant_id AND bs.book_set_id = bsl.book_set_id WHERE bsl.id = ? AND bsl.tenant_id = ? AND bsl.book_set_id = ?`, [text(statementLineId, "statementLineId"), tenantId, bookSetId]); if (!line) throw new DomainError("STATEMENT_LINE_SCOPE_MISMATCH", "statement line does not belong to tenant and BookSet");
    const active = await session.query("SELECT journal_entry_id FROM bank_matches WHERE tenant_id = ? AND book_set_id = ? AND bank_account_id = ? AND status = 'ACTIVE'", [tenantId, bookSetId, String(line.bank_account_id)]);
    const paired = new Set(active.rows.map((row) => String(row.journal_entry_id)));
    const rows = await session.query("SELECT je.id, je.posting_date, je.reference, je.narration, jl.debit_minor, jl.credit_minor FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.tenant_id = je.tenant_id AND jl.book_set_id = je.book_set_id WHERE je.tenant_id = ? AND je.book_set_id = ? AND je.status = 'POSTED' AND jl.account_id = ?", [tenantId, bookSetId, String(line.bank_account_id)]);
    const grouped = new Map<string, BankMatchCandidate>();
    for (const row of rows.rows) {
      const id = String(row.id); if (paired.has(id)) continue;
      const prior = grouped.get(id); const amount = add(prior?.amountMinor ?? 0, numeric(row.debit_minor) - numeric(row.credit_minor));
      grouped.set(id, { journalEntryId: id, postingDate: String(row.posting_date), ...(row.reference == null ? {} : { reference: String(row.reference) }), ...(row.narration == null ? {} : { narration: String(row.narration) }), amountMinor: amount, dayDistance: Math.abs(Date.parse(`${String(row.posting_date)}T00:00:00Z`) - Date.parse(`${String(line.transaction_date)}T00:00:00Z`)) / 86_400_000 });
    }
    return [...grouped.values()].filter((candidate) => candidate.amountMinor === numeric(line.signed_amount_minor)).sort((left, right) => left.dayDistance - right.dayDistance || left.postingDate.localeCompare(right.postingDate) || left.journalEntryId.localeCompare(right.journalEntryId));
  });
}

export async function bankReconciliationStatus(sessionRunner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, statementId: string): Promise<BankReconciliationStatus> {
  return sessionRunner.withBusinessSession("read", async (session) => {
    await assertBookSet(session, tenantId, bookSetId); const statement = await session.querySingle("SELECT id, bank_account_id, period_start, period_end, opening_balance_minor, closing_balance_minor FROM bank_statements WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [text(statementId, "statementId"), tenantId, bookSetId]); if (!statement) throw new DomainError("STATEMENT_SCOPE_MISMATCH", "statement does not belong to tenant and BookSet");
    const lines = await session.query("SELECT id, signed_amount_minor FROM bank_statement_lines WHERE tenant_id = ? AND book_set_id = ? AND statement_id = ? ORDER BY line_number", [tenantId, bookSetId, String(statement.id)]);
    const matches = await session.query("SELECT statement_line_id FROM bank_matches WHERE tenant_id = ? AND book_set_id = ? AND statement_id = ? AND status = 'ACTIVE'", [tenantId, bookSetId, String(statement.id)]);
    const matchedLines = new Set(matches.rows.map((row) => String(row.statement_line_id))); let inflow = 0; let outflow = 0; let net = 0; let matchedInflow = 0; let matchedOutflow = 0; let unmatchedInflow = 0; let unmatchedOutflow = 0;
    for (const row of lines.rows) { const amount = numeric(row.signed_amount_minor); net = add(net, amount); if (amount > 0) inflow = add(inflow, amount); else outflow = add(outflow, -amount); if (matchedLines.has(String(row.id))) { if (amount > 0) matchedInflow = add(matchedInflow, amount); else matchedOutflow = add(matchedOutflow, -amount); } else if (amount > 0) unmatchedInflow = add(unmatchedInflow, amount); else unmatchedOutflow = add(unmatchedOutflow, -amount); }
    const bookRows = await session.query("SELECT je.posting_date, jl.debit_minor, jl.credit_minor FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.tenant_id = je.tenant_id AND jl.book_set_id = je.book_set_id WHERE je.tenant_id = ? AND je.book_set_id = ? AND je.status = 'POSTED' AND jl.account_id = ?", [tenantId, bookSetId, String(statement.bank_account_id)]);
    let bookBefore = 0; let bookEnding = 0; for (const row of bookRows.rows) { const amount = numeric(row.debit_minor) - numeric(row.credit_minor); if (String(row.posting_date) < String(statement.period_start)) bookBefore = add(bookBefore, amount); if (String(row.posting_date) <= String(statement.period_end)) bookEnding = add(bookEnding, amount); }
    const opening = numeric(statement.opening_balance_minor); const closing = numeric(statement.closing_balance_minor); const matchedCount = matchedLines.size; const unmatchedCount = lines.rows.length - matchedCount; const arithmeticValid = add(opening, net) === closing; const openingDifference = opening - bookBefore; const closingDifference = closing - bookEnding;
    return { statementId: String(statement.id), tenantId, bookSetId, bankAccountId: String(statement.bank_account_id), periodStart: String(statement.period_start), periodEnd: String(statement.period_end), openingBalanceMinor: opening, closingBalanceMinor: closing, rowInflowMinor: inflow, rowOutflowMinor: outflow, rowNetMinor: net, matchedCount, unmatchedCount, matchedInflowMinor: matchedInflow, matchedOutflowMinor: matchedOutflow, matchedNetMinor: matchedInflow - matchedOutflow, unmatchedInflowMinor: unmatchedInflow, unmatchedOutflowMinor: unmatchedOutflow, unmatchedNetMinor: unmatchedInflow - unmatchedOutflow, bookBalanceBeforePeriodMinor: bookBefore, bookBalanceAsOfPeriodEndMinor: bookEnding, openingDifferenceMinor: openingDifference, closingDifferenceMinor: closingDifference, arithmeticValid, isReconciled: arithmeticValid && unmatchedCount === 0 && openingDifference === 0 && closingDifference === 0 };
  });
}
