import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { bookSets, evidence, gstRegistrations } from "./foundation-schema";
import { salesInvoices, salesInvoiceLines } from "./sales-schema";

/** GST return-readiness source facts, snapshots, review artifacts, and observations. */
export const gstOutwardFacts = sqliteTable("gst_outward_facts", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), invoiceId: text("invoice_id").notNull(), createdAt: text("created_at").notNull(), placeOfSupplyStateCode: text("place_of_supply_state_code"), recipientRegistrationCategory: text("recipient_registration_category"), recipientCategorySnapshot: text("recipient_category_snapshot"), reverseChargeApplicable: integer("reverse_charge_applicable").notNull().default(0), ecommerceGstin: text("ecommerce_gstin"), narration: text("narration"),
}, (t) => ({
  fkBookSet: foreignKey({ columns: [t.bookSetId, t.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }),
  fkInvoice: foreignKey({ columns: [t.invoiceId, t.tenantId, t.bookSetId], foreignColumns: [salesInvoices.id, salesInvoices.tenantId, salesInvoices.bookSetId] }),
  uqScope: uniqueIndex("uq_gst_outward_facts_scope_key").on(t.id, t.tenantId, t.bookSetId),
  uqInvoice: uniqueIndex("uq_gst_outward_facts_invoice").on(t.invoiceId, t.tenantId, t.bookSetId),
  idxScope: index("idx_gst_outward_facts_scope").on(t.tenantId, t.bookSetId, t.invoiceId),
  chkState: check("chk_gst_outward_facts_pos_state", sql`${t.placeOfSupplyStateCode} IS NULL OR (length(${t.placeOfSupplyStateCode}) = 2 AND ${t.placeOfSupplyStateCode} GLOB '[0-9][0-9]')`),
  chkRecipient: check("chk_gst_outward_facts_recipient_category", sql`${t.recipientRegistrationCategory} IS NULL OR ${t.recipientRegistrationCategory} IN ('REGISTERED', 'UNREGISTERED', 'CONSUMER', 'COMPOSITION', 'EXEMPT')`),
  chkReverseCharge: check("chk_gst_outward_facts_reverse_charge", sql`typeof(${t.reverseChargeApplicable}) = 'integer' AND ${t.reverseChargeApplicable} IN (0, 1)`),
  chkEcommerce: check("chk_gst_outward_facts_ecommerce_gstin", sql`${t.ecommerceGstin} IS NULL OR length(${t.ecommerceGstin}) = 15`),
}));

export const gstOutwardLineFacts = sqliteTable("gst_outward_line_facts", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), outwardFactsId: text("outward_facts_id").notNull(), invoiceLineId: text("invoice_line_id").notNull(), lineNumber: integer("line_number").notNull(), classification: text("classification"), hsnSacCode: text("hsn_sac_code"), quantityDecimal: text("quantity_decimal"), unitOfMeasureCode: text("unit_of_measure_code"), createdAt: text("created_at").notNull(),
}, (t) => ({
  fkBookSet: foreignKey({ columns: [t.bookSetId, t.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }),
  fkFacts: foreignKey({ columns: [t.outwardFactsId, t.tenantId, t.bookSetId], foreignColumns: [gstOutwardFacts.id, gstOutwardFacts.tenantId, gstOutwardFacts.bookSetId] }),
  fkInvoiceLine: foreignKey({ columns: [t.invoiceLineId, t.tenantId, t.bookSetId], foreignColumns: [salesInvoiceLines.id, salesInvoiceLines.tenantId, salesInvoiceLines.bookSetId] }),
  uqScope: uniqueIndex("uq_gst_line_facts_scope_key").on(t.id, t.tenantId, t.bookSetId),
  uqLineNumber: uniqueIndex("uq_gst_line_facts_line_number").on(t.outwardFactsId, t.lineNumber),
  idxScope: index("idx_gst_line_facts_scope").on(t.tenantId, t.bookSetId, t.outwardFactsId),
  chkClassification: check("chk_gst_line_facts_classification", sql`${t.classification} IS NULL OR ${t.classification} IN ('GOODS', 'SERVICES')`),
  chkHsnSac: check("chk_gst_line_facts_hsn_sac", sql`${t.hsnSacCode} IS NULL OR (length(${t.hsnSacCode}) >= 4 AND length(${t.hsnSacCode}) <= 8)`),
  chkLineNumber: check("chk_gst_line_facts_line_number", sql`typeof(${t.lineNumber}) = 'integer' AND ${t.lineNumber} > 0`),
  chkQuantity: check("chk_gst_line_facts_quantity", sql`${t.quantityDecimal} IS NULL OR (typeof(${t.quantityDecimal}) = 'text' AND length(${t.quantityDecimal}) > 0)`),
}));

export const gstReturns = sqliteTable("gst_returns", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), registrationId: text("registration_id").notNull(), gstin: text("gstin").notNull(), returnForm: text("return_form").notNull(), taxPeriodFrom: text("tax_period_from").notNull(), taxPeriodTo: text("tax_period_to").notNull(), createdAt: text("created_at").notNull(),
}, (t) => ({
  fkBookSet: foreignKey({ columns: [t.bookSetId, t.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }),
  fkRegistration: foreignKey({ columns: [t.registrationId, t.tenantId], foreignColumns: [gstRegistrations.id, gstRegistrations.tenantId] }),
  uqScope: uniqueIndex("uq_gst_returns_scope_key").on(t.id, t.tenantId, t.bookSetId),
  uqRegistrationPeriod: uniqueIndex("uq_gst_return_registration_period").on(t.registrationId, t.returnForm, t.taxPeriodFrom, t.taxPeriodTo),
  idxScopePeriod: index("idx_gst_returns_scope_period").on(t.tenantId, t.bookSetId, t.registrationId, t.taxPeriodFrom, t.taxPeriodTo),
  chkForm: check("chk_gst_return_form", sql`${t.returnForm} IN ('GSTR1', 'GSTR2', 'GSTR3B')`),
  chkFrom: check("chk_gst_return_period_from", sql`length(${t.taxPeriodFrom}) = 10`),
  chkTo: check("chk_gst_return_period_to", sql`length(${t.taxPeriodTo}) = 10`),
  chkOrder: check("chk_gst_return_period_order", sql`${t.taxPeriodFrom} <= ${t.taxPeriodTo}`),
  chkGstin: check("chk_gst_return_gstin", sql`length(${t.gstin}) = 15`),
}));

export const gstReturnSnapshots = sqliteTable("gst_return_snapshots", {
  id: text("id").primaryKey(), returnId: text("return_id").notNull(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), snapshotVersion: integer("snapshot_version").notNull(), preparedAt: text("prepared_at").notNull(), preparedByActorId: text("prepared_by_actor_id").notNull(), requestHash: text("request_hash").notNull(), payloadHash: text("payload_hash").notNull(), sourceInvoiceIdsJson: text("source_invoice_ids_json").notNull(), frozenSourceHashesJson: text("frozen_source_hashes_json").notNull(), summaryFactsJson: text("summary_facts_json").notNull(),
}, (t) => ({
  fkBookSet: foreignKey({ columns: [t.bookSetId, t.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }),
  fkReturn: foreignKey({ columns: [t.returnId, t.tenantId, t.bookSetId], foreignColumns: [gstReturns.id, gstReturns.tenantId, gstReturns.bookSetId] }),
  uqScope: uniqueIndex("uq_gst_return_snapshot_scope_key").on(t.id, t.tenantId, t.bookSetId),
  uqReturnVersion: uniqueIndex("uq_gst_snapshot_return_version").on(t.returnId, t.snapshotVersion),
  idxScopeReturn: index("idx_gst_snapshot_scope_return").on(t.tenantId, t.bookSetId, t.returnId),
  chkVersion: check("chk_gst_snapshot_version", sql`typeof(${t.snapshotVersion}) = 'integer' AND ${t.snapshotVersion} >= 1`),
  chkHashes: check("chk_gst_snapshot_hashes", sql`length(${t.requestHash}) = 64 AND length(${t.payloadHash}) = 64 AND ${t.requestHash} NOT GLOB '*[^0-9a-f]*' AND ${t.payloadHash} NOT GLOB '*[^0-9a-f]*'`),
}));

export const gstReturnValidations = sqliteTable("gst_return_validations", {
  id: text("id").primaryKey(), snapshotId: text("snapshot_id").notNull(), returnId: text("return_id").notNull(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), validatedAt: text("validated_at").notNull(), validatedByActorId: text("validated_by_actor_id").notNull(), readinessStatus: text("readiness_status").notNull(), issuesJson: text("issues_json").notNull(),
}, (t) => ({
  fkBookSet: foreignKey({ columns: [t.bookSetId, t.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }),
  fkSnapshot: foreignKey({ columns: [t.snapshotId, t.tenantId, t.bookSetId], foreignColumns: [gstReturnSnapshots.id, gstReturnSnapshots.tenantId, gstReturnSnapshots.bookSetId] }),
  fkReturn: foreignKey({ columns: [t.returnId, t.tenantId, t.bookSetId], foreignColumns: [gstReturns.id, gstReturns.tenantId, gstReturns.bookSetId] }),
  uqScope: uniqueIndex("uq_gst_validation_scope_key").on(t.id, t.tenantId, t.bookSetId),
  uqSnapshot: uniqueIndex("uq_gst_validation_snapshot").on(t.snapshotId, t.tenantId, t.bookSetId),
  idxScopeReturn: index("idx_gst_validation_scope_return").on(t.tenantId, t.bookSetId, t.returnId, t.readinessStatus),
  chkStatus: check("chk_gst_validation_readiness_status", sql`${t.readinessStatus} IN ('READY', 'REVIEW_REQUIRED', 'BLOCKED')`),
}));

export const gstReturnExports = sqliteTable("gst_return_exports", {
  id: text("id").primaryKey(), validationId: text("validation_id").notNull(), snapshotId: text("snapshot_id").notNull(), returnId: text("return_id").notNull(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), exportedAt: text("exported_at").notNull(), exportedByActorId: text("exported_by_actor_id").notNull(), manifestJson: text("manifest_json").notNull(), manifestHash: text("manifest_hash").notNull(), artifactFormatVersion: text("artifact_format_version").notNull(), portalJsonStatus: text("portal_json_status").notNull(), csvSummaryLinesJson: text("csv_summary_lines_json").notNull(), csvSummaryHash: text("csv_summary_hash").notNull(), csvDocumentsLinesJson: text("csv_documents_lines_json").notNull(), csvDocumentsHash: text("csv_documents_hash").notNull(), csvLineDetailsLinesJson: text("csv_line_details_lines_json").notNull(), csvLineDetailsHash: text("csv_line_details_hash").notNull(), csvTaxComponentLinesJson: text("csv_tax_component_lines_json").notNull(), csvTaxComponentHash: text("csv_tax_component_hash").notNull(), csvValidationIssuesLinesJson: text("csv_validation_issues_lines_json").notNull(), csvValidationIssuesHash: text("csv_validation_issues_hash").notNull(),
}, (t) => ({
  fkBookSet: foreignKey({ columns: [t.bookSetId, t.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }),
  fkValidation: foreignKey({ columns: [t.validationId, t.tenantId, t.bookSetId], foreignColumns: [gstReturnValidations.id, gstReturnValidations.tenantId, gstReturnValidations.bookSetId] }),
  fkSnapshot: foreignKey({ columns: [t.snapshotId, t.tenantId, t.bookSetId], foreignColumns: [gstReturnSnapshots.id, gstReturnSnapshots.tenantId, gstReturnSnapshots.bookSetId] }),
  fkReturn: foreignKey({ columns: [t.returnId, t.tenantId, t.bookSetId], foreignColumns: [gstReturns.id, gstReturns.tenantId, gstReturns.bookSetId] }),
  uqScope: uniqueIndex("uq_gst_export_scope_key").on(t.id, t.tenantId, t.bookSetId),
  uqValidation: uniqueIndex("uq_gst_export_validation").on(t.validationId, t.tenantId, t.bookSetId),
  idxScopeReturn: index("idx_gst_export_scope_return").on(t.tenantId, t.bookSetId, t.returnId),
  chkHashes: check("chk_gst_export_hashes", sql`length(${t.manifestHash}) = 64 AND length(${t.csvSummaryHash}) = 64 AND length(${t.csvDocumentsHash}) = 64 AND length(${t.csvLineDetailsHash}) = 64 AND length(${t.csvTaxComponentHash}) = 64 AND length(${t.csvValidationIssuesHash}) = 64 AND ${t.manifestHash} NOT GLOB '*[^0-9a-f]*' AND ${t.csvSummaryHash} NOT GLOB '*[^0-9a-f]*' AND ${t.csvDocumentsHash} NOT GLOB '*[^0-9a-f]*' AND ${t.csvLineDetailsHash} NOT GLOB '*[^0-9a-f]*' AND ${t.csvTaxComponentHash} NOT GLOB '*[^0-9a-f]*' AND ${t.csvValidationIssuesHash} NOT GLOB '*[^0-9a-f]*'`),
  chkPortal: check("chk_gst_export_portal_json_status", sql`${t.portalJsonStatus} IN ('SCHEMA_UNPINNED', 'NOT_GENERATED')`),
}));

export const gstReturnObservations = sqliteTable("gst_return_observations", {
  id: text("id").primaryKey(), returnId: text("return_id").notNull(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), recordedAt: text("recorded_at").notNull(), recordedByActorId: text("recorded_by_actor_id").notNull(), observationType: text("observation_type").notNull(), externalReference: text("external_reference"), evidenceId: text("evidence_id"), narration: text("narration"),
}, (t) => ({
  fkBookSet: foreignKey({ columns: [t.bookSetId, t.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }),
  fkReturn: foreignKey({ columns: [t.returnId, t.tenantId, t.bookSetId], foreignColumns: [gstReturns.id, gstReturns.tenantId, gstReturns.bookSetId] }),
  fkEvidence: foreignKey({ columns: [t.evidenceId], foreignColumns: [evidence.id] }),
  uqScope: uniqueIndex("uq_gst_observation_scope_key").on(t.id, t.tenantId, t.bookSetId),
  idxScopeReturn: index("idx_gst_observation_scope_return").on(t.tenantId, t.bookSetId, t.returnId, t.observationType),
  idxRecordedAt: index("idx_gst_observation_recorded_at").on(t.tenantId, t.bookSetId, t.returnId, t.recordedAt),
  chkType: check("chk_gst_observation_type", sql`${t.observationType} IN ('USER_MARKED_PORTAL_UPLOADED', 'PORTAL_ERROR', 'PORTAL_PROCESSED', 'USER_MARKED_SUBMITTED', 'ACKNOWLEDGED', 'REJECTED')`),
  chkEvidence: check("chk_gst_observation_evidence_required", sql`(${t.observationType} IN ('USER_MARKED_SUBMITTED', 'ACKNOWLEDGED') AND ${t.evidenceId} IS NOT NULL) OR ${t.observationType} NOT IN ('USER_MARKED_SUBMITTED', 'ACKNOWLEDGED')`),
}));
