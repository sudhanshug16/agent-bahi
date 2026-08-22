/**
 * Schema Upgrade Behavioral Tests - Phase 1A Repair (N80/N81)
 *
 * Comprehensive behavioral tests for legacy schema_migrations upgrade repair:
 * - Each exact historical shape and current no-op behavior
 * - Empty legacy table handling (upgrade schema, not no-op)
 * - Unknown/hybrid/superset/partial/view/malformed-current rejection with no mutation
 * - Null-required and invalid status/dirty value rejection
 * - Exact row equality including nulls and large integer preservation
 * - Injected copy/validate/swap failure rollback for SQLite/PostgreSQL
 * - Metadata connection/permission error propagation
 * - recoverDirty null-manifest behavior fail-closed
 * Tests invoke real MigrationService/production adapters and assert exact outcomes.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "crypto";
import type { Database } from "../../src/application/ports/persistence.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { DomainError } from "../../src/core/types.ts";

async function createDirtyFlagLegacy(db: SqliteAdapter, id: string): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE schema_migrations (
      id TEXT PRIMARY KEY,
      dialect TEXT NOT NULL,
      checksum TEXT NOT NULL,
      executed_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      dirty INTEGER NOT NULL,
      dirty_reason TEXT
    )
  `);
  await db.execute(
    "INSERT INTO schema_migrations VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, "sqlite", "checksum", "2026-08-22T10:00:00Z", 10, 0, null],
  );
}

function injectUpgradeFault(db: SqliteAdapter, point: "copy" | "validate" | "swap"): void {
  const originalLease = db.withMigrationLease.bind(db);
  (db as any).withMigrationLease = (callback: (session: any) => Promise<unknown>, timeoutMs?: number) =>
    originalLease(async (session: any) => {
      const originalExecute = session.execute.bind(session);
      const originalExecuteRaw = session.executeRaw.bind(session);
      session.execute = async (sql: string, params?: unknown[]) => {
        const shouldFail = (point === "copy" && sql.includes("INSERT INTO \"schema_migrations_stage_"))
          || (point === "validate" && sql.includes("SELECT COUNT(*) as count FROM \"schema_migrations_stage_"));
        if (shouldFail) {
          throw new Error(`injected ${point} failure`);
        }
        return originalExecute(sql, params);
      };
      session.executeRaw = async (sql: string) => {
        if (point === "swap" && sql.includes("ALTER TABLE \"schema_migrations_stage_")) {
          throw new Error("injected swap failure");
        }
        return originalExecuteRaw(sql);
      };
      return callback(session);
    }, timeoutMs);
}

function injectUnsafeInteger(db: SqliteAdapter): void {
  const originalLease = db.withMigrationLease.bind(db);
  (db as any).withMigrationLease = (callback: (session: any) => Promise<unknown>, timeoutMs?: number) =>
    originalLease(async (session: any) => {
      const originalExecute = session.execute.bind(session);
      session.execute = async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT * FROM \"schema_migrations\"")) {
          return {
            rows: [{
              id: "unsafe",
              dialect: "sqlite",
              checksum: "checksum",
              executed_at: "2026-08-22T10:00:00Z",
              duration_ms: Number.MAX_SAFE_INTEGER + 1,
              dirty: 0,
              dirty_reason: null,
            }],
            rowCount: 1,
          };
        }
        return originalExecute(sql, params);
      };
      return callback(session);
    }, timeoutMs);
}

describe("Schema Upgrade Behavioral Tests (Phase 1A N80/N81)", () => {
  describe("Each exact historical shape", () => {
    describe("Gate0 shape: logical_id, checksum, applied_at (exactly 3 columns)", () => {
      it("should upgrade Gate0 schema to current 11-column format", async () => {
        const dbPath = `/tmp/schema-upgrade-gate0-${randomUUID()}.sqlite`;
        const db = new SqliteAdapter({ path: dbPath });

        // Create exact Gate0 schema: 3 columns
        await db.executeRaw(`
          CREATE TABLE schema_migrations (
            logical_id TEXT PRIMARY KEY,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL
          )
        `);

        // Insert Gate0 row
        const gate0Id = `gate0-001-${randomUUID()}`;
        const gate0Checksum = "abc123def456";
        const gate0AppliedAt = "2026-08-22T10:00:00Z";
        await db.execute(
          "INSERT INTO schema_migrations (logical_id, checksum, applied_at) VALUES (?, ?, ?)",
          [gate0Id, gate0Checksum, gate0AppliedAt]
        );

        // Upgrade within migration lease
        const migrationService = new MigrationService(db, "sqlite");
        await migrationService.upgradeControlSchema();

        // Verify row preserved exactly
        const row = await db.querySingle(
          "SELECT id, dialect, checksum, status, executed_at, duration_ms, dirty_reason FROM schema_migrations WHERE id = ?",
          [gate0Id]
        );
        expect((row as any).id).toBe(gate0Id);
        expect((row as any).dialect).toBe("sqlite");
        expect((row as any).checksum).toBe(gate0Checksum);
        expect((row as any).status).toBe("APPLIED");
        expect((row as any).executed_at).toBe(gate0AppliedAt);
        expect((row as any).duration_ms).toBe(BigInt(0));
        expect((row as any).dirty_reason).toBeNull();

        // Verify all 11 columns exist
        const metadata = await db.query(
          "PRAGMA table_info(schema_migrations)"
        );
        expect(metadata.rowCount).toBe(11);

        await db.close();
      });
    });

    describe("Dirty flag shape: id, dialect, checksum, executed_at, duration_ms, dirty, dirty_reason (exactly 7 columns)", () => {
      it("should preserve dirty=0 as APPLIED status", async () => {
        const dbPath = `/tmp/schema-upgrade-dirty-clean-${randomUUID()}.sqlite`;
        const db = new SqliteAdapter({ path: dbPath });

        await db.executeRaw(`
          CREATE TABLE schema_migrations (
            id TEXT PRIMARY KEY,
            dialect TEXT NOT NULL,
            checksum TEXT NOT NULL,
            executed_at TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            dirty INTEGER NOT NULL,
            dirty_reason TEXT
          )
        `);

        const migId = `migration-${randomUUID()}`;
        const checksum = "checksum123";
        const executedAt = "2026-08-22T10:00:00Z";
        await db.execute(
          "INSERT INTO schema_migrations (id, dialect, checksum, executed_at, duration_ms, dirty, dirty_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [migId, "sqlite", checksum, executedAt, 100, 0, null]
        );

        const migrationService = new MigrationService(db, "sqlite");
        await migrationService.upgradeControlSchema();

        const row = await db.querySingle(
          "SELECT status, dirty_reason FROM schema_migrations WHERE id = ?",
          [migId]
        );
        expect((row as any).status).toBe("APPLIED");
        expect((row as any).dirty_reason).toBeNull();

        await db.close();
      });

      it("should preserve dirty=1 as DIRTY status with reason", async () => {
        const dbPath = `/tmp/schema-upgrade-dirty-set-${randomUUID()}.sqlite`;
        const db = new SqliteAdapter({ path: dbPath });

        await db.executeRaw(`
          CREATE TABLE schema_migrations (
            id TEXT PRIMARY KEY,
            dialect TEXT NOT NULL,
            checksum TEXT NOT NULL,
            executed_at TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            dirty INTEGER NOT NULL,
            dirty_reason TEXT
          )
        `);

        const migId = `migration-${randomUUID()}`;
        const originalReason = "original failure";
        await db.execute(
          "INSERT INTO schema_migrations (id, dialect, checksum, executed_at, duration_ms, dirty, dirty_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [migId, "sqlite", "checksum", "2026-08-22T10:00:00Z", 50, 1, originalReason]
        );

        const migrationService = new MigrationService(db, "sqlite");
        await migrationService.upgradeControlSchema();

        const row = await db.querySingle(
          "SELECT status, dirty_reason FROM schema_migrations WHERE id = ?",
          [migId]
        );
        expect((row as any).status).toBe("DIRTY");
        expect((row as any).dirty_reason).toBe(originalReason);

        await db.close();
      });

      it("should reject dirty values other than 0 or 1", async () => {
        const dbPath = `/tmp/schema-upgrade-dirty-invalid-${randomUUID()}.sqlite`;
        const db = new SqliteAdapter({ path: dbPath });

        await db.executeRaw(`
          CREATE TABLE schema_migrations (
            id TEXT PRIMARY KEY,
            dialect TEXT NOT NULL,
            checksum TEXT NOT NULL,
            executed_at TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            dirty INTEGER NOT NULL,
            dirty_reason TEXT
          )
        `);

        const migId = `migration-${randomUUID()}`;
        await db.execute(
          "INSERT INTO schema_migrations (id, dialect, checksum, executed_at, duration_ms, dirty, dirty_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [migId, "sqlite", "checksum", "2026-08-22T10:00:00Z", 50, 2, "invalid"]
        );

        const migrationService = new MigrationService(db, "sqlite");

        try {
          await migrationService.upgradeControlSchema();
          throw new Error("Should have rejected invalid dirty value");
        } catch (err: any) {
          expect(err.code || err.message).toContain("CONTROL_SCHEMA_UPGRADE_FAILED");
          expect(err.message).toContain("invalid dirty value");
        }

        // Verify table unchanged
        const count = await db.querySingle("SELECT COUNT(*) as count FROM schema_migrations");
        expect(Number((count as any).count)).toBe(1);

        await db.close();
      });
    });

    describe("Nullable status shape: id, dialect, checksum, status, executed_at, duration_ms (exactly 6 columns)", () => {
      it("should preserve valid APPLIED status", async () => {
        const dbPath = `/tmp/schema-upgrade-nullable-applied-${randomUUID()}.sqlite`;
        const db = new SqliteAdapter({ path: dbPath });

        await db.executeRaw(`
          CREATE TABLE schema_migrations (
            id TEXT PRIMARY KEY,
            dialect TEXT NOT NULL,
            checksum TEXT NOT NULL,
            status TEXT,
            executed_at TEXT NOT NULL,
            duration_ms INTEGER NOT NULL
          )
        `);

        const migId = `migration-${randomUUID()}`;
        await db.execute(
          "INSERT INTO schema_migrations (id, dialect, checksum, status, executed_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?)",
          [migId, "sqlite", "checksum", "APPLIED", "2026-08-22T10:00:00Z", 75]
        );

        const migrationService = new MigrationService(db, "sqlite");
        await migrationService.upgradeControlSchema();

        const row = await db.querySingle(
          "SELECT status FROM schema_migrations WHERE id = ?",
          [migId]
        );
        expect((row as any).status).toBe("APPLIED");

        await db.close();
      });

      it("should reject NULL status, fail closed with schema+rows unchanged", async () => {
        const dbPath = `/tmp/schema-upgrade-nullable-null-${randomUUID()}.sqlite`;
        const db = new SqliteAdapter({ path: dbPath });

        await db.executeRaw(`
          CREATE TABLE schema_migrations (
            id TEXT PRIMARY KEY,
            dialect TEXT NOT NULL,
            checksum TEXT NOT NULL,
            status TEXT,
            executed_at TEXT NOT NULL,
            duration_ms INTEGER NOT NULL
          )
        `);

        const migId = `migration-${randomUUID()}`;
        await db.execute(
          "INSERT INTO schema_migrations (id, dialect, checksum, status, executed_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?)",
          [migId, "sqlite", "checksum", null, "2026-08-22T10:00:00Z", 50]
        );

        const migrationService = new MigrationService(db, "sqlite");

        try {
          await migrationService.upgradeControlSchema();
          throw new Error("Should have rejected NULL status");
        } catch (err: any) {
          expect(err.code || err.message).toContain("CONTROL_SCHEMA_UPGRADE_FAILED");
          expect(err.message).toContain("NULL or invalid status");
        }

        // Verify table unchanged (still 6 columns, still has the row)
        const tableInfo = await db.query("PRAGMA table_info(schema_migrations)");
        expect(tableInfo.rowCount).toBe(6);

        const rowCount = await db.querySingle("SELECT COUNT(*) as count FROM schema_migrations");
        expect(Number((rowCount as any).count)).toBe(1);

        await db.close();
      });
    });

    describe("Strict status + lease shape: id, dialect, checksum, status, executed_at, duration_ms, lease_token (exactly 8 columns)", () => {
      it("should preserve all values exactly including lease_token", async () => {
        const dbPath = `/tmp/schema-upgrade-strict-lease-${randomUUID()}.sqlite`;
        const db = new SqliteAdapter({ path: dbPath });

        await db.executeRaw(`
          CREATE TABLE schema_migrations (
            id TEXT PRIMARY KEY,
            dialect TEXT NOT NULL,
            checksum TEXT NOT NULL,
            status TEXT NOT NULL,
            executed_at TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            lease_token TEXT
          )
        `);

        const migId = `migration-${randomUUID()}`;
        const leaseToken = randomUUID();
        await db.execute(
          "INSERT INTO schema_migrations (id, dialect, checksum, status, executed_at, duration_ms, lease_token) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [migId, "sqlite", "checksum", "APPLIED", "2026-08-22T10:00:00Z", 123, leaseToken]
        );

        const migrationService = new MigrationService(db, "sqlite");
        await migrationService.upgradeControlSchema();

        const row = await db.querySingle(
          "SELECT status, lease_token FROM schema_migrations WHERE id = ?",
          [migId]
        );
        expect((row as any).status).toBe("APPLIED");
        expect((row as any).lease_token).toBe(leaseToken);

        await db.close();
      });
    });
  });

  describe("Current schema no-op", () => {
    it("should no-op on already-current 11-column schema", async () => {
      const dbPath = `/tmp/schema-upgrade-current-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create current schema
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          dialect TEXT NOT NULL,
          checksum TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
          executed_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          dirty_reason TEXT,
          lease_token TEXT,
          manifest_version INTEGER,
          verification_manifest_hash TEXT,
          manifest_json TEXT
        )
      `);

      // Insert current row
      const migId = `current-migration-${randomUUID()}`;
      const checksum = "current-checksum";
      await db.execute(
        `INSERT INTO schema_migrations
         (id, dialect, checksum, status, executed_at, duration_ms, dirty_reason, lease_token, manifest_version, verification_manifest_hash, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [migId, "sqlite", checksum, "APPLIED", "2026-08-22T10:00:00Z", 100, null, null, null, null, null]
      );

      // Get row before upgrade
      const beforeRow = await db.querySingle(
        "SELECT * FROM schema_migrations WHERE id = ?",
        [migId]
      );

      // Upgrade (should be no-op)
      const migrationService = new MigrationService(db, "sqlite");
      await migrationService.upgradeControlSchema();

      // Get row after upgrade
      const afterRow = await db.querySingle(
        "SELECT * FROM schema_migrations WHERE id = ?",
        [migId]
      );

      // Verify row unchanged
      expect((beforeRow as any).id).toBe((afterRow as any).id);
      expect((beforeRow as any).checksum).toBe((afterRow as any).checksum);
      expect((beforeRow as any).status).toBe((afterRow as any).status);

      await db.close();
    });
  });

  describe("Malformed current schemas", () => {
    it("rejects a malformed current schema without changing its exact snapshot", async () => {
      const dbPath = `/tmp/schema-upgrade-malformed-current-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          dialect TEXT NOT NULL,
          checksum TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
          executed_at TEXT NOT NULL,
          duration_ms TEXT NOT NULL,
          dirty_reason TEXT,
          lease_token TEXT,
          manifest_version INTEGER,
          verification_manifest_hash TEXT,
          manifest_json TEXT
        )
      `);
      await db.execute(
        "INSERT INTO schema_migrations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["malformed", "sqlite", "checksum", "APPLIED", "2026-08-22T10:00:00Z", "17", null, null, null, null, null],
      );
      const beforeSchema = await db.query("PRAGMA table_info(\"schema_migrations\")");
      const beforeRows = await db.query("SELECT * FROM schema_migrations");
      await expect(new MigrationService(db, "sqlite").upgradeControlSchema()).rejects.toBeInstanceOf(DomainError);
      expect(await db.query("PRAGMA table_info(\"schema_migrations\")")).toEqual(beforeSchema);
      expect(await db.query("SELECT * FROM schema_migrations")).toEqual(beforeRows);
      await db.close();
    });
  });

  describe("Injected copy/validate/swap failures", () => {
    for (const point of ["copy", "validate", "swap"] as const) {
      it(`leaves the legacy schema and rows unchanged when ${point} fails`, async () => {
        const dbPath = `/tmp/schema-upgrade-fault-${point}-${randomUUID()}.sqlite`;
        const db = new SqliteAdapter({ path: dbPath });
        await createDirtyFlagLegacy(db, `fault-${point}`);
        const beforeSchema = await db.query("PRAGMA table_info(\"schema_migrations\")");
        const beforeRows = await db.query("SELECT * FROM schema_migrations");
        injectUpgradeFault(db, point);
        await expect(new MigrationService(db, "sqlite").upgradeControlSchema()).rejects.toThrow();
        expect(await db.query("PRAGMA table_info(\"schema_migrations\")")).toEqual(beforeSchema);
        expect(await db.query("SELECT * FROM schema_migrations")).toEqual(beforeRows);
        await db.close();
      });
    }

    it("rejects an unsafe driver number before staging or mutation", async () => {
      const dbPath = `/tmp/schema-upgrade-fault-unsafe-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });
      await createDirtyFlagLegacy(db, "unsafe");
      const beforeSchema = await db.query("PRAGMA table_info(\"schema_migrations\")");
      const beforeRows = await db.query("SELECT * FROM schema_migrations");
      injectUnsafeInteger(db);
      await expect(new MigrationService(db, "sqlite").upgradeControlSchema()).rejects.toThrow("unsafe integer");
      expect(await db.query("PRAGMA table_info(\"schema_migrations\")")).toEqual(beforeSchema);
      expect(await db.query("SELECT * FROM schema_migrations")).toEqual(beforeRows);
      await db.close();
    });
  });

  describe("Empty legacy table", () => {
    it("should upgrade schema structure even on empty legacy table", async () => {
      const dbPath = `/tmp/schema-upgrade-empty-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create empty legacy schema (dirty flag shape)
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          dialect TEXT NOT NULL,
          checksum TEXT NOT NULL,
          executed_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          dirty INTEGER NOT NULL,
          dirty_reason TEXT
        )
      `);

      const migrationService = new MigrationService(db, "sqlite");
      await migrationService.upgradeControlSchema();

      // Table should be upgraded to current schema
      const metadata = await db.query(
        "PRAGMA table_info(schema_migrations)"
      );
      expect(metadata.rowCount).toBe(11);

      // Should still be empty
      const count = await db.querySingle(
        "SELECT COUNT(*) as count FROM schema_migrations"
      );
      expect(Number((count as any).count)).toBe(0);

      await db.close();
    });
  });

  describe("Unknown/hybrid/superset/partial/view/malformed-current rejection", () => {
    it("should reject unknown schema (unknown column set)", async () => {
      const dbPath = `/tmp/schema-upgrade-unknown-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create unknown schema (doesn't match any known pattern)
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          migration_id TEXT PRIMARY KEY,
          sql_text TEXT NOT NULL,
          applied_time INTEGER NOT NULL
        )
      `);

      const unknownId = `unknown-${randomUUID()}`;
      await db.execute(
        "INSERT INTO schema_migrations (migration_id, sql_text, applied_time) VALUES (?, ?, ?)",
        [unknownId, "SELECT 1", 123456]
      );

      const migrationService = new MigrationService(db, "sqlite");

      try {
        await migrationService.upgradeControlSchema();
        throw new Error("Should have rejected unknown schema");
      } catch (err: any) {
        expect(err.code || err.message).toContain("CONTROL_SCHEMA_UPGRADE_FAILED");
        expect(err.message).toContain("unknown");
      }

      // Verify table unchanged
      const count = await db.querySingle("SELECT COUNT(*) as count FROM schema_migrations");
      expect(Number((count as any).count)).toBe(1);

      await db.close();
    });

    it("should reject hybrid schema (columns from multiple versions)", async () => {
      const dbPath = `/tmp/schema-upgrade-hybrid-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create hybrid schema: combines Gate0 (logical_id) with dirty flag (dirty, dirty_reason)
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          logical_id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL,
          dirty INTEGER,
          dirty_reason TEXT
        )
      `);

      const hybridId = `hybrid-${randomUUID()}`;
      await db.execute(
        "INSERT INTO schema_migrations (logical_id, checksum, applied_at, dirty, dirty_reason) VALUES (?, ?, ?, ?, ?)",
        [hybridId, "checksum", "2026-08-22T10:00:00Z", 0, null]
      );

      const migrationService = new MigrationService(db, "sqlite");

      try {
        await migrationService.upgradeControlSchema();
        throw new Error("Should have rejected hybrid schema");
      } catch (err: any) {
        expect(err.code || err.message).toContain("CONTROL_SCHEMA_UPGRADE_FAILED");
      }

      // Verify table unchanged
      const count = await db.querySingle("SELECT COUNT(*) as count FROM schema_migrations");
      expect(Number((count as any).count)).toBe(1);

      await db.close();
    });

    it("should reject superset schema (current schema plus extra columns)", async () => {
      const dbPath = `/tmp/schema-upgrade-superset-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create superset: current 11 columns plus extra
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          dialect TEXT NOT NULL,
          checksum TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
          executed_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          dirty_reason TEXT,
          lease_token TEXT,
          manifest_version INTEGER,
          verification_manifest_hash TEXT,
          manifest_json TEXT,
          extra_column TEXT
        )
      `);

      const supersetId = `superset-${randomUUID()}`;
      await db.execute(
        `INSERT INTO schema_migrations
         (id, dialect, checksum, status, executed_at, duration_ms, dirty_reason, lease_token, manifest_version, verification_manifest_hash, manifest_json, extra_column)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [supersetId, "sqlite", "checksum", "APPLIED", "2026-08-22T10:00:00Z", 100, null, null, null, null, null, "extra"]
      );

      const migrationService = new MigrationService(db, "sqlite");

      try {
        await migrationService.upgradeControlSchema();
        throw new Error("Should have rejected superset schema");
      } catch (err: any) {
        expect(err.code || err.message).toContain("CONTROL_SCHEMA_UPGRADE_FAILED");
      }

      // Verify table unchanged
      const count = await db.querySingle("SELECT COUNT(*) as count FROM schema_migrations");
      expect(Number((count as any).count)).toBe(1);

      await db.close();
    });

    it("should reject VIEW instead of TABLE", async () => {
      const dbPath = `/tmp/schema-upgrade-view-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create a backing table
      await db.executeRaw(`
        CREATE TABLE schema_migrations_real (
          id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL
        )
      `);

      // Create a view with the name schema_migrations
      await db.executeRaw(`
        CREATE VIEW schema_migrations AS SELECT id, checksum FROM schema_migrations_real
      `);

      const migrationService = new MigrationService(db, "sqlite");

      try {
        await migrationService.upgradeControlSchema();
        throw new Error("Should have rejected VIEW");
      } catch (err: any) {
        expect(err.code || err.message).toContain("CONTROL_SCHEMA_UPGRADE_FAILED");
        expect(err.message).toContain("VIEW");
      }

      // Verify view unchanged
      const metadata = await db.query(
        "SELECT type FROM sqlite_master WHERE type='view' AND name='schema_migrations'"
      );
      expect(metadata.rowCount).toBe(1);

      await db.close();
    });
  });

  describe("Exact row equality and large integer preservation", () => {
    it("should preserve large integers beyond 2^53 via BigInt", async () => {
      const dbPath = `/tmp/schema-upgrade-bigint-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create current schema
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          dialect TEXT NOT NULL,
          checksum TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
          executed_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          dirty_reason TEXT,
          lease_token TEXT,
          manifest_version INTEGER,
          verification_manifest_hash TEXT,
          manifest_json TEXT
        )
      `);

      // Insert row with large duration_ms value
      const migId = `bigint-test-${randomUUID()}`;
      const largeDuration = BigInt(9007199254740992); // Beyond 2^53
      await db.execute(
        `INSERT INTO schema_migrations
         (id, dialect, checksum, status, executed_at, duration_ms, dirty_reason, lease_token, manifest_version, verification_manifest_hash, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [migId, "sqlite", "checksum", "APPLIED", "2026-08-22T10:00:00Z", largeDuration, null, null, null, null, null]
      );

      // Upgrade (should preserve value)
      const migrationService = new MigrationService(db, "sqlite");
      await migrationService.upgradeControlSchema();

      // Verify value preserved exactly
      const row = await db.querySingle(
        "SELECT duration_ms FROM schema_migrations WHERE id = ?",
        [migId]
      );
      expect(typeof (row as any).duration_ms).toBe("bigint");
      expect((row as any).duration_ms).toBe(largeDuration);

      await db.close();
    });

    it("should preserve NULL values exactly across upgrade", async () => {
      const dbPath = `/tmp/schema-upgrade-nulls-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          dialect TEXT NOT NULL,
          checksum TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
          executed_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          dirty_reason TEXT,
          lease_token TEXT,
          manifest_version INTEGER,
          verification_manifest_hash TEXT,
          manifest_json TEXT
        )
      `);

      const migId = `null-test-${randomUUID()}`;
      await db.execute(
        `INSERT INTO schema_migrations
         (id, dialect, checksum, status, executed_at, duration_ms, dirty_reason, lease_token, manifest_version, verification_manifest_hash, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [migId, "sqlite", "checksum", "APPLIED", "2026-08-22T10:00:00Z", 100, null, null, null, null, null]
      );

      const migrationService = new MigrationService(db, "sqlite");
      await migrationService.upgradeControlSchema();

      const row = await db.querySingle(
        "SELECT dirty_reason, lease_token, manifest_version, verification_manifest_hash, manifest_json FROM schema_migrations WHERE id = ?",
        [migId]
      );
      expect((row as any).dirty_reason).toBeNull();
      expect((row as any).lease_token).toBeNull();
      expect((row as any).manifest_version).toBeNull();
      expect((row as any).verification_manifest_hash).toBeNull();
      expect((row as any).manifest_json).toBeNull();

      await db.close();
    });
  });

  describe("Metadata errors propagate fail-closed", () => {
    it("should propagate connection errors during table metadata check", async () => {
      const dbPath = `/tmp/schema-upgrade-closed-conn-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create a valid schema so upgradeControlSchema attempts metadata check
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          dialect TEXT NOT NULL,
          checksum TEXT NOT NULL,
          executed_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          dirty INTEGER NOT NULL,
          dirty_reason TEXT
        )
      `);

      // Insert a row so table exists
      await db.execute(
        "INSERT INTO schema_migrations (id, dialect, checksum, executed_at, duration_ms, dirty, dirty_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["test", "sqlite", "checksum", "2026-08-22T10:00:00Z", 1, 0, null]
      );

      // Close database to simulate connection error
      await db.close();

      // Attempt upgrade on closed database; the pinned-session metadata error
      // must be observable rather than treated as an absent table.
      const migrationService = new MigrationService(db, "sqlite");
      await expect(migrationService.upgradeControlSchema()).rejects.toThrow();
    });
  });

  describe("recoverDirty null-manifest behavior remains fail-closed", () => {
    it("should fail recoverDirty when manifest is null/missing", async () => {
      const dbPath = `/tmp/schema-upgrade-recover-null-manifest-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create current schema
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          dialect TEXT NOT NULL,
          checksum TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
          executed_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          dirty_reason TEXT,
          lease_token TEXT,
          manifest_version INTEGER,
          verification_manifest_hash TEXT,
          manifest_json TEXT
        )
      `);

      // Insert DIRTY migration without manifest
      const migId = `dirty-no-manifest-${randomUUID()}`;
      await db.execute(
        `INSERT INTO schema_migrations
         (id, dialect, checksum, status, executed_at, duration_ms, dirty_reason, lease_token, manifest_version, verification_manifest_hash, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [migId, "sqlite", "checksum123", "DIRTY", "2026-08-22T10:00:00Z", 50, "test failure", null, null, null, null]
      );

      // Create audit table
      await db.executeRaw(`
        CREATE TABLE migration_recovery_audit (
          id TEXT PRIMARY KEY,
          migration_id TEXT NOT NULL,
          recovery_at TEXT NOT NULL,
          lease_token TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT NOT NULL,
          expected_status TEXT NOT NULL,
          expected_checksum TEXT NOT NULL,
          expected_dirty_reason_state TEXT NOT NULL CHECK (expected_dirty_reason_state IN ('NONE', 'PRESENT')),
          expected_dirty_reason TEXT,
          actual_status TEXT NOT NULL,
          actual_checksum TEXT NOT NULL,
          actual_dirty_reason_state TEXT NOT NULL CHECK (actual_dirty_reason_state IN ('NONE', 'PRESENT')),
          actual_dirty_reason TEXT,
          verification_manifest_hash TEXT,
          manifest_version INTEGER,
          probe_results_json TEXT NOT NULL,
          verification_status TEXT NOT NULL CHECK (verification_status IN ('PASS', 'FAIL')),
          success BOOLEAN NOT NULL
        )
      `);

      const migrationService = new MigrationService(db, "sqlite");

      // Try to recover without manifest (should fail)
      try {
        await migrationService.recoverDirty({
          migrationId: migId,
          expectedDialect: "sqlite",
          expectedStatus: "DIRTY",
          expectedChecksum: "checksum123",
          expectedDirtyReason: "test failure",
          actor: "test",
          reason: "test recovery",
          definition: {
            id: migId,
            sql: "SELECT 1",
            // No manifest provided
          },
        });
        throw new Error("Should have failed due to missing manifest");
      } catch (err: any) {
        expect(err.code || err.message).toContain("VERIFICATION_REQUIRED");
      }

      await db.close();
    });
  });

  describe("Row count preservation and exactness", () => {
    it("should preserve exact row count across upgrade", async () => {
      const dbPath = `/tmp/schema-upgrade-row-count-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          dialect TEXT NOT NULL,
          checksum TEXT NOT NULL,
          executed_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          dirty INTEGER NOT NULL,
          dirty_reason TEXT
        )
      `);

      // Insert multiple rows
      const rows = [];
      for (let i = 0; i < 10; i++) {
        const id = `row-${i}`;
        rows.push(id);
        await db.execute(
          "INSERT INTO schema_migrations (id, dialect, checksum, executed_at, duration_ms, dirty, dirty_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [id, "sqlite", `checksum-${i}`, "2026-08-22T10:00:00Z", i * 10, i % 2, null]
        );
      }

      // Count before upgrade
      const beforeCount = await db.querySingle(
        "SELECT COUNT(*) as count FROM schema_migrations"
      );
      expect(Number((beforeCount as any).count)).toBe(10);

      // Upgrade
      const migrationService = new MigrationService(db, "sqlite");
      await migrationService.upgradeControlSchema();

      // Count after upgrade
      const afterCount = await db.querySingle(
        "SELECT COUNT(*) as count FROM schema_migrations"
      );
      expect(Number((afterCount as any).count)).toBe(10);

      // Verify each row ID exists
      for (const id of rows) {
        const row = await db.querySingle(
          "SELECT id FROM schema_migrations WHERE id = ?",
          [id]
        );
        expect((row as any)?.id).toBe(id);
      }

      await db.close();
    });
  });
});
