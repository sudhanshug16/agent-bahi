import { Database as BunDatabase } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqliteSchemaManifest } from "../schema/migration-catalog.ts";
import { MIGRATION_CATALOG } from "../schema/migration-catalog.ts";
import { MIGRATION_SCHEMA_SQLITE, RECOVERY_AUDIT_SCHEMA_SQLITE } from "./migration-service.ts";
import {
  DRIZZLE_BASELINE_MIGRATION_ID,
  DRIZZLE_CLOSE_PACK_V1_MIGRATION_ID,
  DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_MIGRATION_ID,
  DRIZZLE_EXPENSE_CLAIMS_V1_MIGRATION_ID,
  DRIZZLE_FIXED_ASSETS_MIGRATION_ID,
  DRIZZLE_FX_V1_MIGRATION_ID,
  DRIZZLE_GST_RETURN_READINESS_V1_MIGRATION_ID,
  DRIZZLE_GST_V1_MIGRATION_ID,
  DRIZZLE_PAYROLL_V1_MIGRATION_ID,
  DRIZZLE_PERIOD_CLOSE_V1_MIGRATION_ID,
  DRIZZLE_TDS_TCS_MIGRATION_ID,
  DRIZZLE_TENANT_PAN_V1_MIGRATION_ID,
  DRIZZLE_JOURNAL_DDL,
} from "./drizzle-baseline.ts";

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

const DRIZZLE_DIRECTORY = join(import.meta.dir, "../../..", "drizzle");
export const DRIZZLE_MIGRATION_IDS = [
  DRIZZLE_BASELINE_MIGRATION_ID,
  DRIZZLE_GST_V1_MIGRATION_ID,
  DRIZZLE_TDS_TCS_MIGRATION_ID,
  DRIZZLE_FIXED_ASSETS_MIGRATION_ID,
  DRIZZLE_FX_V1_MIGRATION_ID,
  DRIZZLE_PAYROLL_V1_MIGRATION_ID,
  DRIZZLE_EXPENSE_CLAIMS_V1_MIGRATION_ID,
  DRIZZLE_GST_RETURN_READINESS_V1_MIGRATION_ID,
  DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_MIGRATION_ID,
  DRIZZLE_PERIOD_CLOSE_V1_MIGRATION_ID,
  DRIZZLE_TENANT_PAN_V1_MIGRATION_ID,
  DRIZZLE_CLOSE_PACK_V1_MIGRATION_ID,
] as const;

const drizzleSql = new Map(DRIZZLE_MIGRATION_IDS.map((id) => [
  id,
  readFileSync(join(DRIZZLE_DIRECTORY, `${id}.sql`), "utf8"),
]));

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
      if (!Number.isSafeInteger(expectation.journalLength) || expectation.journalLength < 1 || expectation.journalLength > DRIZZLE_MIGRATION_IDS.length) {
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
      for (const id of DRIZZLE_MIGRATION_IDS.slice(start, expectation.journalLength)) splitAndExecute(memory, drizzleSql.get(id)!);
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
