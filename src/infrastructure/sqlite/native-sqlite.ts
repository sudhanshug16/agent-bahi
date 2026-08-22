import { Database } from "bun:sqlite";
import type { SqlitePort, SqlValue } from "../../application/ports/sqlite-port.ts";

export class NativeBunSqlite implements SqlitePort {
  readonly database: Database;

  constructor(path: string) {
    this.database = new Database(path, { strict: true, create: true, safeIntegers: true });
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
