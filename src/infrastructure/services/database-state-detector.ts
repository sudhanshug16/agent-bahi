/**
 * Exact, read-only SQLite state detection.
 *
 * A migration count is only a diagnostic.  Authorization is based on the
 * ordered immutable history, checksum, table DDL/catalog, control row, and
 * (when present) the official Drizzle journal prefix.
 */

import { Database as BunDatabase } from "bun:sqlite";
import { DomainError } from "../../core/types.ts";
import { DATABASE_CONTROL_TABLE_DDL } from "../schema/database-control-schema.ts";
import { MIGRATION_CATALOG, KNOWN_SCHEMA_MANIFESTS, type SqliteSchemaManifest } from "../schema/migration-catalog.ts";
import { MIGRATION_SCHEMA_SQLITE, RECOVERY_AUDIT_SCHEMA_SQLITE } from "./migration-service.ts";
import {
  DRIZZLE_BASELINE_HASH,
  DRIZZLE_BASELINE_CREATED_AT,
  DRIZZLE_BASELINE_MIGRATION_ID,
  DRIZZLE_GST_HASH,
  DRIZZLE_FIXED_ASSETS_MIGRATION_ID,
  DRIZZLE_FX_V1_MIGRATION_ID,
  DRIZZLE_GST_MIGRATION_ID,
  DRIZZLE_GST_V1_MIGRATION_ID,
  DRIZZLE_TDS_TCS_MIGRATION_ID,
  DRIZZLE_PAYROLL_V1_MIGRATION_ID,
  DRIZZLE_EXPENSE_CLAIMS_V1_MIGRATION_ID,
  DRIZZLE_GST_RETURN_READINESS_V1_MIGRATION_ID,
  DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_MIGRATION_ID,
  DRIZZLE_PERIOD_CLOSE_V1_MIGRATION_ID,
  DRIZZLE_PERIOD_CLOSE_V1_HASH,
  DRIZZLE_TENANT_PAN_V1_MIGRATION_ID,
  DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_HASH,
  DRIZZLE_GST_RETURN_READINESS_V1_HASH,
  DRIZZLE_JOURNAL_DDL,
  DRIZZLE_MIGRATIONS_TABLE,
  validateOfficialDrizzleJournal,
} from "./drizzle-baseline.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type DatabaseState =
  | "EMPTY"
  | "LEGACY_V2"
  | "LEGACY_V3"
  | "LEGACY_V4"
  | "LEGACY_V5"
  | "LEGACY_V6"
  | "LEGACY_V7"
  | "CUSTOM_V8_WITHOUT_DRIZZLE"
  | "DRIZZLE_MANAGED"
  | "DRIZZLE_BRIDGED"
  | "UNKNOWN";

export interface DatabaseStateSummary {
  state: DatabaseState;
  schemaVersion?: number;
  hasLegacyMigrations: boolean;
  hasDrizzleMigrations: boolean;
  legacyMigrationCount?: number;
  drizzleMigrationCount?: number;
}

type CatalogRow = { type: string; name: string; tbl_name: string; sql: string | null };

const DRIZZLE_BASELINE_SQL = readFileSync(
  join(import.meta.dir, "../../..", "drizzle", `${DRIZZLE_BASELINE_MIGRATION_ID}.sql`),
  "utf8",
);
const DRIZZLE_FIXED_ASSETS_SQL = readFileSync(
  join(import.meta.dir, "../../..", "drizzle", `${DRIZZLE_FIXED_ASSETS_MIGRATION_ID}.sql`),
  "utf8",
);
const DRIZZLE_FX_SQL = readFileSync(
  join(import.meta.dir, "../../..", "drizzle", `${DRIZZLE_FX_V1_MIGRATION_ID}.sql`),
  "utf8",
);
const DRIZZLE_GST_V1_SQL = readFileSync(
  join(import.meta.dir, "../../..", "drizzle", `${DRIZZLE_GST_V1_MIGRATION_ID}.sql`),
  "utf8",
);
const DRIZZLE_TDS_TCS_SQL = readFileSync(
  join(import.meta.dir, "../../..", "drizzle", `${DRIZZLE_TDS_TCS_MIGRATION_ID}.sql`),
  "utf8",
);
const DRIZZLE_PAYROLL_SQL = readFileSync(
  join(import.meta.dir, "../../..", "drizzle", `${DRIZZLE_PAYROLL_V1_MIGRATION_ID}.sql`),
  "utf8",
);
const DRIZZLE_EXPENSE_CLAIMS_SQL = readFileSync(
  join(import.meta.dir, "../../..", "drizzle", `${DRIZZLE_EXPENSE_CLAIMS_V1_MIGRATION_ID}.sql`),
  "utf8",
);
const DRIZZLE_GST_RETURN_READINESS_SQL = readFileSync(
  join(import.meta.dir, "../../..", "drizzle", `${DRIZZLE_GST_RETURN_READINESS_V1_MIGRATION_ID}.sql`),
  "utf8",
);
const DRIZZLE_COMPLIANCE_OBLIGATIONS_SQL = readFileSync(
  join(import.meta.dir, "../../..", "drizzle", `${DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_MIGRATION_ID}.sql`),
  "utf8",
);
const DRIZZLE_PERIOD_CLOSE_SQL = readFileSync(
  join(import.meta.dir, "../../..", "drizzle", `${DRIZZLE_PERIOD_CLOSE_V1_MIGRATION_ID}.sql`),
  "utf8",
);
const DRIZZLE_TENANT_PAN_SQL = readFileSync(
  join(import.meta.dir, "../../..", "drizzle", `${DRIZZLE_TENANT_PAN_V1_MIGRATION_ID}.sql`),
  "utf8",
);

function normalizeDdl(sql: string | null | undefined): string {
  return String(sql ?? "")
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, "")
    .replace(/[`\"]([^`\"]+)[`\"]/g, "$1")
    .replace(/;\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function sameCatalog(actual: readonly CatalogRow[], expected: readonly CatalogRow[]): boolean {
  if (actual.length !== expected.length) return false;
  return actual.every((row, index) => {
    const wanted = expected[index];
    return !!wanted && canonical(row.type) === canonical(wanted.type)
      && canonical(row.name) === canonical(wanted.name)
      && canonical(row.tbl_name) === canonical(wanted.tbl_name)
      && normalizeDdl(row.sql) === normalizeDdl(wanted.sql);
  });
}

function catalog(db: BunDatabase): CatalogRow[] {
  return db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type ASC, name ASC, tbl_name ASC, sql ASC
  `).all() as CatalogRow[];
}

function expectedCatalog(manifest: SqliteSchemaManifest, drizzle: boolean, current = false): CatalogRow[] {
  const memory = new BunDatabase(":memory:", { strict: true, safeIntegers: true });
  try {
    memory.exec("PRAGMA foreign_keys = ON");
    if (drizzle) {
      memory.exec(DRIZZLE_JOURNAL_DDL);
      for (const statement of DRIZZLE_BASELINE_SQL.split("--> statement-breakpoint")) memory.exec(statement);
      if (current) {
        for (const statement of DRIZZLE_GST_V1_SQL.split("--> statement-breakpoint")) memory.exec(statement);
        for (const statement of DRIZZLE_TDS_TCS_SQL.split("--> statement-breakpoint")) memory.exec(statement);
        for (const statement of DRIZZLE_FIXED_ASSETS_SQL.split("--> statement-breakpoint")) memory.exec(statement);
        for (const statement of DRIZZLE_FX_SQL.split("--> statement-breakpoint")) memory.exec(statement);
        for (const statement of DRIZZLE_PAYROLL_SQL.split("--> statement-breakpoint")) memory.exec(statement);
        for (const statement of DRIZZLE_EXPENSE_CLAIMS_SQL.split("--> statement-breakpoint")) memory.exec(statement);
        for (const statement of DRIZZLE_GST_RETURN_READINESS_SQL.split("--> statement-breakpoint")) memory.exec(statement);
        for (const statement of DRIZZLE_COMPLIANCE_OBLIGATIONS_SQL.split("--> statement-breakpoint")) memory.exec(statement);
        for (const statement of DRIZZLE_PERIOD_CLOSE_SQL.split("--> statement-breakpoint")) memory.exec(statement);
        for (const statement of DRIZZLE_TENANT_PAN_SQL.split("--> statement-breakpoint")) memory.exec(statement);
      }
    } else {
      memory.exec(MIGRATION_SCHEMA_SQLITE);
      memory.exec(RECOVERY_AUDIT_SCHEMA_SQLITE);
      const ids = new Set(manifest.migrations.map((migration) => migration.id));
      for (const entry of MIGRATION_CATALOG) if (ids.has(entry.id)) memory.exec(entry.sqlite);
    }
    return catalog(memory);
  } finally {
    memory.close();
  }
}

function tableDdl(db: BunDatabase, name: string): string | undefined {
  const row = db.prepare("SELECT type, sql FROM sqlite_schema WHERE name = ?").get(name) as { type?: unknown; sql?: string | null } | undefined;
  if (!row || row.type !== "table") return undefined;
  return row.sql ?? undefined;
}

function exactHistory(db: BunDatabase, manifest: SqliteSchemaManifest): boolean {
  if (normalizeDdl(tableDdl(db, "schema_migrations")) !== normalizeDdl(MIGRATION_SCHEMA_SQLITE)) return false;
  const rows = db.prepare(`
    SELECT id, dialect, checksum, status, dirty_reason
    FROM schema_migrations ORDER BY rowid ASC
  `).all() as Array<Record<string, unknown>>;
  return rows.length === manifest.migrations.length && manifest.migrations.every((migration, index) => {
    const row = rows[index];
    return !!row && row.id === migration.id && row.dialect === migration.dialect
      && row.checksum === migration.checksum && row.status === migration.status && row.dirty_reason === null;
  });
}

function exactControl(db: BunDatabase, manifest: SqliteSchemaManifest, expectedLastId = manifest.migrations.at(-1)?.id, expectedLastChecksum = manifest.migrations.at(-1)?.checksum, expectedDdl = DATABASE_CONTROL_TABLE_DDL): boolean {
  if (normalizeDdl(tableDdl(db, "database_control")) !== normalizeDdl(expectedDdl)) return false;
  const rows = db.prepare("SELECT * FROM database_control ORDER BY id").all() as Array<Record<string, unknown>>;
  if (rows.length !== 1) return false;
  const row = rows[0]!;
  const integer = (value: unknown): number | undefined => {
    const number = typeof value === "bigint" ? Number(value) : value;
    return typeof number === "number" && Number.isSafeInteger(number) ? number : undefined;
  };
  const iso = (value: unknown): boolean => typeof value === "string" && new Date(value).toISOString() === value;
  return integer(row.id) === 1
    && integer(row.schema_version) === manifest.schemaVersion
    && integer(row.data_format_version) === manifest.dataFormatVersion
    && integer(row.reader_compatibility_min) === manifest.readerCompatibilityMin
    && integer(row.reader_compatibility_max) === manifest.readerCompatibilityMax
    && integer(row.required_writer_protocol) === manifest.writerProtocol
    && row.state === "READY"
    && integer(row.revision) === manifest.revision
    && integer(row.generation) === manifest.generation
    && row.last_migration_id === expectedLastId
    && row.last_migration_checksum === expectedLastChecksum
    && typeof row.last_writer_cli_version === "string" && row.last_writer_cli_version.length > 0
    && typeof row.last_writer_build_id === "string" && row.last_writer_build_id.length > 0
    && iso(row.last_writer_at) && iso(row.created_at) && iso(row.updated_at)
    && row.recovery_reason === null;
}

function exactLegacySchema(db: BunDatabase, manifest: SqliteSchemaManifest, bridged = false): boolean {
  const actual = bridged ? catalog(db).filter((row) => row.name !== DRIZZLE_MIGRATIONS_TABLE) : catalog(db);
  return exactHistory(db, manifest) && exactControl(db, manifest) && sameCatalog(actual, expectedCatalog(manifest, false));
}

function exactDrizzleJournal(db: BunDatabase): boolean {
  if (normalizeDdl(tableDdl(db, DRIZZLE_MIGRATIONS_TABLE)) !== normalizeDdl(DRIZZLE_JOURNAL_DDL)) return false;
  const rows = db.prepare(`SELECT id, hash, created_at FROM ${DRIZZLE_MIGRATIONS_TABLE} ORDER BY created_at ASC, id ASC`).all() as Array<Record<string, unknown>>;
  try {
    validateOfficialDrizzleJournal(rows);
    return true;
  } catch {
    return false;
  }
}

function exactFreshDrizzle(db: BunDatabase, current = false): boolean {
  const manifest = KNOWN_SCHEMA_MANIFESTS.at(-1)!;
  if (!exactDrizzleJournal(db)) return false;
  const expected = expectedCatalog(manifest, true, current);
  const expectedControl = expected.find((row) => row.type === "table" && row.name === "database_control")?.sql;
  const expectedId = current ? DRIZZLE_GST_MIGRATION_ID : DRIZZLE_BASELINE_MIGRATION_ID;
  const expectedHash = current ? DRIZZLE_GST_HASH : DRIZZLE_BASELINE_HASH;
  if (!exactControl(db, manifest, expectedId, expectedHash, expectedControl ?? DATABASE_CONTROL_TABLE_DDL)) return false;
  return sameCatalog(catalog(db), expected);
}

function exactPriorCurrentDrizzle(db: BunDatabase): boolean {
  const manifest = KNOWN_SCHEMA_MANIFESTS.at(-1)!;
  if (!exactDrizzleJournal(db)) return false;
  const memory = new BunDatabase(":memory:", { strict: true, safeIntegers: true });
  try {
    memory.exec("PRAGMA foreign_keys = ON");
    memory.exec(DRIZZLE_JOURNAL_DDL);
    for (const statement of DRIZZLE_BASELINE_SQL.split("--> statement-breakpoint")) memory.exec(statement);
    for (const id of [DRIZZLE_GST_V1_MIGRATION_ID, DRIZZLE_TDS_TCS_MIGRATION_ID, DRIZZLE_FIXED_ASSETS_MIGRATION_ID, DRIZZLE_FX_V1_MIGRATION_ID, DRIZZLE_PAYROLL_V1_MIGRATION_ID, DRIZZLE_EXPENSE_CLAIMS_V1_MIGRATION_ID, DRIZZLE_GST_RETURN_READINESS_V1_MIGRATION_ID, DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_MIGRATION_ID]) {
      const sql = id === DRIZZLE_GST_V1_MIGRATION_ID ? DRIZZLE_GST_V1_SQL : id === DRIZZLE_TDS_TCS_MIGRATION_ID ? DRIZZLE_TDS_TCS_SQL : id === DRIZZLE_FIXED_ASSETS_MIGRATION_ID ? DRIZZLE_FIXED_ASSETS_SQL : id === DRIZZLE_FX_V1_MIGRATION_ID ? DRIZZLE_FX_SQL : id === DRIZZLE_PAYROLL_V1_MIGRATION_ID ? DRIZZLE_PAYROLL_SQL : id === DRIZZLE_EXPENSE_CLAIMS_V1_MIGRATION_ID ? DRIZZLE_EXPENSE_CLAIMS_SQL : id === DRIZZLE_GST_RETURN_READINESS_V1_MIGRATION_ID ? DRIZZLE_GST_RETURN_READINESS_SQL : DRIZZLE_COMPLIANCE_OBLIGATIONS_SQL;
      for (const statement of sql.split("--> statement-breakpoint")) memory.exec(statement);
    }
    const expected = catalog(memory);
    const expectedDdl = expected.find((row) => row.type === "table" && row.name === "database_control")?.sql;
    if (!exactControl(db, manifest, DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_MIGRATION_ID, DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_HASH, expectedDdl ?? DATABASE_CONTROL_TABLE_DDL)) return false;
    return sameCatalog(catalog(db), expected);
  } finally { memory.close(); }
}

/** Recognize the immediately previous official journal before Tenant PAN V1. */
function exactPreviousCurrentDrizzle(db: BunDatabase): boolean {
  const manifest = KNOWN_SCHEMA_MANIFESTS.at(-1)!;
  if (!exactDrizzleJournal(db)) return false;
  const memory = new BunDatabase(":memory:", { strict: true, safeIntegers: true });
  try {
    memory.exec("PRAGMA foreign_keys = ON");
    memory.exec(DRIZZLE_JOURNAL_DDL);
    for (const statement of DRIZZLE_BASELINE_SQL.split("--> statement-breakpoint")) memory.exec(statement);
    for (const sql of [DRIZZLE_GST_V1_SQL, DRIZZLE_TDS_TCS_SQL, DRIZZLE_FIXED_ASSETS_SQL, DRIZZLE_FX_SQL, DRIZZLE_PAYROLL_SQL, DRIZZLE_EXPENSE_CLAIMS_SQL, DRIZZLE_GST_RETURN_READINESS_SQL, DRIZZLE_COMPLIANCE_OBLIGATIONS_SQL, DRIZZLE_PERIOD_CLOSE_SQL]) {
      for (const statement of sql.split("--> statement-breakpoint")) memory.exec(statement);
    }
    const expected = catalog(memory);
    const expectedDdl = expected.find((row) => row.type === "table" && row.name === "database_control")?.sql;
    if (!exactControl(db, manifest, DRIZZLE_PERIOD_CLOSE_V1_MIGRATION_ID, DRIZZLE_PERIOD_CLOSE_V1_HASH, expectedDdl ?? DATABASE_CONTROL_TABLE_DDL)) return false;
    return sameCatalog(catalog(db), expected);
  } finally { memory.close(); }
}

function exactBridgedCurrent(db: BunDatabase, manifest: SqliteSchemaManifest): boolean {
  if (!exactHistory(db, manifest) || !exactControl(db, manifest, DRIZZLE_GST_MIGRATION_ID, DRIZZLE_GST_HASH) || !exactDrizzleJournal(db)) return false;
  // Legacy bridges retain schema_migrations, whose non-GST DDL can differ
  // textually from a fresh Drizzle database after table-rebuild upgrades. The
  // GST migration itself is still compared exactly, including table columns,
  // indexes, checks, and triggers, so same-name corruption fails closed.
  const gstObjects = new Set([
    "tenant_pan_profiles", "uq_tenant_pan_profiles_tenant", "uq_tenant_pan_profiles_lookup_hash", "uq_tenant_pan_profiles_scope_key", "idx_tenant_pan_profiles_tenant",
    "party_gst_profiles", "gst_tax_snapshots", "gst_tax_components",
    "uq_party_gst_profiles_scope_key", "idx_party_gst_profiles_scope_date",
    "uq_gst_snapshot_sales_invoice", "uq_gst_snapshot_vendor_bill", "uq_gst_snapshot_scope_key", "idx_gst_snapshots_register",
    "idx_gst_tax_components_snapshot",
    "uq_gst_registrations_scope_key",
    "uq_sales_invoice_lines_id_tenant_book_set_v1",
    "gst_outward_facts", "gst_outward_line_facts", "gst_returns", "gst_return_snapshots", "gst_return_validations", "gst_return_exports", "gst_return_observations",
    "uq_gst_outward_facts_scope_key", "uq_gst_outward_facts_invoice", "idx_gst_outward_facts_scope",
    "uq_gst_line_facts_scope_key", "uq_gst_line_facts_line_number", "idx_gst_line_facts_scope",
    "uq_gst_returns_scope_key", "uq_gst_return_registration_period", "idx_gst_returns_scope_period",
    "uq_gst_return_snapshot_scope_key", "uq_gst_snapshot_return_version", "idx_gst_snapshot_scope_return",
    "uq_gst_validation_scope_key", "uq_gst_validation_snapshot", "idx_gst_validation_scope_return",
    "uq_gst_export_scope_key", "uq_gst_export_validation", "idx_gst_export_scope_return",
    "uq_gst_observation_scope_key", "idx_gst_observation_scope_return", "idx_gst_observation_recorded_at",
    "party_gst_profiles_no_overlap", "party_gst_profiles_no_overlap_upd",
    "gst_registrations_posted_snapshot_no_update", "gst_registrations_posted_snapshot_no_delete",
    "party_gst_profiles_posted_snapshot_no_update", "party_gst_profiles_posted_snapshot_no_delete",
    "sales_invoices_posted_fields_immutable", "vendor_bills_posted_fields_immutable",
    "gst_tax_snapshots_no_update", "gst_tax_snapshots_no_delete",
    "gst_tax_components_no_update", "gst_tax_components_no_delete",
    "gst_outward_facts_no_update", "gst_outward_facts_no_delete", "gst_line_facts_no_update", "gst_line_facts_no_delete",
    "gst_snapshots_no_update", "gst_snapshots_no_delete", "gst_validations_no_update", "gst_validations_no_delete",
    "gst_exports_no_update", "gst_exports_no_delete", "gst_observations_no_update", "gst_observations_no_delete",
    "tenant_deductor_profiles", "party_tax_profiles", "tax_rule_snapshots", "withholding_events", "withholding_deposits", "withholding_deposit_allocations", "withholding_compliance_cases",
    "uq_tenant_deductor_profiles_scope_key", "idx_tenant_deductor_profiles_effective", "uq_party_tax_profiles_scope_key", "idx_party_tax_profiles_effective", "uq_tax_rule_snapshots_scope_key", "idx_tax_rule_snapshots_effective", "uq_withholding_events_document_kind", "uq_withholding_events_scope_key", "idx_withholding_events_register", "uq_withholding_deposits_scope_key", "idx_withholding_deposits_register", "uq_withholding_deposit_allocation_event", "idx_withholding_deposit_allocations_event", "uq_withholding_compliance_case_period",
    "tenant_deductor_profiles_no_overlap", "tenant_deductor_profiles_no_overlap_upd", "party_tax_profiles_no_overlap", "party_tax_profiles_no_overlap_upd", "tax_rule_snapshots_no_update", "tax_rule_snapshots_no_delete", "withholding_events_no_update", "withholding_events_no_delete", "withholding_deposits_no_update", "withholding_deposits_no_delete", "withholding_deposit_allocations_no_update", "withholding_deposit_allocations_no_delete", "withholding_compliance_cases_no_update", "withholding_compliance_cases_no_delete",
    "asset_book_policies", "fixed_assets", "asset_components", "asset_depreciation_runs", "asset_depreciation_lines", "asset_tax_rule_snapshots", "asset_tax_blocks", "asset_tax_runs", "asset_tax_run_lines", "asset_disposals",
    "expense_claimants", "expense_claims", "expense_claim_lines", "expense_advances", "expense_advance_allocations", "expense_advance_repayments", "expense_reimbursements",
    "uq_asset_book_policies_scope_key", "idx_asset_book_policies_effective", "uq_fixed_assets_asset_number_scope", "uq_fixed_assets_scope_key", "uq_fixed_assets_source_bill_line", "idx_fixed_assets_register", "uq_asset_components_number", "idx_asset_components_asset", "uq_asset_depreciation_posted_period", "idx_asset_depreciation_runs_period", "uq_asset_depreciation_line_run_asset_component", "idx_asset_depreciation_lines_asset", "uq_asset_tax_rule_snapshot_identity", "idx_asset_tax_rule_snapshot_effective", "uq_asset_tax_block_scope_code", "uq_asset_tax_run_period", "uq_asset_tax_run_line_block", "uq_asset_disposals_asset", "idx_asset_disposals_date",
    "asset_book_policies_no_update", "asset_book_policies_no_delete", "fixed_assets_no_update", "fixed_assets_no_delete", "asset_components_no_update", "asset_components_no_delete", "asset_depreciation_runs_no_update", "asset_depreciation_runs_no_delete", "asset_depreciation_lines_no_update", "asset_depreciation_lines_no_delete", "asset_tax_rule_snapshots_no_update", "asset_tax_rule_snapshots_no_delete", "asset_tax_blocks_no_update", "asset_tax_blocks_no_delete", "asset_tax_runs_no_update", "asset_tax_runs_no_delete", "asset_tax_run_lines_no_update", "asset_tax_run_lines_no_delete", "asset_disposals_no_update", "asset_disposals_no_delete",
    "expense_claim_lines_no_update", "expense_claim_lines_no_delete", "expense_claim_lines_no_insert_posted", "expense_claims_posted_fields_immutable", "expense_claims_posted_status_guard", "expense_claims_no_delete_posted", "expense_advance_allocations_no_update", "expense_advance_allocations_no_delete", "expense_advance_repayments_no_update", "expense_advance_repayments_no_delete", "expense_reimbursements_no_update", "expense_reimbursements_no_delete",
    "compliance_fact_profiles", "compliance_rule_snapshots", "compliance_deadline_snapshots", "compliance_applicability_decisions", "compliance_rule_predecessors", "compliance_obligations", "compliance_obligation_artifacts", "compliance_obligation_events",
    "uq_compliance_fact_profiles_scope_key", "idx_compliance_fact_profiles_effective", "uq_compliance_rule_code_version", "uq_compliance_rule_snapshots_scope_key", "idx_compliance_rule_snapshots_effective", "uq_compliance_deadline_rule_period", "uq_compliance_deadline_scope_key", "idx_compliance_deadline_calendar", "uq_compliance_applicability_input", "uq_compliance_applicability_scope_key", "idx_compliance_applicability_decision", "uq_compliance_rule_predecessor", "idx_compliance_rule_predecessor_rule", "uq_compliance_obligation_identity", "uq_compliance_obligation_identity_strict", "uq_compliance_obligation_scope_key", "idx_compliance_obligation_due", "uq_compliance_obligation_artifact", "uq_compliance_artifact_scope_key", "idx_compliance_artifact_obligation", "uq_compliance_event_scope_key", "idx_compliance_event_timeline",
    "compliance_fact_profiles_no_update", "compliance_fact_profiles_no_delete", "compliance_rule_snapshots_no_update", "compliance_rule_snapshots_no_delete", "compliance_deadline_snapshots_no_update", "compliance_deadline_snapshots_no_delete", "compliance_applicability_decisions_no_update", "compliance_applicability_decisions_no_delete", "compliance_rule_predecessors_no_update", "compliance_rule_predecessors_no_delete", "compliance_obligations_no_update", "compliance_obligations_no_delete", "compliance_obligation_artifacts_no_update", "compliance_obligation_artifacts_no_delete", "compliance_obligation_events_no_update", "compliance_obligation_events_no_delete", "compliance_fact_profiles_no_overlap", "compliance_rule_snapshots_no_overlap",
  ]);
  for (const row of expectedCatalog(manifest, true, true)) {
    if (row.name.startsWith("payroll_") || row.name.startsWith("uq_payroll_") || row.name.startsWith("idx_payroll_")) gstObjects.add(row.name);
  }
  const expected = expectedCatalog(manifest, true, true).filter((row) => gstObjects.has(row.name));
  const actual = catalog(db).filter((row) => gstObjects.has(row.name));
  if (!sameCatalog(actual, expected)) return false;
  return ["sales_invoices", "vendor_bills"].every((table) => normalizeDdl(tableDdl(db, table)).includes("gst_input_json"));
}

/** Detect the current state without creating tables, repairing rows, or running migrations. */
export function detectDatabaseState(db: BunDatabase): DatabaseStateSummary {
  try {
    const has = (name: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    const hasLegacyMigrations = has("schema_migrations");
    const hasDrizzleMigrations = has(DRIZZLE_MIGRATIONS_TABLE);
    const hasControl = has("database_control");
    if (!hasLegacyMigrations && !hasDrizzleMigrations && !hasControl) return { state: "EMPTY", hasLegacyMigrations: false, hasDrizzleMigrations: false };

    const drizzleMigrationCount = hasDrizzleMigrations
      ? Number((db.prepare(`SELECT COUNT(*) AS count FROM ${DRIZZLE_MIGRATIONS_TABLE}`).get() as { count: number | bigint }).count)
      : undefined;
    const legacyMigrationCount = hasLegacyMigrations
      ? Number((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number | bigint }).count)
      : undefined;

    if (hasLegacyMigrations) {
      const manifest = KNOWN_SCHEMA_MANIFESTS.find((candidate) => exactLegacySchema(db, candidate, hasDrizzleMigrations) || (hasDrizzleMigrations && candidate.schemaVersion === 8 && exactBridgedCurrent(db, candidate)));
      if (!manifest) return { state: "UNKNOWN", hasLegacyMigrations: true, hasDrizzleMigrations, legacyMigrationCount, drizzleMigrationCount };
      if (hasDrizzleMigrations) {
        if (manifest.schemaVersion !== 8 || !exactDrizzleJournal(db)) return { state: "UNKNOWN", hasLegacyMigrations: true, hasDrizzleMigrations: true, legacyMigrationCount, drizzleMigrationCount };
        return { state: "DRIZZLE_BRIDGED", schemaVersion: 8, hasLegacyMigrations: true, hasDrizzleMigrations: true, legacyMigrationCount, drizzleMigrationCount };
      }
      const state = (["LEGACY_V2", "LEGACY_V3", "LEGACY_V4", "LEGACY_V5", "LEGACY_V6", "LEGACY_V7", "CUSTOM_V8_WITHOUT_DRIZZLE"] as const)[manifest.schemaVersion - 2];
      return state ? { state, schemaVersion: manifest.schemaVersion, hasLegacyMigrations: true, hasDrizzleMigrations: false, legacyMigrationCount } : { state: "UNKNOWN", hasLegacyMigrations: true, hasDrizzleMigrations: false, legacyMigrationCount };
    }

    if (hasDrizzleMigrations && hasControl && (exactFreshDrizzle(db) || exactFreshDrizzle(db, true) || exactPriorCurrentDrizzle(db) || exactPreviousCurrentDrizzle(db))) {
      return { state: "DRIZZLE_MANAGED", schemaVersion: 8, hasLegacyMigrations: false, hasDrizzleMigrations: true, drizzleMigrationCount };
    }
    return { state: "UNKNOWN", hasLegacyMigrations: false, hasDrizzleMigrations, drizzleMigrationCount };
  } catch (error) {
    throw new DomainError("DATABASE_STATE_DETECTION_FAILED", `Failed to detect database state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function requiresDatabaseMigration(state: DatabaseStateSummary): boolean {
  return state.state !== "DRIZZLE_MANAGED" && state.state !== "DRIZZLE_BRIDGED" && state.state !== "EMPTY";
}

export function describeDbState(state: DatabaseStateSummary): string {
  const descriptions: Record<DatabaseState, string> = {
    EMPTY: "Empty/Fresh database (no migration history)",
    LEGACY_V2: "Legacy v2 (foundation only)",
    LEGACY_V3: "Legacy v3 (BookSet added)",
    LEGACY_V4: "Legacy v4 (audit records added)",
    LEGACY_V5: "Legacy v5 (journal ledger added)",
    LEGACY_V6: "Legacy v6 (sales invoices added)",
    LEGACY_V7: "Legacy v7 (vendor bills added)",
    CUSTOM_V8_WITHOUT_DRIZZLE: "Custom v8 (awaiting official Drizzle baseline)",
    DRIZZLE_MANAGED: "Drizzle-managed (official baseline)",
    DRIZZLE_BRIDGED: "Drizzle-bridged (exact legacy v8 plus official baseline)",
    UNKNOWN: "Unknown/tampered (fails closed)",
  };
  return descriptions[state.state];
}

export const OFFICIAL_DRIZZLE_BASELINE = Object.freeze({ hash: DRIZZLE_BASELINE_HASH, createdAt: DRIZZLE_BASELINE_CREATED_AT });
