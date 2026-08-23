import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Database as BunDatabase } from "bun:sqlite";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_MIGRATIONS } from "../../src/infrastructure/schema/database-control-schema.ts";
import { BOOKSET_V3_MIGRATION } from "../../src/infrastructure/schema/bookset-v3-migration.ts";
import { BOOKSET_V4_MIGRATION } from "../../src/infrastructure/schema/bookset-v4-migration.ts";
import { JOURNAL_V5_MIGRATION } from "../../src/infrastructure/schema/journal-v5-migration.ts";
import { SALES_V6_MIGRATION } from "../../src/infrastructure/schema/sales-v6-migration.ts";
import { PURCHASE_V7_MIGRATION } from "../../src/infrastructure/schema/purchase-v7-migration.ts";
import { V6_SCHEMA_MANIFEST, V7_SCHEMA_MANIFEST } from "../../src/infrastructure/schema/current-manifest.ts";

describe("Purchase V7 migration", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("upgrades an exact V6 database through bootstrap and the UpgradeCoordinator", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-v7-migration-"));
    const dbPath = join(directory, "books.sqlite");
    const db = new SqliteAdapter({ path: dbPath });
    await new MigrationService(db, "sqlite").migrate([
      { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
      { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
      { id: BOOKSET_V3_MIGRATION.id, sql: BOOKSET_V3_MIGRATION.sqlite },
      { id: BOOKSET_V4_MIGRATION.id, sql: BOOKSET_V4_MIGRATION.sqlite },
      { id: JOURNAL_V5_MIGRATION.id, sql: JOURNAL_V5_MIGRATION.sqlite },
      { id: SALES_V6_MIGRATION.id, sql: SALES_V6_MIGRATION.sqlite },
    ]);
    await db.withMigrationLease((session) => new DatabaseControlService(db, "sqlite", V6_SCHEMA_MANIFEST).initialize({ cliVersion: "test", buildId: "v6", now: new Date() }, session).then(() => undefined));
    await db.close();

    await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "v7" });
    const native = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
    expect(native.query("SELECT schema_version, last_migration_id FROM database_control").get()).toEqual({ schema_version: 8n, last_migration_id: "0008-bank-reconciliation" });
    expect(native.query("SELECT name FROM pragma_table_info('parties') WHERE name = 'party_role'").get()).toEqual({ name: "party_role" });
    expect(native.query("SELECT COUNT(*) AS count FROM vendor_bills").get()).toEqual({ count: 0n });
    expect(native.query("SELECT COUNT(*) AS count FROM bank_statements").get()).toEqual({ count: 0n });
    native.close();
  });

  it("upgrades an exact V7 database through the bank reconciliation coordinator hop", async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-v8-migration-"));
    const dbPath = join(directory, "books.sqlite");
    const db = new SqliteAdapter({ path: dbPath });
    await new MigrationService(db, "sqlite").migrate([
      { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
      { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
      { id: BOOKSET_V3_MIGRATION.id, sql: BOOKSET_V3_MIGRATION.sqlite },
      { id: BOOKSET_V4_MIGRATION.id, sql: BOOKSET_V4_MIGRATION.sqlite },
      { id: JOURNAL_V5_MIGRATION.id, sql: JOURNAL_V5_MIGRATION.sqlite },
      { id: SALES_V6_MIGRATION.id, sql: SALES_V6_MIGRATION.sqlite },
      { id: PURCHASE_V7_MIGRATION.id, sql: PURCHASE_V7_MIGRATION.sqlite },
    ]);
    await db.withMigrationLease((session) => new DatabaseControlService(db, "sqlite", V7_SCHEMA_MANIFEST).initialize({ cliVersion: "test", buildId: "v7", now: new Date() }, session).then(() => undefined));
    await db.close();
    await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "v8" });
    const native = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
    expect(native.query("SELECT schema_version, last_migration_id FROM database_control").get()).toEqual({ schema_version: 8n, last_migration_id: "0008-bank-reconciliation" });
    expect(native.query("SELECT COUNT(*) AS count FROM bank_matches").get()).toEqual({ count: 0n });
    native.close();
  });
});
