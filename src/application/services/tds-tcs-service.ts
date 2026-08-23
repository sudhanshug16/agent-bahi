import { createHash, randomUUID } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { brandAccountId, DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { postJournalInSession, type JournalLinePayload } from "./journal-command-service.ts";

export type TaxKind = "TDS" | "TCS";
export type VerificationStatus = "UNVERIFIED" | "VERIFIED" | "REJECTED";
export type EventTiming = "CREDIT" | "PAYMENT";

export interface DeductorProfilePayload {
  pan?: string;
  tan?: string;
  verificationStatus?: VerificationStatus;
  evidenceReference?: string;
  tanExceptionFact?: string;
  tanExceptionReason?: string;
  effectiveFrom: string;
  effectiveTo?: string;
}
export interface PartyTaxProfilePayload {
  partyId: string;
  residency: "RESIDENT" | "NON_RESIDENT";
  pan?: string;
  verificationStatus?: VerificationStatus;
  evidenceReference?: string;
  effectiveFrom: string;
  effectiveTo?: string;
}
export interface TaxRuleSnapshotPayload {
  taxKind: TaxKind;
  sourceUrl: string;
  sourceDocument: string;
  sourceVersion: string;
  sectionReference: string;
  tableReference?: string;
  categoryCode: string;
  effectiveFrom: string;
  effectiveTo?: string;
  eventTiming: EventTiming;
  rateBps: number;
  thresholdMinor?: number;
  applicabilityFacts: Record<string, unknown>;
  tanRequired: boolean;
  tanExceptionAllowed: boolean;
  statementRoute: string;
  statementForm: string;
  certificateForm?: string;
  roundingMode: "HALF_UP";
  sourceVerified: boolean;
}
export interface WithholdingBlock {
  taxKind: TaxKind;
  ruleSnapshotId: string;
  taxBaseMinor: number;
  thresholdApplicabilityEvidenceReferences: string[];
  liabilityAccountId: string;
  calculationFacts: Record<string, unknown>;
}
export interface WithholdingPlan {
  taxKind: TaxKind;
  ruleSnapshotId: string;
  eventDate: string;
  taxBaseMinor: number;
  taxAmountMinor: number;
  rateBps: number;
  roundingMode: "HALF_UP";
  liabilityAccountId: string;
  thresholdEvidence: string[];
  calculationFacts: Record<string, unknown>;
  ruleCanonicalHash: string;
}
export interface WithholdingEventRow {
  eventId: string;
  tenantId: string;
  bookSetId: string;
  taxKind: TaxKind;
  documentType: "PURCHASE" | "SALE";
  documentId: string;
  eventDate: string;
  taxBaseMinor: number;
  taxAmountMinor: number;
  depositedMinor: number;
  outstandingMinor: number;
  status: string;
}
export interface WithholdingDepositPayload {
  taxKind: TaxKind;
  liabilityAccountId: string;
  bankAccountId: string;
  depositDate: string;
  amountMinor: number;
  allocations: Array<{ eventId: string; amountMinor: number }>;
  cin?: string;
  bsrCode?: string;
  challanDate?: string;
  serialNumber?: string;
  evidenceReference?: string;
}
export interface WithholdingDepositResult { depositId: string; journalId: string; amountMinor: number; allocatedMinor: number; status: "POSTED"; }

type ScopedEnvelope<P> = CommandEnvelope<P> & { bookSetId: BookSetId };
type TenantEnvelope<P> = CommandEnvelope<P>;

function isoDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date (YYYY-MM-DD)`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date (YYYY-MM-DD)`);
}
function text(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new DomainError("INVALID_FIELD", `${field} must be nonblank and bounded`);
  return value.trim();
}
function positiveMinor(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new DomainError("INVALID_AMOUNT", `${field} must be a positive safe integer minor amount`);
  return value;
}
function optionalMinor(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new DomainError("INVALID_AMOUNT", `${field} must be a non-negative safe integer minor amount`);
  return value;
}
function interval(from: string, to: string | undefined): void {
  isoDate(from, "effectiveFrom");
  if (to !== undefined) { isoDate(to, "effectiveTo"); if (to < from) throw new DomainError("INVALID_DATE_RANGE", "effectiveTo must not precede effectiveFrom"); }
}
function pan(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = text(value, field, 10).toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalized)) throw new DomainError("INVALID_PAN", `${field} has invalid syntax (masked identifier: ${maskIdentifier(normalized)})`);
  return normalized;
}
function tan(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = text(value, "tan", 10).toUpperCase();
  if (!/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(normalized)) throw new DomainError("INVALID_TAN", `tan has invalid syntax (masked identifier: ${maskIdentifier(normalized)})`);
  return normalized;
}
export function maskIdentifier(value: string): string { return value.length <= 4 ? "****" : `****${value.slice(-4)}`; }
function assertStatus(value: unknown): VerificationStatus {
  if (!(["UNVERIFIED", "VERIFIED", "REJECTED"] as string[]).includes(String(value))) throw new DomainError("INVALID_VERIFICATION_STATUS", "verificationStatus must be UNVERIFIED, VERIFIED, or REJECTED");
  return value as VerificationStatus;
}
function assertEnvelope<P>(envelope: CommandEnvelope<P>, bookSetId?: string): void {
  if (envelope.schemaVersion !== 1 || typeof envelope.tenantId !== "string" || typeof envelope.requestId !== "string" || typeof envelope.reason !== "string" || envelope.reason.trim() === "") throw new DomainError("INVALID_COMMAND_ENVELOPE", "command envelope is invalid");
  if (bookSetId !== undefined && bookSetId.length === 0) throw new DomainError("INVALID_BOOK_SET_ID", "bookSetId is required");
}
function canonicalFacts(value: Record<string, unknown>): { json: string; hash: string } {
  const json = canonicalJson(value);
  return { json, hash: createHash("sha256").update(json).digest("hex") };
}
async function idempotency(session: BusinessSession, tenantId: string, requestId: string): Promise<{ requestHash: string; resultJson: string; resultHash: string } | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  return row ? { requestHash: String(row.request_hash), resultJson: String(row.result_json), resultHash: String(row.result_hash) } : undefined;
}
async function replay<T>(session: BusinessSession, envelope: CommandEnvelope<unknown>, hash: string): Promise<CommandResult<T> | undefined> {
  const row = await idempotency(session, envelope.tenantId, envelope.requestId);
  if (!row) return undefined;
  if (row.requestHash !== hash) throw new IdempotencyConflictError("same request_id with different request hash");
  if (computeResultHash(row.resultJson) !== row.resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson: row.resultJson, resultHash: row.resultHash, replayed: true };
}
async function finish<T>(session: BusinessSession, envelope: CommandEnvelope<unknown> & { bookSetId?: string }, command: string, hash: string, result: T, entityType: string, entityId: string, now: string): Promise<CommandResult<T>> {
  const json = canonicalJson(result); const resultHash = computeResultHash(json);
  await session.execute(`INSERT INTO audit_records (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id, canonical_before_hash, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`, [randomUUID(), envelope.tenantId, envelope.bookSetId ?? null, command, command, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, resultHash, JSON.stringify({ entityType, entityId }), now, now]);
  await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, hash, json, resultHash, now]);
  return { resultJson: json, resultHash };
}
async function assertBookSet(session: BusinessSession, tenantId: string, bookSetId: string): Promise<void> {
  const row = await session.querySingle("SELECT id, lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?", [bookSetId, tenantId]);
  if (!row) throw new DomainError("BOOK_SET_NOT_FOUND", "BookSet does not belong to tenant");
  if (String(row.lifecycle) !== "ACTIVE") throw new DomainError("BOOK_SET_INACTIVE", "BookSet must be ACTIVE");
}
async function assertAccount(session: BusinessSession, tenantId: string, bookSetId: string, accountId: string, type: "ASSET" | "LIABILITY"): Promise<void> {
  const row = await session.querySingle("SELECT id, account_type, archived_at FROM accounts WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [accountId, tenantId, bookSetId]);
  if (!row || String(row.account_type) !== type || row.archived_at !== null && row.archived_at !== undefined) throw new DomainError("ACCOUNT_SCOPE_MISMATCH", "tax account does not belong to the requested scope or class");
}
function safeSourceUrl(value: string): string {
  const url = text(value, "sourceUrl", 2048);
  if (!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(url)) throw new DomainError("INVALID_TAX_SOURCE", "sourceUrl must be a safe HTTPS URL");
  return url;
}
function assertEvidence(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "" || item.length > 512)) throw new DomainError("TAX_EVIDENCE_REQUIRED", `${field} must contain bounded evidence references`);
  return [...new Set(value.map((item) => (item as string).trim()))].sort();
}
function amountFromRate(base: number, rateBps: number, roundingMode: string): number {
  if (roundingMode !== "HALF_UP") throw new DomainError("TAX_ROUNDING_UNSUPPORTED", "only the snapshotted HALF_UP rounding mode is supported");
  const amount = (BigInt(base) * BigInt(rateBps) + 5000n) / 10000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError("INVALID_AMOUNT", "tax amount exceeds safe integer range");
  return Number(amount);
}
function applicable(row: Record<string, unknown>, date: string): boolean {
  return String(row.effective_from) <= date && (row.effective_to === null || row.effective_to === undefined || String(row.effective_to) >= date);
}
export function resolveEffectiveProfileRows(rows: readonly Record<string, unknown>[], date: string): Record<string, unknown> {
  isoDate(date, "date");
  const matches = rows.filter((row) => applicable(row, date));
  if (matches.length !== 1) throw new DomainError(matches.length === 0 ? "TAX_PROFILE_NOT_EFFECTIVE" : "TAX_PROFILE_AMBIGUOUS", "exactly one effective tax profile is required");
  return matches[0]!;
}

export async function executeDeductorProfileCreate(runner: BusinessSessionRunner, envelope: TenantEnvelope<DeductorProfilePayload>): Promise<CommandResult<unknown>> {
  assertEnvelope(envelope);
  const normalizedPan = pan(envelope.payload.pan, "pan"); const normalizedTan = tan(envelope.payload.tan); interval(envelope.payload.effectiveFrom, envelope.payload.effectiveTo);
  const status = assertStatus(envelope.payload.verificationStatus ?? "UNVERIFIED");
  if (status !== "UNVERIFIED" && !envelope.payload.evidenceReference) throw new DomainError("TAX_EVIDENCE_REQUIRED", "verified or rejected profiles require evidenceReference");
  if ((envelope.payload.tanExceptionFact === undefined) !== (envelope.payload.tanExceptionReason === undefined)) throw new DomainError("TAN_EXCEPTION_INCOMPLETE", "tanExceptionFact and tanExceptionReason must be supplied together");
  const requestHash = computeCommandHash("tax.deductor-profile.create", envelope, { ...envelope.payload, pan: normalizedPan, tan: normalizedTan, verificationStatus: status });
  return runner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope, requestHash); if (prior) return prior;
    const tenant = await session.querySingle("SELECT id FROM tenants WHERE id = ? AND lifecycle <> 'ARCHIVED'", [envelope.tenantId]); if (!tenant) throw new DomainError("TENANT_NOT_FOUND", "tenant does not exist or is ARCHIVED");
    const id = randomUUID(); const now = new Date().toISOString();
    await session.execute("INSERT INTO tenant_deductor_profiles (id, tenant_id, pan, tan, verification_status, evidence_reference, tan_exception_fact, tan_exception_reason, effective_from, effective_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, envelope.tenantId, normalizedPan ?? null, normalizedTan ?? null, status, envelope.payload.evidenceReference ?? null, envelope.payload.tanExceptionFact ?? null, envelope.payload.tanExceptionReason ?? null, envelope.payload.effectiveFrom, envelope.payload.effectiveTo ?? null, now, now]);
    return finish(session, envelope, "tax.deductor-profile.create", requestHash, { profileId: id, tenantId: envelope.tenantId, pan: normalizedPan ? maskIdentifier(normalizedPan) : undefined, tan: normalizedTan ? maskIdentifier(normalizedTan) : undefined, verificationStatus: status }, "tenant_deductor_profile", id, now);
  });
}

export async function executePartyTaxProfileCreate(runner: BusinessSessionRunner, envelope: ScopedEnvelope<PartyTaxProfilePayload>): Promise<CommandResult<unknown>> {
  assertEnvelope(envelope, envelope.bookSetId); const partyId = text(envelope.payload.partyId, "partyId"); const normalizedPan = pan(envelope.payload.pan, "pan"); interval(envelope.payload.effectiveFrom, envelope.payload.effectiveTo); const status = assertStatus(envelope.payload.verificationStatus ?? "UNVERIFIED");
  if (status !== "UNVERIFIED" && !envelope.payload.evidenceReference) throw new DomainError("TAX_EVIDENCE_REQUIRED", "verified or rejected profiles require evidenceReference");
  if (!(envelope.payload.residency === "RESIDENT" || envelope.payload.residency === "NON_RESIDENT")) throw new DomainError("INVALID_RESIDENCY", "residency must be RESIDENT or NON_RESIDENT");
  const requestHash = computeCommandHash("tax.party-profile.create", envelope, { ...envelope.payload, pan: normalizedPan, verificationStatus: status });
  return runner.withBusinessSession("write", async (session) => { const prior = await replay(session, envelope, requestHash); if (prior) return prior; await assertBookSet(session, envelope.tenantId, envelope.bookSetId); const party = await session.querySingle("SELECT id FROM parties WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [partyId, envelope.tenantId, envelope.bookSetId]); if (!party) throw new DomainError("PARTY_SCOPE_MISMATCH", "party does not belong to tenant and BookSet"); const id = randomUUID(); const now = new Date().toISOString(); await session.execute("INSERT INTO party_tax_profiles (id, tenant_id, book_set_id, party_id, residency, pan, verification_status, evidence_reference, effective_from, effective_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, envelope.tenantId, envelope.bookSetId, partyId, envelope.payload.residency, normalizedPan ?? null, status, envelope.payload.evidenceReference ?? null, envelope.payload.effectiveFrom, envelope.payload.effectiveTo ?? null, now, now]); return finish(session, envelope, "tax.party-profile.create", requestHash, { profileId: id, partyId, pan: normalizedPan ? maskIdentifier(normalizedPan) : undefined, verificationStatus: status }, "party_tax_profile", id, now); });
}

export async function executeTaxRuleSnapshotCreate(runner: BusinessSessionRunner, envelope: TenantEnvelope<TaxRuleSnapshotPayload>): Promise<CommandResult<unknown>> {
  assertEnvelope(envelope); const p = envelope.payload; if (!(p.taxKind === "TDS" || p.taxKind === "TCS")) throw new DomainError("INVALID_TAX_KIND", "taxKind must be TDS or TCS"); if (!(p.eventTiming === "CREDIT" || p.eventTiming === "PAYMENT")) throw new DomainError("INVALID_EVENT_TIMING", "eventTiming must be CREDIT or PAYMENT"); const sourceUrl = safeSourceUrl(p.sourceUrl); interval(p.effectiveFrom, p.effectiveTo); const rateBps = optionalMinor(p.rateBps, "rateBps"); if (rateBps === undefined || rateBps > 10000) throw new DomainError("INVALID_TAX_RATE", "rateBps must be between 0 and 10000"); const thresholdMinor = optionalMinor(p.thresholdMinor, "thresholdMinor"); const facts = canonicalFacts(p.applicabilityFacts); const sourceDocument = text(p.sourceDocument, "sourceDocument", 256); const sourceVersion = text(p.sourceVersion, "sourceVersion", 128); const sectionReference = text(p.sectionReference, "sectionReference", 128); const categoryCode = text(p.categoryCode, "categoryCode", 128); const statementRoute = text(p.statementRoute, "statementRoute", 128); const statementForm = text(p.statementForm, "statementForm", 128); const certificateForm = p.certificateForm === undefined ? undefined : text(p.certificateForm, "certificateForm", 128);
  const requestHash = computeCommandHash("tax.rule-snapshot.create", envelope, { ...p, sourceUrl, sourceDocument, sourceVersion, sectionReference, categoryCode, statementRoute, statementForm, certificateForm, rateBps, thresholdMinor, canonicalFactsHash: facts.hash });
  return runner.withBusinessSession("write", async (session) => { const prior = await replay(session, envelope, requestHash); if (prior) return prior; const tenant = await session.querySingle("SELECT id FROM tenants WHERE id = ? AND lifecycle <> 'ARCHIVED'", [envelope.tenantId]); if (!tenant) throw new DomainError("TENANT_NOT_FOUND", "tenant does not exist or is ARCHIVED"); const id = randomUUID(); const now = new Date().toISOString(); await session.execute("INSERT INTO tax_rule_snapshots (id, tenant_id, tax_kind, source_url, source_document, source_version, section_reference, table_reference, category_code, effective_from, effective_to, event_timing, rate_bps, threshold_minor, applicability_facts_json, tan_required, tan_exception_allowed, statement_route, statement_form, certificate_form, rounding_mode, source_verified, canonical_facts_json, canonical_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, envelope.tenantId, p.taxKind, sourceUrl, sourceDocument, sourceVersion, sectionReference, p.tableReference ?? null, categoryCode, p.effectiveFrom, p.effectiveTo ?? null, p.eventTiming, rateBps, thresholdMinor ?? null, facts.json, p.tanRequired ? 1 : 0, p.tanExceptionAllowed ? 1 : 0, statementRoute, statementForm, certificateForm ?? null, p.roundingMode, p.sourceVerified ? 1 : 0, facts.json, facts.hash, now]); return finish(session, envelope, "tax.rule-snapshot.create", requestHash, { ruleSnapshotId: id, taxKind: p.taxKind, sourceVerified: p.sourceVerified, canonicalHash: facts.hash }, "tax_rule_snapshot", id, now); });
}

export async function prepareWithholding(session: BusinessSession, args: { tenantId: TenantId; bookSetId: BookSetId; documentType: "PURCHASE" | "SALE"; documentId: string; eventDate: string; block: WithholdingBlock; documentBaseMinor: number }): Promise<WithholdingPlan> {
  isoDate(args.eventDate, "eventDate"); const block = args.block; if (!(block.taxKind === "TDS" || block.taxKind === "TCS")) throw new DomainError("INVALID_TAX_KIND", "taxKind must be TDS or TCS"); if (block.taxKind === "TDS" && args.documentType !== "PURCHASE" || block.taxKind === "TCS" && args.documentType !== "SALE") throw new DomainError("TAX_DOCUMENT_MISMATCH", "TDS applies only to purchase bills and TCS only to sales invoices"); if (!Number.isSafeInteger(block.taxBaseMinor) || block.taxBaseMinor <= 0 || block.taxBaseMinor !== args.documentBaseMinor) throw new DomainError("TAX_BASE_MISMATCH", "taxBaseMinor must exactly match the document taxable base"); const evidence = assertEvidence(block.thresholdApplicabilityEvidenceReferences, "thresholdApplicabilityEvidenceReferences"); const facts = canonicalFacts(block.calculationFacts);
  const row = await session.querySingle("SELECT id, tenant_id, tax_kind, source_url, source_verified, effective_from, effective_to, event_timing, rate_bps, threshold_minor, rounding_mode, canonical_facts_json, canonical_hash FROM tax_rule_snapshots WHERE id = ? AND tenant_id = ?", [block.ruleSnapshotId, args.tenantId]);
  if (!row) throw new DomainError("TAX_RULE_MISSING", "tax rule snapshot is missing for this tenant"); if (String(row.source_verified) !== "1" && row.source_verified !== 1 && row.source_verified !== true) throw new DomainError("TAX_RULE_UNVERIFIED", "tax rule snapshot is not source verified"); if (!applicable(row, args.eventDate)) throw new DomainError("TAX_RULE_NOT_EFFECTIVE", "tax rule snapshot is not effective on the document event date"); if (String(row.event_timing) !== "CREDIT") throw new DomainError("TAX_RULE_EVENT_UNSUPPORTED", "payment-only tax rule snapshots cannot be used by document posting"); if (String(row.tax_kind) !== block.taxKind) throw new DomainError("TAX_RULE_KIND_MISMATCH", "tax rule kind does not match the withholding block"); if (typeof block.calculationFacts !== "object" || block.calculationFacts === null || Array.isArray(block.calculationFacts)) throw new DomainError("TAX_CALCULATION_FACTS_REQUIRED", "calculationFacts must be an explicit object"); if (block.calculationFacts.rateBps !== undefined && block.calculationFacts.rateBps !== Number(row.rate_bps)) throw new DomainError("TAX_RATE_MISMATCH", "calculation rate does not match the immutable rule snapshot"); if (block.calculationFacts.roundingMode !== undefined && block.calculationFacts.roundingMode !== String(row.rounding_mode)) throw new DomainError("TAX_ROUNDING_MISMATCH", "calculation rounding does not match the immutable rule snapshot"); await assertAccount(session, args.tenantId, args.bookSetId, block.liabilityAccountId, "LIABILITY"); const amount = amountFromRate(block.taxBaseMinor, Number(row.rate_bps), String(row.rounding_mode)); return { taxKind: block.taxKind, ruleSnapshotId: block.ruleSnapshotId, eventDate: args.eventDate, taxBaseMinor: block.taxBaseMinor, taxAmountMinor: amount, rateBps: Number(row.rate_bps), roundingMode: String(row.rounding_mode) as "HALF_UP", liabilityAccountId: block.liabilityAccountId, thresholdEvidence: evidence, calculationFacts: block.calculationFacts, ruleCanonicalHash: String(row.canonical_hash) };
}
export async function persistWithholdingEvent(session: BusinessSession, args: { tenantId: TenantId; bookSetId: BookSetId; documentType: "PURCHASE" | "SALE"; documentId: string; plan: WithholdingPlan; journalId: string; now: string }): Promise<string> {
  const id = randomUUID(); await session.execute("INSERT INTO withholding_events (id, tenant_id, book_set_id, tax_kind, document_type, document_id, rule_snapshot_id, event_date, tax_base_minor, tax_amount_minor, rate_bps, rounding_mode, liability_account_id, threshold_evidence_json, calculation_facts_json, rule_canonical_hash, journal_id, status, reversal_of_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', NULL, ?)", [id, args.tenantId, args.bookSetId, args.plan.taxKind, args.documentType, args.documentId, args.plan.ruleSnapshotId, args.plan.eventDate, args.plan.taxBaseMinor, args.plan.taxAmountMinor, args.plan.rateBps, args.plan.roundingMode, args.plan.liabilityAccountId, JSON.stringify(args.plan.thresholdEvidence), canonicalJson(args.plan.calculationFacts), args.plan.ruleCanonicalHash, args.journalId, args.now]); return id;
}

export async function executeWithholdingDeposit(runner: BusinessSessionRunner, envelope: ScopedEnvelope<WithholdingDepositPayload>): Promise<CommandResult<WithholdingDepositResult>> {
  assertEnvelope(envelope, envelope.bookSetId);
  const p = envelope.payload;
  if (!(p.taxKind === "TDS" || p.taxKind === "TCS")) throw new DomainError("INVALID_TAX_KIND", "taxKind must be TDS or TCS");
  isoDate(p.depositDate, "depositDate");
  const amount = positiveMinor(p.amountMinor, "amountMinor");
  if (!Array.isArray(p.allocations) || p.allocations.length === 0) throw new DomainError("TAX_ALLOCATIONS_REQUIRED", "at least one liability allocation is required");
  const seen = new Set<string>(); let allocated = 0;
  for (const [index, allocation] of p.allocations.entries()) {
    const eventId = text(allocation?.eventId, `allocations[${index}].eventId`);
    if (seen.has(eventId)) throw new DomainError("DUPLICATE_ALLOCATION", "an event may appear only once per deposit");
    seen.add(eventId); allocated += positiveMinor(allocation?.amountMinor, `allocations[${index}].amountMinor`);
  }
  if (allocated > amount) throw new DomainError("OVER_ALLOCATION", "allocations exceed deposit amount");
  const requestHash = computeCommandHash("tax.deposit", envelope, envelope.payload);
  return runner.withBusinessSession("write", async (session) => {
    const prior = await replay<WithholdingDepositResult>(session, envelope, requestHash); if (prior) return prior;
    await assertBookSet(session, envelope.tenantId, envelope.bookSetId); await assertAccount(session, envelope.tenantId, envelope.bookSetId, p.liabilityAccountId, "LIABILITY"); await assertAccount(session, envelope.tenantId, envelope.bookSetId, p.bankAccountId, "ASSET");
    for (const allocation of p.allocations) {
      const event = await session.querySingle("SELECT id, tax_kind, liability_account_id, tax_amount_minor, status FROM withholding_events WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [allocation.eventId, envelope.tenantId, envelope.bookSetId]);
      if (!event) throw new DomainError("TAX_EVENT_SCOPE_MISMATCH", "withholding event does not belong to tenant and BookSet");
      if (String(event.tax_kind) !== p.taxKind || String(event.liability_account_id) !== p.liabilityAccountId || String(event.status) !== "POSTED") throw new DomainError("TAX_EVENT_MISMATCH", "allocation event does not match deposit liability scope");
      const priorRows = await session.query("SELECT amount_minor FROM withholding_deposit_allocations WHERE tenant_id = ? AND book_set_id = ? AND event_id = ?", [envelope.tenantId, envelope.bookSetId, allocation.eventId]);
      const used = priorRows.rows.reduce((sum, row) => sum + Number(row.amount_minor), 0); const allocationAmount = positiveMinor(allocation.amountMinor, "allocation amount");
      if (used + allocationAmount > Number(event.tax_amount_minor)) throw new DomainError("OVER_ALLOCATION", "allocation exceeds event liability");
    }
    const journalId = await postJournalInSession(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, postingDate: p.depositDate, reference: p.cin, narration: `${p.taxKind} deposit`, lines: [{ accountId: brandAccountId(p.liabilityAccountId), debitMinor: amount, description: `Deposit ${p.taxKind}` }, { accountId: brandAccountId(p.bankAccountId), creditMinor: amount, description: p.cin }] });
    const id = randomUUID(); const now = new Date().toISOString();
    await session.execute("INSERT INTO withholding_deposits (id, tenant_id, book_set_id, tax_kind, liability_account_id, bank_account_id, deposit_date, amount_minor, cin, bsr_code, challan_date, serial_number, evidence_reference, journal_id, reversal_of_deposit_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)", [id, envelope.tenantId, envelope.bookSetId, p.taxKind, p.liabilityAccountId, p.bankAccountId, p.depositDate, amount, p.cin ?? null, p.bsrCode ?? null, p.challanDate ?? null, p.serialNumber ?? null, p.evidenceReference ?? null, journalId, now]);
    for (const allocation of p.allocations) await session.execute("INSERT INTO withholding_deposit_allocations (id, tenant_id, book_set_id, deposit_id, event_id, amount_minor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, id, allocation.eventId, allocation.amountMinor, now]);
    return finish(session, envelope, "tax.deposit", requestHash, { depositId: id, journalId, amountMinor: amount, allocatedMinor: allocated, status: "POSTED" }, "withholding_deposit", id, now);
  });
}

async function executeWithholdingDepositLegacy(runner: BusinessSessionRunner, envelope: ScopedEnvelope<WithholdingDepositPayload>): Promise<CommandResult<WithholdingDepositResult>> {
  assertEnvelope(envelope, envelope.bookSetId); const p = envelope.payload; if (!(p.taxKind === "TDS" || p.taxKind === "TCS")) throw new DomainError("INVALID_TAX_KIND", "taxKind must be TDS or TCS"); isoDate(p.depositDate, "depositDate"); const amount = positiveMinor(p.amountMinor, "amountMinor"); if (!Array.isArray(p.allocations) || p.allocations.length === 0) throw new DomainError("TAX_ALLOCATIONS_REQUIRED", "at least one liability allocation is required"); const seen = new Set<string>(); let allocated = 0; for (const [i, a] of p.allocations.entries()) { const eventId = text(a?.eventId, `allocations[${i}].eventId`); if (seen.has(eventId)) throw new DomainError("DUPLICATE_ALLOCATION", "an event may appear only once per deposit"); seen.add(eventId); allocated += positiveMinor(a?.amountMinor, `allocations[${i}].amountMinor`); if (!Number.isSafeInteger(allocated)) throw new DomainError("INVALID_AMOUNT", "allocation total exceeds safe integer range"); } if (allocated > amount) throw new DomainError("OVER_ALLOCATION", "allocations exceed deposit amount"); const requestHash = computeCommandHash("tax.deposit", envelope, envelope.payload);
  return runner.withBusinessSession("write", async (session) => { const prior = await replay<WithholdingDepositResult>(session, envelope, requestHash); if (prior) return prior; await assertBookSet(session, envelope.tenantId, envelope.bookSetId); await assertAccount(session, envelope.tenantId, envelope.bookSetId, p.liabilityAccountId, "LIABILITY"); await assertAccount(session, envelope.tenantId, envelope.bookSetId, p.bankAccountId, "ASSET"); const lines: JournalLinePayload[] = [{ accountId: brandAccountId(p.liabilityAccountId), debitMinor: amount, description: `Deposit ${p.taxKind}` }, { accountId: brandAccountId(p.bankAccountId), creditMinor: amount, description: p.cin }]; for (const a of p.allocations) { const event = await session.querySingle("SELECT id, tax_kind, liability_account_id, tax_amount_minor, status FROM withholding_events WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [a.eventId, envelope.tenantId, envelope.bookSetId]); if (!event) throw new DomainError("TAX_EVENT_SCOPE_MISMATCH", "withholding event does not belong to tenant and BookSet"); if (String(event.tax_kind) !== p.taxKind || String(event.liability_account_id) !== p.liabilityAccountId || String(event.status) !== "POSTED") throw new DomainError("TAX_EVENT_MISMATCH", "allocation event does not match deposit liability scope"); const priorAllocated = await session.querySingle("SELECT COALESCE(SUM(amount_minor), 0) AS amount FROM withholding_deposit_allocations WHERE tenant_id = ? AND book_set_id = ? AND event_id = ?", [envelope.tenantId, envelope.bookSetId, a.eventId]); const used = Number(priorAllocated?.amount ?? 0); const allocationAmount = positiveMinor(a.amountMinor, "allocation amount"); if (used + allocationAmount > Number(event.tax_amount_minor)) throw new DomainError("OVER_ALLOCATION", "allocation exceeds event liability"); }
    const journalId = await postJournalInSession(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, postingDate: p.depositDate, reference: p.cin, narration: `${p.taxKind} deposit`, lines }); const id = randomUUID(); const now = new Date().toISOString(); await session.execute("INSERT INTO withholding_deposits (id, tenant_id, book_set_id, tax_kind, liability_account_id, bank_account_id, deposit_date, amount_minor, cin, bsr_code, challan_date, serial_number, evidence_reference, journal_id, reversal_of_deposit_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)", [id, envelope.tenantId, envelope.bookSetId, p.taxKind, p.liabilityAccountId, p.bankAccountId, p.depositDate, amount, p.cin ?? null, p.bsrCode ?? null, p.challanDate ?? null, p.serialNumber ?? null, p.evidenceReference ?? null, journalId, now]); for (const a of p.allocations) await session.execute("INSERT INTO withholding_deposit_allocations (id, tenant_id, book_set_id, deposit_id, event_id, amount_minor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, id, a.eventId, a.amountMinor, now]); return finish(session, envelope, "tax.deposit", requestHash, { depositId: id, journalId, amountMinor: amount, allocatedMinor: allocated, status: "POSTED" }, "withholding_deposit", id, now); });
}

export async function listWithholdingRegister(runner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, taxKind: TaxKind): Promise<WithholdingEventRow[]> {
  return runner.withBusinessSession("read", async (session) => {
    const events = await session.query("SELECT id, tenant_id, book_set_id, tax_kind, document_type, document_id, event_date, tax_base_minor, tax_amount_minor, status FROM withholding_events WHERE tenant_id = ? AND book_set_id = ? AND tax_kind = ? ORDER BY event_date, id", [tenantId, bookSetId, taxKind]);
    const result: WithholdingEventRow[] = [];
    for (const row of events.rows) {
      const allocations = await session.query("SELECT amount_minor FROM withholding_deposit_allocations WHERE tenant_id = ? AND book_set_id = ? AND event_id = ?", [tenantId, bookSetId, String(row.id)]);
      const depositedMinor = allocations.rows.reduce((sum, allocation) => sum + Number(allocation.amount_minor), 0);
      const taxAmountMinor = Number(row.tax_amount_minor);
      result.push({ eventId: String(row.id), tenantId: String(row.tenant_id), bookSetId: String(row.book_set_id), taxKind: String(row.tax_kind) as TaxKind, documentType: String(row.document_type) as "PURCHASE" | "SALE", documentId: String(row.document_id), eventDate: String(row.event_date), taxBaseMinor: Number(row.tax_base_minor), taxAmountMinor, depositedMinor, outstandingMinor: taxAmountMinor - depositedMinor, status: String(row.status) });
    }
    return result;
  });
}

export async function listDeductorProfiles(runner: BusinessSessionRunner, tenantId: TenantId, date?: string): Promise<Record<string, unknown>[]> {
  if (date) isoDate(date, "date");
  return runner.withBusinessSession("read", async (session) => {
    const rows = await session.query("SELECT id, tenant_id, pan, tan, verification_status, evidence_reference, tan_exception_fact, tan_exception_reason, effective_from, effective_to FROM tenant_deductor_profiles WHERE tenant_id = ? ORDER BY effective_from, id", [tenantId]);
    return rows.rows.filter((row) => !date || applicable(row, date)).map((row) => ({ profileId: String(row.id), tenantId: String(row.tenant_id), pan: row.pan == null ? undefined : maskIdentifier(String(row.pan)), tan: row.tan == null ? undefined : maskIdentifier(String(row.tan)), verificationStatus: String(row.verification_status), evidenceReference: row.evidence_reference == null ? undefined : String(row.evidence_reference), effectiveFrom: String(row.effective_from), effectiveTo: row.effective_to == null ? undefined : String(row.effective_to) }));
  });
}

export async function listPartyTaxProfiles(runner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, partyId: string, date?: string): Promise<Record<string, unknown>[]> {
  if (date) isoDate(date, "date");
  return runner.withBusinessSession("read", async (session) => {
    const rows = await session.query("SELECT id, tenant_id, book_set_id, party_id, residency, pan, verification_status, evidence_reference, effective_from, effective_to FROM party_tax_profiles WHERE tenant_id = ? AND book_set_id = ? AND party_id = ? ORDER BY effective_from, id", [tenantId, bookSetId, partyId]);
    return rows.rows.filter((row) => !date || applicable(row, date)).map((row) => ({ profileId: String(row.id), tenantId: String(row.tenant_id), bookSetId: String(row.book_set_id), partyId: String(row.party_id), residency: String(row.residency), pan: row.pan == null ? undefined : maskIdentifier(String(row.pan)), verificationStatus: String(row.verification_status), evidenceReference: row.evidence_reference == null ? undefined : String(row.evidence_reference), effectiveFrom: String(row.effective_from), effectiveTo: row.effective_to == null ? undefined : String(row.effective_to) }));
  });
}

async function listWithholdingRegisterLegacy(runner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, taxKind: TaxKind): Promise<WithholdingEventRow[]> {
  return runner.withBusinessSession("read", async (session) => { const rows = await session.query(`SELECT e.id, e.tenant_id, e.book_set_id, e.tax_kind, e.document_type, e.document_id, e.event_date, e.tax_base_minor, e.tax_amount_minor, e.status, SUM(a.amount_minor) AS deposited_minor FROM withholding_events e LEFT JOIN withholding_deposit_allocations a ON a.event_id = e.id AND a.tenant_id = e.tenant_id AND a.book_set_id = e.book_set_id WHERE e.tenant_id = ? AND e.book_set_id = ? AND e.tax_kind = ? GROUP BY e.id ORDER BY e.event_date, e.id`, [tenantId, bookSetId, taxKind]); return rows.rows.map((row) => { const taxAmountMinor = Number(row.tax_amount_minor); const depositedMinor = Number(row.deposited_minor ?? 0); return { eventId: String(row.id), tenantId: String(row.tenant_id), bookSetId: String(row.book_set_id), taxKind: String(row.tax_kind) as TaxKind, documentType: String(row.document_type) as "PURCHASE" | "SALE", documentId: String(row.document_id), eventDate: String(row.event_date), taxBaseMinor: Number(row.tax_base_minor), taxAmountMinor, depositedMinor, outstandingMinor: taxAmountMinor - depositedMinor, status: String(row.status) }; }); });
}
