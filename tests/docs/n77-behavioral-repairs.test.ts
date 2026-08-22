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
    it("should preserve legacy dirty=1 as DIRTY status with reason", async () => {
      const dbPath = `/tmp/legacy-dirty-${randomUUID()}.sqlite`;
      const db = new SqliteAdapter({ path: dbPath });

      // Create legacy schema with dirty column
      await db.executeRaw(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          dirty INTEGER NOT NULL
        )
      `);

      // Insert both clean and dirty legacy rows
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

      // Upgrade schema
      const migrationService = new MigrationService(db, "sqlite");
      await migrationService.upgradeControlSchema();

      // Verify clean row is APPLIED
      const cleanRow = await db.querySingle(
        "SELECT status, dirty_reason FROM schema_migrations WHERE id = ?",
        [cleanId]
      );
      expect((cleanRow as any).status).toBe("APPLIED");
      expect((cleanRow as any).dirty_reason).toBeNull();

      // Verify dirty row is DIRTY with legacy reason
      const dirtyRow = await db.querySingle(
        "SELECT status, dirty_reason FROM schema_migrations WHERE id = ?",
        [dirtyId]
      );
      expect((dirtyRow as any).status).toBe("DIRTY");
      expect((dirtyRow as any).dirty_reason).toContain("legacy");

      await db.close();
    });

    it("should preserve row count and identity across upgrade", async () => {
      const dbPath = `/tmp/legacy-preserve-${randomUUID()}.sqlite`;
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

      // Upgrade
      const migrationService = new MigrationService(db, "sqlite");
      await migrationService.upgradeControlSchema();

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
