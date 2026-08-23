import { randomUUID, createHash } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";
import { sourceReadinessInSession } from "./tax-case-source-readiness-service.ts";

const COMMAND = "tax-case.filing-snapshot.seal";
const SNAPSHOT_KIND = "PERSONAL_TAX_FILING_SNAPSHOT_V1";

type SealPayload = { taxCaseId: string; candidateHash: string; snapshotId?: string };
type SealEnvelope = CommandEnvelope<SealPayload>;

type SnapshotCandidate = {
  schemaVersion: 1;
  kind: typeof SNAPSHOT_KIND;
  tenantId: string;
  taxCaseId: string;
  taxCase: Record<string, unknown> | null;
  membership: Record<string, unknown> | null;
  pan: Record<string, unknown> | null;
  bookSets: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  facts: Record<string, unknown>[];
  reconciliations: Record<string, unknown>[];
  reconciliationSummary: Record<string, unknown>;
};

export interface FilingSnapshotPreview {
  tenantId: string;
  taxCaseId: string;
  candidateHash: string;
  candidate: SnapshotCandidate;
  blockers: string[];
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_FILING_SNAPSHOT_INPUT", `${field} must be a nonblank string`);
  return value.trim();
}

function hash(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }

function normalizeSeal(payload: SealPayload): SealPayload {
  const taxCaseId = text(payload?.taxCaseId, "taxCaseId");
  const candidateHash = text(payload?.candidateHash, "candidateHash").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(candidateHash)) throw new DomainError("INVALID_FILING_SNAPSHOT_HASH", "candidateHash must be lowercase SHA-256");
  const snapshotId = payload?.snapshotId === undefined ? undefined : text(payload.snapshotId, "snapshotId");
  return { taxCaseId, candidateHash, ...(snapshotId ? { snapshotId } : {}) };
}

function blocker(list: string[], code: string): void { if (!list.includes(code)) list.push(code); }

async function replay(session: BusinessSession, tenantId: string, requestId: string, requestHash: string): Promise<CommandResult<Record<string, unknown>> | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  if (!row) return undefined;
  if (String(row.request_hash) !== requestHash) throw new IdempotencyConflictError("same request_id with different normalized request payload");
  const resultJson = String(row.result_json); const resultHash = String(row.result_hash);
  if (computeResultHash(resultJson) !== resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson, resultHash, replayed: true };
}

async function audit(session: BusinessSession, envelope: CommandEnvelope<unknown>, resultHash: string, entityId: string, replayed: boolean): Promise<void> {
  const now = new Date().toISOString();
  await session.execute("INSERT INTO audit_records (id, tenant_id, command, action, actor_type, actor_id, source, reason, request_id, entity_type, entity_id, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, COMMAND, COMMAND, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, "FilingSnapshot", entityId, resultHash, JSON.stringify({ replayed }), now, now]);
}

async function sourceBindings(session: BusinessSession, tenantId: string, taxCaseId: string, blockers: string[]): Promise<Record<string, unknown>[]> {
  const sourceRows = await session.query("SELECT id, source_kind, source_period, source_as_of, parser_identity, parser_version, parser_status, status, created_at FROM tax_case_external_sources WHERE tenant_id = ? AND tax_case_id = ? ORDER BY id", [tenantId, taxCaseId]);
  const result: Record<string, unknown>[] = [];
  for (const source of sourceRows.rows) {
    const links = await session.query("SELECT l.id AS link_id, l.artifact_id, l.content_hash, a.id AS stored_artifact_id, a.byte_size FROM tax_case_source_artifacts l LEFT JOIN personal_tax_source_artifacts a ON a.id = l.artifact_id AND a.tenant_id = l.tenant_id AND a.content_hash = l.content_hash WHERE l.tenant_id = ? AND l.tax_case_id = ? AND l.source_id = ? ORDER BY l.content_hash, l.id", [tenantId, taxCaseId, String(source.id)]);
    if (links.rows.length === 0) blocker(blockers, "SOURCE_ARTIFACT_MISSING");
    const readiness = await sourceReadinessInSession(session, tenantId, taxCaseId, String(source.id));
    if (String(readiness.readinessStatus) !== "READY") blocker(blockers, "SOURCE_NOT_READY");
    for (const link of links.rows) {
      const artifactReady = link.stored_artifact_id != null && Number(link.byte_size ?? 0) > 0 && /^[0-9a-f]{64}$/.test(String(link.content_hash));
      if (!artifactReady) blocker(blockers, "SOURCE_ARTIFACT_MISSING");
      result.push({
        sourceId: String(source.id), sourceKind: String(source.source_kind), sourcePeriod: source.source_period == null ? null : String(source.source_period), sourceAsOf: source.source_as_of == null ? null : String(source.source_as_of),
        parser: { identity: String(source.parser_identity), version: String(source.parser_version), status: String(source.parser_status) }, sourceStatus: String(readiness.readinessStatus), artifactId: String(link.artifact_id), contentHash: String(link.content_hash),
      });
    }
  }
  return result;
}

async function factBindings(session: BusinessSession, tenantId: string, taxCaseId: string, memberIds: Set<string>, sourceKeys: Set<string>, blockers: string[]): Promise<{ facts: Record<string, unknown>[]; reconciliations: Record<string, unknown>[]; summary: Record<string, unknown> }> {
  const rows = await session.query("SELECT id, source_id, artifact_id, normalized_payload_hash, gross_amount_minor FROM tax_case_facts WHERE tenant_id = ? AND tax_case_id = ? ORDER BY id", [tenantId, taxCaseId]);
  const recons = await session.query("SELECT id, fact_id, book_set_id, journal_line_id, allocated_amount_minor, currency, request_id, request_hash FROM tax_case_fact_reconciliations WHERE tenant_id = ? AND tax_case_id = ? ORDER BY id", [tenantId, taxCaseId]);
  const reconciliations = recons.rows.map((row) => ({ reconciliationId: String(row.id), factId: String(row.fact_id), bookSetId: String(row.book_set_id), journalLineId: String(row.journal_line_id), allocatedAmountMinor: Number(row.allocated_amount_minor), currency: String(row.currency), requestId: String(row.request_id), requestHash: String(row.request_hash) }));
  const facts: Record<string, unknown>[] = [];
  const summary = { total: rows.rows.length, proposed: 0, confirmed: 0, rejected: 0, matched: 0, partial: 0, mismatch: 0, unmatched: 0 };
  for (const row of rows.rows) {
    const terminal = await session.querySingle("SELECT id, event_type, request_hash FROM tax_case_fact_events WHERE tenant_id = ? AND tax_case_id = ? AND fact_id = ? ORDER BY rowid DESC LIMIT 1", [tenantId, taxCaseId, String(row.id)]);
    const lifecycle = String(terminal?.event_type ?? "PROPOSED"); const gross = Number(row.gross_amount_minor);
    const allocated = recons.rows.filter((recon) => String(recon.fact_id) === String(row.id)).reduce((total, recon) => total + Number(recon.allocated_amount_minor), 0);
    const reconciliationStatus = lifecycle === "REJECTED" ? "REJECTED" : allocated === 0 ? "UNMATCHED" : allocated === gross ? "MATCHED" : allocated < gross ? "PARTIALLY_MATCHED" : "AMOUNT_MISMATCH";
    if (lifecycle === "PROPOSED") { summary.proposed++; blocker(blockers, "FACT_PROPOSED"); }
    else if (lifecycle === "REJECTED") summary.rejected++;
    else { summary.confirmed++; if (reconciliationStatus === "MATCHED") summary.matched++; else if (reconciliationStatus === "PARTIALLY_MATCHED") { summary.partial++; blocker(blockers, "FACT_RECONCILIATION_INCOMPLETE"); } else if (reconciliationStatus === "AMOUNT_MISMATCH") { summary.mismatch++; blocker(blockers, "FACT_RECONCILIATION_MISMATCH"); } else { summary.unmatched++; blocker(blockers, "FACT_RECONCILIATION_INCOMPLETE"); } }
    if (!sourceKeys.has(`${row.source_id}:${row.artifact_id}`)) blocker(blockers, "FACT_SOURCE_LINEAGE_INCONSISTENT");
    if (!terminal?.id || !terminal.request_hash) blocker(blockers, "FACT_TERMINAL_EVENT_MISSING");
    facts.push({ factId: String(row.id), sourceId: String(row.source_id), artifactId: String(row.artifact_id), normalizedPayloadHash: String(row.normalized_payload_hash), lifecycle, terminalEvent: { id: String(terminal?.id ?? ""), type: lifecycle, hash: String(terminal?.request_hash ?? "") }, grossAmountMinor: gross, allocatedAmountMinor: allocated, reconciliationStatus });
  }
  for (const row of recons.rows) {
    if (!facts.some((fact) => fact.factId === String(row.fact_id))) blocker(blockers, "RECONCILIATION_FACT_LINEAGE_INCONSISTENT");
    if (!memberIds.has(String(row.book_set_id))) blocker(blockers, "RECONCILIATION_BOOKSET_LINEAGE_INCONSISTENT");
    const line = await session.querySingle("SELECT id FROM journal_lines WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [String(row.journal_line_id), tenantId, String(row.book_set_id)]);
    if (!line) blocker(blockers, "RECONCILIATION_JOURNAL_LINE_MISSING");
  }
  return { facts, reconciliations, summary };
}

async function buildCandidate(session: BusinessSession, tenantId: string, taxCaseId: string): Promise<{ preview: FilingSnapshotPreview; currentMembershipId: string | null }> {
  const blockers: string[] = [];
  const taxCase = await session.querySingle("SELECT id, financial_year, tax_period, filing_trigger, case_sequence, lifecycle FROM tax_cases WHERE id = ? AND tenant_id = ?", [taxCaseId, tenantId]);
  if (!taxCase) throw new DomainError("TAX_CASE_NOT_FOUND", "TaxCase does not belong to tenant");
  if (String(taxCase.lifecycle) !== "OPEN") blocker(blockers, "TAX_CASE_NOT_ACTIVE");
  const membership = await session.querySingle("SELECT id, version, membership_hash, seal_state, membership_count FROM tax_case_membership_versions WHERE tenant_id = ? AND tax_case_id = ? ORDER BY version DESC LIMIT 1", [tenantId, taxCaseId]);
  if (!membership || String(membership.seal_state) !== "SEALED") blocker(blockers, "MEMBERSHIP_VERSION_INVALID");
  const membershipRows = membership ? await session.query("SELECT m.membership_version_id, m.book_set_id, b.kind, m.ledger_revision, rev.revision AS current_ledger_revision, b.lifecycle FROM tax_case_memberships m LEFT JOIN book_sets b ON b.id = m.book_set_id AND b.tenant_id = m.tenant_id LEFT JOIN book_set_ledger_revisions rev ON rev.tenant_id = m.tenant_id AND rev.book_set_id = m.book_set_id WHERE m.tenant_id = ? AND m.tax_case_id = ? AND m.version = ? ORDER BY m.book_set_id", [tenantId, taxCaseId, Number(membership.version)]) : { rows: [] as Record<string, unknown>[] };
  if (membershipRows.rows.length === 0) blocker(blockers, "NO_MEMBER_BOOKSETS");
  if (membership && Number(membership.membership_count) !== membershipRows.rows.length) blocker(blockers, "MEMBERSHIP_VERSION_INVALID");
  if (membership && membershipRows.rows.some((row) => String(row.membership_version_id) !== String(membership.id))) blocker(blockers, "MEMBERSHIP_LINEAGE_INCONSISTENT");
  const active = await session.query("SELECT id, kind FROM book_sets WHERE tenant_id = ? AND lifecycle = 'ACTIVE' AND kind IN ('PERSONAL', 'PROPRIETORSHIP') ORDER BY id", [tenantId]);
  const activeIds = active.rows.map((row) => String(row.id)); const memberIds = new Set(membershipRows.rows.map((row) => String(row.book_set_id)));
  if (activeIds.length !== memberIds.size || activeIds.some((id) => !memberIds.has(id))) blocker(blockers, "MEMBERSHIP_DRIFT");
  const bookSets = membershipRows.rows.map((row) => {
    if (row.kind == null || String(row.lifecycle) !== "ACTIVE" || row.current_ledger_revision == null) blocker(blockers, "BOOKSET_LINEAGE_INCONSISTENT");
    if (row.current_ledger_revision != null && Number(row.current_ledger_revision) !== Number(row.ledger_revision)) blocker(blockers, "LEDGER_REVISION_DRIFT");
    return { bookSetId: String(row.book_set_id), kind: String(row.kind ?? ""), membershipLedgerRevision: Number(row.ledger_revision), ledgerRevision: row.current_ledger_revision == null ? null : Number(row.current_ledger_revision) };
  });
  const memberIdsForFacts = new Set(bookSets.map((row) => row.bookSetId));
  const pan = await session.querySingle("SELECT id, updated_at, lookup_hash, last_four, masked_display, pan FROM tenant_pan_profiles WHERE tenant_id = ?", [tenantId]);
  if (!pan || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(pan.pan)) || !/^[0-9a-f]{64}$/.test(String(pan.lookup_hash)) || !/^[A-Z0-9]{4}$/.test(String(pan.last_four)) || String(pan.masked_display) !== `******${String(pan.last_four)}`) blocker(blockers, "PAN_BINDING_INVALID");
  const panView = pan ? { profileId: String(pan.id), profileVersion: String(pan.updated_at), lookupHash: String(pan.lookup_hash), lastFour: String(pan.last_four), maskedDisplay: String(pan.masked_display) } : null;
  const sources = await sourceBindings(session, tenantId, taxCaseId, blockers); const sourceKeys = new Set(sources.map((source) => `${source.sourceId}:${source.artifactId}`));
  const factState = await factBindings(session, tenantId, taxCaseId, memberIdsForFacts, sourceKeys, blockers);
  const membershipView = membership ? { version: Number(membership.version), versionId: String(membership.id), membershipHash: String(membership.membership_hash), members: bookSets } : null;
  if (membership && hash(bookSets.map((bookSet) => ({ bookSetId: bookSet.bookSetId, kind: bookSet.kind, ledgerRevision: bookSet.membershipLedgerRevision }))) !== String(membership.membership_hash)) blocker(blockers, "MEMBERSHIP_HASH_INCONSISTENT");
  const candidate: SnapshotCandidate = {
    schemaVersion: 1, kind: SNAPSHOT_KIND, tenantId, taxCaseId,
    taxCase: { financialYear: String(taxCase.financial_year), taxPeriod: String(taxCase.tax_period), filingTrigger: String(taxCase.filing_trigger), caseSequence: Number(taxCase.case_sequence), lifecycle: String(taxCase.lifecycle) },
    membership: membershipView, pan: panView, bookSets, sources, facts: factState.facts, reconciliations: factState.reconciliations, reconciliationSummary: factState.summary,
  };
  const candidateHash = hash(candidate);
  return { preview: { tenantId, taxCaseId, candidateHash, candidate, blockers: blockers.sort() }, currentMembershipId: membership ? String(membership.id) : null };
}

export async function previewTaxCaseFilingSnapshot(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string): Promise<FilingSnapshotPreview> {
  return sessionRunner.withBusinessSession("read", async (session) => (await buildCandidate(session, tenantId, text(taxCaseId, "taxCaseId"))).preview);
}

async function storedSnapshot(session: BusinessSession, tenantId: string, taxCaseId: string, snapshotId: string): Promise<Record<string, unknown>> {
  const row = await session.querySingle("SELECT * FROM filing_snapshots WHERE id = ? AND tenant_id = ? AND tax_case_id = ?", [snapshotId, tenantId, taxCaseId]);
  if (!row) throw new DomainError("FILING_SNAPSHOT_NOT_FOUND", "FilingSnapshot does not belong to tenant and TaxCase");
  const bookSets = await session.query("SELECT book_set_id AS bookSetId, book_set_kind AS kind, membership_version AS membershipVersion, ledger_revision AS ledgerRevision FROM filing_snapshot_book_sets WHERE snapshot_id = ? AND tenant_id = ? AND tax_case_id = ? ORDER BY book_set_id", [snapshotId, tenantId, taxCaseId]);
  const sources = await session.query("SELECT source_id AS sourceId, artifact_id AS artifactId, content_hash AS contentHash, source_status AS sourceStatus, parser_status AS parserStatus, parser_identity AS parserIdentity, parser_version AS parserVersion FROM filing_snapshot_sources WHERE snapshot_id = ? AND tenant_id = ? AND tax_case_id = ? ORDER BY source_id, artifact_id", [snapshotId, tenantId, taxCaseId]);
  const facts = await session.query("SELECT fact_id AS factId, source_id AS sourceId, artifact_id AS artifactId, normalized_payload_hash AS normalizedPayloadHash, lifecycle, terminal_event_id AS terminalEventId, terminal_event_type AS terminalEventType, terminal_event_hash AS terminalEventHash, gross_amount_minor AS grossAmountMinor, allocated_amount_minor AS allocatedAmountMinor, reconciliation_status AS reconciliationStatus FROM filing_snapshot_facts WHERE snapshot_id = ? AND tenant_id = ? AND tax_case_id = ? ORDER BY fact_id", [snapshotId, tenantId, taxCaseId]);
  const reconciliations = await session.query("SELECT reconciliation_id AS reconciliationId, fact_id AS factId, book_set_id AS bookSetId, journal_line_id AS journalLineId, allocated_amount_minor AS allocatedAmountMinor, currency, request_id AS requestId, request_hash AS requestHash FROM filing_snapshot_reconciliations WHERE snapshot_id = ? AND tenant_id = ? AND tax_case_id = ? ORDER BY reconciliationId", [snapshotId, tenantId, taxCaseId]);
  const candidate = JSON.parse(String(row.candidate_json)) as Record<string, unknown>;
  const current = (await buildCandidate(session, tenantId, taxCaseId)).preview;
  const integrity = String(row.candidate_hash) !== hash(candidate) || String(row.membership_version_id) !== String((candidate.membership as Record<string, unknown> | null)?.versionId ?? "") || String(row.pan_profile_id) !== String((candidate.pan as Record<string, unknown> | null)?.profileId ?? "");
  const status = integrity || current.blockers.some((code) => ["PAN_BINDING_INVALID", "BOOKSET_LINEAGE_INCONSISTENT", "MEMBERSHIP_LINEAGE_INCONSISTENT", "MEMBERSHIP_HASH_INCONSISTENT", "SOURCE_ARTIFACT_MISSING", "FACT_SOURCE_LINEAGE_INCONSISTENT", "FACT_TERMINAL_EVENT_MISSING", "RECONCILIATION_FACT_LINEAGE_INCONSISTENT", "RECONCILIATION_BOOKSET_LINEAGE_INCONSISTENT", "RECONCILIATION_JOURNAL_LINE_MISSING"].includes(code)) ? "BLOCKED" : current.candidateHash === String(row.candidate_hash) && current.blockers.length === 0 ? "CURRENT" : "STALE";
  return { snapshotId, tenantId, taxCaseId, status, candidateHash: String(row.candidate_hash), membershipVersion: Number(row.membership_version), pan: { profileId: String(row.pan_profile_id), profileVersion: String(row.pan_profile_version), lookupHash: String(row.pan_lookup_hash), lastFour: String(row.pan_last_four), maskedDisplay: String(row.pan_masked_display) }, candidate, creationMetadata: JSON.parse(String(row.creation_metadata_json)), bookSets: bookSets.rows, sources: sources.rows, facts: facts.rows, reconciliations: reconciliations.rows, statusReasons: status === "CURRENT" ? [] : current.blockers.length ? current.blockers : ["SNAPSHOT_INPUTS_CHANGED"] };
}

export async function showTaxCaseFilingSnapshot(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string, snapshotId: string): Promise<Record<string, unknown>> {
  return sessionRunner.withBusinessSession("read", async (session) => storedSnapshot(session, tenantId, text(taxCaseId, "taxCaseId"), text(snapshotId, "snapshotId")));
}

export async function statusTaxCaseFilingSnapshot(sessionRunner: BusinessSessionRunner, tenantId: string, taxCaseId: string, snapshotId: string): Promise<Record<string, unknown>> {
  const result = await showTaxCaseFilingSnapshot(sessionRunner, tenantId, taxCaseId, snapshotId);
  return { snapshotId: result.snapshotId, tenantId: result.tenantId, taxCaseId: result.taxCaseId, status: result.status, statusReasons: result.statusReasons };
}

export async function sealTaxCaseFilingSnapshot(sessionRunner: BusinessSessionRunner, envelope: SealEnvelope): Promise<CommandResult<Record<string, unknown>>> {
  validateCommandEnvelope(envelope);
  if (envelope.actor.kind !== "HUMAN") throw new DomainError("FILING_SNAPSHOT_HUMAN_REQUIRED", "Only a HUMAN actor may seal a FilingSnapshot");
  const payload = normalizeSeal(envelope.payload); const requestHash = computeCommandHash(COMMAND, envelope, payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const prior = await replay(session, envelope.tenantId, envelope.requestId, requestHash);
    if (prior) {
      const decoded = JSON.parse(prior.resultJson) as { snapshotId?: string }; await audit(session, envelope, prior.resultHash, String(decoded.snapshotId ?? "unknown"), true); return prior;
    }
    const built = await buildCandidate(session, envelope.tenantId, payload.taxCaseId);
    if (built.preview.candidateHash !== payload.candidateHash) throw new DomainError("FILING_SNAPSHOT_CANDIDATE_CHANGED", "The supplied preview candidate no longer matches current TaxCase inputs", { expectedCandidateHash: built.preview.candidateHash, suppliedCandidateHash: payload.candidateHash });
    if (built.preview.blockers.length > 0) throw new DomainError("FILING_SNAPSHOT_BLOCKED", "FilingSnapshot cannot be sealed while blockers exist", { blockers: built.preview.blockers });
    const snapshotId = payload.snapshotId ?? randomUUID(); const now = new Date().toISOString(); const candidate = built.preview.candidate;
    const pan = candidate.pan as Record<string, unknown>; const membership = candidate.membership as Record<string, unknown>;
    await session.execute("INSERT INTO filing_snapshots (id, tenant_id, tax_case_id, membership_version_id, membership_version, membership_hash, pan_profile_id, pan_profile_version, pan_lookup_hash, pan_last_four, pan_masked_display, candidate_hash, candidate_json, creation_metadata_json, seal_request_id, seal_request_hash, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [snapshotId, envelope.tenantId, payload.taxCaseId, String(membership.versionId), Number(membership.version), String(membership.membershipHash), String(pan.profileId), String(pan.profileVersion), String(pan.lookupHash), String(pan.lastFour), String(pan.maskedDisplay), built.preview.candidateHash, canonicalJson(candidate), canonicalJson({ source: envelope.source, actorKind: envelope.actor.kind, actorId: envelope.actor.id, reason: envelope.reason, requestedAt: envelope.requestedAt ?? null }), envelope.requestId, requestHash, now, envelope.actor.id]);
    for (const bookSet of candidate.bookSets) await session.execute("INSERT INTO filing_snapshot_book_sets (id, snapshot_id, tenant_id, tax_case_id, membership_version_id, membership_version, book_set_id, book_set_kind, ledger_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), snapshotId, envelope.tenantId, payload.taxCaseId, String(membership.versionId), Number(membership.version), String(bookSet.bookSetId), String(bookSet.kind), Number(bookSet.ledgerRevision), now]);
    for (const source of candidate.sources) await session.execute("INSERT INTO filing_snapshot_sources (id, snapshot_id, tenant_id, tax_case_id, source_id, artifact_id, content_hash, source_status, parser_status, parser_identity, parser_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), snapshotId, envelope.tenantId, payload.taxCaseId, String(source.sourceId), String(source.artifactId), String(source.contentHash), String(source.sourceStatus), String((source.parser as Record<string, unknown>).status), String((source.parser as Record<string, unknown>).identity), String((source.parser as Record<string, unknown>).version), now]);
    for (const fact of candidate.facts) { const terminal = fact.terminalEvent as Record<string, unknown>; await session.execute("INSERT INTO filing_snapshot_facts (id, snapshot_id, tenant_id, tax_case_id, fact_id, source_id, artifact_id, normalized_payload_hash, lifecycle, terminal_event_id, terminal_event_type, terminal_event_hash, gross_amount_minor, allocated_amount_minor, reconciliation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), snapshotId, envelope.tenantId, payload.taxCaseId, String(fact.factId), String(fact.sourceId), String(fact.artifactId), String(fact.normalizedPayloadHash), String(fact.lifecycle), String(terminal.id), String(terminal.type), String(terminal.hash), Number(fact.grossAmountMinor), Number(fact.allocatedAmountMinor), String(fact.reconciliationStatus), now]); }
    for (const reconciliation of candidate.reconciliations) await session.execute("INSERT INTO filing_snapshot_reconciliations (id, snapshot_id, tenant_id, tax_case_id, reconciliation_id, fact_id, book_set_id, journal_line_id, allocated_amount_minor, currency, request_id, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), snapshotId, envelope.tenantId, payload.taxCaseId, String(reconciliation.reconciliationId), String(reconciliation.factId), String(reconciliation.bookSetId), String(reconciliation.journalLineId), Number(reconciliation.allocatedAmountMinor), String(reconciliation.currency), String(reconciliation.requestId), String(reconciliation.requestHash), now]);
    const result = { snapshotId, tenantId: envelope.tenantId, taxCaseId: payload.taxCaseId, status: "CURRENT", candidateHash: built.preview.candidateHash, createdAt: now, pan: { profileId: String(pan.profileId), profileVersion: String(pan.profileVersion), lastFour: String(pan.lastFour), maskedDisplay: String(pan.maskedDisplay) }, counts: { bookSets: candidate.bookSets.length, sources: candidate.sources.length, facts: candidate.facts.length, reconciliations: candidate.reconciliations.length } };
    const resultJson = canonicalJson(result); const resultHash = computeResultHash(resultJson); await audit(session, envelope, resultHash, snapshotId, false); await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]); return { resultJson, resultHash };
  });
}
