import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";
import { importBankStatementInSession, type BankStatementImportResult, type BankStatementEnvelope, type BankStatementRowPayload } from "./bank-reconciliation-service.ts";

export const SCB_PARSER_ID = "SCB_TRANSACTION_CSV_V1" as const;
export const CRAZE_PARSER_ID = "CRAZE_VIRTUAL_ACCOUNT_CSV_V1" as const;

const SCB_HEADERS = ["Account Number", "Account Name", "Address", "Currency", "Date", "Description", "Withdrawal", "Deposit", "Balance"] as const;
const CRAZE_HEADERS = ["Date", "Party Name", "Transaction Type", "Description", "Status", "Debit", "Credit", "Balance"] as const;
type ParserId = typeof SCB_PARSER_ID | typeof CRAZE_PARSER_ID;

export interface SourceFilePayload {
  filePath: string;
  bankAccountId: string;
  parserId: ParserId;
  periodStart?: string;
  periodEnd?: string;
  authorityState?: "PRIMARY" | "DERIVED" | "UNVERIFIED";
  overrideReason?: string;
}
export type SourceFileEnvelope = CommandEnvelope<SourceFilePayload> & { bookSetId: BookSetId };

export interface ParsedBankFile {
  parserId: ParserId;
  parserVersion: string;
  sourceLocator: string;
  mediaType: "text/csv";
  encoding: "UTF-8";
  contentHash: string;
  schemaFingerprint: string;
  headerFingerprint: string;
  rowCount: number;
  transactionCount: number;
  fullSourceRowCount: number;
  fullSourceTransactionCount: number;
  importedRowCount: number;
  excludedPrePeriodRowCount: number;
  excludedPostPeriodRowCount: number;
  sourcePeriodStart: string;
  sourcePeriodEnd: string;
  importPeriodStart: string;
  importPeriodEnd: string;
  maskedEntityIdentity: string;
  maskedAccountIdentity: string;
  closingBalanceRowExcluded: boolean;
  excludedRows: Array<{ rowNumber: number; reason: "CLOSING_BALANCE_ONLY" }>;
  rows: BankStatementRowPayload[];
  openingBalanceMinor: number;
  closingBalanceMinor: number;
}

export interface SourceFilePreview extends Omit<ParsedBankFile, "rows"> {
  rows: BankStatementRowPayload[];
  status: "PREVIEW";
  postsJournal: false;
}

export interface SourceImportResult extends BankStatementImportResult {
  sourceId: string;
  sourceContentHash: string;
  parserId: ParserId;
  fullSourceRowCount: number;
  fullSourceTransactionCount: number;
  importedRowCount: number;
  excludedPrePeriodRowCount: number;
  excludedPostPeriodRowCount: number;
  importPeriodStart: string;
  importPeriodEnd: string;
  status: "IMPORTED";
  postsJournal: false;
}

function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function text(value: unknown, field: string, max = 4096): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new DomainError("INVALID_FIELD", `${field} must be nonblank and bounded`);
  return value;
}
function isoDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("INVALID_DATE", `${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date`);
  return value;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
function normalizedDate(value: string, field: string, format: "SCB" | "CRAZE"): string {
  const cell = canonicalCell(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(cell)) return isoDate(cell, field);
  const match = format === "SCB" ? /^(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/.exec(cell) : /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}), (\d{4})$/.exec(cell);
  if (!match) throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date or exact English ${format === "SCB" ? "DD Mon YYYY" : "Mon DD, YYYY"} date`);
  const day = format === "SCB" ? match[1]! : match[2]!;
  const month = format === "SCB" ? match[2]! : match[1]!;
  const year = format === "SCB" ? match[3]! : match[3]!;
  return isoDate(`${year}-${String(MONTHS.indexOf(month as typeof MONTHS[number]) + 1).padStart(2, "0")}-${day}`, field);
}
function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new DomainError("AMOUNT_UNSAFE", "INR minor-unit total exceeds safe integer range");
  return value;
}
function parseMinor(value: string, field: string): number | undefined {
  const normalized = value.trim().replaceAll(",", "").replace(/^₹\s*/, "");
  if (normalized === "") return undefined;
  if (!/^\+?\d+(?:\.\d{1,2})?$/.test(normalized)) throw new DomainError("INVALID_INR_AMOUNT", `${field} must be an exact non-negative INR amount with at most two decimals`);
  const [whole, fraction = ""] = normalized.replace(/^\+/, "").split(".");
  const minor = Number(`${whole}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(minor)) throw new DomainError("AMOUNT_UNSAFE", `${field} exceeds safe INR minor-unit range`);
  return minor;
}
function parseMovement(value: string, field: string): number | undefined {
  const amount = parseMinor(value, field);
  return amount === 0 ? undefined : amount;
}
function mask(value: string, visible = 4): string {
  const compact = value.trim();
  if (!compact) return "UNVERIFIED";
  return `${"*".repeat(Math.max(3, compact.length - visible))}${compact.slice(-visible)}`;
}
function canonicalCell(value: string): string { return value.trim().replace(/\s+/g, " "); }

/** RFC4180-style parser: quoted commas, escaped quotes, and embedded newlines. */
function parseCsv(bytes: Uint8Array): string[][] {
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new DomainError("UNSUPPORTED_FILE_ENCODING", "CSV must be valid UTF-8"); }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  if (source.includes("\0")) throw new DomainError("UNSUPPORTED_BINARY_FILE", "binary or encrypted files are rejected");
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false; let afterQuote = false;
  for (let i = 0; i < source.length; i += 1) {
    const character = source[i]!;
    if (quoted) {
      if (character === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; } else { quoted = false; afterQuote = true; }
      } else cell += character;
      continue;
    }
    if (afterQuote) {
      if (character === " ") continue;
      if (character === ",") { row.push(cell); cell = ""; afterQuote = false; continue; }
      if (character === "\r" || character === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; afterQuote = false; if (character === "\r" && source[i + 1] === "\n") i += 1; continue; }
      throw new DomainError("MALFORMED_CSV", "characters after a quoted CSV field are rejected");
    }
    if (character === '"' && cell === "") { quoted = true; continue; }
    if (character === ",") { row.push(cell); cell = ""; continue; }
    if (character === "\r" || character === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; if (character === "\r" && source[i + 1] === "\n") i += 1; continue; }
    cell += character;
  }
  if (quoted) throw new DomainError("MALFORMED_CSV", "unterminated quoted CSV field");
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  while (rows.length && rows.at(-1)!.every((value) => value.trim() === "")) rows.pop();
  if (rows.length < 2) throw new DomainError("INVALID_CSV", "CSV must contain a header and at least one data row");
  return rows;
}

function safeSourcePath(filePath: string, sourceRoot: string | undefined): string {
  text(filePath, "filePath", 2048); text(sourceRoot, "sourceRoot", 2048);
  if (!isAbsolute(filePath) || !isAbsolute(sourceRoot!)) throw new DomainError("INVALID_SOURCE_PATH", "filePath and operator sourceRoot must be absolute");
  if (filePath.split(/[\\/]+/).includes("..")) throw new DomainError("SOURCE_PATH_TRAVERSAL", "source file path traversal is rejected");
  const suspicious = /(^|[/\\])(?:\.ssh|\.aws|\.config|keychains?|cookies?|secrets?|credentials?|passwords?|tokens?|browser|chrome|safari|firefox)(?:[/\\]|$)/i;
  if (suspicious.test(filePath)) throw new DomainError("SOURCE_SENSITIVE_PATH", "browser and secrets paths are rejected");
  let root: string;
  try { root = realpathSync(sourceRoot!); } catch { throw new DomainError("SOURCE_ROOT_INVALID", "operator sourceRoot must exist"); }
  let canonical: string;
  try {
    const requested = resolve(filePath);
    if (lstatSync(requested).isSymbolicLink()) throw new Error("symlink");
    canonical = realpathSync(requested);
  } catch { throw new DomainError("SOURCE_PATH_REJECTED", "source file must be an existing regular non-symlink file"); }
  const outside = relative(root, canonical);
  if (outside === "" || outside.startsWith(`..${sep}`) || outside === ".." || outside.startsWith(sep)) throw new DomainError("SOURCE_PATH_OUTSIDE_ROOT", "source file is outside the explicit operator sourceRoot");
  try { if (!lstatSync(canonical).isFile()) throw new Error("not-file"); } catch { throw new DomainError("SOURCE_PATH_REJECTED", "source file must be a regular file"); }
  return canonical;
}

function headerCheck(actual: string[], expected: readonly string[], parserId: ParserId): { headerFingerprint: string; schemaFingerprint: string } {
  const normalized = actual.map(canonicalCell);
  if (normalized.length !== expected.length || normalized.some((value, index) => value !== expected[index])) throw new DomainError("CSV_SCHEMA_MISMATCH", `${parserId} requires the exact documented header`);
  return { headerFingerprint: hash(canonicalJson(normalized)), schemaFingerprint: hash(canonicalJson({ parserId, parserVersion: "1", columns: normalized })) };
}

function continuity(rows: Array<{ date: string; balance: number; signed: number }>): { opening: number; closing: number } {
  if (rows.length === 0) throw new DomainError("NO_TRANSACTIONS", "CSV contains no transaction rows");
  let opening = rows[0]!.balance - rows[0]!.signed;
  if (!Number.isSafeInteger(opening)) throw new DomainError("AMOUNT_UNSAFE", "derived opening balance exceeds safe integer range");
  let previous = opening; let previousDate = rows[0]!.date;
  for (const row of rows) { if (row.date < previousDate) throw new DomainError("INVALID_DATE_ORDER", "bank rows must be in nondecreasing transaction-date order"); const expected = safeAdd(previous, row.signed); if (expected !== row.balance) throw new DomainError("STATEMENT_BALANCE_MISMATCH", `running balance mismatch on ${row.date}`); previous = row.balance; previousDate = row.date; }
  return { opening, closing: previous };
}

function duplicateGuard(key: string, seen: Set<string>): void { if (seen.has(key)) throw new DomainError("DUPLICATE_TRANSACTION", "duplicate transaction rows are rejected"); seen.add(key); }

function parseScb(records: string[][], sourceLocator: string, contentHash: string): ParsedBankFile {
  const fingerprints = headerCheck(records[0]!, SCB_HEADERS, SCB_PARSER_ID); const rows: BankStatementRowPayload[] = []; const running: Array<{ date: string; balance: number; signed: number }> = []; const seen = new Set<string>(); const accounts = new Set<string>(); const names = new Set<string>(); const excludedRows: ParsedBankFile["excludedRows"] = []; const closingRows: Array<{ date: string; balance: number }> = [];
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index]!; if (record.length !== SCB_HEADERS.length) throw new DomainError("MALFORMED_CSV", `row ${index + 1} has the wrong number of columns`);
    const [accountNumber, accountName, address, _currency, dateValue, description, withdrawalRaw, depositRaw, balanceRaw] = record.map(canonicalCell);
    if (!dateValue || !description || !accountNumber) throw new DomainError("INVALID_BANK_ROW", `SCB row ${index + 1} is missing account, date, or description`);
    const date = normalizedDate(dateValue, `row ${index + 1} Date`, "SCB"); const withdrawalAmount = parseMinor(withdrawalRaw, `row ${index + 1} Withdrawal`); const depositAmount = parseMinor(depositRaw, `row ${index + 1} Deposit`); const withdrawal = parseMovement(withdrawalRaw, `row ${index + 1} Withdrawal`); const deposit = parseMovement(depositRaw, `row ${index + 1} Deposit`); const balance = parseMinor(balanceRaw, `row ${index + 1} Balance`);
    if (description === "Closing Balance" && withdrawalAmount === 0 && depositAmount === 0 && balance !== undefined) { excludedRows.push({ rowNumber: index + 1, reason: "CLOSING_BALANCE_ONLY" }); closingRows.push({ date, balance }); accounts.add(accountNumber); names.add(accountName); continue; }
    if (balance === undefined || ((withdrawal === undefined) === (deposit === undefined))) throw new DomainError("INVALID_BANK_ROW", `SCB row ${index + 1} must contain exactly one withdrawal or deposit and a balance`);
    const signed = deposit !== undefined ? deposit : -withdrawal!; duplicateGuard(canonicalJson([date, description, signed, balance, accountNumber]), seen); accounts.add(accountNumber); names.add(accountName);
    rows.push({ lineNumber: index + 1, transactionDate: date, description, reference: address || undefined, signedAmountMinor: signed, statementMinorAmount: balance }); running.push({ date, balance, signed });
  }
  if (accounts.size !== 1) throw new DomainError("BANK_ACCOUNT_IDENTITY_MISMATCH", "SCB file contains more than one account number");
  const balances = continuity(running); for (const closingRow of closingRows) if (closingRow.balance !== balances.closing) throw new DomainError("STATEMENT_BALANCE_MISMATCH", "SCB closing balance row does not match the running balance");
  return { parserId: SCB_PARSER_ID, parserVersion: "1", sourceLocator, mediaType: "text/csv", encoding: "UTF-8", contentHash, ...fingerprints, rowCount: records.length - 1, transactionCount: rows.length, fullSourceRowCount: records.length - 1, fullSourceTransactionCount: rows.length, importedRowCount: rows.length, excludedPrePeriodRowCount: 0, excludedPostPeriodRowCount: 0, sourcePeriodStart: running[0]!.date, sourcePeriodEnd: [running.at(-1)!.date, ...closingRows.map((row) => row.date)].sort().at(-1)!, importPeriodStart: running[0]!.date, importPeriodEnd: [running.at(-1)!.date, ...closingRows.map((row) => row.date)].sort().at(-1)!, maskedEntityIdentity: mask([...names][0] ?? "UNVERIFIED"), maskedAccountIdentity: mask([...accounts][0]!), closingBalanceRowExcluded: excludedRows.length > 0, excludedRows, rows, openingBalanceMinor: balances.opening, closingBalanceMinor: balances.closing };
}

function parseCraze(records: string[][], sourceLocator: string, contentHash: string): ParsedBankFile {
  const fingerprints = headerCheck(records[0]!, CRAZE_HEADERS, CRAZE_PARSER_ID); const rows: BankStatementRowPayload[] = []; const running: Array<{ date: string; balance: number; signed: number }> = []; const seen = new Set<string>(); const parties = new Set<string>();
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index]!; if (record.length !== CRAZE_HEADERS.length) throw new DomainError("MALFORMED_CSV", `row ${index + 1} has the wrong number of columns`);
    const [dateRaw, party, _type, description, status, debitRaw, creditRaw, balanceRaw] = record.map(canonicalCell); if (!dateRaw || !party || !description || !status) throw new DomainError("INVALID_BANK_ROW", `CRAZE row ${index + 1} is missing date, party, description, or status`);
    const date = normalizedDate(dateRaw, `row ${index + 1} Date`, "CRAZE"); const debit = parseMovement(debitRaw, `row ${index + 1} Debit`); const credit = parseMovement(creditRaw, `row ${index + 1} Credit`); const balance = parseMinor(balanceRaw, `row ${index + 1} Balance`);
    if (balance === undefined || ((debit === undefined) === (credit === undefined))) throw new DomainError("INVALID_BANK_ROW", `CRAZE row ${index + 1} must contain exactly one debit or credit and a balance`);
    const signed = credit !== undefined ? credit : -debit!; duplicateGuard(canonicalJson([date, party, description, signed, balance]), seen); parties.add(party); rows.push({ lineNumber: index + 1, transactionDate: date, description: `${party}: ${description}`, reference: status, signedAmountMinor: signed, statementMinorAmount: balance }); running.push({ date, balance, signed });
  }
  const balances = continuity(running); return { parserId: CRAZE_PARSER_ID, parserVersion: "1", sourceLocator, mediaType: "text/csv", encoding: "UTF-8", contentHash, ...fingerprints, rowCount: records.length - 1, transactionCount: rows.length, fullSourceRowCount: records.length - 1, fullSourceTransactionCount: rows.length, importedRowCount: rows.length, excludedPrePeriodRowCount: 0, excludedPostPeriodRowCount: 0, sourcePeriodStart: running[0]!.date, sourcePeriodEnd: running.at(-1)!.date, importPeriodStart: running[0]!.date, importPeriodEnd: running.at(-1)!.date, maskedEntityIdentity: mask([...parties].sort().join(",")), maskedAccountIdentity: "EXPLICIT_BANK_ACCOUNT", closingBalanceRowExcluded: false, excludedRows: [], rows, openingBalanceMinor: balances.opening, closingBalanceMinor: balances.closing };
}

function projectImportPeriod(parsed: ParsedBankFile, periodStart?: string, periodEnd?: string): ParsedBankFile {
  const start = periodStart === undefined ? parsed.sourcePeriodStart : isoDate(periodStart, "periodStart"); const end = periodEnd === undefined ? parsed.sourcePeriodEnd : isoDate(periodEnd, "periodEnd");
  if (start > end) throw new DomainError("INVALID_DATE_RANGE", "periodStart must not be after periodEnd");
  if (start < parsed.sourcePeriodStart || end > parsed.sourcePeriodEnd) throw new DomainError("IMPORT_PERIOD_UNPROVABLE", "requested import period is outside the source range and its boundary balance cannot be proven");
  const before = parsed.rows.filter((row) => row.transactionDate < start).length; const after = parsed.rows.filter((row) => row.transactionDate > end).length; const rows = parsed.rows.filter((row) => row.transactionDate >= start && row.transactionDate <= end);
  if (rows.length === 0) throw new DomainError("IMPORT_PERIOD_UNPROVABLE", "requested import period contains no transactions whose opening and closing balances can be proven");
  const first = rows[0]!; const last = rows.at(-1)!; const derivedOpening = before === 0 ? parsed.openingBalanceMinor : parsed.rows[before - 1]!.statementMinorAmount;
  if (derivedOpening === undefined || first.statementMinorAmount === undefined || last.statementMinorAmount === undefined) throw new DomainError("IMPORT_PERIOD_UNPROVABLE", "requested import period has no provable running-balance boundary");
  let balance = derivedOpening; for (const row of rows) { balance = safeAdd(balance, row.signedAmountMinor); if (balance !== row.statementMinorAmount) throw new DomainError("STATEMENT_BALANCE_MISMATCH", `running balance mismatch on ${row.transactionDate}`); }
  if (balance !== last.statementMinorAmount) throw new DomainError("IMPORT_PERIOD_UNPROVABLE", "requested import period closing balance cannot be proven");
  return { ...parsed, transactionCount: rows.length, importedRowCount: rows.length, excludedPrePeriodRowCount: before, excludedPostPeriodRowCount: after, importPeriodStart: start, importPeriodEnd: end, rows, openingBalanceMinor: derivedOpening, closingBalanceMinor: last.statementMinorAmount };
}

export function inspectBankFile(filePath: string, parserId: ParserId, sourceRoot?: string, period?: Pick<SourceFilePayload, "periodStart" | "periodEnd">): SourceFilePreview {
  const locator = safeSourcePath(filePath, sourceRoot); const bytes = readFileSync(locator); const parsed = parserId === SCB_PARSER_ID ? parseScb(parseCsv(bytes), locator, hash(bytes)) : parserId === CRAZE_PARSER_ID ? parseCraze(parseCsv(bytes), locator, hash(bytes)) : (() => { throw new DomainError("UNKNOWN_PARSER", "unsupported bank file parser"); })();
  return { ...projectImportPeriod(parsed, period?.periodStart, period?.periodEnd), status: "PREVIEW", postsJournal: false };
}

async function assertScope(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, bankAccountId: string): Promise<void> {
  const bookSet = await session.querySingle("SELECT id, lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?", [bookSetId, tenantId]); if (!bookSet || String(bookSet.lifecycle) !== "ACTIVE") throw new DomainError("BOOK_SET_NOT_FOUND", "BookSet does not belong to tenant or is inactive");
  const account = await session.querySingle("SELECT id, account_type, archived_at FROM accounts WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [bankAccountId, tenantId, bookSetId]); if (!account) throw new DomainError("ACCOUNT_SCOPE_MISMATCH", "bank account does not belong to tenant and BookSet"); if (account.archived_at != null || String(account.account_type) !== "ASSET") throw new DomainError("INVALID_BANK_ACCOUNT", "bank account must be an active ASSET account");
}
async function existingIdempotency(session: BusinessSession, tenantId: TenantId, requestId: string, requestHash: string): Promise<CommandResult<unknown> | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]); if (!row) return undefined;
  if (String(row.request_hash) !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash"); if (computeResultHash(String(row.result_json)) !== String(row.result_hash)) throw new IdempotencyCorruptError("stored result_json hash mismatch"); return { resultJson: String(row.result_json), resultHash: String(row.result_hash), replayed: true };
}

export async function inspectBankFileForScope(runner: BusinessSessionRunner, envelope: SourceFileEnvelope, sourceRoot?: string): Promise<SourceFilePreview> {
  validateCommandEnvelope(envelope); const preview = inspectBankFile(envelope.payload.filePath, envelope.payload.parserId, sourceRoot, envelope.payload);
  return runner.withBusinessSession("read", async (session) => { await assertScope(session, envelope.tenantId, envelope.bookSetId, envelope.payload.bankAccountId); return preview; });
}

export async function importBankFile(runner: BusinessSessionRunner, envelope: SourceFileEnvelope, sourceRoot?: string): Promise<CommandResult<SourceImportResult>> {
  validateCommandEnvelope(envelope); const payload = envelope.payload; const authority = payload.authorityState ?? "PRIMARY"; if (authority !== "PRIMARY" && (envelope.actor.kind !== "HUMAN" || !payload.overrideReason?.trim())) throw new DomainError("NON_PRIMARY_SOURCE_REQUIRES_HUMAN_OVERRIDE", "bank import requires PRIMARY authority or a HUMAN overrideReason");
  const parsed = inspectBankFile(payload.filePath, payload.parserId, sourceRoot, payload); const requestHash = computeCommandHash("bankStatement.import-file", envelope, { ...payload, sourceContentHash: parsed.contentHash, importPeriodStart: parsed.importPeriodStart, importPeriodEnd: parsed.importPeriodEnd }); const bankEnvelope: BankStatementEnvelope = { ...envelope, payload: { bankAccountId: payload.bankAccountId, externalStatementId: `${payload.parserId}:${parsed.contentHash}:${parsed.importPeriodStart}:${parsed.importPeriodEnd}`, periodStart: parsed.importPeriodStart, periodEnd: parsed.importPeriodEnd, openingBalanceMinor: parsed.openingBalanceMinor, closingBalanceMinor: parsed.closingBalanceMinor, rows: parsed.rows } };
  return runner.withBusinessSession("write", async (session) => {
    const replay = await existingIdempotency(session, envelope.tenantId, envelope.requestId, requestHash); if (replay) return replay as CommandResult<SourceImportResult>;
    await assertScope(session, envelope.tenantId, envelope.bookSetId, payload.bankAccountId); const now = new Date().toISOString();
    const existingSource = await session.querySingle("SELECT id, content_hash, parser_id, parser_version FROM source_registrations WHERE tenant_id = ? AND book_set_id = ? AND content_hash = ? AND parser_id = ? AND parser_version = ?", [envelope.tenantId, envelope.bookSetId, parsed.contentHash, parsed.parserId, parsed.parserVersion]);
    const sourceId = existingSource ? String(existingSource.id) : randomUUID();
    if (!existingSource) await session.execute("INSERT INTO source_registrations (id, tenant_id, book_set_id, content_hash, source_locator, media_type, encoding, parser_id, parser_version, schema_fingerprint, header_fingerprint, row_count, source_period_start, source_period_end, masked_entity_identity, masked_account_identity, authority_state, created_at, created_by_actor_kind, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [sourceId, envelope.tenantId, envelope.bookSetId, parsed.contentHash, parsed.sourceLocator, parsed.mediaType, parsed.encoding, parsed.parserId, parsed.parserVersion, parsed.schemaFingerprint, parsed.headerFingerprint, parsed.rowCount, parsed.sourcePeriodStart, parsed.sourcePeriodEnd, parsed.maskedEntityIdentity, parsed.maskedAccountIdentity, authority, now, envelope.actor.kind, envelope.actor.id]);
    const bankResult = await importBankStatementInSession(session, bankEnvelope, parsed.contentHash); const result: SourceImportResult = { ...bankResult, sourceId, sourceContentHash: parsed.contentHash, parserId: parsed.parserId, fullSourceRowCount: parsed.fullSourceRowCount, fullSourceTransactionCount: parsed.fullSourceTransactionCount, importedRowCount: parsed.importedRowCount, excludedPrePeriodRowCount: parsed.excludedPrePeriodRowCount, excludedPostPeriodRowCount: parsed.excludedPostPeriodRowCount, importPeriodStart: parsed.importPeriodStart, importPeriodEnd: parsed.importPeriodEnd, status: "IMPORTED", postsJournal: false };
    const resultJson = canonicalJson(result); const resultHash = computeResultHash(resultJson);
    await session.execute("INSERT INTO source_import_events (id, tenant_id, book_set_id, source_id, event_type, request_id, request_hash, reason, actor_kind, actor_id, details_json, created_at) VALUES (?, ?, ?, ?, 'IMPORTED', ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, sourceId, envelope.requestId, requestHash, envelope.reason, envelope.actor.kind, envelope.actor.id, canonicalJson({ closingBalanceRowExcluded: parsed.closingBalanceRowExcluded, excludedRows: parsed.excludedRows, fullSourceRowCount: parsed.fullSourceRowCount, importedRowCount: parsed.importedRowCount, excludedPrePeriodRowCount: parsed.excludedPrePeriodRowCount, excludedPostPeriodRowCount: parsed.excludedPostPeriodRowCount, importPeriodStart: parsed.importPeriodStart, importPeriodEnd: parsed.importPeriodEnd }), now]);
    await session.execute("INSERT INTO audit_records (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, 'bankStatement.import-file', 'bankStatement.import-file', ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, resultHash, JSON.stringify({ entityType: "source_registration", entityId: sourceId, journalCreated: false }), now, now]);
    await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]); return { resultJson, resultHash };
  });
}
