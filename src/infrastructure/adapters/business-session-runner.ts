import { Database as BunDatabase } from "bun:sqlite";
import type { BusinessSession, BusinessSessionMode, BusinessSessionRunner } from "../../application/ports/persistence.ts";
import type { DatabaseControlService } from "../services/database-control-service.ts";
import { SqliteBusinessSession } from "./business-session.ts";
import { DomainError, MigrationLockedError } from "../../core/types.ts";
import { classifySqliteError, toDomainError } from "../sqlite/error-classifier.ts";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";

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
  private migrationLockedError = false;

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
    const connection = this.openConnection();
    let session: SqliteBusinessSession | null = null;

    try {
      // Step 1: BEGIN IMMEDIATE (serializes all business sessions and migrations)
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

      // Step 2: Validate database_control within the pinned transaction
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

      // Step 3: Validate protocol compatibility based on mode
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

      // Step 4: Create session and invoke callback
      session = new SqliteBusinessSession(connection, mode, record);

      const result = await callback(session);

      // Step 5: Commit on success
      try {
        connection.exec("COMMIT");
      } catch (error) {
        const classified = classifySqliteError(error, "COMMIT");
        throw toDomainError(classified);
      }

      return result;
    } catch (error) {
      // Step 5b: Rollback on error
      try {
        connection.exec("ROLLBACK");
      } catch (rollbackError) {
        // Log but don't mask the original error
        console.error("ROLLBACK failed:", rollbackError);
      }

      throw error;
    } finally {
      // Step 6: Mark session inactive and close connection
      if (session) {
        session.markInactive();
      }

      try {
        connection.close();
      } catch (closeError) {
        // Log but don't mask prior errors
        console.error("Connection close failed:", closeError);
      }
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
