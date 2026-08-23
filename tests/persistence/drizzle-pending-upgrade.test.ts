import { describe, expect, it } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { upgradeSqliteDatabase } from "../../src/application/application.ts";
import { DRIZZLE_BASELINE_CREATED_AT, DRIZZLE_BASELINE_HASH, DRIZZLE_BASELINE_MIGRATION_ID, DRIZZLE_JOURNAL_DDL } from "../../src/infrastructure/services/drizzle-baseline.ts";
import { detectDatabaseState } from "../../src/infrastructure/services/database-state-detector.ts";

describe("pending official Drizzle GST upgrade", () => {
  it("backs up before migration and restores the baseline on final verification failure", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-drizzle-pending-"));
    const dbPath = join(directory, "books.sqlite");
    const backupPath = join(directory, "baseline.backup");
    try {
      const db = new BunDatabase(dbPath, { safeIntegers: true });
      db.exec("PRAGMA foreign_keys = ON");
      const baseline = await readFile(join(import.meta.dir, "../../drizzle/0009_drizzle_v8_baseline.sql"), "utf8");
      for (const statement of baseline.split("--> statement-breakpoint")) db.exec(statement);
      db.exec(DRIZZLE_JOURNAL_DDL);
      db.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(DRIZZLE_BASELINE_HASH, DRIZZLE_BASELINE_CREATED_AT);
      db.query("INSERT INTO database_control (id, schema_version, data_format_version, reader_compatibility_min, reader_compatibility_max, required_writer_protocol, state, revision, generation, last_migration_id, last_migration_checksum, last_writer_cli_version, last_writer_build_id, last_writer_at, created_at, updated_at, recovery_reason) VALUES (1, 8, 1, 1, 1, 1, 'READY', 7, 1, ?, ?, 'test', 'baseline', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z', NULL)").run(DRIZZLE_BASELINE_MIGRATION_ID, DRIZZLE_BASELINE_HASH);
      db.close();

      const baselineState = new BunDatabase(dbPath, { readonly: true });
      expect(detectDatabaseState(baselineState).state).toBe("DRIZZLE_MANAGED");
      baselineState.close();
      await expect(upgradeSqliteDatabase(dbPath, { backupDestinationPath: backupPath, faults: { beforeFinalVerification: () => { throw new Error("injected final verification failure"); } } })).rejects.toMatchObject({ code: "UPGRADE_FAILED_RESTORED" });
      expect(await Bun.file(backupPath).exists()).toBe(true);
      const restored = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
      expect(restored.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 1n });
      expect(restored.query("SELECT last_migration_id FROM database_control").get()).toEqual({ last_migration_id: DRIZZLE_BASELINE_MIGRATION_ID });
      restored.close();

      await upgradeSqliteDatabase(dbPath, { backupDestinationPath: join(directory, "current.backup") });
      const current = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
      expect(current.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 11n });
      current.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
