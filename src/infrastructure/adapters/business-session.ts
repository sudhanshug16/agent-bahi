import { Database as BunDatabase } from "bun:sqlite";
import type { BusinessSession, BusinessSessionMode, QueryResult } from "../../application/ports/persistence.ts";
import type { DatabaseControlRecord } from "../services/database-control-service.ts";
import { DomainError } from "../../core/types.ts";
import { classifySqliteError, toDomainError } from "../sqlite/error-classifier.ts";

/**
 * Concrete SQLite BusinessSession implementation.
 * Lifetime-bound to callback scope with active flag enforcement.
 * All methods check active flag; becomes inactive after finally completes.
 * Never expose outside callback or capture for later use.
 *
 * Read-mode validation: rejects PRAGMA, DDL, DML, writable WITH, leading comments,
 * and multi-statement SQL before execution. Does not expose raw Database, native
 * handle, commit, rollback, or close.
 */
export class SqliteBusinessSession implements BusinessSession {
  private active = true;
  private statements = new Map<string, ReturnType<BunDatabase["prepare"]>>();
  private dbRef: BunDatabase | null;

  constructor(
    private db: BunDatabase,
    private sessionMode: BusinessSessionMode,
    private controlRecord: DatabaseControlRecord,
  ) {
    this.dbRef = db;
  }

  private checkActive(): void {
    if (!this.active) {
      throw new DomainError(
        "BUSINESS_SESSION_INACTIVE",
        "BusinessSession has been finalized and is no longer active"
      );
    }
  }

  private checkWriteMode(): void {
    if (this.sessionMode === "read") {
      throw new DomainError(
        "BUSINESS_SESSION_READ_ONLY",
        "Mutation is not allowed in read-mode session"
      );
    }
  }

  private validateReadModeSQL(sql: string): void {
    if (this.sessionMode !== "read") {
      return;
    }

    const trimmed = sql.trim();
    if (!trimmed) {
      throw new DomainError(
        "INVALID_SQL",
        "Empty SQL statement is not allowed"
      );
    }

    // Reject leading comments (-- or /* */)
    if (trimmed.startsWith("--") || trimmed.startsWith("/*")) {
      throw new DomainError(
        "INVALID_SQL",
        "SQL with leading comments is not allowed in read-mode"
      );
    }

    // Reject PRAGMA statements
    if (/^\s*PRAGMA\s+/i.test(trimmed)) {
      throw new DomainError(
        "INVALID_SQL",
        "PRAGMA statements are not allowed in read-mode"
      );
    }

    // Reject DDL keywords (CREATE, DROP, ALTER, REPLACE)
    if (/^\s*(CREATE|DROP|ALTER|REPLACE)\s+/i.test(trimmed)) {
      throw new DomainError(
        "INVALID_SQL",
        "DDL statements are not allowed in read-mode"
      );
    }

    // Reject DML keywords (INSERT, UPDATE, DELETE, WITH writable)
    if (/^\s*(INSERT|UPDATE|DELETE)\s+/i.test(trimmed)) {
      throw new DomainError(
        "INVALID_SQL",
        "DML statements are not allowed in read-mode"
      );
    }

    // Reject writable WITH (common table expressions with INSERT/UPDATE/DELETE)
    if (/^\s*WITH\s+/i.test(trimmed) && /\s+(INSERT|UPDATE|DELETE)\s+/i.test(trimmed)) {
      throw new DomainError(
        "INVALID_SQL",
        "Writable WITH statements are not allowed in read-mode"
      );
    }

    // Reject multi-statement SQL (detect semicolon followed by non-whitespace or comment)
    const parts = trimmed.split(";");
    if (parts.length > 1) {
      const afterSemicolon = parts.slice(1).join(";").trim();
      if (afterSemicolon && !afterSemicolon.startsWith("--") && !afterSemicolon.startsWith("/*")) {
        throw new DomainError(
          "INVALID_SQL",
          "Multi-statement SQL is not allowed in read-mode"
        );
      }
    }

    // Ensure statement starts with SELECT or WITH (read-only)
    if (!/^\s*(SELECT|WITH)\s+/i.test(trimmed)) {
      throw new DomainError(
        "INVALID_SQL",
        "Only SELECT and WITH statements are allowed in read-mode"
      );
    }
  }

  private prepareStatement(sql: string) {
    if (!this.dbRef) throw new DomainError("BUSINESS_SESSION_INACTIVE", "Database connection lost");
    if (!this.statements.has(sql)) {
      this.statements.set(sql, this.dbRef.prepare(sql));
    }
    return this.statements.get(sql)!;
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    this.checkActive();
    this.validateReadModeSQL(sql);
    try {
      const stmt = this.prepareStatement(sql);
      const results = stmt.all(...((params || []) as any)) as Record<string, unknown>[];
      return {
        rows: results,
        rowCount: results.length,
      };
    } catch (error) {
      const classified = classifySqliteError(error, "business session query");
      throw toDomainError(classified);
    }
  }

  async querySingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    this.checkActive();
    this.validateReadModeSQL(sql);
    try {
      const stmt = this.prepareStatement(sql);
      return stmt.get(...((params || []) as any)) as Record<string, unknown> | undefined;
    } catch (error) {
      const classified = classifySqliteError(error, "business session querySingle");
      throw toDomainError(classified);
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    this.checkActive();
    this.checkWriteMode();
    try {
      const stmt = this.prepareStatement(sql);
      stmt.run(...((params || []) as any));
      return { rows: [], rowCount: 0 };
    } catch (error) {
      const classified = classifySqliteError(error, "business session execute");
      throw toDomainError(classified);
    }
  }

  async executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    this.checkActive();
    this.checkWriteMode();
    try {
      const stmt = this.prepareStatement(sql);
      return stmt.get(...((params || []) as any)) as Record<string, unknown> | undefined;
    } catch (error) {
      const classified = classifySqliteError(error, "business session executeSingle");
      throw toDomainError(classified);
    }
  }

  mode(): BusinessSessionMode {
    this.checkActive();
    return this.sessionMode;
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * Mark session as inactive (called from runner finally block).
   * After this, all methods throw BUSINESS_SESSION_INACTIVE.
   */
  markInactive(): void {
    this.active = false;
    this.dbRef = null;
    this.statements.clear();
  }

  /**
   * Get the underlying BunDatabase for finalization (commit/rollback).
   * Only called by the runner during cleanup; not exposed through BusinessSession interface.
   */
  getDatabase(): BunDatabase {
    return this.db;
  }

  /**
   * Get control record for protocol validation (read from runner).
   */
  getControlRecord(): DatabaseControlRecord {
    return this.controlRecord;
  }
}
