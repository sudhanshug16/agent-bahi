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
        count: 2n,
      });
      expect(native.query("SELECT schema_version FROM database_control").get()).toEqual({ schema_version: 8n });
      native.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
