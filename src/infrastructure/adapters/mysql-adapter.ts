import type {
  Database,
  MigrationSession,
  QueryResult,
  Transaction,
  TransactionConfig,
  UnitOfWork,
} from "../../application/ports/persistence.ts";
import type { MysqlConfig } from "../config/database.ts";
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

export function buildMysqlSqlOptions(config: MysqlConfig) {
  return {
    adapter: "mysql" as const,
    hostname: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
    connectionTimeout: 10,
    bigint: true,
    ssl: config.ssl ? "require" as const : "disable" as const,
    tls: config.ssl,
  };
}

class MysqlMigrationSession implements MigrationSession {
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

  setInactive(): void {
    this.active = false;
  }
}

class MysqlTransaction implements Transaction {
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

class MysqlUnitOfWork implements UnitOfWork {
  constructor(private readonly client: BunSqlClient) {}

  async execute<T>(callback: (tx: Transaction) => Promise<T>, _config?: TransactionConfig): Promise<T> {
    return this.client.begin(async (transaction) => callback(new MysqlTransaction(transaction, true)));
  }
}

export class MysqlAdapter implements Database {
  private client: BunSqlClient | null;
  private readonly config: MysqlConfig;

  constructor(config: MysqlConfig) {
    this.config = { ...config };
    this.client = createBunSqlClient(buildMysqlSqlOptions(config));
  }

  private getClient(): BunSqlClient {
    if (!this.client) throw new DomainError("DATABASE_CLOSED", "MySQL database client is closed");
    return this.client;
  }

  private async run(sql: string, params?: unknown[]): Promise<QueryResult> {
    try {
      return normalizeBunSqlResult(await this.getClient().unsafe(sql, params ?? []));
    } catch (error) {
      throw normalizeBunSqlError(error, "mysql");
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
      throw normalizeBunSqlError(error, "mysql");
    }
  }

  async beginTransaction(config?: TransactionConfig): Promise<Transaction> {
    const isolation = config?.isolationLevel ?? "repeatable_read";
    await this.executeRaw(`SET TRANSACTION ISOLATION LEVEL ${isolation.toUpperCase().replace(/_/g, " ")}`);
    await this.executeRaw("START TRANSACTION");
    return new MysqlTransaction(this.getClient(), false);
  }

  unitOfWork(_config?: TransactionConfig): UnitOfWork {
    return new MysqlUnitOfWork(this.getClient());
  }

  async withMigrationLease<T>(callback: (session: MigrationSession) => Promise<T>, timeoutMs = 30000): Promise<T> {
    return this.getClient().begin(async (transaction) => {
      const lockResult = firstBunSqlRow(await transaction.unsafe(
        "SELECT GET_LOCK(?, ?) AS lock_result",
        [MIGRATION_LOCK_NAME, Math.ceil(Math.max(1, timeoutMs / 1000))],
      ));
      if (Number(lockResult?.lock_result ?? 0) !== 1) {
        throw new MigrationLockedError(`Failed to acquire migration lock within ${timeoutMs}ms`);
      }
      const session = new MysqlMigrationSession(transaction);
      try {
        return await callback(session);
      } finally {
        session.setInactive();
        try {
          await transaction.unsafe("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK_NAME]);
        } catch {
          // The reserved connection is being released by Bun.
        }
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

  async acquireAdvisoryLock(lockName: string, timeoutMs = 5000): Promise<boolean> {
    const row = (await this.run("SELECT GET_LOCK(?, ?) AS lock_result", [lockName, Math.ceil(Math.max(1, timeoutMs / 1000))])).rows[0];
    return Number(row?.lock_result ?? 0) === 1;
  }

  async releaseAdvisoryLock(lockName: string): Promise<void> {
    await this.run("SELECT RELEASE_LOCK(?)", [lockName]);
  }
}
