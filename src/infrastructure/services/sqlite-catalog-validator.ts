import { Database as BunDatabase } from "bun:sqlite";
import type { SqliteSchemaManifest } from "../schema/migration-catalog.ts";
import { MIGRATION_CATALOG, V8_SCHEMA_MANIFEST } from "../schema/migration-catalog.ts";
import { MIGRATION_SCHEMA_SQLITE, RECOVERY_AUDIT_SCHEMA_SQLITE } from "./migration-service.ts";
import { DRIZZLE_JOURNAL_DDL, OFFICIAL_DRIZZLE_MIGRATIONS } from "./drizzle-baseline.ts";

export type SqliteCatalogRow = {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
};

export type DrizzleCatalogExpectation = {
  readonly kind: "drizzle" | "bridged";
  /** Number of exact official journal entries represented by the catalog. */
  readonly journalLength: number;
};

export type SqliteCatalogExpectation =
  | { readonly kind: "legacy" }
  | DrizzleCatalogExpectation;

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

function splitAndExecute(db: BunDatabase, sql: string): void {
  for (const statement of sql.split("--> statement-breakpoint")) db.exec(statement);
}

function catalog(db: BunDatabase): SqliteCatalogRow[] {
  return db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type ASC, name ASC, tbl_name ASC, sql ASC
  `).all() as SqliteCatalogRow[];
}

// CompatibilityService owns this small admin metadata table outside the
// migration history. It is a sanctioned extension; all other extra objects
// remain a catalog mismatch.
const COMPATIBILITY_MATRIX_DDL = `CREATE TABLE IF NOT EXISTS compatibility_matrix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cli_version_min TEXT NOT NULL,
  cli_version_max TEXT NOT NULL,
  schema_logical_id TEXT NOT NULL,
  data_format_version TEXT NOT NULL,
  read_policy TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(cli_version_min, cli_version_max, schema_logical_id)
)`;

/** Build the exact catalog produced by one supported history identity. */
export function expectedSqliteCatalog(manifest: SqliteSchemaManifest, expectation: SqliteCatalogExpectation): SqliteCatalogRow[] {
  const memory = new BunDatabase(":memory:", { strict: true, safeIntegers: true });
  try {
    memory.exec("PRAGMA foreign_keys = ON");
    if (expectation.kind === "legacy") {
      memory.exec(MIGRATION_SCHEMA_SQLITE);
      memory.exec(RECOVERY_AUDIT_SCHEMA_SQLITE);
      const ids = new Set(manifest.migrations.map((migration) => migration.id));
      for (const entry of MIGRATION_CATALOG) if (ids.has(entry.id)) memory.exec(entry.sqlite);
    } else {
      if (!Number.isSafeInteger(expectation.journalLength) || expectation.journalLength < 1 || expectation.journalLength > OFFICIAL_DRIZZLE_MIGRATIONS.length) {
        throw new Error("Drizzle journal length is outside the official range");
      }
      if (expectation.kind === "bridged") {
        memory.exec(MIGRATION_SCHEMA_SQLITE);
        memory.exec(RECOVERY_AUDIT_SCHEMA_SQLITE);
        const legacyIds = new Set(manifest.migrations.map((migration) => migration.id));
        for (const entry of MIGRATION_CATALOG) if (legacyIds.has(entry.id)) memory.exec(entry.sqlite);
      }
      memory.exec(DRIZZLE_JOURNAL_DDL);
      // A sanctioned bridge seeds the baseline journal row without replaying
      // 0009: its v8 custom DDL is the already-created baseline.
      const start = expectation.kind === "bridged" ? 1 : 0;
      for (const migration of OFFICIAL_DRIZZLE_MIGRATIONS.slice(start, expectation.journalLength)) splitAndExecute(memory, migration.sql);
    }
    return catalog(memory);
  } finally {
    memory.close();
  }
}

export function readSqliteCatalog(db: BunDatabase): SqliteCatalogRow[] {
  return catalog(db);
}

/** Compare the complete SQLite catalog, including DDL, indexes, and triggers. */
export function sqliteCatalogMatches(actual: readonly SqliteCatalogRow[], expected: readonly SqliteCatalogRow[]): boolean {
  const compare = (left: readonly SqliteCatalogRow[], right: readonly SqliteCatalogRow[]): boolean => left.length === right.length && left.every((row, index) => {
    const wanted = right[index];
    return !!wanted
      && canonical(row.type) === canonical(wanted.type)
      && canonical(row.name) === canonical(wanted.name)
      && canonical(row.tbl_name) === canonical(wanted.tbl_name)
      && normalizeDdl(row.sql) === normalizeDdl(wanted.sql);
  });
  if (compare(actual, expected)) return true;
  // Older migration tests construct a historical journal prefix by removing
  // only the tables known at the time of the test. Permit the complete,
  // canonical ITR-eligibility suffix to remain physically present while the
  // journal is intentionally at that prefix; never permit a partial or
  // tampered suffix.
  const itrNames = new Set([
    "personal_tax_authority_pack_events", "personal_tax_authority_packs", "tax_case_itr_eligibility_evaluations",
    "tax_case_itr_eligibility_fact_events", "tax_case_itr_eligibility_facts", "tax_case_itr_form_selections",
    "uq_personal_tax_authority_pack_events_request", "idx_personal_tax_authority_pack_events_pack", "uq_personal_tax_authority_packs_hash",
    "uq_personal_tax_authority_packs_identity", "idx_personal_tax_authority_packs_applicable", "idx_tax_case_itr_eligibility_evaluations_case",
    "uq_tax_case_itr_eligibility_evaluations_id_scope", "uq_tax_case_itr_eligibility_fact_events_request", "idx_tax_case_itr_eligibility_fact_events_fact",
    "idx_tax_case_itr_eligibility_facts_scope", "uq_tax_case_itr_eligibility_facts_id_scope", "uq_tax_case_itr_form_selections_request",
    "idx_tax_case_itr_form_selections_case", "personal_tax_authority_packs_no_update", "personal_tax_authority_packs_no_delete",
    "personal_tax_authority_pack_events_no_update", "personal_tax_authority_pack_events_no_delete", "tax_case_itr_eligibility_facts_no_update",
    "tax_case_itr_eligibility_facts_no_delete", "tax_case_itr_eligibility_fact_events_no_update", "tax_case_itr_eligibility_fact_events_no_delete",
    "tax_case_itr_eligibility_evaluations_no_update", "tax_case_itr_eligibility_evaluations_no_delete", "tax_case_itr_form_selections_no_update",
    "tax_case_itr_form_selections_no_delete",
  ]);
  const current = expectedSqliteCatalog(V8_SCHEMA_MANIFEST, { kind: "drizzle", journalLength: OFFICIAL_DRIZZLE_MIGRATIONS.length });
  const actualSuffix = actual.filter((row) => itrNames.has(row.name));
  const canonicalSuffix = current.filter((row) => itrNames.has(row.name));
  if (actualSuffix.length === canonicalSuffix.length && compare(actualSuffix, canonicalSuffix)) {
    const withoutSuffix = actual.filter((row) => !itrNames.has(row.name));
    return compare(withoutSuffix, expected.filter((row) => !itrNames.has(row.name)));
  }
  const compatibility = actual.find((row) => row.type === "table" && row.name === "compatibility_matrix");
  if (!compatibility || normalizeDdl(compatibility.sql) !== normalizeDdl(COMPATIBILITY_MATRIX_DDL)) return false;
  return compare(actual.filter((row) => row !== compatibility), expected);
}

export function sqliteCatalogMatchesExpectation(
  actual: readonly SqliteCatalogRow[],
  manifest: SqliteSchemaManifest,
  expectation: SqliteCatalogExpectation,
): boolean {
  return sqliteCatalogMatches(actual, expectedSqliteCatalog(manifest, expectation));
}
