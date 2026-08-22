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

  private prepareStatement(sql: string) {
    if (!this.dbRef) throw new DomainError("BUSINESS_SESSION_INACTIVE", "Database connection lost");
    if (!this.statements.has(sql)) {
      this.statements.set(sql, this.dbRef.prepare(sql));
    }
    return this.statements.get(sql)!;
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    this.checkActive();
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
