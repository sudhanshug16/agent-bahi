import { describe, expect, it } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  CURRENT_SCHEMA_MANIFEST,
  HISTORICAL_SCHEMA_MANIFESTS,
  MIGRATION_CATALOG,
  ORDERED_UPGRADE_STEPS,
  computeSqliteMigrationChecksum,
  validateMigrationCatalog,
} from "../../src/infrastructure/schema/migration-catalog.ts";
import { DATABASE_CONTROL_CHECKSUM } from "../../src/infrastructure/schema/database-control-schema.ts";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { detectDatabaseState } from "../../src/infrastructure/services/database-state-detector.ts";
import { DRIZZLE_TENANT_PAN_V1_HASH } from "../../src/infrastructure/services/drizzle-baseline.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import {
  createSqliteApplication,
  initializeSqliteDatabase,
  inspectSqliteApplicationCompatibility,
  upgradeSqliteDatabase,
} from "../../src/application/application.ts";

describe("SQLite migration catalog", () => {
  it("rejects duplicate, out-of-order, gapped, and invalid one-step registrations", () => {
    const duplicate = MIGRATION_CATALOG.map((entry) => ({ ...entry }));
    duplicate[1] = { ...duplicate[1], id: duplicate[0].id };
    expect(() => validateMigrationCatalog(duplicate)).toThrow("duplicate");

    const outOfOrder = MIGRATION_CATALOG.map((entry) => ({ ...entry }));
    outOfOrder[2] = { ...outOfOrder[2], sequence: 2 };
    expect(() => validateMigrationCatalog(outOfOrder)).toThrow("contiguous");

    const gapped = MIGRATION_CATALOG.map((entry) => ({ ...entry }));
    gapped[3] = { ...gapped[3], sequence: 9 };
    expect(() => validateMigrationCatalog(gapped)).toThrow("contiguous");

    const invalidStep = MIGRATION_CATALOG.map((entry) => ({ ...entry }));
    invalidStep[3] = { ...invalidStep[3], schemaVersion: invalidStep[2].schemaVersion + 2 };
    expect(() => validateMigrationCatalog(invalidStep)).toThrow("exactly one step");
  });

  it("generates exact ordered prefixes and preserves every migration checksum", () => {
    expect(HISTORICAL_SCHEMA_MANIFESTS.map((manifest) => manifest.migrations.length)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(CURRENT_SCHEMA_MANIFEST).toEqual(HISTORICAL_SCHEMA_MANIFESTS.at(-1)!);
    expect(ORDERED_UPGRADE_STEPS).toHaveLength(6);
    for (let index = 1; index < HISTORICAL_SCHEMA_MANIFESTS.length; index += 1) {
      const source = HISTORICAL_SCHEMA_MANIFESTS[index - 1];
      const target = HISTORICAL_SCHEMA_MANIFESTS[index];
      expect([...target.migrations.slice(0, source.migrations.length)]).toEqual([...source.migrations]);
      expect(ORDERED_UPGRADE_STEPS[index - 1].sourceManifest).toEqual(source);
      expect(ORDERED_UPGRADE_STEPS[index - 1].targetManifest).toEqual(target);
    }
    expect(CURRENT_SCHEMA_MANIFEST.migrations.map((migration) => migration.id)).toEqual(MIGRATION_CATALOG.map((entry) => entry.id));
    expect(CURRENT_SCHEMA_MANIFEST.migrations.every((migration, index) => migration.checksum === (MIGRATION_CATALOG[index].id === "0002-database-control" ? DATABASE_CONTROL_CHECKSUM : computeSqliteMigrationChecksum(MIGRATION_CATALOG[index].sqlite)))).toBe(true);
  });

  it("keeps ordinary construction and status inspection non-mutating, then upgrades explicitly", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-catalog-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      await initializeSqliteDatabase(dbPath, { cliVersion: "test", buildId: "catalog" });
      const before = await readFile(dbPath);
      const compatibilityDb = new SqliteAdapter({ path: dbPath });
      expect((await new DatabaseControlService(compatibilityDb, "sqlite").inspect()).status).toBe("AVAILABLE");
      await compatibilityDb.close();
      // With Drizzle baseline, fresh initialization creates complete v8 schema
      await expect(inspectSqliteApplicationCompatibility(dbPath)).resolves.toMatchObject({
        status: "READY",
        currentSchemaVersion: 8,
        requiredSchemaVersion: 8,
        currentDataFormatVersion: 1,
        requiredDataFormatVersion: 1,
      });
      // Application operations should succeed without upgrade required
      const application = createSqliteApplication(dbPath);
      const tenants = await application.tenant.listActiveTenants();
      expect(tenants).toEqual([]);

      // Database file should not change on inspection
      expect(await readFile(dbPath)).toEqual(before);

      // Upgrade should be a no-op since already at v8
      await upgradeSqliteDatabase(dbPath, { backupDestinationPath: join(directory, "no-op.sqlite"), cliVersion: "test", buildId: "catalog" });
      expect(await Bun.file(join(directory, "no-op.sqlite")).exists()).toBe(false);
      const native = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
      // Fresh Drizzle DB should NOT have legacy schema_migrations table; only the official journal
      expect(() => native.query("SELECT COUNT(*) as count FROM schema_migrations").get()).toThrow();
      // Should have the official Drizzle migration journal
      expect(native.query("SELECT COUNT(*) as count FROM __drizzle_migrations").get()).toEqual({
        count: 12n,
      });
      expect(detectDatabaseState(native)).toMatchObject({ state: "DRIZZLE_MANAGED", schemaVersion: 8, drizzleMigrationCount: 12 });
      expect(native.query("SELECT schema_version FROM database_control").get()).toEqual({ schema_version: 8n });
      native.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("recognizes exact 0019, verifies its backup, applies 0020 once, and verifies/restores current", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-close-pack-migration-"));
    const dbPath = join(directory, "books.sqlite");
    const priorBackupPath = join(directory, "prior.sqlite");
    const currentBackupPath = join(directory, "current.sqlite");
    const restoredPath = join(directory, "restored.sqlite");
    try {
      await initializeSqliteDatabase(dbPath, { cliVersion: "test", buildId: "close-pack-migration" });
      const downgradeFixture = new BunDatabase(dbPath, { safeIntegers: true });
      downgradeFixture.exec("DROP TABLE close_pack_bodies; DROP TABLE close_pack_sections; DROP TABLE close_pack_manifests");
      downgradeFixture.query("DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)").run();
      downgradeFixture.query("UPDATE database_control SET last_migration_id = ?, last_migration_checksum = ? WHERE id = 1").run("0019_tenant_pan_v1", DRIZZLE_TENANT_PAN_V1_HASH);
      downgradeFixture.close();

      const prior = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
      expect(detectDatabaseState(prior)).toMatchObject({ state: "DRIZZLE_MANAGED", schemaVersion: 8, drizzleMigrationCount: 11 });
      prior.close();
      const backupService = new BackupService(dbPath);
      await backupService.createBackup(priorBackupPath);
      expect(await backupService.verifyBackup(priorBackupPath)).toBe(true);

      await upgradeSqliteDatabase(dbPath, { backupDestinationPath: join(directory, "upgrade-invocation.sqlite"), cliVersion: "test", buildId: "close-pack-upgrade" });
      const current = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
      expect(detectDatabaseState(current)).toMatchObject({ state: "DRIZZLE_MANAGED", schemaVersion: 8, drizzleMigrationCount: 12 });
      expect(current.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 12n });
      expect(current.query("SELECT COUNT(*) AS count FROM close_pack_manifests").get()).toEqual({ count: 0n });
      current.close();

      await backupService.createBackup(currentBackupPath);
      expect(await backupService.verifyBackup(currentBackupPath)).toBe(true);
      expect(await backupService.restoreFromBackup(currentBackupPath, restoredPath)).toBe(true);
      const restored = new BunDatabase(restoredPath, { readonly: true, safeIntegers: true });
      expect(detectDatabaseState(restored)).toMatchObject({ state: "DRIZZLE_MANAGED", schemaVersion: 8, drizzleMigrationCount: 12 });
      expect(restored.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 12n });
      restored.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
