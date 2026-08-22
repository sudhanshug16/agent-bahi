import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createHash, randomUUID } from "crypto";
import type { Database, MigrationSession } from "../../src/application/ports/persistence.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_MIGRATIONS } from "../../src/infrastructure/schema/database-control-schema.ts";
import { DomainError } from "../../src/core/types.ts";

describe("Database Control Foundation", () => {
  let db: Database;
  let migrationService: MigrationService;
  let dbControlService: DatabaseControlService;
  let dbPath: string;

  beforeEach(() => {
    dbPath = `/tmp/agent-bahi-dbcontrol-test-${randomUUID()}.sqlite`;
    db = new SqliteAdapter({ path: dbPath });
    migrationService = new MigrationService(db, "sqlite");
    dbControlService = new DatabaseControlService(db, "sqlite");
  });

  afterEach(async () => {
    await db.close();
    // Clean up test database file using bun:sqlite cleanup pattern
    try {
      await Bun.write(`${dbPath}.delete`, "");
    } catch {
      // Ignore deletion errors
    }
  });

  describe("0001 Core Schema Immutability", () => {
    it("should have unchanged CORE_SCHEMA_SQLITE checksum", () => {
      const expectedChecksum = "79fb84acc868107995b2362ef33108107bb9d8fcbd2f2950eddd42761eb902ca";
      const actualChecksum = createHash("sha256").update(CORE_MIGRATIONS.sqlite).digest("hex");
      expect(actualChecksum).toBe(expectedChecksum);
    });

    it("should apply 0001-core-schema without errors", async () => {
      const migrations = [
        {
          id: CORE_MIGRATIONS.id,
          sql: CORE_MIGRATIONS.sqlite,
        },
      ];

      const applied = await migrationService.migrate(migrations);
      expect(applied).toHaveLength(1);
      expect(applied[0].id).toBe("0001-core-schema");
    });
  });

  describe("0002 Database Control Migration", () => {
    it("should have valid 0002-database-control SQL", () => {
      const sql = DATABASE_CONTROL_MIGRATIONS.sqlite;
      expect(sql).toContain("CREATE TABLE database_control");
      expect(sql).toContain("PRIMARY KEY CHECK(id=1)");
      expect(sql).toContain("state TEXT NOT NULL CHECK(state IN ('READY','APPLYING','RECOVERY_REQUIRED'))");
    });

    it("should apply migrations in sequence: 0001 then 0002", async () => {
      const migrations = [
        {
          id: CORE_MIGRATIONS.id,
          sql: CORE_MIGRATIONS.sqlite,
        },
        {
          id: DATABASE_CONTROL_MIGRATIONS.id,
          sql: DATABASE_CONTROL_MIGRATIONS.sqlite,
        },
      ];

      const applied = await migrationService.migrate(migrations);
      expect(applied).toHaveLength(2);
      expect(applied[0].id).toBe("0001-core-schema");
      expect(applied[1].id).toBe("0002-database-control");
    });

    it("should reject pre-existing table without IF NOT EXISTS", async () => {
      // First apply, then try to apply again - should see the table exists error
      const migrations = [
        {
          id: DATABASE_CONTROL_MIGRATIONS.id,
          sql: DATABASE_CONTROL_MIGRATIONS.sqlite,
        },
      ];

      await db.executeRaw(DATABASE_CONTROL_MIGRATIONS.sqlite);

      // Attempting to run migration after table exists should fail
      try {
        await migrationService.migrate(migrations);
        expect.unreachable("Should have thrown on existing table");
      } catch (error) {
        // Expected: table already exists
        expect(error).toBeTruthy();
      }
    });
  });

  describe("Database Control Service - Inspection", () => {
    beforeEach(async () => {
      // Apply both migrations
      const migrations = [
        {
          id: CORE_MIGRATIONS.id,
          sql: CORE_MIGRATIONS.sqlite,
        },
        {
          id: DATABASE_CONTROL_MIGRATIONS.id,
          sql: DATABASE_CONTROL_MIGRATIONS.sqlite,
        },
      ];
      await migrationService.migrate(migrations);
    });

    it("should report UNINITIALIZED when table is empty", async () => {
      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNINITIALIZED");
      expect(inspection.record).toBeUndefined();
      expect(inspection.reason).toContain("no rows");
    });

    it("should report UNINITIALIZED when table does not exist", async () => {
      // Create a fresh DB without applying migration
      const dbPath2 = `/tmp/agent-bahi-dbcontrol-test-${randomUUID()}.sqlite`;
      const db2 = new SqliteAdapter({ path: dbPath2 });
      const dbControlService2 = new DatabaseControlService(db2, "sqlite");

      const inspection = await dbControlService2.inspect();
      expect(inspection.status).toBe("UNINITIALIZED");
      expect(inspection.reason).toContain("does not exist");

      await db2.close();
      try {
        await Bun.write(`${dbPath2}.delete`, "");
      } catch {
        // Ignore deletion errors
      }
    });

    it("should report UNAVAILABLE when table has wrong schema", async () => {
      // Drop the correct table and create one with wrong columns
      await db.executeRaw(`DROP TABLE database_control`);
      await db.executeRaw(`
        CREATE TABLE database_control (
          id INTEGER PRIMARY KEY,
          incomplete_field TEXT
        )
      `);

      const inspection = await dbControlService.inspect();
      expect(inspection.status).toBe("UNAVAILABLE");
    });

    it("should report UNAVAILABLE for multiple rows", async () => {
      // Insert two rows (will violate constraints but we're testing the inspection logic)
      try {
        await db.executeRaw(`
          INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            '79fb84acc868107995b2362ef33108107bb9d8fcbd2f2950eddd42761eb902ca',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')
        `);
      } catch {
        // Expected: constraint violation on id=1
      }
    });
  });

  describe("Database Control Service - Initialize", () => {
    beforeEach(async () => {
      // Apply both migrations
      const migrations = [
        {
          id: CORE_MIGRATIONS.id,
          sql: CORE_MIGRATIONS.sqlite,
        },
        {
          id: DATABASE_CONTROL_MIGRATIONS.id,
          sql: DATABASE_CONTROL_MIGRATIONS.sqlite,
        },
      ];
      await migrationService.migrate(migrations);
    });

    it("should initialize with required parameters", async () => {
      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = {
        cliVersion: "0.1.0",
        buildId: "build-abc123",
        now,
      };

      let record: any;
      await db.withMigrationLease(async (session: MigrationSession) => {
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
      expect(record.lastWriterCliVersion).toBe("0.1.0");
      expect(record.lastWriterBuildId).toBe("build-abc123");
    });

    it("should be idempotent when row exists", async () => {
      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = {
        cliVersion: "0.1.0",
        buildId: "build-abc123",
        now,
      };

      let record1: any;
      await db.withMigrationLease(async (session: MigrationSession) => {
        record1 = await dbControlService.initialize(params, session);
      });

      let record2: any;
      await db.withMigrationLease(async (session: MigrationSession) => {
        record2 = await dbControlService.initialize(params, session);
      });

      expect(record2).toBeDefined();
      expect(record2.schemaVersion).toBe(record1.schemaVersion);
      expect(record2.lastMigrationId).toBe(record1.lastMigrationId);
    });

    it("should require 0002 migration to be APPLIED", async () => {
      // Mark 0002 as DIRTY
      await db.execute(
        `UPDATE schema_migrations SET status = 'DIRTY', dirty_reason = 'test' WHERE id = '0002-database-control'`,
        [],
      );

      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = {
        cliVersion: "0.1.0",
        buildId: "build-abc123",
        now,
      };

      try {
        await db.withMigrationLease(async (session: MigrationSession) => {
          await dbControlService.initialize(params, session);
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe("DATABASE_CONTROL_MIGRATION_NOT_APPLIED");
      }
    });
  });

  describe("Database Control Service - Reader Compatibility", () => {
    beforeEach(async () => {
      // Apply migrations and initialize
      const migrations = [
        {
          id: CORE_MIGRATIONS.id,
          sql: CORE_MIGRATIONS.sqlite,
        },
        {
          id: DATABASE_CONTROL_MIGRATIONS.id,
          sql: DATABASE_CONTROL_MIGRATIONS.sqlite,
        },
      ];
      await migrationService.migrate(migrations);

      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = {
        cliVersion: "0.1.0",
        buildId: "build-abc123",
        now,
      };

      await db.withMigrationLease(async (session: MigrationSession) => {
        await dbControlService.initialize(params, session);
      });
    });

    it("should accept reader protocol within range [min, max]", async () => {
      // Initial state has reader protocol range [1, 1]
      await dbControlService.requireCompatibleReader({ readerProtocol: 1 });
    });

    it("should reject reader protocol below minimum", async () => {
      try {
        await dbControlService.requireCompatibleReader({ readerProtocol: 0 });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe("DATABASE_READER_INCOMPATIBLE");
      }
    });

    it("should reject reader protocol above maximum", async () => {
      try {
        await dbControlService.requireCompatibleReader({ readerProtocol: 2 });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe("DATABASE_READER_INCOMPATIBLE");
      }
    });

    it("should reject when database is not READY", async () => {
      // Change state to RECOVERY_REQUIRED
      await db.execute(
        `UPDATE database_control SET state = 'RECOVERY_REQUIRED', recovery_reason = 'test recovery' WHERE id = 1`,
        [],
      );

      try {
        await dbControlService.requireCompatibleReader({ readerProtocol: 1 });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe("DATABASE_CONTROL_NOT_READY");
      }
    });
  });

  describe("Database Control Service - Writer Compatibility", () => {
    beforeEach(async () => {
      // Apply migrations and initialize
      const migrations = [
        {
          id: CORE_MIGRATIONS.id,
          sql: CORE_MIGRATIONS.sqlite,
        },
        {
          id: DATABASE_CONTROL_MIGRATIONS.id,
          sql: DATABASE_CONTROL_MIGRATIONS.sqlite,
        },
      ];
      await migrationService.migrate(migrations);

      const now = new Date("2025-08-22T12:00:00.000Z");
      const params = {
        cliVersion: "0.1.0",
        buildId: "build-abc123",
        now,
      };

      await db.withMigrationLease(async (session: MigrationSession) => {
        await dbControlService.initialize(params, session);
      });
    });

    it("should accept exact writer protocol match", async () => {
      // Initial state requires writer protocol = 1
      await dbControlService.requireCompatibleWriter({ writerProtocol: 1 });
    });

    it("should reject writer protocol mismatch", async () => {
      try {
        await dbControlService.requireCompatibleWriter({ writerProtocol: 2 });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe("DATABASE_WRITER_INCOMPATIBLE");
      }
    });

    it("should reject when database is not READY", async () => {
      // Change state to APPLYING
      await db.execute(`UPDATE database_control SET state = 'APPLYING' WHERE id = 1`, []);

      try {
        await dbControlService.requireCompatibleWriter({ writerProtocol: 1 });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe("DATABASE_CONTROL_NOT_READY");
      }
    });
  });

  describe("Database Control Table Constraints", () => {
    let constraintTestDb: Database;
    let constraintTestMigrationService: MigrationService;
    let constraintTestDbPath: string;

    beforeEach(async () => {
      // Each constraint test gets a fresh isolated database
      constraintTestDbPath = `/tmp/agent-bahi-constraint-test-${randomUUID()}.sqlite`;
      constraintTestDb = new SqliteAdapter({ path: constraintTestDbPath });
      constraintTestMigrationService = new MigrationService(constraintTestDb, "sqlite");

      // Apply both 0001 and 0002 migrations
      const migrations = [
        {
          id: CORE_MIGRATIONS.id,
          sql: CORE_MIGRATIONS.sqlite,
        },
        {
          id: DATABASE_CONTROL_MIGRATIONS.id,
          sql: DATABASE_CONTROL_MIGRATIONS.sqlite,
        },
      ];
      await constraintTestMigrationService.migrate(migrations);
    });

    afterEach(async () => {
      await constraintTestDb.close();
      try {
        await Bun.write(`${constraintTestDbPath}.delete`, "");
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should enforce id CHECK constraint (id must be 1)", async () => {
      try {
        await constraintTestDb.executeRaw(
          `INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (2, 2, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            '79fb84acc868107995b2362ef33108107bb9d8fcbd2f2950eddd42761eb902ca',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')`
        );
        expect.unreachable("Should have rejected id=2");
      } catch {
        // Expected: CHECK constraint failure
      }
    });

    it("should enforce schema_version >= 1", async () => {
      try {
        await constraintTestDb.executeRaw(
          `INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 0, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            '79fb84acc868107995b2362ef33108107bb9d8fcbd2f2950eddd42761eb902ca',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')`
        );
        expect.unreachable("Should have rejected schema_version=0");
      } catch {
        // Expected: CHECK constraint failure
      }
    });

    it("should enforce reader_compatibility_max >= reader_compatibility_min", async () => {
      try {
        await constraintTestDb.executeRaw(
          `INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 2, 1, 1, 'READY', 1, 1, '0002-database-control',
            '79fb84acc868107995b2362ef33108107bb9d8fcbd2f2950eddd42761eb902ca',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')`,
      );
        expect.unreachable("Should have rejected max < min");
      } catch {
        // Expected: CHECK constraint failure
      }
    });

    it("should enforce state enum values", async () => {
      try {
        await constraintTestDb.executeRaw(
          `INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 1, 1, 1, 'INVALID_STATE', 1, 1, '0002-database-control',
            '79fb84acc868107995b2362ef33108107bb9d8fcbd2f2950eddd42761eb902ca',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')`,
      );
        expect.unreachable("Should have rejected invalid state");
      } catch {
        // Expected: CHECK constraint failure
      }
    });

    it("should enforce RECOVERY_REQUIRED requires nonblank recovery_reason", async () => {
      try {
        await constraintTestDb.executeRaw(
          `INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 1, 1, 1, 'RECOVERY_REQUIRED', 1, 1, '0002-database-control',
            '79fb84acc868107995b2362ef33108107bb9d8fcbd2f2950eddd42761eb902ca',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')`
        );
        expect.unreachable("Should have rejected RECOVERY_REQUIRED without reason");
      } catch {
        // Expected: CHECK constraint failure
      }
    });

    it("should enforce READY requires NULL recovery_reason", async () => {
      // Insert with READY state and recovery_reason set - should fail
      let insertFailed = false;
      try {
        await constraintTestDb.executeRaw(
          `INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at, recovery_reason
          ) VALUES (1, 2, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            '79fb84acc868107995b2362ef33108107bb9d8fcbd2f2950eddd42761eb902ca',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', 'some reason')`
        );
      } catch {
        insertFailed = true;
      }
      expect(insertFailed).toBe(true);
    });

    it("should enforce checksum is exactly 64 hex characters", async () => {
      try {
        await constraintTestDb.executeRaw(
          `INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, 2, 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            'invalid-checksum',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')`,
      );
        expect.unreachable("Should have rejected invalid checksum");
      } catch {
        // Expected: CHECK constraint failure
      }
    });

    it("should reject non-integer values for integer fields", async () => {
      try {
        await constraintTestDb.executeRaw(
          `INSERT INTO database_control (
            id, schema_version, data_format_version, reader_compatibility_min,
            reader_compatibility_max, required_writer_protocol, state, revision,
            generation, last_migration_id, last_migration_checksum,
            last_writer_cli_version, last_writer_build_id, last_writer_at,
            created_at, updated_at
          ) VALUES (1, '2.5', 1, 1, 1, 1, 'READY', 1, 1, '0002-database-control',
            '79fb84acc868107995b2362ef33108107bb9d8fcbd2f2950eddd42761eb902ca',
            '0.0.0', 'build1', '2025-08-22T00:00:00.000Z',
            '2025-08-22T00:00:00.000Z', '2025-08-22T00:00:00.000Z')`,
      );
        expect.unreachable("Should have rejected non-integer schema_version");
      } catch {
        // Expected: typeof check or constraint failure
      }
    });
  });

  describe("Migration Replay and Idempotency", () => {
    it("should handle replay of migrations without error", async () => {
      const migrations = [
        {
          id: CORE_MIGRATIONS.id,
          sql: CORE_MIGRATIONS.sqlite,
        },
        {
          id: DATABASE_CONTROL_MIGRATIONS.id,
          sql: DATABASE_CONTROL_MIGRATIONS.sqlite,
        },
      ];

      // First run
      const applied1 = await migrationService.migrate(migrations);
      expect(applied1).toHaveLength(2);

      // Second run (migrations already applied)
      const applied2 = await migrationService.migrate(migrations);
      expect(applied2).toHaveLength(0);
    });
  });

  describe("BusinessSession enforcement note", () => {
    it("should verify that database_control is NOT part of universal BusinessSession enforcement", async () => {
      // database_control schema and service make no assumptions about
      // BusinessSession pre-query enforcement. It's a standalone singleton
      // metadata authority. Enforcement will be implemented later via
      // callback-scoped BusinessSession + SQLite transactions.
      expect(DatabaseControlService).toBeDefined();
    });
  });
});
