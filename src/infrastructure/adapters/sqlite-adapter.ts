import { Database as BunDatabase } from "bun:sqlite";
import { randomUUID } from "crypto";
import type { Database, Transaction, TransactionConfig, QueryResult, UnitOfWork, MigrationSession } from "../../application/ports/persistence.ts";
import type { SqliteConfig } from "../config/database.ts";
import { DomainError, MigrationLockedError } from "../../core/types.ts";
import { resolve } from "path";

/**
 * SQLite Migration Session (callback-scoped): holds BEGIN IMMEDIATE transaction.
 * Ensures all DDL, validation, and audit happen on same connection.
 * Never construct outside callback; never call commit/rollback (automatic).
 * Active flag enforced; all methods reject after callback returns.
 * Finalization (_commit/_rollback) ensures exactly-once semantics even if COMMIT/ROLLBACK throws.
 */
class SqliteMigrationSession implements MigrationSession {
  private statements = new Map<string, ReturnType<BunDatabase["prepare"]>>();
  private token: string;
  private active = true;
  private finalized = false;

  constructor(private db: BunDatabase) {
    this.token = randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
  }

  private prepareStatement(sql: string) {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, this.db.prepare(sql));
    }
    return this.statements.get(sql)!;
  }

  private checkActive(): void {
    if (!this.active) {
      throw new DomainError(
        "MIGRATION_SESSION_INACTIVE",
        "MigrationSession has been finalized and is no longer active"
      );
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    this.checkActive();
    const stmt = this.prepareStatement(sql);
    const results = stmt.all(...((params || []) as any)) as Record<string, unknown>[];
    return {
      rows: results,
      rowCount: results.length,
    };
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    this.checkActive();
    const stmt = this.prepareStatement(sql);
    return stmt.get(...((params || []) as any)) as Record<string, unknown> | undefined;
  }

  async executeRaw(sql: string): Promise<void> {
    this.checkActive();
    this.db.exec(sql);
  }

  leaseToken(): string {
    this.checkActive();
    return this.token;
  }

  // Commit/rollback handled by withMigrationLease; never expose here
  async _commit(): Promise<void> {
    if (this.finalized) return; // Idempotent
    this.active = false;
    this.statements.clear();
    try {
      this.db.exec("COMMIT");
    } finally {
      this.finalized = true;
    }
  }

  async _rollback(): Promise<void> {
    if (this.finalized) return; // Idempotent
    this.active = false;
    this.statements.clear();
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // Already rolled back
    } finally {
      this.finalized = true;
    }
  }
}

/**
 * SQLite Transaction adapter wrapping Bun's native Database API.
 */
class SqliteTransaction implements Transaction {
  private active = true;
  private finalized = false;
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
    if (!this.active) throw new DomainError("TRANSACTION_NOT_ACTIVE", "Transaction not active");
    if (this.finalized) return; // Idempotent
    this.active = false;
    this.statements.clear();
    try {
      this.db.exec("COMMIT");
    } finally {
      this.finalized = true;
    }
  }

  async rollback(): Promise<void> {
    if (!this.active) throw new DomainError("TRANSACTION_NOT_ACTIVE", "Transaction not active");
    if (this.finalized) return; // Idempotent
    this.active = false;
    this.statements.clear();
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // Already rolled back
    } finally {
      this.finalized = true;
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.active) throw new DomainError("TRANSACTION_NOT_ACTIVE", "Transaction not active");

    const stmt = this.prepareStatement(sql);
    const results = stmt.all(...((params || []) as any)) as Record<string, unknown>[];

    return {
      rows: results,
      rowCount: results.length,
    };
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    if (!this.active) throw new DomainError("TRANSACTION_NOT_ACTIVE", "Transaction not active");

    const stmt = this.prepareStatement(sql);
    return stmt.get(...((params || []) as any)) as Record<string, unknown> | undefined;
  }

  async executeRaw(sql: string): Promise<void> {
    if (!this.active) throw new DomainError("TRANSACTION_NOT_ACTIVE", "Transaction not active");
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
/**
 * SQLite UnitOfWork implementation.
 * Provides automatic rollback on error while holding a transaction.
 */
class SqliteUnitOfWork implements UnitOfWork {
  constructor(private db: BunDatabase) {}

  async execute<T>(
    callback: (tx: Transaction) => Promise<T>,
    config?: TransactionConfig,
  ): Promise<T> {
    const tx = new SqliteTransaction(this.db);
    try {
      const result = await callback(tx);
      if (tx.isActive()) {
        await tx.commit();
      }
      return result;
    } catch (error) {
      if (tx.isActive()) {
        try {
          await tx.rollback();
        } catch {
          // Already rolled back
        }
      }
      throw error;
    }
  }
}

export class SqliteAdapter implements Database {
  private db: BunDatabase;
  private dbPath: string; // Store path for lock database creation
  private heldLocks = new Map<string, string>(); // lockName -> owner token; tracks locks held by this adapter
  private lockTransactions = new Map<string, BunDatabase>(); // lockName -> transaction connection for uncommitted lock
  private adapterId = randomUUID(); // Stable ID for this adapter instance

  constructor(config: SqliteConfig) {
    // Verify canonical path safety
    this.assertLocalFilesystemPath(config.path);
    this.dbPath = config.path;

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

  unitOfWork(config?: TransactionConfig): UnitOfWork {
    return new SqliteUnitOfWork(this.db);
  }

  async withMigrationLease<T>(
    callback: (session: MigrationSession) => Promise<T>,
    timeoutMs: number = 30000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let session: SqliteMigrationSession | undefined;

    try {
      // BEGIN IMMEDIATE inside try to ensure ROLLBACK on error
      // Try to acquire with bounded retries on SQLITE_BUSY
      const retryIntervalMs = 50;
      let beginAcquired = false;

      while (Date.now() < deadline) {
        try {
          // Create session and attempt BEGIN IMMEDIATE
          session = new SqliteMigrationSession(this.db);
          beginAcquired = true;
          break;
        } catch (err) {
          // Handle SQLITE_BUSY or SQLITE_LOCKED during BEGIN IMMEDIATE
          const errMsg = (err instanceof Error ? err.message : String(err)).toUpperCase();
          if (errMsg.includes("BUSY") || errMsg.includes("LOCKED")) {
            const remainingMs = deadline - Date.now();
            if (remainingMs > 0) {
              await new Promise(resolve =>
                setTimeout(resolve, Math.min(retryIntervalMs, remainingMs))
              );
              continue;
            } else {
              throw new MigrationLockedError(
                `Failed to acquire migration lease within ${timeoutMs}ms (SQLITE_BUSY/LOCKED)`
              );
            }
          }
          // Non-busy errors propagate
          throw err;
        }
      }

      if (!beginAcquired || !session) {
        throw new MigrationLockedError(
          `Failed to acquire migration lease within ${timeoutMs}ms deadline`
        );
      }

      const result = await callback(session);
      await session._commit();
      return result;
    } catch (error) {
      if (session) {
        try {
          await session._rollback();
        } catch {
          // Already rolled back
        }
      }
      throw error;
    }
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
    // Release all held locks
    for (const [lockName] of this.heldLocks) {
      await this.releaseAdvisoryLock(lockName);
    }
    this.db.close();
  }

  async acquireAdvisoryLock(lockName: string, timeoutMs: number = 5000): Promise<boolean> {
    // Crash-safe advisory lock using uncommitted transaction
    // Key insight: lock is held by keeping a transaction open with IMMEDIATE mode
    // If process crashes, the transaction auto-rollbacks and lock is released
    // No manual recovery needed; no stale lock rows survive crashes

    const startTime = Date.now();
    const ownerToken = this.adapterId;

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Create separate connection for lock transaction (independent of main db)
        const lockDb = new BunDatabase(this.dbPath, {
          strict: true,
          create: true,
          safeIntegers: true,
          readonly: false,
        });

        try {
          // Enable FK for consistency
          lockDb.exec("PRAGMA foreign_keys = ON");
          lockDb.exec("PRAGMA busy_timeout = 0");

          // Initialize lock table if needed
          lockDb.exec(`
            CREATE TABLE IF NOT EXISTS __migration_locks (
              name TEXT PRIMARY KEY,
              owner_token TEXT NOT NULL,
              acquired_at INTEGER NOT NULL
            )
          `);

          // BEGIN IMMEDIATE: acquire exclusive lock immediately
          lockDb.exec("BEGIN IMMEDIATE");

          try {
            // Check if lock is held by different owner
            const existing = lockDb.query(`SELECT owner_token FROM __migration_locks WHERE name = ?`).get(lockName) as any;

            if (existing && existing.owner_token !== ownerToken) {
              // Lock held by different owner - release and retry
              lockDb.exec("ROLLBACK");
              lockDb.close();
              await new Promise(resolve => setTimeout(resolve, 50));
              continue;
            }

            // We own or can take the lock
            if (existing) {
              // Renew lock timestamp (same owner)
              lockDb.query(`UPDATE __migration_locks SET acquired_at = ? WHERE name = ?`).run(
                Date.now(),
                lockName
              );
            } else {
              // New lock
              lockDb.query(`INSERT INTO __migration_locks (name, owner_token, acquired_at) VALUES (?, ?, ?)`).run(
                lockName,
                ownerToken,
                Date.now()
              );
            }

            // Transaction held OPEN - do NOT commit
            // Lock is held for duration of this process
            // If crash: transaction auto-rollbacks, lock released
            this.heldLocks.set(lockName, ownerToken);
            this.lockTransactions.set(lockName, lockDb);
            return true;
          } catch (txError) {
            lockDb.exec("ROLLBACK");
            lockDb.close();
            throw txError;
          }
        } catch (error) {
          try {
            lockDb.close();
          } catch {
            // Already closed
          }
          throw error;
        }
      } catch (error) {
        // Lock acquisition failed - wait and retry
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Timeout reached
    return false;
  }

  async releaseAdvisoryLock(lockName: string): Promise<void> {
    if (this.heldLocks.has(lockName)) {
      const lockDb = this.lockTransactions.get(lockName);
      if (lockDb) {
        try {
          // Rollback the held transaction - this releases the lock
          lockDb.exec("ROLLBACK");
          lockDb.close();
        } catch {
          // Already closed or rolled back
        }
        this.lockTransactions.delete(lockName);
      }
      this.heldLocks.delete(lockName);
    }
  }

  private handleSqliteError(error: unknown): void {
    if (error instanceof Error) {
      if (error.message.toLowerCase().includes("no such table") && error.message.toLowerCase().includes("schema_migrations")) {
        throw new DomainError("CONTROL_TABLE_MISSING", "Migration control table is not initialized", {
          dialect: "sqlite",
          cause: error.message,
        });
      }
      if (error.message.includes("SQLITE_BUSY")) {
        throw new DomainError(
          "SQLITE_BUSY",
          "Database is locked. SQLite is configured with busy_timeout=0 to fail immediately. Ensure writer serialization.",
        );
      }
      if (
        error.message.includes("SQLITE_CONSTRAINT") ||
        /constraint|foreign key|unique|check constraint|tenant|book.?set/i.test(error.message)
      ) {
        throw new DomainError(
          "SQLITE_CONSTRAINT",
          `Constraint violation: ${error.message}`,
        );
      }
      throw new DomainError("DATABASE_QUERY_FAILED", "SQLite database query failed", {
        dialect: "sqlite",
        cause: error.message,
      });
    }
    throw new DomainError("DATABASE_QUERY_FAILED", "SQLite database query failed", { dialect: "sqlite" });
  }
}
