/**
 * Versioned command types for BookSet and Tenant mutations.
 * Provides stable request/response envelopes with audit traceability.
 */
import { randomUUID } from "crypto";
import { createHash } from "node:crypto";
import type { TenantId, BookSetId } from "../core/types.ts";

export type ActorKind = "HUMAN" | "AGENT" | "SYSTEM";
export type CommandSource = "CLI" | "MCP" | "INTERNAL" | "IMPORT";
export type BookSetCommandAction = "bookset.create" | "bookset.set-default" | "bookset.archive" | "tenant.activate";
export type TenantCommandAction = "tenant.create";
export type TenantPanCommandAction = "tenant.pan.set";
export type TaxCaseCommandAction = "tax-case.create" | "tax-case.membership.refresh" | "tax-case.source.import" | "tax-case.fact.propose" | "tax-case.fact.confirm" | "tax-case.fact.reject" | "tax-case.reconciliation.record" | "tax-case.filing-snapshot.seal" | "tax-case.position.generate";

export interface Actor {
  kind: ActorKind;
  id: string;
}

export interface CommandEnvelope<T> {
  schemaVersion: 1;
  tenantId: TenantId;
  requestId: string;
  actor: Actor;
  source: CommandSource;
  reason: string;
  requestedAt?: string;
  payload: T;
}

export interface BookSetCreatePayload {
  kind: "COMPANY" | "PERSONAL" | "PROPRIETORSHIP";
  displayName: string;
}

export interface BookSetSetDefaultPayload {
  bookSetId: BookSetId;
}

export interface BookSetArchivePayload {
  bookSetId: BookSetId;
}

export interface TenantActivatePayload {
  defaultBookSetId: BookSetId;
}

export interface TenantCreatePayload {
  kind: "COMPANY" | "INDIVIDUAL";
  name: string;
  baseCurrency?: string;
}

export interface TenantPanSetPayload {
  pan: string;
  expectedCurrentHash?: string;
  reason?: string;
  confirm?: boolean;
}

export interface TaxCaseCreatePayload {
  taxCaseId: string;
  financialYear: string;
  taxPeriod: string;
  filingTrigger: string;
  caseSequence?: number;
  bookSetIds: string[];
}

export interface TaxCaseMembershipRefreshPayload {
  taxCaseId: string;
  bookSetIds?: string[];
}

export type TaxCaseSourceKind = "AIS" | "TIS" | "FORM_26AS" | "OTHER";

export interface TaxCaseSourceImportPayload {
  taxCaseId: string;
  sourceKind: TaxCaseSourceKind;
  sourcePeriod?: string;
  sourceAsOf?: string;
  mediaType: string;
  originalFilename: string;
  filePath?: string;
  contentBase64?: string;
}

export type TaxCaseFactKind = "TDS_CREDIT" | "TCS_CREDIT" | "TAX_PAYMENT" | "BUSINESS_RECEIPT" | "INTEREST_INCOME" | "DIVIDEND_INCOME" | "SECURITIES_TRANSACTION" | "RENT_INCOME" | "OTHER";

export interface TaxCaseFactProposePayload {
  taxCaseId: string;
  sourceId: string;
  artifactId: string;
  factId?: string;
  sourceRecordKey?: string;
  sourceOrdinal?: number;
  kind: TaxCaseFactKind;
  rawSourceLabel: string;
  rawSourceLocator: string;
  eventDate: string;
  periodStart?: string;
  periodEnd?: string;
  originalCurrency: string;
  grossAmountMinor: number;
  taxAmountMinor?: number;
  counterpartyDisplay?: Record<string, unknown>;
  parserIdentity: string;
  parserVersion: string;
  provenance?: Record<string, unknown>;
  normalizedPayload?: unknown;
  normalizedPayloadHash?: string;
  supersedesFactId?: string;
}

export interface TaxCaseFactDecisionPayload { taxCaseId: string; factId: string; reason: string; }

export interface TaxCaseReconciliationRecordPayload {
  taxCaseId: string;
  factId: string;
  bookSetId: string;
  journalLineId: string;
  allocatedAmountMinor: number;
  currency: string;
  reason: string;
}

export interface TaxCaseFilingSnapshotSealPayload { taxCaseId: string; candidateHash: string; snapshotId?: string; }
export interface TaxCasePositionGeneratePayload { taxCaseId: string; filingSnapshotId: string; }

export type TaxCaseSourceAssessmentExtractionMode = "MACHINE" | "AGENT_ASSISTED" | "MANUAL";
export type TaxCaseSourceAssessmentOutcome = "FACTS_PRESENT" | "EMPTY";
export interface TaxCaseSourceAssessmentPreparePayload {
  taxCaseId: string; sourceId: string; artifactId: string; contentHash: string; parserIdentity: string; parserVersion: string; modelDescriptor?: string;
  extractionMode: TaxCaseSourceAssessmentExtractionMode; sourceKind: TaxCaseSourceKind; sourcePeriod?: string; sourceAsOf?: string;
  recordCount?: number; pageCount?: number; sectionCount?: number; coverage?: Record<string, unknown>; factIds: string[]; issues?: unknown[]; warnings?: unknown[];
  outcomeCandidate: TaxCaseSourceAssessmentOutcome; supersedesAssessmentId?: string; assessmentId?: string;
}
export interface TaxCaseSourceAssessmentDecisionPayload { taxCaseId: string; sourceId: string; assessmentId: string; expectedAssessmentHash: string; reason: string; }

export interface CommandResult<T> {
  resultJson: string;
  resultHash: string;
  replayed?: boolean;
}

/**
 * Canonicalizes command data for deterministic hashing.
 * Sorted keys, no whitespace, consistent type representation.
 */
export function canonicalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeValue(entry)])
    );
  }
  return value;
}

export function canonicalJson(obj: unknown): string {
  return JSON.stringify(canonicalizeValue(obj));
}

export function computeCommandHash(command: string, envelope: CommandEnvelope<unknown>, payload: unknown): string {
  const scopedEnvelope = envelope as CommandEnvelope<unknown> & { bookSetId?: string };
  const normalized = {
    schemaVersion: envelope.schemaVersion,
    command,
    tenantId: envelope.tenantId,
    bookSetId: scopedEnvelope.bookSetId,
    requestId: envelope.requestId,
    actor: canonicalizeValue(envelope.actor),
    source: envelope.source,
    reason: envelope.reason,
    requestedAt: envelope.requestedAt,
    payload: canonicalizeValue(payload),
  };
  const json = canonicalJson(normalized);
  return createHash("sha256").update(json).digest("hex");
}

export function computeResultHash(resultJson: string): string {
  return createHash("sha256").update(resultJson).digest("hex");
}
