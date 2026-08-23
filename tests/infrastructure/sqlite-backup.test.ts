import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { lstatSync, linkSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database as BunDatabase } from "bun:sqlite";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { initializeSqliteDatabase } from "../../src/application/application.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_MIGRATIONS } from "../../src/infrastructure/schema/database-control-schema.ts";

let directory: string;
let sourcePath: string;
let db: SqliteAdapter;

async function setupReadyDatabase(): Promise<void> {
  directory = await mkdtemp(join(tmpdir(), "agent-bahi-backup-"));
  sourcePath = join(directory, "source.sqlite");
  db = new SqliteAdapter({ path: sourcePath });
  const migrations = new MigrationService(db, "sqlite");
  await migrations.migrate([
    { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
    { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
  ]);
  const control = new DatabaseControlService(db, "sqlite");
  await db.withMigrationLease(async (session) => {
    await control.initialize({ cliVersion: "0.0.0-gate0", buildId: "backup-test", now: new Date("2026-01-01T00:00:00.000Z") }, session);
  });
}

async function cleanup(): Promise<void> {
  await db.close();
  await rm(directory, { recursive: true, force: false });
}

describe("SQLite BackupService", () => {
  beforeEach(setupReadyDatabase);
  afterEach(cleanup);

  it("creates a bound-parameter snapshot with the final hash, size, mode, and no sidecars", async () => {
    await db.execute(
      "INSERT INTO tenants (id, kind, lifecycle, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["tenant-1", "COMPANY", "ACTIVE", "Committed", "2026-01-01", "2026-01-01"],
    );
    const destination = join(directory, "safe'apostrophe.sqlite");
    const result = await new BackupService(sourcePath).createBackup(destination);
    const bytes = await readFile(destination);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const stat = lstatSync(destination);

    expect(result.status).toBe("SUCCESS");
    expect(result.path).toBe(join(realpathSync(directory), "safe'apostrophe.sqlite"));
    expect(result.manifest?.checksum).toBe(checksum);
    expect(result.manifest?.files[0]?.checksum).toBe(checksum);
    expect(result.manifest?.files[0]?.size).toBe(bytes.byteLength);
    expect(stat.size).toBe(bytes.byteLength);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(await Bun.file(`${destination}-wal`).exists()).toBe(false);
    expect(await Bun.file(`${destination}-shm`).exists()).toBe(false);
    expect(await new BackupService(sourcePath).verifyBackup(destination)).toBe(true);
  });

  it("requires READY control, exact history, and canonical business schema", async () => {
    const service = new BackupService(sourcePath);
    const destination = join(directory, "rejected.sqlite");

    await db.execute("UPDATE database_control SET state = 'APPLYING' WHERE id = 1");
    await expect(service.createBackup(destination)).rejects.toMatchObject({ code: "BACKUP_SOURCE_NOT_READY" });
    await db.execute("UPDATE database_control SET state = 'READY' WHERE id = 1");
    await db.execute("UPDATE schema_migrations SET checksum = ? WHERE id = ?", ["0".repeat(64), "0001-core-schema"]);
    await expect(service.createBackup(destination)).rejects.toMatchObject({ code: "BACKUP_HISTORY_MISMATCH" });

    const malformedPath = join(directory, "malformed.sqlite");
    const malformed = new BunDatabase(malformedPath);
    malformed.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
    malformed.close();
    await expect(new BackupService(malformedPath).createBackup(join(directory, "malformed-out.sqlite"))).rejects.toMatchObject({ code: "BACKUP_SOURCE_UNAVAILABLE" });
  });

  it("backs up and restores a fresh Drizzle-managed source without legacy history", async () => {
    const freshPath = join(directory, "fresh-drizzle.sqlite");
    const backupPath = join(directory, "fresh-drizzle.backup");
    const restoredPath = join(directory, "fresh-drizzle-restored.sqlite");
    await initializeSqliteDatabase(freshPath, { cliVersion: "test", buildId: "fresh-backup" });
    const service = new BackupService(freshPath);
    await service.createBackup(backupPath);
    expect(await service.verifyBackup(backupPath)).toBe(true);
    expect(await service.restoreFromBackup(backupPath, restoredPath)).toBe(true);
    const restored = new BunDatabase(restoredPath, { readonly: true });
    try {
      expect(() => restored.query("SELECT COUNT(*) FROM schema_migrations").get()).toThrow();
      expect(restored.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 5 });
    } finally { restored.close(); }
  });

  it("rejects every pre-existing destination without changing it", async () => {
    const fileEmpty = join(directory, "empty.sqlite");
    const fileNonempty = join(directory, "nonempty.sqlite");
    const targetDirectory = join(directory, "target-directory");
    const liveLink = join(directory, "live-link.sqlite");
    const danglingLink = join(directory, "dangling-link.sqlite");
    const hardlink = join(directory, "hardlink.sqlite");
    writeFileSync(fileEmpty, "");
    writeFileSync(fileNonempty, "pre-existing bytes");
    mkdirSync(targetDirectory);
    symlinkSync(fileNonempty, liveLink);
    symlinkSync(join(directory, "missing-target"), danglingLink);
    linkSync(fileNonempty, hardlink);
    const beforeBytes = new Map<string, string>([
      [fileEmpty, readFileSync(fileEmpty).toString("hex")],
      [fileNonempty, readFileSync(fileNonempty).toString("hex")],
      [hardlink, readFileSync(hardlink).toString("hex")],
    ]);
    const beforeLinks = new Map<string, string>([
      [liveLink, readlinkSync(liveLink)],
      [danglingLink, readlinkSync(danglingLink)],
    ]);

    await expect(new BackupService(sourcePath).createBackup(fileEmpty)).rejects.toMatchObject({ code: "BACKUP_DESTINATION_EXISTS" });
    await expect(new BackupService(sourcePath).createBackup(fileNonempty)).rejects.toMatchObject({ code: "BACKUP_DESTINATION_EXISTS" });
    await expect(new BackupService(sourcePath).createBackup(targetDirectory)).rejects.toMatchObject({ code: "BACKUP_DESTINATION_UNSAFE" });
    await expect(new BackupService(sourcePath).createBackup(liveLink)).rejects.toMatchObject({ code: "BACKUP_DESTINATION_UNSAFE" });
    await expect(new BackupService(sourcePath).createBackup(danglingLink)).rejects.toMatchObject({ code: "BACKUP_DESTINATION_UNSAFE" });
    await expect(new BackupService(sourcePath).createBackup(hardlink)).rejects.toMatchObject({ code: "BACKUP_DESTINATION_EXISTS" });
    await expect(new BackupService(sourcePath).createBackup(sourcePath)).rejects.toMatchObject({ code: "BACKUP_DESTINATION_EXISTS" });
    expect(readFileSync(fileEmpty).toString("hex")).toBe(beforeBytes.get(fileEmpty)!);
    expect(readFileSync(fileNonempty).toString("hex")).toBe(beforeBytes.get(fileNonempty)!);
    expect(readlinkSync(liveLink)).toBe(beforeLinks.get(liveLink)!);
    expect(readlinkSync(danglingLink)).toBe(beforeLinks.get(danglingLink)!);
    expect(readFileSync(hardlink).toString("hex")).toBe(beforeBytes.get(hardlink)!);
  });

  it("rejects a valid SQLite file whose integrity is ok but required schema is missing", async () => {
    const invalidSource = join(directory, "valid-but-incomplete.sqlite");
    const invalid = new BunDatabase(invalidSource);
    invalid.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
    expect(invalid.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    invalid.close();
    await expect(new BackupService(invalidSource).createBackup(join(directory, "invalid-out.sqlite"))).rejects.toMatchObject({ code: "BACKUP_SOURCE_UNAVAILABLE" });
  });

  it("rejects foreign-key violations and deterministic output tampering", async () => {
    const violating = new BunDatabase(sourcePath, { safeIntegers: true });
    violating.exec("PRAGMA foreign_keys = OFF");
    violating.query("INSERT INTO book_sets (id, tenant_id, kind, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("orphan", "missing", "COMPANY", "ACTIVE", "2026-01-01", "2026-01-01");
    violating.close();
    const destination = join(directory, "fk-invalid.sqlite");
    await expect(new BackupService(sourcePath).createBackup(destination)).rejects.toMatchObject({ code: "BACKUP_VERIFICATION_FAILED" });
    expect(await Bun.file(destination).exists()).toBe(false);
    expect((await readdir(directory)).some((name) => name.includes("staging"))).toBe(false);

    // Restore a clean source and prove verifyBackup is semantic, not open-only.
    await db.execute("DELETE FROM book_sets WHERE id = ?", ["orphan"]);
    const validDestination = join(directory, "tamper.sqlite");
    await new BackupService(sourcePath).createBackup(validDestination);
    const tampered = readFileSync(validDestination);
    tampered[tampered.length - 1] ^= 0xff;
    writeFileSync(validDestination, tampered);
    await expect(new BackupService(sourcePath).verifyBackup(validDestination)).rejects.toMatchObject({ code: "BACKUP_VERIFICATION_FAILED" });
  });

  it("loses a publication race without replacing the raced destination", async () => {
    const destination = join(directory, "raced.sqlite");
    const original = "created by the racing publisher";
    const service = new BackupService({
      sourcePath,
      beforePublication: () => writeFileSync(destination, original),
    });
    await expect(service.createBackup(destination)).rejects.toMatchObject({ code: "BACKUP_DESTINATION_RACE" });
    expect(readFileSync(destination, "utf8")).toBe(original);
    expect((await readdir(directory)).some((name) => name.includes(".staging-"))).toBe(false);
  });

  it("invalidates the snapshot when source control changes after VACUUM", async () => {
    const destination = join(directory, "changed-source.sqlite");
    const service = new BackupService({
      sourcePath,
      afterVacuum: () => db.execute("UPDATE database_control SET revision = revision + 1 WHERE id = 1").then(() => undefined),
    });
    await expect(service.createBackup(destination)).rejects.toMatchObject({ code: "BACKUP_CONTROL_CHANGED" });
    expect(await Bun.file(destination).exists()).toBe(false);
    expect((await readdir(directory)).some((name) => name.includes(".staging-"))).toBe(false);
  });

  it("rejects staging mutations that add extra schema objects and cleans up staging", async () => {
    const destination = join(directory, "mutated.sqlite");
    const service = new BackupService({
      sourcePath,
      afterVacuum: (stagingPath) => {
        const staging = new BunDatabase(stagingPath, { safeIntegers: true });
        staging.exec("CREATE TABLE extra_table (id INTEGER PRIMARY KEY)");
        staging.close();
      },
    });
    await expect(service.createBackup(destination)).rejects.toMatchObject({ code: "BACKUP_SCHEMA_MISMATCH" });
    expect(await Bun.file(destination).exists()).toBe(false);
    const stagingFiles = (await readdir(directory)).filter((name) => name.includes(".staging-"));
    expect(stagingFiles).toHaveLength(0);
  });

  it("preserves and accepts a legitimate extra application table already in the source", async () => {
    const destination = join(directory, "with-extra-table.sqlite");
    await db.execute("CREATE TABLE app_custom_data (id TEXT PRIMARY KEY, data TEXT)");
    const result = await new BackupService(sourcePath).createBackup(destination);
    expect(result.status).toBe("SUCCESS");
    const snapshot = new BunDatabase(destination, { readonly: true, safeIntegers: true });
    const catalogRows = snapshot.query(
      "SELECT type, name FROM sqlite_schema WHERE type = 'table' AND name = 'app_custom_data' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ type: string; name: string }>;
    snapshot.close();
    expect(catalogRows).toHaveLength(1);
    expect(catalogRows[0]).toEqual({ type: "table", name: "app_custom_data" });
  });

  it("captures committed rows and excludes another connection's uncommitted row", async () => {
    await db.execute(
      "INSERT INTO tenants (id, kind, lifecycle, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["committed", "COMPANY", "ACTIVE", "Committed", "2026-01-01", "2026-01-01"],
    );
    const writer = new BunDatabase(sourcePath, { safeIntegers: true });
    writer.exec("PRAGMA foreign_keys = ON");
    writer.exec("BEGIN");
    writer.query("INSERT INTO tenants (id, kind, lifecycle, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("uncommitted", "COMPANY", "ACTIVE", "Uncommitted", "2026-01-01", "2026-01-01");
    const destination = join(directory, "committed-snapshot.sqlite");
    await new BackupService(sourcePath).createBackup(destination);
    writer.exec("ROLLBACK");
    writer.close();
    const snapshot = new BunDatabase(destination, { readonly: true, safeIntegers: true });
    const committed = snapshot.query("SELECT COUNT(*) AS count FROM tenants WHERE id = ?").get("committed") as { count: bigint };
    const uncommitted = snapshot.query("SELECT COUNT(*) AS count FROM tenants WHERE id = ?").get("uncommitted") as { count: bigint };
    snapshot.close();
    expect(committed.count).toBe(1n);
    expect(uncommitted.count).toBe(0n);
  });
});
