export type SqlValue = string | number | bigint | Uint8Array | null;

export interface SqlitePort {
  exec(sql: string): void;
  query<T extends Record<string, unknown>>(sql: string, ...values: SqlValue[]): T[];
  close(): void;
}
