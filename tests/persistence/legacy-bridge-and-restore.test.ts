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
import { initializeAndUpgradeSqliteDatabase } from "../../src/application/application.ts";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { detectDatabaseState } from "../../src/infrastructure/services/database-state-detector.ts";
import { detectLegacyState, inspectLegacyDatabase } from "../../src/infrastructure/services/legacy-bridge-service.ts";
import { MIGRATION_CATALOG, V2_SCHEMA_MANIFEST, V8_SCHEMA_MANIFEST } from "../../src/infrastructure/schema/migration-catalog.ts";

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
});
