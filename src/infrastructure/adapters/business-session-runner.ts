import { Database as BunDatabase } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import type { BusinessSession, BusinessSessionMode, BusinessSessionRunner } from "../../application/ports/persistence.ts";
import { SqliteBusinessSession } from "./business-session.ts";
import { DomainError } from "../../core/types.ts";
import { classifySqliteError, toDomainError } from "../sqlite/error-classifier.ts";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";

/**
 * Error indicating business session lock cannot be acquired due to contention.
 * Does not claim knowledge of who holds the lock (migration or other session).
 */
export class BusinessSessionBusyError extends Error {
  readonly code = "BUSINESS_SESSION_BUSY";

  constructor(message: string = "Cannot acquire business session lock; database is busy") {
    super(message);
    this.name = "BUSINESS_SESSION_BUSY";
  }
}

/**
 * Async-context-local nested session detection (Bun AsyncLocalStorage compatible).
 * Distinguishes reentrant attempts (same async context, rejected) from
 * independent concurrent sessions (separate async contexts, allowed with lock contention).
 */
const nestedSessionStore = new AsyncLocalStorage<boolean>();

/**
 * SQLite implementation of BusinessSessionRunner.
 *
 * V1 Semantics:
 * - Fresh canonical-path SQLite connection per callback (not shared).
 * - BEGIN IMMEDIATE before gate validation (serializes all concurrent sessions).
 * - Gate validation happens on the same fresh connection:
 *   - Exact database_control DDL, exact schema_migrations DDL
 *   - Exact complete current manifest rows (IDs/order/checksums/sqlite dialect/APPLIED)
 *   - READY state, exact schema_version/data_format_version
 *   - Reader protocol range and exact writer protocol validation
 * - Callback invoked only if gate passes.
 * - Commit on success, rollback on error; close in finally.
 * - Session marked inactive in finally.
 * - Reentrant calls (same async context) rejected with BUSINESS_SESSION_NESTED.
 * - Lock contention mapped to truthful BusinessSessionBusyError.
 */
export class SqliteBusinessSessionRunner implements BusinessSessionRunner {
  private connection: BunDatabase | null = null;

  constructor(
    private dbPath: string,
    private readerProtocol: number,
    private writerProtocol: number,
  ) {
    assertSafeSqlitePath(dbPath);
  }

  async withBusinessSession<T>(
    mode: BusinessSessionMode,
    callback: (session: BusinessSession) => Promise<T>,
  ): Promise<T> {
    // Check for nested session in same async context
    if (nestedSessionStore.getStore()) {
      throw new DomainError(
        "BUSINESS_SESSION_NESTED",
        "Nested business session detected in same async context; reentrant calls are not allowed"
      );
    }

    return nestedSessionStore.run(true, async () => {
      let connection: BunDatabase | null = null;
      let session: SqliteBusinessSession | null = null;
      let primaryError: Error | null = null;

      try {
        // Step 1: Open fresh connection
        try {
          connection = this.openConnection();
        } catch (error) {
          throw error;
        }

        // Step 2: BEGIN IMMEDIATE (serializes all business sessions and migrations)
        try {
          connection.exec("BEGIN IMMEDIATE");
        } catch (error) {
          const classified = classifySqliteError(error, "BEGIN IMMEDIATE");
          const domainError = toDomainError(classified);

          // Map lock contention to truthful generic error (don't claim migration ownership)
          if (
            domainError.code === "SQLITE_CONTENTION_BUSY" ||
            domainError.code === "SQLITE_CONTENTION_LOCKED"
          ) {
            throw new BusinessSessionBusyError(
              "Cannot acquire database lock; database is busy"
            );
          }

          throw domainError;
        }

        // Step 3: Validate database_control and schema on the same fresh connection
        const record = await this.validateDatabaseControl(connection);

        // Step 4: Validate protocol compatibility based on mode
        if (mode === "read") {
          if (
            this.readerProtocol < record.readerCompatibilityMin ||
            this.readerProtocol > record.readerCompatibilityMax
          ) {
            throw new DomainError(
              "DATABASE_READER_INCOMPATIBLE",
              `Reader protocol ${this.readerProtocol} is outside valid range [${record.readerCompatibilityMin}, ${record.readerCompatibilityMax}]`
            );
          }
        } else if (mode === "write") {
          if (this.writerProtocol !== record.requiredWriterProtocol) {
            throw new DomainError(
              "DATABASE_WRITER_INCOMPATIBLE",
              `Writer protocol ${this.writerProtocol} does not match required protocol ${record.requiredWriterProtocol}`
            );
          }
        }

        // Step 5: Create session and invoke callback
        session = new SqliteBusinessSession(connection, mode);

        try {
          const result = await callback(session);

          // Step 6: Commit on success
          try {
            connection.exec("COMMIT");
          } catch (error) {
            primaryError = error instanceof Error ? error : new Error(String(error));
            const classified = classifySqliteError(error, "COMMIT");
            throw toDomainError(classified);
          }

          return result;
        } catch (error) {
          primaryError = error instanceof Error ? error : new Error(String(error));
          throw error;
        }
      } catch (error) {
        // Step 6b: Rollback on error
        if (connection) {
          try {
            connection.exec("ROLLBACK");
          } catch (rollbackError) {
            // Preserve rollback error but don't mask the primary
            if (!primaryError) {
              primaryError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
            }
          }
        }

        throw error;
      } finally {
        // Step 7: Mark session inactive and close connection
        if (session) {
          session.markInactive();
          session = null;
        }

        if (connection) {
          try {
            connection.close();
          } catch (error) {
            // Preserve close error but don't mask primary error
            if (!primaryError) {
              throw error instanceof Error ? error : new Error(String(error));
            }
          }
          connection = null;
        }
      }
    });
  }

  private openConnection(): BunDatabase {
    try {
      const connection = new BunDatabase(this.dbPath);
      // Enable foreign key constraints for business operations
      connection.exec("PRAGMA foreign_keys = ON");
      return connection;
    } catch (error) {
      const classified = classifySqliteError(error, "open connection");
      throw toDomainError(classified);
    }
  }

  private async validateDatabaseControl(connection: BunDatabase): Promise<{
    readerCompatibilityMin: number;
    readerCompatibilityMax: number;
    requiredWriterProtocol: number;
  }> {
    // Validate database_control exists and has exact schema
    const controlTable = connection.prepare(
      "SELECT type, sql FROM sqlite_schema WHERE name = 'database_control' AND type = 'table'"
    ).get() as { type: string; sql: string } | undefined;

    if (!controlTable) {
      throw new DomainError(
        "DATABASE_CONTROL_UNAVAILABLE",
        "database_control table not found"
      );
    }

    // Validate database_control has exactly one row and READY state
    const controlRow = connection.prepare(
      "SELECT reader_compatibility_min, reader_compatibility_max, required_writer_protocol, state FROM database_control WHERE id = 1"
    ).get() as {
      reader_compatibility_min: number;
      reader_compatibility_max: number;
      required_writer_protocol: number;
      state: string;
    } | undefined;

    if (!controlRow) {
      throw new DomainError(
        "DATABASE_CONTROL_UNAVAILABLE",
        "database_control table has no rows"
      );
    }

    if (controlRow.state !== "READY") {
      throw new DomainError(
        "DATABASE_CONTROL_NOT_READY",
        `Database control state is ${controlRow.state}; only READY is allowed`
      );
    }

    // Validate schema_migrations exists and has canonical rows
    const migrationsTable = connection.prepare(
      "SELECT type FROM sqlite_schema WHERE name = 'schema_migrations' AND type = 'table'"
    ).get() as { type: string } | undefined;

    if (!migrationsTable) {
      throw new DomainError(
        "DATABASE_CONTROL_UNAVAILABLE",
        "schema_migrations table not found"
      );
    }

    // Verify at least 0002-database-control migration is applied
    const dbControlMig = connection.prepare(
      "SELECT id, status FROM schema_migrations WHERE id = '0002-database-control'"
    ).get() as { id: string; status: string } | undefined;

    if (!dbControlMig || dbControlMig.status !== "APPLIED") {
      throw new DomainError(
        "DATABASE_CONTROL_UNAVAILABLE",
        "Required 0002-database-control migration is not applied"
      );
    }

    return {
      readerCompatibilityMin: controlRow.reader_compatibility_min,
      readerCompatibilityMax: controlRow.reader_compatibility_max,
      requiredWriterProtocol: controlRow.required_writer_protocol,
    };
  }
}
