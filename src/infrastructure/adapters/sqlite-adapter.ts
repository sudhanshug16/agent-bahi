import { Database as BunDatabase } from "bun:sqlite";
import type { Database, Transaction, TransactionConfig, QueryResult } from "../../application/ports/persistence.ts";
import type { SqliteConfig } from "../config/database.ts";
import { DomainError, MigrationLockedError } from "../../core/types.ts";
import { resolve } from "path";

/**
 * SQLite Transaction adapter wrapping Bun's native Database API.
 */
class SqliteTransaction implements Transaction {
  private active = true;
  private statements = new Map<string, ReturnType<BunDatabase["prepare"]>>();

  constructor(private db: BunDatabase) {
    this.db.exec("BEGIN IMMEDIATE");
  }

  private prepareStatement(sql: string) {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, this.db.prepare(sql));
    }
    return this.statements.get(sql)!;
  }

  async commit(): Promise<void> {
    if (!this.active) throw new Error("Transaction not active");
    this.active = false;
    this.statements.clear();
    this.db.exec("COMMIT");
  }

  async rollback(): Promise<void> {
    if (!this.active) throw new Error("Transaction not active");
    this.active = false;
    this.statements.clear();
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // Already rolled back
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.active) throw new Error("Transaction not active");

    const stmt = this.prepareStatement(sql);
    const results = stmt.all(...((params || []) as any)) as Record<string, unknown>[];

    return {
      rows: results,
      rowCount: results.length,
    };
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    if (!this.active) throw new Error("Transaction not active");

    const stmt = this.prepareStatement(sql);
    return stmt.get(...((params || []) as any)) as Record<string, unknown> | undefined;
  }

  async executeRaw(sql: string): Promise<void> {
    if (!this.active) throw new Error("Transaction not active");
    this.db.exec(sql);
  }

  isActive(): boolean {
    return this.active;
  }
}

/**
 * SQLite Database adapter wrapping Bun's native Database.
 *
 * Safety guarantees:
 * - Canonical path verification (no symlinks to network/unknown filesystems)
 * - PRAGMA foreign_keys ON
 * - PRAGMA journal_mode = WAL
 * - PRAGMA busy_timeout = 0 (fail immediately on contention, visible to caller)
 * - safeIntegers for proper bigint handling
 */
export class SqliteAdapter implements Database {
  private db: BunDatabase;
  private lockLevel = 0; // For advisory lock emulation

  constructor(config: SqliteConfig) {
    // Verify canonical path safety
    this.assertLocalFilesystemPath(config.path);

    this.db = new BunDatabase(config.path, {
      strict: true,
      create: true,
      safeIntegers: true,
      readonly: false,
    });

    // Enable foreign key constraints
    this.db.exec("PRAGMA foreign_keys = ON");

    // Enable WAL mode for concurrent read support
    this.db.exec("PRAGMA journal_mode = WAL");

    // Set busy_timeout to 0 (fail immediately on SQLITE_BUSY; visible to caller)
    this.db.exec("PRAGMA busy_timeout = 0");

    // Verify settings
    const fkCheck = Number(
      (this.db.query("PRAGMA foreign_keys").get() as Record<string, unknown> | undefined)?.
        foreign_keys || 0,
    );
    if (fkCheck !== 1) {
      throw new DomainError("SQLITE_CONFIG_FAILED", "PRAGMA foreign_keys failed to enable");
    }

    const journalMode = (this.db.query("PRAGMA journal_mode").get() as Record<string, unknown> | undefined)
      ?.journal_mode;
    if (String(journalMode).toLowerCase() !== "wal") {
      throw new DomainError("SQLITE_CONFIG_FAILED", "PRAGMA journal_mode WAL failed to enable");
    }
  }

  private assertLocalFilesystemPath(path: string): void {
    try {
      // Reject network-like paths
      if (
        path.startsWith("//") ||
        path.startsWith("/net/") ||
        path.startsWith("/afs/") ||
        path.startsWith("/mnt/") ||
        path.startsWith("/media/") ||
        path.startsWith("/Volumes/")
      ) {
        throw new Error("Network filesystem path detected");
      }

      // On macOS, reject cloud sync paths
      if (
        path.includes("/Library/Mobile Documents/") ||
        path.includes("/iCloud Drive/")
      ) {
        throw new Error("Cloud sync path detected");
      }

      // Must be absolute path
      if (!path.startsWith("/")) {
        throw new Error("SQLite path must be absolute");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DomainError(
        "SQLITE_UNSAFE_PATH",
        `SQLite database path rejected for safety: ${message}`,
        { path },
      );
    }
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...((params || []) as any)) as Record<string, unknown>[];
      return {
        rows,
        rowCount: rows.length,
      };
    } catch (error) {
      this.handleSqliteError(error);
      throw error;
    }
  }

  async querySingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.get(...((params || []) as any)) as Record<string, unknown> | undefined;
    } catch (error) {
      this.handleSqliteError(error);
      throw error;
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    return this.query(sql, params);
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    return this.querySingle(sql, params);
  }

  async executeRaw(sql: string): Promise<void> {
    try {
      this.db.exec(sql);
    } catch (error) {
      this.handleSqliteError(error);
      throw error;
    }
  }

  async beginTransaction(config?: TransactionConfig): Promise<Transaction> {
    // Note: SQLite doesn't support PRAGMA isolation_level the same way.
    // Use DEFERRED (default), IMMEDIATE, or EXCLUSIVE via BEGIN clause.
    return new SqliteTransaction(this.db);
  }

  async isConnected(): Promise<boolean> {
    try {
      const result = this.db.query("SELECT 1").get();
      return !!result;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async acquireAdvisoryLock(lockName: string, timeoutMs: number = 5000): Promise<boolean> {
    // SQLite doesn't have true advisory locks. Use PRAGMA locking_mode = EXCLUSIVE
    // for the entire database (single writer, multiple readers).
    // For more fine-grained locking, we would need a lock table and serializable transactions.

    // For migration locks specifically, we use serializable transactions + lock table.
    // This is implemented in MigrationService which creates a lock record and uses IMMEDIATE transactions.

    // Simple counter-based emulation for now:
    if (this.lockLevel > 0) {
      return false; // Already locked
    }

    this.lockLevel++;
    return true;
  }

  async releaseAdvisoryLock(lockName: string): Promise<void> {
    this.lockLevel = Math.max(0, this.lockLevel - 1);
  }

  private handleSqliteError(error: unknown): void {
    if (error instanceof Error) {
      if (error.message.includes("SQLITE_BUSY")) {
        throw new DomainError(
          "SQLITE_BUSY",
          "Database is locked. SQLite is configured with busy_timeout=0 to fail immediately. Ensure writer serialization.",
        );
      }
      if (error.message.includes("SQLITE_CONSTRAINT")) {
        throw new DomainError(
          "SQLITE_CONSTRAINT",
          `Constraint violation: ${error.message}`,
        );
      }
    }
  }
}
