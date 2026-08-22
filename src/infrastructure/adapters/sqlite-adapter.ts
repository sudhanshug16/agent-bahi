import { Database as BunDatabase } from "bun:sqlite";
import { randomUUID } from "crypto";
import type { Database, Transaction, TransactionConfig, QueryResult, UnitOfWork, MigrationSession, TableMetadata, ColumnMetadata } from "../../application/ports/persistence.ts";
import type { SqliteConfig } from "../config/database.ts";
import { DomainError, MigrationLockedError } from "../../core/types.ts";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";
import { classifySqliteError, toDomainError } from "../sqlite/error-classifier.ts";

function normalizeSqliteError(error: unknown, operation: string): DomainError {
  return error instanceof DomainError
    ? error
    : toDomainError(classifySqliteError(error, operation));
}

function isContentionError(error: unknown): boolean {
  return error instanceof DomainError
    && (error.code === "SQLITE_CONTENTION_BUSY" || error.code === "SQLITE_CONTENTION_LOCKED");
}

function waitForRetry(deadline: number, intervalMs: number): Promise<void> {
  return new Promise((resolve) => {
    const remaining = Math.max(0, deadline - Date.now());
    setTimeout(resolve, Math.min(intervalMs, remaining));
  });
}

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
  private rollbackAttempted = false;

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
      "migration_recovery_audit",
      "database_control",
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
    try {
      this.db.exec("COMMIT");
    } catch (error) {
      const classified = normalizeSqliteError(error, "migration commit");
      await this.rollbackAfterCommitFailure();
      throw classified;
    }
    this.active = false;
    this.statements.clear();
    this.finalized = true;
  }

  private async rollbackAfterCommitFailure(): Promise<void> {
    if (this.rollbackAttempted) return;
    this.rollbackAttempted = true;
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // The original classified COMMIT error is authoritative.
    } finally {
      this.active = false;
      this.statements.clear();
      this.finalized = true;
    }
  }

  async _rollback(): Promise<void> {
    if (this.finalized || this.rollbackAttempted) return; // Idempotent
    this.rollbackAttempted = true;
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // Already rolled back
    } finally {
      this.active = false;
      this.statements.clear();
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
  private rollbackAttempted = false;
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
    try {
      this.db.exec("COMMIT");
    } catch (error) {
      const classified = normalizeSqliteError(error, "commit");
      this.rollbackAfterCommitFailure();
      throw classified;
    }
    this.active = false;
    this.statements.clear();
    this.finalized = true;
  }

  async rollback(): Promise<void> {
    if (!this.active) throw new DomainError("TRANSACTION_NOT_ACTIVE", "Transaction not active");
    if (this.finalized || this.rollbackAttempted) return; // Idempotent
    this.rollbackAttempted = true;
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // Already rolled back
    } finally {
      this.active = false;
      this.statements.clear();
      this.finalized = true;
    }
  }

  private rollbackAfterCommitFailure(): void {
    if (this.rollbackAttempted) return;
    this.rollbackAttempted = true;
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // The original classified COMMIT error is authoritative.
    } finally {
      this.active = false;
      this.statements.clear();
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

    let openedDb: BunDatabase | undefined;
    try {
      openedDb = new BunDatabase(this.dbPath, {
        strict: true,
        create: true,
        safeIntegers: true,
        readonly: false,
      });

      // Enable foreign key constraints
      openedDb.exec("PRAGMA foreign_keys = ON");

      // Enable WAL mode for concurrent read support
      openedDb.exec("PRAGMA journal_mode = WAL");

      // Set busy_timeout to 0 (fail immediately on SQLITE_BUSY; visible to caller)
      openedDb.exec("PRAGMA busy_timeout = 0");

      // Verify settings
      const fkCheck = Number(
        (openedDb.query("PRAGMA foreign_keys").get() as Record<string, unknown> | undefined)?.
          foreign_keys || 0,
      );
      if (fkCheck !== 1) {
        throw new DomainError("SQLITE_CONFIG_FAILED", "PRAGMA foreign_keys failed to enable");
      }

      const journalMode = (openedDb.query("PRAGMA journal_mode").get() as Record<string, unknown> | undefined)
        ?.journal_mode;
      if (String(journalMode).toLowerCase() !== "wal") {
        throw new DomainError("SQLITE_CONFIG_FAILED", "PRAGMA journal_mode WAL failed to enable");
      }
    } catch (error) {
      try {
        openedDb?.close();
      } catch {
        // Preserve the original open/configuration failure.
      }
      throw normalizeSqliteError(error, "open");
    }
    this.db = openedDb;
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
    return this.acquireAdvisoryLockStrict(lockName, timeoutMs);
  }

  async releaseAdvisoryLock(lockName: string): Promise<void> {
    return this.releaseAdvisoryLockStrict(lockName);
  }

  private async acquireAdvisoryLockStrict(lockName: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    const ownerToken = this.adapterId;
    if (this.heldLocks.has(lockName)) return true;

    while (true) {
      let lockDb: BunDatabase | undefined;
      let transactionStarted = false;
      let attemptError: DomainError | undefined;
      let cleanupError: DomainError | undefined;

      try {
        lockDb = new BunDatabase(this.dbPath, {
          strict: true,
          create: true,
          safeIntegers: true,
          readonly: false,
        });
        lockDb.exec("PRAGMA foreign_keys = ON");
        lockDb.exec("PRAGMA busy_timeout = 0");
        lockDb.exec(`
          CREATE TABLE IF NOT EXISTS __migration_locks (
            name TEXT PRIMARY KEY,
            owner_token TEXT NOT NULL,
            acquired_at INTEGER NOT NULL
          )
        `);
        lockDb.exec("BEGIN IMMEDIATE");
        transactionStarted = true;

        const existing = lockDb.query("SELECT owner_token FROM __migration_locks WHERE name = ?").get(lockName) as
          | { owner_token?: unknown }
          | undefined;
        if (existing && existing.owner_token !== ownerToken) {
          throw new DomainError("SQLITE_CONTENTION_BUSY", "SQLite advisory lock is contended");
        }

        if (existing) {
          lockDb.query("UPDATE __migration_locks SET acquired_at = ? WHERE name = ?").run(Date.now(), lockName);
        } else {
          lockDb.query("INSERT INTO __migration_locks (name, owner_token, acquired_at) VALUES (?, ?, ?)").run(
            lockName,
            ownerToken,
            Date.now(),
          );
        }

        this.heldLocks.set(lockName, ownerToken);
        this.lockTransactions.set(lockName, lockDb);
        lockDb = undefined;
        return true;
      } catch (error) {
        attemptError = normalizeSqliteError(error, "advisory lock acquisition");
      }

      if (transactionStarted && lockDb) {
        try {
          lockDb.exec("ROLLBACK");
        } catch (error) {
          cleanupError = normalizeSqliteError(error, "advisory lock rollback");
        }
      }
      if (lockDb) {
        try {
          lockDb.close();
        } catch (error) {
          cleanupError ??= normalizeSqliteError(error, "advisory lock cleanup");
        }
      }

      if (cleanupError && !isContentionError(cleanupError)) throw cleanupError;
      if (!isContentionError(attemptError)) throw attemptError;
      if (Date.now() >= deadline) return false;
      await waitForRetry(deadline, 50);
    }
  }

  private async releaseAdvisoryLockStrict(lockName: string): Promise<void> {
    const lockDb = this.lockTransactions.get(lockName);
    if (!lockDb) {
      this.heldLocks.delete(lockName);
      return;
    }

    let releaseError: DomainError | undefined;
    try {
      lockDb.exec("ROLLBACK");
    } catch (error) {
      releaseError = normalizeSqliteError(error, "advisory lock rollback");
    }
    try {
      lockDb.close();
    } catch (error) {
      releaseError ??= normalizeSqliteError(error, "advisory lock cleanup");
    }
    this.lockTransactions.delete(lockName);
    this.heldLocks.delete(lockName);
    if (releaseError) throw releaseError;
  }

}
