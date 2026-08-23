import { createHash, randomUUID } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";

type ExtractionMode = "MACHINE" | "AGENT_ASSISTED" | "MANUAL";
type OutcomeCandidate = "FACTS_PRESENT" | "EMPTY";
type ReadinessEvent = "CONFIRMED" | "REJECTED";
type AssessmentPayload = {
  taxCaseId: string;
  sourceId: string;
  artifactId: string;
  contentHash: string;
  parserIdentity: string;
  parserVersion: string;
  modelDescriptor?: string;
  extractionMode: ExtractionMode;
  sourceKind: "AIS" | "TIS" | "FORM_26AS" | "OTHER";
  sourcePeriod?: string;
  sourceAsOf?: string;
  recordCount?: number;
  pageCount?: number;
  sectionCount?: number;
  coverage?: Record<string, unknown>;
  factIds: string[];
  issues?: unknown[];
  warnings?: unknown[];
  outcomeCandidate: OutcomeCandidate;
  supersedesAssessmentId?: string;
  assessmentId?: string;
};
type AssessmentEnvelope = CommandEnvelope<AssessmentPayload>;
type DecisionPayload = { taxCaseId: string; sourceId: string; assessmentId: string; expectedAssessmentHash: string; reason: string };
type DecisionEnvelope = CommandEnvelope<DecisionPayload>;

const MAX_ARRAY = 100_000;
const ASSESSMENT_COMMAND = "tax-case.source-assessment";

function text(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_SOURCE_ASSESSMENT_INPUT", `${field} must be a nonblank string`);
  const result = value.trim();
  if (result.length > max) throw new DomainError("INVALID_SOURCE_ASSESSMENT_INPUT", `${field} exceeds the V1 length limit`);
  return result;
}

function hash(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }

function count(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new DomainError("INVALID_SOURCE_ASSESSMENT_COVERAGE", `${field} must be a non-negative safe integer`);
  return Number(value);
}

function list(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new DomainError("INVALID_SOURCE_ASSESSMENT_FACTS", `${field} must be an array`);
  if (value.length > MAX_ARRAY) throw new DomainError("INVALID_SOURCE_ASSESSMENT_FACTS", `${field} is too large`);
  return value.map((item, index) => text(item, `${field}[${index}]`, 256));
}

function jsonList(value: unknown, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ARRAY) throw new DomainError("INVALID_SOURCE_ASSESSMENT_ISSUES", `${field} must be a bounded array`);
  return value.map((item) => {
    if (typeof item === "string") return text(item, field, 512);
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new DomainError("INVALID_SOURCE_ASSESSMENT_ISSUES", `${field} entries must be strings or objects`);
    return item;
  });
}

function normalizePrepare(payload: AssessmentPayload): AssessmentPayload {
  const sourceKind = text(payload?.sourceKind, "sourceKind") as AssessmentPayload["sourceKind"];
  if (!["AIS", "TIS", "FORM_26AS", "OTHER"].includes(sourceKind)) throw new DomainError("INVALID_SOURCE_ASSESSMENT_KIND", "sourceKind must be AIS, TIS, FORM_26AS, or OTHER");
  const extractionMode = text(payload?.extractionMode, "extractionMode") as ExtractionMode;
  if (!["MACHINE", "AGENT_ASSISTED", "MANUAL"].includes(extractionMode)) throw new DomainError("INVALID_SOURCE_ASSESSMENT_MODE", "extractionMode must be MACHINE, AGENT_ASSISTED, or MANUAL");
  const outcomeCandidate = text(payload?.outcomeCandidate, "outcomeCandidate") as OutcomeCandidate;
  if (!["FACTS_PRESENT", "EMPTY"].includes(outcomeCandidate)) throw new DomainError("INVALID_SOURCE_ASSESSMENT_OUTCOME", "outcomeCandidate must be FACTS_PRESENT or EMPTY");
  const factIds = list(payload?.factIds, "factIds");
  const counts = { recordCount: count(payload?.recordCount, "recordCount"), pageCount: count(payload?.pageCount, "pageCount"), sectionCount: count(payload?.sectionCount, "sectionCount") };
  const coverage = payload?.coverage === undefined ? {} : payload.coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) throw new DomainError("INVALID_SOURCE_ASSESSMENT_COVERAGE", "coverage must be an object");
  const normalizedCoverage = { ...(coverage as Record<string, unknown>) };
  for (const field of ["recordCount", "pageCount", "sectionCount"] as const) {
    const nested = count(normalizedCoverage[field], `coverage.${field}`);
    if (counts[field] !== undefined && nested !== undefined && counts[field] !== nested) throw new DomainError("SOURCE_ASSESSMENT_COVERAGE_CONFLICT", `${field} disagrees with coverage.${field}`);
    if (counts[field] !== undefined) normalizedCoverage[field] = counts[field];
  }
  const normalized: AssessmentPayload = {
    taxCaseId: text(payload?.taxCaseId, "taxCaseId"), sourceId: text(payload?.sourceId, "sourceId"), artifactId: text(payload?.artifactId, "artifactId"), contentHash: text(payload?.contentHash, "contentHash", 64).toLowerCase(),
    parserIdentity: text(payload?.parserIdentity, "parserIdentity"), parserVersion: text(payload?.parserVersion, "parserVersion"), modelDescriptor: text(payload?.modelDescriptor ?? "none", "modelDescriptor", 256), extractionMode,
    sourceKind, ...(payload?.sourcePeriod === undefined ? {} : { sourcePeriod: text(payload.sourcePeriod, "sourcePeriod", 128) }), ...(payload?.sourceAsOf === undefined ? {} : { sourceAsOf: text(payload.sourceAsOf, "sourceAsOf", 128) }),
    ...(counts.recordCount === undefined ? {} : { recordCount: counts.recordCount }), ...(counts.pageCount === undefined ? {} : { pageCount: counts.pageCount }), ...(counts.sectionCount === undefined ? {} : { sectionCount: counts.sectionCount }), coverage: normalizedCoverage,
    factIds, issues: jsonList(payload?.issues, "issues"), warnings: jsonList(payload?.warnings, "warnings"), outcomeCandidate,
    ...(payload?.supersedesAssessmentId === undefined ? {} : { supersedesAssessmentId: text(payload.supersedesAssessmentId, "supersedesAssessmentId") }), ...(payload?.assessmentId === undefined ? {} : { assessmentId: text(payload.assessmentId, "assessmentId") }),
  };
  if (!/^[0-9a-f]{64}$/.test(normalized.contentHash)) throw new DomainError("INVALID_SOURCE_ASSESSMENT_HASH", "contentHash must be lowercase SHA-256");
  if (new Set(factIds).size !== factIds.length) throw new DomainError("SOURCE_ASSESSMENT_DUPLICATE_FACT", "factIds must not contain duplicates");
  if (outcomeCandidate === "EMPTY" && factIds.length !== 0) throw new DomainError("SOURCE_ASSESSMENT_EMPTY_FACTS", "EMPTY assessments must bind zero facts");
  if (outcomeCandidate === "FACTS_PRESENT" && factIds.length === 0) throw new DomainError("SOURCE_ASSESSMENT_FACTS_REQUIRED", "FACTS_PRESENT assessments must bind at least one fact");
  return normalized;
}

function normalizeDecision(payload: DecisionPayload): DecisionPayload {
  const expectedAssessmentHash = text(payload?.expectedAssessmentHash, "expectedAssessmentHash", 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedAssessmentHash)) throw new DomainError("INVALID_SOURCE_ASSESSMENT_HASH", "expectedAssessmentHash must be lowercase SHA-256");
  return { taxCaseId: text(payload?.taxCaseId, "taxCaseId"), sourceId: text(payload?.sourceId, "sourceId"), assessmentId: text(payload?.assessmentId, "assessmentId"), expectedAssessmentHash, reason: text(payload?.reason, "reason", 1024) };
}

async function replay(session: BusinessSession, tenantId: string, requestId: string, requestHash: string): Promise<CommandResult<Record<string, unknown>> | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  if (!row) return undefined;
  if (String(row.request_hash) !== requestHash) throw new IdempotencyConflictError("same request_id with different normalized request payload");
  const resultJson = String(row.result_json); const resultHash = String(row.result_hash);
  if (computeResultHash(resultJson) !== resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson, resultHash, replayed: true };
}

async function finish<R>(session: BusinessSession, command: string, envelope: CommandEnvelope<unknown>, requestHash: string, result: R, entityId: string, replayed = false): Promise<CommandResult<R>> {
  const resultJson = canonicalJson(result); const resultHash = computeResultHash(resultJson); const now = new Date().toISOString();
  await session.execute("INSERT INTO audit_records (id, tenant_id, command, action, actor_type, actor_id, source, reason, request_id, entity_type, entity_id, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, command, command, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, "TaxCaseSourceAssessment", entityId, resultHash, JSON.stringify({ replayed }), now, now]);
  if (!replayed) await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]);
  return { resultJson, resultHash, ...(replayed ? { replayed: true } : {}) };
}

type SourceContext = { source: Record<string, unknown>; artifact: Record<string, unknown>; bytesHash: string };

async function sourceContext(session: BusinessSession, tenantId: string, taxCaseId: string, sourceId: string, artifactId: string, contentHash: string): Promise<SourceContext> {
  const source = await session.querySingle("SELECT id, source_kind, source_period, source_as_of, parser_status FROM tax_case_external_sources WHERE id = ? AND tenant_id = ? AND tax_case_id = ?", [sourceId, tenantId, taxCaseId]);
  if (!source) throw new DomainError("TAX_SOURCE_NOT_FOUND", "Source does not belong to TaxCase and tenant");
  const artifact = await session.querySingle("SELECT id, content_hash, bytes, byte_size FROM personal_tax_source_artifacts WHERE id = ? AND tenant_id = ? AND content_hash = ?", [artifactId, tenantId, contentHash]);
  if (!artifact) throw new DomainError("TAX_ARTIFACT_NOT_FOUND", "Artifact and exact content hash do not belong to TaxCase and tenant");
  const bytesHash = createHash("sha256").update(Buffer.from(artifact.bytes as Uint8Array)).digest("hex");
  if (bytesHash !== contentHash || Number(artifact.byte_size) !== Buffer.from(artifact.bytes as Uint8Array).length) throw new DomainError("SOURCE_ARTIFACT_HASH_MISMATCH", "Stored source bytes do not match the bound content hash");
  if (!await session.querySingle("SELECT id FROM tax_case_source_artifacts WHERE source_id = ? AND tenant_id = ? AND tax_case_id = ? AND artifact_id = ? AND content_hash = ?", [sourceId, tenantId, taxCaseId, artifactId, contentHash])) throw new DomainError("TAX_ARTIFACT_NOT_FOUND", "Artifact is not linked to this source, TaxCase, and tenant");
  return { source, artifact, bytesHash };
}

async function latestFactEvent(session: BusinessSession, tenantId: string, taxCaseId: string, factId: string): Promise<Record<string, unknown> | undefined> {
  return session.querySingle("SELECT id, event_type, request_hash FROM tax_case_fact_events WHERE tenant_id = ? AND tax_case_id = ? AND fact_id = ? ORDER BY rowid DESC LIMIT 1", [tenantId, taxCaseId, factId]);
}

type FactBinding = { factId: string; proposalHash: string; lifecycleEventHash: string };

async function currentBindings(session: BusinessSession, tenantId: string, taxCaseId: string, sourceId: string, artifactId: string, factIds: string[], requireTerminal: boolean): Promise<FactBinding[]> {
  const actual = await session.query("SELECT id, normalized_payload_hash FROM tax_case_facts WHERE tenant_id = ? AND tax_case_id = ? AND source_id = ? AND artifact_id = ? ORDER BY id", [tenantId, taxCaseId, sourceId, artifactId]);
  const actualIds = actual.rows.map((row) => String(row.id));
  if (new Set(factIds).size !== factIds.length) throw new DomainError("SOURCE_ASSESSMENT_DUPLICATE_FACT", "Assessment contains duplicate fact IDs");
  if (actualIds.length !== factIds.length || actualIds.some((id, index) => id !== factIds[index])) throw new DomainError("SOURCE_ASSESSMENT_FACT_SET_CHANGED", "Assessment must bind the exact ordered fact set belonging to the artifact");
  const result: FactBinding[] = [];
  for (const factId of factIds) {
    const row = actual.rows.find((candidate) => String(candidate.id) === factId)!;
    const event = await latestFactEvent(session, tenantId, taxCaseId, factId);
    if (!event) throw new DomainError("SOURCE_ASSESSMENT_FACT_EVENT_MISSING", "Every bound fact must have a current lifecycle event");
    const eventType = String(event.event_type);
    if (requireTerminal && !["HUMAN_CONFIRMED", "REJECTED"].includes(eventType)) throw new DomainError("SOURCE_ASSESSMENT_FACT_NOT_TERMINAL", "FACTS_PRESENT confirmation requires every bound fact to be human-confirmed or rejected", { factId, lifecycle: eventType });
    result.push({ factId, proposalHash: String(row.normalized_payload_hash), lifecycleEventHash: String(event.request_hash) });
  }
  return result;
}

function assessmentCanonical(payload: AssessmentPayload, bindings: FactBinding[]): Record<string, unknown> {
  return { schemaVersion: 1, kind: "PERSONAL_TAX_SOURCE_ASSESSMENT_V1", taxCaseId: payload.taxCaseId, sourceId: payload.sourceId, artifactId: payload.artifactId, contentHash: payload.contentHash, sourceKind: payload.sourceKind, sourcePeriod: payload.sourcePeriod ?? null, sourceAsOf: payload.sourceAsOf ?? null, parser: { identity: payload.parserIdentity, version: payload.parserVersion, modelDescriptor: payload.modelDescriptor ?? "none" }, extractionMode: payload.extractionMode, coverage: payload.coverage ?? {}, factBindings: bindings, issues: payload.issues ?? [], warnings: payload.warnings ?? [], outcomeCandidate: payload.outcomeCandidate };
}

async function assessmentRow(session: BusinessSession, tenantId: string, taxCaseId: string, sourceId: string, assessmentId: string): Promise<Record<string, unknown>> {
  const row = await session.querySingle("SELECT * FROM tax_case_source_assessments WHERE id = ? AND tenant_id = ? AND tax_case_id = ? AND source_id = ?", [assessmentId, tenantId, taxCaseId, sourceId]);
  if (!row) throw new DomainError("SOURCE_ASSESSMENT_NOT_FOUND", "Assessment does not belong to source, TaxCase, and tenant");
  return row;
}

async function latestAssessmentEvent(session: BusinessSession, tenantId: string, taxCaseId: string, sourceId: string, assessmentId: string): Promise<Record<string, unknown> | undefined> {
  return session.querySingle("SELECT id, event_type, actor_kind, actor_id, reason, expected_assessment_hash, request_hash, created_at FROM tax_case_source_assessment_events WHERE tenant_id = ? AND tax_case_id = ? AND source_id = ? AND assessment_id = ? ORDER BY rowid DESC LIMIT 1", [tenantId, taxCaseId, sourceId, assessmentId]);
}

async function validateAssessmentCurrent(session: BusinessSession, tenantId: string, taxCaseId: string, sourceId: string, row: Record<string, unknown>, requireTerminal: boolean): Promise<FactBinding[]> {
  const contentHash = String(row.content_hash); const context = await sourceContext(session, tenantId, taxCaseId, sourceId, String(row.artifact_id), contentHash);
  if (String(context.source.source_kind) !== String(row.declared_source_kind) || (context.source.source_period ?? null) !== (row.declared_source_period ?? null) || (context.source.source_as_of ?? null) !== (row.declared_source_as_of ?? null)) throw new DomainError("SOURCE_ASSESSMENT_SOURCE_METADATA_CHANGED", "Assessment source kind or period no longer matches the immutable source");
  const factIds = JSON.parse(String(row.fact_ids_json)) as string[];
  const bindings = await currentBindings(session, tenantId, taxCaseId, sourceId, String(row.artifact_id), factIds, requireTerminal);
  const coverage = JSON.parse(String(row.coverage_json)) as Record<string, unknown>;
  for (const field of ["recordCount", "pageCount", "sectionCount"] as const) {
    const top = row[`${field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`];
    const nested = coverage[field];
    if (top !== null && top !== undefined && Number(top) !== Number(nested ?? top)) throw new DomainError("SOURCE_ASSESSMENT_COVERAGE_INCONSISTENT", `${field} coverage is internally inconsistent`);
    if (field === "recordCount" && ((top !== null && top !== undefined && Number(top) !== factIds.length) || (nested !== undefined && Number(nested) !== factIds.length))) throw new DomainError("SOURCE_ASSESSMENT_RECORD_COUNT_MISMATCH", "recordCount must equal the exact bound fact count");
  }
  const expected = hash(assessmentCanonical({ taxCaseId, sourceId, artifactId: String(row.artifact_id), contentHash, sourceKind: String(row.declared_source_kind) as AssessmentPayload["sourceKind"], ...(row.declared_source_period == null ? {} : { sourcePeriod: String(row.declared_source_period) }), ...(row.declared_source_as_of == null ? {} : { sourceAsOf: String(row.declared_source_as_of) }), parserIdentity: String(row.parser_identity), parserVersion: String(row.parser_version), modelDescriptor: String(row.model_descriptor), extractionMode: String(row.extraction_mode) as ExtractionMode, coverage, factIds, issues: JSON.parse(String(row.issues_json)), warnings: JSON.parse(String(row.warnings_json)), outcomeCandidate: String(row.outcome_candidate) as OutcomeCandidate }, bindings));
  if (expected !== String(row.assessment_hash)) throw new DomainError("SOURCE_ASSESSMENT_FACT_BINDING_CHANGED", "Assessment fact proposal or lifecycle-event bindings no longer match");
  return bindings;
}

function assessmentView(row: Record<string, unknown>, event: Record<string, unknown> | undefined, bindings: FactBinding[]): Record<string, unknown> {
  const lifecycle = String(event?.event_type ?? "PROPOSED");
  return { assessmentId: String(row.id), tenantId: String(row.tenant_id), taxCaseId: String(row.tax_case_id), sourceId: String(row.source_id), artifactId: String(row.artifact_id), contentHash: String(row.content_hash), assessmentHash: String(row.assessment_hash), assessor: { kind: String(row.assessor_actor_kind), id: String(row.assessor_actor_id), assessedAt: String(row.assessed_at) }, parser: { identity: String(row.parser_identity), version: String(row.parser_version), modelDescriptor: String(row.model_descriptor) }, extractionMode: String(row.extraction_mode), sourceKind: String(row.declared_source_kind), sourcePeriod: row.declared_source_period == null ? null : String(row.declared_source_period), sourceAsOf: row.declared_source_as_of == null ? null : String(row.declared_source_as_of), coverage: JSON.parse(String(row.coverage_json)), factIds: JSON.parse(String(row.fact_ids_json)), factBindings: bindings, issues: JSON.parse(String(row.issues_json)), warnings: JSON.parse(String(row.warnings_json)), outcomeCandidate: String(row.outcome_candidate), lifecycle, supersedesAssessmentId: row.supersedes_assessment_id == null ? null : String(row.supersedes_assessment_id), lastEvent: event ? { eventId: String(event.id), type: lifecycle, actorKind: String(event.actor_kind), actorId: String(event.actor_id), reason: String(event.reason), createdAt: String(event.created_at) } : null };
}

export async function prepareTaxCaseSourceAssessment(sessionRunner: BusinessSessionRunner, envelope: AssessmentEnvelope): Promise<CommandResult<Record<string, unknown>>> {
  validateCommandEnvelope(envelope); if (!["HUMAN", "AGENT"].includes(envelope.actor.kind)) throw new DomainError("SOURCE_ASSESSMENT_ACTOR_INVALID", "Only HUMAN or AGENT actors may prepare an assessment");
  const payload = normalizePrepare(envelope.payload); const requestHash = computeCommandHash(`${ASSESSMENT_COMMAND}.prepare`, envelope, payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope.tenantId, envelope.requestId, requestHash); if (prior) { const decoded = JSON.parse(prior.resultJson) as { assessmentId?: string }; await finish(session, `${ASSESSMENT_COMMAND}.prepare`, envelope, requestHash, decoded, String(decoded.assessmentId ?? "unknown"), true); return prior; }
    const source = await sourceContext(session, envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.artifactId, payload.contentHash);
    if (String(source.source.source_kind) !== payload.sourceKind || (source.source.source_period ?? null) !== (payload.sourcePeriod ?? null) || (source.source.source_as_of ?? null) !== (payload.sourceAsOf ?? null)) throw new DomainError("SOURCE_ASSESSMENT_SOURCE_METADATA", "Assessment source metadata must match the immutable source");
    const bindings = await currentBindings(session, envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.artifactId, payload.factIds, false);
    if ((payload.recordCount !== undefined && payload.recordCount !== bindings.length) || (payload.coverage?.recordCount !== undefined && Number(payload.coverage.recordCount) !== bindings.length)) throw new DomainError("SOURCE_ASSESSMENT_RECORD_COUNT_MISMATCH", "recordCount must equal the exact bound fact count");
    const canonical = assessmentCanonical(payload, bindings); const assessmentHash = hash(canonical); const assessmentId = payload.assessmentId ?? randomUUID(); const now = new Date().toISOString();
    if (payload.supersedesAssessmentId) { const priorAssessment = await assessmentRow(session, envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.supersedesAssessmentId); if (String(priorAssessment.artifact_id) !== payload.artifactId) throw new DomainError("SOURCE_ASSESSMENT_LINEAGE_SCOPE", "superseded assessment must bind the same artifact"); }
    await session.execute("INSERT INTO tax_case_source_assessments (id, tenant_id, tax_case_id, source_id, artifact_id, content_hash, assessor_actor_kind, assessor_actor_id, assessed_at, parser_identity, parser_version, model_descriptor, extraction_mode, declared_source_kind, declared_source_period, declared_source_as_of, record_count, page_count, section_count, coverage_json, fact_ids_json, fact_bindings_json, issues_json, warnings_json, outcome_candidate, assessment_state, assessment_hash, supersedes_assessment_id, request_id, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [assessmentId, envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.artifactId, payload.contentHash, envelope.actor.kind, envelope.actor.id, now, payload.parserIdentity, payload.parserVersion, payload.modelDescriptor, payload.extractionMode, payload.sourceKind, payload.sourcePeriod ?? null, payload.sourceAsOf ?? null, payload.recordCount ?? null, payload.pageCount ?? null, payload.sectionCount ?? null, canonicalJson(payload.coverage ?? {}), canonicalJson(payload.factIds), canonicalJson(bindings), canonicalJson(payload.issues ?? []), canonicalJson(payload.warnings ?? []), payload.outcomeCandidate, envelope.actor.kind === "HUMAN" ? "DRAFT" : "PROPOSED", assessmentHash, payload.supersedesAssessmentId ?? null, envelope.requestId, requestHash, now]);
    await session.execute("INSERT INTO tax_case_source_assessment_events (id, tenant_id, tax_case_id, source_id, assessment_id, event_type, actor_kind, actor_id, reason, expected_assessment_hash, request_id, request_hash, created_at) VALUES (?, ?, ?, ?, ?, 'PREPARED', ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, payload.taxCaseId, payload.sourceId, assessmentId, envelope.actor.kind, envelope.actor.id, envelope.reason, assessmentHash, envelope.requestId, requestHash, now]);
    if (payload.supersedesAssessmentId) await session.execute("INSERT INTO tax_case_source_assessment_events (id, tenant_id, tax_case_id, source_id, assessment_id, event_type, actor_kind, actor_id, reason, expected_assessment_hash, request_id, request_hash, created_at) VALUES (?, ?, ?, ?, ?, 'SUPERSEDED', ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.supersedesAssessmentId, envelope.actor.kind, envelope.actor.id, `superseded by ${assessmentId}`, String((await assessmentRow(session, envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.supersedesAssessmentId)).assessment_hash), `${envelope.requestId}:superseded:${payload.supersedesAssessmentId}`, hash({ requestHash, supersedes: payload.supersedesAssessmentId }), now]);
    const result = assessmentView({ id: assessmentId, tenant_id: envelope.tenantId, tax_case_id: payload.taxCaseId, source_id: payload.sourceId, artifact_id: payload.artifactId, content_hash: payload.contentHash, assessment_hash: assessmentHash, assessor_actor_kind: envelope.actor.kind, assessor_actor_id: envelope.actor.id, assessed_at: now, parser_identity: payload.parserIdentity, parser_version: payload.parserVersion, model_descriptor: payload.modelDescriptor, extraction_mode: payload.extractionMode, declared_source_kind: payload.sourceKind, declared_source_period: payload.sourcePeriod ?? null, declared_source_as_of: payload.sourceAsOf ?? null, coverage_json: canonicalJson(payload.coverage ?? {}), fact_ids_json: canonicalJson(payload.factIds), issues_json: canonicalJson(payload.issues ?? []), warnings_json: canonicalJson(payload.warnings ?? []), outcome_candidate: payload.outcomeCandidate, supersedes_assessment_id: payload.supersedesAssessmentId ?? null }, { id: "", event_type: "PREPARED", actor_kind: envelope.actor.kind, actor_id: envelope.actor.id, reason: envelope.reason, created_at: now }, bindings);
    return finish(session, `${ASSESSMENT_COMMAND}.prepare`, envelope, requestHash, result, assessmentId);
  });
}

async function decideTaxCaseSourceAssessment(sessionRunner: BusinessSessionRunner, envelope: DecisionEnvelope, eventType: ReadinessEvent): Promise<CommandResult<Record<string, unknown>>> {
  validateCommandEnvelope(envelope); if (envelope.actor.kind !== "HUMAN") throw new DomainError("SOURCE_ASSESSMENT_HUMAN_REQUIRED", "Only a HUMAN actor may confirm or reject a source assessment");
  const payload = normalizeDecision(envelope.payload); const command = `${ASSESSMENT_COMMAND}.${eventType === "CONFIRMED" ? "confirm" : "reject"}`; const requestHash = computeCommandHash(command, envelope, payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope.tenantId, envelope.requestId, requestHash); if (prior) { const decoded = JSON.parse(prior.resultJson) as { assessmentId?: string }; await finish(session, command, envelope, requestHash, decoded, String(decoded.assessmentId ?? payload.assessmentId), true); return prior; }
    const row = await assessmentRow(session, envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.assessmentId); if (String(row.assessment_hash) !== payload.expectedAssessmentHash) throw new DomainError("SOURCE_ASSESSMENT_CAS_FAILED", "Expected assessment hash does not match the immutable assessment", { expectedAssessmentHash: String(row.assessment_hash), suppliedAssessmentHash: payload.expectedAssessmentHash });
    const current = await latestAssessmentEvent(session, envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.assessmentId); if (current && ["CONFIRMED", "REJECTED", "SUPERSEDED"].includes(String(current.event_type))) throw new DomainError("SOURCE_ASSESSMENT_LIFECYCLE_CONFLICT", "Only a prepared assessment may be confirmed or rejected");
    const bindings = await validateAssessmentCurrent(session, envelope.tenantId, payload.taxCaseId, payload.sourceId, row, eventType === "CONFIRMED");
    if (eventType === "CONFIRMED" && String(row.outcome_candidate) === "EMPTY" && bindings.length !== 0) throw new DomainError("SOURCE_ASSESSMENT_EMPTY_FACTS", "EMPTY confirmation requires zero bound facts");
    const now = new Date().toISOString(); await session.execute("INSERT INTO tax_case_source_assessment_events (id, tenant_id, tax_case_id, source_id, assessment_id, event_type, actor_kind, actor_id, reason, expected_assessment_hash, request_id, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.assessmentId, eventType, envelope.actor.kind, envelope.actor.id, payload.reason, payload.expectedAssessmentHash, envelope.requestId, requestHash, now]);
    const result = assessmentView(row, { id: randomUUID(), event_type: eventType, actor_kind: envelope.actor.kind, actor_id: envelope.actor.id, reason: payload.reason, created_at: now }, bindings); return finish(session, command, envelope, requestHash, result, payload.assessmentId);
  });
}

export function confirmTaxCaseSourceAssessment(sessionRunner: BusinessSessionRunner, envelope: DecisionEnvelope) { return decideTaxCaseSourceAssessment(sessionRunner, envelope, "CONFIRMED"); }
export function rejectTaxCaseSourceAssessment(sessionRunner: BusinessSessionRunner, envelope: DecisionEnvelope) { return decideTaxCaseSourceAssessment(sessionRunner, envelope, "REJECTED"); }

export async function showTaxCaseSourceAssessment(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string, sourceId: string, assessmentId: string): Promise<Record<string, unknown>> {
  return sessionRunner.withBusinessSession("read", async (session) => { const row = await assessmentRow(session, tenantId, taxCaseId, sourceId, assessmentId); const bindings = JSON.parse(String(row.fact_bindings_json)) as FactBinding[]; return assessmentView(row, await latestAssessmentEvent(session, tenantId, taxCaseId, sourceId, assessmentId), bindings); });
}

export async function sourceReadinessInSession(session: BusinessSession, tenantId: string, taxCaseId: string, sourceId: string): Promise<Record<string, unknown>> {
  const source = await session.querySingle("SELECT id, source_kind, source_period, source_as_of, parser_status FROM tax_case_external_sources WHERE id = ? AND tenant_id = ? AND tax_case_id = ?", [sourceId, tenantId, taxCaseId]);
  if (!source) throw new DomainError("TAX_SOURCE_NOT_FOUND", "Source does not belong to TaxCase and tenant");
  const rows = await session.query("SELECT * FROM tax_case_source_assessments WHERE tenant_id = ? AND tax_case_id = ? AND source_id = ? ORDER BY created_at DESC, id DESC", [tenantId, taxCaseId, sourceId]);
  const latest = rows.rows[0]; let status = "INCOMPLETE"; const reasons: string[] = []; let event: Record<string, unknown> | undefined; let bindings: FactBinding[] = [];
  if (latest) {
    event = await latestAssessmentEvent(session, tenantId, taxCaseId, sourceId, String(latest.id));
    if (String(event?.event_type) === "REJECTED") { status = "REJECTED"; reasons.push("LATEST_ASSESSMENT_REJECTED"); }
    else if (String(event?.event_type) === "CONFIRMED") {
      try { bindings = await validateAssessmentCurrent(session, tenantId, taxCaseId, sourceId, latest, false); status = "READY"; }
      catch (error) { status = "STALE"; reasons.push(error instanceof DomainError ? error.code : "SOURCE_ASSESSMENT_BINDING_DRIFT"); }
    } else reasons.push("ASSESSMENT_REVIEW_REQUIRED");
  } else reasons.push("NO_ASSESSMENT");
  return { tenantId, taxCaseId, sourceId, sourceKind: String(source.source_kind), sourcePeriod: source.source_period == null ? null : String(source.source_period), sourceAsOf: source.source_as_of == null ? null : String(source.source_as_of), parserStatus: String(source.parser_status), readinessStatus: status, status, reasons, nextAction: status === "READY" ? "Source is human-confirmed and currently matches exact artifact and fact bindings." : status === "STALE" ? "Prepare a reassessment after reviewing changed artifact or fact bindings." : status === "REJECTED" ? "Prepare a new assessment after addressing the human rejection." : "Source is stored but incomplete; a deterministic parser is required before tax facts or READY can be claimed.", ...(latest ? { latestAssessment: { assessmentId: String(latest.id), assessmentHash: String(latest.assessment_hash), outcomeCandidate: String(latest.outcome_candidate), lifecycle: String(event?.event_type ?? "PROPOSED"), factCount: bindings.length } } : {}) };
}

export async function taxCaseSourceReadinessStatus(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string, sourceId: string): Promise<Record<string, unknown>> {
  return sessionRunner.withBusinessSession("read", (session) => sourceReadinessInSession(session, tenantId, taxCaseId, sourceId));
}
