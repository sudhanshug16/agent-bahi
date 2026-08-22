import { SQL } from "bun";
import type { Dialect } from "../../core/types.ts";
import { DomainError } from "../../core/types.ts";

export type BunSqlRow = Record<string, unknown>;

export interface BunSqlResult extends Array<BunSqlRow> {
  rows?: BunSqlRow[];
  count?: number;
}

export interface BunSqlExecutor {
  unsafe(sql: string, params?: unknown[]): Promise<BunSqlResult>;
}

export interface BunSqlClient extends BunSqlExecutor {
  begin<T>(callback: (transaction: BunSqlExecutor) => Promise<T>): Promise<T>;
  close(options?: { timeout?: number }): Promise<void>;
}

export interface BunSqlConnectionOptions {
  adapter: "postgres" | "mysql";
  hostname: string;
  port: number;
  database: string;
  username?: string;
  password?: string;
  connectionTimeout: number;
  bigint: boolean;
  ssl?: "disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full";
  tls?: boolean;
}

type BunSqlConstructorOptions = ConstructorParameters<typeof SQL>[0];

export function createBunSqlClient(options: BunSqlConnectionOptions): BunSqlClient {
  // Bun.SQL is the only client used here. The cast bridges the narrow port above
  // to Bun's runtime-specific result/transaction types without introducing any.
  return new SQL(options as unknown as BunSqlConstructorOptions) as unknown as BunSqlClient;
}

export function normalizeBunSqlResult(result: BunSqlResult): { rows: BunSqlRow[]; rowCount: number } {
  const rows = result.rows ?? [...result];
  return { rows, rowCount: result.count ?? rows.length };
}

export function firstBunSqlRow(result: BunSqlResult): BunSqlRow | undefined {
  return normalizeBunSqlResult(result).rows[0];
}

function rawErrorDetails(error: unknown): { code?: string; message: string } {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown };
    return {
      code: typeof candidate.code === "string" ? candidate.code : undefined,
      message: candidate.message,
    };
  }
  return { message: String(error) };
}

function safeCause(error: unknown): string {
  const details = rawErrorDetails(error);
  const message = details.message.toLowerCase();
  const category = message.includes("ssl") || message.includes("tls") || message.includes("certificate") || message.includes("private key")
    ? "tls"
    : message.includes("password") || message.includes("authentication") || message.includes("access denied")
      ? "authentication"
      : message.includes("timeout") || message.includes("timed out")
        ? "timeout"
        : message.includes("permission") || message.includes("authorized")
          ? "permission"
          : message.includes("connect") || message.includes("connection")
            ? "connection"
            : "query";
  // Never retain raw driver text: it may contain URLs, usernames, passwords,
  // or certificate/key material. Code plus category is the safe cause.
  const safeCodes = new Set([
    "ECONNREFUSED",
    "ETIMEDOUT",
    "28P01",
    "42P01",
    "42501",
    "57014",
    "ER_ACCESS_DENIED_ERROR",
    "ER_NO_SUCH_TABLE",
  ]);
  const code = details.code && safeCodes.has(details.code.toUpperCase()) ? details.code.toUpperCase() : "UNKNOWN";
  return `${code}:${category}`;
}

export function normalizeBunSqlError(error: unknown, dialect: Dialect): DomainError {
  const details = rawErrorDetails(error);
  const message = details.message.toLowerCase();
  const code = details.code?.toUpperCase();

  if (
    code === "42P01" ||
    code === "ER_NO_SUCH_TABLE" ||
    message.includes("relation \"schema_migrations\" does not exist") ||
    message.includes("table 'schema_migrations' doesn't exist") ||
    message.includes("no such table: schema_migrations")
  ) {
    return new DomainError("CONTROL_TABLE_MISSING", "Migration control table is not initialized", {
      dialect,
      cause: safeCause(error),
    });
  }

  if (message.includes("econnrefused") || message.includes("connection refused") || code === "ECONNREFUSED") {
    return new DomainError("DATABASE_CONNECTION_FAILED", `${dialect} database connection failed`, {
      dialect,
      cause: safeCause(error),
    });
  }

  if (message.includes("ssl") || message.includes("tls") || message.includes("certificate") || message.includes("private key")) {
    return new DomainError(dialect === "mysql" ? "MYSQL_SSL_ERROR" : "POSTGRES_TLS_ERROR", `${dialect} database TLS negotiation failed`, {
      dialect,
      cause: safeCause(error),
    });
  }

  if (
    message.includes("password") ||
    message.includes("authentication") ||
    message.includes("access denied") ||
    message.includes("invalid authorization") ||
    code === "28P01" ||
    code === "ER_ACCESS_DENIED_ERROR"
  ) {
    const authCode = dialect === "postgresql" ? "POSTGRES_AUTH_FAILED" : "MYSQL_AUTH_FAILED";
    return new DomainError(authCode, `${dialect} database authentication failed`, {
      dialect,
      cause: safeCause(error),
    });
  }

  if (message.includes("permission denied") || message.includes("not authorized") || code === "42501") {
    return new DomainError("DATABASE_PERMISSION_DENIED", `${dialect} database permission denied`, {
      dialect,
      cause: safeCause(error),
    });
  }

  if (message.includes("timeout") || message.includes("timed out") || code === "57014") {
    return new DomainError("DATABASE_TIMEOUT", `${dialect} database operation timed out`, {
      dialect,
      cause: safeCause(error),
    });
  }

  return new DomainError("DATABASE_QUERY_FAILED", `${dialect} database query failed`, {
    dialect,
    cause: safeCause(error),
  });
}
