import { createHash } from "node:crypto";
import { CORE_MIGRATIONS } from "./core-schema.ts";
import { DATABASE_CONTROL_CHECKSUM, DATABASE_CONTROL_MIGRATIONS } from "./database-control-schema.ts";
import { BOOKSET_V3_MIGRATION } from "./bookset-v3-migration.ts";
import { BOOKSET_V4_MIGRATION } from "./bookset-v4-migration.ts";
import { JOURNAL_V5_MIGRATION } from "./journal-v5-migration.ts";
import { SALES_V6_MIGRATION } from "./sales-v6-migration.ts";
import { PURCHASE_V7_MIGRATION } from "./purchase-v7-migration.ts";
import { BANK_RECONCILIATION_V8_MIGRATION } from "./bank-reconciliation-v8-migration.ts";
import { CLOSE_PACK_V9_MIGRATION } from "./close-pack-v9-migration.ts";
import type { MigrationDefinition, MigrationVerificationManifest } from "../../application/ports/persistence.ts";
import type { UpgradePlan, UpgradePreflightProbe } from "../../application/ports/upgrade.ts";

export type CurrentSqliteMigration = {
  readonly id: string;
  readonly checksum: string;
  readonly dialect: "sqlite";
  readonly status: "APPLIED";
};

export interface SqliteSchemaManifest {
  readonly manifestVersion: number;
  readonly schemaVersion: number;
  readonly dataFormatVersion: number;
  readonly generation: number;
  readonly revision: number;
  readonly readerCompatibilityMin: number;
  readonly readerCompatibilityMax: number;
  readonly writerProtocol: number;
  readonly migrations: readonly CurrentSqliteMigration[];
}

export interface MigrationCatalogEntry {
  readonly sequence: number;
  readonly id: string;
  readonly sqlite: string;
  readonly manifest?: MigrationVerificationManifest;
  readonly schemaVersion: number;
  readonly dataFormatVersion: number;
  readonly generation: number;
  readonly revision: number;
  readonly readerCompatibilityMin: number;
  readonly readerCompatibilityMax: number;
  readonly writerProtocol: number;
  readonly preflightProbes?: readonly UpgradePreflightProbe[];
}

const foundationMetadata = {
  dataFormatVersion: 1,
  generation: 1,
  revision: 1,
  readerCompatibilityMin: 1,
  readerCompatibilityMax: 1,
  writerProtocol: 1,
} as const;

/**
 * The only ordered registration of production SQLite migrations.  Migration
 * SQL remains owned by the individual definition modules; this catalog owns
 * their order and compatibility metadata without filesystem discovery.
 */
export const MIGRATION_CATALOG: readonly MigrationCatalogEntry[] = Object.freeze([
  Object.freeze({ sequence: 1, id: CORE_MIGRATIONS.id, sqlite: CORE_MIGRATIONS.sqlite, schemaVersion: 2, ...foundationMetadata }),
  Object.freeze({ sequence: 2, id: DATABASE_CONTROL_MIGRATIONS.id, sqlite: DATABASE_CONTROL_MIGRATIONS.sqlite, schemaVersion: 2, ...foundationMetadata }),
  Object.freeze({
    sequence: 3,
    id: BOOKSET_V3_MIGRATION.id,
    sqlite: BOOKSET_V3_MIGRATION.sqlite,
    manifest: BOOKSET_V3_MIGRATION.manifest,
    schemaVersion: 3,
    ...foundationMetadata,
    revision: 2,
    preflightProbes: Object.freeze([{
      id: "source-book-sets-table",
      sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'book_sets' LIMIT 1",
      expectedRows: [{ table_count: "1" }],
    }]),
  }),
  Object.freeze({
    sequence: 4,
    id: BOOKSET_V4_MIGRATION.id,
    sqlite: BOOKSET_V4_MIGRATION.sqlite,
    manifest: BOOKSET_V4_MIGRATION.manifest,
    schemaVersion: 4,
    ...foundationMetadata,
    revision: 3,
    preflightProbes: Object.freeze([{
      id: "target-audit-records-table",
      sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'audit_records' LIMIT 1",
      expectedRows: [{ table_count: "1" }],
    }]),
  }),
  Object.freeze({
    sequence: 5,
    id: JOURNAL_V5_MIGRATION.id,
    sqlite: JOURNAL_V5_MIGRATION.sqlite,
    manifest: JOURNAL_V5_MIGRATION.manifest,
    schemaVersion: 5,
    ...foundationMetadata,
    revision: 4,
    preflightProbes: Object.freeze([{
      id: "source-audit-records-table",
      sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'audit_records' LIMIT 1",
      expectedRows: [{ table_count: "1" }],
    }]),
  }),
  Object.freeze({
    sequence: 6,
    id: SALES_V6_MIGRATION.id,
    sqlite: SALES_V6_MIGRATION.sqlite,
    manifest: SALES_V6_MIGRATION.manifest,
    schemaVersion: 6,
    ...foundationMetadata,
    revision: 5,
    preflightProbes: Object.freeze([{
      id: "source-journal-entries-table",
      sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'journal_entries' LIMIT 1",
      expectedRows: [{ table_count: "1" }],
    }]),
  }),
  Object.freeze({
    sequence: 7,
    id: PURCHASE_V7_MIGRATION.id,
    sqlite: PURCHASE_V7_MIGRATION.sqlite,
    manifest: PURCHASE_V7_MIGRATION.manifest,
    schemaVersion: 7,
    ...foundationMetadata,
    revision: 6,
    preflightProbes: Object.freeze([{
      id: "source-sales-invoices-table",
      sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'sales_invoices' LIMIT 1",
      expectedRows: [{ table_count: "1" }],
    }]),
  }),
  Object.freeze({
    sequence: 8,
    id: BANK_RECONCILIATION_V8_MIGRATION.id,
    sqlite: BANK_RECONCILIATION_V8_MIGRATION.sqlite,
    manifest: BANK_RECONCILIATION_V8_MIGRATION.manifest,
    schemaVersion: 8,
    ...foundationMetadata,
    revision: 7,
    preflightProbes: Object.freeze([{
      id: "source-vendor-payments-table",
      sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'vendor_payments' LIMIT 1",
      expectedRows: [{ table_count: "1" }],
    }]),
  }),
  Object.freeze({
    sequence: 9,
    id: CLOSE_PACK_V9_MIGRATION.id,
    sqlite: CLOSE_PACK_V9_MIGRATION.sqlite,
    manifest: CLOSE_PACK_V9_MIGRATION.manifest,
    schemaVersion: 9,
    ...foundationMetadata,
    revision: 8,
    preflightProbes: Object.freeze([{
      id: "source-period-close-events-table",
      sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'period_close_events' LIMIT 1",
      expectedRows: [{ table_count: "1" }],
    }]),
  }),
]);

export function computeSqliteMigrationChecksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function freezeManifest(manifest: SqliteSchemaManifest): SqliteSchemaManifest {
  return Object.freeze({
    ...manifest,
    migrations: Object.freeze(manifest.migrations.map((migration) => Object.freeze({ ...migration }))),
  });
}

function migrationRow(entry: MigrationCatalogEntry): CurrentSqliteMigration {
  return Object.freeze({
    id: entry.id,
    checksum: entry.id === DATABASE_CONTROL_MIGRATIONS.id ? DATABASE_CONTROL_CHECKSUM : computeSqliteMigrationChecksum(entry.sqlite),
    dialect: "sqlite",
    status: "APPLIED",
  });
}

function manifestForPrefix(entries: readonly MigrationCatalogEntry[], prefixLength: number): SqliteSchemaManifest {
  const last = entries[prefixLength - 1];
  if (!last) throw new Error("Migration catalog prefix is empty");
  return freezeManifest({
    manifestVersion: 1,
    schemaVersion: last.schemaVersion,
    dataFormatVersion: last.dataFormatVersion,
    generation: last.generation,
    revision: last.revision,
    readerCompatibilityMin: last.readerCompatibilityMin,
    readerCompatibilityMax: last.readerCompatibilityMax,
    writerProtocol: last.writerProtocol,
    migrations: entries.slice(0, prefixLength).map(migrationRow),
  });
}

function definitionForEntry(entry: MigrationCatalogEntry): MigrationDefinition {
  return Object.freeze({ id: entry.id, sql: entry.sqlite, ...(entry.manifest ? { manifest: entry.manifest } : {}) });
}

function generatedManifests(entries: readonly MigrationCatalogEntry[]): readonly SqliteSchemaManifest[] {
  const manifests: SqliteSchemaManifest[] = [];
  let previousSchemaVersion = -1;
  entries.forEach((entry, index) => {
    if (index === 1 || (index > 1 && entry.schemaVersion !== previousSchemaVersion)) {
      manifests.push(manifestForPrefix(entries, index + 1));
      previousSchemaVersion = entry.schemaVersion;
    }
  });
  return Object.freeze(manifests);
}

function generatedUpgradeSteps(entries: readonly MigrationCatalogEntry[], manifests: readonly SqliteSchemaManifest[]): readonly UpgradePlan[] {
  const bySchema = new Map(manifests.map((manifest) => [manifest.schemaVersion, manifest]));
  const steps = entries.filter((entry, index) => index > 0 && entry.schemaVersion !== entries[index - 1]?.schemaVersion).map((entry) => {
    const sourceManifest = bySchema.get(entry.schemaVersion - 1);
    const targetManifest = bySchema.get(entry.schemaVersion);
    if (!sourceManifest || !targetManifest) throw new Error(`Migration catalog cannot create ${entry.id} upgrade step`);
    return Object.freeze({
      sourceManifest,
      targetManifest,
      migration: definitionForEntry(entry),
      preflightProbes: Object.freeze([...(entry.preflightProbes ?? [])]),
      targetVerificationProbes: entry.manifest?.probes,
    });
  });
  return Object.freeze(steps);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Validates catalog topology and generated compatibility identities. */
export function validateMigrationCatalog(entries: readonly MigrationCatalogEntry[] = MIGRATION_CATALOG): void {
  if (entries.length < 2) throw new Error("Migration catalog requires foundation migrations");
  const ids = new Set<string>();
  entries.forEach((entry, index) => {
    if (entry.sequence !== index + 1) throw new Error("Migration catalog sequences must be contiguous and ordered");
    if (!/^\d{4}-[^\s]+$/.test(entry.id)) throw new Error(`Migration catalog id is invalid: ${entry.id}`);
    if (ids.has(entry.id)) throw new Error(`Migration catalog contains duplicate id: ${entry.id}`);
    ids.add(entry.id);
    if (entry.schemaVersion < 2 || entry.revision < 1 || entry.dataFormatVersion < 1 || entry.generation < 1) {
      throw new Error(`Migration catalog metadata is invalid for ${entry.id}`);
    }
    if (entry.manifest && entry.manifest.dialect !== "sqlite") throw new Error(`Migration manifest dialect is invalid for ${entry.id}`);
    const checksum = migrationRow(entry).checksum;
    if (!/^[0-9a-f]{64}$/.test(checksum)) throw new Error(`Migration checksum is invalid for ${entry.id}`);
  });
  if (entries[0].schemaVersion !== entries[1].schemaVersion) throw new Error("Foundation migrations must share one schema version");
  for (let index = 2; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const entry = entries[index];
    if (entry.schemaVersion !== previous.schemaVersion + 1 || entry.revision !== previous.revision + 1) {
      throw new Error(`Migration ${entry.id} must advance schema and revision exactly one step`);
    }
  }
  const manifests = generatedManifests(entries);
  for (let index = 1; index < manifests.length; index += 1) {
    const source = manifests[index - 1];
    const target = manifests[index];
    if (target.migrations.length !== source.migrations.length + 1) throw new Error("Generated upgrade must append exactly one migration");
    if (!source.migrations.every((migration, migrationIndex) => sameJson(migration, target.migrations[migrationIndex]))) {
      throw new Error("Generated manifests must be exact ordered prefixes");
    }
  }
  const latest = manifests.at(-1);
  const latestEntry = entries.at(-1);
  if (!latest || !latestEntry || latest.migrations.at(-1)?.id !== latestEntry.id || latest.schemaVersion !== latestEntry.schemaVersion || latest.revision !== latestEntry.revision) {
    throw new Error("Latest migration manifest is inconsistent with the catalog");
  }
  for (const step of generatedUpgradeSteps(entries, manifests)) {
    const source = step.sourceManifest.migrations;
    const target = step.targetManifest.migrations;
    if (target.length !== source.length + 1 || step.migration.id !== target.at(-1)?.id || computeSqliteMigrationChecksum(step.migration.sql) !== target.at(-1)?.checksum) {
      throw new Error("Generated upgrade step does not match its one-step manifest");
    }
  }
}

validateMigrationCatalog();

export const FOUNDATION_MIGRATIONS: readonly MigrationDefinition[] = Object.freeze(MIGRATION_CATALOG.slice(0, 2).map(definitionForEntry));
export const HISTORICAL_SCHEMA_MANIFESTS = generatedManifests(MIGRATION_CATALOG);
export const KNOWN_SCHEMA_MANIFESTS = HISTORICAL_SCHEMA_MANIFESTS;
export const ORDERED_UPGRADE_STEPS = generatedUpgradeSteps(MIGRATION_CATALOG, HISTORICAL_SCHEMA_MANIFESTS);
export const CURRENT_SQLITE_MIGRATIONS = Object.freeze(HISTORICAL_SCHEMA_MANIFESTS.at(-1)!.migrations);
export const CURRENT_SCHEMA_MANIFEST = HISTORICAL_SCHEMA_MANIFESTS.at(-1)!;
export const CURRENT_SCHEMA_MANIFEST_HASH = schemaManifestHash(CURRENT_SCHEMA_MANIFEST);
export const CURRENT_SCHEMA_VERSION = CURRENT_SCHEMA_MANIFEST.schemaVersion;
export const CURRENT_DATA_FORMAT_VERSION = CURRENT_SCHEMA_MANIFEST.dataFormatVersion;
export const CURRENT_DATABASE_GENERATION = CURRENT_SCHEMA_MANIFEST.generation;
export const CURRENT_DATABASE_REVISION = CURRENT_SCHEMA_MANIFEST.revision;
export const CURRENT_READER_PROTOCOL_MIN = CURRENT_SCHEMA_MANIFEST.readerCompatibilityMin;
export const CURRENT_READER_PROTOCOL_MAX = CURRENT_SCHEMA_MANIFEST.readerCompatibilityMax;
export const CURRENT_WRITER_PROTOCOL = CURRENT_SCHEMA_MANIFEST.writerProtocol;

export const V2_SCHEMA_MANIFEST = HISTORICAL_SCHEMA_MANIFESTS[0];
export const V3_SCHEMA_MANIFEST = HISTORICAL_SCHEMA_MANIFESTS[1];
export const V4_SCHEMA_MANIFEST = HISTORICAL_SCHEMA_MANIFESTS[2];
export const V5_SCHEMA_MANIFEST = HISTORICAL_SCHEMA_MANIFESTS[3];
export const V6_SCHEMA_MANIFEST = HISTORICAL_SCHEMA_MANIFESTS[4];
export const V7_SCHEMA_MANIFEST = HISTORICAL_SCHEMA_MANIFESTS[5];
export const V8_SCHEMA_MANIFEST = HISTORICAL_SCHEMA_MANIFESTS[6];
export const V9_SCHEMA_MANIFEST = HISTORICAL_SCHEMA_MANIFESTS[7];
export const V3_SCHEMA_VERSION = V3_SCHEMA_MANIFEST.schemaVersion;
export const V3_DATABASE_REVISION = V3_SCHEMA_MANIFEST.revision;
export const V4_SCHEMA_VERSION = V4_SCHEMA_MANIFEST.schemaVersion;
export const V4_DATABASE_REVISION = V4_SCHEMA_MANIFEST.revision;
export const V5_SCHEMA_VERSION = V5_SCHEMA_MANIFEST.schemaVersion;
export const V5_DATABASE_REVISION = V5_SCHEMA_MANIFEST.revision;
export const V6_SCHEMA_VERSION = V6_SCHEMA_MANIFEST.schemaVersion;
export const V6_DATABASE_REVISION = V6_SCHEMA_MANIFEST.revision;

function canonicalValue(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]));
  }
  return value;
}

export function canonicalManifestJson(manifest: SqliteSchemaManifest): string {
  return JSON.stringify(canonicalValue(manifest));
}

export function schemaManifestHash(manifest: SqliteSchemaManifest): string {
  return createHash("sha256").update(canonicalManifestJson(manifest)).digest("hex");
}

export const hashSchemaManifest = schemaManifestHash;

export const BOOKSET_V3_UPGRADE_PLAN = ORDERED_UPGRADE_STEPS[0];
export const BOOKSET_V4_UPGRADE_PLAN = ORDERED_UPGRADE_STEPS[1];
export const JOURNAL_V5_UPGRADE_PLAN = ORDERED_UPGRADE_STEPS[2];
export const SALES_V6_UPGRADE_PLAN = ORDERED_UPGRADE_STEPS[3];
export const PURCHASE_V7_UPGRADE_PLAN = ORDERED_UPGRADE_STEPS[4];
export const BANK_RECONCILIATION_V8_UPGRADE_PLAN = ORDERED_UPGRADE_STEPS[5];

export function createBookSetV3UpgradePlan(): UpgradePlan { return BOOKSET_V3_UPGRADE_PLAN; }
export function createBookSetV4UpgradePlan(): UpgradePlan { return BOOKSET_V4_UPGRADE_PLAN; }
export function createJournalV5UpgradePlan(): UpgradePlan { return JOURNAL_V5_UPGRADE_PLAN; }
