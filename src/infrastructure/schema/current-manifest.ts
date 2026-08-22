import { createHash } from "node:crypto";
import { CORE_MIGRATIONS } from "./core-schema.ts";
import { DATABASE_CONTROL_CHECKSUM, DATABASE_CONTROL_MIGRATIONS } from "./database-control-schema.ts";

export type CurrentSqliteMigration = {
  readonly id: string;
  readonly checksum: string;
  readonly dialect: "sqlite";
  readonly status: "APPLIED";
};

export function computeSqliteMigrationChecksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/** Immutable production migration manifest used by the business compatibility fence. */
export const CURRENT_SQLITE_MIGRATIONS: readonly CurrentSqliteMigration[] = Object.freeze([
  Object.freeze({ id: CORE_MIGRATIONS.id, checksum: computeSqliteMigrationChecksum(CORE_MIGRATIONS.sqlite), dialect: "sqlite" as const, status: "APPLIED" as const }),
  Object.freeze({ id: DATABASE_CONTROL_MIGRATIONS.id, checksum: DATABASE_CONTROL_CHECKSUM, dialect: "sqlite" as const, status: "APPLIED" as const }),
]);

export const CURRENT_SCHEMA_VERSION = 2;
export const CURRENT_DATA_FORMAT_VERSION = 1;
export const CURRENT_DATABASE_GENERATION = 1;
export const CURRENT_DATABASE_REVISION = 1;
export const CURRENT_READER_PROTOCOL_MIN = 1;
export const CURRENT_READER_PROTOCOL_MAX = 1;
export const CURRENT_WRITER_PROTOCOL = 1;

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

/** Canonical JSON used for hashes persisted in migration metadata. */
export function canonicalManifestJson(manifest: SqliteSchemaManifest): string {
  return JSON.stringify(canonicalValue(manifest));
}

/** Stable SHA-256 identity for a complete schema manifest. */
export function schemaManifestHash(manifest: SqliteSchemaManifest): string {
  return createHash("sha256").update(canonicalManifestJson(manifest)).digest("hex");
}

export const hashSchemaManifest = schemaManifestHash;

const freezeManifest = (manifest: SqliteSchemaManifest): SqliteSchemaManifest => Object.freeze({
  ...manifest,
  migrations: Object.freeze(manifest.migrations.map((migration) => Object.freeze({ ...migration }))),
});

/** Immutable production manifest. The production schema remains v2. */
export const CURRENT_SCHEMA_MANIFEST: SqliteSchemaManifest = freezeManifest({
  manifestVersion: 1,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  dataFormatVersion: CURRENT_DATA_FORMAT_VERSION,
  generation: CURRENT_DATABASE_GENERATION,
  revision: CURRENT_DATABASE_REVISION,
  readerCompatibilityMin: CURRENT_READER_PROTOCOL_MIN,
  readerCompatibilityMax: CURRENT_READER_PROTOCOL_MAX,
  writerProtocol: CURRENT_WRITER_PROTOCOL,
  migrations: CURRENT_SQLITE_MIGRATIONS,
});

export const CURRENT_SCHEMA_MANIFEST_HASH = schemaManifestHash(CURRENT_SCHEMA_MANIFEST);
