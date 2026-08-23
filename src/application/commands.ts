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
export type TaxCaseCommandAction = "tax-case.create" | "tax-case.membership.refresh" | "tax-case.source.import" | "tax-case.fact.propose" | "tax-case.fact.confirm" | "tax-case.fact.reject" | "tax-case.reconciliation.record" | "tax-case.filing-snapshot.seal" | "tax-case.position.generate" | "tax-authority.pack.register" | "tax-authority.pack.verify" | "tax-authority.pack.reject" | "tax-case.eligibility-facts.record" | "tax-case.itr-eligibility.evaluate" | "tax-case.itr-form.select" | "tax-authority.computation-pack.register" | "tax-authority.computation-pack.verify" | "tax-authority.computation-pack.reject" | "tax-case.computation-inputs.record" | "tax-case.computation.generate" | "tax-case.computation.approve" | "tax-authority.return-schema-pack.register" | "tax-authority.return-schema-pack.verify" | "tax-authority.return-schema-pack.reject" | "tax-case.return-artifact.prepare" | "tax-case.return-artifact.validate" | "tax-case.return-artifact.export";

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

export type ItrEligibilityValueType = "BOOLEAN" | "STRING" | "INTEGER_MINOR";
export type ItrEligibilityProvenanceKind = "WORKSHEET_DERIVED" | "HUMAN_ASSERTION" | "AGENT_ASSERTION";
export interface AuthorityArtifactReference { kind: "LAW" | "RULES" | "SCHEMA" | "INSTRUCTION"; sourceUrl: string; sourceTitle: string; officialReleaseIdentifier: string; officialReleaseDate: string; sha256: string; }
export interface AuthorityPackRegisterPayload {
  packId?: string; jurisdiction: "IN"; authority: "INCOME_TAX"; financialYear: string; assessmentYear: string; filingTypes: string[];
  effectiveFrom: string; effectiveTo?: string; releasedAt: string; releaseIdentifier: string; artifactReferences: AuthorityArtifactReference[];
  packVersion: string; candidateForms: string[]; ruleAst: unknown; canonicalHash?: string; supersedesPackId?: string;
}
export interface AuthorityPackDecisionPayload { packId: string; expectedPackHash: string; reason: string; }
export interface TaxCaseEligibilityFactRecordPayload {
  taxCaseId: string; filingSnapshotId: string; worksheetId: string; snapshotCandidateHash: string; worksheetOutputHash: string;
  fieldName: string; valueType: ItrEligibilityValueType; value: boolean | string; provenanceKind: ItrEligibilityProvenanceKind; provenance?: Record<string, unknown>; factId?: string;
}
export interface TaxCaseItrEligibilityEvaluatePayload { taxCaseId: string; filingSnapshotId: string; worksheetId: string; packId: string; }
export interface TaxCaseItrFormSelectPayload { taxCaseId: string; evaluationId: string; expectedEvaluationHash: string; selectedForm: string; }

export type ComputationValueType = "INTEGER_MINOR" | "BOOLEAN" | "STRING";
export type ComputationRounding = "DOWN" | "UP" | "HALF_UP";
export interface ComputationDeclaredInput { name: string; valueType: ComputationValueType; required?: boolean; }
export interface ComputationPackRegisterPayload {
  packId?: string; authorityPackId: string; authorityPackHash: string; financialYear: string; assessmentYear: string; itrForm: string;
  packVersion: string; provenanceArtifacts: AuthorityArtifactReference[]; declaredInputs: ComputationDeclaredInput[];
  namedSchedules: string[]; program: unknown; canonicalHash?: string; supersedesPackId?: string;
}
export interface ComputationPackDecisionPayload { packId: string; expectedPackHash: string; reason: string; }
export interface ComputationInputsRecordPayload {
  taxCaseId: string; filingSnapshotId: string; worksheetId: string; evaluationId: string; selectionId?: string; computationPackId: string;
  inputs: Record<string, { valueType: ComputationValueType; value: string | boolean; provenance: Record<string, unknown>; verified: boolean }>;
}
export interface ComputationPreviewPayload extends ComputationInputsRecordPayload { inputSetId?: string; }
export interface ComputationGeneratePayload extends ComputationInputsRecordPayload { requestId?: never; }
export interface ComputationApprovePayload { taxCaseId: string; computationId: string; expectedComputationHash: string; reason: string; }

export type ReturnSchemaIntegerEncoding = "DECIMAL_STRING" | "SAFE_JSON_INTEGER";
export interface ReturnSchemaPackRegisterPayload {
  packId?: string; authorityPackId: string; authorityPackHash: string; itrForm: string; filingType: string;
  financialYear: string; assessmentYear: string; artifactReferences: AuthorityArtifactReference[]; packVersion: string;
  validationSchema: unknown; mappingSpec: unknown; supersedesPackId?: string;
}
export interface ReturnSchemaPackDecisionPayload { packId: string; expectedPackHash: string; reason: string; }
export interface ReturnArtifactBindingPayload {
  taxCaseId: string; filingSnapshotId: string; worksheetId: string; evaluationId: string; selectionId: string;
  computationId: string; schemaPackId: string;
}
export interface ReturnArtifactValidatePayload { taxCaseId: string; artifactId: string; expectedArtifactHash: string; }
export interface ReturnArtifactExportPayload { taxCaseId: string; artifactId: string; expectedArtifactHash: string; expectedValidationHash: string; }

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
