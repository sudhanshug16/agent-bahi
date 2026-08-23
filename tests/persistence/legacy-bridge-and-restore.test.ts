/**
 * Legacy bridge and restore: v2-v8 custom -> Drizzle baseline + backup/restore operations.
 *
 * Tests:
 * - Detect v2-v7 and custom v8 database states
 * - Verify detection fails closed on unknown/tampered/hybrid schemas
 * - Backup/verify operations for legacy databases
 * - Restore functionality from verified backups
 * - Restore failure and recovery scenarios
 * - Status detection after bridge/baseline
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { initializeAndUpgradeSqliteDatabase, upgradeSqliteDatabase } from "../../src/application/application.ts";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import { detectDatabaseState } from "../../src/infrastructure/services/database-state-detector.ts";
import { detectLegacyState, inspectLegacyDatabase } from "../../src/infrastructure/services/legacy-bridge-service.ts";
import { MIGRATION_CATALOG, KNOWN_SCHEMA_MANIFESTS } from "../../src/infrastructure/schema/migration-catalog.ts";
import { DRIZZLE_FIXED_ASSETS_HASH, DRIZZLE_FX_V1_HASH, DRIZZLE_GST_V1_HASH, DRIZZLE_TDS_TCS_HASH, DRIZZLE_PAYROLL_V1_HASH, DRIZZLE_EXPENSE_CLAIMS_V1_HASH, DRIZZLE_GST_RETURN_READINESS_V1_HASH, DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_HASH, DRIZZLE_PERIOD_CLOSE_V1_HASH } from "../../src/infrastructure/services/drizzle-baseline.ts";

async function createLegacyFixture(path: string, schemaVersion: number): Promise<void> {
  const manifest = KNOWN_SCHEMA_MANIFESTS.find((candidate) => candidate.schemaVersion === schemaVersion)!;
  const db = new SqliteAdapter({ path });
  try {
    await new MigrationService(db, "sqlite").migrate(MIGRATION_CATALOG.slice(0, manifest.migrations.length).map((entry) => ({ id: entry.id, sql: entry.sqlite })));
    await db.withMigrationLease((session) => new DatabaseControlService(db, "sqlite", manifest).initialize({
      cliVersion: "fixture",
      buildId: `legacy-v${schemaVersion}`,
      now: new Date("2026-01-01T00:00:00.000Z"),
    }, session).then(() => undefined));
  } finally {
    await db.close();
  }
  const native = new BunDatabase(path);
  try {
    native.exec("INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES ('tenant-fixture', 'COMPANY', 'CREATING', 'Fixture', 'INR', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')");
    if (schemaVersion >= 3) native.exec("INSERT INTO book_sets (id, tenant_id, kind, lifecycle, display_name, created_at, updated_at) VALUES ('book-set-fixture', 'tenant-fixture', 'COMPANY', 'ACTIVE', 'Fixture Books', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')");
    else native.exec("INSERT INTO book_sets (id, tenant_id, kind, lifecycle, created_at, updated_at) VALUES ('book-set-fixture', 'tenant-fixture', 'COMPANY', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')");
    native.exec("UPDATE tenants SET default_book_set_id = 'book-set-fixture', lifecycle = 'ACTIVE' WHERE id = 'tenant-fixture'");
  } finally {
    native.close();
  }
}

describe("Legacy Bridge and Restore", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "legacy-bridge-test-"));
  });

  afterAll(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Database State Detection", () => {
    test("detects empty database", () => {
      const dbPath = join(tempDir, `empty-${randomUUID()}.db`);
      const db = new BunDatabase(dbPath);
      try {
        const state = detectDatabaseState(db);
        expect(state.state).toBe("EMPTY");
        expect(state.hasLegacyMigrations).toBe(false);
        expect(state.hasDrizzleMigrations).toBe(false);
      } finally {
        db.close();
      }
    });

    test("detects fresh Drizzle-managed database", async () => {
      const dbPath = join(tempDir, `drizzle-fresh-${randomUUID()}.db`);
      const backupPath = join(tempDir, `backup-${randomUUID()}`);

      await initializeAndUpgradeSqliteDatabase(dbPath, {
        backupDestinationPath: backupPath,
        cliVersion: "test",
        buildId: "test-fresh",
        now: new Date(),
      });

      const db = new BunDatabase(dbPath);
      try {
        const state = detectDatabaseState(db);
        expect(state.state).toBe("DRIZZLE_MANAGED");
        expect(state.hasLegacyMigrations).toBe(false);
        expect(state.hasDrizzleMigrations).toBe(true);
        expect(state.drizzleMigrationCount).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    });

    test("rejects unknown/tampered schemas", () => {
      const dbPath = join(tempDir, `unknown-${randomUUID()}.db`);
      const db = new BunDatabase(dbPath);
      try {
        // Create a malformed schema_migrations table
        db.exec(`
          CREATE TABLE schema_migrations (
            id TEXT PRIMARY KEY,
            dialect TEXT,
            checksum TEXT,
            status TEXT
          )
        `);
        db.exec(`
          INSERT INTO schema_migrations (id, dialect, checksum, status)
          VALUES ('invalid-id', 'unknown', 'badchecksum', 'APPLIED')
        `);

        const state = detectDatabaseState(db);
        expect(state.state).toBe("UNKNOWN");
      } finally {
        db.close();
      }
    });

    test("detects hybrid legacy + Drizzle as unknown", () => {
      const dbPath = join(tempDir, `hybrid-${randomUUID()}.db`);
      const db = new BunDatabase(dbPath);
      try {
        // Create both legacy and Drizzle tables
        db.exec(`
          CREATE TABLE schema_migrations (
            id TEXT PRIMARY KEY,
            dialect TEXT,
            checksum TEXT,
            status TEXT
          )
        `);
        db.exec(`
          CREATE TABLE __drizzle_migrations (
            id INTEGER PRIMARY KEY,
            hash TEXT UNIQUE,
            created_at INTEGER
          )
        `);
        db.exec(`
          INSERT INTO schema_migrations (id, dialect, checksum, status)
          VALUES ('001-core', 'sqlite', 'abc123', 'APPLIED')
        `);

        const state = detectDatabaseState(db);
        expect(state.state).toBe("UNKNOWN");
        expect(state.hasDrizzleMigrations).toBe(true);
        expect(state.hasLegacyMigrations).toBe(true);
      } finally {
        db.close();
      }
    });
  });

  describe("Legacy State Inspection", () => {
    test("inspects fresh Drizzle database correctly", async () => {
      const dbPath = join(tempDir, `inspect-drizzle-${randomUUID()}.db`);
      const backupDest = join(tempDir, `backup-${randomUUID()}`);

      await initializeAndUpgradeSqliteDatabase(dbPath, {
        backupDestinationPath: backupDest,
        cliVersion: "test",
        buildId: "test-inspect",
        now: new Date(),
      });

      const db = new BunDatabase(dbPath);
      try {
        const state = detectDatabaseState(db);
        expect(state.state).toBe("DRIZZLE_MANAGED");
        expect(state.hasLegacyMigrations).toBe(false);
      } finally {
        db.close();
      }
    });

    test("fails inspection on unknown state", () => {
      const dbPath = join(tempDir, `inspect-unknown-${randomUUID()}.db`);
      const db = new BunDatabase(dbPath);
      try {
        db.exec(`
          CREATE TABLE schema_migrations (
            id TEXT PRIMARY KEY,
            dialect TEXT,
            checksum TEXT,
            status TEXT
          )
        `);

        const error = () => inspectLegacyDatabase(db);
        expect(error).toThrow();
      } finally {
        db.close();
      }
    });
  });

  test("upgrades every canonical legacy prefix and preserves representative business data", async () => {
    for (const version of [2, 3, 4, 5, 6, 7]) {
      const path = join(tempDir, `prefix-v${version}-${randomUUID()}.sqlite`);
      const backup = join(tempDir, `prefix-v${version}-${randomUUID()}.backup`);
      await createLegacyFixture(path, version);
      await upgradeSqliteDatabase(path, { backupDestinationPath: backup, cliVersion: "test", buildId: `upgrade-v${version}` });
      const db = new BunDatabase(path, { readonly: true, safeIntegers: true });
      try {
        expect(detectDatabaseState(db).state).toBe("DRIZZLE_BRIDGED");
        expect(db.query("SELECT id, name FROM tenants").all()).toEqual([{ id: "tenant-fixture", name: "Fixture" }]);
        expect(db.query("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 8n });
      } finally { db.close(); }
    }
  });

  test("bridges custom v8 without replaying product DDL and reruns idempotently", async () => {
    const path = join(tempDir, `custom-v8-${randomUUID()}.sqlite`);
    const backup = join(tempDir, `custom-v8-${randomUUID()}.backup`);
    await createLegacyFixture(path, 8);
    const before = new BunDatabase(path, { readonly: true });
    const beforeTenant = before.query("SELECT id, name FROM tenants").all();
    before.close();
    await upgradeSqliteDatabase(path, { backupDestinationPath: backup, cliVersion: "test", buildId: "custom-v8" });
    await upgradeSqliteDatabase(path, { backupDestinationPath: `${backup}.second`, cliVersion: "test", buildId: "custom-v8-rerun" });
    const db = new BunDatabase(path, { readonly: true, safeIntegers: true });
    try {
      expect(detectDatabaseState(db).state).toBe("DRIZZLE_BRIDGED");
      expect(db.query("SELECT id, name FROM tenants").all()).toEqual(beforeTenant);
      expect(db.query("SELECT id, hash FROM __drizzle_migrations").all()).toEqual([
        { id: null, hash: "4cba3569223df5dd548a2b9ab6bb953566e3c0ff8e539319342d722b04600577" },
        { id: null, hash: DRIZZLE_GST_V1_HASH },
        { id: null, hash: DRIZZLE_TDS_TCS_HASH },
        { id: null, hash: DRIZZLE_FIXED_ASSETS_HASH },
        { id: null, hash: DRIZZLE_FX_V1_HASH },
        { id: null, hash: DRIZZLE_PAYROLL_V1_HASH },
        { id: null, hash: DRIZZLE_EXPENSE_CLAIMS_V1_HASH },
        { id: null, hash: DRIZZLE_GST_RETURN_READINESS_V1_HASH },
        { id: null, hash: DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_HASH },
        { id: null, hash: DRIZZLE_PERIOD_CLOSE_V1_HASH },
      ]);
    } finally { db.close(); }
  });

  test("fails closed when a bridged GST-owned trigger is corrupted", async () => {
    const path = join(tempDir, `custom-v8-gst-corrupt-${randomUUID()}.sqlite`);
    const backup = join(tempDir, `custom-v8-gst-corrupt-${randomUUID()}.backup`);
    await createLegacyFixture(path, 8);
    await upgradeSqliteDatabase(path, { backupDestinationPath: backup, cliVersion: "test", buildId: "custom-v8-gst-corrupt" });
    const db = new BunDatabase(path);
    try {
      db.exec("DROP TRIGGER gst_tax_snapshots_no_update");
      db.exec("CREATE TRIGGER gst_tax_snapshots_no_update BEFORE UPDATE ON gst_tax_snapshots BEGIN SELECT 1; END");
      expect(detectDatabaseState(db).state).toBe("UNKNOWN");
    } finally { db.close(); }
  });

  test("restores the invocation-start state after an injected final verification failure", async () => {
    const path = join(tempDir, `restore-${randomUUID()}.sqlite`);
    const backup = join(tempDir, `restore-${randomUUID()}.backup`);
    await createLegacyFixture(path, 2);
    await expect(upgradeSqliteDatabase(path, {
      backupDestinationPath: backup,
      faults: { beforeFinalVerification: () => { throw new Error("final verification fault"); } },
    })).rejects.toMatchObject({ code: "UPGRADE_FAILED_RESTORED" });
    const db = new BunDatabase(path, { readonly: true, safeIntegers: true });
    try {
      expect(detectDatabaseState(db).state).toBe("LEGACY_V2");
      expect(db.query("SELECT id, name FROM tenants").all()).toEqual([{ id: "tenant-fixture", name: "Fixture" }]);
      expect(db.query("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 2n });
    } finally { db.close(); }
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
  });

  test("restores the exact source after legacy, baseline-seed, and official-migration faults", async () => {
    const faultOptions = [
      { beforeLegacyMigration: () => { throw new Error("legacy migration fault"); } },
      { beforeBaselineSeed: () => { throw new Error("baseline seed fault"); } },
      { beforeOfficialMigration: () => { throw new Error("official migration fault"); } },
    ];
    for (const [index, faults] of faultOptions.entries()) {
      const path = join(tempDir, `stage-fault-${index}-${randomUUID()}.sqlite`);
      const backup = join(tempDir, `stage-fault-${index}-${randomUUID()}.backup`);
      await createLegacyFixture(path, 2);
      await expect(upgradeSqliteDatabase(path, { backupDestinationPath: backup, faults })).rejects.toMatchObject({ code: "UPGRADE_FAILED_RESTORED" });
      const db = new BunDatabase(path, { readonly: true, safeIntegers: true });
      try {
        expect(detectDatabaseState(db).state).toBe("LEGACY_V2");
        expect(db.query("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 2n });
      } finally { db.close(); }
    }
  });

  test("blocks readiness when restore itself fails", async () => {
    const path = join(tempDir, `restore-fault-${randomUUID()}.sqlite`);
    const backup = join(tempDir, `restore-fault-${randomUUID()}.backup`);
    await createLegacyFixture(path, 2);
    await expect(upgradeSqliteDatabase(path, {
      backupDestinationPath: backup,
      faults: {
        beforeFinalVerification: () => { throw new Error("final verification fault"); },
        beforeRestore: () => { throw new Error("restore fault"); },
      },
    })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    const db = new BunDatabase(path, { readonly: true });
    try { expect(db.query("SELECT state FROM database_control WHERE id = 1").get()).toEqual({ state: "RECOVERY_REQUIRED" }); }
    finally { db.close(); }
  });
});
