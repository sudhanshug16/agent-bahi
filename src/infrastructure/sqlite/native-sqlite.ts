import { Database } from "bun:sqlite";
import type { SqlitePort, SqlValue } from "../../application/ports/sqlite-port.ts";

function assertLocalFilesystemPath(path: string): void {
  const tempDir = process.env.TMPDIR ?? "/tmp";
  const root = tempDir.replace(/\/+$/, "");
  const underRoot = path.startsWith(`${root}/`);
  const networkLike = path.startsWith("//")
    || ["/net/", "/afs/", "/mnt/", "/media/", "/Volumes/"]
      .some((prefix) => path.startsWith(prefix));
  const isIdenticalToRoot = path === root;
  const hasUnsafeTraversal = path.includes("/../");

  if (!underRoot || networkLike || isIdenticalToRoot || hasUnsafeTraversal) {
    throw new Error(`refusing non-local or unsafe filesystem path: ${path}`);
  }
}

export class NativeBunSqlite implements SqlitePort {
  readonly database: Database;

  constructor(path: string) {
    assertLocalFilesystemPath(path);
    this.database = new Database(path, { strict: true, create: true, safeIntegers: true });

    // Enable foreign key constraints
    this.database.exec("PRAGMA foreign_keys = ON");

    // Enable WAL mode for concurrent read support
    this.database.exec("PRAGMA journal_mode = WAL");

    // Set explicit busy timeout (50ms)
    this.database.exec("PRAGMA busy_timeout = 50");

    // Verify settings were applied
    const foreignKeys = Number(this.database.query<{ foreign_keys: number | bigint }, []>("PRAGMA foreign_keys").get()?.foreign_keys ?? 0);
    const journalMode = this.database.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode;
    const busyTimeout = Number(this.database.query<{ timeout: number | bigint }, []>("PRAGMA busy_timeout").get()?.timeout ?? 0);

    if (foreignKeys !== 1) {
      throw new Error("PRAGMA foreign_keys failed to enable");
    }
    if (journalMode?.toLowerCase() !== "wal") {
      throw new Error("PRAGMA journal_mode WAL failed to enable");
    }
    if (busyTimeout !== 50) {
      throw new Error("PRAGMA busy_timeout failed to set to 50");
    }
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  query<T extends Record<string, unknown>>(sql: string, ...values: SqlValue[]): T[] {
    return this.database.query<T, SqlValue[]>(sql).all(...values);
  }

  close(): void {
    this.database.close();
  }
}
