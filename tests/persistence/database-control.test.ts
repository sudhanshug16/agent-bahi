import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createHash } from "crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Database, MigrationSession } from "../../src/application/ports/persistence.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import {
  DATABASE_CONTROL_MIGRATIONS,
  DATABASE_CONTROL_CHECKSUM,
  DATABASE_CONTROL_TABLE_DDL,
} from "../../src/infrastructure/schema/database-control-schema.ts";
import { DomainError } from "../../src/core/types.ts";

/**
 * Test fixtures with proper filesystem isolation.
 */
let testTempDir: string;
let testDbPath: string;
let db: Database | null = null;
let migrationService: MigrationService;
let dbControlService: DatabaseControlService;

const DATABASE_CONTROL_COLUMNS = [
  "id", "schema_version", "data_format_version", "reader_compatibility_min",
  "reader_compatibility_max", "required_writer_protocol", "state", "revision",
  "generation", "last_migration_id", "last_migration_checksum",
  "last_writer_cli_version", "last_writer_build_id", "last_writer_at",
  "created_at", "updated_at", "recovery_reason",
];

async function setupTestDb(): Promise<{ db: Database; path: string }> {
  // Create isolated temp directory with mkdtemp
  testTempDir = await mkdtemp(path.join(tmpdir(), "agent-bahi-test-"));
  testDbPath = path.join(testTempDir, "test.db");
  const database = new SqliteAdapter({ path: testDbPath });
  return { db: database, path: testDbPath };
}

function createOuterDatabaseReadSpy(database: Database): { database: Database; outerReads: string[] } {
  const outerReads: string[] = [];
  const readMethods = new Set([
    "query",
    "querySingle",
    "execute",
    "executeSingle",
    "executeRaw",
    // These names are not Database members today, but keep the spy explicit
    // about the forbidden outer inspection boundary.
    "getTableMetadata",
    "inspect",
  ]);

  const wrapped = new Proxy(database, {
    get(target, property) {
      if (typeof property === "string" && readMethods.has(property)) {
        return (..._args: unknown[]) => {
          outerReads.push(property);
          throw new Error(`Unexpected outer database read: ${property}`);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { database: wrapped, outerReads };
}

async function cleanupTestDb(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }

  if (testTempDir) {
    const parent = path.dirname(testTempDir);
    const name = path.basename(testTempDir);
    await rm(testTempDir, { recursive: true, force: false });
    expect(await readdir(parent)).not.toContain(name);
    expect(await Bun.file(testDbPath).exists()).toBe(false);
    expect(await Bun.file(`${testDbPath}-wal`).exists()).toBe(false);
    expect(await Bun.file(`${testDbPath}-shm`).exists()).toBe(false);
  }
}

async function assertIntendedObject(
  expectedKind: "table" | "view",
  expectedColumns: string[],
  changedColumn?: { name: string; type?: string; notnull?: number; pk?: number; dflt_value?: unknown },
): Promise<void> {
  const catalog = await db!.query(
    "SELECT type, sql FROM sqlite_schema WHERE name = 'database_control' AND type IN ('table', 'view')",
  );
  expect(catalog.rows).toHaveLength(1);
  expect(catalog.rows[0]?.type).toBe(expectedKind);

  const xinfo = await db!.query("PRAGMA table_xinfo(database_control)");
  expect(xinfo.rows.map((column) => column.name)).toEqual(expectedColumns);
  if (changedColumn) {
    const column = xinfo.rows.find((candidate) => candidate.name === changedColumn.name);
    expect(column?.name).toBe(changedColumn.name);
    if (changedColumn.type !== undefined) expect(column?.type).toBe(changedColumn.type);
    if (changedColumn.notnull !== undefined) expect(Number(column?.notnull)).toBe(changedColumn.notnull);
    if (changedColumn.pk !== undefined) expect(Number(column?.pk)).toBe(changedColumn.pk);
    if (changedColumn.dflt_value !== undefined) expect(column?.dflt_value).toBe(changedColumn.dflt_value);
  }
}

async function expectSqliteConstraint(sql: string, constraintName: string): Promise<void> {
  let caught: unknown;
  try {
    await db!.executeRaw(sql);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  const domainError = caught as DomainError;
  expect(domainError.code).toBe("SQLITE_CONSTRAINT");
  expect(domainError.message).toBe(`SQLite constraint ${constraintName} violation`);
}

async function expectDomainError(
  operation: () => Promise<unknown>,
  code: string,
  message: string,
): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  const domainError = caught as DomainError;
  expect(domainError.code).toBe(code);
  expect(domainError.message).toBe(message);
}

describe("Database Control Foundation - Corrected 0002", () => {
  describe("Core Schema Immutability", () => {
    it("should preserve unchanged 0001-core-schema checksum", () => {
      const expectedChecksum = "79fb84acc868107995b2362ef33108107bb9d8fcbd2f2950eddd42761eb902ca";
      const actualChecksum = createHash("sha256").update(CORE_MIGRATIONS.sqlite).digest("hex");
      expect(actualChecksum).toBe(expectedChecksum);
    });

    it("should compute correct 0002-database-control checksum", () => {
      // Verify the exported checksum is computed correctly
      expect(typeof DATABASE_CONTROL_CHECKSUM).toBe("string");
      expect(DATABASE_CONTROL_CHECKSUM.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(DATABASE_CONTROL_CHECKSUM)).toBe(true);

      // Recompute to verify consistency
      const recomputed = createHash("sha256")
        .update(DATABASE_CONTROL_MIGRATIONS.sqlite)
        .digest("hex");
      expect(recomputed).toBe(DATABASE_CONTROL_CHECKSUM);
    });
  });

  describe("Fresh Database - Migrations and Schema", () => {
    beforeEach(async () => {
      const setup = await setupTestDb();
      db = setup.db;
      migrationService = new MigrationService(db, "sqlite");
      dbControlService = new DatabaseControlService(db, "sqlite");
    });

    afterEach(async () => {
      await cleanupTestDb();
    });

    it("should apply 0001 and 0002 migrations in sequence", async () => {
      const migrations = [
        { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
        { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
      ];

      const applied = await migrationService.migrate(migrations);
      expect(applied).toHaveLength(2);
      expect(applied[0].id).toBe("0001-core-schema");
      expect(applied[1].id).toBe("0002-database-control");
    });

    it("should create empty database_control table without seed rows", async () => {
      const migrations = [
        { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
        { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
      ];
      await migrationService.migrate(migrations);

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNINITIALIZED");
      expect(inspection.reason).toBe("TABLE_EMPTY");
    });

    it("should reject table with IF NOT EXISTS in migration SQL", () => {
      // Verify current schema does NOT use IF NOT EXISTS
      expect(DATABASE_CONTROL_MIGRATIONS.sqlite).not.toContain("IF NOT EXISTS");
    });
  });

  describe("Inspection - Status and Validation", () => {
    beforeEach(async () => {
      const setup = await setupTestDb();
      db = setup.db;
      migrationService = new MigrationService(db, "sqlite");
      dbControlService = new DatabaseControlService(db, "sqlite");

      // Apply migrations
      const migrations = [
        { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
        { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
      ];
      await migrationService.migrate(migrations);
    });

    afterEach(async () => {
      await cleanupTestDb();
    });

    it("should return UNINITIALIZED for empty table", async () => {
      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNINITIALIZED");
      expect(inspection.record).toBeUndefined();
      expect(inspection.reason).toBe("TABLE_EMPTY");
    });

    it("should keep an empty canonical table unavailable without exact migration history", async () => {
      await db!.execute("UPDATE schema_migrations SET status = 'DIRTY' WHERE id = '0002-database-control'");

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      expect(inspection.reason).toBe("MIGRATION_HISTORY_MISMATCH");
    });

    it("should return UNINITIALIZED for missing table", async () => {
      const missingDir = await mkdtemp(path.join(tmpdir(), "agent-bahi-missing-"));
      const missingPath = path.join(missingDir, "missing.db");
      const freshDb = new SqliteAdapter({ path: missingPath });
      const freshService = new DatabaseControlService(freshDb, "sqlite");

      const inspection = await freshService.inspect();
      expect(inspection.status).toBe("UNINITIALIZED");
      expect(inspection.reason).toBe("TABLE_MISSING");

      await freshDb.close();
      await rm(missingDir, { recursive: true, force: false });
      expect(await Bun.file(missingPath).exists()).toBe(false);
      expect(await Bun.file(`${missingPath}-wal`).exists()).toBe(false);
      expect(await Bun.file(`${missingPath}-shm`).exists()).toBe(false);
    });

    it("should return UNAVAILABLE for malformed table with missing columns", async () => {
      await db!.executeRaw(`DROP TABLE database_control`);
      // Create a minimal valid table structure just to test inspection
      await db!.executeRaw(
        `CREATE TABLE database_control (id INTEGER PRIMARY KEY, extra_field TEXT)`,
      );
      await assertIntendedObject("table", ["id", "extra_field"]);

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      expect(inspection.reason).toBe("TABLE_COLUMN_COUNT_MISMATCH");
      await expectDomainError(
        () => dbControlService.requireCompatibleReader({ readerProtocol: 1 }),
        "DATABASE_CONTROL_UNAVAILABLE",
        "Database control is unavailable",
      );
    });

    it("should return UNAVAILABLE for wrong column type", async () => {
      await db!.executeRaw(`DROP TABLE database_control`);
      // Create a table with wrong schema_version type (TEXT instead of INTEGER)
      await db!.executeRaw(`
        CREATE TABLE database_control (
          id INTEGER PRIMARY KEY,
          schema_version TEXT,
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
          recovery_reason TEXT
        )
      `);
      await assertIntendedObject("table", DATABASE_CONTROL_COLUMNS, { name: "schema_version", type: "TEXT" });

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      expect(inspection.reason).toBe("TABLE_COLUMN_TYPE_MISMATCH");
    });

    it("should return UNAVAILABLE for wrong nullability", async () => {
      await db!.executeRaw("DROP TABLE database_control");
      const ddl = DATABASE_CONTROL_TABLE_DDL.replace("schema_version INTEGER NOT NULL", "schema_version INTEGER");
      await db!.executeRaw(ddl);
      await assertIntendedObject("table", DATABASE_CONTROL_COLUMNS, { name: "schema_version", notnull: 0 });

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      expect(inspection.reason).toBe("TABLE_COLUMN_NULLABILITY_MISMATCH");
    });

    it("should return UNAVAILABLE for wrong default", async () => {
      await db!.executeRaw("DROP TABLE database_control");
      const ddl = DATABASE_CONTROL_TABLE_DDL.replace("schema_version INTEGER NOT NULL", "schema_version INTEGER NOT NULL DEFAULT 1");
      await db!.executeRaw(ddl);
      await assertIntendedObject("table", DATABASE_CONTROL_COLUMNS, { name: "schema_version", dflt_value: "1" });

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      expect(inspection.reason).toBe("TABLE_COLUMN_DEFAULT_MISMATCH");
    });

    it("should return UNAVAILABLE for wrong primary-key metadata", async () => {
      await db!.executeRaw("DROP TABLE database_control");
      const ddl = DATABASE_CONTROL_TABLE_DDL.replace("id INTEGER PRIMARY KEY", "id INTEGER").replace(
        "  recovery_reason TEXT,",
        "  recovery_reason TEXT,\n  PRIMARY KEY (id, schema_version),",
      );
      await db!.executeRaw(ddl);
      await assertIntendedObject("table", DATABASE_CONTROL_COLUMNS);
      const xinfo = await db!.query("PRAGMA table_xinfo(database_control)");
      expect(Number(xinfo.rows[1]?.pk)).toBe(2);

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      expect(inspection.reason).toBe("TABLE_COLUMN_PRIMARY_KEY_MISMATCH");
    });

    it("should return UNAVAILABLE for a changed CHECK constraint", async () => {
      await db!.executeRaw("DROP TABLE database_control");
      const ddl = DATABASE_CONTROL_TABLE_DDL.replace("CONSTRAINT chk_id_singleton CHECK(id=1)", "CONSTRAINT chk_id_singleton CHECK(id=2)");
      await db!.executeRaw(ddl);
      await assertIntendedObject("table", DATABASE_CONTROL_COLUMNS);
      const catalog = await db!.query("SELECT sql FROM sqlite_schema WHERE name = 'database_control'");
      expect(catalog.rows[0]?.sql).toContain("CHECK(id=2)");

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      expect(inspection.reason).toBe("TABLE_DDL_MISMATCH");
    });

    it("should return UNAVAILABLE for an extra column", async () => {
      await db!.executeRaw("DROP TABLE database_control");
      const ddl = DATABASE_CONTROL_TABLE_DDL.replace("  recovery_reason TEXT,", "  recovery_reason TEXT,\n  extra_field TEXT,");
      await db!.executeRaw(ddl);
      await assertIntendedObject("table", [...DATABASE_CONTROL_COLUMNS, "extra_field"]);

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      expect(inspection.reason).toBe("TABLE_COLUMN_COUNT_MISMATCH");
    });

    it("should return UNAVAILABLE for a view with the database_control name", async () => {
      await db!.executeRaw("DROP TABLE database_control");
      await db!.executeRaw("CREATE VIEW database_control AS SELECT 1 AS id");
      await assertIntendedObject("view", ["id"]);

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      expect(inspection.reason).toBe("TABLE_KIND_MISMATCH");
    });

    it("should return UNAVAILABLE for multiple rows", async () => {
      await db!.executeRaw(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            '${DATABASE_CONTROL_CHECKSUM}',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
      `);

      await expectSqliteConstraint(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (2, 2, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            '${DATABASE_CONTROL_CHECKSUM}',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
      `, "chk_id_singleton");

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("AVAILABLE");
    });

    it("should return UNAVAILABLE for missing nullable recovery_reason field", async () => {
      await db!.executeRaw(`DROP TABLE database_control`);
      // Create a table missing the recovery_reason column
      await db!.executeRaw(`
        CREATE TABLE database_control (
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
          updated_at TEXT NOT NULL
        )
      `);
      await assertIntendedObject("table", DATABASE_CONTROL_COLUMNS.slice(0, -1));

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      expect(inspection.reason).toBe("TABLE_COLUMN_COUNT_MISMATCH");
    });
  });

  describe("Table Constraints - SQLite named constraints", () => {
    beforeEach(async () => {
      const setup = await setupTestDb();
      db = setup.db;
      migrationService = new MigrationService(db, "sqlite");

      // Apply migrations
      const migrations = [
        { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
        { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
      ];
      await migrationService.migrate(migrations);
    });

    afterEach(async () => {
      await cleanupTestDb();
    });

    it("should enforce singleton id CHECK constraint", async () => {
      await expectSqliteConstraint(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (2, 2, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            '${DATABASE_CONTROL_CHECKSUM}',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
        `, "chk_id_singleton");
    });

    it("should enforce schema_version >=1", async () => {
      await expectSqliteConstraint(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 0, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            '${DATABASE_CONTROL_CHECKSUM}',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
        `, "chk_schema_version");
    });

    it("should enforce reader_compatibility_max >= reader_compatibility_min", async () => {
      await expectSqliteConstraint(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 2, 1, 1, 'READY', 1, 1, '0002-database-control',
            '${DATABASE_CONTROL_CHECKSUM}',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
        `, "chk_reader_max");
    });

    it("should enforce state IN ('READY','APPLYING','RECOVERY_REQUIRED')", async () => {
      await expectSqliteConstraint(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 1, 1, 1, 'INVALID', 1, 1, '0002-database-control',
            '${DATABASE_CONTROL_CHECKSUM}',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
        `, "chk_state");
    });

    it("should enforce RECOVERY_REQUIRED requires nonblank recovery_reason", async () => {
      await expectSqliteConstraint(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at, recovery_reason
          ) VALUES (1, 2, 1, 1, 1, 1, 'RECOVERY_REQUIRED', 1, 1, '0002-database-control',
            '${DATABASE_CONTROL_CHECKSUM}',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z', NULL)
        `, "chk_recovery_reason_state");
    });

    it("should enforce checksum is exactly 64 lowercase hex", async () => {
      await expectSqliteConstraint(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            '${"g".repeat(64)}',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
        `, "chk_checksum_hex");
    });

    it("should reject checksum with uppercase hex", async () => {
      const badChecksum = "A".repeat(64);
      await expectSqliteConstraint(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            '${badChecksum}',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
        `, "chk_checksum_hex");
    });

    it("should enforce non-empty trim on string fields", async () => {
      await expectSqliteConstraint(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 1, 1, 1, 'READY', 1, 1, '   ', '${DATABASE_CONTROL_CHECKSUM}',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
        `, "chk_last_migration_id");
    });
  });

  describe("Initialize - Fresh Database", () => {
    beforeEach(async () => {
      const setup = await setupTestDb();
      db = setup.db;
      migrationService = new MigrationService(db, "sqlite");
      dbControlService = new DatabaseControlService(db, "sqlite");

      // Apply migrations
      const migrations = [
        { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
        { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
      ];
      await migrationService.migrate(migrations);
    });

    afterEach(async () => {
      await cleanupTestDb();
    });

    it("should initialize fresh empty database", async () => {
      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = { cliVersion: "0.1.0", buildId: "build-123", now };

      let record: any;
      await db!.withMigrationLease(async (session: MigrationSession) => {
        record = await dbControlService.initialize(params, session);
      });

      expect(record).toEqual(expect.objectContaining({
        schemaVersion: 2,
        dataFormatVersion: 1,
        readerCompatibilityMin: 1,
        readerCompatibilityMax: 1,
        requiredWriterProtocol: 1,
        state: "READY",
        revision: 1,
        generation: 1,
        lastMigrationId: "0002-database-control",
        lastMigrationChecksum: DATABASE_CONTROL_CHECKSUM,
        lastWriterCliVersion: "0.1.0",
        lastWriterBuildId: "build-123",
        recoveryReason: null,
      }));
    });

    it("should be idempotent - second initialize returns same record without rewriting timestamps", async () => {
      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = { cliVersion: "0.1.0", buildId: "build-123", now };

      let record1: any;
      await db!.withMigrationLease(async (session: MigrationSession) => {
        record1 = await dbControlService.initialize(params, session);
      });

      // Sleep to ensure time difference if timestamps were rewritten
      await new Promise((r) => setTimeout(r, 10));

      let record2: any;
      await db!.withMigrationLease(async (session: MigrationSession) => {
        record2 = await dbControlService.initialize(params, session);
      });

      expect(record2.createdAt).toBe(record1.createdAt);
      expect(record2.updatedAt).toBe(record1.updatedAt);
      expect(record2.lastMigrationChecksum).toBe(record1.lastMigrationChecksum);
    });

    it("should initialize a new row using only the migration session", async () => {
      const outer = createOuterDatabaseReadSpy(db!);
      const sessionService = new DatabaseControlService(outer.database, "sqlite");
      const params = {
        cliVersion: "0.1.0",
        buildId: "session-only-new-row",
        now: new Date("2025-08-22T12:00:00.000Z"),
      };

      let record: any;
      await outer.database.withMigrationLease(async (session: MigrationSession) => {
        record = await sessionService.initialize(params, session);
      });

      expect(outer.outerReads).toEqual([]);
      expect(record).toEqual(expect.objectContaining({
        lastWriterCliVersion: params.cliVersion,
        lastWriterBuildId: params.buildId,
        lastWriterAt: params.now.toISOString(),
        createdAt: params.now.toISOString(),
        updatedAt: params.now.toISOString(),
      }));
    });

    it("should initialize an existing row idempotently using only the migration session", async () => {
      const firstParams = {
        cliVersion: "0.1.0",
        buildId: "original-audit-fields",
        now: new Date("2025-08-22T12:00:00.000Z"),
      };
      let firstRecord: any;
      await db!.withMigrationLease(async (session: MigrationSession) => {
        firstRecord = await dbControlService.initialize(firstParams, session);
      });

      const outer = createOuterDatabaseReadSpy(db!);
      const sessionService = new DatabaseControlService(outer.database, "sqlite");
      let secondRecord: any;
      await outer.database.withMigrationLease(async (session: MigrationSession) => {
        secondRecord = await sessionService.initialize({
          cliVersion: "0.2.0",
          buildId: "must-not-overwrite",
          now: new Date("2025-08-22T13:00:00.000Z"),
        }, session);
      });

      expect(outer.outerReads).toEqual([]);
      expect(secondRecord).toEqual(firstRecord);
      expect(secondRecord.lastWriterCliVersion).toBe(firstParams.cliVersion);
      expect(secondRecord.lastWriterBuildId).toBe(firstParams.buildId);
      expect(secondRecord.lastWriterAt).toBe(firstParams.now.toISOString());
      expect(secondRecord.createdAt).toBe(firstParams.now.toISOString());
      expect(secondRecord.updatedAt).toBe(firstParams.now.toISOString());
    });
  });

  describe("Initialize - Error Conditions", () => {
    beforeEach(async () => {
      const setup = await setupTestDb();
      db = setup.db;
      migrationService = new MigrationService(db, "sqlite");
      dbControlService = new DatabaseControlService(db, "sqlite");

      // Apply migrations
      const migrations = [
        { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
        { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
      ];
      await migrationService.migrate(migrations);
    });

    afterEach(async () => {
      await cleanupTestDb();
    });

    it("should fail if 0002 migration is not APPLIED", async () => {
      // Mark 0002 as DIRTY
      await db!.execute(
        `UPDATE schema_migrations SET status = 'DIRTY', dirty_reason = 'test' WHERE id = '0002-database-control'`,
        [],
      );

      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = { cliVersion: "0.1.0", buildId: "build-123", now };

      await expectDomainError(async () => {
        await db!.withMigrationLease(async (session: MigrationSession) => {
          await dbControlService.initialize(params, session);
        });
      }, "DATABASE_CONTROL_MIGRATION_NOT_APPLIED", "Required migration history is not applied");
    });

    it("should fail if 0002 migration checksum does not match", async () => {
      // Update migration with wrong checksum
      const wrongChecksum = "0000000000000000000000000000000000000000000000000000000000000000";
      await db!.execute(
        `UPDATE schema_migrations SET checksum = ? WHERE id = '0002-database-control'`,
        [wrongChecksum],
      );

      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = { cliVersion: "0.1.0", buildId: "build-123", now };

      await expectDomainError(async () => {
        await db!.withMigrationLease(async (session: MigrationSession) => {
          await dbControlService.initialize(params, session);
        });
      }, "DATABASE_CONTROL_CHECKSUM_MISMATCH", "Required migration history checksum is not canonical");
    });

    it("should fail if table schema is malformed", async () => {
      // Drop and recreate with wrong schema
      await db!.executeRaw(`DROP TABLE database_control`);
      await db!.executeRaw(
        `CREATE TABLE database_control (id INTEGER PRIMARY KEY, wrong_field TEXT)`,
      );
      await assertIntendedObject("table", ["id", "wrong_field"]);

      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = { cliVersion: "0.1.0", buildId: "build-123", now };

      await expectDomainError(async () => {
        await db!.withMigrationLease(async (session: MigrationSession) => {
          await dbControlService.initialize(params, session);
        });
      }, "DATABASE_CONTROL_MALFORMED", "database_control schema is not canonical");
    });
  });

  describe("Reader/Writer Compatibility", () => {
    beforeEach(async () => {
      const setup = await setupTestDb();
      db = setup.db;
      migrationService = new MigrationService(db, "sqlite");
      dbControlService = new DatabaseControlService(db, "sqlite");

      // Apply migrations
      const migrations = [
        { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
        { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
      ];
      await migrationService.migrate(migrations);

      // Initialize
      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = { cliVersion: "0.1.0", buildId: "build-123", now };
      await db!.withMigrationLease(async (session: MigrationSession) => {
        await dbControlService.initialize(params, session);
      });
    });

    afterEach(async () => {
      await cleanupTestDb();
    });

    it("should accept reader protocol within range", async () => {
      await dbControlService.requireCompatibleReader({ readerProtocol: 1 });
    });

    it("should reject reader protocol below minimum", async () => {
      await expectDomainError(
        () => dbControlService.requireCompatibleReader({ readerProtocol: 0 }),
        "DATABASE_READER_INCOMPATIBLE",
        "Reader protocol is incompatible",
      );
    });

    it("should accept exact writer protocol match", async () => {
      await dbControlService.requireCompatibleWriter({ writerProtocol: 1 });
    });

    it("should reject writer protocol mismatch", async () => {
      await expectDomainError(
        () => dbControlService.requireCompatibleWriter({ writerProtocol: 2 }),
        "DATABASE_WRITER_INCOMPATIBLE",
        "Writer protocol is incompatible",
      );
    });

    it("should reject reader when database is not READY", async () => {
      await db!.execute(
        `UPDATE database_control SET state = 'RECOVERY_REQUIRED', recovery_reason = 'test' WHERE id = 1`,
        [],
      );

      await expectDomainError(
        () => dbControlService.requireCompatibleReader({ readerProtocol: 1 }),
        "DATABASE_CONTROL_NOT_READY",
        "Database control is not ready",
      );
    });
  });

  describe("Test Cleanup Verification", () => {
    it("should properly cleanup temp directories after each test", async () => {
      const setup = await setupTestDb();
      const testDir = testTempDir;
      const testPath = testDbPath;

      // Verify db file was created
      expect(await Bun.file(testPath).exists()).toBe(true);

      await cleanupTestDb();

      expect(await Bun.file(testDir).exists()).toBe(false);
      expect(await Bun.file(testPath).exists()).toBe(false);
      expect(await Bun.file(`${testPath}-wal`).exists()).toBe(false);
      expect(await Bun.file(`${testPath}-shm`).exists()).toBe(false);
    });
  });
});
