import { createHash, randomUUID } from "node:crypto";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import { ledgerSnapshotInSession, type BalanceSheetReport, type ProfitAndLossReport, type TrialBalanceReport } from "./ledger-report-service.ts";

export type FiscalYearRolloverStatus = "NOT_FINALIZED" | "FINALIZED" | "STALE";
export type FiscalYearPeriodStatus = "OPEN" | "CLOSED" | "REOPENED";

export interface FiscalYearAccountBalance {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  openingDebitMinor: number;
  openingCreditMinor: number;
  openingBalanceMinor: number;
  closingDebitMinor: number;
  closingCreditMinor: number;
  closingBalanceMinor: number;
}

export interface FiscalYearRolloverSnapshot {
  schemaVersion: 1;
  tenantId: string;
  bookSetId: string;
  financialYear: string;
  periodStart: string;
  periodEnd: string;
  ledgerRevision: number;
  periodClose: { status: FiscalYearPeriodStatus; eventId?: string; planHash?: string };
  closePack: { manifestId?: string; manifestHash?: string; periodCloseStateHash?: string; periodCloseLabel?: string };
  closingTrialBalance: TrialBalanceReport;
  profitAndLoss: ProfitAndLossReport;
  balanceSheet: BalanceSheetReport;
  accounts: FiscalYearAccountBalance[];
  continuity: {
    syntheticJournalsCreated: false;
    retainedEarningsDoubleCounted: false;
    nextYearBalanceSheet: "CONTINUES_FROM_LEDGER";
    nextYearProfitAndLoss: "RESETS_BY_REPORT_DATE_RANGE";
  };
}

export interface FiscalYearRolloverPreview extends FiscalYearRolloverSnapshot {
  previewHash: string;
}

export interface FiscalYearRolloverFinalizePayload {
  financialYear: string;
  previewHash: string;
  ledgerRevision: number;
  closePackManifestId: string;
  closePackManifestHash: string;
  confirm: boolean;
}

export interface FiscalYearRolloverResult {
  rolloverId: string;
  status: "FINALIZED";
  tenantId: string;
  bookSetId: string;
  financialYear: string;
  ledgerRevision: number;
  snapshotHash: string;
  closePackManifestId: string;
  closePackManifestHash: string;
  submitted: false;
  governmentFiling: false;
}

type RolloverEnvelope<P> = CommandEnvelope<P> & { bookSetId: BookSetId };
type Scope = { tenantId: TenantId; bookSetId: BookSetId };
type FiscalYearBounds = { financialYear: string; periodStart: string; periodEnd: string };
type Row = Record<string, unknown>;

function nonblank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_FISCAL_YEAR_ROLLOVER_INPUT", `${field} must be nonblank`);
  return value.trim();
}

function hashJson(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }

function safeInteger(value: unknown, field: string): number {
  const result = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  if (!Number.isSafeInteger(result)) throw new DomainError("FISCAL_YEAR_ROLLOVER_AMOUNT_UNSAFE", `${field} exceeds the safe integer range`);
  return result;
}

function add(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new DomainError("FISCAL_YEAR_ROLLOVER_AMOUNT_UNSAFE", `${field} exceeds the safe integer range`);
  return result;
}

function subtract(left: number, right: number, field: string): number {
  const result = left - right;
  if (!Number.isSafeInteger(result)) throw new DomainError("FISCAL_YEAR_ROLLOVER_AMOUNT_UNSAFE", `${field} exceeds the safe integer range`);
  return result;
}

function isoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("INVALID_FISCAL_YEAR_ROLLOVER_DATE", `${field} must be a valid ISO date`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new DomainError("INVALID_FISCAL_YEAR_ROLLOVER_DATE", `${field} must be a valid ISO date`);
}

function parseFinancialYear(value: unknown): FiscalYearBounds {
  const input = nonblank(value, "financialYear");
  const match = /^(\d{4})-(\d{2}|\d{4})$/.exec(input);
  if (!match) throw new DomainError("INVALID_FINANCIAL_YEAR", "financialYear must use YYYY-YY or YYYY-YYYY");
  const startYear = Number(match[1]);
  const endYear = match[2]!.length === 2 ? Number(`${match[1]!.slice(0, 2)}${match[2]}`) : Number(match[2]);
  if (endYear !== startYear + 1) throw new DomainError("INVALID_FINANCIAL_YEAR", "financialYear must be one India FY from 1 April through 31 March");
  const financialYear = `${String(startYear).padStart(4, "0")}-${String(endYear).padStart(4, "0")}`;
  const periodStart = `${String(startYear).padStart(4, "0")}-04-01`;
  const periodEnd = `${String(endYear).padStart(4, "0")}-03-31`;
  isoDate(periodStart, "periodStart");
  isoDate(periodEnd, "periodEnd");
  return { financialYear, periodStart, periodEnd };
}

function previousDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function normalBalance(accountType: string, debit: number, credit: number): number {
  return ["LIABILITY", "EQUITY", "INCOME"].includes(accountType) ? subtract(credit, debit, "account balance") : subtract(debit, credit, "account balance");
}

async function assertBookSet(session: BusinessSession, scope: Scope): Promise<void> {
  const row = await session.querySingle("SELECT id, lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?", [scope.bookSetId, scope.tenantId]);
  if (!row) throw new DomainError("BOOK_SET_NOT_FOUND", `BookSet not found: ${scope.bookSetId}`);
  if (String(row.lifecycle) !== "ACTIVE") throw new DomainError("BOOK_SET_INACTIVE", "BookSet must be ACTIVE");
}

async function ledgerRevision(session: BusinessSession, scope: Scope): Promise<number> {
  const row = await session.querySingle("SELECT revision FROM book_set_ledger_revisions WHERE tenant_id = ? AND book_set_id = ?", [scope.tenantId, scope.bookSetId]);
  if (!row) throw new DomainError("LEDGER_REVISION_UNAVAILABLE", "BookSet ledger revision authority is unavailable");
  return safeInteger(row.revision, "ledger revision");
}

async function periodState(session: BusinessSession, scope: Scope, bounds: FiscalYearBounds): Promise<{ status: FiscalYearPeriodStatus; eventId?: string; planHash?: string }> {
  const row = await session.querySingle("SELECT id, event_type, plan_hash FROM period_close_events WHERE tenant_id = ? AND book_set_id = ? AND period_start = ? AND period_end = ? ORDER BY occurred_at DESC, id DESC LIMIT 1", [scope.tenantId, scope.bookSetId, bounds.periodStart, bounds.periodEnd]);
  if (!row) return { status: "OPEN" };
  const eventType = String(row.event_type);
  return { status: eventType === "CLOSED" ? "CLOSED" : eventType === "REOPENED" ? "REOPENED" : "OPEN", eventId: String(row.id), planHash: String(row.plan_hash) };
}

async function closePackState(session: BusinessSession, scope: Scope, bounds: FiscalYearBounds): Promise<{ manifestId?: string; manifestHash?: string; periodCloseStateHash?: string; periodCloseLabel?: string }> {
  const row = await session.querySingle("SELECT id, manifest_hash, period_close_state_hash, period_close_label FROM close_pack_manifests WHERE tenant_id = ? AND book_set_id = ? AND period_start = ? AND period_end = ? ORDER BY created_at DESC, id DESC LIMIT 1", [scope.tenantId, scope.bookSetId, bounds.periodStart, bounds.periodEnd]);
  if (!row) return {};
  return { manifestId: String(row.id), manifestHash: String(row.manifest_hash), periodCloseStateHash: String(row.period_close_state_hash), periodCloseLabel: String(row.period_close_label) };
}

async function accountBalances(session: BusinessSession, scope: Scope, bounds: FiscalYearBounds): Promise<FiscalYearAccountBalance[]> {
  const openingDate = previousDate(bounds.periodStart);
  const rows = await session.query(
    `SELECT a.id, a.code, a.name, a.account_type,
            COALESCE(SUM(CASE WHEN je.posting_date <= ? THEN jl.debit_minor ELSE 0 END), 0) AS opening_debit,
            COALESCE(SUM(CASE WHEN je.posting_date <= ? THEN jl.credit_minor ELSE 0 END), 0) AS opening_credit,
            COALESCE(SUM(CASE WHEN je.posting_date <= ? THEN jl.debit_minor ELSE 0 END), 0) AS closing_debit,
            COALESCE(SUM(CASE WHEN je.posting_date <= ? THEN jl.credit_minor ELSE 0 END), 0) AS closing_credit
       FROM accounts a
       LEFT JOIN journal_lines jl ON jl.account_id = a.id AND jl.tenant_id = a.tenant_id AND jl.book_set_id = a.book_set_id
       LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.tenant_id = jl.tenant_id AND je.book_set_id = jl.book_set_id AND je.status = 'POSTED'
      WHERE a.tenant_id = ? AND a.book_set_id = ?
      GROUP BY a.id, a.code, a.name, a.account_type
      ORDER BY a.code, a.id`,
    [openingDate, openingDate, bounds.periodEnd, bounds.periodEnd, scope.tenantId, scope.bookSetId],
  );
  return rows.rows.map((row) => {
    const accountType = String(row.account_type);
    const openingDebitMinor = safeInteger(row.opening_debit, "opening debit");
    const openingCreditMinor = safeInteger(row.opening_credit, "opening credit");
    const closingDebitMinor = safeInteger(row.closing_debit, "closing debit");
    const closingCreditMinor = safeInteger(row.closing_credit, "closing credit");
    return {
      accountId: String(row.id), code: String(row.code), name: String(row.name), accountType,
      openingDebitMinor, openingCreditMinor, openingBalanceMinor: normalBalance(accountType, openingDebitMinor, openingCreditMinor),
      closingDebitMinor, closingCreditMinor, closingBalanceMinor: normalBalance(accountType, closingDebitMinor, closingCreditMinor),
    };
  });
}

async function buildPreview(session: BusinessSession, scope: Scope, bounds: FiscalYearBounds): Promise<FiscalYearRolloverPreview> {
  await assertBookSet(session, scope);
  const revision = await ledgerRevision(session, scope);
  const periodClose = await periodState(session, scope, bounds);
  const closePack = await closePackState(session, scope, bounds);
  const ledger = await ledgerSnapshotInSession(session, scope.tenantId, scope.bookSetId, bounds.periodStart, bounds.periodEnd);
  const snapshot: FiscalYearRolloverSnapshot = {
    schemaVersion: 1,
    tenantId: String(scope.tenantId), bookSetId: String(scope.bookSetId), financialYear: bounds.financialYear,
    periodStart: bounds.periodStart, periodEnd: bounds.periodEnd, ledgerRevision: revision,
    periodClose, closePack,
    closingTrialBalance: ledger.trialBalance, profitAndLoss: ledger.profitAndLoss, balanceSheet: ledger.balanceSheet,
    accounts: await accountBalances(session, scope, bounds),
    continuity: { syntheticJournalsCreated: false, retainedEarningsDoubleCounted: false, nextYearBalanceSheet: "CONTINUES_FROM_LEDGER", nextYearProfitAndLoss: "RESETS_BY_REPORT_DATE_RANGE" },
  };
  return { ...snapshot, previewHash: hashJson(snapshot) };
}

async function replay(session: BusinessSession, envelope: RolloverEnvelope<unknown>, requestHash: string): Promise<CommandResult<FiscalYearRolloverResult> | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [envelope.tenantId, envelope.requestId]);
  if (!row) return undefined;
  if (String(row.request_hash) !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
  if (computeResultHash(String(row.result_json)) !== String(row.result_hash)) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson: String(row.result_json), resultHash: String(row.result_hash), replayed: true };
}

function exactHash(value: unknown, field: string): string {
  const result = nonblank(value, field).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(result)) throw new DomainError("INVALID_FISCAL_YEAR_ROLLOVER_HASH", `${field} must be a lowercase SHA-256 hash`);
  return result;
}

function finalizeGuard(preview: FiscalYearRolloverPreview, payload: FiscalYearRolloverFinalizePayload): void {
  if (preview.ledgerRevision !== payload.ledgerRevision) throw new DomainError("FISCAL_YEAR_ROLLOVER_LEDGER_REVISION_CHANGED", "Ledger revision changed; preview a new rollover revision", { expectedLedgerRevision: preview.ledgerRevision, suppliedLedgerRevision: payload.ledgerRevision });
  if (preview.previewHash !== payload.previewHash) throw new DomainError("FISCAL_YEAR_ROLLOVER_PREVIEW_STALE", "Rollover preview is stale; preview the current ledger again", { expectedPreviewHash: preview.previewHash, suppliedPreviewHash: payload.previewHash });
  if (preview.periodClose.status !== "CLOSED") throw new DomainError(preview.periodClose.status === "REOPENED" ? "FISCAL_YEAR_ROLLOVER_PERIOD_REOPENED" : "FISCAL_YEAR_ROLLOVER_PERIOD_NOT_CLOSED", "The full India financial year must be currently CLOSED");
  if (!preview.closePack.manifestId || !preview.closePack.manifestHash || preview.closePack.periodCloseLabel !== "CLOSED") throw new DomainError("FISCAL_YEAR_ROLLOVER_CLOSE_PACK_REQUIRED", "A persisted CLOSED CA close pack is required");
  if (preview.closePack.manifestId !== payload.closePackManifestId || preview.closePack.manifestHash !== payload.closePackManifestHash) throw new DomainError("FISCAL_YEAR_ROLLOVER_CLOSE_PACK_STALE", "The supplied CA close pack is not the current matching persisted pack", { expectedManifestId: preview.closePack.manifestId, expectedManifestHash: preview.closePack.manifestHash });
  if (preview.closePack.periodCloseStateHash !== preview.periodClose.planHash) throw new DomainError("FISCAL_YEAR_ROLLOVER_CLOSE_PACK_MISMATCH", "The CA close pack is not bound to the current CLOSED period state");
  if (preview.closingTrialBalance.isBalanced !== true || preview.balanceSheet.isBalanced !== true) throw new DomainError("FISCAL_YEAR_ROLLOVER_LEDGER_UNBALANCED", "Fiscal year rollover requires a balanced closing Trial Balance and Balance Sheet");
}

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.includes(",") || text.includes('"') || text.includes("\r") || text.includes("\n") ? `"${text.replace(/"/g, '""')}"` : text;
}

function artifactCsv(snapshot: FiscalYearRolloverSnapshot): string {
  const lines = ["Account ID,Code,Name,Type,Opening Debit (Minor Units),Opening Credit (Minor Units),Opening Balance (Minor Units),Closing Debit (Minor Units),Closing Credit (Minor Units),Closing Balance (Minor Units)"];
  for (const row of snapshot.accounts) lines.push([row.accountId, row.code, row.name, row.accountType, row.openingDebitMinor, row.openingCreditMinor, row.openingBalanceMinor, row.closingDebitMinor, row.closingCreditMinor, row.closingBalanceMinor].map(escapeCsv).join(","));
  lines.push("");
  lines.push(["SUMMARY", "", "", "", "", "", "", "", "", ""].map(escapeCsv).join(","));
  lines.push(["Trial Balance Balanced", snapshot.closingTrialBalance.isBalanced ? "Yes" : "No"].map(escapeCsv).join(","));
  lines.push(["Net Profit/Loss (Minor Units)", snapshot.profitAndLoss.netProfitLossMinor].map(escapeCsv).join(","));
  lines.push(["Balance Sheet Balanced", snapshot.balanceSheet.isBalanced ? "Yes" : "No"].map(escapeCsv).join(","));
  return lines.join("\r\n");
}

function artifactText(snapshot: FiscalYearRolloverSnapshot): string {
  return [
    "Agent-Bahi Fiscal Year Rollover V1",
    `Financial year: ${snapshot.financialYear}`,
    `Tenant: ${snapshot.tenantId}`,
    `BookSet: ${snapshot.bookSetId}`,
    `Ledger revision: ${snapshot.ledgerRevision}`,
    `Trial Balance: ${snapshot.closingTrialBalance.isBalanced ? "BALANCED" : "UNBALANCED"}`,
    `Profit and Loss result (minor units): ${snapshot.profitAndLoss.netProfitLossMinor}`,
    `Balance Sheet: ${snapshot.balanceSheet.isBalanced ? "BALANCED" : "UNBALANCED"}`,
    "",
    "Continuity: next-year Balance Sheet continues from the ledger; next-year P&L resets by report date range.",
    "Synthetic closing/opening journals: none.",
  ].join("\n");
}

async function rowForId(session: BusinessSession, scope: Scope, rolloverId: string, bounds: FiscalYearBounds): Promise<Row> {
  const row = await session.querySingle("SELECT * FROM fiscal_year_rollovers WHERE id = ? AND tenant_id = ? AND book_set_id = ? AND financial_year = ?", [rolloverId, scope.tenantId, scope.bookSetId, bounds.financialYear]);
  if (!row) throw new DomainError("FISCAL_YEAR_ROLLOVER_NOT_FOUND", "Fiscal year rollover does not belong to the requested tenant, BookSet, and FY");
  if (hashJson(JSON.parse(String(row.snapshot_json))) !== String(row.snapshot_hash)) throw new DomainError("FISCAL_YEAR_ROLLOVER_SNAPSHOT_CORRUPT", "Persisted fiscal year rollover snapshot hash does not match");
  return row;
}

async function currentStatus(session: BusinessSession, scope: Scope, bounds: FiscalYearBounds, row: Row): Promise<{ status: FiscalYearRolloverStatus; reasons: string[] }> {
  const reasons: string[] = [];
  const revision = await ledgerRevision(session, scope);
  if (revision !== safeInteger(row.ledger_revision, "stored ledger revision")) reasons.push("LEDGER_REVISION_CHANGED");
  const period = await periodState(session, scope, bounds);
  if (period.status !== "CLOSED") reasons.push(period.status === "REOPENED" ? "PERIOD_REOPENED" : "PERIOD_NOT_CLOSED");
  const closePack = await closePackState(session, scope, bounds);
  if (closePack.manifestId !== String(row.close_pack_manifest_id) || closePack.manifestHash !== String(row.close_pack_manifest_hash) || closePack.periodCloseLabel !== "CLOSED") reasons.push("CLOSE_PACK_CHANGED");
  return { status: reasons.length === 0 ? "FINALIZED" : "STALE", reasons };
}

export class FiscalYearRolloverService {
  constructor(private readonly sessionRunner: BusinessSessionRunner) {}

  async preview(tenantId: TenantId, bookSetId: BookSetId, financialYear: string): Promise<FiscalYearRolloverPreview> {
    const bounds = parseFinancialYear(financialYear);
    return this.sessionRunner.withBusinessSession("read", (session) => buildPreview(session, { tenantId, bookSetId }, bounds));
  }

  async finalize(envelope: RolloverEnvelope<FiscalYearRolloverFinalizePayload>): Promise<CommandResult<FiscalYearRolloverResult>> {
    validateCommandEnvelope(envelope);
    if (envelope.actor.kind !== "HUMAN") throw new DomainError("FISCAL_YEAR_ROLLOVER_HUMAN_REQUIRED", "Fiscal year rollover finalization requires a HUMAN actor");
    if (envelope.payload.confirm !== true) throw new DomainError("FISCAL_YEAR_ROLLOVER_CONFIRMATION_REQUIRED", "Fiscal year rollover finalization requires confirm=true");
    const bounds = parseFinancialYear(envelope.payload.financialYear);
    const payload = { ...envelope.payload, financialYear: bounds.financialYear, previewHash: exactHash(envelope.payload.previewHash, "previewHash"), closePackManifestHash: exactHash(envelope.payload.closePackManifestHash, "closePackManifestHash"), closePackManifestId: nonblank(envelope.payload.closePackManifestId, "closePackManifestId") };
    if (!Number.isSafeInteger(payload.ledgerRevision) || payload.ledgerRevision < 0) throw new DomainError("INVALID_FISCAL_YEAR_ROLLOVER_REVISION", "ledgerRevision must be a nonnegative safe integer");
    const requestHash = computeCommandHash("fiscal-year.rollover.finalize", envelope, payload);
    return this.sessionRunner.withBusinessSession("write", async (session) => {
      const prior = await replay(session, envelope, requestHash);
      if (prior) return prior;
      const existing = await session.querySingle("SELECT id FROM fiscal_year_rollovers WHERE tenant_id = ? AND book_set_id = ? AND financial_year = ?", [envelope.tenantId, envelope.bookSetId, bounds.financialYear]);
      if (existing) throw new DomainError("FISCAL_YEAR_ROLLOVER_ALREADY_FINALIZED", "This tenant, BookSet, and financial year already has an immutable rollover", { rolloverId: String(existing.id) });
      const preview = await buildPreview(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId }, bounds);
      finalizeGuard(preview, payload);
      const rolloverId = randomUUID();
      const snapshotJson = canonicalJson(preview);
      const snapshotHash = hashJson(preview);
      const resultBase: FiscalYearRolloverResult = { rolloverId, status: "FINALIZED", tenantId: String(envelope.tenantId), bookSetId: String(envelope.bookSetId), financialYear: bounds.financialYear, ledgerRevision: preview.ledgerRevision, snapshotHash, closePackManifestId: payload.closePackManifestId, closePackManifestHash: payload.closePackManifestHash, submitted: false, governmentFiling: false };
      const resultJson = canonicalJson(resultBase);
      const resultHash = computeResultHash(resultJson);
      const now = new Date().toISOString();
      await session.execute("INSERT INTO fiscal_year_rollovers (id, tenant_id, book_set_id, financial_year, period_start, period_end, ledger_revision, close_pack_manifest_id, close_pack_manifest_hash, snapshot_json, snapshot_hash, actor_type, actor_id, source, reason, request_id, request_hash, result_json, result_hash, finalized_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [rolloverId, envelope.tenantId, envelope.bookSetId, bounds.financialYear, bounds.periodStart, bounds.periodEnd, preview.ledgerRevision, payload.closePackManifestId, payload.closePackManifestHash, snapshotJson, snapshotHash, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, requestHash, resultJson, resultHash, now]);
      await session.execute("INSERT INTO audit_records (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, "fiscal-year.rollover.finalize", "FISCAL_YEAR_ROLLOVER_FINALIZED", envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, snapshotHash, canonicalJson({ rolloverId, financialYear: bounds.financialYear, ledgerRevision: preview.ledgerRevision, submitted: false, governmentFiling: false }), now, now]);
      await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]);
      return { resultJson, resultHash };
    });
  }

  async show(tenantId: TenantId, bookSetId: BookSetId, financialYear: string, rolloverId: string): Promise<Record<string, unknown>> {
    const bounds = parseFinancialYear(financialYear);
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const row = await rowForId(session, { tenantId, bookSetId }, nonblank(rolloverId, "rolloverId"), bounds);
      const state = await currentStatus(session, { tenantId, bookSetId }, bounds, row);
      return { rolloverId: String(row.id), tenantId: String(tenantId), bookSetId: String(bookSetId), financialYear: bounds.financialYear, status: state.status, statusReasons: state.reasons, snapshotHash: String(row.snapshot_hash), snapshot: JSON.parse(String(row.snapshot_json)), closePackManifestId: String(row.close_pack_manifest_id), closePackManifestHash: String(row.close_pack_manifest_hash), submitted: false, governmentFiling: false };
    });
  }

  async status(tenantId: TenantId, bookSetId: BookSetId, financialYear: string): Promise<Record<string, unknown>> {
    const bounds = parseFinancialYear(financialYear);
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      await assertBookSet(session, { tenantId, bookSetId });
      const row = await session.querySingle("SELECT id, snapshot_hash, close_pack_manifest_id, close_pack_manifest_hash, ledger_revision FROM fiscal_year_rollovers WHERE tenant_id = ? AND book_set_id = ? AND financial_year = ?", [tenantId, bookSetId, bounds.financialYear]);
      if (!row) return { tenantId: String(tenantId), bookSetId: String(bookSetId), financialYear: bounds.financialYear, periodStart: bounds.periodStart, periodEnd: bounds.periodEnd, status: "NOT_FINALIZED" as const, statusReasons: ["ROLLOVER_NOT_FINALIZED"], submitted: false, governmentFiling: false };
      const state = await currentStatus(session, { tenantId, bookSetId }, bounds, row);
      return { tenantId: String(tenantId), bookSetId: String(bookSetId), financialYear: bounds.financialYear, periodStart: bounds.periodStart, periodEnd: bounds.periodEnd, rolloverId: String(row.id), status: state.status, statusReasons: state.reasons, snapshotHash: String(row.snapshot_hash), ledgerRevision: safeInteger(row.ledger_revision, "stored ledger revision"), closePackManifestId: String(row.close_pack_manifest_id), closePackManifestHash: String(row.close_pack_manifest_hash), submitted: false, governmentFiling: false };
    });
  }

  async export(tenantId: TenantId, bookSetId: BookSetId, financialYear: string, rolloverId: string, format: string): Promise<Record<string, unknown>> {
    const bounds = parseFinancialYear(financialYear);
    const normalizedFormat = nonblank(format, "format").toUpperCase();
    if (!["CSV", "TEXT", "JSON"].includes(normalizedFormat)) throw new DomainError("INVALID_FISCAL_YEAR_ROLLOVER_FORMAT", "format must be CSV, TEXT, or JSON");
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const scope = { tenantId, bookSetId };
      const row = await rowForId(session, scope, nonblank(rolloverId, "rolloverId"), bounds);
      const state = await currentStatus(session, scope, bounds, row);
      if (state.status !== "FINALIZED") throw new DomainError("FISCAL_YEAR_ROLLOVER_STALE", "Stale rollover artifacts require a new preview and revision", { statusReasons: state.reasons });
      const snapshot = JSON.parse(String(row.snapshot_json)) as FiscalYearRolloverSnapshot;
      const content = normalizedFormat === "CSV" ? artifactCsv(snapshot) : normalizedFormat === "TEXT" ? artifactText(snapshot) : canonicalJson(snapshot);
      const contentHash = createHash("sha256").update(content).digest("hex");
      return { rolloverId: String(row.id), tenantId: String(tenantId), bookSetId: String(bookSetId), financialYear: bounds.financialYear, format: normalizedFormat, contentType: normalizedFormat === "CSV" ? "text/csv" : normalizedFormat === "TEXT" ? "text/plain" : "application/json", filename: `fiscal-year-rollover-${bounds.financialYear}.${normalizedFormat === "TEXT" ? "txt" : normalizedFormat.toLowerCase()}`, content, contentHash, submitted: false, governmentFiling: false };
    });
  }
}
