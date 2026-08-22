/**
 * Test database fixture for BookSet command tests.
 * Initializes SQLite with full schema migrations and provides a session runner.
 */
import { Database as BunDatabase } from "bun:sqlite";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import type { BusinessSessionRunner, BusinessSession } from "../../src/application/ports/persistence.ts";
import { bootstrapSqliteApplication } from "../../src/application/application.ts";

export async function initializeTestDatabase(): Promise<BunDatabase> {
  const dbPath = join(tmpdir(), `test-${randomUUID()}.db`);

  // Bootstrap the database with all migrations through the application layer
  const backupPath = join(tmpdir(), `backup-${randomUUID()}.sqlite`);
  await bootstrapSqliteApplication(dbPath, {
    backupDestinationPath: backupPath,
    cliVersion: "test",
    buildId: "test-fixture",
    now: new Date(),
  });

  // Re-open the database for test use
  const db = new BunDatabase(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
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
