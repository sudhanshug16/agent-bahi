/**
 * Compatibility exports for callers that historically imported manifests from
 * this module. The ordered definitions and all generated identities live in
 * migration-catalog.ts.
 */
export {
  BOOKSET_V3_UPGRADE_PLAN,
  BOOKSET_V4_UPGRADE_PLAN,
  CURRENT_DATA_FORMAT_VERSION,
  CURRENT_DATABASE_GENERATION,
  CURRENT_DATABASE_REVISION,
  CURRENT_READER_PROTOCOL_MAX,
  CURRENT_READER_PROTOCOL_MIN,
  CURRENT_SCHEMA_MANIFEST,
  CURRENT_SCHEMA_MANIFEST_HASH,
  CURRENT_SCHEMA_VERSION,
  CURRENT_SQLITE_MIGRATIONS,
  CURRENT_WRITER_PROTOCOL,
  HISTORICAL_SCHEMA_MANIFESTS,
  JOURNAL_V5_UPGRADE_PLAN,
  KNOWN_SCHEMA_MANIFESTS,
  V2_SCHEMA_MANIFEST,
  V3_DATABASE_REVISION,
  V3_SCHEMA_MANIFEST,
  V3_SCHEMA_VERSION,
  V4_DATABASE_REVISION,
  V4_SCHEMA_MANIFEST,
  V4_SCHEMA_VERSION,
  V5_DATABASE_REVISION,
  V5_SCHEMA_MANIFEST,
  V5_SCHEMA_VERSION,
  V6_DATABASE_REVISION,
  V6_SCHEMA_MANIFEST,
  V6_SCHEMA_VERSION,
  V7_SCHEMA_MANIFEST,
  canonicalManifestJson,
  computeSqliteMigrationChecksum,
  hashSchemaManifest,
  schemaManifestHash,
} from "./migration-catalog.ts";
export type { CurrentSqliteMigration, SqliteSchemaManifest } from "./migration-catalog.ts";
