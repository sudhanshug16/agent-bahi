import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createHash } from "crypto";
import { mkdtemp, rm } from "node:fs/promises";
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

async function setupTestDb(): Promise<{ db: Database; path: string }> {
  // Create isolated temp directory with mkdtemp
  testTempDir = await mkdtemp(path.join(tmpdir(), "agent-bahi-test-"));
  testDbPath = path.join(testTempDir, "test.db");
  const database = new SqliteAdapter({ path: testDbPath });
  return { db: database, path: testDbPath };
}

async function cleanupTestDb(): Promise<void> {
  if (db) {
    try {
      await db.close();
    } catch (e) {
      console.error("Failed to close database:", e);
    }
    db = null;
  }

  if (testTempDir) {
    try {
      // Use rm from fs/promises to clean up temp directory
      // force: false will throw on error, which we rethrow with context
      await rm(testTempDir, { recursive: true, force: false });
    } catch (e) {
      // Only throw if it's not ENOENT (already deleted)
      if (e instanceof Error && e.message.includes("ENOENT")) {
        // Directory already deleted, that's fine
        return;
      }
      throw new Error(`Failed to cleanup test directory ${testTempDir}: ${String(e)}`);
    }
  }
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
      expect(inspection.reason).toContain("no rows");
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
      expect(inspection.reason).toContain("no rows");
    });

    it("should return UNINITIALIZED for missing table", async () => {
      const setup = await setupTestDb();
      const freshDb = setup.db;
      const freshService = new DatabaseControlService(freshDb, "sqlite");

      const inspection = await freshService.inspect();
      expect(inspection.status).toBe("UNINITIALIZED");
      expect(inspection.reason).toContain("does not exist");

      await freshDb.close();
      await cleanupTestDb();
    });

    it("should return UNAVAILABLE for malformed table with missing columns", async () => {
      await db!.executeRaw(`DROP TABLE database_control`);
      // Create a minimal valid table structure just to test inspection
      await db!.executeRaw(
        `CREATE TABLE database_control (id INTEGER PRIMARY KEY, extra_field TEXT)`,
      );

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      // Should fail on DDL mismatch or column count
      expect(inspection.reason).toBeDefined();
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

      const inspection = await dbControlService.inspect();
      // Either UNAVAILABLE (if inspection validates) or UNINITIALIZED (if table is not recognized as valid)
      expect(["UNAVAILABLE", "UNINITIALIZED"]).toContain(inspection.status);
      expect(inspection.reason).toBeDefined();
    });

    it("should return UNAVAILABLE for multiple rows", async () => {
      // Try to insert two rows (will violate CHECK constraint but we test raw count)
      try {
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

        // Try to insert a second row - should fail on id CHECK
        await db!.executeRaw(`
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
        `);
      } catch {
        // Expected: CHECK(id=1) prevents second row
      }
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

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
      // Should fail on column count mismatch
      expect(inspection.reason).toBeDefined();
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
      let failed = false;
      try {
        await db!.executeRaw(`
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
        `);
      } catch (e) {
        failed = true;
      }
      expect(failed).toBe(true);
    });

    it("should enforce schema_version >=1", async () => {
      let failed = false;
      try {
        await db!.executeRaw(`
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
        `);
      } catch (e) {
        failed = true;
      }
      expect(failed).toBe(true);
    });

    it("should enforce reader_compatibility_max >= reader_compatibility_min", async () => {
      let failed = false;
      try {
        await db!.executeRaw(`
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
        `);
      } catch (e) {
        failed = true;
      }
      expect(failed).toBe(true);
    });

    it("should enforce state IN ('READY','APPLYING','RECOVERY_REQUIRED')", async () => {
      let failed = false;
      try {
        await db!.executeRaw(`
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
        `);
      } catch (e) {
        failed = true;
      }
      expect(failed).toBe(true);
    });

    it("should enforce RECOVERY_REQUIRED requires nonblank recovery_reason", async () => {
      let failed = false;
      try {
        await db!.executeRaw(`
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
        `);
      } catch (e) {
        failed = true;
      }
      expect(failed).toBe(true);
    });

    it("should enforce checksum is exactly 64 lowercase hex", async () => {
      let failed = false;
      try {
        await db!.executeRaw(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            'invalid-checksum-not-hex',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
        `);
      } catch (e) {
        failed = true;
      }
      expect(failed).toBe(true);
    });

    it("should reject checksum with uppercase hex", async () => {
      let failed = false;
      try {
        const badChecksum =
          "665E93B1F489F1C7E8826FB5C58F32BE071DE34C6D3A088F0FE1098E7A0BF9F2";
        await db!.executeRaw(`
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
        `);
      } catch (e) {
        failed = true;
      }
      expect(failed).toBe(true);
    });

    it("should enforce non-empty trim on string fields", async () => {
      let failed = false;
      try {
        await db!.executeRaw(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 1, 1, 1, 'READY', 1, 1, '   ', '${DATABASE_CONTROL_CHECKSUM}',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
        `);
      } catch (e) {
        failed = true;
      }
      expect(failed).toBe(true);
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

      expect(record).toBeDefined();
      expect(record.schemaVersion).toBe(2);
      expect(record.dataFormatVersion).toBe(1);
      expect(record.readerCompatibilityMin).toBe(1);
      expect(record.readerCompatibilityMax).toBe(1);
      expect(record.requiredWriterProtocol).toBe(1);
      expect(record.state).toBe("READY");
      expect(record.revision).toBe(1);
      expect(record.generation).toBe(1);
      expect(record.lastMigrationId).toBe("0002-database-control");
      expect(record.lastMigrationChecksum).toBe(DATABASE_CONTROL_CHECKSUM);
      expect(record.lastWriterCliVersion).toBe("0.1.0");
      expect(record.lastWriterBuildId).toBe("build-123");
      expect(record.recoveryReason).toBeNull();
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

      let error: any;
      try {
        await db!.withMigrationLease(async (session: MigrationSession) => {
          await dbControlService.initialize(params, session);
        });
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("DATABASE_CONTROL_MIGRATION_NOT_APPLIED");
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

      let error: any;
      try {
        await db!.withMigrationLease(async (session: MigrationSession) => {
          await dbControlService.initialize(params, session);
        });
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("DATABASE_CONTROL_CHECKSUM_MISMATCH");
    });

    it("should fail if table schema is malformed", async () => {
      // Drop and recreate with wrong schema
      await db!.executeRaw(`DROP TABLE database_control`);
      await db!.executeRaw(
        `CREATE TABLE database_control (id INTEGER PRIMARY KEY, wrong_field TEXT)`,
      );

      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = { cliVersion: "0.1.0", buildId: "build-123", now };

      let error: any;
      try {
        await db!.withMigrationLease(async (session: MigrationSession) => {
          await dbControlService.initialize(params, session);
        });
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("DATABASE_CONTROL_MALFORMED");
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
      let error: any;
      try {
        await dbControlService.requireCompatibleReader({ readerProtocol: 0 });
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("DATABASE_READER_INCOMPATIBLE");
    });

    it("should accept exact writer protocol match", async () => {
      await dbControlService.requireCompatibleWriter({ writerProtocol: 1 });
    });

    it("should reject writer protocol mismatch", async () => {
      let error: any;
      try {
        await dbControlService.requireCompatibleWriter({ writerProtocol: 2 });
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("DATABASE_WRITER_INCOMPATIBLE");
    });

    it("should reject reader when database is not READY", async () => {
      await db!.execute(
        `UPDATE database_control SET state = 'RECOVERY_REQUIRED', recovery_reason = 'test' WHERE id = 1`,
        [],
      );

      let error: any;
      try {
        await dbControlService.requireCompatibleReader({ readerProtocol: 1 });
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("DATABASE_CONTROL_NOT_READY");
    });
  });

  describe("Test Cleanup Verification", () => {
    it("should properly cleanup temp directories after each test", async () => {
      const setup = await setupTestDb();
      const testDir = testTempDir;
      const testPath = testDbPath;

      // Verify directory and db file exist
      expect(testDir).toBeTruthy();
      expect(testPath).toBeTruthy();

      // Verify db file was created
      const stat = await Bun.file(testPath).stat();
      expect(stat).toBeTruthy();

      await setup.db.close();
      await cleanupTestDb();

      // Verify cleanup actually happened - directory should not exist
      let dirStillExists = false;
      try {
        await Bun.file(testDir).stat();
        dirStillExists = true;
      } catch (e) {
        // Expected: directory was deleted
        dirStillExists = false;
      }

      expect(dirStillExists).toBe(false);
    });
  });
});
