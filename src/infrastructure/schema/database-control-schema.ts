/**
 * Database control metadata schema for SQLite.
 * Singleton authority table tracking schema versions, compatibility, and state.
 *
 * Immutable design:
 * - Exactly one row (id=1), enforced via PRIMARY KEY CHECK
 * - Cannot be pre-seeded or repaired; initialize() inserts the first row atomically
 * - Binds to exact APPLIED 0002-database-control migration checksum
 * - No silent accepts of partial/malformed state; fails closed
 */

/**
 * Canonical CREATE TABLE statement for database_control.
 * Used as the source of truth for schema validation.
 * No leading comment, no terminal semicolon.
 * Must match sqlite_schema.sql exactly for accepted databases.
 */
export const DATABASE_CONTROL_TABLE_DDL = `CREATE TABLE database_control (
  id INTEGER PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  data_format_version INTEGER NOT NULL,
  reader_compatibility_min INTEGER NOT NULL,
  reader_compatibility_max INTEGER NOT NULL,
  required_writer_protocol INTEGER NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  last_migration_id TEXT NOT NULL,
  last_migration_checksum TEXT NOT NULL,
  last_writer_cli_version TEXT NOT NULL,
  last_writer_build_id TEXT NOT NULL,
  last_writer_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  recovery_reason TEXT,
  CONSTRAINT chk_id_singleton CHECK(id=1),
  CONSTRAINT chk_schema_version CHECK(schema_version>=1 AND typeof(schema_version)='integer'),
  CONSTRAINT chk_data_format_version CHECK(data_format_version>=1 AND typeof(data_format_version)='integer'),
  CONSTRAINT chk_reader_min CHECK(reader_compatibility_min>=1 AND typeof(reader_compatibility_min)='integer'),
  CONSTRAINT chk_reader_max CHECK(reader_compatibility_max>=reader_compatibility_min AND typeof(reader_compatibility_max)='integer'),
  CONSTRAINT chk_writer_protocol CHECK(required_writer_protocol>=1 AND typeof(required_writer_protocol)='integer'),
  CONSTRAINT chk_state CHECK(state IN ('READY','APPLYING','RECOVERY_REQUIRED')),
  CONSTRAINT chk_revision CHECK(revision>=1 AND typeof(revision)='integer'),
  CONSTRAINT chk_generation CHECK(generation>=1 AND typeof(generation)='integer'),
  CONSTRAINT chk_last_migration_id CHECK(trim(last_migration_id)<>''),
  CONSTRAINT chk_checksum_length CHECK(length(last_migration_checksum)=64),
  CONSTRAINT chk_checksum_hex CHECK(last_migration_checksum NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT chk_cli_version CHECK(trim(last_writer_cli_version)<>''),
  CONSTRAINT chk_build_id CHECK(trim(last_writer_build_id)<>''),
  CONSTRAINT chk_writer_at CHECK(trim(last_writer_at)<>''),
  CONSTRAINT chk_created_at CHECK(trim(created_at)<>''),
  CONSTRAINT chk_updated_at CHECK(trim(updated_at)<>''),
  CONSTRAINT chk_recovery_reason_state CHECK(
    CASE
      WHEN state='RECOVERY_REQUIRED' THEN recovery_reason IS NOT NULL AND trim(recovery_reason)<>''
      WHEN state IN ('READY','APPLYING') THEN recovery_reason IS NULL
      ELSE 0
    END
  )
)`;

/**
 * Migration SQL: canonical table DDL used by 0002-database-control migration.
 */
export const DATABASE_CONTROL_SCHEMA_SQLITE = DATABASE_CONTROL_TABLE_DDL;

/**
 * Migration metadata for the database_control schema.
 * Creates exactly the metadata authority table; no initial row inserted.
 * SQLite-only implementation for Phase 1A.
 */
import { createHash } from "crypto";

export const DATABASE_CONTROL_MIGRATIONS = {
  id: "0002-database-control",
  sqlite: DATABASE_CONTROL_SCHEMA_SQLITE,
};

/**
 * Canonical SHA256 checksum of corrected 0002-database-control migration SQL.
 * Immutable after acceptance as production baseline.
 * Databases created with rejected 2c0e399 experimental baseline are unsupported and fail closed.
 */
export function computeDatabaseControlChecksum(): string {
  return createHash("sha256").update(DATABASE_CONTROL_SCHEMA_SQLITE).digest("hex");
}

export const DATABASE_CONTROL_CHECKSUM = computeDatabaseControlChecksum();
