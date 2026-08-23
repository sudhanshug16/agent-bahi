/** Exact, read-only SQLite state detection. */

import { Database as BunDatabase } from "bun:sqlite";
import { DomainError } from "../../core/types.ts";
import { CURRENT_SCHEMA_MANIFEST, KNOWN_SCHEMA_MANIFESTS, V8_SCHEMA_MANIFEST, type SqliteSchemaManifest } from "../schema/migration-catalog.ts";
import { DATABASE_CONTROL_TABLE_DDL } from "../schema/database-control-schema.ts";
import {
  DRIZZLE_BASELINE_CREATED_AT,
  DRIZZLE_BASELINE_HASH,
  DRIZZLE_MIGRATIONS_TABLE,
  officialDrizzleJournal,
  validateOfficialDrizzleJournalPrefix,
} from "./drizzle-baseline.ts";
import {
  DRIZZLE_MIGRATION_IDS,
  expectedSqliteCatalog,
  readSqliteCatalog,
  sqliteCatalogMatches,
} from "./sqlite-catalog-validator.ts";
import { MIGRATION_SCHEMA_SQLITE } from "./migration-service.ts";

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

function tableDdl(db: BunDatabase, name: string): string | undefined {
  const row = db.prepare("SELECT type, sql FROM sqlite_schema WHERE name = ?").get(name) as { type?: unknown; sql?: string | null } | undefined;
  return row?.type === "table" ? row.sql ?? undefined : undefined;
}

function normalizeDdl(sql: string | null | undefined): string {
  return String(sql ?? "")
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, "")
    .replace(/[`\"]([^`\"]+)[`\"]/g, "$1")
    .replace(/;\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function exactHistory(db: BunDatabase, manifest: SqliteSchemaManifest): boolean {
  if (normalizeDdl(tableDdl(db, "schema_migrations")) !== normalizeDdl(MIGRATION_SCHEMA_SQLITE)) return false;
  const rows = db.prepare("SELECT id, dialect, checksum, status, dirty_reason FROM schema_migrations ORDER BY rowid ASC").all() as Array<Record<string, unknown>>;
  return rows.length === manifest.migrations.length && manifest.migrations.every((migration, index) => {
    const row = rows[index];
    return !!row && row.id === migration.id && row.dialect === migration.dialect
      && row.checksum === migration.checksum && row.status === migration.status && row.dirty_reason === null;
  });
}

function exactControl(
  db: BunDatabase,
  manifest: SqliteSchemaManifest,
  expectedLastId: string,
  expectedLastChecksum: string,
  expectedDdl: string,
): boolean {
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

function exactLegacy(db: BunDatabase, manifest: SqliteSchemaManifest): boolean {
  return exactHistory(db, manifest)
    && exactControl(db, manifest, manifest.migrations.at(-1)!.id, manifest.migrations.at(-1)!.checksum, DATABASE_CONTROL_TABLE_DDL)
    && sqliteCatalogMatches(readSqliteCatalog(db), expectedSqliteCatalog(manifest, { kind: "legacy" }));
}

function exactOfficialPrefix(db: BunDatabase, journalLength: number, bridged: boolean): boolean {
  const rows = db.prepare(`SELECT id, hash, created_at FROM ${DRIZZLE_MIGRATIONS_TABLE} ORDER BY created_at ASC, id ASC`).all() as Array<Record<string, unknown>>;
  if (rows.length !== journalLength) return false;
  try { validateOfficialDrizzleJournalPrefix(rows); } catch { return false; }
  const expectation = { kind: bridged ? "bridged" as const : "drizzle" as const, journalLength };
  const expected = expectedSqliteCatalog(V8_SCHEMA_MANIFEST, expectation);
  const expectedControl = expected.find((row) => row.type === "table" && row.name === "database_control")?.sql;
  const journal = officialDrizzleJournal()[journalLength - 1];
  if (!journal) return false;
  return exactControl(db, V8_SCHEMA_MANIFEST, DRIZZLE_MIGRATION_IDS[journalLength - 1]!, journal.hash, expectedControl ?? "")
    && sqliteCatalogMatches(readSqliteCatalog(db), expected);
}

function exactBridged(db: BunDatabase): boolean {
  return exactHistory(db, V8_SCHEMA_MANIFEST) && exactOfficialPrefix(db, officialDrizzleJournal().length, true);
}

/** Detect state without creating tables, repairing rows, or running migrations. */
export function detectDatabaseState(db: BunDatabase): DatabaseStateSummary {
  try {
    const has = (name: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    const hasLegacyMigrations = has("schema_migrations");
    const hasDrizzleMigrations = has(DRIZZLE_MIGRATIONS_TABLE);
    if (!hasLegacyMigrations && !hasDrizzleMigrations && !has("database_control")) return { state: "EMPTY", hasLegacyMigrations: false, hasDrizzleMigrations: false };

    const drizzleMigrationCount = hasDrizzleMigrations ? Number((db.prepare(`SELECT COUNT(*) AS count FROM ${DRIZZLE_MIGRATIONS_TABLE}`).get() as { count: number | bigint }).count) : undefined;
    const legacyMigrationCount = hasLegacyMigrations ? Number((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number | bigint }).count) : undefined;

    if (hasLegacyMigrations) {
      if (hasDrizzleMigrations) {
        return exactBridged(db)
          ? { state: "DRIZZLE_BRIDGED", schemaVersion: 8, hasLegacyMigrations: true, hasDrizzleMigrations: true, legacyMigrationCount, drizzleMigrationCount }
          : { state: "UNKNOWN", hasLegacyMigrations: true, hasDrizzleMigrations: true, legacyMigrationCount, drizzleMigrationCount };
      }
      const manifest = KNOWN_SCHEMA_MANIFESTS.find((candidate) => exactLegacy(db, candidate));
      if (!manifest) return { state: "UNKNOWN", hasLegacyMigrations: true, hasDrizzleMigrations: false, legacyMigrationCount };
      const state = (["LEGACY_V2", "LEGACY_V3", "LEGACY_V4", "LEGACY_V5", "LEGACY_V6", "LEGACY_V7", "CUSTOM_V8_WITHOUT_DRIZZLE"] as const)[manifest.schemaVersion - 2];
      return state ? { state, schemaVersion: manifest.schemaVersion, hasLegacyMigrations: true, hasDrizzleMigrations: false, legacyMigrationCount } : { state: "UNKNOWN", hasLegacyMigrations: true, hasDrizzleMigrations: false, legacyMigrationCount };
    }

    if (hasDrizzleMigrations) {
      for (let journalLength = 1; journalLength <= officialDrizzleJournal().length; journalLength += 1) {
        if (exactOfficialPrefix(db, journalLength, false)) {
          return { state: "DRIZZLE_MANAGED", schemaVersion: 8, hasLegacyMigrations: false, hasDrizzleMigrations: true, drizzleMigrationCount };
        }
      }
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
