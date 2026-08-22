import type { Database, Transaction, TransactionConfig, QueryResult, UnitOfWork } from "../../application/ports/persistence.ts";
import type { MysqlConfig } from "../config/database.ts";
import { DomainError } from "../../core/types.ts";

/**
 * MySQL Transaction using Bun.sql transaction callback (pinned connection).
 * When created via UnitOfWork.begin(), this txSql is already in a transaction.
 * When created via beginTransaction(), this is a pooled connection and caller must manage BEGIN/COMMIT.
 */
class MysqlTransaction implements Transaction {
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
 * MySQL UnitOfWork implementation.
 * Uses Bun's .begin() callback to pin transaction to one reserved connection.
 */
class MysqlUnitOfWork implements UnitOfWork {
  constructor(private db: any) {} // Bun SQL pool object

  async execute<T>(
    callback: (tx: Transaction) => Promise<T>,
    config?: TransactionConfig,
  ): Promise<T> {
    // Bun.db.begin() pins txSql to one reserved connection for entire callback
    // Auto-commits on success, auto-rollbacks on error
    // No manual BEGIN/COMMIT needed
    return this.db.begin(config, async (txSql: any) => {
      const tx = new MysqlTransaction(txSql, true); // true = Bun manages BEGIN/COMMIT
      return callback(tx);
    });
  }
}

/**
 * MySQL adapter using Bun.sql native connection.
 *
 * Guarantees:
 * - GET_LOCK for migration serialization
 * - TLS support (configurable per connection)
 * - proper error handling for MySQL-specific errors
 */
export class MysqlAdapter implements Database {
  private db: any; // Bun.sql connection

  constructor(private config: MysqlConfig) {
    this.db = null;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.db) {
      throw new DomainError(
        "DATABASE_NOT_INITIALIZED",
        "MySQL adapter not initialized. Must call initialize() first.",
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
      this.handleMysqlError(error);
      throw error;
    }
  }

  async querySingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    await this.ensureConnected();

    try {
      const result = await this.db.query(sql, params || []);
      return (Array.isArray(result) ? result[0] : result?.rows?.[0]) as Record<string, unknown> | undefined;
    } catch (error) {
      this.handleMysqlError(error);
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
      this.handleMysqlError(error);
      throw error;
    }
  }

  async beginTransaction(config?: TransactionConfig): Promise<Transaction> {
    await this.ensureConnected();

    const isolationLevel = config?.isolationLevel || "repeatable_read";
    const modifier = config?.readOnly ? "READ ONLY" : "READ WRITE";

    // MySQL doesn't support READ ONLY in START TRANSACTION directly.
    // Use SET TRANSACTION instead.
    if (config?.readOnly) {
      await this.db.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel.toUpperCase().replace(/_/g, " ")} READ ONLY`);
    } else {
      await this.db.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel.toUpperCase().replace(/_/g, " ")}`);
    }

    await this.db.query("START TRANSACTION");

    return new MysqlTransaction(this.db, false); // false = caller manages BEGIN/COMMIT
  }

  unitOfWork(config?: TransactionConfig): UnitOfWork {
    return new MysqlUnitOfWork(this.db);
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
      await this.db.query("SELECT RELEASE_LOCK('migration_lock')").catch(() => {
        // Ignore if lock doesn't exist
      });
      await this.db.close();
      this.db = null;
    }
  }

  async acquireAdvisoryLock(lockName: string, timeoutMs: number = 5000): Promise<boolean> {
    await this.ensureConnected();

    try {
      // MySQL GET_LOCK returns 1 for success, 0 for timeout, NULL for error
      const result = await this.db.query(
        "SELECT GET_LOCK(?, ?) as lock_result",
        [lockName, Math.ceil(timeoutMs / 1000)],
      );

      return (result[0]?.lock_result || 0) === 1;
    } catch (error) {
      this.handleMysqlError(error);
      throw error;
    }
  }

  async releaseAdvisoryLock(lockName: string): Promise<void> {
    await this.ensureConnected();

    try {
      await this.db.query("SELECT RELEASE_LOCK(?)", [lockName]);
    } catch (error) {
      this.handleMysqlError(error);
      throw error;
    }
  }

  private handleMysqlError(error: unknown): void {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes("econnrefused")) {
        throw new DomainError("DATABASE_CONNECTION_FAILED", "MySQL connection refused");
      }

      if (message.includes("access denied")) {
        throw new DomainError("MYSQL_AUTH_FAILED", "MySQL authentication failed");
      }

      if (message.includes("unknown database")) {
        throw new DomainError("MYSQL_UNKNOWN_DATABASE", "MySQL database does not exist");
      }

      if (message.includes("ssl") || message.includes("tls")) {
        throw new DomainError("MYSQL_SSL_ERROR", `MySQL SSL/TLS error: ${error.message}`);
      }
    }
  }
}
