import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "crypto";
import type { Database } from "../../src/application/ports/persistence.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";

describe("bounded recovery verification probes", () => {
  let db: Database;
  let migrations: MigrationService;
  let dbPath: string;

  beforeEach(() => {
    dbPath = `/tmp/recovery-probes-${randomUUID()}.sqlite`;
    db = new SqliteAdapter({ path: dbPath });
    migrations = new MigrationService(db, "sqlite");
  });

  afterEach(async () => {
    await db.close();
  });

  function checksum(sql: string): string {
    return createHash("sha256").update(sql).digest("hex");
  }

  async function makeDirty(id: string): Promise<{ checksum: string; dirtyReason: string; sql: string }> {
    const table = id.replace(/[^a-z0-9_]/gi, "_");
    const sql = `CREATE TABLE ${table} (id TEXT); CREATE TABLE ${table} (id TEXT);`;
    const result = migrations.migrate([{ id, sql }]);
    await expect(result).rejects.toMatchObject({ code: "MIGRATION_EXECUTION_FAILED" });
    const row = await db.querySingle("SELECT dirty_reason FROM schema_migrations WHERE id = ?", [id]);
    return { checksum: checksum(sql), dirtyReason: String(row?.dirty_reason), sql };
  }

  function request(id: string, migrationChecksum: string, dirtyReason: string, sql: string, manifest?: {
    version: number;
    dialect: "sqlite";
    retrySafe: boolean;
    probes: readonly { id: string; sql: string; expectedRows: readonly Record<string, unknown>[] }[];
  }) {
    return {
      migrationId: id,
      expectedDialect: "sqlite" as const,
      expectedStatus: "DIRTY" as const,
      expectedChecksum: migrationChecksum,
      expectedDirtyReason: dirtyReason,
      actor: "test",
      reason: "bounded probe test",
      definition: { id, sql, manifest },
    };
  }

  it("does not flip APPLIED when the manifest has no probes, and records failure", async () => {
    const id = "no-probe";
    const state = await makeDirty(id);
    await expect(migrations.recoverDirty(request(id, state.checksum, state.dirtyReason, state.sql))).rejects.toMatchObject({ code: "RECOVERY_VERIFICATION_REQUIRED" });
    expect((await db.querySingle("SELECT status FROM schema_migrations WHERE id = ?", [id]))?.status).toBe("DIRTY");
    const audit = await db.querySingle("SELECT verification_status, success FROM migration_recovery_audit WHERE migration_id = ?", [id]);
    expect(audit?.verification_status).toBe("FAIL");
    expect(Number(audit?.success)).toBe(0);
  });

  it("does not flip APPLIED when a probe result mismatches", async () => {
    const id = "mismatch-probe";
    const sql = `CREATE TABLE ${id} (id TEXT); CREATE TABLE ${id} (id TEXT);`;
    const manifest = {
      dialect: "sqlite" as const,
      version: 1,
      retrySafe: false,
      probes: [{ id: "table-absent", sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${id}'`, expectedRows: [{ name: "unexpected" }] }],
    };
    await expect(migrations.migrate([{ id, sql, manifest }])).rejects.toMatchObject({ code: "MIGRATION_EXECUTION_FAILED" });
    const row = await db.querySingle("SELECT dirty_reason FROM schema_migrations WHERE id = ?", [id]);
    await expect(migrations.recoverDirty(request(id, checksum(sql), String(row?.dirty_reason), sql, manifest))).rejects.toMatchObject({ code: "RECOVERY_PROBE_MISMATCH" });
    expect((await db.querySingle("SELECT status FROM schema_migrations WHERE id = ?", [id]))?.status).toBe("DIRTY");
  });

  it("marks APPLIED only after every deterministic probe matches", async () => {
    const id = "passing-probe";
    const sql = `CREATE TABLE ${id} (id TEXT); CREATE TABLE ${id} (id TEXT);`;
    const manifest = {
      dialect: "sqlite" as const,
      version: 1,
      retrySafe: false,
      probes: [{ id: "table-absent", sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${id}'`, expectedRows: [] }],
    };
    await expect(migrations.migrate([{ id, sql, manifest }])).rejects.toMatchObject({ code: "MIGRATION_EXECUTION_FAILED" });
    const row = await db.querySingle("SELECT dirty_reason FROM schema_migrations WHERE id = ?", [id]);
    await migrations.recoverDirty(request(id, checksum(sql), String(row?.dirty_reason), sql, manifest));
    expect((await db.querySingle("SELECT status FROM schema_migrations WHERE id = ?", [id]))?.status).toBe("APPLIED");
  });

  it("re-verifies persisted provenance after a fresh service instance", async () => {
    const id = "restart-probe";
    const sql = `CREATE TABLE ${id} (id TEXT); CREATE TABLE ${id} (id TEXT);`;
    const manifest = { version: 1, dialect: "sqlite" as const, retrySafe: false, probes: [{ id: "table-absent", sql: `SELECT name FROM sqlite_master WHERE name = '${id}'`, expectedRows: [] }] };
    await expect(migrations.migrate([{ id, sql, manifest }])).rejects.toMatchObject({ code: "MIGRATION_EXECUTION_FAILED" });
    const row = await db.querySingle("SELECT dirty_reason FROM schema_migrations WHERE id = ?", [id]);
    const dirtyReason = String(row?.dirty_reason);
    await db.close();
    db = new SqliteAdapter({ path: dbPath });
    const fresh = new MigrationService(db, "sqlite");
    await fresh.recoverDirty(request(id, checksum(sql), dirtyReason, sql, manifest));
    expect((await db.querySingle("SELECT status FROM schema_migrations WHERE id = ?", [id]))?.status).toBe("APPLIED");
  });

  it("rejects an attacker-supplied alternate manifest before executing probes", async () => {
    const id = "alternate-manifest";
    const sql = `CREATE TABLE ${id} (id TEXT); CREATE TABLE ${id} (id TEXT);`;
    const trusted = { version: 1, dialect: "sqlite" as const, retrySafe: false, probes: [{ id: "table-absent", sql: `SELECT name FROM sqlite_master WHERE name = '${id}'`, expectedRows: [] }] };
    const alternate = { version: 1, dialect: "sqlite" as const, retrySafe: true, probes: [{ id: "attacker", sql: "SELECT 1 AS ok", expectedRows: [{ ok: 1 }] }] };
    await expect(migrations.migrate([{ id, sql, manifest: trusted }])).rejects.toMatchObject({ code: "MIGRATION_EXECUTION_FAILED" });
    const row = await db.querySingle("SELECT dirty_reason FROM schema_migrations WHERE id = ?", [id]);
    await expect(migrations.recoverDirty(request(id, checksum(sql), String(row?.dirty_reason), sql, alternate))).rejects.toMatchObject({ code: "RECOVERY_VERIFICATION_REQUIRED" });
    expect((await db.querySingle("SELECT status FROM schema_migrations WHERE id = ?", [id]))?.status).toBe("DIRTY");
  });
});
