import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { tenants, bookSets, accounts } from "./foundation-schema";
import { parties, salesInvoices } from "./sales-schema";
import { vendorBills } from "./purchase-schema";
import { journalEntries } from "./ledger-schema";

/**
 * TDS/TCS V1 deliberately stores only caller- and source-verified facts.
 * Rates, thresholds, forms, and timing are never inferred by this schema.
 */
export const tenantDeductorProfiles = sqliteTable(
  "tenant_deductor_profiles",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    pan: text("pan"),
    tan: text("tan"),
    verificationStatus: text("verification_status").notNull(),
    evidenceReference: text("evidence_reference"),
    tanExceptionFact: text("tan_exception_fact"),
    tanExceptionReason: text("tan_exception_reason"),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    uqScope: uniqueIndex("uq_tenant_deductor_profiles_scope_key").on(table.id, table.tenantId),
    idxEffective: index("idx_tenant_deductor_profiles_effective").on(table.tenantId, table.effectiveFrom, table.id),
    chkStatus: check("chk_tenant_deductor_profile_status", sql`${table.verificationStatus} IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')`),
    chkPan: check("chk_tenant_deductor_profile_pan", sql`${table.pan} IS NULL OR ${table.pan} GLOB '[A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z]'`),
    chkTan: check("chk_tenant_deductor_profile_tan", sql`${table.tan} IS NULL OR ${table.tan} GLOB '[A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][0-9][A-Z]'`),
    chkEvidence: check("chk_tenant_deductor_profile_evidence", sql`${table.verificationStatus} = 'UNVERIFIED' OR length(COALESCE(${table.evidenceReference}, '')) > 0`),
    chkException: check("chk_tenant_deductor_profile_tan_exception", sql`(${table.tanExceptionFact} IS NULL AND ${table.tanExceptionReason} IS NULL) OR (${table.tanExceptionFact} IS NOT NULL AND length(${table.tanExceptionFact}) > 0 AND ${table.tanExceptionReason} IS NOT NULL AND length(${table.tanExceptionReason}) > 0)`),
  }),
);

export const partyTaxProfiles = sqliteTable(
  "party_tax_profiles",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    partyId: text("party_id").notNull(),
    residency: text("residency").notNull(),
    pan: text("pan"),
    verificationStatus: text("verification_status").notNull(),
    evidenceReference: text("evidence_reference"),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    fkParty: foreignKey({ columns: [table.partyId, table.tenantId, table.bookSetId], foreignColumns: [parties.id, parties.tenantId, parties.bookSetId] }).onDelete("no action"),
    uqScope: uniqueIndex("uq_party_tax_profiles_scope_key").on(table.id, table.tenantId, table.bookSetId),
    idxEffective: index("idx_party_tax_profiles_effective").on(table.tenantId, table.bookSetId, table.partyId, table.effectiveFrom, table.id),
    chkResidency: check("chk_party_tax_profile_residency", sql`${table.residency} IN ('RESIDENT', 'NON_RESIDENT')`),
    chkStatus: check("chk_party_tax_profile_status", sql`${table.verificationStatus} IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')`),
    chkPan: check("chk_party_tax_profile_pan", sql`${table.pan} IS NULL OR ${table.pan} GLOB '[A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z]'`),
    chkEvidence: check("chk_party_tax_profile_evidence", sql`${table.verificationStatus} = 'UNVERIFIED' OR length(COALESCE(${table.evidenceReference}, '')) > 0`),
  }),
);

export const taxRuleSnapshots = sqliteTable(
  "tax_rule_snapshots",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    taxKind: text("tax_kind").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceDocument: text("source_document").notNull(),
    sourceVersion: text("source_version").notNull(),
    sectionReference: text("section_reference").notNull(),
    tableReference: text("table_reference"),
    categoryCode: text("category_code").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    eventTiming: text("event_timing").notNull(),
    rateBps: integer("rate_bps").notNull(),
    thresholdMinor: integer("threshold_minor"),
    applicabilityFactsJson: text("applicability_facts_json").notNull(),
    tanRequired: integer("tan_required", { mode: "boolean" }).notNull(),
    tanExceptionAllowed: integer("tan_exception_allowed", { mode: "boolean" }).notNull(),
    statementRoute: text("statement_route").notNull(),
    statementForm: text("statement_form").notNull(),
    certificateForm: text("certificate_form"),
    roundingMode: text("rounding_mode").notNull(),
    sourceVerified: integer("source_verified", { mode: "boolean" }).notNull(),
    canonicalFactsJson: text("canonical_facts_json").notNull(),
    canonicalHash: text("canonical_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    uqScope: uniqueIndex("uq_tax_rule_snapshots_scope_key").on(table.id, table.tenantId),
    idxEffective: index("idx_tax_rule_snapshots_effective").on(table.tenantId, table.taxKind, table.categoryCode, table.effectiveFrom, table.id),
    chkKind: check("chk_tax_rule_snapshot_kind", sql`${table.taxKind} IN ('TDS', 'TCS')`),
    chkTiming: check("chk_tax_rule_snapshot_timing", sql`${table.eventTiming} IN ('CREDIT', 'PAYMENT')`),
    chkRate: check("chk_tax_rule_snapshot_rate", sql`typeof(${table.rateBps}) = 'integer' AND ${table.rateBps} >= 0 AND ${table.rateBps} <= 10000`),
    chkThreshold: check("chk_tax_rule_snapshot_threshold", sql`${table.thresholdMinor} IS NULL OR (typeof(${table.thresholdMinor}) = 'integer' AND ${table.thresholdMinor} >= 0)`),
    chkRounding: check("chk_tax_rule_snapshot_rounding", sql`${table.roundingMode} IN ('HALF_UP')`),
    chkSource: check("chk_tax_rule_snapshot_source", sql`${table.sourceUrl} GLOB 'https://*'`),
  }),
);

export const withholdingEvents = sqliteTable(
  "withholding_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    taxKind: text("tax_kind").notNull(),
    documentType: text("document_type").notNull(),
    documentId: text("document_id").notNull(),
    ruleSnapshotId: text("rule_snapshot_id").notNull(),
    eventDate: text("event_date").notNull(),
    taxBaseMinor: integer("tax_base_minor").notNull(),
    taxAmountMinor: integer("tax_amount_minor").notNull(),
    rateBps: integer("rate_bps").notNull(),
    roundingMode: text("rounding_mode").notNull(),
    liabilityAccountId: text("liability_account_id").notNull(),
    thresholdEvidenceJson: text("threshold_evidence_json").notNull(),
    calculationFactsJson: text("calculation_facts_json").notNull(),
    ruleCanonicalHash: text("rule_canonical_hash").notNull(),
    journalId: text("journal_id").notNull(),
    status: text("status").notNull(),
    reversalOfEventId: text("reversal_of_event_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    fkRule: foreignKey({ columns: [table.ruleSnapshotId, table.tenantId], foreignColumns: [taxRuleSnapshots.id, taxRuleSnapshots.tenantId] }).onDelete("no action"),
    fkAccount: foreignKey({ columns: [table.liabilityAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
    fkJournal: foreignKey({ columns: [table.journalId, table.tenantId, table.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }).onDelete("no action"),
    uqDocument: uniqueIndex("uq_withholding_events_document_kind").on(table.tenantId, table.bookSetId, table.taxKind, table.documentType, table.documentId),
    uqScope: uniqueIndex("uq_withholding_events_scope_key").on(table.id, table.tenantId, table.bookSetId),
    idxRegister: index("idx_withholding_events_register").on(table.tenantId, table.bookSetId, table.taxKind, table.eventDate, table.id),
    chkKind: check("chk_withholding_event_kind", sql`${table.taxKind} IN ('TDS', 'TCS')`),
    chkDocument: check("chk_withholding_event_document", sql`${table.documentType} IN ('PURCHASE', 'SALE')`),
    chkAmounts: check("chk_withholding_event_amounts", sql`typeof(${table.taxBaseMinor}) = 'integer' AND ${table.taxBaseMinor} > 0 AND typeof(${table.taxAmountMinor}) = 'integer' AND ${table.taxAmountMinor} >= 0`),
    chkStatus: check("chk_withholding_event_status", sql`${table.status} IN ('POSTED', 'REVERSED', 'CORRECTED')`),
  }),
);

export const withholdingDeposits = sqliteTable(
  "withholding_deposits",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    taxKind: text("tax_kind").notNull(),
    liabilityAccountId: text("liability_account_id").notNull(),
    bankAccountId: text("bank_account_id").notNull(),
    depositDate: text("deposit_date").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    cin: text("cin"),
    bsrCode: text("bsr_code"),
    challanDate: text("challan_date"),
    serialNumber: text("serial_number"),
    evidenceReference: text("evidence_reference"),
    journalId: text("journal_id").notNull(),
    reversalOfDepositId: text("reversal_of_deposit_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    fkLiability: foreignKey({ columns: [table.liabilityAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
    fkBank: foreignKey({ columns: [table.bankAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
    fkJournal: foreignKey({ columns: [table.journalId, table.tenantId, table.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }).onDelete("no action"),
    uqScope: uniqueIndex("uq_withholding_deposits_scope_key").on(table.id, table.tenantId, table.bookSetId),
    idxRegister: index("idx_withholding_deposits_register").on(table.tenantId, table.bookSetId, table.taxKind, table.depositDate, table.id),
    chkKind: check("chk_withholding_deposit_kind", sql`${table.taxKind} IN ('TDS', 'TCS')`),
    chkAmount: check("chk_withholding_deposit_amount", sql`typeof(${table.amountMinor}) = 'integer' AND ${table.amountMinor} > 0`),
  }),
);

export const withholdingDepositAllocations = sqliteTable(
  "withholding_deposit_allocations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    depositId: text("deposit_id").notNull(),
    eventId: text("event_id").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkDeposit: foreignKey({ columns: [table.depositId, table.tenantId, table.bookSetId], foreignColumns: [withholdingDeposits.id, withholdingDeposits.tenantId, withholdingDeposits.bookSetId] }).onDelete("no action"),
    fkEvent: foreignKey({ columns: [table.eventId, table.tenantId, table.bookSetId], foreignColumns: [withholdingEvents.id, withholdingEvents.tenantId, withholdingEvents.bookSetId] }).onDelete("no action"),
    uqEvent: uniqueIndex("uq_withholding_deposit_allocation_event").on(table.depositId, table.eventId),
    idxEvent: index("idx_withholding_deposit_allocations_event").on(table.tenantId, table.bookSetId, table.eventId),
    chkAmount: check("chk_withholding_deposit_allocation_amount", sql`typeof(${table.amountMinor}) = 'integer' AND ${table.amountMinor} > 0`),
  }),
);

export const withholdingComplianceCases = sqliteTable(
  "withholding_compliance_cases",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    taxKind: text("tax_kind").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    state: text("state").notNull(),
    governmentAcknowledgement: text("government_acknowledgement"),
    evidenceReference: text("evidence_reference"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    uqPeriod: uniqueIndex("uq_withholding_compliance_case_period").on(table.tenantId, table.bookSetId, table.taxKind, table.periodStart, table.periodEnd),
    chkKind: check("chk_withholding_case_kind", sql`${table.taxKind} IN ('TDS', 'TCS')`),
    chkState: check("chk_withholding_case_state", sql`${table.state} IN ('PREPARED', 'EXPORTED', 'SUBMITTED', 'ACCEPTED', 'REJECTED')`),
    chkAck: check("chk_withholding_case_ack", sql`${table.state} NOT IN ('SUBMITTED', 'ACCEPTED') OR (length(COALESCE(${table.governmentAcknowledgement}, '')) > 0 AND length(COALESCE(${table.evidenceReference}, '')) > 0)`),
  }),
);
