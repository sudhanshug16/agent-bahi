import { randomUUID } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { CommandEnvelope, CommandResult, TaxCaseCreatePayload, TaxCaseMembershipRefreshPayload } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";

type TaxCaseCreateEnvelope = CommandEnvelope<TaxCaseCreatePayload>;
type TaxCaseRefreshEnvelope = CommandEnvelope<TaxCaseMembershipRefreshPayload>;

export interface TaxCaseBookSetStatus {
  bookSetId: string;
  kind: "PERSONAL" | "PROPRIETORSHIP";
  capturedLedgerRevision: number;
  currentLedgerRevision: number;
  status: "CURRENT" | "STALE";
  reasons: string[];
}

export interface TaxCaseStatus {
  taxCaseId: string;
  tenantId: string;
  financialYear: string;
  taxPeriod: string;
  filingTrigger: string;
  caseSequence: number;
  lifecycle: "OPEN" | "ARCHIVED";
  membershipVersion: number;
  membershipVersionId: string;
  status: "CURRENT" | "STALE";
  reasons: string[];
  bookSets: TaxCaseBookSetStatus[];
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_TAX_CASE_INPUT", `${field} must be a nonblank string`);
  return value.trim();
}

function bookSetIds(value: unknown, required = true): string[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0)) throw new DomainError("INVALID_TAX_CASE_BOOKSETS", "bookSetIds must be a non-empty array");
  const ids = value.map((id, index) => text(id, `bookSetIds[${index}]`));
  if (new Set(ids).size !== ids.length) throw new DomainError("DUPLICATE_TAX_CASE_BOOKSET", "bookSetIds must not contain duplicates");
  return ids.sort((a, b) => a.localeCompare(b));
}

function normalizeCreate(payload: TaxCaseCreatePayload): TaxCaseCreatePayload {
  const caseSequence = payload?.caseSequence ?? 1;
  if (!Number.isSafeInteger(caseSequence) || caseSequence < 1) throw new DomainError("INVALID_TAX_CASE_SEQUENCE", "caseSequence must be a positive safe integer");
  return { taxCaseId: text(payload?.taxCaseId, "taxCaseId"), financialYear: text(payload?.financialYear, "financialYear"), taxPeriod: text(payload?.taxPeriod, "taxPeriod"), filingTrigger: text(payload?.filingTrigger, "filingTrigger"), caseSequence, bookSetIds: bookSetIds(payload?.bookSetIds) };
}

function normalizeRefresh(payload: TaxCaseMembershipRefreshPayload): TaxCaseMembershipRefreshPayload {
  return { taxCaseId: text(payload?.taxCaseId, "taxCaseId"), ...(payload?.bookSetIds !== undefined ? { bookSetIds: bookSetIds(payload.bookSetIds) } : {}) };
}

async function replay(session: BusinessSession, tenantId: string, requestId: string, requestHash: string): Promise<CommandResult<Record<string, unknown>> | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  if (!row) return undefined;
  if (String(row.request_hash) !== requestHash) throw new IdempotencyConflictError("same request_id with different normalized request payload");
  const resultJson = String(row.result_json); const resultHash = String(row.result_hash);
  if (computeResultHash(resultJson) !== resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson, resultHash, replayed: true };
}

async function eligibleBookSets(session: BusinessSession, tenantId: string, selected?: string[]): Promise<Array<{ id: string; kind: "PERSONAL" | "PROPRIETORSHIP"; revision: number }>> {
  const tenant = await session.querySingle("SELECT kind FROM tenants WHERE id = ?", [tenantId]);
  if (!tenant) throw new DomainError("TENANT_NOT_FOUND", `Tenant not found: ${tenantId}`);
  if (String(tenant.kind) !== "INDIVIDUAL") throw new DomainError("TAX_CASE_TENANT_KIND_FORBIDDEN", "TaxCase membership requires an INDIVIDUAL tenant");
  if (!await session.querySingle("SELECT id FROM tenant_pan_profiles WHERE tenant_id = ?", [tenantId])) throw new DomainError("TAX_CASE_PAN_REQUIRED", "An active PAN profile is required before creating a TaxCase");
  const personal = await session.query("SELECT id, lifecycle FROM book_sets WHERE tenant_id = ? AND kind = 'PERSONAL'", [tenantId]);
  const activePersonal = personal.rows.filter((row) => String(row.lifecycle) === "ACTIVE");
  if (activePersonal.length !== 1) throw new DomainError("TAX_CASE_PERSONAL_BOOKSET_AMBIGUOUS", "TaxCase requires exactly one active PERSONAL BookSet");
  const selectedIds = selected ? new Set(selected) : undefined;
  if (selectedIds && !selectedIds.has(String(activePersonal[0]!.id))) throw new DomainError("TAX_CASE_PERSONAL_BOOKSET_REQUIRED", "Selected TaxCase BookSets must include the active PERSONAL BookSet");
  const rows = await session.query("SELECT bs.id, bs.kind, bs.lifecycle, rev.revision FROM book_sets bs JOIN book_set_ledger_revisions rev ON rev.tenant_id = bs.tenant_id AND rev.book_set_id = bs.id WHERE bs.tenant_id = ? AND (bs.kind = 'PERSONAL' OR bs.kind = 'PROPRIETORSHIP') ORDER BY bs.id", [tenantId]);
  const eligible = rows.rows.filter((row) => String(row.lifecycle) === "ACTIVE");
  const result = eligible.filter((row) => !selectedIds || selectedIds.has(String(row.id)));
  if (selectedIds && result.length !== selectedIds.size) throw new DomainError("TAX_CASE_BOOKSET_INELIGIBLE", "Selected BookSets must be active PERSONAL or PROPRIETORSHIP BookSets owned by the tenant");
  return result.map((row) => ({ id: String(row.id), kind: String(row.kind) as "PERSONAL" | "PROPRIETORSHIP", revision: Number(row.revision) }));
}

async function finish<R>(session: BusinessSession, command: string, envelope: CommandEnvelope<unknown>, requestHash: string, result: R, entityId: string): Promise<CommandResult<R>> {
  const resultJson = canonicalJson(result); const resultHash = computeResultHash(resultJson); const now = new Date().toISOString();
  await session.execute("INSERT INTO audit_records (id, tenant_id, command, action, actor_type, actor_id, source, reason, request_id, entity_type, entity_id, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, command, command, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, "TaxCase", entityId, resultHash, JSON.stringify(result), now, now]);
  await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]);
  return { resultJson, resultHash };
}

async function appendMembership(session: BusinessSession, tenantId: string, taxCaseId: string, actorId: string, bookSets: Array<{ id: string; kind: "PERSONAL" | "PROPRIETORSHIP"; revision: number }>): Promise<{ version: number; versionId: string; members: Array<{ bookSetId: string; kind: string; ledgerRevision: number }> }> {
  const prior = await session.querySingle("SELECT version FROM tax_case_membership_versions WHERE tenant_id = ? AND tax_case_id = ? ORDER BY version DESC LIMIT 1", [tenantId, taxCaseId]);
  const version = prior ? Number(prior.version) + 1 : 1; const versionId = randomUUID(); const now = new Date().toISOString();
  const members = bookSets.map((bookSet) => ({ bookSetId: bookSet.id, kind: bookSet.kind, ledgerRevision: bookSet.revision }));
  await session.execute("INSERT INTO tax_case_membership_versions (id, tax_case_id, tenant_id, version, membership_hash, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)", [versionId, taxCaseId, tenantId, version, computeResultHash(canonicalJson(members)), now, actorId]);
  for (const bookSet of bookSets) await session.execute("INSERT INTO tax_case_memberships (id, tax_case_id, tenant_id, membership_version_id, version, book_set_id, ledger_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), taxCaseId, tenantId, versionId, version, bookSet.id, bookSet.revision, now]);
  return { version, versionId, members };
}

export async function createTaxCase(sessionRunner: BusinessSessionRunner, envelope: TaxCaseCreateEnvelope): Promise<CommandResult<Record<string, unknown>>> {
  validateCommandEnvelope(envelope); const payload = normalizeCreate(envelope.payload); const requestHash = computeCommandHash("tax-case.create", envelope, payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope.tenantId, envelope.requestId, requestHash); if (prior) return prior;
    if (await session.querySingle("SELECT id FROM tax_cases WHERE id = ? AND tenant_id = ?", [payload.taxCaseId, envelope.tenantId])) throw new DomainError("TAX_CASE_EXISTS", "taxCaseId already exists for this tenant");
    const eligible = await eligibleBookSets(session, envelope.tenantId, payload.bookSetIds); const now = new Date().toISOString();
    const pendingJson = canonicalJson({ status: "CREATING" });
    await session.execute("INSERT INTO tax_cases (id, tenant_id, financial_year, tax_period, filing_trigger, case_sequence, lifecycle, request_id, request_hash, result_json, result_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?)", [payload.taxCaseId, envelope.tenantId, payload.financialYear, payload.taxPeriod, payload.filingTrigger, payload.caseSequence ?? 1, envelope.requestId, requestHash, pendingJson, computeResultHash(pendingJson), now, now]);
    const membership = await appendMembership(session, envelope.tenantId, payload.taxCaseId, envelope.actor.id, eligible);
    const result = { taxCaseId: payload.taxCaseId, tenantId: envelope.tenantId, lifecycle: "OPEN", membershipVersion: membership.version, membershipVersionId: membership.versionId, bookSets: membership.members }; const resultJson = canonicalJson(result); const resultHash = computeResultHash(resultJson);
    await session.execute("UPDATE tax_cases SET result_json = ?, result_hash = ?, updated_at = ? WHERE id = ? AND tenant_id = ?", [resultJson, resultHash, now, payload.taxCaseId, envelope.tenantId]);
    return finish(session, "tax-case.create", envelope, requestHash, result, payload.taxCaseId);
  });
}

export async function refreshTaxCaseMembership(sessionRunner: BusinessSessionRunner, envelope: TaxCaseRefreshEnvelope): Promise<CommandResult<Record<string, unknown>>> {
  validateCommandEnvelope(envelope); const payload = normalizeRefresh(envelope.payload); const requestHash = computeCommandHash("tax-case.membership.refresh", envelope, payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope.tenantId, envelope.requestId, requestHash); if (prior) return prior;
    const taxCase = await session.querySingle("SELECT id, lifecycle FROM tax_cases WHERE id = ? AND tenant_id = ?", [payload.taxCaseId, envelope.tenantId]); if (!taxCase) throw new DomainError("TAX_CASE_NOT_FOUND", "TaxCase does not belong to tenant"); if (String(taxCase.lifecycle) !== "OPEN") throw new DomainError("TAX_CASE_NOT_OPEN", "Only OPEN TaxCases can refresh membership");
    const eligible = await eligibleBookSets(session, envelope.tenantId, payload.bookSetIds); const currentVersion = await session.querySingle("SELECT id, version FROM tax_case_membership_versions WHERE tax_case_id = ? AND tenant_id = ? ORDER BY version DESC LIMIT 1", [payload.taxCaseId, envelope.tenantId]); const currentRows = currentVersion ? await session.query("SELECT book_set_id, ledger_revision FROM tax_case_memberships WHERE tax_case_id = ? AND tenant_id = ? AND version = ? ORDER BY book_set_id", [payload.taxCaseId, envelope.tenantId, Number(currentVersion.version)]) : { rows: [] as Record<string, unknown>[] };
    const wanted = eligible.map((bookSet) => ({ id: bookSet.id, revision: bookSet.revision })); const existing = currentRows.rows.map((row) => ({ id: String(row.book_set_id), revision: Number(row.ledger_revision) })); const same = wanted.length === existing.length && wanted.every((item, index) => item.id === existing[index]?.id && item.revision === existing[index]?.revision);
    if (currentVersion && same) return finish(session, "tax-case.membership.refresh", envelope, requestHash, { taxCaseId: payload.taxCaseId, changed: false, membershipVersion: Number(currentVersion.version), membershipVersionId: String(currentVersion.id), bookSets: eligible.map((bookSet) => ({ bookSetId: bookSet.id, kind: bookSet.kind, ledgerRevision: bookSet.revision })) }, payload.taxCaseId);
    const membership = await appendMembership(session, envelope.tenantId, payload.taxCaseId, envelope.actor.id, eligible); return finish(session, "tax-case.membership.refresh", envelope, requestHash, { taxCaseId: payload.taxCaseId, changed: true, membershipVersion: membership.version, membershipVersionId: membership.versionId, bookSets: membership.members }, payload.taxCaseId);
  });
}

export async function taxCaseStatus(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string): Promise<TaxCaseStatus> {
  return sessionRunner.withBusinessSession("read", async (session) => {
    const taxCase = await session.querySingle("SELECT id, tenant_id, financial_year, tax_period, filing_trigger, case_sequence, lifecycle FROM tax_cases WHERE id = ? AND tenant_id = ?", [taxCaseId, tenantId]); if (!taxCase) throw new DomainError("TAX_CASE_NOT_FOUND", "TaxCase does not belong to tenant");
    const version = await session.querySingle("SELECT id, version FROM tax_case_membership_versions WHERE tax_case_id = ? AND tenant_id = ? ORDER BY version DESC LIMIT 1", [taxCaseId, tenantId]); if (!version) throw new DomainError("TAX_CASE_MEMBERSHIP_MISSING", "TaxCase has no membership version");
    const rows = await session.query("SELECT m.book_set_id, m.ledger_revision, bs.kind, rev.revision AS current_ledger_revision FROM tax_case_memberships m JOIN book_sets bs ON bs.id = m.book_set_id AND bs.tenant_id = m.tenant_id JOIN book_set_ledger_revisions rev ON rev.book_set_id = m.book_set_id AND rev.tenant_id = m.tenant_id WHERE m.tax_case_id = ? AND m.tenant_id = ? AND m.version = ? ORDER BY m.book_set_id", [taxCaseId, tenantId, Number(version.version)]);
    const bookSets = rows.rows.map((row) => { const captured = Number(row.ledger_revision); const current = Number(row.current_ledger_revision); const stale = captured !== current; return { bookSetId: String(row.book_set_id), kind: String(row.kind) as "PERSONAL" | "PROPRIETORSHIP", capturedLedgerRevision: captured, currentLedgerRevision: current, status: stale ? "STALE" as const : "CURRENT" as const, reasons: stale ? ["LEDGER_REVISION_ADVANCED"] : [] }; }); const stale = bookSets.some((bookSet) => bookSet.status === "STALE");
    return { taxCaseId: String(taxCase.id), tenantId: String(taxCase.tenant_id), financialYear: String(taxCase.financial_year), taxPeriod: String(taxCase.tax_period), filingTrigger: String(taxCase.filing_trigger), caseSequence: Number(taxCase.case_sequence), lifecycle: String(taxCase.lifecycle) as "OPEN" | "ARCHIVED", membershipVersion: Number(version.version), membershipVersionId: String(version.id), status: stale ? "STALE" : "CURRENT", reasons: stale ? ["MEMBER_LEDGER_REVISION_ADVANCED"] : [], bookSets };
  });
}
