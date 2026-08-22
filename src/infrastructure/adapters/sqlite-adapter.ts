import { Database as BunDatabase } from "bun:sqlite";
import { randomUUID } from "crypto";
import type { Database, Transaction, TransactionConfig, QueryResult, UnitOfWork, MigrationSession, TableMetadata, ColumnMetadata } from "../../application/ports/persistence.ts";
import type { SqliteConfig } from "../config/database.ts";
import { DomainError, MigrationLockedError } from "../../core/types.ts";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";
import { classifySqliteError, toDomainError } from "../sqlite/error-classifier.ts";

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
    try {
      this.db.exec("BEGIN IMMEDIATE");
    } catch (error) {
      const classified = classifySqliteError(error, "BEGIN IMMEDIATE");
      throw toDomainError(classified);
    }
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
    try {
      const stmt = this.prepareStatement(sql);
      const results = stmt.all(...((params || []) as any)) as Record<string, unknown>[];
      return {
        rows: results,
        rowCount: results.length,
      };
    } catch (error) {
      const classified = classifySqliteError(error, "migration execute");
      throw toDomainError(classified);
    }
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    this.checkActive();
    try {
      const stmt = this.prepareStatement(sql);
      return stmt.get(...((params || []) as any)) as Record<string, unknown> | undefined;
    } catch (error) {
      const classified = classifySqliteError(error, "migration executeSingle");
      throw toDomainError(classified);
    }
  }

  async executeRaw(sql: string): Promise<void> {
    this.checkActive();
    try {
      this.db.exec(sql);
    } catch (error) {
      const classified = classifySqliteError(error, "migration executeRaw");
      throw toDomainError(classified);
    }
  }

  leaseToken(): string {
    this.checkActive();
    return this.token;
  }

  async getTableMetadata(tableName: string): Promise<TableMetadata | null> {
    this.checkActive();
    const allowedMetadataTables = new Set([
      "schema_migrations",
      "schema_migrations_stage_v1",
      "schema_migrations_backup_v1",
    ]);
    if (!allowedMetadataTables.has(tableName)) {
      throw new DomainError("METADATA_IDENTIFIER_REJECTED", "SQLite metadata identifier is not allowlisted");
    }
    const quotedTableName = `"${tableName}"`;
    try {
      // Check if table or view exists
      const tableExists = this.db.prepare(
        "SELECT type FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?"
      ).get(tableName) as { type: string } | undefined;

      if (!tableExists) return null;

      const kind = tableExists.type === "view" ? "VIEW" : "TABLE";

      // Get column metadata via PRAGMA
      // Note: with safeIntegers=true, notnull and pk are returned as bigint
      const columns = this.db.prepare(`PRAGMA table_info(${quotedTableName})`).all() as Array<{
        cid: number | bigint;
        name: string;
        type: string;
        notnull: number | bigint;
        dflt_value: unknown;
        pk: number | bigint;
      }>;

      const columnMetadata: ColumnMetadata[] = columns.map(col => {
        const primaryKey = BigInt(col.pk) > BigInt(0);
        return {
          name: col.name,
          type: col.type,
          nullable: BigInt(col.notnull) === BigInt(0) && !primaryKey,
          default: col.dflt_value === null ? null : String(col.dflt_value),
          primaryKey,
        };
      });

      const tableDefinition = this.db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(tableName) as { sql?: string | null } | undefined;
      const checks = [...(tableDefinition?.sql ?? "").matchAll(/CHECK\s*\(((?:[^()]|\([^)]*\))*)\)/gi)]
        .map((match) => match[1].trim());

      return {
        name: tableName,
        kind,
        columns: columnMetadata,
        checks,
      };
    } catch (error) {
      const classified = classifySqliteError(error, "migration getTableMetadata");
      throw toDomainError(classified);
    }
  }

  // Commit/rollback handled by withMigrationLease; never expose here
  async _commit(): Promise<void> {
    if (this.finalized) return; // Idempotent
    this.active = false;
    this.statements.clear();
    try {
      this.db.exec("COMMIT");
    } catch (error) {
      const classified = classifySqliteError(error, "migration commit");
      throw toDomainError(classified);
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
    try {
      this.db.exec("BEGIN IMMEDIATE");
    } catch (error) {
      const classified = classifySqliteError(error, "BEGIN IMMEDIATE");
      throw toDomainError(classified);
    }
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
    } catch (error) {
      const classified = classifySqliteError(error, "commit");
      throw toDomainError(classified);
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

    try {
      const stmt = this.prepareStatement(sql);
      const results = stmt.all(...((params || []) as any)) as Record<string, unknown>[];

      return {
        rows: results,
        rowCount: results.length,
      };
    } catch (error) {
      const classified = classifySqliteError(error, "transaction execute");
      throw toDomainError(classified);
    }
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    if (!this.active) throw new DomainError("TRANSACTION_NOT_ACTIVE", "Transaction not active");

    try {
      const stmt = this.prepareStatement(sql);
      return stmt.get(...((params || []) as any)) as Record<string, unknown> | undefined;
    } catch (error) {
      const classified = classifySqliteError(error, "transaction executeSingle");
      throw toDomainError(classified);
    }
  }

  async executeRaw(sql: string): Promise<void> {
    if (!this.active) throw new DomainError("TRANSACTION_NOT_ACTIVE", "Transaction not active");
    try {
      this.db.exec(sql);
    } catch (error) {
      const classified = classifySqliteError(error, "transaction executeRaw");
      throw toDomainError(classified);
    }
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
    this.dbPath = assertSafeSqlitePath(config.path);

    this.db = new BunDatabase(this.dbPath, {
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

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...((params || []) as any)) as Record<string, unknown>[];
      return {
        rows,
        rowCount: rows.length,
      };
    } catch (error) {
      const classified = classifySqliteError(error, "query");
      throw toDomainError(classified);
    }
  }

  async querySingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.get(...((params || []) as any)) as Record<string, unknown> | undefined;
    } catch (error) {
      const classified = classifySqliteError(error, "querySingle");
      throw toDomainError(classified);
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
      const classified = classifySqliteError(error, "executeRaw");
      throw toDomainError(classified);
    }
  }

  async beginTransaction(config?: TransactionConfig): Promise<Transaction> {
    try {
      // Note: SQLite doesn't support PRAGMA isolation_level the same way.
      // Use DEFERRED (default), IMMEDIATE, or EXCLUSIVE via BEGIN clause.
      return new SqliteTransaction(this.db);
    } catch (error) {
      const classified = classifySqliteError(error, "beginTransaction");
      throw toDomainError(classified);
    }
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
      // Try to acquire with bounded retries on SQLITE_BUSY/LOCKED
      const retryIntervalMs = 50;
      let beginAcquired = false;

      while (Date.now() < deadline) {
        try {
          // Create session and attempt BEGIN IMMEDIATE
          session = new SqliteMigrationSession(this.db);
          beginAcquired = true;
          break;
        } catch (err) {
          // Classify error from BEGIN IMMEDIATE acquisition
          if (!(err instanceof DomainError)) {
            throw err;
          }

          const isContention =
            err.code === "SQLITE_CONTENTION_BUSY" ||
            err.code === "SQLITE_CONTENTION_LOCKED";

          if (isContention) {
            const remainingMs = deadline - Date.now();
            if (remainingMs > 0) {
              await new Promise(resolve =>
                setTimeout(resolve, Math.min(retryIntervalMs, remainingMs))
              );
              continue;
            } else {
              throw new MigrationLockedError(
                `Failed to acquire migration lease within ${timeoutMs}ms (${err.code})`
              );
            }
          }
          // Non-contention acquisition errors propagate immediately
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
          try {
            lockDb.exec(`
              CREATE TABLE IF NOT EXISTS __migration_locks (
                name TEXT PRIMARY KEY,
                owner_token TEXT NOT NULL,
                acquired_at INTEGER NOT NULL
              )
            `);
          } catch (createError) {
            const classified = classifySqliteError(createError, "advisory lock table creation");
            if (!classified.isContention) {
              // Non-contention errors during setup fail immediately
              lockDb.close();
              throw toDomainError(classified);
            }
            // Retry on contention
            lockDb.close();
            await new Promise(resolve => setTimeout(resolve, 50));
            continue;
          }

          // BEGIN IMMEDIATE: acquire exclusive lock immediately
          try {
            lockDb.exec("BEGIN IMMEDIATE");
          } catch (beginError) {
            const classified = classifySqliteError(beginError, "advisory lock BEGIN IMMEDIATE");
            lockDb.close();
            if (!classified.isContention) {
              // Non-contention acquisition errors fail immediately
              throw toDomainError(classified);
            }
            // Retry on contention
            await new Promise(resolve => setTimeout(resolve, 50));
            continue;
          }

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
            const classified = classifySqliteError(txError, "advisory lock transaction");
            if (!classified.isContention) {
              // Non-contention transaction errors fail immediately
              throw toDomainError(classified);
            }
            // Retry on contention
            await new Promise(resolve => setTimeout(resolve, 50));
            continue;
          }
        } catch (error) {
          try {
            lockDb.close();
          } catch {
            // Already closed
          }
          // Check if it's a non-contention error
          if (error instanceof DomainError) {
            throw error;
          }
          // For other errors, retry
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        // Non-contention errors from advisory lock propagate immediately
        if (error instanceof DomainError) {
          throw error;
        }
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

}
