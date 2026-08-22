import type { BusinessSessionRunner } from "../../application/ports/persistence.ts";
import { SqliteAdapter } from "./sqlite-adapter.ts";
import { SqliteBusinessSessionRunner } from "./business-session-runner.ts";
import { DatabaseControlService } from "../services/database-control-service.ts";
import type { Dialect } from "../../core/types.ts";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";

/**
 * Factory for creating BusinessSessionRunner with all dependencies.
 * Composition root for production use.
 *
 * Invariant: the constructed runner uses only the injected database path.
 * DatabaseControlService is created fresh for each runner to ensure isolation.
 */
export class BusinessSessionFactory {
  /**
   * Create a BusinessSessionRunner for a SQLite database at the given path.
   * Initializes the Database adapter and DatabaseControlService internally.
   *
   * @param dbPath - Absolute path to SQLite database file
   * @param dialect - Database dialect (currently only 'sqlite' supported)
   * @param readerProtocol - Reader protocol version for compatibility checks
   * @param writerProtocol - Writer protocol version for compatibility checks
   * @returns Configured BusinessSessionRunner ready for use
   */
  static createSessionRunner(
    dbPath: string,
    dialect: Dialect = "sqlite",
    readerProtocol: number = 1,
    writerProtocol: number = 1,
  ): BusinessSessionRunner {
    assertSafeSqlitePath(dbPath);

    if (dialect !== "sqlite") {
      throw new Error(`Only sqlite dialect is supported, got ${dialect}`);
    }

    // Create the database adapter
    const db = new SqliteAdapter({ path: dbPath });

    // Create the control service (will inspect existing state if present)
    const controlService = new DatabaseControlService(db, dialect);

    // Create and return the session runner
    return new SqliteBusinessSessionRunner(
      dbPath,
      controlService,
      readerProtocol,
      writerProtocol,
    );
  }
}
