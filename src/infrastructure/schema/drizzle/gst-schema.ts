import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { tenants, bookSets } from "./foundation-schema";
import { parties, salesInvoices } from "./sales-schema";
import { vendorBills } from "./purchase-schema";

/** GST facts and immutable tax snapshots for the GST v1 vertical slice. */
export const partyGstProfiles = sqliteTable(
  "party_gst_profiles",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    partyId: text("party_id").notNull(),
    gstin: text("gstin"),
    treatment: text("treatment").notNull(),
    stateCode: text("state_code").notNull(),
    localComponent: text("local_component"),
    status: text("status").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    fkParty: foreignKey({ columns: [table.partyId, table.tenantId, table.bookSetId], foreignColumns: [parties.id, parties.tenantId, parties.bookSetId] }).onDelete("no action"),
    uqScope: uniqueIndex("uq_party_gst_profiles_scope_key").on(table.id, table.tenantId, table.bookSetId),
    idxScopeDate: index("idx_party_gst_profiles_scope_date").on(table.tenantId, table.bookSetId, table.partyId, table.effectiveFrom, table.id),
    chkTreatment: check("chk_party_gst_profile_treatment", sql`${table.treatment} IN ('REGISTERED', 'UNREGISTERED', 'CONSUMER')`),
    chkStatus: check("chk_party_gst_profile_status", sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
    chkState: check("chk_party_gst_profile_state", sql`length(${table.stateCode}) = 2 AND ${table.stateCode} NOT GLOB '*[^0-9]*'`),
    chkLocal: check("chk_party_gst_profile_local_component", sql`${table.localComponent} IS NULL OR ${table.localComponent} IN ('SGST', 'UTGST')`),
    chkGstin: check("chk_party_gst_profile_gstin", sql`(${table.treatment} = 'REGISTERED' AND ${table.gstin} IS NOT NULL) OR (${table.treatment} IN ('UNREGISTERED', 'CONSUMER') AND ${table.gstin} IS NULL)`),
  }),
);

export const gstTaxSnapshots = sqliteTable(
  "gst_tax_snapshots",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    documentType: text("document_type").notNull(),
    salesInvoiceId: text("sales_invoice_id"),
    vendorBillId: text("vendor_bill_id"),
    sellerRegistrationId: text("seller_registration_id"),
    buyerProfileId: text("buyer_profile_id"),
    sellerGstin: text("seller_gstin").notNull(),
    sellerStateCode: text("seller_state_code").notNull(),
    buyerGstin: text("buyer_gstin"),
    buyerTreatment: text("buyer_treatment").notNull(),
    buyerStateCode: text("buyer_state_code").notNull(),
    localComponent: text("local_component"),
    geometry: text("geometry").notNull(),
    roundingPolicy: text("rounding_policy").notNull(),
    taxableMinor: integer("taxable_minor").notNull(),
    taxMinor: integer("tax_minor").notNull(),
    grossMinor: integer("gross_minor").notNull(),
    itcTreatment: text("itc_treatment"),
    riskFlagsJson: text("risk_flags_json").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    fkInvoice: foreignKey({ columns: [table.salesInvoiceId, table.tenantId, table.bookSetId], foreignColumns: [salesInvoices.id, salesInvoices.tenantId, salesInvoices.bookSetId] }).onDelete("no action"),
    fkBill: foreignKey({ columns: [table.vendorBillId, table.tenantId, table.bookSetId], foreignColumns: [vendorBills.id, vendorBills.tenantId, vendorBills.bookSetId] }).onDelete("no action"),
    uqInvoice: uniqueIndex("uq_gst_snapshot_sales_invoice").on(table.salesInvoiceId, table.tenantId, table.bookSetId),
    uqBill: uniqueIndex("uq_gst_snapshot_vendor_bill").on(table.vendorBillId, table.tenantId, table.bookSetId),
    uqScope: uniqueIndex("uq_gst_snapshot_scope_key").on(table.id, table.tenantId, table.bookSetId),
    idxRegister: index("idx_gst_snapshots_register").on(table.tenantId, table.bookSetId, table.documentType, table.createdAt, table.id),
    chkType: check("chk_gst_snapshot_document_type", sql`${table.documentType} IN ('SALE', 'PURCHASE')`),
    chkGeometry: check("chk_gst_snapshot_geometry", sql`${table.geometry} IN ('INTRA_STATE', 'INTER_STATE')`),
    chkBuyerTreatment: check("chk_gst_snapshot_buyer_treatment", sql`${table.buyerTreatment} IN ('REGISTERED', 'UNREGISTERED', 'CONSUMER')`),
    chkLocalComponent: check("chk_gst_snapshot_local_component", sql`${table.localComponent} IS NULL OR ${table.localComponent} IN ('SGST', 'UTGST')`),
    chkAmounts: check("chk_gst_snapshot_amounts", sql`typeof(${table.taxableMinor}) = 'integer' AND ${table.taxableMinor} > 0 AND typeof(${table.taxMinor}) = 'integer' AND ${table.taxMinor} >= 0 AND typeof(${table.grossMinor}) = 'integer' AND ${table.grossMinor} = ${table.taxableMinor} + ${table.taxMinor}`),
    chkItc: check("chk_gst_snapshot_itc", sql`${table.itcTreatment} IS NULL OR ${table.itcTreatment} IN ('ELIGIBLE', 'INELIGIBLE', 'PENDING_REVIEW')`),
  }),
);

export const gstTaxComponents = sqliteTable(
  "gst_tax_components",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    documentLineId: text("document_line_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    classification: text("classification").notNull(),
    component: text("component").notNull(),
    taxableMinor: integer("taxable_minor").notNull(),
    rateBps: integer("rate_bps").notNull(),
    taxMinor: integer("tax_minor").notNull(),
    accountId: text("account_id"),
    evidenceJson: text("evidence_json").notNull(),
  },
  (table) => ({
    fkSnapshot: foreignKey({ columns: [table.snapshotId, table.tenantId, table.bookSetId], foreignColumns: [gstTaxSnapshots.id, gstTaxSnapshots.tenantId, gstTaxSnapshots.bookSetId] }).onDelete("no action"),
    idxSnapshot: index("idx_gst_tax_components_snapshot").on(table.tenantId, table.bookSetId, table.snapshotId, table.lineNumber, table.component),
    chkComponent: check("chk_gst_tax_component_component", sql`${table.component} IN ('CGST', 'SGST', 'UTGST', 'IGST')`),
    chkAmounts: check("chk_gst_tax_component_amounts", sql`typeof(${table.taxableMinor}) = 'integer' AND ${table.taxableMinor} > 0 AND typeof(${table.rateBps}) = 'integer' AND ${table.rateBps} >= 0 AND typeof(${table.taxMinor}) = 'integer' AND ${table.taxMinor} >= 0`),
  }),
);
