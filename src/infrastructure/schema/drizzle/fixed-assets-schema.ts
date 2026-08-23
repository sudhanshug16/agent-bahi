import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { tenants, bookSets, accounts } from "./foundation-schema";
import { journalEntries } from "./ledger-schema";
import { vendorBillLines } from "./purchase-schema";

/** Fixed assets deliberately keep book and tax policy facts separate. */
export const assetBookPolicies = sqliteTable("asset_book_policies", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  bookSetId: text("book_set_id").notNull(),
  framework: text("framework").notNull(),
  sourceReference: text("source_reference").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  method: text("method").notNull(),
  usefulLifeMonths: integer("useful_life_months").notNull(),
  residualMinor: integer("residual_minor").notNull(),
  prorataConvention: text("prorata_convention").notNull(),
  roundingPolicy: text("rounding_policy").notNull(),
  remainderPolicy: text("remainder_policy").notNull(),
  reducingRateBps: integer("reducing_rate_bps"),
  justification: text("justification").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
  uqScope: uniqueIndex("uq_asset_book_policies_scope_key").on(table.id, table.tenantId, table.bookSetId),
  idxEffective: index("idx_asset_book_policies_effective").on(table.tenantId, table.bookSetId, table.effectiveFrom, table.id),
  chkFramework: check("chk_asset_book_policy_framework", sql`${table.framework} IN ('AS_10', 'IND_AS_16', 'COMPANIES_ACT_SCHEDULE_II', 'CUSTOM_SUPPORTED')`),
  chkMethod: check("chk_asset_book_policy_method", sql`${table.method} IN ('STRAIGHT_LINE', 'REDUCING_BALANCE')`),
  chkLife: check("chk_asset_book_policy_life", sql`typeof(${table.usefulLifeMonths}) = 'integer' AND ${table.usefulLifeMonths} > 0`),
  chkResidual: check("chk_asset_book_policy_residual", sql`typeof(${table.residualMinor}) = 'integer' AND ${table.residualMinor} >= 0`),
  chkDates: check("chk_asset_book_policy_dates", sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`),
  chkProrata: check("chk_asset_book_policy_prorata", sql`${table.prorataConvention} IN ('DAILY_ACTUAL_365', 'DAILY_ACTUAL_366', 'MONTHLY', 'FULL_MONTH')`),
  chkRounding: check("chk_asset_book_policy_rounding", sql`${table.roundingPolicy} IN ('PAISE_HALF_UP', 'PAISE_DOWN', 'PAISE_UP')`),
  chkRemainder: check("chk_asset_book_policy_remainder", sql`${table.remainderPolicy} IN ('FINAL_PERIOD', 'PRO_RATA_FINAL_DAY')`),
  chkReducingRate: check("chk_asset_book_policy_reducing_rate", sql`${table.reducingRateBps} IS NULL OR (${table.reducingRateBps} > 0 AND ${table.reducingRateBps} <= 10000)`),
}));

export const fixedAssets = sqliteTable("fixed_assets", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  bookSetId: text("book_set_id").notNull(),
  assetNumber: text("asset_number").notNull(),
  acquisitionDate: text("acquisition_date").notNull(),
  putToUseDate: text("put_to_use_date").notNull(),
  description: text("description").notNull(),
  category: text("category"),
  location: text("location"),
  custodian: text("custodian"),
  costMinor: integer("cost_minor").notNull(),
  businessUseBps: integer("business_use_bps").notNull(),
  assetAccountId: text("asset_account_id").notNull(),
  accumulatedDepreciationAccountId: text("accumulated_depreciation_account_id").notNull(),
  depreciationExpenseAccountId: text("depreciation_expense_account_id").notNull(),
  gainLossAccountId: text("gain_loss_account_id").notNull(),
  bookPolicyId: text("book_policy_id").notNull(),
  taxBlockId: text("tax_block_id"),
  sourceVendorBillLineId: text("source_vendor_bill_line_id"),
  acquisitionJournalId: text("acquisition_journal_id"),
  evidenceReference: text("evidence_reference"),
  status: text("status").notNull(),
  disposedAt: text("disposed_at"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
  fkAssetAccount: foreignKey({ columns: [table.assetAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
  fkAccumAccount: foreignKey({ columns: [table.accumulatedDepreciationAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
  fkExpenseAccount: foreignKey({ columns: [table.depreciationExpenseAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
  fkGainLossAccount: foreignKey({ columns: [table.gainLossAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
  fkPolicy: foreignKey({ columns: [table.bookPolicyId, table.tenantId, table.bookSetId], foreignColumns: [assetBookPolicies.id, assetBookPolicies.tenantId, assetBookPolicies.bookSetId] }).onDelete("no action"),
  fkTaxBlock: foreignKey({ columns: [table.taxBlockId, table.tenantId, table.bookSetId], foreignColumns: [assetTaxBlocks.id, assetTaxBlocks.tenantId, assetTaxBlocks.bookSetId] }).onDelete("no action"),
  fkBillLine: foreignKey({ columns: [table.sourceVendorBillLineId, table.tenantId, table.bookSetId], foreignColumns: [vendorBillLines.id, vendorBillLines.tenantId, vendorBillLines.bookSetId] }).onDelete("no action"),
  fkAcquisitionJournal: foreignKey({ columns: [table.acquisitionJournalId, table.tenantId, table.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }).onDelete("no action"),
  uqNumber: uniqueIndex("uq_fixed_assets_asset_number_scope").on(table.tenantId, table.bookSetId, table.assetNumber),
  uqScope: uniqueIndex("uq_fixed_assets_scope_key").on(table.id, table.tenantId, table.bookSetId),
  uqSourceLine: uniqueIndex("uq_fixed_assets_source_bill_line").on(table.tenantId, table.bookSetId, table.sourceVendorBillLineId).where(sql`${table.sourceVendorBillLineId} IS NOT NULL`),
  idxRegister: index("idx_fixed_assets_register").on(table.tenantId, table.bookSetId, table.acquisitionDate, table.assetNumber, table.id),
  chkStatus: check("chk_fixed_asset_status", sql`${table.status} IN ('ACTIVE', 'DISPOSED')`),
  chkCost: check("chk_fixed_asset_cost", sql`typeof(${table.costMinor}) = 'integer' AND ${table.costMinor} > 0`),
  chkUse: check("chk_fixed_asset_business_use", sql`typeof(${table.businessUseBps}) = 'integer' AND ${table.businessUseBps} >= 1 AND ${table.businessUseBps} <= 10000`),
  chkDates: check("chk_fixed_asset_dates", sql`${table.putToUseDate} >= ${table.acquisitionDate}`),
  chkDisposed: check("chk_fixed_asset_disposed", sql`(${table.status} = 'ACTIVE' AND ${table.disposedAt} IS NULL) OR (${table.status} = 'DISPOSED' AND ${table.disposedAt} IS NOT NULL)`),
}));

export const assetComponents = sqliteTable("asset_components", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), assetId: text("asset_id").notNull(), componentNumber: integer("component_number").notNull(), description: text("description").notNull(), costMinor: integer("cost_minor").notNull(), residualMinor: integer("residual_minor").notNull(), usefulLifeMonths: integer("useful_life_months").notNull(), method: text("method").notNull(), reducingRateBps: integer("reducing_rate_bps"), createdAt: text("created_at").notNull(),
}, (table) => ({
  fkAsset: foreignKey({ columns: [table.assetId, table.tenantId, table.bookSetId], foreignColumns: [fixedAssets.id, fixedAssets.tenantId, fixedAssets.bookSetId] }).onDelete("no action"),
  uqIdentity: uniqueIndex("uq_asset_components_scope_key").on(table.id, table.tenantId, table.bookSetId), uqNumber: uniqueIndex("uq_asset_components_number").on(table.assetId, table.componentNumber),
  idxAsset: index("idx_asset_components_asset").on(table.tenantId, table.bookSetId, table.assetId, table.componentNumber),
  chkNumber: check("chk_asset_component_number", sql`${table.componentNumber} > 0`), chkCost: check("chk_asset_component_cost", sql`${table.costMinor} > 0`), chkResidual: check("chk_asset_component_residual", sql`${table.residualMinor} >= 0 AND ${table.residualMinor} <= ${table.costMinor}`), chkLife: check("chk_asset_component_life", sql`${table.usefulLifeMonths} > 0`), chkMethod: check("chk_asset_component_method", sql`${table.method} IN ('STRAIGHT_LINE', 'REDUCING_BALANCE')`), chkReducingRate: check("chk_asset_component_reducing_rate", sql`${table.reducingRateBps} IS NULL OR (${table.reducingRateBps} > 0 AND ${table.reducingRateBps} <= 10000)`), chkMethodRate: check("chk_asset_component_method_rate", sql`(${table.method} = 'STRAIGHT_LINE' AND ${table.reducingRateBps} IS NULL) OR (${table.method} = 'REDUCING_BALANCE' AND ${table.reducingRateBps} IS NOT NULL)`),
}));

export const assetDepreciationRuns = sqliteTable("asset_depreciation_runs", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), periodStart: text("period_start").notNull(), periodEnd: text("period_end").notNull(), status: text("status").notNull(), calculationHash: text("calculation_hash").notNull(), journalId: text("journal_id"), createdAt: text("created_at").notNull(), postedAt: text("posted_at"),
}, (table) => ({
  fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"), fkJournal: foreignKey({ columns: [table.journalId, table.tenantId, table.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }).onDelete("no action"), uqPostedPeriod: uniqueIndex("uq_asset_depreciation_posted_period").on(table.tenantId, table.bookSetId, table.periodStart, table.periodEnd).where(sql`${table.status} = 'POSTED'`), idxPeriod: index("idx_asset_depreciation_runs_period").on(table.tenantId, table.bookSetId, table.periodStart, table.periodEnd, table.id), chkStatus: check("chk_asset_depreciation_run_status", sql`${table.status} IN ('PREVIEW', 'POSTED', 'NO_OP')`), chkDates: check("chk_asset_depreciation_run_dates", sql`${table.periodEnd} >= ${table.periodStart}`), chkPosted: check("chk_asset_depreciation_run_posted", sql`(${table.status} = 'PREVIEW' AND ${table.journalId} IS NULL AND ${table.postedAt} IS NULL) OR (${table.status} = 'NO_OP' AND ${table.journalId} IS NULL AND ${table.postedAt} IS NULL) OR (${table.status} = 'POSTED' AND ${table.journalId} IS NOT NULL AND ${table.postedAt} IS NOT NULL)`),
}));

export const assetDepreciationLines = sqliteTable("asset_depreciation_lines", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), runId: text("run_id").notNull(), assetId: text("asset_id").notNull(), componentId: text("component_id"), amountMinor: integer("amount_minor").notNull(), openingAccumulatedMinor: integer("opening_accumulated_minor").notNull(), closingAccumulatedMinor: integer("closing_accumulated_minor").notNull(), calculationFactsJson: text("calculation_facts_json").notNull(), createdAt: text("created_at").notNull(),
}, (table) => ({
  fkRun: foreignKey({ columns: [table.runId, table.tenantId, table.bookSetId], foreignColumns: [assetDepreciationRuns.id, assetDepreciationRuns.tenantId, assetDepreciationRuns.bookSetId] }).onDelete("no action"), fkAsset: foreignKey({ columns: [table.assetId, table.tenantId, table.bookSetId], foreignColumns: [fixedAssets.id, fixedAssets.tenantId, fixedAssets.bookSetId] }).onDelete("no action"), fkComponent: foreignKey({ columns: [table.componentId, table.tenantId, table.bookSetId], foreignColumns: [assetComponents.id, assetComponents.tenantId, assetComponents.bookSetId] }).onDelete("no action"), uqLine: uniqueIndex("uq_asset_depreciation_line_run_asset_component").on(table.runId, table.assetId, table.componentId), idxAsset: index("idx_asset_depreciation_lines_asset").on(table.tenantId, table.bookSetId, table.assetId, table.createdAt), chkAmount: check("chk_asset_depreciation_line_amount", sql`${table.amountMinor} >= 0`), chkAccum: check("chk_asset_depreciation_line_accum", sql`${table.openingAccumulatedMinor} >= 0 AND ${table.closingAccumulatedMinor} >= ${table.openingAccumulatedMinor}`),
}));

export const assetTaxRuleSnapshots = sqliteTable("asset_tax_rule_snapshots", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), lawName: text("law_name").notNull(), ruleReference: text("rule_reference").notNull(), version: text("version").notNull(), sourceUrl: text("source_url").notNull(), effectiveFrom: text("effective_from").notNull(), effectiveTo: text("effective_to"), blockCode: text("block_code").notNull(), rateBps: integer("rate_bps").notNull(), halfRateCondition: text("half_rate_condition").notNull(), calculationFactsJson: text("calculation_facts_json").notNull(), sourceVerified: integer("source_verified", { mode: "boolean" }).notNull(), canonicalHash: text("canonical_hash").notNull(), createdAt: text("created_at").notNull(),
}, (table) => ({ fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"), uqIdentity: uniqueIndex("uq_asset_tax_rule_snapshot_identity").on(table.id, table.tenantId), idxEffective: index("idx_asset_tax_rule_snapshot_effective").on(table.tenantId, table.blockCode, table.effectiveFrom, table.id), chkRate: check("chk_asset_tax_rule_rate", sql`${table.rateBps} >= 0 AND ${table.rateBps} <= 10000`), chkDates: check("chk_asset_tax_rule_dates", sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`), chkSource: check("chk_asset_tax_rule_source", sql`${table.sourceUrl} GLOB 'https://*'`), }));

export const assetTaxBlocks = sqliteTable("asset_tax_blocks", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), blockCode: text("block_code").notNull(), ruleSnapshotId: text("rule_snapshot_id").notNull(), openingWdvMinor: integer("opening_wdv_minor").notNull(), createdAt: text("created_at").notNull(),
}, (table) => ({ fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"), fkRule: foreignKey({ columns: [table.ruleSnapshotId, table.tenantId], foreignColumns: [assetTaxRuleSnapshots.id, assetTaxRuleSnapshots.tenantId] }).onDelete("no action"), uqIdentity: uniqueIndex("uq_asset_tax_block_scope_key").on(table.id, table.tenantId, table.bookSetId), uqBlock: uniqueIndex("uq_asset_tax_block_scope_code").on(table.tenantId, table.bookSetId, table.blockCode), chkWdv: check("chk_asset_tax_block_opening_wdv", sql`${table.openingWdvMinor} >= 0`), }));

export const assetTaxRuns = sqliteTable("asset_tax_runs", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), periodStart: text("period_start").notNull(), periodEnd: text("period_end").notNull(), status: text("status").notNull(), calculationHash: text("calculation_hash").notNull(), createdAt: text("created_at").notNull(),
}, (table) => ({ fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"), uqRun: uniqueIndex("uq_asset_tax_run_period").on(table.tenantId, table.bookSetId, table.periodStart, table.periodEnd), chkStatus: check("chk_asset_tax_run_status", sql`${table.status} = 'COMPUTED'`), chkDates: check("chk_asset_tax_run_dates", sql`${table.periodEnd} >= ${table.periodStart}`), }));

export const assetTaxRunLines = sqliteTable("asset_tax_run_lines", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), runId: text("run_id").notNull(), blockId: text("block_id").notNull(), openingWdvMinor: integer("opening_wdv_minor").notNull(), additionsFullMinor: integer("additions_full_minor").notNull(), additionsHalfMinor: integer("additions_half_minor").notNull(), businessUseBps: integer("business_use_bps").notNull(), disposalConsiderationMinor: integer("disposal_consideration_minor").notNull(), depreciationMinor: integer("depreciation_minor").notNull(), closingWdvMinor: integer("closing_wdv_minor").notNull(), cessation: integer("cessation", { mode: "boolean" }).notNull(), negativeProceeds: integer("negative_proceeds", { mode: "boolean" }).notNull(), calculationFactsJson: text("calculation_facts_json").notNull(), createdAt: text("created_at").notNull(),
}, (table) => ({ fkRun: foreignKey({ columns: [table.runId, table.tenantId, table.bookSetId], foreignColumns: [assetTaxRuns.id, assetTaxRuns.tenantId, assetTaxRuns.bookSetId] }).onDelete("no action"), fkBlock: foreignKey({ columns: [table.blockId, table.tenantId, table.bookSetId], foreignColumns: [assetTaxBlocks.id, assetTaxBlocks.tenantId, assetTaxBlocks.bookSetId] }).onDelete("no action"), uqLine: uniqueIndex("uq_asset_tax_run_line_block").on(table.runId, table.blockId), chkAmounts: check("chk_asset_tax_run_line_amounts", sql`${table.openingWdvMinor} >= 0 AND ${table.additionsFullMinor} >= 0 AND ${table.additionsHalfMinor} >= 0 AND ${table.disposalConsiderationMinor} >= 0 AND ${table.depreciationMinor} >= 0 AND ${table.closingWdvMinor} >= 0`), chkUse: check("chk_asset_tax_run_line_business_use", sql`${table.businessUseBps} >= 1 AND ${table.businessUseBps} <= 10000`), }));

export const assetDisposals = sqliteTable("asset_disposals", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), assetId: text("asset_id").notNull(), disposalDate: text("disposal_date").notNull(), proceedsMinor: integer("proceeds_minor").notNull(), proceedsAccountId: text("proceeds_account_id").notNull(), carryingAmountMinor: integer("carrying_amount_minor").notNull(), gainLossMinor: integer("gain_loss_minor").notNull(), journalId: text("journal_id").notNull(), evidenceReference: text("evidence_reference").notNull(), createdAt: text("created_at").notNull(),
}, (table) => ({ fkAsset: foreignKey({ columns: [table.assetId, table.tenantId, table.bookSetId], foreignColumns: [fixedAssets.id, fixedAssets.tenantId, fixedAssets.bookSetId] }).onDelete("no action"), fkProceedsAccount: foreignKey({ columns: [table.proceedsAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"), fkJournal: foreignKey({ columns: [table.journalId, table.tenantId, table.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }).onDelete("no action"), uqAsset: uniqueIndex("uq_asset_disposals_asset").on(table.assetId, table.tenantId, table.bookSetId), idxDate: index("idx_asset_disposals_date").on(table.tenantId, table.bookSetId, table.disposalDate, table.assetId), chkAmounts: check("chk_asset_disposal_amounts", sql`${table.proceedsMinor} >= 0 AND ${table.carryingAmountMinor} >= 0`), }));
