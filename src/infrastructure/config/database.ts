import type { Dialect } from "../../core/types.ts";
import { DomainError } from "../../core/types.ts";

export interface DatabaseConfig {
  dialect: Dialect;
  sqlite?: SqliteConfig;
  postgresql?: PostgresConfig;
  mysql?: MysqlConfig;
}

export interface SqliteConfig {
  path: string;
}

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  username?: string;
  password?: string;
  sslMode?: "disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full";
}

export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  username?: string;
  password?: string;
  ssl?: boolean;
}

/**
 * Parse database URL into typed configuration.
 * Supports:
 * - sqlite:///path/to/db.sqlite (file path, must be absolute)
 * - postgresql://user:pass@host:5432/dbname
 * - mysql://user:pass@host:3306/dbname
 */
export function parseDatabaseUrl(url: string): DatabaseConfig {
  if (!url) {
    throw new DomainError(
      "INVALID_DATABASE_URL",
      "Database URL is required",
    );
  }

  try {
    const parsed = new URL(url);

    switch (parsed.protocol.toLowerCase().replace(":", "")) {
      case "sqlite": {
        // sqlite:///path/to/db.sqlite → pathname is /path/to/db.sqlite
        let path = parsed.pathname;
        if (!path.startsWith("/")) {
          path = "/" + path;
        }

        if (!path || path === "/") {
          throw new Error("SQLite path is required");
        }

        return {
          dialect: "sqlite",
          sqlite: { path },
        };
      }

      case "postgresql": {
        const host = parsed.hostname || "localhost";
        const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
        const database = parsed.pathname.slice(1);
        const username = parsed.username;
        const password = decodeURIComponent(parsed.password || "");
        const sslMode = (parsed.searchParams.get("sslmode") as PostgresConfig["sslMode"]) || undefined;

        if (!database) {
          throw new Error("PostgreSQL database name is required");
        }

        return {
          dialect: "postgresql",
          postgresql: {
            host,
            port,
            database,
            username,
            password: password || undefined,
            sslMode,
          },
        };
      }

      case "mysql": {
        const host = parsed.hostname || "localhost";
        const port = parsed.port ? parseInt(parsed.port, 10) : 3306;
        const database = parsed.pathname.slice(1);
        const username = parsed.username;
        const password = decodeURIComponent(parsed.password || "");
        const ssl = parsed.searchParams.get("ssl") === "true";

        if (!database) {
          throw new Error("MySQL database name is required");
        }

        return {
          dialect: "mysql",
          mysql: {
            host,
            port,
            database,
            username,
            password: password || undefined,
            ssl: ssl || undefined,
          },
        };
      }

      default:
        throw new Error(`Unsupported database dialect: ${parsed.protocol}`);
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new DomainError(
      "INVALID_DATABASE_URL",
      `Failed to parse database URL: ${message}`,
    );
  }
}

/**
 * Default SQLite database URL (in-memory for testing, file for production).
 */
export function getDefaultSqlitePath(): string {
  const tmpDir = Bun.env.TMPDIR || "/tmp";
  return `${tmpDir}/agent-bahi.sqlite`;
}

/**
 * Validate database config has required fields.
 */
export function validateDatabaseConfig(config: DatabaseConfig): void {
  if (config.dialect === "sqlite" && !config.sqlite) {
    throw new DomainError("INVALID_DATABASE_CONFIG", "SQLite config required for sqlite dialect");
  }
  if (config.dialect === "postgresql" && !config.postgresql) {
    throw new DomainError("INVALID_DATABASE_CONFIG", "PostgreSQL config required for postgresql dialect");
  }
  if (config.dialect === "mysql" && !config.mysql) {
    throw new DomainError("INVALID_DATABASE_CONFIG", "MySQL config required for mysql dialect");
  }
}
