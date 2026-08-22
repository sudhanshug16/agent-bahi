import type { Database } from "../../application/ports/persistence.ts";
import type { DatabaseConfig } from "../config/database.ts";
import { DomainError } from "../../core/types.ts";
import { SqliteAdapter } from "./sqlite-adapter.ts";
import { PostgresAdapter } from "./postgres-adapter.ts";
import { MysqlAdapter } from "./mysql-adapter.ts";

/**
 * Factory for creating database adapters from configuration.
 * Ensures proper initialization and error handling.
 */
export class DatabaseFactory {
  /**
   * Create a database adapter from configuration.
   * Validates configuration and instantiates the appropriate adapter.
   */
  static createDatabase(config: DatabaseConfig): Database {
    switch (config.dialect) {
      case "sqlite": {
        if (!config.sqlite) {
          throw new DomainError(
            "INVALID_DATABASE_CONFIG",
            "SQLite config required for sqlite dialect",
          );
        }
        return new SqliteAdapter(config.sqlite);
      }

      case "postgresql": {
        if (!config.postgresql) {
          throw new DomainError(
            "INVALID_DATABASE_CONFIG",
            "PostgreSQL config required for postgresql dialect",
          );
        }
        return new PostgresAdapter(config.postgresql);
      }

      case "mysql": {
        if (!config.mysql) {
          throw new DomainError(
            "INVALID_DATABASE_CONFIG",
            "MySQL config required for mysql dialect",
          );
        }
        return new MysqlAdapter(config.mysql);
      }

      default: {
        const unknownDialect = (config as any).dialect;
        throw new DomainError(
          "UNSUPPORTED_DIALECT",
          `Unsupported database dialect: ${unknownDialect}`,
        );
      }
    }
  }
}
