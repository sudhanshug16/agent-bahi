import type { Database } from "../../application/ports/persistence.ts";
import { validateDatabaseConfig, type DatabaseConfig } from "../config/database.ts";
import { DomainError } from "../../core/types.ts";
import { SqliteAdapter } from "./sqlite-adapter.ts";

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
    validateDatabaseConfig(config);
    switch (config.dialect) {
      case "sqlite": {
        return new SqliteAdapter(config.sqlite);
      }

      default: {
        throw new DomainError(
          "UNSUPPORTED_DATABASE_DIALECT",
          `Database dialect ${String(config.dialect)} is rejected; only sqlite is supported`,
        );
      }
    }
  }
}
