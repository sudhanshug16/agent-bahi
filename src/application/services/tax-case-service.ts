import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { CommandEnvelope, CommandResult, TaxCaseCreatePayload, TaxCaseMembershipRefreshPayload, TaxCaseSourceImportPayload, TaxCaseSourceKind } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";

type TaxCaseCreateEnvelope = CommandEnvelope<TaxCaseCreatePayload>;
type TaxCaseRefreshEnvelope = CommandEnvelope<TaxCaseMembershipRefreshPayload>;
type TaxCaseSourceImportEnvelope = CommandEnvelope<TaxCaseSourceImportPayload>;

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const NEXT_SOURCE_ACTION = "Source is stored but incomplete; a deterministic parser is required before tax facts or READY can be claimed.";

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

async function eligibleBookSets(session: BusinessSession, tenantId: string, selected?: string[], requireExact = false): Promise<Array<{ id: string; kind: "PERSONAL" | "PROPRIETORSHIP"; revision: number }>> {
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
  if (selectedIds && requireExact && (selectedIds.size !== eligible.length || eligible.some((row) => !selectedIds.has(String(row.id))))) {
    throw new DomainError("TAX_CASE_BOOKSET_SET_MISMATCH", "TaxCase BookSet IDs must exactly match the active PERSONAL and PROPRIETORSHIP BookSets");
  }
  const result = eligible.filter((row) => !selectedIds || selectedIds.has(String(row.id)));
  if (selectedIds && result.length !== selectedIds.size) throw new DomainError("TAX_CASE_BOOKSET_INELIGIBLE", "Selected BookSets must be active PERSONAL or PROPRIETORSHIP BookSets owned by the tenant");
  return result.map((row) => ({ id: String(row.id), kind: String(row.kind) as "PERSONAL" | "PROPRIETORSHIP", revision: Number(row.revision) }));
}

async function finish<R>(session: BusinessSession, command: string, envelope: CommandEnvelope<unknown>, requestHash: string, result: R, entityId: string, entityType = "TaxCase"): Promise<CommandResult<R>> {
  const resultJson = canonicalJson(result); const resultHash = computeResultHash(resultJson); const now = new Date().toISOString();
  await session.execute("INSERT INTO audit_records (id, tenant_id, command, action, actor_type, actor_id, source, reason, request_id, entity_type, entity_id, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, command, command, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, entityType, entityId, resultHash, JSON.stringify(result), now, now]);
  await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]);
  return { resultJson, resultHash };
}

async function appendMembership(session: BusinessSession, tenantId: string, taxCaseId: string, actorId: string, bookSets: Array<{ id: string; kind: "PERSONAL" | "PROPRIETORSHIP"; revision: number }>): Promise<{ version: number; versionId: string; members: Array<{ bookSetId: string; kind: string; ledgerRevision: number }> }> {
  const prior = await session.querySingle("SELECT version FROM tax_case_membership_versions WHERE tenant_id = ? AND tax_case_id = ? ORDER BY version DESC LIMIT 1", [tenantId, taxCaseId]);
  const version = prior ? Number(prior.version) + 1 : 1; const versionId = randomUUID(); const now = new Date().toISOString();
  const members = bookSets.map((bookSet) => ({ bookSetId: bookSet.id, kind: bookSet.kind, ledgerRevision: bookSet.revision }));
  const membershipHash = computeResultHash(canonicalJson(members));
  await session.execute("INSERT INTO tax_case_membership_versions (id, tax_case_id, tenant_id, version, membership_hash, seal_state, membership_count, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, 'OPEN', 0, ?, ?)", [versionId, taxCaseId, tenantId, version, membershipHash, now, actorId]);
  for (const bookSet of bookSets) await session.execute("INSERT INTO tax_case_memberships (id, tax_case_id, tenant_id, membership_version_id, version, book_set_id, ledger_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), taxCaseId, tenantId, versionId, version, bookSet.id, bookSet.revision, now]);
  await session.execute("UPDATE tax_case_membership_versions SET seal_state = 'SEALED', membership_count = ? WHERE id = ? AND tax_case_id = ? AND tenant_id = ? AND seal_state = 'OPEN'", [members.length, versionId, taxCaseId, tenantId]);
  return { version, versionId, members };
}

export async function createTaxCase(sessionRunner: BusinessSessionRunner, envelope: TaxCaseCreateEnvelope): Promise<CommandResult<Record<string, unknown>>> {
  validateCommandEnvelope(envelope); const payload = normalizeCreate(envelope.payload); const requestHash = computeCommandHash("tax-case.create", envelope, payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope.tenantId, envelope.requestId, requestHash); if (prior) return prior;
    if (await session.querySingle("SELECT id FROM tax_cases WHERE id = ? AND tenant_id = ?", [payload.taxCaseId, envelope.tenantId])) throw new DomainError("TAX_CASE_EXISTS", "taxCaseId already exists for this tenant");
    const eligible = await eligibleBookSets(session, envelope.tenantId, payload.bookSetIds, true); const now = new Date().toISOString();
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
    const eligible = await eligibleBookSets(session, envelope.tenantId, payload.bookSetIds, true); const currentVersion = await session.querySingle("SELECT id, version FROM tax_case_membership_versions WHERE tax_case_id = ? AND tenant_id = ? ORDER BY version DESC LIMIT 1", [payload.taxCaseId, envelope.tenantId]); const currentRows = currentVersion ? await session.query("SELECT book_set_id, ledger_revision FROM tax_case_memberships WHERE tax_case_id = ? AND tenant_id = ? AND version = ? ORDER BY book_set_id", [payload.taxCaseId, envelope.tenantId, Number(currentVersion.version)]) : { rows: [] as Record<string, unknown>[] };
    const wanted = eligible.map((bookSet) => ({ id: bookSet.id, revision: bookSet.revision })); const existing = currentRows.rows.map((row) => ({ id: String(row.book_set_id), revision: Number(row.ledger_revision) })); const same = wanted.length === existing.length && wanted.every((item, index) => item.id === existing[index]?.id && item.revision === existing[index]?.revision);
    if (currentVersion && same) return finish(session, "tax-case.membership.refresh", envelope, requestHash, { taxCaseId: payload.taxCaseId, changed: false, membershipVersion: Number(currentVersion.version), membershipVersionId: String(currentVersion.id), bookSets: eligible.map((bookSet) => ({ bookSetId: bookSet.id, kind: bookSet.kind, ledgerRevision: bookSet.revision })) }, payload.taxCaseId);
    const membership = await appendMembership(session, envelope.tenantId, payload.taxCaseId, envelope.actor.id, eligible); return finish(session, "tax-case.membership.refresh", envelope, requestHash, { taxCaseId: payload.taxCaseId, changed: true, membershipVersion: membership.version, membershipVersionId: membership.versionId, bookSets: membership.members }, payload.taxCaseId);
  });
}

type PreparedSource = {
  payload: TaxCaseSourceImportPayload;
  bytes: Buffer;
  contentHash: string;
  byteSize: number;
};

function nonblank(value: unknown, field: string, maxLength = 256): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_TAX_SOURCE_INPUT", `${field} must be a nonblank string`);
  const result = value.trim();
  if (result.length > maxLength) throw new DomainError("INVALID_TAX_SOURCE_INPUT", `${field} exceeds the V1 length limit`);
  return result;
}

function sourceKind(value: unknown): TaxCaseSourceKind {
  const kind = nonblank(value, "sourceKind");
  if (!["AIS", "TIS", "FORM_26AS", "OTHER"].includes(kind)) throw new DomainError("INVALID_TAX_SOURCE_KIND", "sourceKind must be AIS, TIS, FORM_26AS, or OTHER");
  return kind as TaxCaseSourceKind;
}

function strictBase64(value: string): Buffer {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || (value.includes("=") && !/(^|[^=])={1,2}$/.test(value))) {
    throw new DomainError("INVALID_TAX_SOURCE_BASE64", "contentBase64 must be non-empty canonical base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) throw new DomainError("INVALID_TAX_SOURCE_BASE64", "contentBase64 is malformed");
  return bytes;
}

async function readLocalSource(filePath: string): Promise<Buffer> {
  if (!isAbsolute(filePath) || filePath.includes("\0") || filePath.split(/[\\/]+/).includes("..")) throw new DomainError("UNSAFE_TAX_SOURCE_PATH", "filePath must be an absolute, non-traversing local file path");
  let inspected;
  try {
    inspected = await lstat(filePath);
    if (!inspected.isFile() || inspected.isSymbolicLink()) throw new DomainError("UNSAFE_TAX_SOURCE_PATH", "filePath must resolve to a regular non-symlink file");
    const canonical = await realpath(filePath);
    const canonicalStat = await lstat(canonical);
    if (!canonicalStat.isFile()) throw new DomainError("UNSAFE_TAX_SOURCE_PATH", "filePath must resolve to a regular file");
    if (canonicalStat.size > MAX_SOURCE_BYTES) throw new DomainError("TAX_SOURCE_TOO_LARGE", `source content exceeds the ${MAX_SOURCE_BYTES} byte V1 limit`);
    const bytes = await readFile(canonical);
    if (bytes.length === 0) throw new DomainError("EMPTY_TAX_SOURCE", "source content must not be empty");
    return bytes;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("UNSAFE_TAX_SOURCE_PATH", "filePath must identify a readable regular local file");
  }
}

async function prepareSource(payload: TaxCaseSourceImportPayload): Promise<PreparedSource> {
  const taxCaseId = nonblank(payload?.taxCaseId, "taxCaseId");
  const kind = sourceKind(payload?.sourceKind);
  const mediaType = nonblank(payload?.mediaType, "mediaType", 128).toLowerCase();
  const originalFilename = nonblank(payload?.originalFilename, "originalFilename", 256);
  const hasPath = payload?.filePath !== undefined;
  const hasBase64 = payload?.contentBase64 !== undefined;
  if (hasPath === hasBase64) throw new DomainError("TAX_SOURCE_CONTENT_EXACTLY_ONE", "Provide exactly one of filePath or contentBase64");
  const bytes = hasPath ? await readLocalSource(nonblank(payload.filePath, "filePath", 1024)) : strictBase64(nonblank(payload.contentBase64, "contentBase64", MAX_SOURCE_BYTES * 2));
  if (bytes.length > MAX_SOURCE_BYTES) throw new DomainError("TAX_SOURCE_TOO_LARGE", `source content exceeds the ${MAX_SOURCE_BYTES} byte V1 limit`);
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  return {
    bytes,
    contentHash,
    byteSize: bytes.length,
    payload: {
      taxCaseId,
      sourceKind: kind,
      ...(payload.sourcePeriod !== undefined ? { sourcePeriod: nonblank(payload.sourcePeriod, "sourcePeriod", 128) } : {}),
      ...(payload.sourceAsOf !== undefined ? { sourceAsOf: nonblank(payload.sourceAsOf, "sourceAsOf", 128) } : {}),
      mediaType,
      originalFilename,
    },
  };
}

function parserStatus(filename: string): "UNPARSED" | "UNSUPPORTED" {
  return /\.(pdf|json|csv)$/i.test(filename) ? "UNSUPPORTED" : "UNPARSED";
}

async function sourceView(session: BusinessSession, tenantId: string, taxCaseId: string, sourceId?: string): Promise<Record<string, unknown>[]> {
  const rows = await session.query(`SELECT s.id, s.source_kind, s.source_period, s.source_as_of, s.parser_identity, s.parser_version, s.parser_status, s.status, s.created_at, l.id AS link_id, l.content_hash, a.id AS artifact_id, a.byte_size, a.media_type, a.original_filename, a.created_at AS artifact_created_at FROM tax_case_external_sources s JOIN tax_case_source_artifacts l ON l.source_id = s.id AND l.tax_case_id = s.tax_case_id AND l.tenant_id = s.tenant_id JOIN personal_tax_source_artifacts a ON a.id = l.artifact_id AND a.tenant_id = l.tenant_id AND a.content_hash = l.content_hash WHERE s.tenant_id = ? AND s.tax_case_id = ? ${sourceId ? "AND s.id = ?" : ""} ORDER BY s.created_at, s.id, l.id`, sourceId ? [tenantId, taxCaseId, sourceId] : [tenantId, taxCaseId]);
  return Promise.all(rows.rows.map(async (row) => {
    const links = await session.query("SELECT id FROM tax_case_source_artifacts WHERE tenant_id = ? AND content_hash = ?", [tenantId, String(row.content_hash)]);
    return {
      sourceId: String(row.id), sourceKind: String(row.source_kind), sourcePeriod: row.source_period == null ? null : String(row.source_period), sourceAsOf: row.source_as_of == null ? null : String(row.source_as_of), parser: { identity: String(row.parser_identity), version: String(row.parser_version), status: String(row.parser_status) }, status: String(row.status), nextAction: NEXT_SOURCE_ACTION, createdAt: String(row.created_at), artifact: { linkId: String(row.link_id), artifactId: String(row.artifact_id), contentHash: String(row.content_hash), byteSize: Number(row.byte_size), mediaType: String(row.media_type), originalFilename: String(row.original_filename), createdAt: String(row.artifact_created_at), deduplicated: links.rows.length > 1, linkCount: links.rows.length },
    };
  }));
}

export async function importTaxCaseSource(sessionRunner: BusinessSessionRunner, envelope: TaxCaseSourceImportEnvelope): Promise<CommandResult<Record<string, unknown>>> {
  validateCommandEnvelope(envelope);
  const prepared = await prepareSource(envelope.payload);
  const requestHash = computeCommandHash("tax-case.source.import", envelope, { ...prepared.payload, contentHash: prepared.contentHash, byteSize: prepared.byteSize });
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope.tenantId, envelope.requestId, requestHash); if (prior) return prior;
    const taxCase = await session.querySingle("SELECT id FROM tax_cases WHERE id = ? AND tenant_id = ? AND lifecycle = 'OPEN'", [prepared.payload.taxCaseId, envelope.tenantId]);
    if (!taxCase) throw new DomainError("TAX_CASE_NOT_FOUND", "TaxCase does not belong to tenant or is not OPEN");
    const now = new Date().toISOString();
    const existingArtifact = await session.querySingle("SELECT id FROM personal_tax_source_artifacts WHERE tenant_id = ? AND content_hash = ?", [envelope.tenantId, prepared.contentHash]);
    const artifactId = existingArtifact ? String(existingArtifact.id) : randomUUID();
    if (!existingArtifact) await session.execute("INSERT INTO personal_tax_source_artifacts (tenant_id, content_hash, id, bytes, byte_size, media_type, original_filename, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [envelope.tenantId, prepared.contentHash, artifactId, prepared.bytes, prepared.byteSize, prepared.payload.mediaType, prepared.payload.originalFilename, now]);
    const sourceId = randomUUID();
    const status = "INCOMPLETE" as const;
    const parsedStatus = parserStatus(prepared.payload.originalFilename);
    await session.execute("INSERT INTO tax_case_external_sources (id, tenant_id, tax_case_id, source_kind, source_period, source_as_of, parser_identity, parser_version, parser_status, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [sourceId, envelope.tenantId, prepared.payload.taxCaseId, prepared.payload.sourceKind, prepared.payload.sourcePeriod ?? null, prepared.payload.sourceAsOf ?? null, "agent-bahi-source-intake", "1", parsedStatus, status, now]);
    const linkId = randomUUID();
    await session.execute("INSERT INTO tax_case_source_artifacts (id, tenant_id, tax_case_id, source_id, artifact_id, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [linkId, envelope.tenantId, prepared.payload.taxCaseId, sourceId, artifactId, prepared.contentHash, now]);
    const result = { taxCaseId: prepared.payload.taxCaseId, sourceId, status, nextAction: NEXT_SOURCE_ACTION, parser: { identity: "agent-bahi-source-intake", version: "1", status: parsedStatus }, artifact: { artifactId, contentHash: prepared.contentHash, byteSize: prepared.byteSize, mediaType: prepared.payload.mediaType, originalFilename: prepared.payload.originalFilename, deduplicated: !!existingArtifact, linkId } };
    return finish(session, "tax-case.source.import", envelope, requestHash, result, sourceId, "TaxCaseSource");
  });
}

export async function listTaxCaseSources(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string): Promise<Record<string, unknown>[]> {
  return sessionRunner.withBusinessSession("read", async (session) => {
    const exists = await session.querySingle("SELECT id FROM tax_cases WHERE id = ? AND tenant_id = ?", [taxCaseId, tenantId]); if (!exists) throw new DomainError("TAX_CASE_NOT_FOUND", "TaxCase does not belong to tenant");
    return sourceView(session, tenantId, taxCaseId);
  });
}

export async function taxCaseSourceStatus(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string, sourceId: string): Promise<Record<string, unknown>> {
  const rows = await listTaxCaseSources(sessionRunner, tenantId, taxCaseId);
  const result = rows.find((row) => row.sourceId === sourceId); if (!result) throw new DomainError("TAX_SOURCE_NOT_FOUND", "Source does not belong to TaxCase and tenant");
  return result;
}

export async function taxCaseStatus(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string): Promise<TaxCaseStatus> {
  return sessionRunner.withBusinessSession("read", async (session) => {
    const taxCase = await session.querySingle("SELECT id, tenant_id, financial_year, tax_period, filing_trigger, case_sequence, lifecycle FROM tax_cases WHERE id = ? AND tenant_id = ?", [taxCaseId, tenantId]); if (!taxCase) throw new DomainError("TAX_CASE_NOT_FOUND", "TaxCase does not belong to tenant");
    const version = await session.querySingle("SELECT id, version FROM tax_case_membership_versions WHERE tax_case_id = ? AND tenant_id = ? ORDER BY version DESC LIMIT 1", [taxCaseId, tenantId]); if (!version) throw new DomainError("TAX_CASE_MEMBERSHIP_MISSING", "TaxCase has no membership version");
    const rows = await session.query("SELECT m.book_set_id, m.ledger_revision, bs.kind, bs.lifecycle, rev.revision AS current_ledger_revision FROM tax_case_memberships m LEFT JOIN book_sets bs ON bs.id = m.book_set_id AND bs.tenant_id = m.tenant_id LEFT JOIN book_set_ledger_revisions rev ON rev.book_set_id = m.book_set_id AND rev.tenant_id = m.tenant_id WHERE m.tax_case_id = ? AND m.tenant_id = ? AND m.version = ? ORDER BY m.book_set_id", [taxCaseId, tenantId, Number(version.version)]);
    const currentEligibleQuery = await session.query("SELECT bs.id, bs.kind, bs.lifecycle FROM book_sets bs WHERE bs.tenant_id = ? AND bs.lifecycle = 'ACTIVE' ORDER BY bs.id", [tenantId]);
    const currentEligibleRows = { rows: currentEligibleQuery.rows.filter((row) => String(row.kind) === "PERSONAL" || String(row.kind) === "PROPRIETORSHIP") };
    const capturedIds = new Set(rows.rows.map((row) => String(row.book_set_id)));
    const currentEligibleIds = new Set(currentEligibleRows.rows.map((row) => String(row.id)));
    const added = [...currentEligibleIds].some((id) => !capturedIds.has(id));
    const archived = rows.rows.some((row) => String(row.lifecycle ?? "") === "ARCHIVED");
    const removed = rows.rows.some((row) => row.lifecycle == null);
    const membershipReasons = [
      ...(added ? ["ELIGIBLE_BOOKSET_ADDED"] : []),
      ...(archived ? ["ELIGIBLE_BOOKSET_ARCHIVED"] : []),
      ...(removed ? ["ELIGIBLE_BOOKSET_REMOVED"] : []),
      ...(!added && !archived && !removed && rows.rows.length !== currentEligibleRows.rows.length ? ["ELIGIBLE_BOOKSET_MEMBERSHIP_CHANGED"] : []),
    ];
    const bookSets = rows.rows.map((row) => {
      const captured = Number(row.ledger_revision);
      const current = row.current_ledger_revision == null ? captured : Number(row.current_ledger_revision);
      const reasons = [...(captured !== current ? ["LEDGER_REVISION_ADVANCED"] : []), ...(String(row.lifecycle ?? "") === "ARCHIVED" ? ["BOOKSET_ARCHIVED"] : []), ...(row.lifecycle == null ? ["BOOKSET_REMOVED"] : [])];
      return { bookSetId: String(row.book_set_id), kind: String(row.kind) as "PERSONAL" | "PROPRIETORSHIP", capturedLedgerRevision: captured, currentLedgerRevision: current, status: reasons.length > 0 ? "STALE" as const : "CURRENT" as const, reasons };
    });
    const reasons = [...membershipReasons, ...(bookSets.some((bookSet) => bookSet.reasons.includes("LEDGER_REVISION_ADVANCED")) ? ["MEMBER_LEDGER_REVISION_ADVANCED"] : [])];
    const stale = reasons.length > 0;
    return { taxCaseId: String(taxCase.id), tenantId: String(taxCase.tenant_id), financialYear: String(taxCase.financial_year), taxPeriod: String(taxCase.tax_period), filingTrigger: String(taxCase.filing_trigger), caseSequence: Number(taxCase.case_sequence), lifecycle: String(taxCase.lifecycle) as "OPEN" | "ARCHIVED", membershipVersion: Number(version.version), membershipVersionId: String(version.id), status: stale ? "STALE" : "CURRENT", reasons, bookSets };
  });
}
