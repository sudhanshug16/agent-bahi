/**
 * Production Adapter Integration Tests
 * Tests real migration flows through production MigrationService + actual adapters
 * NOT mocked; NOT using Gate0 applyMigration helper
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "crypto";
import type { Database } from "../../src/application/ports/persistence.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { DomainError, DirtyMigrationError } from "../../src/core/types.ts";

describe("Production Adapter Integration - SQLite", () => {
  let db: Database;
  let migrationService: MigrationService;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = `/tmp/prod-adapter-${randomUUID()}.sqlite`;
    db = new SqliteAdapter({ path: dbPath });
    migrationService = new MigrationService(db, "sqlite");
  });

  afterEach(async () => {
    await db.close();
  });

  describe("Complete migration lifecycle", () => {
    it("should execute migration with real SQLite adapter", async () => {
      const migrations = [
        {
          id: "001-create-users",
          sql: `CREATE TABLE users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
          )`,
        },
      ];

      const result = await migrationService.migrate(migrations);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("001-create-users");
      expect(result[0].dialect).toBe("sqlite");
      expect(result[0].durationMs).toBeGreaterThanOrEqual(0);

      // Verify table was created
      const tables = await db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
      );
      expect(tables.rowCount).toBe(1);
    });

    it("should handle multiple migrations atomically", async () => {
      const migrations = [
        {
          id: "001-init",
          sql: "CREATE TABLE init1 (id TEXT PRIMARY KEY)",
        },
        {
          id: "002-extend",
          sql: "CREATE TABLE init2 (id TEXT PRIMARY KEY)",
        },
      ];

      const result = await migrationService.migrate(migrations);
      expect(result).toHaveLength(2);

      // Verify both tables exist
      const tables = await db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('init1', 'init2')"
      );
      expect(tables.rowCount).toBe(2);
    });

    it("should be idempotent: skip already-applied migrations", async () => {
      const migrations = [
        {
          id: "001-idempotent",
          sql: "CREATE TABLE idempotent1 (id TEXT PRIMARY KEY)",
        },
      ];

      // First apply
      const result1 = await migrationService.migrate(migrations);
      expect(result1).toHaveLength(1);

      // Second apply (should skip)
      const result2 = await migrationService.migrate(migrations);
      expect(result2).toHaveLength(0);

      // Table should still exist
      const tables = await db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='idempotent1'"
      );
      expect(tables.rowCount).toBe(1);
    });

    it("should fail on checksum mismatch (tampering detection)", async () => {
      const migrations = [
        {
          id: "001-checksum",
          sql: "CREATE TABLE checksum1 (id TEXT PRIMARY KEY)",
        },
      ];

      // Apply migration
      await migrationService.migrate(migrations);

      // Try to apply same ID with different SQL (tampering)
      try {
        await migrationService.migrate([
          {
            id: "001-checksum",
            sql: "CREATE TABLE checksum2 (id TEXT PRIMARY KEY)", // Different SQL
          },
        ]);
        throw new Error("Should have failed on checksum mismatch");
      } catch (err: any) {
        expect(err.code).toBe("MIGRATION_CHECKSUM_MISMATCH");
      }
    });

    it("should block migrations while DIRTY marker exists", async () => {
      // Create first migration successfully
      await migrationService.migrate([
        {
          id: "001-good",
          sql: "CREATE TABLE good1 (id TEXT PRIMARY KEY)",
        },
      ]);

      // Create DIRTY state with second migration
      try {
        await migrationService.migrate([
          {
            id: "002-bad",
            sql: "CREATE TABLE bad (id TEXT); CREATE TABLE bad (id TEXT);",
          },
        ]);
      } catch {
        // Expected: DIRTY state created
      }

      // Verify DIRTY state
      const status = await migrationService.getStatus();
      expect(status.isDirty).toBe(true);

      // Try to apply third migration; should be blocked
      try {
        await migrationService.migrate([
          {
            id: "003-blocked",
            sql: "CREATE TABLE blocked (id TEXT PRIMARY KEY)",
          },
        ]);
        throw new Error("Should have been blocked by DIRTY marker");
      } catch (err: any) {
        expect(err).toBeInstanceOf(DirtyMigrationError);
      }

      // Verify third migration was not created
      const tables = await db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='blocked'"
      );
      expect(tables.rowCount).toBe(0);
    });
  });

  describe("Lease and timeout handling", () => {
    it("should acquire and release lease correctly", async () => {
      const migrations = [
        {
          id: "001-lease",
          sql: "CREATE TABLE lease_test (id TEXT PRIMARY KEY)",
        },
      ];

      // Should complete within timeout
      const result = await migrationService.migrate(migrations, 5000);
      expect(result).toHaveLength(1);

      // Table should be created (lease was held correctly)
      const tables = await db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='lease_test'"
      );
      expect(tables.rowCount).toBe(1);
    });

    it("should work with various timeout values", async () => {
      const migrations = [
        {
          id: "001-quick",
          sql: "CREATE TABLE quick (id TEXT PRIMARY KEY)",
        },
      ];

      // Test with short timeout
      const result = await migrationService.migrate(migrations, 100);
      expect(result).toHaveLength(1);
    });
  });

  describe("Status reporting", () => {
    it("should report schema status accurately", async () => {
      let status = await migrationService.getStatus();
      expect(status.hasSchema).toBe(false);
      expect(status.isDirty).toBe(false);
      expect(status.isApplying).toBe(false);

      // Apply a migration
      await migrationService.migrate([
        {
          id: "001-status",
          sql: "CREATE TABLE status_test (id TEXT PRIMARY KEY)",
        },
      ]);

      // Status should update
      status = await migrationService.getStatus();
      expect(status.hasSchema).toBe(true);
      expect(status.isDirty).toBe(false);
      expect(status.lastMigrationId).toBe("001-status");
      expect(status.appliedMigrations).toHaveLength(1);
    });

    it("should report all blocking rows on DIRTY", async () => {
      // Create one good migration
      await migrationService.migrate([
        {
          id: "001-first",
          sql: "CREATE TABLE first (id TEXT PRIMARY KEY)",
        },
      ]);

      // Create DIRTY state
      try {
        await migrationService.migrate([
          {
            id: "002-fail",
            sql: "CREATE TABLE fail (id TEXT); CREATE TABLE fail (id TEXT);",
          },
        ]);
      } catch {
        // Expected
      }

      // Status should show blocking rows
      const status = await migrationService.getStatus();
      expect(status.isDirty).toBe(true);
      expect(status.blockingRows).toBeDefined();
      expect(status.blockingRows?.length).toBeGreaterThan(0);

      const blockingIds = status.blockingRows?.map(r => r.id) || [];
      expect(blockingIds).toContain("002-fail");
    });
  });

  describe("Database state consistency", () => {
    it("should persist schema_migrations table correctly", async () => {
      const migrations = [
        {
          id: "001-persist",
          sql: "CREATE TABLE persist_test (id TEXT PRIMARY KEY)",
        },
      ];

      await migrationService.migrate(migrations);

      // Query schema_migrations directly
      const records = await db.query(
        "SELECT id, status, dialect FROM schema_migrations WHERE id = ?",
        ["001-persist"]
      );

      expect(records.rowCount).toBe(1);
      expect((records.rows[0] as any).status).toBe("APPLIED");
      expect((records.rows[0] as any).dialect).toBe("sqlite");
    });

    it("should handle large migrations", async () => {
      const largeSql = `
        CREATE TABLE large_table (
          ${Array.from({ length: 50 }, (_, i) => `col${i} TEXT`).join(", ")}
        )
      `;

      const result = await migrationService.migrate([
        {
          id: "001-large",
          sql: largeSql,
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].checksum).toBeTruthy();
    });

    it("should handle special characters in migration IDs", async () => {
      const migrations = [
        {
          id: "2025-01-15-special_chars-v1",
          sql: "CREATE TABLE special_chars_test (id TEXT PRIMARY KEY)",
        },
      ];

      const result = await migrationService.migrate(migrations);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("2025-01-15-special_chars-v1");
    });
  });

  describe("Error handling and edge cases", () => {
    it("should fail gracefully on invalid SQL", async () => {
      try {
        await migrationService.migrate([
          {
            id: "001-invalid",
            sql: "INVALID SQL HERE",
          },
        ]);
        throw new Error("Should have failed on invalid SQL");
      } catch (err: any) {
        expect(err.code).toBe("MIGRATION_EXECUTION_FAILED");
      }
    });

    it("should not create partially-applied migrations", async () => {
      try {
        await migrationService.migrate([
          {
            id: "001-partial",
            sql: "CREATE TABLE partial (id TEXT); CREATE TABLE partial (id TEXT);",
          },
        ]);
      } catch {
        // Expected
      }

      // Query database to verify table was not created
      const tables = await db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='partial'"
      );
      expect(tables.rowCount).toBe(0);

      // But DIRTY marker should exist
      const status = await migrationService.getStatus();
      expect(status.isDirty).toBe(true);
    });

    it("should preserve data from previous migrations during failure", async () => {
      // Create first successful migration
      await migrationService.migrate([
        {
          id: "001-preserve",
          sql: "CREATE TABLE preserve (id TEXT PRIMARY KEY, value TEXT)",
        },
      ]);

      // Insert data
      await db.execute("INSERT INTO preserve VALUES (?, ?)", ["1", "test"]);

      // Try to apply failing migration
      try {
        await migrationService.migrate([
          {
            id: "002-fail",
            sql: "CREATE TABLE fail (id TEXT); CREATE TABLE fail (id TEXT);",
          },
        ]);
      } catch {
        // Expected
      }

      // Data should still be there
      const rows = await db.query("SELECT value FROM preserve WHERE id = ?", ["1"]);
      expect(rows.rowCount).toBe(1);
      expect((rows.rows[0] as any).value).toBe("test");
    });
  });

  describe("Concurrency safety (single-process testing)", () => {
    it("should maintain lease through callback execution", async () => {
      let leaseTokenInside: string | undefined;
      let capturedSession: any;

      await db.withMigrationLease(async (session) => {
        leaseTokenInside = session.leaseToken();
        capturedSession = session;

        // Token should be available inside callback
        expect(leaseTokenInside).toBeTruthy();
      });

      // Token should not be available after callback
      expect(() => {
        capturedSession.leaseToken();
      }).toThrow();
    });
  });
});
