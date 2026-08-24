/**
 * Drizzle assets embedded in the compiled binary.
 *
 * Keep these imports static: Bun includes their text in a compiled artifact,
 * so fresh database initialization does not depend on the launch directory or
 * on a source checkout being present.
 */
import journalText from "../../../drizzle/meta/_journal.json" with { type: "text" };
import migration0009 from "../../../drizzle/0009_drizzle_v8_baseline.sql" with { type: "text" };
import migration0010 from "../../../drizzle/0010_gst_v1.sql" with { type: "text" };
import migration0011 from "../../../drizzle/0011_tds_tcs_v1.sql" with { type: "text" };
import migration0012 from "../../../drizzle/0012_fixed_assets_v1.sql" with { type: "text" };
import migration0013 from "../../../drizzle/0013_fx_v1.sql" with { type: "text" };
import migration0014 from "../../../drizzle/0014_payroll_v1.sql" with { type: "text" };
import migration0015 from "../../../drizzle/0015_expense_claims_v1.sql" with { type: "text" };
import migration0016 from "../../../drizzle/0016_gst_return_readiness_v1.sql" with { type: "text" };
import migration0017 from "../../../drizzle/0017_compliance_obligations_v1.sql" with { type: "text" };
import migration0018 from "../../../drizzle/0018_period_close_v1.sql" with { type: "text" };
import migration0019 from "../../../drizzle/0019_tenant_pan_v1.sql" with { type: "text" };
import migration0020 from "../../../drizzle/0020_close_pack_v1.sql" with { type: "text" };
import migration0021 from "../../../drizzle/0021_personal_taxcase_foundation_v1.sql" with { type: "text" };
import migration0022 from "../../../drizzle/0022_personal_tax_source_intake_v1.sql" with { type: "text" };
import migration0023 from "../../../drizzle/0023_personal_tax_facts_reconciliation_v1.sql" with { type: "text" };
import migration0024 from "../../../drizzle/0024_personal_tax_filing_snapshot_v1.sql" with { type: "text" };
import migration0025 from "../../../drizzle/0025_personal_tax_source_readiness_v1.sql" with { type: "text" };
import migration0026 from "../../../drizzle/0026_personal_tax_position_worksheet_v1.sql" with { type: "text" };
import migration0027 from "../../../drizzle/0027_personal_tax_itr_eligibility_v1.sql" with { type: "text" };
import migration0028 from "../../../drizzle/0028_personal_tax_computation_v1.sql" with { type: "text" };
import migration0029 from "../../../drizzle/0029_personal_tax_return_artifact_v1.sql" with { type: "text" };
import migration0030 from "../../../drizzle/0030_gst_gstr1_return_artifact_v1.sql" with { type: "text" };
import migration0031 from "../../../drizzle/0031_tds_tcs_statement_artifact_v1.sql" with { type: "text" };
import migration0032 from "../../../drizzle/0032_gst_gstr3b_reconciliation_artifact_v1.sql" with { type: "text" };
import migration0033 from "../../../drizzle/0033_mca_annual_filing_artifact_v1.sql" with { type: "text" };
import migration0034 from "../../../drizzle/0034_fiscal_year_rollover_v1.sql" with { type: "text" };
import migration0035 from "../../../drizzle/0035_payroll_statutory_artifacts_v1.sql" with { type: "text" };
import migration0036 from "../../../drizzle/0036_source_registry_bank_file_import_v1.sql" with { type: "text" };
import migration0037 from "../../../drizzle/0037_zoho_books_backup_import_v1.sql" with { type: "text" };
import migration0038 from "../../../drizzle/0038_source_staging_v1.sql" with { type: "text" };

export const DRIZZLE_JOURNAL_TEXT: string = String(journalText);

/** The canonical immutable filename-to-SQL registry for official Drizzle. */
export const DRIZZLE_SQL_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  "0009_drizzle_v8_baseline.sql": migration0009,
  "0010_gst_v1.sql": migration0010,
  "0011_tds_tcs_v1.sql": migration0011,
  "0012_fixed_assets_v1.sql": migration0012,
  "0013_fx_v1.sql": migration0013,
  "0014_payroll_v1.sql": migration0014,
  "0015_expense_claims_v1.sql": migration0015,
  "0016_gst_return_readiness_v1.sql": migration0016,
  "0017_compliance_obligations_v1.sql": migration0017,
  "0018_period_close_v1.sql": migration0018,
  "0019_tenant_pan_v1.sql": migration0019,
  "0020_close_pack_v1.sql": migration0020,
  "0021_personal_taxcase_foundation_v1.sql": migration0021,
  "0022_personal_tax_source_intake_v1.sql": migration0022,
  "0023_personal_tax_facts_reconciliation_v1.sql": migration0023,
  "0024_personal_tax_filing_snapshot_v1.sql": migration0024,
  "0025_personal_tax_source_readiness_v1.sql": migration0025,
  "0026_personal_tax_position_worksheet_v1.sql": migration0026,
  "0027_personal_tax_itr_eligibility_v1.sql": migration0027,
  "0028_personal_tax_computation_v1.sql": migration0028,
  "0029_personal_tax_return_artifact_v1.sql": migration0029,
  "0030_gst_gstr1_return_artifact_v1.sql": migration0030,
  "0031_tds_tcs_statement_artifact_v1.sql": migration0031,
  "0032_gst_gstr3b_reconciliation_artifact_v1.sql": migration0032,
  "0033_mca_annual_filing_artifact_v1.sql": migration0033,
  "0034_fiscal_year_rollover_v1.sql": migration0034,
  "0035_payroll_statutory_artifacts_v1.sql": migration0035,
  "0036_source_registry_bank_file_import_v1.sql": migration0036,
  "0037_zoho_books_backup_import_v1.sql": migration0037,
  "0038_source_staging_v1.sql": migration0038,
});

// Short aliases make the single canonical asset authority easy to discover
// without introducing a second registry.
export const OFFICIAL_DRIZZLE_JOURNAL_TEXT = DRIZZLE_JOURNAL_TEXT;
export const OFFICIAL_DRIZZLE_SQL_REGISTRY = DRIZZLE_SQL_REGISTRY;
