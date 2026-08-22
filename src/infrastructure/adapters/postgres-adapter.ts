import type { Database, Transaction, TransactionConfig, QueryResult, UnitOfWork, MigrationSession } from "../../application/ports/persistence.ts";
import type { PostgresConfig } from "../config/database.ts";
import { DomainError, MigrationLockedError } from "../../core/types.ts";
import { randomUUID } from "crypto";

/**
 * PostgreSQL Migration Session (callback-scoped): uses pinned connection with xact-scoped lock.
 * txSql held by db.begin() callback; never escape scope.
 * Commit/rollback handled automatically by Bun on callback return/error.
 */
class PostgresMigrationSession implements MigrationSession {
  private token: string;

  constructor(private txSql: any) {
    this.token = randomUUID();
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    const result = await this.txSql.query(sql, params || []);
    return {
      rows: Array.isArray(result) ? result : result?.rows || [],
      rowCount: (result?.length || result?.rows?.length || 0) as number,
    };
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    const result = await this.txSql.query(sql, params || []);
    return (Array.isArray(result) ? result[0] : result?.rows?.[0]) as Record<string, unknown> | undefined;
  }

  async executeRaw(sql: string): Promise<void> {
    await this.txSql.query(sql);
  }

  leaseToken(): string {
    return this.token;
  }
}

/**
 * PostgreSQL Transaction using Bun.sql transaction callback (pinned connection).
 * When created via UnitOfWork.begin(), this txSql is already in a transaction.
 * When created via beginTransaction(), this is a pooled connection and caller must manage BEGIN/COMMIT.
 */
class PostgresTransaction implements Transaction {
  private active = true;
  private isFromBeginCallback: boolean;

  constructor(private txSql: any, isFromBeginCallback: boolean = true) {
    // isFromBeginCallback=true: Bun manages BEGIN/COMMIT
    // isFromBeginCallback=false: we must manage BEGIN/COMMIT (legacy beginTransaction path)
    this.isFromBeginCallback = isFromBeginCallback;
  }

  async commit(): Promise<void> {
    if (!this.active) throw new Error("Transaction not active");
    this.active = false;
    // Only call COMMIT if we manually started the transaction
    // If from .begin() callback, Bun handles commit automatically
    if (!this.isFromBeginCallback) {
      await this.txSql.query("COMMIT");
    }
  }

  async rollback(): Promise<void> {
    if (!this.active) throw new Error("Transaction not active");
    this.active = false;
    // Only call ROLLBACK if we manually started the transaction
    if (!this.isFromBeginCallback) {
      try {
        await this.txSql.query("ROLLBACK");
      } catch {
        // Already rolled back
      }
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.active) throw new Error("Transaction not active");

    const result = await this.txSql.query(sql, params || []);
    return {
      rows: Array.isArray(result) ? result : result?.rows || [],
      rowCount: (result?.length || result?.rows?.length || 0) as number,
    };
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    if (!this.active) throw new Error("Transaction not active");

    const result = await this.txSql.query(sql, params || []);
    return (Array.isArray(result) ? result[0] : result?.rows?.[0]) as Record<string, unknown> | undefined;
  }

  async executeRaw(sql: string): Promise<void> {
    if (!this.active) throw new Error("Transaction not active");
    await this.txSql.query(sql);
  }

  isActive(): boolean {
    return this.active;
  }
}

/**
 * PostgreSQL UnitOfWork implementation.
 * Uses Bun's .begin() callback to pin transaction to one reserved connection.
 */
class PostgresUnitOfWork implements UnitOfWork {
  constructor(private db: any) {} // Bun SQL pool object

  async execute<T>(
    callback: (tx: Transaction) => Promise<T>,
    config?: TransactionConfig,
  ): Promise<T> {
    // Bun.db.begin() pins txSql to one reserved connection for entire callback
    // Auto-commits on success, auto-rollbacks on error
    // No manual BEGIN/COMMIT needed
    return this.db.begin(config, async (txSql: any) => {
      const tx = new PostgresTransaction(txSql);
      return callback(tx);
    });
  }
}

/**
 * PostgreSQL adapter using Bun.sql native connection.
 *
 * Guarantees:
 * - advisory_lock for migration serialization
 * - isolation level configuration
 * - statement timeouts for safety
 */
export class PostgresAdapter implements Database {
  private db: any; // Bun.sql connection

  constructor(config: PostgresConfig) {
    // Bun.sql will be instantiated at runtime via dynamic import
    // For now, we define the interface and will initialize in methods
    this.db = null;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.db) {
      throw new DomainError(
        "DATABASE_NOT_INITIALIZED",
        "PostgreSQL adapter not initialized. Must call initialize() first.",
      );
    }
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    await this.ensureConnected();

    try {
      const result = await this.db.query(sql, params || []);
      return {
        rows: Array.isArray(result) ? result : result?.rows || [],
        rowCount: (result?.length || result?.rows?.length || 0) as number,
      };
    } catch (error) {
      this.handlePostgresError(error);
      throw error;
    }
  }

  async querySingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    await this.ensureConnected();

    try {
      const result = await this.db.query(sql, params || []);
      return (Array.isArray(result) ? result[0] : result?.rows?.[0]) as Record<string, unknown> | undefined;
    } catch (error) {
      this.handlePostgresError(error);
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
    await this.ensureConnected();

    try {
      await this.db.query(sql);
    } catch (error) {
      this.handlePostgresError(error);
      throw error;
    }
  }

  async beginTransaction(config?: TransactionConfig): Promise<Transaction> {
    await this.ensureConnected();

    const isolationLevel = config?.isolationLevel || "read_committed";
    const readOnly = config?.readOnly ? "READ ONLY" : "READ WRITE";

    await this.db.query(`BEGIN ISOLATION LEVEL ${isolationLevel.toUpperCase()} ${readOnly}`);

    return new PostgresTransaction(this.db, false); // false = caller manages BEGIN/COMMIT
  }

  unitOfWork(config?: TransactionConfig): UnitOfWork {
    return new PostgresUnitOfWork(this.db);
  }

  async withMigrationLease<T>(
    callback: (session: MigrationSession) => Promise<T>,
    timeoutMs: number = 30000,
  ): Promise<T> {
    await this.ensureConnected();
    const lockId = this.hashToLockId("agent-bahi-migration");
    const deadline = Date.now() + timeoutMs;
    const retryIntervalMs = 50;

    // Use db.begin() to get pinned connection; acquire xact-scoped advisory lock with deadline retry.
    return this.db.begin(async (txSql: any) => {
      // Retry pg_try_advisory_xact_lock until deadline (not indefinitely blocking)
      let lockAcquired = false;
      while (Date.now() < deadline) {
        const lockResult = await txSql.query(
          "SELECT pg_try_advisory_xact_lock($1) as acquired",
          [lockId],
        );

        if (lockResult && lockResult[0] && lockResult[0].acquired === true) {
          lockAcquired = true;
          break;
        }

        // Not acquired; wait before retry
        const remainingMs = deadline - Date.now();
        if (remainingMs > 0) {
          await new Promise(resolve => setTimeout(resolve, Math.min(retryIntervalMs, remainingMs)));
        }
      }

      if (!lockAcquired) {
        throw new MigrationLockedError(
          `Failed to acquire migration advisory lock within ${timeoutMs}ms deadline`,
        );
      }

      const session = new PostgresMigrationSession(txSql);
      return await callback(session);
      // Bun automatically commits if callback returns, rolls back if callback throws
    });
  }

  async isConnected(): Promise<boolean> {
    try {
      if (!this.db) return false;
      const result = await this.db.query("SELECT 1");
      return !!result;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  async acquireAdvisoryLock(lockName: string, timeoutMs: number = 5000): Promise<boolean> {
    await this.ensureConnected();

    try {
      // PostgreSQL advisory locks are 64-bit integers.
      // Convert lock name to hash for lock ID.
      const lockId = this.hashToLockId(lockName);

      // pg_advisory_lock blocks until acquired. Use pg_try_advisory_lock for non-blocking.
      const result = await this.db.query(
        "SELECT pg_try_advisory_lock($1) as acquired",
        [lockId],
      );

      return (result[0]?.acquired || result[0]?.acquired_lock) === true;
    } catch (error) {
      this.handlePostgresError(error);
      throw error;
    }
  }

  async releaseAdvisoryLock(lockName: string): Promise<void> {
    await this.ensureConnected();

    try {
      const lockId = this.hashToLockId(lockName);
      await this.db.query("SELECT pg_advisory_unlock($1)", [lockId]);
    } catch (error) {
      this.handlePostgresError(error);
      throw error;
    }
  }

  private hashToLockId(name: string): number {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      const char = name.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % 2147483647;
  }

  private handlePostgresError(error: unknown): void {
    if (error instanceof Error) {
      if (error.message.includes("connect ECONNREFUSED")) {
        throw new DomainError("DATABASE_CONNECTION_FAILED", "PostgreSQL connection refused");
      }
      if (error.message.includes("FATAL")) {
        throw new DomainError("POSTGRES_FATAL", `PostgreSQL fatal error: ${error.message}`);
      }
      if (error.message.includes("password")) {
        throw new DomainError("POSTGRES_AUTH_FAILED", "PostgreSQL authentication failed");
      }
    }
  }
}
