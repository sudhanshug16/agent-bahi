import { randomUUID } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";

export const GST_V1_ROUNDING_POLICY = "ROUND_HALF_UP_COMPONENT_REMAINDER_V1" as const;
export type GstLocalComponent = "SGST" | "UTGST";
export type GstGeometry = "INTRA_STATE" | "INTER_STATE";
export type GstPartyTreatment = "REGISTERED" | "UNREGISTERED" | "CONSUMER";
export type ItcTreatment = "ELIGIBLE" | "INELIGIBLE" | "PENDING_REVIEW";

export interface GstLineFact {
  lineNumber?: number;
  classification?: string;
  hsnSac?: string;
  rateBps?: number;
  ratePercent?: number;
  evidenceIds?: string[];
}

export interface GstAccountMap {
  cgstAccountId?: string;
  sgstAccountId?: string;
  utgstAccountId?: string;
  igstAccountId?: string;
  inputCgstAccountId?: string;
  inputSgstAccountId?: string;
  inputUtgstAccountId?: string;
  inputIgstAccountId?: string;
}

/** Caller-supplied GST facts. No rate is inferred from classification. */
export interface GstDocumentBlock extends GstAccountMap {
  sellerRegistrationId?: string;
  sellerGstin?: string;
  buyerRegistrationId?: string;
  buyerGstin?: string;
  buyerProfileId?: string;
  sellerProfileId?: string;
  sellerStateCode?: string;
  buyerStateCode?: string;
  localComponent?: GstLocalComponent;
  itcTreatment?: ItcTreatment;
  evidenceIds?: string[];
  lines?: GstLineFact[];
  lineFacts?: GstLineFact[];
}

export interface GstRegistrationCreatePayload {
  gstin: string;
  state?: string;
  scheme?: string;
  status?: "ACTIVE" | "INACTIVE";
  effectiveFrom: string;
  effectiveTo?: string;
}
export interface GstRegistrationCreateResult { registrationId: string; gstin: string; status: "ACTIVE" | "INACTIVE"; }
export interface PartyGstProfileCreatePayload {
  partyId: string;
  gstin?: string;
  treatment: GstPartyTreatment;
  stateCode: string;
  localComponent?: GstLocalComponent;
  status?: "ACTIVE" | "INACTIVE";
  effectiveFrom: string;
  effectiveTo?: string;
}
export interface PartyGstProfileCreateResult { profileId: string; partyId: string; treatment: GstPartyTreatment; }
export interface GstRegistrationView { registrationId: string; tenantId: string; gstin: string; state?: string; scheme?: string; status: string; effectiveFrom: string; effectiveTo?: string; }
export interface PartyGstProfileView { profileId: string; tenantId: string; bookSetId: string; partyId: string; gstin?: string; treatment: GstPartyTreatment; stateCode: string; localComponent?: GstLocalComponent; status: string; effectiveFrom: string; effectiveTo?: string; }

type GstEnvelope<P> = CommandEnvelope<P> & { bookSetId?: BookSetId };

function nonblank(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new DomainError("INVALID_FIELD", `${field} must be nonblank and bounded`);
  return value.trim();
}
function isoDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00.000Z`).valueOf()) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date`);
}
function stateCode(value: unknown, field: string): string {
  const normalized = nonblank(value, field, 2);
  if (!/^\d{2}$/.test(normalized)) throw new DomainError("INVALID_STATE_CODE", `${field} must be a two digit GST state code`);
  return normalized;
}

/** GSTIN checksum validation from the GSTIN base-36 check digit contract. */
export function normalizeGstin(value: unknown, field = "gstin"): string {
  const gstin = nonblank(value, field, 15).toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new DomainError("INVALID_GSTIN", `${field} has an invalid GSTIN format`);
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let factor = 2;
  let sum = 0;
  for (let index = 13; index >= 0; index -= 1) {
    const product = alphabet.indexOf(gstin[index]!) * factor;
    sum += Math.floor(product / 36) + (product % 36);
    factor = factor === 2 ? 1 : 2;
  }
  const check = alphabet[(36 - (sum % 36)) % 36];
  if (check !== gstin[14]) throw new DomainError("INVALID_GSTIN", `${field} has an invalid GSTIN checksum`);
  return gstin;
}

function assertRange(from: string, to: string | undefined): void {
  isoDate(from, "effectiveFrom");
  if (to !== undefined) { isoDate(to, "effectiveTo"); if (to < from) throw new DomainError("INVALID_DATE_RANGE", "effectiveTo must not precede effectiveFrom"); }
}
function assertGstEnvelope<P>(envelope: GstEnvelope<P>): void {
  validateCommandEnvelope(envelope);
}
async function idempotency(session: BusinessSession, tenantId: TenantId, requestId: string): Promise<{ requestHash: string; resultJson: string; resultHash: string } | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  return row ? { requestHash: String(row.request_hash), resultJson: String(row.result_json), resultHash: String(row.result_hash) } : undefined;
}
async function finish<T>(session: BusinessSession, envelope: GstEnvelope<unknown>, command: string, requestHash: string, result: T, entityType: string, entityId: string, now: string): Promise<CommandResult<T>> {
  const resultJson = canonicalJson(result);
  const resultHash = computeResultHash(resultJson);
  await session.execute("INSERT INTO audit_records (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId ?? null, command, command, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, resultHash, JSON.stringify({ entityType, entityId }), now, now]);
  await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]);
  return { resultJson, resultHash };
}
async function replay<T>(session: BusinessSession, envelope: GstEnvelope<unknown>, requestHash: string): Promise<CommandResult<T> | undefined> {
  const existing = await idempotency(session, envelope.tenantId, envelope.requestId);
  if (!existing) return undefined;
  if (existing.requestHash !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
  if (computeResultHash(existing.resultJson) !== existing.resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson: existing.resultJson, resultHash: existing.resultHash, replayed: true };
}

export async function executeGstRegistrationCreate(sessionRunner: BusinessSessionRunner, envelope: GstEnvelope<GstRegistrationCreatePayload>): Promise<CommandResult<GstRegistrationCreateResult>> {
  assertGstEnvelope(envelope);
  const gstin = normalizeGstin(envelope.payload.gstin);
  const state = envelope.payload.state === undefined ? gstin.slice(0, 2) : stateCode(envelope.payload.state, "state");
  if (state !== gstin.slice(0, 2)) throw new DomainError("GSTIN_STATE_MISMATCH", "registration state must match GSTIN state code");
  assertRange(envelope.payload.effectiveFrom, envelope.payload.effectiveTo);
  const status = envelope.payload.status ?? "ACTIVE";
  const requestHash = computeCommandHash("gst.registration.create", envelope, { ...envelope.payload, gstin, state, status });
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay<GstRegistrationCreateResult>(session, envelope, requestHash); if (prior) return prior;
    const tenant = await session.querySingle("SELECT id FROM tenants WHERE id = ?", [envelope.tenantId]); if (!tenant) throw new DomainError("TENANT_NOT_FOUND", "tenant does not exist");
    const id = randomUUID(); const now = new Date().toISOString();
    await session.execute("INSERT INTO gst_registrations (id, tenant_id, gstin, state, scheme, status, effective_from, effective_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, envelope.tenantId, gstin, state, envelope.payload.scheme ?? null, status, envelope.payload.effectiveFrom, envelope.payload.effectiveTo ?? null, now, now]);
    return finish(session, envelope, "gst.registration.create", requestHash, { registrationId: id, gstin, status }, "gst_registration", id, now);
  });
}

function registrationView(row: Record<string, unknown>): GstRegistrationView { return { registrationId: String(row.id), tenantId: String(row.tenant_id), gstin: String(row.gstin), ...(row.state == null ? {} : { state: String(row.state) }), ...(row.scheme == null ? {} : { scheme: String(row.scheme) }), status: String(row.status), effectiveFrom: String(row.effective_from), ...(row.effective_to == null ? {} : { effectiveTo: String(row.effective_to) }) }; }
export async function getGstRegistration(sessionRunner: BusinessSessionRunner, tenantId: TenantId, registrationId: string): Promise<GstRegistrationView> { return sessionRunner.withBusinessSession("read", async (session) => { const row = await session.querySingle("SELECT id, tenant_id, gstin, state, scheme, status, effective_from, effective_to FROM gst_registrations WHERE id = ? AND tenant_id = ?", [registrationId, tenantId]); if (!row) throw new DomainError("GST_REGISTRATION_NOT_FOUND", "GST registration does not belong to tenant"); return registrationView(row); }); }
export async function listGstRegistrations(sessionRunner: BusinessSessionRunner, tenantId: TenantId, date?: string): Promise<GstRegistrationView[]> { if (date) isoDate(date, "date"); return sessionRunner.withBusinessSession("read", async (session) => { const sql = date ? "SELECT id, tenant_id, gstin, state, scheme, status, effective_from, effective_to FROM gst_registrations WHERE tenant_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND effective_to >= ? OR tenant_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND effective_to IS NULL ORDER BY effective_from, gstin, id" : "SELECT id, tenant_id, gstin, state, scheme, status, effective_from, effective_to FROM gst_registrations WHERE tenant_id = ? ORDER BY effective_from, gstin, id"; const params = date ? [tenantId, date, date, tenantId, date] : [tenantId]; const rows = await session.query(sql, params); return rows.rows.map(registrationView); }); }

export async function executePartyGstProfileCreate(sessionRunner: BusinessSessionRunner, envelope: GstEnvelope<PartyGstProfileCreatePayload>): Promise<CommandResult<PartyGstProfileCreateResult>> {
  assertGstEnvelope(envelope); nonblank(envelope.bookSetId, "bookSetId"); const partyId = nonblank(envelope.payload.partyId, "partyId"); const treatment = envelope.payload.treatment; if (!["REGISTERED", "UNREGISTERED", "CONSUMER"].includes(treatment)) throw new DomainError("INVALID_GST_TREATMENT", "invalid party GST treatment");
  const gstin = envelope.payload.gstin === undefined ? undefined : normalizeGstin(envelope.payload.gstin); if (treatment === "REGISTERED" && !gstin) throw new DomainError("GSTIN_REQUIRED", "registered treatment requires GSTIN"); if (treatment !== "REGISTERED" && gstin) throw new DomainError("GSTIN_NOT_ALLOWED", "unregistered or consumer treatment cannot carry GSTIN");
  const normalizedState = stateCode(envelope.payload.stateCode, "stateCode"); assertRange(envelope.payload.effectiveFrom, envelope.payload.effectiveTo); const status = envelope.payload.status ?? "ACTIVE";
  const requestHash = computeCommandHash("gst.party-profile.create", envelope, { ...envelope.payload, gstin, stateCode: normalizedState, status });
  return sessionRunner.withBusinessSession("write", async (session) => { const prior = await replay<PartyGstProfileCreateResult>(session, envelope, requestHash); if (prior) return prior; const party = await session.querySingle("SELECT id FROM parties WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [partyId, envelope.tenantId, envelope.bookSetId]); if (!party) throw new DomainError("PARTY_SCOPE_MISMATCH", "party does not belong to tenant and BookSet"); const id = randomUUID(); const now = new Date().toISOString(); await session.execute("INSERT INTO party_gst_profiles (id, tenant_id, book_set_id, party_id, gstin, treatment, state_code, local_component, status, effective_from, effective_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, envelope.tenantId, envelope.bookSetId, partyId, gstin ?? null, treatment, normalizedState, envelope.payload.localComponent ?? null, status, envelope.payload.effectiveFrom, envelope.payload.effectiveTo ?? null, now, now]); return finish(session, envelope, "gst.party-profile.create", requestHash, { profileId: id, partyId, treatment }, "party_gst_profile", id, now); });
}
function profileView(row: Record<string, unknown>): PartyGstProfileView { return { profileId: String(row.id), tenantId: String(row.tenant_id), bookSetId: String(row.book_set_id), partyId: String(row.party_id), ...(row.gstin == null ? {} : { gstin: String(row.gstin) }), treatment: String(row.treatment) as GstPartyTreatment, stateCode: String(row.state_code), ...(row.local_component == null ? {} : { localComponent: String(row.local_component) as GstLocalComponent }), status: String(row.status), effectiveFrom: String(row.effective_from), ...(row.effective_to == null ? {} : { effectiveTo: String(row.effective_to) }) }; }
export async function listPartyGstProfiles(sessionRunner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, partyId: string, date?: string): Promise<PartyGstProfileView[]> { if (date) isoDate(date, "date"); return sessionRunner.withBusinessSession("read", async (session) => { const sql = date ? "SELECT id, tenant_id, book_set_id, party_id, gstin, treatment, state_code, local_component, status, effective_from, effective_to FROM party_gst_profiles WHERE tenant_id = ? AND book_set_id = ? AND party_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND effective_to >= ? OR tenant_id = ? AND book_set_id = ? AND party_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND effective_to IS NULL ORDER BY effective_from, id" : "SELECT id, tenant_id, book_set_id, party_id, gstin, treatment, state_code, local_component, status, effective_from, effective_to FROM party_gst_profiles WHERE tenant_id = ? AND book_set_id = ? AND party_id = ? ORDER BY effective_from, id"; const params = date ? [tenantId, bookSetId, partyId, date, date, tenantId, bookSetId, partyId, date] : [tenantId, bookSetId, partyId]; const rows = await session.query(sql, params); return rows.rows.map(profileView); }); }

interface InputLine { id: string; lineNumber: number; amountMinor: number; description?: string; }
export interface GstTaxComponentPlan { line: InputLine; component: "CGST" | "SGST" | "UTGST" | "IGST"; classification: string; taxableMinor: number; rateBps: number; taxMinor: number; accountId?: string; evidenceIds: string[]; }
export interface GstPostingPlan { sellerRegistrationId: string; buyerProfileId: string; geometry: GstGeometry; taxableMinor: number; taxMinor: number; grossMinor: number; localComponent?: GstLocalComponent; itcTreatment?: ItcTreatment; riskFlags: string[]; evidenceIds: string[]; components: GstTaxComponentPlan[]; }

function safeMinor(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new DomainError("INVALID_AMOUNT", `${field} must be a positive safe integer`); return value; }
function roundHalfUp(numerator: bigint, denominator: bigint): number { const result = (numerator * 2n + denominator) / (2n * denominator); if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError("INVALID_AMOUNT", "GST amount exceeds safe integer range"); return Number(result); }
function factsFor(block: GstDocumentBlock, lines: InputLine[]): Map<number, GstLineFact> { const raw = block.lineFacts ?? block.lines ?? []; const map = new Map<number, GstLineFact>(); raw.forEach((fact, index) => { const n = fact.lineNumber ?? (lines.length === raw.length ? index + 1 : undefined); if (!n || map.has(n)) throw new DomainError("GST_LINE_FACT_REQUIRED", "each GST line fact needs a unique lineNumber"); map.set(n, fact); }); if (map.size !== lines.length) throw new DomainError("GST_LINE_FACT_REQUIRED", "GST classification, rate, and evidence are required for every line"); return map; }
function rate(fact: GstLineFact, field: string): number { const value = fact.rateBps ?? (fact.ratePercent === undefined ? undefined : fact.ratePercent * 100); if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10000) throw new DomainError("GST_RATE_REQUIRED", `${field} requires an explicit rateBps between 0 and 10000`); return value; }
function classify(fact: GstLineFact, field: string): string { return nonblank(fact.classification ?? fact.hsnSac, field, 64); }
function evidence(fact: GstLineFact, fallback: string[] | undefined): string[] { const ids = fact.evidenceIds ?? fallback ?? []; if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || id.trim().length === 0)) throw new DomainError("GST_EVIDENCE_REQUIRED", "GST evidence IDs are required for every line"); return [...ids].map((id) => id.trim()).sort(); }
function account(block: GstDocumentBlock, component: string, purchase: boolean): string | undefined { const aliases: Record<string, keyof GstDocumentBlock> = { cgst: purchase ? "inputCgstAccountId" : "cgstAccountId", sgst: purchase ? "inputSgstAccountId" : "sgstAccountId", utgst: purchase ? "inputUtgstAccountId" : "utgstAccountId", igst: purchase ? "inputIgstAccountId" : "igstAccountId" }; const value = block[aliases[component.toLowerCase()]!]; return typeof value === "string" ? value : undefined; }

export async function prepareGstPosting(session: BusinessSession, args: { tenantId: TenantId; bookSetId: BookSetId; partyId: string; documentDate: string; documentType: "SALE" | "PURCHASE"; block: GstDocumentBlock; lines: InputLine[] }): Promise<GstPostingPlan> {
  isoDate(args.documentDate, "documentDate"); if (!args.lines.length) throw new DomainError("GST_LINE_FACT_REQUIRED", "GST requires at least one document line");
  const block = args.block; const purchase = args.documentType === "PURCHASE";
  const ownRegistrationId = purchase ? block.buyerRegistrationId : block.sellerRegistrationId;
  const ownGstin = purchase ? block.buyerGstin : block.sellerGstin;
  const ownSelector = ownRegistrationId ?? ownGstin;
  const otherProfileSelector = purchase ? (block.sellerProfileId ?? block.sellerGstin) : (block.buyerProfileId ?? block.buyerGstin);
  const normalizedOwnGstin = ownGstin === undefined ? null : normalizeGstin(ownGstin, purchase ? "buyerGstin" : "sellerGstin");
  const registrationSelector = ownRegistrationId ? " AND id = ?" : ownGstin ? " AND gstin = ?" : "";
  const selectorValue = ownRegistrationId ?? normalizedOwnGstin;
  const registrationBranch = [args.tenantId, args.documentDate, selectorValue].filter((value) => value !== null && value !== undefined);
  const registrationParams = [...registrationBranch.slice(0, 2), args.documentDate, ...(selectorValue === undefined || selectorValue === null ? [] : [selectorValue]), ...registrationBranch.slice(0, 2), ...(selectorValue === undefined || selectorValue === null ? [] : [selectorValue])];
  const registrationWhere = "tenant_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND effective_to >= ?";
  const regs = await session.query(`SELECT id, gstin, state, status, effective_from, effective_to FROM gst_registrations WHERE ${registrationWhere}${registrationSelector} OR ${registrationWhere.replace("effective_to >= ?", "effective_to IS NULL")}${registrationSelector} ORDER BY id`, registrationParams);
  if (regs.rows.length !== 1) throw new DomainError(regs.rows.length === 0 ? "GST_REGISTRATION_REQUIRED" : "GST_REGISTRATION_AMBIGUOUS", "exactly one applicable tenant GST registration is required");
  const registration = regs.rows[0]!;
  if (normalizedOwnGstin !== null && String(registration.gstin) !== normalizedOwnGstin) throw new DomainError("GST_REGISTRATION_MISMATCH", "selected registration does not match GSTIN");
  const profileId = purchase ? block.sellerProfileId : block.buyerProfileId;
  const profileGstin = purchase ? block.sellerGstin : block.buyerGstin;
  const profileSelector = profileId ? " AND id = ?" : profileGstin ? " AND gstin = ?" : "";
  const profileValue = profileId ?? (profileGstin === undefined ? undefined : normalizeGstin(profileGstin, "partyGstin"));
  const profileBase = [args.tenantId, args.bookSetId, args.partyId, args.documentDate];
  const profileParams = [...profileBase, args.documentDate, ...(profileValue === undefined ? [] : [profileValue]), ...profileBase, ...(profileValue === undefined ? [] : [profileValue])];
  const profileWhere = "tenant_id = ? AND book_set_id = ? AND party_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND effective_to >= ?";
  const profiles = await session.query(`SELECT id, gstin, treatment, state_code, local_component, status, effective_from, effective_to FROM party_gst_profiles WHERE ${profileWhere}${profileSelector} OR ${profileWhere.replace("effective_to >= ?", "effective_to IS NULL")}${profileSelector} ORDER BY id`, profileParams);
  if (profiles.rows.length !== 1) throw new DomainError(profiles.rows.length === 0 ? "GST_PARTY_PROFILE_REQUIRED" : "GST_PARTY_PROFILE_AMBIGUOUS", "exactly one applicable party GST profile is required");
  const profile = profiles.rows[0]!;
  if (String(profile.treatment) === "REGISTERED" && otherProfileSelector && String(profile.gstin) !== normalizeGstin(otherProfileSelector, "partyGstin")) throw new DomainError("GST_PARTY_PROFILE_MISMATCH", "selected party GSTIN does not match profile");
  const ownState = stateCode(registration.state ?? String(registration.gstin).slice(0, 2), "registration.state"); const otherState = stateCode(profile.state_code, "party.stateCode");
  const geometry: GstGeometry = ownState === otherState ? "INTRA_STATE" : "INTER_STATE";
  const local = block.localComponent ?? (profile.local_component == null ? undefined : String(profile.local_component) as GstLocalComponent);
  if (geometry === "INTRA_STATE" && !local) throw new DomainError("GST_LOCAL_COMPONENT_REQUIRED", "intra-state GST requires explicit SGST or UTGST selection");
  if (geometry === "INTER_STATE" && local) throw new DomainError("GST_LOCAL_COMPONENT_INVALID", "inter-state GST cannot carry a local component");
  const facts = factsFor(block, args.lines); const components: GstTaxComponentPlan[] = []; let taxableMinor = 0; let taxMinor = 0;
  for (const line of args.lines) {
    const fact = facts.get(line.lineNumber)!; const base = safeMinor(line.amountMinor, `line ${line.lineNumber}`); const rateBps = rate(fact, `line ${line.lineNumber}`); const classification = classify(fact, `line ${line.lineNumber}.classification`); const evidenceIds = evidence(fact, block.evidenceIds); taxableMinor += base;
    if (geometry === "INTER_STATE") { const amount = roundHalfUp(BigInt(base) * BigInt(rateBps), 10000n); taxMinor += amount; if (amount > 0) components.push({ line, component: "IGST", classification, taxableMinor: base, rateBps, taxMinor: amount, accountId: account(block, "IGST", purchase), evidenceIds }); }
    else { const total = roundHalfUp(BigInt(base) * BigInt(rateBps), 10000n); const cgstRate = Math.floor(rateBps / 2); const cgst = roundHalfUp(BigInt(base) * BigInt(cgstRate), 10000n); const localTax = total - cgst; const localComponent = local!; taxMinor += total; if (cgst > 0) components.push({ line, component: "CGST", classification, taxableMinor: base, rateBps: cgstRate, taxMinor: cgst, accountId: account(block, "CGST", purchase), evidenceIds }); if (localTax > 0) components.push({ line, component: localComponent, classification, taxableMinor: base, rateBps: rateBps - cgstRate, taxMinor: localTax, accountId: account(block, localComponent, purchase), evidenceIds }); }
  }
  const itcTreatment = purchase ? block.itcTreatment : undefined; if (purchase && !itcTreatment) throw new DomainError("GST_ITC_TREATMENT_REQUIRED", "purchase GST requires explicit ITC treatment");
  if (taxMinor > 0 && (!purchase || itcTreatment === "ELIGIBLE")) for (const component of components) if (!component.accountId) throw new DomainError("GST_ACCOUNT_MAPPING_REQUIRED", `${component.component} account mapping is required`);
  const riskFlags = itcTreatment === "PENDING_REVIEW" ? ["ITC_REVIEW_REQUIRED"] : itcTreatment === "INELIGIBLE" ? ["ITC_INELIGIBLE"] : [];
  return { sellerRegistrationId: String(registration.id), buyerProfileId: String(profile.id), geometry, taxableMinor, taxMinor, grossMinor: taxableMinor + taxMinor, ...(geometry === "INTRA_STATE" ? { localComponent: local } : {}), ...(itcTreatment ? { itcTreatment } : {}), riskFlags, evidenceIds: [...new Set(components.flatMap((c) => c.evidenceIds))].sort(), components };
}

export async function persistGstSnapshot(session: BusinessSession, args: { tenantId: TenantId; bookSetId: BookSetId; documentType: "SALE" | "PURCHASE"; documentId: string; plan: GstPostingPlan; now: string }): Promise<string> {
  const snapshotId = randomUUID(); await session.execute("INSERT INTO gst_tax_snapshots (id, tenant_id, book_set_id, document_type, sales_invoice_id, vendor_bill_id, seller_registration_id, buyer_profile_id, geometry, rounding_policy, taxable_minor, tax_minor, gross_minor, itc_treatment, risk_flags_json, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [snapshotId, args.tenantId, args.bookSetId, args.documentType, args.documentType === "SALE" ? args.documentId : null, args.documentType === "PURCHASE" ? args.documentId : null, args.plan.sellerRegistrationId, args.plan.buyerProfileId, args.plan.geometry, GST_V1_ROUNDING_POLICY, args.plan.taxableMinor, args.plan.taxMinor, args.plan.grossMinor, args.plan.itcTreatment ?? null, JSON.stringify(args.plan.riskFlags), JSON.stringify(args.plan.evidenceIds), args.now]);
  for (const component of args.plan.components) await session.execute("INSERT INTO gst_tax_components (id, tenant_id, book_set_id, snapshot_id, document_line_id, line_number, classification, component, taxable_minor, rate_bps, tax_minor, account_id, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), args.tenantId, args.bookSetId, snapshotId, component.line.id, component.line.lineNumber, component.classification, component.component, component.taxableMinor, component.rateBps, component.taxMinor, component.accountId ?? null, JSON.stringify(component.evidenceIds)]);
  return snapshotId;
}

export interface GstRegisterRow { documentId: string; documentNumber: string; documentDate: string; partyId: string; taxableMinor: number; taxMinor: number; grossMinor: number; geometry: GstGeometry; itcTreatment?: ItcTreatment; riskFlags: string[]; }
export async function listGstRegister(sessionRunner: BusinessSessionRunner, args: { tenantId: TenantId; bookSetId: BookSetId; documentType: "SALE" | "PURCHASE"; gstin: string; fromDate?: string; toDate?: string }): Promise<GstRegisterRow[]> {
  const gstin = normalizeGstin(args.gstin); if (args.fromDate) isoDate(args.fromDate, "fromDate"); if (args.toDate) isoDate(args.toDate, "toDate"); if (args.fromDate && args.toDate && args.toDate < args.fromDate) throw new DomainError("INVALID_DATE_RANGE", "toDate must not precede fromDate");
  return sessionRunner.withBusinessSession("read", async (session) => {
    const table = args.documentType === "SALE" ? "sales_invoices" : "vendor_bills"; const number = args.documentType === "SALE" ? "invoice_number" : "bill_number"; const date = args.documentType === "SALE" ? "issue_date" : "bill_date"; const party = args.documentType === "SALE" ? "customer_id" : "vendor_id"; const documentSnapshot = args.documentType === "SALE" ? "sales_invoice_id" : "vendor_bill_id"; const dateClauses = `${args.fromDate ? ` AND d.${date} >= ?` : ""}${args.toDate ? ` AND d.${date} <= ?` : ""}`; const params = [args.tenantId, args.bookSetId, gstin, ...(args.fromDate ? [args.fromDate] : []), ...(args.toDate ? [args.toDate] : [])]; const rows = await session.query(`SELECT d.id AS document_id, d.${number} AS document_number, d.${date} AS document_date, d.${party} AS party_id, s.taxable_minor, s.tax_minor, s.gross_minor, s.geometry, s.itc_treatment, s.risk_flags_json FROM ${table} d JOIN gst_tax_snapshots s ON s.tenant_id = d.tenant_id AND s.book_set_id = d.book_set_id AND s.${documentSnapshot} = d.id JOIN gst_registrations r ON r.id = s.seller_registration_id AND r.tenant_id = d.tenant_id WHERE d.tenant_id = ? AND d.book_set_id = ? AND r.gstin = ? AND d.status <> 'DRAFT'${dateClauses} ORDER BY d.${date}, d.${number}, d.id`, params); return rows.rows.map((row) => ({ documentId: String(row.document_id), documentNumber: String(row.document_number), documentDate: String(row.document_date), partyId: String(row.party_id), taxableMinor: Number(row.taxable_minor), taxMinor: Number(row.tax_minor), grossMinor: Number(row.gross_minor), geometry: String(row.geometry) as GstGeometry, ...(row.itc_treatment == null ? {} : { itcTreatment: String(row.itc_treatment) as ItcTreatment }), riskFlags: JSON.parse(String(row.risk_flags_json)) as string[] }));
  });
}
