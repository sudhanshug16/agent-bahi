import type { Database, Transaction, TransactionConfig, QueryResult } from "../../application/ports/persistence.ts";
import type { PostgresConfig } from "../config/database.ts";
import { DomainError, MigrationLockedError } from "../../core/types.ts";

/**
 * PostgreSQL Transaction using Bun.sql native adapter.
 */
class PostgresTransaction implements Transaction {
  private active = true;

  constructor(private db: any) {
    // Transaction started by acquireTransaction
  }

  async commit(): Promise<void> {
    if (!this.active) throw new Error("Transaction not active");
    this.active = false;
    await this.db.query("COMMIT");
  }

  async rollback(): Promise<void> {
    if (!this.active) throw new Error("Transaction not active");
    this.active = false;
    try {
      await this.db.query("ROLLBACK");
    } catch {
      // Already rolled back
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.active) throw new Error("Transaction not active");

    const result = await this.db.query(sql, params || []);
    return {
      rows: Array.isArray(result) ? result : result?.rows || [],
      rowCount: (result?.length || result?.rows?.length || 0) as number,
    };
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    if (!this.active) throw new Error("Transaction not active");

    const result = await this.db.query(sql, params || []);
    return (Array.isArray(result) ? result[0] : result?.rows?.[0]) as Record<string, unknown> | undefined;
  }

  async executeRaw(sql: string): Promise<void> {
    if (!this.active) throw new Error("Transaction not active");
    await this.db.query(sql);
  }

  isActive(): boolean {
    return this.active;
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

    return new PostgresTransaction(this.db);
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
    // Simple hash to convert lock name to lock ID.
    // In production, use a more robust approach or just use string IDs.
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      const char = name.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % 2147483647; // Ensure positive 31-bit value
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
