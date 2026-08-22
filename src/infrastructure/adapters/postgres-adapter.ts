import type {
  Database,
  MigrationSession,
  QueryResult,
  Transaction,
  TransactionConfig,
  UnitOfWork,
  TableMetadata,
  ColumnMetadata,
} from "../../application/ports/persistence.ts";
import type { PostgresConfig } from "../config/database.ts";
import { DomainError, MigrationLockedError } from "../../core/types.ts";
import { randomUUID } from "crypto";
import {
  createBunSqlClient,
  firstBunSqlRow,
  normalizeBunSqlError,
  normalizeBunSqlResult,
  type BunSqlClient,
  type BunSqlExecutor,
} from "./bun-sql.ts";

const MIGRATION_LOCK_NAME = "agent-bahi-migration";

export function buildPostgresSqlOptions(config: PostgresConfig) {
  return {
    adapter: "postgres" as const,
    hostname: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
    connectionTimeout: 10,
    bigint: true,
    ssl: config.sslMode,
    tls: config.sslMode !== "disable" && config.sslMode !== undefined,
  };
}

class PostgresMigrationSession implements MigrationSession {
  private readonly token = randomUUID();
  private active = true;

  constructor(private readonly client: BunSqlExecutor) {}

  private checkActive(): void {
    if (!this.active) throw new DomainError("MIGRATION_SESSION_INACTIVE", "MigrationSession is no longer active");
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    this.checkActive();
    return normalizeBunSqlResult(await this.client.unsafe(sql, params ?? []));
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    return (await this.execute(sql, params)).rows[0];
  }

  async executeRaw(sql: string): Promise<void> {
    this.checkActive();
    await this.client.unsafe(sql);
  }

  leaseToken(): string {
    this.checkActive();
    return this.token;
  }

  async getTableMetadata(tableName: string): Promise<TableMetadata | null> {
    this.checkActive();
    // First check if table or view exists in catalog
    // This query will succeed or fail based on permissions/connection, not table existence
    const tableExists = (await this.execute(
      `SELECT table_type FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public'`,
      [tableName]
    )).rows[0] as { table_type: string } | undefined;

    // Only return null after a positive catalog result showing table is absent
    if (!tableExists) return null;

    const kind = tableExists.table_type === "VIEW" ? "VIEW" : "TABLE";

    // Get column metadata
    // These queries should not fail if the catalog check succeeded
    const columns = (await this.execute(
      `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
       FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = 'public'
       ORDER BY ordinal_position`,
      [tableName]
    )).rows as Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      ordinal_position: number;
    }>;

    // Check for primary key columns
    const pkQuery = (await this.execute(
      `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       JOIN pg_class t ON t.oid = i.indrelid
       WHERE t.relname = $1 AND i.indisprimary`,
      [tableName]
    )).rows.map(row => (row.attname as string).toLowerCase());

    const columnMetadata: ColumnMetadata[] = columns.map(col => ({
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable === "YES",
      default: col.column_default,
      primaryKey: pkQuery.includes(col.column_name.toLowerCase()),
    }));

    return {
      name: tableName,
      kind,
      columns: columnMetadata,
    };
  }

  setInactive(): void {
    this.active = false;
  }
}

class PostgresTransaction implements Transaction {
  private active = true;
  private finalized = false;

  constructor(
    private readonly client: BunSqlExecutor,
    private readonly managedByBun: boolean,
  ) {}

  private checkActive(): void {
    if (!this.active) throw new DomainError("TRANSACTION_NOT_ACTIVE", "Transaction not active");
  }

  async commit(): Promise<void> {
    this.checkActive();
    if (this.finalized) return;
    this.active = false;
    try {
      if (!this.managedByBun) await this.client.unsafe("COMMIT");
    } finally {
      this.finalized = true;
    }
  }

  async rollback(): Promise<void> {
    this.checkActive();
    if (this.finalized) return;
    this.active = false;
    try {
      if (!this.managedByBun) await this.client.unsafe("ROLLBACK");
    } catch {
      // The server may already have rolled back the connection.
    } finally {
      this.finalized = true;
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    this.checkActive();
    return normalizeBunSqlResult(await this.client.unsafe(sql, params ?? []));
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    return (await this.execute(sql, params)).rows[0];
  }

  async executeRaw(sql: string): Promise<void> {
    this.checkActive();
    await this.client.unsafe(sql);
  }

  isActive(): boolean {
    return this.active;
  }
}

class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly client: BunSqlClient) {}

  async execute<T>(callback: (tx: Transaction) => Promise<T>, _config?: TransactionConfig): Promise<T> {
    return this.client.begin(async (transaction) => callback(new PostgresTransaction(transaction, true)));
  }
}

export class PostgresAdapter implements Database {
  private client: BunSqlClient | null;
  private readonly config: PostgresConfig;

  constructor(config: PostgresConfig) {
    this.config = { ...config };
    this.client = createBunSqlClient(buildPostgresSqlOptions(config));
  }

  private getClient(): BunSqlClient {
    if (!this.client) throw new DomainError("DATABASE_CLOSED", "PostgreSQL database client is closed");
    return this.client;
  }

  private async run(sql: string, params?: unknown[]): Promise<QueryResult> {
    try {
      return normalizeBunSqlResult(await this.getClient().unsafe(sql, params ?? []));
    } catch (error) {
      throw normalizeBunSqlError(error, "postgresql");
    }
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    return this.run(sql, params);
  }

  async querySingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    return (await this.run(sql, params)).rows[0];
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    return this.run(sql, params);
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    return (await this.run(sql, params)).rows[0];
  }

  async executeRaw(sql: string): Promise<void> {
    try {
      await this.getClient().unsafe(sql);
    } catch (error) {
      throw normalizeBunSqlError(error, "postgresql");
    }
  }

  async beginTransaction(config?: TransactionConfig): Promise<Transaction> {
    const isolation = config?.isolationLevel ?? "read_committed";
    const readOnly = config?.readOnly ? " READ ONLY" : " READ WRITE";
    await this.executeRaw(`BEGIN ISOLATION LEVEL ${isolation.toUpperCase().replace(/_/g, " ")}${readOnly}`);
    return new PostgresTransaction(this.getClient(), false);
  }

  unitOfWork(_config?: TransactionConfig): UnitOfWork {
    return new PostgresUnitOfWork(this.getClient());
  }

  async withMigrationLease<T>(callback: (session: MigrationSession) => Promise<T>, timeoutMs = 30000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    return this.getClient().begin(async (transaction) => {
      let acquired = false;
      while (Date.now() < deadline) {
        const row = firstBunSqlRow(await transaction.unsafe(
          "SELECT pg_try_advisory_xact_lock($1) AS acquired",
          [this.hashToLockId(MIGRATION_LOCK_NAME)],
        ));
        if (row?.acquired === true || row?.acquired === "t") {
          acquired = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
      }
      if (!acquired) throw new MigrationLockedError(`Failed to acquire migration lock within ${timeoutMs}ms`);
      const session = new PostgresMigrationSession(transaction);
      try {
        return await callback(session);
      } finally {
        session.setInactive();
      }
    });
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.run("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.close({ timeout: 1000 });
  }

  async acquireAdvisoryLock(lockName: string, _timeoutMs = 5000): Promise<boolean> {
    const row = (await this.run("SELECT pg_try_advisory_lock($1) AS acquired", [this.hashToLockId(lockName)])).rows[0];
    return row?.acquired === true || row?.acquired === "t";
  }

  async releaseAdvisoryLock(lockName: string): Promise<void> {
    await this.run("SELECT pg_advisory_unlock($1)", [this.hashToLockId(lockName)]);
  }

  private hashToLockId(name: string): number {
    let hash = 0;
    for (const character of name) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return Math.abs(hash) % 2147483647;
  }
}
