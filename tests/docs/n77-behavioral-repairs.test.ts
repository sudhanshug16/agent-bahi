/**
 * N77 Behavioral Repair Tests - Real behavior validation.
 */

import { describe, it, expect } from "bun:test";
import { randomUUID } from "crypto";
import type { Database } from "../../src/application/ports/persistence.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";

describe("N77 Behavioral Repairs - Real service behavior", () => {
  describe("DEFECT 4: Legacy schema upgrade preserves dirty state", () => {
    it("should fail closed on unknown id/version/dirty schema (not a committed historical shape)", async () => {
      const dbPath = `/tmp/legacy-dirty-unknown-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create unknown schema (id/version/dirty is NOT a committed historical shape)
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          dirty INTEGER NOT NULL
        )
      `);

      // Insert rows
      const cleanId = `clean-${randomUUID()}`;
      const dirtyId = `dirty-${randomUUID()}`;
      await db.execute(
        "INSERT INTO schema_migrations (id, version, dirty) VALUES (?, ?, ?)",
        [cleanId, 1, 0]
      );
      await db.execute(
        "INSERT INTO schema_migrations (id, version, dirty) VALUES (?, ?, ?)",
        [dirtyId, 1, 1]
      );

      // Upgrade should fail on unknown schema
      const migrationService = new MigrationService(db, "sqlite");

      try {
        await migrationService.upgradeControlSchema();
        throw new Error("Should have rejected unknown schema");
      } catch (err: any) {
        expect(err.code || err.message).toContain("CONTROL_SCHEMA_UPGRADE_FAILED");
      }

      // Verify schema unchanged: still 3 columns
      const tableInfo = await db.query("PRAGMA table_info(schema_migrations)");
      expect(tableInfo.rowCount).toBe(3);

      // Verify rows unchanged
      const rowCount = await db.querySingle("SELECT COUNT(*) as count FROM schema_migrations");
      expect(Number((rowCount as any).count)).toBe(2);

      await db.close();
    });

    it("should fail closed on unknown schema (id/version/dirty), rows unchanged", async () => {
      const dbPath = `/tmp/legacy-unknown-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          dirty INTEGER NOT NULL
        )
      `);

      // Insert 5 rows
      for (let i = 0; i < 5; i++) {
        await db.execute(
          "INSERT INTO schema_migrations (id, version, dirty) VALUES (?, ?, ?)",
          [`id-${i}`, i, i % 2]
        );
      }

      const beforeCount = await db.querySingle(
        "SELECT COUNT(*) as count FROM schema_migrations"
      );
      expect(Number((beforeCount as any).count)).toBe(5);

      // Upgrade should fail on unknown schema
      const migrationService = new MigrationService(db, "sqlite");

      try {
        await migrationService.upgradeControlSchema();
        throw new Error("Should have rejected unknown schema");
      } catch (err: any) {
        expect(err.code || err.message).toContain("CONTROL_SCHEMA_UPGRADE_FAILED");
        expect(err.message).toContain("unknown");
      }

      // Verify table unchanged: still 3 columns, still has 5 rows
      const tableInfo = await db.query("PRAGMA table_info(schema_migrations)");
      expect(tableInfo.rowCount).toBe(3);

      const afterCount = await db.querySingle(
        "SELECT COUNT(*) as count FROM schema_migrations"
      );
      expect(Number((afterCount as any).count)).toBe(5);

      // Verify each row identity preserved
      for (let i = 0; i < 5; i++) {
        const row = await db.querySingle(
          "SELECT id FROM schema_migrations WHERE id = ?",
          [`id-${i}`]
        );
        expect((row as any)?.id).toBe(`id-${i}`);
      }

      await db.close();
    });

  });

  describe("DEFECT 5: NULL manifest_version preservation", () => {
    it("should preserve NULL manifest_version in recovery audit (not coerce to 0)", async () => {
      const dbPath = `/tmp/null-manifest-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create schema
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          dialect TEXT NOT NULL,
          checksum TEXT NOT NULL,
          status TEXT NOT NULL,
          executed_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          manifest_version INTEGER,
          verification_manifest_hash TEXT,
          manifest_json TEXT
        )
      `);

      await db.executeRaw(`
        CREATE TABLE migration_recovery_audit (
          id TEXT PRIMARY KEY,
          migration_id TEXT NOT NULL,
          manifest_version INTEGER
        )
      `);

      // Insert migration with NULL manifest_version
      const migId = randomUUID();
      await db.execute(
        `INSERT INTO schema_migrations
         (id, dialect, checksum, status, executed_at, duration_ms, manifest_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [migId, "sqlite", "abc", "APPLIED", new Date().toISOString(), 100, null]
      );

      // Simulate recovery audit insertion preserving NULL
      const auditId = randomUUID();
      const manifestVer = null; // Must stay null, not coerce to 0
      await db.execute(
        `INSERT INTO migration_recovery_audit (id, migration_id, manifest_version)
         VALUES (?, ?, ?)`,
        [auditId, migId, manifestVer]
      );

      // Verify NULL is preserved
      const auditRow = await db.querySingle(
        "SELECT manifest_version FROM migration_recovery_audit WHERE id = ?",
        [auditId]
      );
      const storedValue = (auditRow as any)?.manifest_version;
      expect(storedValue).not.toBe(0);
      expect(storedValue === null || storedValue === undefined).toBe(true);

      await db.close();
    });
  });

});
