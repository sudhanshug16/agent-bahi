import { sqliteTable, text, integer, blob, foreignKey, primaryKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { tenants, bookSets } from "./foundation-schema";
import { journalLines } from "./ledger-schema";

/** Personal TaxCase foundation: live BookSet membership and ledger cursors only. */
export const bookSetLedgerRevisions = sqliteTable(
  "book_set_ledger_revisions",
  {
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    revision: integer("revision").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.bookSetId] }),
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    chkRevision: check("chk_book_set_ledger_revision", sql`typeof(${table.revision}) = 'integer' AND ${table.revision} >= 0`),
    idxBookSet: index("idx_book_set_ledger_revisions_book_set").on(table.tenantId, table.bookSetId),
  }),
);

export const taxCases = sqliteTable(
  "tax_cases",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    financialYear: text("financial_year").notNull(),
    taxPeriod: text("tax_period").notNull(),
    filingTrigger: text("filing_trigger").notNull(),
    caseSequence: integer("case_sequence").notNull().default(1),
    lifecycle: text("lifecycle").notNull().default("OPEN"),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    resultJson: text("result_json").notNull(),
    resultHash: text("result_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    uqScopeKey: uniqueIndex("uq_tax_cases_id_tenant").on(table.id, table.tenantId),
    uqIdentity: uniqueIndex("uq_tax_cases_identity").on(table.tenantId, table.financialYear, table.taxPeriod, table.filingTrigger, table.caseSequence),
    idxTenant: index("idx_tax_cases_tenant").on(table.tenantId, table.createdAt, table.id),
    chkLifecycle: check("chk_tax_case_lifecycle", sql`${table.lifecycle} IN ('OPEN', 'ARCHIVED')`),
    chkSequence: check("chk_tax_case_sequence", sql`typeof(${table.caseSequence}) = 'integer' AND ${table.caseSequence} >= 1`),
    chkFields: check("chk_tax_case_fields", sql`length(trim(${table.financialYear})) > 0 AND length(trim(${table.taxPeriod})) > 0 AND length(trim(${table.filingTrigger})) > 0`),
    chkHashes: check("chk_tax_case_hashes", sql`length(${table.requestHash}) = 64 AND ${table.requestHash} NOT GLOB '*[^0-9a-f]*' AND length(${table.resultHash}) = 64 AND ${table.resultHash} NOT GLOB '*[^0-9a-f]*'`),
  }),
);

export const taxCaseMembershipVersions = sqliteTable(
  "tax_case_membership_versions",
  {
    id: text("id").primaryKey(),
    taxCaseId: text("tax_case_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    version: integer("version").notNull(),
    membershipHash: text("membership_hash").notNull(),
    sealState: text("seal_state").notNull().default("OPEN"),
    membershipCount: integer("membership_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
    createdByActorId: text("created_by_actor_id").notNull(),
  },
  (table) => ({
    fkCase: foreignKey({ columns: [table.taxCaseId, table.tenantId], foreignColumns: [taxCases.id, taxCases.tenantId] }).onDelete("no action"),
    uqCaseVersion: uniqueIndex("uq_tax_case_membership_versions_case_version").on(table.taxCaseId, table.tenantId, table.version),
    uqScopeKey: uniqueIndex("uq_tax_case_membership_versions_id_scope").on(table.id, table.taxCaseId, table.tenantId),
    idxCase: index("idx_tax_case_membership_versions_case").on(table.tenantId, table.taxCaseId, table.version),
    chkVersion: check("chk_tax_case_membership_version", sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 1`),
    chkHash: check("chk_tax_case_membership_hash", sql`length(${table.membershipHash}) = 64 AND ${table.membershipHash} NOT GLOB '*[^0-9a-f]*'`),
    chkSealState: check("chk_tax_case_membership_seal_state", sql`${table.sealState} IN ('OPEN', 'SEALED')`),
    chkMembershipCount: check("chk_tax_case_membership_count", sql`typeof(${table.membershipCount}) = 'integer' AND ${table.membershipCount} >= 0`),
  }),
);

export const taxCaseMemberships = sqliteTable(
  "tax_case_memberships",
  {
    id: text("id").primaryKey(),
    taxCaseId: text("tax_case_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    membershipVersionId: text("membership_version_id").notNull(),
    version: integer("version").notNull(),
    bookSetId: text("book_set_id").notNull(),
    ledgerRevision: integer("ledger_revision").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkVersion: foreignKey({ columns: [table.membershipVersionId, table.taxCaseId, table.tenantId], foreignColumns: [taxCaseMembershipVersions.id, taxCaseMembershipVersions.taxCaseId, taxCaseMembershipVersions.tenantId] }).onDelete("no action"),
    fkVersionNumber: foreignKey({ columns: [table.taxCaseId, table.tenantId, table.version], foreignColumns: [taxCaseMembershipVersions.taxCaseId, taxCaseMembershipVersions.tenantId, taxCaseMembershipVersions.version] }).onDelete("no action"),
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    fkRevision: foreignKey({ columns: [table.tenantId, table.bookSetId], foreignColumns: [bookSetLedgerRevisions.tenantId, bookSetLedgerRevisions.bookSetId] }).onDelete("no action"),
    uqMember: uniqueIndex("uq_tax_case_membership_book_set").on(table.taxCaseId, table.tenantId, table.version, table.bookSetId),
    uqScopeKey: uniqueIndex("uq_tax_case_membership_id_scope").on(table.id, table.taxCaseId, table.tenantId),
    idxCase: index("idx_tax_case_memberships_case").on(table.tenantId, table.taxCaseId, table.version, table.bookSetId),
    chkVersion: check("chk_tax_case_membership_row_version", sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 1`),
    chkRevision: check("chk_tax_case_membership_ledger_revision", sql`typeof(${table.ledgerRevision}) = 'integer' AND ${table.ledgerRevision} >= 0`),
  }),
);

export const personalTaxSourceArtifacts = sqliteTable(
  "personal_tax_source_artifacts",
  {
    tenantId: text("tenant_id").notNull(),
    contentHash: text("content_hash").notNull(),
    id: text("id").notNull(),
    bytes: blob("bytes", { mode: "buffer" }).notNull(),
    byteSize: integer("byte_size").notNull(),
    mediaType: text("media_type").notNull(),
    originalFilename: text("original_filename").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.contentHash] }),
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    uqScopeKey: uniqueIndex("uq_personal_tax_source_artifacts_id_scope").on(table.id, table.tenantId),
    chkHash: check("chk_personal_tax_source_artifact_hash", sql`length(${table.contentHash}) = 64 AND ${table.contentHash} NOT GLOB '*[^0-9a-f]*'`),
    chkSize: check("chk_personal_tax_source_artifact_size", sql`typeof(${table.byteSize}) = 'integer' AND ${table.byteSize} > 0`),
    chkMetadata: check("chk_personal_tax_source_artifact_metadata", sql`length(trim(${table.mediaType})) > 0 AND length(trim(${table.originalFilename})) > 0`),
    idxTenant: index("idx_personal_tax_source_artifacts_tenant").on(table.tenantId, table.createdAt, table.contentHash),
  }),
);

export const taxCaseExternalSources = sqliteTable(
  "tax_case_external_sources",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    taxCaseId: text("tax_case_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourcePeriod: text("source_period"),
    sourceAsOf: text("source_as_of"),
    parserIdentity: text("parser_identity").notNull(),
    parserVersion: text("parser_version").notNull(),
    parserStatus: text("parser_status").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkCase: foreignKey({ columns: [table.taxCaseId, table.tenantId], foreignColumns: [taxCases.id, taxCases.tenantId] }).onDelete("no action"),
    uqScopeKey: uniqueIndex("uq_tax_case_external_sources_id_scope").on(table.id, table.taxCaseId, table.tenantId),
    idxCase: index("idx_tax_case_external_sources_case").on(table.tenantId, table.taxCaseId, table.createdAt, table.id),
    chkKind: check("chk_tax_case_external_source_kind", sql`${table.sourceKind} IN ('AIS', 'TIS', 'FORM_26AS', 'OTHER')`),
    chkParserStatus: check("chk_tax_case_external_source_parser_status", sql`${table.parserStatus} IN ('UNPARSED', 'UNSUPPORTED', 'PARSED')`),
    chkStatus: check("chk_tax_case_external_source_status", sql`${table.status} IN ('STORED', 'INCOMPLETE', 'READY')`),
    chkParserIdentity: check("chk_tax_case_external_source_parser_identity", sql`length(trim(${table.parserIdentity})) > 0 AND length(trim(${table.parserVersion})) > 0`),
  }),
);

export const taxCaseSourceArtifacts = sqliteTable(
  "tax_case_source_artifacts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    taxCaseId: text("tax_case_id").notNull(),
    sourceId: text("source_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkSource: foreignKey({ columns: [table.sourceId, table.taxCaseId, table.tenantId], foreignColumns: [taxCaseExternalSources.id, taxCaseExternalSources.taxCaseId, taxCaseExternalSources.tenantId] }).onDelete("no action"),
    fkArtifact: foreignKey({ columns: [table.artifactId, table.tenantId], foreignColumns: [personalTaxSourceArtifacts.id, personalTaxSourceArtifacts.tenantId] }).onDelete("no action"),
    fkArtifactHash: foreignKey({ columns: [table.tenantId, table.contentHash], foreignColumns: [personalTaxSourceArtifacts.tenantId, personalTaxSourceArtifacts.contentHash] }).onDelete("no action"),
    uqSourceArtifact: uniqueIndex("uq_tax_case_source_artifacts_source_hash").on(table.sourceId, table.tenantId, table.contentHash),
    uqScopeKey: uniqueIndex("uq_tax_case_source_artifacts_id_scope").on(table.id, table.taxCaseId, table.tenantId),
    idxCase: index("idx_tax_case_source_artifacts_case").on(table.tenantId, table.taxCaseId, table.createdAt, table.id),
    chkHash: check("chk_tax_case_source_artifact_hash", sql`length(${table.contentHash}) = 64 AND ${table.contentHash} NOT GLOB '*[^0-9a-f]*'`),
  }),
);

export const taxCaseFacts = sqliteTable(
  "tax_case_facts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    taxCaseId: text("tax_case_id").notNull(),
    sourceId: text("source_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    sourceRecordKey: text("source_record_key"),
    sourceOrdinal: integer("source_ordinal"),
    kind: text("kind").notNull(),
    rawSourceLabel: text("raw_source_label").notNull(),
    rawSourceLocator: text("raw_source_locator").notNull(),
    eventDate: text("event_date").notNull(),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    originalCurrency: text("original_currency").notNull(),
    grossAmountMinor: integer("gross_amount_minor").notNull(),
    taxAmountMinor: integer("tax_amount_minor"),
    counterpartyDisplayJson: text("counterparty_display_json"),
    parserIdentity: text("parser_identity").notNull(),
    parserVersion: text("parser_version").notNull(),
    provenanceJson: text("provenance_json").notNull(),
    normalizedPayloadHash: text("normalized_payload_hash").notNull(),
    supersedesFactId: text("supersedes_fact_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkSource: foreignKey({ columns: [table.sourceId, table.taxCaseId, table.tenantId], foreignColumns: [taxCaseExternalSources.id, taxCaseExternalSources.taxCaseId, taxCaseExternalSources.tenantId] }).onDelete("no action"),
    fkArtifact: foreignKey({ columns: [table.artifactId, table.tenantId], foreignColumns: [personalTaxSourceArtifacts.id, personalTaxSourceArtifacts.tenantId] }).onDelete("no action"),
    fkSupersedes: foreignKey({ columns: [table.supersedesFactId, table.tenantId, table.taxCaseId], foreignColumns: [table.id, table.tenantId, table.taxCaseId] }).onDelete("no action"),
    uqScopeKey: uniqueIndex("uq_tax_case_facts_id_scope").on(table.id, table.tenantId, table.taxCaseId),
    uqPayload: uniqueIndex("uq_tax_case_fact_source_payload").on(table.tenantId, table.taxCaseId, table.sourceId, table.artifactId, table.sourceRecordKey, table.sourceOrdinal, table.normalizedPayloadHash),
    idxCase: index("idx_tax_case_facts_case").on(table.tenantId, table.taxCaseId, table.createdAt, table.id),
    idxSourceKey: index("idx_tax_case_facts_source_key").on(table.tenantId, table.sourceId, table.sourceRecordKey, table.sourceOrdinal),
    chkKind: check("chk_tax_case_fact_kind", sql`${table.kind} IN ('TDS_CREDIT', 'TCS_CREDIT', 'TAX_PAYMENT', 'BUSINESS_RECEIPT', 'INTEREST_INCOME', 'DIVIDEND_INCOME', 'SECURITIES_TRANSACTION', 'RENT_INCOME', 'OTHER')`),
    chkIdentity: check("chk_tax_case_fact_identity", sql`((source_record_key IS NOT NULL AND length(trim(source_record_key)) > 0 AND source_ordinal IS NULL) OR (source_record_key IS NULL AND source_ordinal IS NOT NULL AND typeof(source_ordinal) = 'integer' AND source_ordinal >= 0))`),
    chkAmount: check("chk_tax_case_fact_amounts", sql`typeof(gross_amount_minor) = 'integer' AND gross_amount_minor >= 0 AND (tax_amount_minor IS NULL OR (typeof(tax_amount_minor) = 'integer' AND tax_amount_minor >= 0))`),
    chkHash: check("chk_tax_case_fact_payload_hash", sql`length(normalized_payload_hash) = 64 AND normalized_payload_hash NOT GLOB '*[^0-9a-f]*'`),
    chkCurrency: check("chk_tax_case_fact_currency", sql`length(original_currency) = 3 AND original_currency = upper(original_currency)`),
  }),
);

export const taxCaseFactEvents = sqliteTable(
  "tax_case_fact_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    taxCaseId: text("tax_case_id").notNull(),
    factId: text("fact_id").notNull(),
    eventType: text("event_type").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    reason: text("reason").notNull(),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkFact: foreignKey({ columns: [table.factId, table.tenantId, table.taxCaseId], foreignColumns: [taxCaseFacts.id, taxCaseFacts.tenantId, taxCaseFacts.taxCaseId] }).onDelete("no action"),
    uqRequest: uniqueIndex("uq_tax_case_fact_events_request").on(table.tenantId, table.requestId),
    idxFact: index("idx_tax_case_fact_events_fact").on(table.tenantId, table.taxCaseId, table.factId, table.createdAt, table.id),
    chkType: check("chk_tax_case_fact_event_type", sql`${table.eventType} IN ('PROPOSED', 'HUMAN_CONFIRMED', 'REJECTED')`),
    chkActor: check("chk_tax_case_fact_event_actor", sql`length(trim(actor_id)) > 0 AND (event_type = 'PROPOSED' OR actor_kind = 'HUMAN')`),
    chkHash: check("chk_tax_case_fact_event_hash", sql`length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'`),
  }),
);

export const taxCaseFactReconciliations = sqliteTable(
  "tax_case_fact_reconciliations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    taxCaseId: text("tax_case_id").notNull(),
    factId: text("fact_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    journalLineId: text("journal_line_id").notNull(),
    allocatedAmountMinor: integer("allocated_amount_minor").notNull(),
    currency: text("currency").notNull(),
    reason: text("reason").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkFact: foreignKey({ columns: [table.factId, table.tenantId, table.taxCaseId], foreignColumns: [taxCaseFacts.id, taxCaseFacts.tenantId, taxCaseFacts.taxCaseId] }).onDelete("no action"),
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    fkJournalLine: foreignKey({ columns: [table.journalLineId, table.tenantId, table.bookSetId], foreignColumns: [journalLines.id, journalLines.tenantId, journalLines.bookSetId] }).onDelete("no action"),
    uqRequest: uniqueIndex("uq_tax_case_fact_reconciliations_request").on(table.tenantId, table.requestId),
    idxFact: index("idx_tax_case_fact_reconciliations_fact").on(table.tenantId, table.taxCaseId, table.factId, table.createdAt, table.id),
    idxTarget: index("idx_tax_case_fact_reconciliations_target").on(table.tenantId, table.bookSetId, table.journalLineId),
    chkAmount: check("chk_tax_case_fact_reconciliation_amount", sql`typeof(allocated_amount_minor) = 'integer' AND allocated_amount_minor > 0`),
    chkCurrency: check("chk_tax_case_fact_reconciliation_currency", sql`length(currency) = 3 AND currency = upper(currency)`),
    chkActor: check("chk_tax_case_fact_reconciliation_actor", sql`${table.actorKind} = 'HUMAN' AND length(trim(actor_id)) > 0`),
    chkHash: check("chk_tax_case_fact_reconciliation_hash", sql`length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'`),
  }),
);
