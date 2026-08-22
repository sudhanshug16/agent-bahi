import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Database as BunDatabase } from "bun:sqlite";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { UpgradeCoordinator } from "../../src/infrastructure/services/upgrade-coordinator.ts";
import { BOOKSET_V4_UPGRADE_PLAN } from "../../src/infrastructure/schema/upgrade-plans.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_MIGRATIONS } from "../../src/infrastructure/schema/database-control-schema.ts";
import { BOOKSET_V3_MIGRATION } from "../../src/infrastructure/schema/bookset-v3-migration.ts";
import { V3_SCHEMA_MANIFEST, V4_SCHEMA_MANIFEST } from "../../src/infrastructure/schema/current-manifest.ts";

let directory: string;
let dbPath: string;
let db: SqliteAdapter;

async function setupV3(): Promise<void> {
  directory = await mkdtemp(join(tmpdir(), "agent-bahi-v4-integrity-"));
  dbPath = join(directory, "live.sqlite");
  db = new SqliteAdapter({ path: dbPath });
  await new MigrationService(db, "sqlite").migrate([
    { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
    { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
    { id: BOOKSET_V3_MIGRATION.id, sql: BOOKSET_V3_MIGRATION.sqlite },
  ]);
  const control = new DatabaseControlService(db, "sqlite", V3_SCHEMA_MANIFEST);
  await db.withMigrationLease((session) => control.initialize({
    cliVersion: "test",
    buildId: "v3",
    now: new Date("2026-01-01T00:00:00.000Z"),
  }, session).then(() => undefined));
}

async function upgradeV4(faults?: ConstructorParameters<typeof UpgradeCoordinator>[2]): Promise<void> {
  await new UpgradeCoordinator(db, new BackupService({
    sourcePath: dbPath,
    expectedSourceManifest: V3_SCHEMA_MANIFEST,
  }), faults).upgrade({
    plan: BOOKSET_V4_UPGRADE_PLAN,
    backupDestinationPath: join(directory, "v3-to-v4.sqlite"),
    cliVersion: "test",
    buildId: "v4",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
}

async function insertTenant(id: string): Promise<void> {
  await db.execute(
    "INSERT INTO tenants (id, kind, lifecycle, name, created_at, updated_at) VALUES (?, 'COMPANY', 'CREATING', ?, ?, ?)",
    [id, id, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
  );
}

async function insertBookSet(id: string, tenantId: string): Promise<void> {
  await db.execute(
    "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, 'COMPANY', ?, 'ACTIVE', ?, ?)",
    [id, tenantId, id, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
  );
}

afterEach(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

describe("BookSet v4 migration integrity", () => {
  beforeEach(setupV3);

  it("preserves every v3 audit value and NULL exactly while retaining the row count", async () => {
    const tenantId = randomUUID();
    await insertTenant(tenantId);
    const legacy = {
      id: randomUUID(),
      tenantId,
      actorId: "legacy\u0000actor",
      action: "unrecognized-legacy-action",
      entityType: null,
      entityId: "entity\u0000id",
      requestId: null,
      changeSummary: "bytes\u0000unchanged",
      evidenceIds: null,
      createdAt: "2026-01-01T01:02:03.004Z",
    };
    await db.execute(
      `INSERT INTO audit_records
       (id, tenant_id, action, actor_type, actor_id, request_id, entity_type, entity_id, change_summary, evidence_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [legacy.id, legacy.tenantId, legacy.action, "legacy-actor-type", legacy.actorId, legacy.requestId, legacy.entityType, legacy.entityId, legacy.changeSummary, legacy.evidenceIds, legacy.createdAt],
    );

    await upgradeV4();

    expect(await db.querySingle("SELECT COUNT(*) AS count FROM audit_records")).toEqual({ count: 1n });
    expect(await db.querySingle(
      "SELECT id, tenant_id, actor_type, actor_id, action, entity_type, entity_id, request_id, change_summary, evidence_ids, created_at, occurred_at, before_json, after_json, correlation_id, command, source, reason FROM audit_records WHERE id = ?",
      [legacy.id],
    )).toEqual({
      id: legacy.id,
      tenant_id: legacy.tenantId,
      actor_type: "legacy-actor-type",
      actor_id: legacy.actorId,
      action: legacy.action,
      entity_type: legacy.entityType,
      entity_id: legacy.entityId,
      request_id: legacy.requestId,
      change_summary: legacy.changeSummary,
      evidence_ids: legacy.evidenceIds,
      created_at: legacy.createdAt,
      occurred_at: null,
      before_json: null,
      after_json: null,
      correlation_id: null,
      command: null,
      source: null,
      reason: null,
    });
  });

  it("rejects direct cross-tenant audit insert and update", async () => {
    const tenant1 = randomUUID();
    const tenant2 = randomUUID();
    const bookSet1 = randomUUID();
    const bookSet2 = randomUUID();
    await insertTenant(tenant1);
    await insertTenant(tenant2);
    await insertBookSet(bookSet1, tenant1);
    await insertBookSet(bookSet2, tenant2);
    await upgradeV4();

    const now = "2026-01-01T00:00:00.000Z";
    const auditId = randomUUID();
    await db.execute(
      `INSERT INTO audit_records
       (id, tenant_id, book_set_id, command, action, actor_type, source, reason, request_id, created_at)
       VALUES (?, ?, ?, 'test', 'test', 'HUMAN', 'CLI', 'test', ?, ?)`,
      [auditId, tenant1, bookSet1, randomUUID(), now],
    );
    await expect(db.execute("INSERT INTO audit_records (id, tenant_id, book_set_id, action, actor_type, created_at) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), tenant1, bookSet2, "test", "legacy", now])).rejects.toThrow();
    await expect(db.execute("UPDATE audit_records SET book_set_id = ? WHERE id = ?", [bookSet2, auditId])).rejects.toThrow();
    await expect(db.execute("UPDATE audit_records SET tenant_id = ? WHERE id = ?", [tenant2, auditId])).rejects.toThrow();
  });

  it("allows exactly one tenant creation finalization and blocks later edits/deletes", async () => {
    const tenantId = randomUUID();
    await insertTenant(tenantId);
    await upgradeV4();
    const requestId = randomUUID();
    const requestRowId = randomUUID();
    await db.execute(
      "INSERT INTO tenant_creation_requests (id, request_id, request_hash, created_at) VALUES (?, ?, ?, ?)",
      [requestRowId, requestId, "request-hash", "2026-01-01T00:00:00.000Z"],
    );
    await db.execute(
      "UPDATE tenant_creation_requests SET tenant_id = ?, result_json = ?, result_hash = ? WHERE id = ?",
      [tenantId, "{\"ok\":true}", "result-hash", requestRowId],
    );
    await expect(db.execute("UPDATE tenant_creation_requests SET result_json = ? WHERE id = ?", ["{\"ok\":false}", requestRowId])).rejects.toThrow();
    await expect(db.execute("DELETE FROM tenant_creation_requests WHERE id = ?", [requestRowId])).rejects.toThrow();
  });

  it("rolls back before destructive promotion when target verification faults", async () => {
    const tenantId = randomUUID();
    await insertTenant(tenantId);
    await db.execute(
      "INSERT INTO audit_records (id, tenant_id, action, actor_type, created_at) VALUES (?, ?, ?, ?, ?)",
      [randomUUID(), tenantId, "legacy-action", "legacy-actor", "2026-01-01T00:00:00.000Z"],
    );
    await expect(upgradeV4({ beforeTargetVerification: async () => { throw new Error("fault"); } })).rejects.toMatchObject({ code: "UPGRADE_APPLY_FAILED" });
    expect(await db.querySingle("SELECT COUNT(*) AS count FROM audit_records")).toEqual({ count: 1n });
    expect(await db.querySingle("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_records_v4'")).toBeNull();
    expect(await db.querySingle("SELECT state, schema_version FROM database_control WHERE id = 1")).toMatchObject({ state: "READY", schema_version: 3n });
  });

  it("requires the complete v4 catalog when verifying a backup", async () => {
    await upgradeV4();
    const backup = new BackupService(dbPath);
    const v4BackupPath = join(directory, "v4-copy.sqlite");
    await backup.createBackup(v4BackupPath, V4_SCHEMA_MANIFEST);
    await expect(backup.verifyBackup(v4BackupPath, V4_SCHEMA_MANIFEST)).resolves.toBe(true);
    const copied = new BunDatabase(v4BackupPath);
    copied.exec("DROP TRIGGER audit_records_no_update");
    copied.close();
    await expect(backup.verifyBackup(v4BackupPath, V4_SCHEMA_MANIFEST)).rejects.toMatchObject({ code: "BACKUP_SCHEMA_MISMATCH" });
  });
});
