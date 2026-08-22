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

export const DATABASE_CONTROL_SCHEMA_SQLITE = `
-- Database control: singleton metadata authority
CREATE TABLE database_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  schema_version INTEGER NOT NULL CHECK(schema_version>=1) CHECK(typeof(schema_version)='integer'),
  data_format_version INTEGER NOT NULL CHECK(data_format_version>=1) CHECK(typeof(data_format_version)='integer'),
  reader_compatibility_min INTEGER NOT NULL CHECK(reader_compatibility_min>=1) CHECK(typeof(reader_compatibility_min)='integer'),
  reader_compatibility_max INTEGER NOT NULL CHECK(reader_compatibility_max>=reader_compatibility_min) CHECK(typeof(reader_compatibility_max)='integer'),
  required_writer_protocol INTEGER NOT NULL CHECK(required_writer_protocol>=1) CHECK(typeof(required_writer_protocol)='integer'),
  state TEXT NOT NULL CHECK(state IN ('READY','APPLYING','RECOVERY_REQUIRED')),
  revision INTEGER NOT NULL CHECK(revision>=1) CHECK(typeof(revision)='integer'),
  generation INTEGER NOT NULL CHECK(generation>=1) CHECK(typeof(generation)='integer'),
  last_migration_id TEXT NOT NULL,
  last_migration_checksum TEXT NOT NULL CHECK(length(last_migration_checksum)=64) CHECK(last_migration_checksum GLOB '[0-9a-f]*'),
  last_writer_cli_version TEXT NOT NULL,
  last_writer_build_id TEXT NOT NULL,
  last_writer_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  recovery_reason TEXT,
  CHECK(
    CASE
      WHEN state='RECOVERY_REQUIRED' THEN recovery_reason IS NOT NULL
      WHEN state IN ('READY','APPLYING') THEN recovery_reason IS NULL
      ELSE 0
    END
  )
);
`;

/**
 * Migration metadata for the database_control schema.
 * Creates exactly the metadata authority table; no initial row inserted.
 * SQLite-only implementation for Phase 1A.
 */
export const DATABASE_CONTROL_MIGRATIONS = {
  id: "0002-database-control",
  sqlite: DATABASE_CONTROL_SCHEMA_SQLITE,
};
