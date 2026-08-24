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
import { DRIZZLE_TENANT_PAN_V1_HASH, OFFICIAL_DRIZZLE_MIGRATIONS, officialDrizzleJournal, validateOfficialDrizzleJournal } from "../../src/infrastructure/services/drizzle-baseline.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import {
  createSqliteApplication,
  initializeSqliteDatabase,
  inspectSqliteApplicationCompatibility,
  upgradeSqliteDatabase,
} from "../../src/application/application.ts";

describe("SQLite migration catalog", () => {
  it("requires the exact positive, ordered official Drizzle journal row shape", () => {
    const rows = officialDrizzleJournal().map((row) => ({ id: row.id, hash: row.hash, created_at: row.createdAt }));
    expect(() => validateOfficialDrizzleJournal(rows)).not.toThrow();

    const malformed = [
      rows.map(({ hash, created_at }) => ({ hash, created_at })),
      rows.map((row, index) => index === 0 ? { ...row, id: null } : row),
      rows.map((row, index) => index === 0 ? { ...row, id: "1" } : row),
      rows.map((row, index) => index === 1 ? { ...row, id: 1 } : row),
      rows.map((row, index) => index === 1 ? { ...row, id: 3 } : row),
      rows.map((row, index) => index === 0 ? { ...row, hash: undefined } : row),
      rows.map((row, index) => index === 0 ? { ...row, created_at: undefined } : row),
      [...rows, { id: 13, hash: rows.at(-1)!.hash, created_at: rows.at(-1)!.created_at }],
      rows.slice(0, -1),
    ];
    for (const candidate of malformed) expect(() => validateOfficialDrizzleJournal(candidate)).toThrow();
  });

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

  it("keeps Drizzle SQL and backup/catalog checkpoint authority centralized", async () => {
    expect(OFFICIAL_DRIZZLE_MIGRATIONS).toHaveLength(officialDrizzleJournal().length);
    expect(OFFICIAL_DRIZZLE_MIGRATIONS.map((migration) => migration.order)).toEqual([...Array(OFFICIAL_DRIZZLE_MIGRATIONS.length)].map((_, index) => index + 1));
    expect(OFFICIAL_DRIZZLE_MIGRATIONS.every((migration) => migration.sql.length > 0 && migration.hash.length === 64)).toBe(true);
    const validator = await readFile(join(import.meta.dir, "../../src/infrastructure/services/sqlite-catalog-validator.ts"), "utf8");
    const backup = await readFile(join(import.meta.dir, "../../src/infrastructure/services/backup-service.ts"), "utf8");
    expect(validator).not.toContain("DRIZZLE_MIGRATION_IDS");
    expect(validator).not.toMatch(/readFileSync\([^)]*drizzle/);
    expect(backup).not.toContain("MIGRATION_CATALOG");
    expect(backup).not.toContain("MIGRATION_SCHEMA_SQLITE");
    expect(backup).not.toMatch(/DRIZZLE_[A-Z0-9_]+_MIGRATION_ID/);
    expect(backup).not.toMatch(/DRIZZLE_[A-Z0-9_]+_HASH/);
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
        count: BigInt(OFFICIAL_DRIZZLE_MIGRATIONS.length),
      });
      expect(detectDatabaseState(native)).toMatchObject({ state: "DRIZZLE_MANAGED", schemaVersion: 8, drizzleMigrationCount: OFFICIAL_DRIZZLE_MIGRATIONS.length });
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
      downgradeFixture.exec("DROP TABLE source_import_events; DROP TABLE source_registrations;");
      downgradeFixture.exec("DROP TRIGGER fiscal_year_rollovers_no_delete; DROP TRIGGER fiscal_year_rollovers_no_update; DROP TABLE fiscal_year_rollovers; DROP TRIGGER gst_gstr3b_export_activities_no_delete; DROP TRIGGER gst_gstr3b_export_activities_no_update; DROP TRIGGER gst_gstr3b_validation_runs_no_delete; DROP TRIGGER gst_gstr3b_validation_runs_no_update; DROP TRIGGER gst_gstr3b_artifacts_no_delete; DROP TRIGGER gst_gstr3b_artifacts_no_update; DROP TRIGGER gst_gstr3b_fact_events_no_delete; DROP TRIGGER gst_gstr3b_fact_events_no_update; DROP TRIGGER gst_gstr3b_facts_no_delete; DROP TRIGGER gst_gstr3b_facts_no_update; DROP TRIGGER gst_gstr3b_schema_pack_events_no_delete; DROP TRIGGER gst_gstr3b_schema_pack_events_no_update; DROP TRIGGER gst_gstr3b_schema_packs_no_delete; DROP TRIGGER gst_gstr3b_schema_packs_no_update; DROP TABLE gst_gstr3b_export_activities; DROP TABLE gst_gstr3b_validation_runs; DROP TABLE gst_gstr3b_artifacts; DROP TABLE gst_gstr3b_fact_events; DROP TABLE gst_gstr3b_facts; DROP TABLE gst_gstr3b_schema_pack_events; DROP TABLE gst_gstr3b_schema_packs; DROP TRIGGER personal_tax_position_worksheets_no_delete; DROP TRIGGER personal_tax_position_worksheets_no_update; DROP TABLE personal_tax_position_worksheets; DROP TRIGGER tax_case_source_assessment_events_no_delete; DROP TRIGGER tax_case_source_assessment_events_no_update; DROP TRIGGER tax_case_source_assessments_no_delete; DROP TRIGGER tax_case_source_assessments_no_update; DROP TABLE tax_case_source_assessment_events; DROP TABLE tax_case_source_assessments; DROP TRIGGER filing_snapshot_reconciliations_no_delete; DROP TRIGGER filing_snapshot_reconciliations_no_update; DROP TRIGGER filing_snapshot_facts_no_delete; DROP TRIGGER filing_snapshot_facts_no_update; DROP TRIGGER filing_snapshot_sources_no_delete; DROP TRIGGER filing_snapshot_sources_no_update; DROP TRIGGER filing_snapshot_book_sets_no_delete; DROP TRIGGER filing_snapshot_book_sets_no_update; DROP TRIGGER filing_snapshots_no_delete; DROP TRIGGER filing_snapshots_no_update; DROP TABLE filing_snapshot_reconciliations; DROP TABLE filing_snapshot_facts; DROP TABLE filing_snapshot_sources; DROP TABLE filing_snapshot_book_sets; DROP TABLE filing_snapshots");
      downgradeFixture.exec("DROP TRIGGER tax_case_fact_reconciliations_no_overallocation; DROP TRIGGER tax_case_fact_reconciliations_confirmed_only; DROP TRIGGER tax_case_fact_reconciliations_no_delete; DROP TRIGGER tax_case_fact_reconciliations_no_update; DROP TRIGGER tax_case_fact_events_no_delete; DROP TRIGGER tax_case_fact_events_no_update; DROP TRIGGER tax_case_facts_no_delete; DROP TRIGGER tax_case_facts_no_update; DROP INDEX uq_tax_case_facts_id_scope; DROP INDEX uq_journal_lines_id_tenant_book_set_v1; DROP TABLE tax_case_fact_reconciliations; DROP TABLE tax_case_fact_events; DROP TABLE tax_case_facts; DROP TRIGGER tax_case_source_artifacts_no_delete; DROP TRIGGER tax_case_source_artifacts_no_update; DROP TRIGGER tax_case_external_sources_no_delete; DROP TRIGGER tax_case_external_sources_no_update; DROP TRIGGER personal_tax_source_artifacts_no_delete; DROP TRIGGER personal_tax_source_artifacts_no_update; DROP TRIGGER journal_entries_ledger_revision_advance; DROP TRIGGER book_sets_ledger_revision_init; DROP TRIGGER tax_case_memberships_no_delete; DROP TRIGGER tax_case_memberships_no_update; DROP TRIGGER tax_case_membership_versions_no_delete; DROP TRIGGER tax_case_membership_versions_no_update; DROP TRIGGER tax_cases_no_delete; DROP TABLE tax_case_source_artifacts; DROP TABLE tax_case_external_sources; DROP TABLE personal_tax_source_artifacts; DROP TABLE tax_case_memberships; DROP TABLE tax_case_membership_versions; DROP TABLE tax_cases; DROP TABLE book_set_ledger_revisions; DROP TABLE close_pack_bodies; DROP TABLE close_pack_sections; DROP TABLE close_pack_manifests");
      const laterPrefixes = ["gst_gstr3b_", "gst_gstr1_", "gst_return_schema_", "withholding_statement_", "personal_tax_", "tax_case_itr_", "mca_", "payroll_statutory_", "zoho_backup_", "source_staging_"];
      const laterObjects = downgradeFixture.query("SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'index', 'table') AND (" + laterPrefixes.map(() => "name LIKE ?").join(" OR ") + ") ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name DESC").all(...laterPrefixes.map((prefix) => `${prefix}%`)) as Array<{ type: string; name: string }>;
      for (const object of laterObjects) downgradeFixture.exec(`DROP ${object.type.toUpperCase()} "${object.name.replaceAll('"', '""')}"`);
      downgradeFixture.query("DELETE FROM __drizzle_migrations WHERE created_at >= (SELECT created_at FROM __drizzle_migrations WHERE id = 12)").run();
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
      expect(detectDatabaseState(current)).toMatchObject({ state: "DRIZZLE_MANAGED", schemaVersion: 8, drizzleMigrationCount: OFFICIAL_DRIZZLE_MIGRATIONS.length });
      expect(current.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: BigInt(OFFICIAL_DRIZZLE_MIGRATIONS.length) });
      expect(current.query("SELECT COUNT(*) AS count FROM close_pack_manifests").get()).toEqual({ count: 0n });
      current.close();

      await backupService.createBackup(currentBackupPath);
      expect(await backupService.verifyBackup(currentBackupPath)).toBe(true);
      expect(await backupService.restoreFromBackup(currentBackupPath, restoredPath)).toBe(true);
      const restored = new BunDatabase(restoredPath, { readonly: true, safeIntegers: true });
      expect(detectDatabaseState(restored)).toMatchObject({ state: "DRIZZLE_MANAGED", schemaVersion: 8, drizzleMigrationCount: OFFICIAL_DRIZZLE_MIGRATIONS.length });
      expect(restored.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: BigInt(OFFICIAL_DRIZZLE_MIGRATIONS.length) });
      restored.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
