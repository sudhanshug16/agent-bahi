import type { BusinessSessionRunner } from "../../application/ports/persistence.ts";
import { SqliteBusinessSessionRunner } from "./business-session-runner.ts";
import type { Dialect } from "../../core/types.ts";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";

/**
 * Factory for creating BusinessSessionRunner.
 * Composition root for production use.
 *
 * Invariant: the constructed runner validates database state directly on the
 * fresh connection, without external dependencies. All gate validation happens
 * within the same transaction where BEGIN IMMEDIATE is executed.
 */
export class BusinessSessionFactory {
  /**
   * Create a BusinessSessionRunner for a SQLite database at the given path.
   * The runner validates database state directly on each fresh connection.
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

    // Create and return the session runner
    // The runner validates database_control and schema directly on the fresh connection
    return new SqliteBusinessSessionRunner(dbPath, readerProtocol, writerProtocol);
  }
}
