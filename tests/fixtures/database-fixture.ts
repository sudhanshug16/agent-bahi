/**
 * Test database fixture for BookSet command tests.
 * Initializes SQLite with schema migrations and provides a session runner.
 */
import { Database as BunDatabase } from "bun:sqlite";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import type { BusinessSessionRunner, BusinessSession } from "../../src/application/ports/persistence.ts";
import { CORE_SCHEMA_SQLITE } from "../../src/infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_MIGRATIONS } from "../../src/infrastructure/schema/database-control-schema.ts";
import { BOOKSET_V3_MIGRATION_SQLITE } from "../../src/infrastructure/schema/bookset-v3-migration.ts";
import { BOOKSET_V4_MIGRATION_SQLITE } from "../../src/infrastructure/schema/bookset-v4-migration.ts";

export function initializeTestDatabase(): BunDatabase {
  const dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  const db = new BunDatabase(dbPath);

  // Enable foreign keys
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");

  // Apply migrations
  db.exec(CORE_SCHEMA_SQLITE);
  db.exec(DATABASE_CONTROL_MIGRATIONS.sqlite);
  db.exec(BOOKSET_V3_MIGRATION_SQLITE);
  db.exec(BOOKSET_V4_MIGRATION_SQLITE);

  return db;
}

export function createTestSessionRunner(db: BunDatabase): BusinessSessionRunner {
  return {
    async withBusinessSession<T>(
      mode: "read" | "write",
      callback: (session: BusinessSession) => Promise<T>,
    ): Promise<T> {
      db.exec("BEGIN IMMEDIATE");

      try {
        const session: BusinessSession = {
          query: async (sql, params) => {
            const stmt = db.prepare(sql);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rows = stmt.all(...((params || []) as any[])) as Record<string, unknown>[];
            return { rows, rowCount: rows.length };
          },
          querySingle: async (sql, params) => {
            const stmt = db.prepare(sql);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (stmt.get(...((params || []) as any[])) || undefined) as Record<string, unknown> | undefined;
          },
          execute: async (sql, params) => {
            if (mode === "read") throw new Error("write not allowed in read mode");
            const stmt = db.prepare(sql);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const info = stmt.run(...((params || []) as any[]));
            return { rows: [], rowCount: info.changes };
          },
          executeSingle: async (sql, params) => {
            if (mode === "read") throw new Error("write not allowed in read mode");
            const stmt = db.prepare(sql);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            stmt.run(...((params || []) as any[]));
            return undefined;
          },
          mode: () => mode,
          isActive: () => true,
        };

        const result = await callback(session);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {}
        throw error;
      }
    },
  };
}
