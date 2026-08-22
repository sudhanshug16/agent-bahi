import { DomainError } from "../../core/types.ts";

export interface DatabaseConfig {
  dialect: "sqlite";
  sqlite: SqliteConfig;
}

export interface SqliteConfig {
  path: string;
}

/**
 * Parse database URL into typed configuration.
 * Supports only sqlite:///path/to/db.sqlite (file path, must be absolute).
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
        if (parsed.hostname && parsed.hostname !== "localhost") {
          throw new Error(`SQLite URL host ${parsed.hostname} is rejected; only local files are supported`);
        }
        if (parsed.username || parsed.password || parsed.port) {
          throw new Error("SQLite URL credentials and ports are rejected; only local files are supported");
        }

        // sqlite:///path/to/db.sqlite → pathname is /path/to/db.sqlite
        let path = decodeURIComponent(parsed.pathname);
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

      case "postgresql":
      case "postgres":
      case "mysql":
      case "http":
      case "https":
        throw new Error(`Database scheme ${parsed.protocol} is explicitly rejected; only local SQLite file URLs are supported`);

      default:
        throw new Error(`Database scheme ${parsed.protocol} is unsupported; only local SQLite file URLs are supported`);
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
  if (config.dialect !== "sqlite") {
    throw new DomainError("UNSUPPORTED_DATABASE_DIALECT", `Database dialect ${String(config.dialect)} is rejected; only sqlite is supported`);
  }
  if (!config.sqlite) {
    throw new DomainError("INVALID_DATABASE_CONFIG", "SQLite config required for sqlite dialect");
  }
}
