import { Database as BunDatabase } from "bun:sqlite";
import type { BusinessSession, BusinessSessionMode, BusinessSessionRunner } from "../../application/ports/persistence.ts";
import type { DatabaseControlService } from "../services/database-control-service.ts";
import { SqliteBusinessSession } from "./business-session.ts";
import { DomainError, MigrationLockedError } from "../../core/types.ts";
import { classifySqliteError, toDomainError } from "../sqlite/error-classifier.ts";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";

/**
 * Nested session detection: track activeSession per runner instance to catch
 * reentrant attempts from the same async context. This distinguishes genuine
 * overlapping sessions (which are allowed as long as they use different connections)
 * from reentrant attempts within the same callback.
 */
const nestedSessionStore = new WeakMap<SqliteBusinessSessionRunner, boolean>();

/**
 * SQLite implementation of BusinessSessionRunner.
 *
 * V1 Semantics:
 * - Fresh canonical-path SQLite connection per callback (not shared).
 * - BEGIN IMMEDIATE before gate validation (serializes all concurrent sessions).
 * - database_control validation within same transaction, before callback.
 * - Callback invoked only if gate passes.
 * - Commit on success, rollback on error; close in finally.
 * - Session marked inactive in finally.
 * - Nested/reentrant rejected without native nested-transaction text.
 *
 * Migration vs business session exclusion:
 * The migration service holds its own fresh connection with BEGIN IMMEDIATE.
 * SQLite's locking ensures that an active migration and business session
 * contend at the native level; callback is not invoked if lock acquisition fails.
 */
export class SqliteBusinessSessionRunner implements BusinessSessionRunner {
  constructor(
    private dbPath: string,
    private controlService: DatabaseControlService,
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
    if (nestedSessionStore.get(this)) {
      throw new DomainError(
        "BUSINESS_SESSION_NESTED",
        "Nested business session detected in same async context; separate concurrent sessions are allowed, but reentrant calls are not"
      );
    }

    nestedSessionStore.set(this, true);
    let connection: BunDatabase | null = null;
    let session: SqliteBusinessSession | null = null;
    let primaryError: Error | null = null;
    let closeError: Error | null = null;

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

        // Detect migration lock contention: SQLITE_BUSY or SQLITE_LOCKED from BEGIN
        if (
          domainError.code === "SQLITE_CONTENTION_BUSY" ||
          domainError.code === "SQLITE_CONTENTION_LOCKED"
        ) {
          throw new MigrationLockedError(
            "Cannot acquire business session lock; migration may be active"
          );
        }

        throw domainError;
      }

      // Step 3: Validate database_control within the pinned transaction
      const inspection = await this.controlService.inspect();

      if (inspection.status !== "AVAILABLE") {
        throw new DomainError(
          "DATABASE_CONTROL_UNAVAILABLE",
          `Database control is not available: ${inspection.reason || "unknown"}`
        );
      }

      const record = inspection.record!;

      if (record.state !== "READY") {
        throw new DomainError(
          "DATABASE_CONTROL_NOT_READY",
          `Database control state is ${record.state}; only READY is allowed`
        );
      }

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
      session = new SqliteBusinessSession(connection, mode, record);

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
          closeError = error instanceof Error ? error : new Error(String(error));
          // If there's a primary error, don't mask it; otherwise report close failure
          if (!primaryError && closeError) {
            throw closeError;
          }
        }
        connection = null;
      }

      nestedSessionStore.delete(this);
    }
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
}
