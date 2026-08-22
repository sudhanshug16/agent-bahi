import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database as BunDatabase } from "bun:sqlite";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import { UpgradeCoordinator } from "../../src/infrastructure/services/upgrade-coordinator.ts";
import { BusinessSessionFactory } from "../../src/infrastructure/adapters/business-session-factory.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import {
  CURRENT_SCHEMA_MANIFEST,
  computeSqliteMigrationChecksum,
  schemaManifestHash,
  type SqliteSchemaManifest,
} from "../../src/infrastructure/schema/current-manifest.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_MIGRATIONS } from "../../src/infrastructure/schema/database-control-schema.ts";
import type { UpgradePlan, UpgradeRequest } from "../../src/application/ports/upgrade.ts";

let directory: string;
let dbPath: string;
let db: SqliteAdapter;

const markerSql = "CREATE TABLE upgrade_marker (id TEXT PRIMARY KEY, value TEXT NOT NULL)";

function planFor(sql: string = markerSql): UpgradePlan {
  const migration = {
    id: "0003-upgrade-marker",
    sql,
    manifest: {
      version: 1,
      dialect: "sqlite" as const,
      retrySafe: true,
      probes: [{ id: "marker", sql: "SELECT id FROM upgrade_marker LIMIT 1", expectedRows: [] }],
    },
  };
  const targetManifest: SqliteSchemaManifest = {
    ...CURRENT_SCHEMA_MANIFEST,
    schemaVersion: 3,
    revision: 2,
    migrations: [...CURRENT_SCHEMA_MANIFEST.migrations, {
      id: migration.id,
      checksum: computeSqliteMigrationChecksum(sql),
      dialect: "sqlite",
      status: "APPLIED",
    }],
  };
  return {
    sourceManifest: CURRENT_SCHEMA_MANIFEST,
    targetManifest,
    migration,
    preflightProbes: [{ id: "source-empty", sql: "SELECT id FROM tenants LIMIT 1", expectedRows: [] }],
  };
}

function request(plan: UpgradePlan, backupName: string): UpgradeRequest {
  return {
    plan,
    backupDestinationPath: join(directory, backupName),
    cliVersion: "test",
    buildId: "upgrade-test",
    now: new Date("2026-01-01T00:00:00.000Z"),
  };
}

async function setup(): Promise<void> {
  directory = await mkdtemp(join(tmpdir(), "agent-bahi-upgrade-"));
  dbPath = join(directory, "live.sqlite");
  db = new SqliteAdapter({ path: dbPath });
  const migrations = new MigrationService(db, "sqlite");
  await migrations.migrate([
    { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
    { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
  ]);
  const control = new DatabaseControlService(db, "sqlite");
  await db.withMigrationLease((session) => control.initialize({ cliVersion: "test", buildId: "setup", now: new Date("2026-01-01T00:00:00.000Z") }, session).then(() => undefined));
}

async function cleanup(): Promise<void> {
  await db.close();
  await rm(directory, { recursive: true, force: true });
}

describe("SQLite UpgradeCoordinator", () => {
  beforeEach(setup);
  afterEach(cleanup);

  it("applies a synthetic v2 to v3 extension and stores only verified backup metadata", async () => {
    const plan = planFor();
    const result = await new UpgradeCoordinator(db, new BackupService(dbPath)).upgrade(request(plan, "v2.sqlite"));
    expect(result.status).toBe("APPLIED");
    expect(result.backup?.checksum).toMatch(/^[0-9a-f]{64}$/);
    const snapshot = new BunDatabase(result.backup!.path, { readonly: true, safeIntegers: true });
    expect(snapshot.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'upgrade_marker'").all()).toEqual([]);
    snapshot.close();
    expect(await db.querySingle("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'upgrade_marker'")).toBeDefined();
    const row = await db.querySingle("SELECT manifest_json FROM schema_migrations WHERE id = ?", ["0003-upgrade-marker"]);
    expect(String(row?.manifest_json)).not.toContain(result.backup!.path);
    expect(String(row?.manifest_json)).toContain(schemaManifestHash(plan.targetManifest));
  });

  it("holds the migration lock while VACUUM INTO runs", async () => {
    const writer = new SqliteAdapter({ path: dbPath });
    let busy = false;
    const backup = new BackupService({
      sourcePath: dbPath,
      afterVacuum: async () => {
        try {
          await writer.execute("INSERT INTO tenants (id, kind, lifecycle, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["blocked", "COMPANY", "ACTIVE", "blocked", "now", "now"]);
        } catch (error) {
          busy = (error as { code?: string }).code === "SQLITE_CONTENTION_BUSY" || (error as { code?: string }).code === "SQLITE_CONTENTION_LOCKED";
        }
      },
    });
    await new UpgradeCoordinator(db, backup).upgrade(request(planFor(), "locked.sqlite"));
    await writer.close();
    expect(busy).toBe(true);
  });

  it("rejects source and preflight mismatches before backup or mutation", async () => {
    const mismatch: UpgradePlan = { ...planFor(), preflightProbes: [{ id: "wrong", sql: "SELECT id FROM tenants LIMIT 1", expectedRows: [{ id: "unexpected" }] }] };
    await expect(new UpgradeCoordinator(db, new BackupService(dbPath)).upgrade(request(mismatch, "preflight.sqlite"))).rejects.toMatchObject({ code: "UPGRADE_PREFLIGHT_FAILED" });
    expect(await Bun.file(join(directory, "preflight.sqlite")).exists()).toBe(false);
    await db.execute("UPDATE database_control SET revision = 9 WHERE id = 1");
    await expect(new UpgradeCoordinator(db, new BackupService(dbPath)).upgrade(request(planFor(), "source.sqlite"))).rejects.toMatchObject({ code: "UPGRADE_SOURCE_MISMATCH" });
    expect(await Bun.file(join(directory, "source.sqlite")).exists()).toBe(false);
    expect(await db.querySingle("SELECT name FROM sqlite_master WHERE name = 'upgrade_marker'")).toBeNull();
  });

  it("rolls back DDL and history/control after backup while preserving the verified backup", async () => {
    const plan = planFor(`${markerSql}; SELECT * FROM missing_upgrade_table`);
    const backupPath = join(directory, "failed.sqlite");
    let error: Error & { code?: string; backup?: { path: string } };
    try {
      await new UpgradeCoordinator(db, new BackupService(dbPath)).upgrade(request(plan, "failed.sqlite"));
      throw new Error("expected upgrade failure");
    } catch (failure) {
      error = failure as Error & { code?: string; backup?: { path: string } };
    }
    expect(error.code).toBe("UPGRADE_APPLY_FAILED");
    expect(error.backup?.path.endsWith("/failed.sqlite")).toBe(true);
    expect(await Bun.file(backupPath).exists()).toBe(true);
    expect(await db.querySingle("SELECT name FROM sqlite_master WHERE name = 'upgrade_marker'")).toBeNull();
    expect(await db.querySingle("SELECT COUNT(*) AS count FROM schema_migrations WHERE id = ?", [plan.migration.id])).toEqual({ count: 0n });
    expect(await db.querySingle("SELECT state, schema_version, revision FROM database_control WHERE id = 1")).toMatchObject({ state: "READY", schema_version: 2n, revision: 1n });
  });

  it("replays exactly without a new backup and rejects changed checksum/manifest identity", async () => {
    const firstPlan = planFor();
    const coordinator = new UpgradeCoordinator(db, new BackupService(dbPath));
    await coordinator.upgrade(request(firstPlan, "first.sqlite"));
    const replay = await coordinator.upgrade(request(firstPlan, "replay.sqlite"));
    expect(replay.status).toBe("ALREADY_APPLIED");
    expect(await Bun.file(join(directory, "replay.sqlite")).exists()).toBe(false);
    const changed = planFor("CREATE TABLE upgrade_marker (id TEXT PRIMARY KEY, changed TEXT NOT NULL)");
    await expect(coordinator.upgrade(request(changed, "conflict.sqlite"))).rejects.toMatchObject({ code: "UPGRADE_IDEMPOTENCY_CONFLICT" });
  });

  it("uses injected v3 readers while the default v2 reader rejects the upgraded database", async () => {
    const plan = planFor();
    await new UpgradeCoordinator(db, new BackupService(dbPath)).upgrade(request(plan, "reader.sqlite"));
    const oldReader = BusinessSessionFactory.createSessionRunner(dbPath, "sqlite", 1, 1);
    await expect(oldReader.withBusinessSession("read", async () => undefined)).rejects.toMatchObject({ code: "DATABASE_CONTROL_UNAVAILABLE" });
    const v3Reader = BusinessSessionFactory.createSessionRunner(dbPath, "sqlite", 1, 1, plan.targetManifest);
    await expect(v3Reader.withBusinessSession("read", async (session) => session.querySingle("SELECT id FROM tenants LIMIT 1"))).resolves.toBeNull();
  });

  it("invalidates captured migration sessions after the lease callback", async () => {
    let captured: import("../../src/application/ports/persistence.ts").MigrationSession | undefined;
    await db.withMigrationLease(async (session) => { captured = session; });
    await expect(captured!.executeSingle("SELECT 1")).rejects.toMatchObject({ code: "MIGRATION_SESSION_INACTIVE" });
  });

  it("recovers exact source, exact target, mixed state, and commit-unknown outcome", async () => {
    const plan = planFor();
    const coordinator = new UpgradeCoordinator(db, new BackupService(dbPath));
    await expect(coordinator.recover({ request: request(plan, "unused.sqlite"), reason: "inspect" })).resolves.toMatchObject({ status: "ROLLED_BACK" });
    let uncertain = false;
    const faulted = new UpgradeCoordinator(db, new BackupService(dbPath), { afterCommit: () => { uncertain = true; throw new Error("connection status fault"); } });
    await expect(faulted.upgrade(request(plan, "unknown.sqlite"))).rejects.toMatchObject({ code: "UPGRADE_OUTCOME_UNCERTAIN" });
    expect(uncertain).toBe(true);
    await expect(coordinator.recover({ request: request(plan, "unused-2.sqlite"), reason: "reopen" })).resolves.toMatchObject({ status: "APPLIED" });
    await db.execute("UPDATE database_control SET state = 'RECOVERY_REQUIRED', recovery_reason = 'mixed' WHERE id = 1");
    await expect(coordinator.recover({ request: request(plan, "unused-3.sqlite"), reason: "mixed" })).resolves.toMatchObject({ status: "RECOVERY_REQUIRED" });
  });
});
