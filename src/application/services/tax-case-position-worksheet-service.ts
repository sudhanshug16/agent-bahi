import { createHash, randomUUID } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError, brandBookSetId, brandTenantId } from "../../core/types.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";
import { filingSnapshotStateInSession } from "./tax-case-filing-snapshot-service.ts";
import { ledgerSnapshotInSession } from "./ledger-report-service.ts";

const COMMAND = "tax-case.position.generate";
const KIND = "PERSONAL_TAX_POSITION_WORKSHEET_V1" as const;
const INCOME_KINDS = ["INTEREST_INCOME", "DIVIDEND_INCOME", "RENT_INCOME", "OTHER"] as const;
const CREDIT_KINDS = ["TDS_CREDIT", "TCS_CREDIT", "TAX_PAYMENT"] as const;

type PositionPayload = { taxCaseId: string; filingSnapshotId: string };
type PositionEnvelope = CommandEnvelope<PositionPayload>;
type AmountDetail = { totalMinor: number; detailCount: number };

export interface TaxPositionWorksheet {
  worksheetKind: typeof KIND;
  tenantId: string;
  taxCaseId: string;
  filingSnapshotId: string;
  snapshotCandidateHash: string;
  financialPeriod: { financialYear: string; taxPeriod: string; fromDate: string; toDate: string };
  businessBookProfitLossMinor: {
    byBookSet: Array<{ bookSetId: string; bookSetKind: "PROPRIETORSHIP"; amountMinor: number; incomeMinor: number; expenseMinor: number; journalEntryCount: number }>;
    totalMinor: number;
  };
  personalIncomeFactsMinor: { byKind: Record<string, AmountDetail>; totalMinor: number };
  taxCreditsMinor: { byKind: Record<string, AmountDetail>; totalMinor: number };
  supportingBusinessReceiptMinor: AmountDetail;
  unresolved: { items: Array<{ factId: string; kind: string; amountMinor: number; reasonCode: string }>; totalMinor: number; detailCount: number };
  preliminaryKnownIncomeMinor: number;
  scope: "PRELIMINARY_KNOWN_INCOME_ONLY";
  exclusions: readonly string[];
}

export interface TaxPositionWorksheetView extends TaxPositionWorksheet {
  worksheetId: string;
  status: "CURRENT" | "STALE" | "BLOCKED";
  inputHash: string;
  canonicalOutputHash: string;
  inputBindings: Record<string, unknown>;
  createdAt: string;
  createdByActorId: string;
  statusReasons: string[];
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_TAX_POSITION_INPUT", `${field} must be a nonblank string`);
  return value.trim();
}

function hash(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }

function safeMinor(value: unknown, field: string): number {
  const number = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  if (!Number.isSafeInteger(number)) throw new DomainError("TAX_POSITION_AMOUNT_UNSAFE", `${field} exceeds safe integer range`);
  return number;
}

function add(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new DomainError("TAX_POSITION_AMOUNT_UNSAFE", "worksheet total exceeds safe integer range");
  return result;
}

function normalizePayload(payload: PositionPayload): PositionPayload {
  return { taxCaseId: text(payload?.taxCaseId, "taxCaseId"), filingSnapshotId: text(payload?.filingSnapshotId, "filingSnapshotId") };
}

function financialPeriod(financialYear: string, taxPeriod: string): { financialYear: string; taxPeriod: string; fromDate: string; toDate: string } {
  const explicit = taxPeriod.match(/^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|\/)\s*(\d{4}-\d{2}-\d{2})$/);
  if (explicit) return { financialYear, taxPeriod, fromDate: explicit[1]!, toDate: explicit[2]! };
  const year = financialYear.match(/^(\d{4})-(?:\d{2}|\d{4})$/);
  if (!year) throw new DomainError("TAX_POSITION_PERIOD_UNSUPPORTED", "TaxCase financialYear must be YYYY-YY or an explicit date range is required");
  const start = Number(year[1]);
  return { financialYear, taxPeriod, fromDate: `${start}-04-01`, toDate: `${start + 1}-03-31` };
}

async function replay(session: BusinessSession, tenantId: string, requestId: string, requestHash: string): Promise<CommandResult<Record<string, unknown>> | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  if (!row) return undefined;
  if (String(row.request_hash) !== requestHash) throw new IdempotencyConflictError("same request_id with different normalized request payload");
  const resultJson = String(row.result_json); const resultHash = String(row.result_hash);
  if (computeResultHash(resultJson) !== resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson, resultHash, replayed: true };
}

async function auditGenerate(session: BusinessSession, envelope: PositionEnvelope, worksheetId: string, resultHash: string, replayed: boolean): Promise<void> {
  const now = new Date().toISOString();
  await session.execute("INSERT INTO audit_records (id, tenant_id, command, action, actor_type, actor_id, source, reason, request_id, entity_type, entity_id, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, COMMAND, COMMAND, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, "PersonalTaxPositionWorksheet", worksheetId, resultHash, JSON.stringify({ worksheetId, replayed }), now, now]);
}

function emptyDetails(): Record<string, AmountDetail> {
  return Object.fromEntries([...INCOME_KINDS, ...CREDIT_KINDS].map((kind) => [kind, { totalMinor: 0, detailCount: 0 }])) as Record<string, AmountDetail>;
}

function addDetail(details: Record<string, AmountDetail>, kind: string, amount: number): void {
  const current = details[kind] ?? { totalMinor: 0, detailCount: 0 };
  details[kind] = { totalMinor: add(current.totalMinor, amount), detailCount: current.detailCount + 1 };
}

async function deriveWorksheet(session: BusinessSession, tenantId: string, taxCaseId: string, filingSnapshotId: string): Promise<{ worksheet: TaxPositionWorksheet; inputBindings: Record<string, unknown>; snapshotStatus: string; snapshotReasons: string[] }> {
  const state = await filingSnapshotStateInSession(session, tenantId, taxCaseId, filingSnapshotId);
  const snapshotReasons = state.status === "CURRENT" ? [] : state.currentBlockers.length ? state.currentBlockers : ["SNAPSHOT_INPUTS_CHANGED"];
  if (state.status !== "CURRENT") throw new DomainError("TAX_POSITION_SNAPSHOT_NOT_CURRENT", "Position worksheet requires a CURRENT FilingSnapshot", { snapshotId: filingSnapshotId, status: state.status, reasons: snapshotReasons });
  const taxCase = await session.querySingle("SELECT financial_year, tax_period FROM tax_cases WHERE id = ? AND tenant_id = ?", [taxCaseId, tenantId]);
  if (!taxCase) throw new DomainError("TAX_CASE_NOT_FOUND", "TaxCase does not belong to tenant");
  const period = financialPeriod(String(taxCase.financial_year), String(taxCase.tax_period));
  const candidateBookSets = Array.isArray(state.candidate.bookSets) ? state.candidate.bookSets as Array<Record<string, unknown>> : [];
  const business: TaxPositionWorksheet["businessBookProfitLossMinor"]["byBookSet"] = [];
  const bookSetBindings: Array<Record<string, unknown>> = [];
  for (const member of candidateBookSets.filter((row) => String(row.kind) === "PROPRIETORSHIP")) {
    const bookSetId = text(member.bookSetId, "bookSetId");
    const boundRevision = safeMinor(member.ledgerRevision, "ledgerRevision");
    const cursor = await session.querySingle("SELECT revision FROM book_set_ledger_revisions WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
    const currentRevision = safeMinor(cursor?.revision, "current ledger revision");
    const allJournals = await session.query("SELECT id FROM journal_entries WHERE tenant_id = ? AND book_set_id = ? AND status = 'POSTED' ORDER BY posting_date, id", [tenantId, bookSetId]);
    if (currentRevision !== boundRevision || allJournals.rows.length !== boundRevision) throw new DomainError("BOOK_REVISION_NOT_REPRODUCIBLE", "The bound BookSet ledger revision cannot be reproduced by the current report layer", { bookSetId, boundRevision, currentRevision, postedJournalCount: allJournals.rows.length });
    const journalEntryIds = allJournals.rows.map((row) => String(row.id));
    const reports = await ledgerSnapshotInSession(session, brandTenantId(tenantId), brandBookSetId(bookSetId), period.fromDate, period.toDate);
    business.push({ bookSetId, bookSetKind: "PROPRIETORSHIP", amountMinor: reports.profitAndLoss.netProfitLossMinor, incomeMinor: reports.profitAndLoss.incomeMinor, expenseMinor: reports.profitAndLoss.expenseMinor, journalEntryCount: journalEntryIds.length });
    bookSetBindings.push({ bookSetId, bookSetKind: "PROPRIETORSHIP", ledgerRevision: boundRevision, journalEntryIds });
  }
  const businessTotal = business.reduce((sum, row) => add(sum, row.amountMinor), 0);
  const incomeByKind = emptyDetails(); const creditsByKind = emptyDetails();
  const supporting: AmountDetail = { totalMinor: 0, detailCount: 0 };
  const unresolvedItems: TaxPositionWorksheet["unresolved"]["items"] = [];
  const factRows = await session.query("SELECT sf.fact_id, sf.normalized_payload_hash AS bound_payload_hash, sf.terminal_event_id, sf.terminal_event_type, sf.terminal_event_hash, sf.lifecycle AS bound_lifecycle, f.kind, f.gross_amount_minor, f.event_date, f.period_start, f.period_end, f.normalized_payload_hash, f.provenance_json FROM filing_snapshot_facts sf JOIN tax_case_facts f ON f.id = sf.fact_id AND f.tenant_id = sf.tenant_id AND f.tax_case_id = sf.tax_case_id WHERE sf.snapshot_id = ? AND sf.tenant_id = ? AND sf.tax_case_id = ? ORDER BY sf.fact_id", [filingSnapshotId, tenantId, taxCaseId]);
  const factBindings: Array<Record<string, unknown>> = [];
  for (const row of factRows.rows) {
    const factId = String(row.fact_id); const kind = String(row.kind); const amount = safeMinor(row.gross_amount_minor, `fact ${factId}`);
    if (String(row.bound_payload_hash) !== String(row.normalized_payload_hash) || !/^[0-9a-f]{64}$/.test(String(row.terminal_event_hash))) throw new DomainError("TAX_POSITION_FACT_BINDING_INVALID", "A bound fact no longer matches its FilingSnapshot binding", { factId });
    factBindings.push({ factId, kind, normalizedPayloadHash: String(row.bound_payload_hash), terminalEventId: String(row.terminal_event_id), terminalEventType: String(row.terminal_event_type), terminalEventHash: String(row.terminal_event_hash) });
    if (String(row.bound_lifecycle) !== "HUMAN_CONFIRMED") continue;
    if (INCOME_KINDS.includes(kind as (typeof INCOME_KINDS)[number])) addDetail(incomeByKind, kind, amount);
    else if (CREDIT_KINDS.includes(kind as (typeof CREDIT_KINDS)[number])) addDetail(creditsByKind, kind, amount);
    else if (kind === "BUSINESS_RECEIPT") supporting.totalMinor = add(supporting.totalMinor, amount), supporting.detailCount += 1;
    else if (kind === "SECURITIES_TRANSACTION") unresolvedItems.push({ factId, kind, amountMinor: amount, reasonCode: "SECURITIES_COST_BASIS_REQUIRED" });
    else unresolvedItems.push({ factId, kind, amountMinor: amount, reasonCode: "UNCLASSIFIED_FACT" });
  }
  const personalTotal = INCOME_KINDS.reduce((sum, kind) => add(sum, incomeByKind[kind]!.totalMinor), 0);
  const creditTotal = CREDIT_KINDS.reduce((sum, kind) => add(sum, creditsByKind[kind]!.totalMinor), 0);
  const unresolvedTotal = unresolvedItems.reduce((sum, item) => add(sum, item.amountMinor), 0);
  const inputBindings = { schemaVersion: 1, worksheetKind: KIND, tenantId, taxCaseId, filingSnapshotId, snapshotCandidateHash: state.candidateHash, financialPeriod: period, bookSets: bookSetBindings, facts: factBindings };
  const worksheet: TaxPositionWorksheet = {
    worksheetKind: KIND, tenantId, taxCaseId, filingSnapshotId, snapshotCandidateHash: state.candidateHash, financialPeriod: period,
    businessBookProfitLossMinor: { byBookSet: business, totalMinor: businessTotal },
    personalIncomeFactsMinor: { byKind: Object.fromEntries(INCOME_KINDS.map((kind) => [kind, incomeByKind[kind]])), totalMinor: personalTotal },
    taxCreditsMinor: { byKind: Object.fromEntries(CREDIT_KINDS.map((kind) => [kind, creditsByKind[kind]])), totalMinor: creditTotal },
    supportingBusinessReceiptMinor: supporting,
    unresolved: { items: unresolvedItems, totalMinor: unresolvedTotal, detailCount: unresolvedItems.length },
    preliminaryKnownIncomeMinor: add(businessTotal, personalTotal),
    scope: "PRELIMINARY_KNOWN_INCOME_ONLY",
    exclusions: ["deductions", "setoff", "exemptions", "depreciation_or_tax_adjustments", "capital_gains_computation", "slab_or_rate", "tax_liability", "itr_form_inference"],
  };
  return { worksheet, inputBindings, snapshotStatus: state.status, snapshotReasons };
}

function statusFromRow(row: Record<string, unknown>, state: { status: string; currentBlockers: string[]; candidateHash: string }): { status: "CURRENT" | "STALE" | "BLOCKED"; reasons: string[] } {
  let bindings: unknown; let output: unknown;
  try { bindings = JSON.parse(String(row.input_bindings_json)); output = JSON.parse(String(row.output_json)); } catch { return { status: "BLOCKED", reasons: ["WORKSHEET_INTEGRITY_FAILURE"] }; }
  const bindingHash = hash(bindings); const outputHash = hash(output);
  if (bindingHash !== String(row.input_hash) || outputHash !== String(row.output_hash) || String(row.snapshot_candidate_hash) !== String((bindings as Record<string, unknown>).snapshotCandidateHash)) return { status: "BLOCKED", reasons: ["WORKSHEET_INTEGRITY_FAILURE"] };
  if (state.status === "BLOCKED") return { status: "BLOCKED", reasons: ["SOURCE_OR_SNAPSHOT_STALE", ...state.currentBlockers] };
  if (state.status === "STALE" || state.candidateHash !== String(row.snapshot_candidate_hash)) return { status: "STALE", reasons: ["SOURCE_OR_SNAPSHOT_STALE"] };
  return { status: "CURRENT", reasons: [] };
}

async function rowView(session: BusinessSession, tenantId: string, taxCaseId: string, worksheetId: string): Promise<TaxPositionWorksheetView> {
  const row = await session.querySingle("SELECT * FROM personal_tax_position_worksheets WHERE id = ? AND tenant_id = ? AND tax_case_id = ?", [worksheetId, tenantId, taxCaseId]);
  if (!row) throw new DomainError("TAX_POSITION_WORKSHEET_NOT_FOUND", "Position worksheet does not belong to tenant and TaxCase");
  let worksheet: TaxPositionWorksheet; let inputBindings: Record<string, unknown>;
  try { worksheet = JSON.parse(String(row.output_json)) as TaxPositionWorksheet; inputBindings = JSON.parse(String(row.input_bindings_json)) as Record<string, unknown>; } catch { throw new DomainError("TAX_POSITION_WORKSHEET_INTEGRITY_FAILURE", "Position worksheet JSON is malformed"); }
  const state = await filingSnapshotStateInSession(session, tenantId, taxCaseId, String(row.filing_snapshot_id));
  const status = statusFromRow(row, state);
  return { ...worksheet, worksheetId: String(row.id), status: status.status, inputHash: String(row.input_hash), canonicalOutputHash: String(row.output_hash), inputBindings, createdAt: String(row.created_at), createdByActorId: String(row.created_by_actor_id), statusReasons: status.reasons };
}

export async function previewTaxCasePositionWorksheet(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string, filingSnapshotId: string): Promise<TaxPositionWorksheet> {
  return sessionRunner.withBusinessSession("read", async (session) => (await deriveWorksheet(session, text(tenantId, "tenantId"), text(taxCaseId, "taxCaseId"), text(filingSnapshotId, "filingSnapshotId"))).worksheet);
}

export async function showTaxCasePositionWorksheet(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string, worksheetId: string): Promise<TaxPositionWorksheetView> {
  return sessionRunner.withBusinessSession("read", async (session) => rowView(session, text(tenantId, "tenantId"), text(taxCaseId, "taxCaseId"), text(worksheetId, "worksheetId")));
}

export async function statusTaxCasePositionWorksheet(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string, worksheetId: string): Promise<Record<string, unknown>> {
  const view = await showTaxCasePositionWorksheet(sessionRunner, tenantId, taxCaseId, worksheetId);
  return { worksheetId: view.worksheetId, tenantId: view.tenantId, taxCaseId: view.taxCaseId, filingSnapshotId: view.filingSnapshotId, status: view.status, statusReasons: view.statusReasons, canonicalOutputHash: view.canonicalOutputHash };
}

export async function generateTaxCasePositionWorksheet(sessionRunner: BusinessSessionRunner, envelope: PositionEnvelope): Promise<CommandResult<Record<string, unknown>>> {
  validateCommandEnvelope(envelope); const payload = normalizePayload(envelope.payload); const requestHash = computeCommandHash(COMMAND, envelope, payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope.tenantId, envelope.requestId, requestHash); if (prior) { const decoded = JSON.parse(prior.resultJson) as { worksheetId?: string }; await auditGenerate(session, envelope, String(decoded.worksheetId ?? "unknown"), prior.resultHash, true); return prior; }
    const derived = await deriveWorksheet(session, envelope.tenantId, payload.taxCaseId, payload.filingSnapshotId); const inputHash = hash(derived.inputBindings); const outputJson = canonicalJson(derived.worksheet); const outputHash = computeResultHash(outputJson);
    const existing = await session.querySingle("SELECT id FROM personal_tax_position_worksheets WHERE tenant_id = ? AND tax_case_id = ? AND filing_snapshot_id = ? AND input_hash = ?", [envelope.tenantId, payload.taxCaseId, payload.filingSnapshotId, inputHash]);
    const worksheetId = existing ? String(existing.id) : randomUUID(); const now = new Date().toISOString();
    if (!existing) await session.execute("INSERT INTO personal_tax_position_worksheets (id, tenant_id, tax_case_id, filing_snapshot_id, snapshot_candidate_hash, input_bindings_json, input_hash, output_json, output_hash, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [worksheetId, envelope.tenantId, payload.taxCaseId, payload.filingSnapshotId, derived.worksheet.snapshotCandidateHash, canonicalJson(derived.inputBindings), inputHash, outputJson, outputHash, now, envelope.actor.id]);
    const result = { worksheetId, tenantId: envelope.tenantId, taxCaseId: payload.taxCaseId, filingSnapshotId: payload.filingSnapshotId, status: "CURRENT", inputHash, canonicalOutputHash: outputHash, replayedExisting: Boolean(existing) };
    const resultJson = canonicalJson(result); const resultHash = computeResultHash(resultJson);
    await auditGenerate(session, envelope, worksheetId, resultHash, Boolean(existing));
    await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]);
    return { resultJson, resultHash };
  });
}
