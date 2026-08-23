import { createHash, randomUUID } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { CommandEnvelope, CommandResult, TaxCaseFactDecisionPayload, TaxCaseFactKind, TaxCaseFactProposePayload, TaxCaseReconciliationRecordPayload } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";

type ProposeEnvelope = CommandEnvelope<TaxCaseFactProposePayload>;
type DecisionEnvelope = CommandEnvelope<TaxCaseFactDecisionPayload>;
type ReconciliationEnvelope = CommandEnvelope<TaxCaseReconciliationRecordPayload>;

const FACT_KINDS: readonly TaxCaseFactKind[] = ["TDS_CREDIT", "TCS_CREDIT", "TAX_PAYMENT", "BUSINESS_RECEIPT", "INTEREST_INCOME", "DIVIDEND_INCOME", "SECURITIES_TRANSACTION", "RENT_INCOME", "OTHER"];

function nonblank(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_TAX_FACT_INPUT", `${field} must be a nonblank string`);
  const result = value.trim();
  if (result.length > max) throw new DomainError("INVALID_TAX_FACT_INPUT", `${field} exceeds the V1 length limit`);
  return result;
}

function date(value: unknown, field: string, required = true): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new DomainError("INVALID_TAX_FACT_INPUT", `${field} is required`);
    return undefined;
  }
  const result = nonblank(value, field, 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new DomainError("INVALID_TAX_FACT_DATE", `${field} must be an ISO date`);
  return result;
}

function amount(value: unknown, field: string, positive = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) throw new DomainError("INVALID_TAX_FACT_AMOUNT", `${field} must be a ${positive ? "positive" : "non-negative"} safe integer`);
  return value;
}

function currency(value: unknown, field: string): string {
  const result = nonblank(value, field, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) throw new DomainError("INVALID_TAX_FACT_CURRENCY", `${field} must be a three-letter currency`);
  return result;
}

function hashPayload(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }

async function replay(session: BusinessSession, tenantId: string, requestId: string, requestHash: string): Promise<CommandResult<Record<string, unknown>> | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  if (!row) return undefined;
  if (String(row.request_hash) !== requestHash) throw new IdempotencyConflictError("same request_id with different normalized request payload");
  const resultJson = String(row.result_json); const resultHash = String(row.result_hash);
  if (computeResultHash(resultJson) !== resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson, resultHash, replayed: true };
}

async function finish<R>(session: BusinessSession, command: string, envelope: CommandEnvelope<unknown>, requestHash: string, result: R, entityId: string, entityType: string): Promise<CommandResult<R>> {
  const resultJson = canonicalJson(result); const resultHash = computeResultHash(resultJson); const now = new Date().toISOString();
  await session.execute("INSERT INTO audit_records (id, tenant_id, command, action, actor_type, actor_id, source, reason, request_id, entity_type, entity_id, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, command, command, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, entityType, entityId, resultHash, JSON.stringify(result), now, now]);
  await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]);
  return { resultJson, resultHash };
}

async function caseAndSource(session: BusinessSession, tenantId: string, taxCaseId: string, sourceId: string, artifactId: string): Promise<void> {
  if (!await session.querySingle("SELECT id FROM tax_cases WHERE id = ? AND tenant_id = ?", [taxCaseId, tenantId])) throw new DomainError("TAX_CASE_NOT_FOUND", "TaxCase does not belong to tenant");
  if (!await session.querySingle("SELECT id FROM tax_case_external_sources WHERE id = ? AND tax_case_id = ? AND tenant_id = ?", [sourceId, taxCaseId, tenantId])) throw new DomainError("TAX_SOURCE_NOT_FOUND", "Source does not belong to TaxCase and tenant");
  if (!await session.querySingle("SELECT id FROM tax_case_source_artifacts WHERE source_id = ? AND tax_case_id = ? AND tenant_id = ? AND artifact_id = ?", [sourceId, taxCaseId, tenantId, artifactId])) throw new DomainError("TAX_ARTIFACT_NOT_FOUND", "Artifact is not linked to the source, TaxCase, and tenant");
}

function normalizePropose(payload: TaxCaseFactProposePayload): TaxCaseFactProposePayload {
  const key = payload?.sourceRecordKey === undefined ? undefined : nonblank(payload.sourceRecordKey, "sourceRecordKey");
  const ordinal = payload?.sourceOrdinal;
  if ((key === undefined) === (ordinal === undefined)) throw new DomainError("INVALID_TAX_FACT_IDENTITY", "Provide exactly one of sourceRecordKey or sourceOrdinal");
  if (ordinal !== undefined && (!Number.isSafeInteger(ordinal) || ordinal < 0)) throw new DomainError("INVALID_TAX_FACT_IDENTITY", "sourceOrdinal must be a non-negative safe integer");
  const kind = nonblank(payload?.kind, "kind") as TaxCaseFactKind;
  if (!FACT_KINDS.includes(kind)) throw new DomainError("INVALID_TAX_FACT_KIND", "Unsupported personal-tax fact kind");
  const normalized: TaxCaseFactProposePayload = {
    taxCaseId: nonblank(payload?.taxCaseId, "taxCaseId"), sourceId: nonblank(payload?.sourceId, "sourceId"), artifactId: nonblank(payload?.artifactId, "artifactId"),
    ...(payload?.factId !== undefined ? { factId: nonblank(payload.factId, "factId") } : {}), ...(key !== undefined ? { sourceRecordKey: key } : {}), ...(ordinal !== undefined ? { sourceOrdinal: ordinal } : {}),
    kind, rawSourceLabel: nonblank(payload?.rawSourceLabel, "rawSourceLabel"), rawSourceLocator: nonblank(payload?.rawSourceLocator, "rawSourceLocator"), eventDate: date(payload?.eventDate, "eventDate")!,
    ...(payload?.periodStart !== undefined ? { periodStart: date(payload.periodStart, "periodStart") } : {}), ...(payload?.periodEnd !== undefined ? { periodEnd: date(payload.periodEnd, "periodEnd") } : {}), originalCurrency: currency(payload?.originalCurrency, "originalCurrency"),
    grossAmountMinor: amount(payload?.grossAmountMinor, "grossAmountMinor"), ...(payload?.taxAmountMinor !== undefined ? { taxAmountMinor: amount(payload.taxAmountMinor, "taxAmountMinor") } : {}),
    ...(payload?.counterpartyDisplay !== undefined ? { counterpartyDisplay: payload.counterpartyDisplay } : {}), parserIdentity: nonblank(payload?.parserIdentity, "parserIdentity"), parserVersion: nonblank(payload?.parserVersion, "parserVersion"),
    ...(payload?.provenance !== undefined ? { provenance: payload.provenance } : {}), ...(payload?.normalizedPayload !== undefined ? { normalizedPayload: payload.normalizedPayload } : {}),
    ...(payload?.normalizedPayloadHash !== undefined ? { normalizedPayloadHash: nonblank(payload.normalizedPayloadHash, "normalizedPayloadHash", 64).toLowerCase() } : {}), ...(payload?.supersedesFactId !== undefined ? { supersedesFactId: nonblank(payload.supersedesFactId, "supersedesFactId") } : {}),
  };
  if (normalized.normalizedPayloadHash && !/^[0-9a-f]{64}$/.test(normalized.normalizedPayloadHash)) throw new DomainError("INVALID_TAX_FACT_HASH", "normalizedPayloadHash must be lowercase SHA-256");
  if (normalized.periodStart && normalized.periodEnd && normalized.periodStart > normalized.periodEnd) throw new DomainError("INVALID_TAX_FACT_PERIOD", "periodStart must not be after periodEnd");
  return normalized;
}

async function latestEvent(session: BusinessSession, tenantId: string, taxCaseId: string, factId: string): Promise<Record<string, unknown> | undefined> {
  return session.querySingle("SELECT event_type, actor_kind, actor_id, reason, created_at FROM tax_case_fact_events WHERE tenant_id = ? AND tax_case_id = ? AND fact_id = ? ORDER BY rowid DESC LIMIT 1", [tenantId, taxCaseId, factId]);
}

async function factView(session: BusinessSession, tenantId: string, taxCaseId: string, factId: string): Promise<Record<string, unknown>> {
  const row = await session.querySingle("SELECT f.*, s.source_kind, a.content_hash FROM tax_case_facts f JOIN tax_case_external_sources s ON s.id = f.source_id AND s.tax_case_id = f.tax_case_id AND s.tenant_id = f.tenant_id JOIN tax_case_source_artifacts l ON l.source_id = f.source_id AND l.tax_case_id = f.tax_case_id AND l.tenant_id = f.tenant_id AND l.artifact_id = f.artifact_id JOIN personal_tax_source_artifacts a ON a.id = l.artifact_id AND a.tenant_id = l.tenant_id WHERE f.id = ? AND f.tenant_id = ? AND f.tax_case_id = ?", [factId, tenantId, taxCaseId]);
  if (!row) throw new DomainError("TAX_FACT_NOT_FOUND", "Fact does not belong to TaxCase and tenant");
  const event = await latestEvent(session, tenantId, taxCaseId, factId);
  const allocation = await session.querySingle("SELECT COALESCE(SUM(allocated_amount_minor), 0) AS allocated FROM tax_case_fact_reconciliations WHERE tenant_id = ? AND tax_case_id = ? AND fact_id = ?", [tenantId, taxCaseId, factId]);
  const gross = Number(row.gross_amount_minor); const allocated = Number(allocation?.allocated ?? 0); const lifecycle = String(event?.event_type ?? "PROPOSED");
  const reconciliationStatus = lifecycle === "REJECTED" ? "REJECTED" : allocated === 0 ? "UNMATCHED" : allocated === gross ? "MATCHED" : allocated < gross ? "PARTIALLY_MATCHED" : "AMOUNT_MISMATCH";
  return {
    factId: String(row.id), tenantId: String(row.tenant_id), taxCaseId: String(row.tax_case_id), sourceId: String(row.source_id), artifactId: String(row.artifact_id), sourceKind: String(row.source_kind), contentHash: String(row.content_hash),
    sourceRecordKey: row.source_record_key == null ? null : String(row.source_record_key), sourceOrdinal: row.source_ordinal == null ? null : Number(row.source_ordinal), kind: String(row.kind), rawSourceLabel: String(row.raw_source_label), rawSourceLocator: String(row.raw_source_locator), eventDate: String(row.event_date), periodStart: row.period_start == null ? null : String(row.period_start), periodEnd: row.period_end == null ? null : String(row.period_end), originalCurrency: String(row.original_currency), grossAmountMinor: gross, taxAmountMinor: row.tax_amount_minor == null ? null : Number(row.tax_amount_minor), counterpartyDisplay: row.counterparty_display_json == null ? null : JSON.parse(String(row.counterparty_display_json)), parser: { identity: String(row.parser_identity), version: String(row.parser_version), provenance: JSON.parse(String(row.provenance_json)) }, normalizedPayloadHash: String(row.normalized_payload_hash), supersedesFactId: row.supersedes_fact_id == null ? null : String(row.supersedes_fact_id), lifecycle, reviewStatus: lifecycle === "PROPOSED" ? "REVIEW_REQUIRED" : lifecycle, allocatedAmountMinor: allocated, reconciliationStatus, amountMismatch: lifecycle !== "REJECTED" && allocated !== gross, createdAt: String(row.created_at),
  };
}

export async function proposeTaxCaseFact(sessionRunner: BusinessSessionRunner, envelope: ProposeEnvelope): Promise<CommandResult<Record<string, unknown>>> {
  validateCommandEnvelope(envelope); const payload = normalizePropose(envelope.payload); const computedHash = payload.normalizedPayloadHash ?? hashPayload(payload.normalizedPayload ?? payload); const requestHash = computeCommandHash("tax-case.fact.propose", envelope, { ...payload, normalizedPayloadHash: computedHash });
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope.tenantId, envelope.requestId, requestHash); if (prior) return prior;
    await caseAndSource(session, envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.artifactId);
    const duplicate = await session.querySingle("SELECT id FROM tax_case_facts WHERE tenant_id = ? AND tax_case_id = ? AND source_id = ? AND artifact_id = ? AND normalized_payload_hash = ? AND ((source_record_key IS NOT NULL AND source_record_key = ?) OR (source_ordinal IS NOT NULL AND source_ordinal = ?))", [envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.artifactId, computedHash, payload.sourceRecordKey ?? null, payload.sourceOrdinal ?? null]);
    if (duplicate) {
      const result = { ...(await factView(session, envelope.tenantId, payload.taxCaseId, String(duplicate.id))), duplicate: true };
      return finish(session, "tax-case.fact.propose", envelope, requestHash, result, String(duplicate.id), "TaxCaseFact");
    }
    const existingIdentity = await session.querySingle("SELECT id FROM tax_case_facts WHERE tenant_id = ? AND tax_case_id = ? AND source_id = ? AND artifact_id = ? AND ((source_record_key IS NOT NULL AND source_record_key = ?) OR (source_ordinal IS NOT NULL AND source_ordinal = ?))", [envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.artifactId, payload.sourceRecordKey ?? null, payload.sourceOrdinal ?? null]);
    if (existingIdentity && !payload.supersedesFactId) throw new DomainError("TAX_FACT_DUPLICATE_CONFLICT", "The source record identity already has a different normalized payload; provide supersedesFactId for a correction");
    if (payload.supersedesFactId) {
      const priorFact = await session.querySingle("SELECT id, source_id, artifact_id, source_record_key, source_ordinal FROM tax_case_facts WHERE id = ? AND tenant_id = ? AND tax_case_id = ?", [payload.supersedesFactId, envelope.tenantId, payload.taxCaseId]);
      if (!priorFact || String(priorFact.source_id) !== payload.sourceId || String(priorFact.artifact_id) !== payload.artifactId || (payload.sourceRecordKey ?? null) !== (priorFact.source_record_key == null ? null : String(priorFact.source_record_key)) || (payload.sourceOrdinal ?? null) !== (priorFact.source_ordinal == null ? null : Number(priorFact.source_ordinal))) throw new DomainError("TAX_FACT_LINEAGE_SCOPE", "supersedesFactId must be the same tenant, TaxCase, source, artifact, and source record identity");
    }
    const factId = payload.factId ?? randomUUID(); const now = new Date().toISOString();
    await session.execute("INSERT INTO tax_case_facts (id, tenant_id, tax_case_id, source_id, artifact_id, source_record_key, source_ordinal, kind, raw_source_label, raw_source_locator, event_date, period_start, period_end, original_currency, gross_amount_minor, tax_amount_minor, counterparty_display_json, parser_identity, parser_version, provenance_json, normalized_payload_hash, supersedes_fact_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [factId, envelope.tenantId, payload.taxCaseId, payload.sourceId, payload.artifactId, payload.sourceRecordKey ?? null, payload.sourceOrdinal ?? null, payload.kind, payload.rawSourceLabel, payload.rawSourceLocator, payload.eventDate, payload.periodStart ?? null, payload.periodEnd ?? null, payload.originalCurrency, payload.grossAmountMinor, payload.taxAmountMinor ?? null, payload.counterpartyDisplay === undefined ? null : canonicalJson(payload.counterpartyDisplay), payload.parserIdentity, payload.parserVersion, canonicalJson(payload.provenance ?? {}), computedHash, payload.supersedesFactId ?? null, now]);
    await session.execute("INSERT INTO tax_case_fact_events (id, tenant_id, tax_case_id, fact_id, event_type, actor_kind, actor_id, reason, request_id, request_hash, created_at) VALUES (?, ?, ?, ?, 'PROPOSED', ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, payload.taxCaseId, factId, envelope.actor.kind, envelope.actor.id, envelope.reason, envelope.requestId, requestHash, now]);
    const result = { ...(await factView(session, envelope.tenantId, payload.taxCaseId, factId)), duplicate: false };
    return finish(session, "tax-case.fact.propose", envelope, requestHash, result, factId, "TaxCaseFact");
  });
}

async function decideTaxCaseFact(sessionRunner: BusinessSessionRunner, envelope: DecisionEnvelope, eventType: "HUMAN_CONFIRMED" | "REJECTED"): Promise<CommandResult<Record<string, unknown>>> {
  validateCommandEnvelope(envelope); if (envelope.actor.kind !== "HUMAN") throw new DomainError("TAX_FACT_HUMAN_REQUIRED", "Only a HUMAN actor may confirm or reject a tax fact");
  const payload = { taxCaseId: nonblank(envelope.payload?.taxCaseId, "taxCaseId"), factId: nonblank(envelope.payload?.factId, "factId"), reason: nonblank(envelope.payload?.reason, "reason") }; const command = eventType === "HUMAN_CONFIRMED" ? "tax-case.fact.confirm" : "tax-case.fact.reject"; const requestHash = computeCommandHash(command, envelope, payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope.tenantId, envelope.requestId, requestHash); if (prior) return prior;
    const fact = await session.querySingle("SELECT id FROM tax_case_facts WHERE id = ? AND tenant_id = ? AND tax_case_id = ?", [payload.factId, envelope.tenantId, payload.taxCaseId]); if (!fact) throw new DomainError("TAX_FACT_NOT_FOUND", "Fact does not belong to TaxCase and tenant");
    const current = await latestEvent(session, envelope.tenantId, payload.taxCaseId, payload.factId); if (String(current?.event_type ?? "PROPOSED") !== "PROPOSED") throw new DomainError("TAX_FACT_LIFECYCLE_CONFLICT", "Only a proposed fact may be confirmed or rejected");
    const now = new Date().toISOString(); await session.execute("INSERT INTO tax_case_fact_events (id, tenant_id, tax_case_id, fact_id, event_type, actor_kind, actor_id, reason, request_id, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, payload.taxCaseId, payload.factId, eventType, envelope.actor.kind, envelope.actor.id, payload.reason, envelope.requestId, requestHash, now]);
    const result = { ...(await factView(session, envelope.tenantId, payload.taxCaseId, payload.factId)), eventType };
    return finish(session, command, envelope, requestHash, result, payload.factId, "TaxCaseFactEvent");
  });
}

export function confirmTaxCaseFact(sessionRunner: BusinessSessionRunner, envelope: DecisionEnvelope) { return decideTaxCaseFact(sessionRunner, envelope, "HUMAN_CONFIRMED"); }
export function rejectTaxCaseFact(sessionRunner: BusinessSessionRunner, envelope: DecisionEnvelope) { return decideTaxCaseFact(sessionRunner, envelope, "REJECTED"); }

export async function listTaxCaseFacts(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string, sourceId?: string): Promise<Record<string, unknown>[]> {
  return sessionRunner.withBusinessSession("read", async (session) => { if (!await session.querySingle("SELECT id FROM tax_cases WHERE id = ? AND tenant_id = ?", [taxCaseId, tenantId])) throw new DomainError("TAX_CASE_NOT_FOUND", "TaxCase does not belong to tenant"); if (sourceId && !await session.querySingle("SELECT id FROM tax_case_external_sources WHERE id = ? AND tax_case_id = ? AND tenant_id = ?", [sourceId, taxCaseId, tenantId])) throw new DomainError("TAX_SOURCE_NOT_FOUND", "Source does not belong to TaxCase and tenant"); const rows = await session.query(`SELECT id FROM tax_case_facts WHERE tenant_id = ? AND tax_case_id = ? ${sourceId ? "AND source_id = ?" : ""} ORDER BY created_at, id`, sourceId ? [tenantId, taxCaseId, sourceId] : [tenantId, taxCaseId]); return Promise.all(rows.rows.map((row) => factView(session, tenantId, taxCaseId, String(row.id)))); });
}

export async function recordTaxCaseReconciliation(sessionRunner: BusinessSessionRunner, envelope: ReconciliationEnvelope): Promise<CommandResult<Record<string, unknown>>> {
  validateCommandEnvelope(envelope); if (envelope.actor.kind !== "HUMAN") throw new DomainError("TAX_RECONCILIATION_HUMAN_REQUIRED", "Only a HUMAN actor may record a reconciliation");
  const raw = envelope.payload; const payload: TaxCaseReconciliationRecordPayload = { taxCaseId: nonblank(raw?.taxCaseId, "taxCaseId"), factId: nonblank(raw?.factId, "factId"), bookSetId: nonblank(raw?.bookSetId, "bookSetId"), journalLineId: nonblank(raw?.journalLineId, "journalLineId"), allocatedAmountMinor: amount(raw?.allocatedAmountMinor, "allocatedAmountMinor", true), currency: currency(raw?.currency, "currency"), reason: nonblank(raw?.reason, "reason") }; const requestHash = computeCommandHash("tax-case.reconciliation.record", envelope, payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope.tenantId, envelope.requestId, requestHash); if (prior) return prior;
    const fact = await session.querySingle("SELECT gross_amount_minor, original_currency FROM tax_case_facts f WHERE f.id = ? AND f.tenant_id = ? AND f.tax_case_id = ? AND (SELECT event_type FROM tax_case_fact_events e WHERE e.fact_id = f.id AND e.tenant_id = f.tenant_id AND e.tax_case_id = f.tax_case_id ORDER BY e.rowid DESC LIMIT 1) = 'HUMAN_CONFIRMED'", [payload.factId, envelope.tenantId, payload.taxCaseId]); if (!fact) throw new DomainError("TAX_FACT_NOT_CONFIRMED", "Only a HUMAN_CONFIRMED fact may be reconciled");
    if (String(fact.original_currency) !== payload.currency) throw new DomainError("TAX_RECONCILIATION_CURRENCY", "Reconciliation currency must equal the fact original currency; no FX is inferred");
    const member = await session.querySingle("SELECT m.book_set_id FROM tax_case_memberships m WHERE m.tenant_id = ? AND m.tax_case_id = ? AND m.version = (SELECT MAX(version) FROM tax_case_memberships WHERE tenant_id = ? AND tax_case_id = ?) AND m.book_set_id = ?", [envelope.tenantId, payload.taxCaseId, envelope.tenantId, payload.taxCaseId, payload.bookSetId]); if (!member) throw new DomainError("TAX_RECONCILIATION_BOOKSET", "BookSet is not a member of the TaxCase");
    const line = await session.querySingle("SELECT debit_minor, credit_minor FROM journal_lines WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [payload.journalLineId, envelope.tenantId, payload.bookSetId]); if (!line) throw new DomainError("TAX_RECONCILIATION_JOURNAL_LINE", "Journal line does not belong to tenant and BookSet");
    const lineAmount = Math.max(Number(line.debit_minor), Number(line.credit_minor)); const lineAllocated = await session.querySingle("SELECT COALESCE(SUM(allocated_amount_minor), 0) AS allocated FROM tax_case_fact_reconciliations WHERE tenant_id = ? AND book_set_id = ? AND journal_line_id = ?", [envelope.tenantId, payload.bookSetId, payload.journalLineId]); if (payload.allocatedAmountMinor > lineAmount - Number(lineAllocated?.allocated ?? 0)) throw new DomainError("TAX_RECONCILIATION_TARGET_OVERALLOCATED", "Allocated amount exceeds the journal line amount");
    const factAllocated = await session.querySingle("SELECT COALESCE(SUM(allocated_amount_minor), 0) AS allocated FROM tax_case_fact_reconciliations WHERE tenant_id = ? AND tax_case_id = ? AND fact_id = ?", [envelope.tenantId, payload.taxCaseId, payload.factId]); if (payload.allocatedAmountMinor > Number(fact.gross_amount_minor) - Number(factAllocated?.allocated ?? 0)) throw new DomainError("TAX_RECONCILIATION_OVERALLOCATED", "Allocated amount exceeds the fact gross amount");
    const now = new Date().toISOString(); const reconciliationId = randomUUID(); await session.execute("INSERT INTO tax_case_fact_reconciliations (id, tenant_id, tax_case_id, fact_id, book_set_id, journal_line_id, allocated_amount_minor, currency, reason, actor_kind, actor_id, request_id, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [reconciliationId, envelope.tenantId, payload.taxCaseId, payload.factId, payload.bookSetId, payload.journalLineId, payload.allocatedAmountMinor, payload.currency, payload.reason, envelope.actor.kind, envelope.actor.id, envelope.requestId, requestHash, now]);
    const result = { reconciliationId, tenantId: envelope.tenantId, taxCaseId: payload.taxCaseId, factId: payload.factId, bookSetId: payload.bookSetId, journalLineId: payload.journalLineId, allocatedAmountMinor: payload.allocatedAmountMinor, currency: payload.currency, reason: payload.reason, posted: false };
    return finish(session, "tax-case.reconciliation.record", envelope, requestHash, result, reconciliationId, "TaxCaseFactReconciliation");
  });
}

export async function listTaxCaseReconciliations(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string, factId?: string): Promise<Record<string, unknown>[]> {
  return sessionRunner.withBusinessSession("read", async (session) => { if (!await session.querySingle("SELECT id FROM tax_cases WHERE id = ? AND tenant_id = ?", [taxCaseId, tenantId])) throw new DomainError("TAX_CASE_NOT_FOUND", "TaxCase does not belong to tenant"); if (factId && !await session.querySingle("SELECT id FROM tax_case_facts WHERE id = ? AND tax_case_id = ? AND tenant_id = ?", [factId, taxCaseId, tenantId])) throw new DomainError("TAX_FACT_NOT_FOUND", "Fact does not belong to TaxCase and tenant"); const rows = await session.query(`SELECT id, fact_id, book_set_id, journal_line_id, allocated_amount_minor, currency, reason, actor_id, created_at FROM tax_case_fact_reconciliations WHERE tenant_id = ? AND tax_case_id = ? ${factId ? "AND fact_id = ?" : ""} ORDER BY created_at, id`, factId ? [tenantId, taxCaseId, factId] : [tenantId, taxCaseId]); return rows.rows.map((row) => ({ reconciliationId: String(row.id), tenantId, taxCaseId, factId: String(row.fact_id), bookSetId: String(row.book_set_id), journalLineId: String(row.journal_line_id), allocatedAmountMinor: Number(row.allocated_amount_minor), currency: String(row.currency), reason: String(row.reason), actorId: String(row.actor_id), createdAt: String(row.created_at), posted: false })); });
}

export async function taxCaseFactSummary(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string): Promise<Record<string, unknown>> {
  const facts = await listTaxCaseFacts(sessionRunner, tenantId, taxCaseId);
  const summary = { tenantId, taxCaseId, total: facts.length, proposed: 0, reviewRequired: 0, confirmed: 0, rejected: 0, unmatched: 0, partiallyMatched: 0, matched: 0, amountMismatch: 0 };
  for (const fact of facts) { const lifecycle = String(fact.lifecycle); if (lifecycle === "PROPOSED") { summary.proposed++; summary.reviewRequired++; } else if (lifecycle === "REJECTED") summary.rejected++; else { summary.confirmed++; const status = String(fact.reconciliationStatus); if (status === "UNMATCHED") summary.unmatched++; if (status === "PARTIALLY_MATCHED") summary.partiallyMatched++; if (status === "MATCHED") summary.matched++; if (Boolean(fact.amountMismatch)) summary.amountMismatch++; } }
  return summary;
}
