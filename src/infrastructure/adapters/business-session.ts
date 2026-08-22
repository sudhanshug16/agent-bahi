import { Database as BunDatabase } from "bun:sqlite";
import type { BusinessSession, BusinessSessionMode, QueryResult } from "../../application/ports/persistence.ts";
import { DomainError } from "../../core/types.ts";
import { classifySqliteError, toDomainError } from "../sqlite/error-classifier.ts";

/**
 * Business table allowlist: explicit set of tables callbacks are permitted to access.
 */
const BUSINESS_TABLE_ALLOWLIST = new Set([
  "tenants",
  "book_sets",
  "accounts",
  "legal_identities",
  "gst_registrations",
  "evidence",
  "audit_records",
  "idempotency_records",
  "tenant_creation_requests",
]);

/**
 * SQL validator: fail-closed policy for read and write modes.
 */
class SQLValidator {
  /**
   * Validate read-mode SQL: accept only required single SELECT statements.
   * Reject comments (anywhere), semicolons/stacking, PRAGMA, WITH, DDL, DML,
   * and sensitive sqlite/control/migration table access.
   */
  static validateReadSQL(sql: string): void {
    const trimmed = sql.trim();

    if (!trimmed) {
      throw new DomainError("INVALID_SQL", "Empty SQL statement is not allowed");
    }

    // Reject any comments (leading or inline)
    if (trimmed.includes("--") || trimmed.includes("/*") || trimmed.includes("*/")) {
      throw new DomainError("INVALID_SQL", "Comments are not allowed");
    }

    // Reject semicolons (no stacking/multi-statements)
    if (trimmed.includes(";")) {
      throw new DomainError("INVALID_SQL", "Multi-statement SQL is not allowed");
    }

    // Reject PRAGMA
    if (/^\s*PRAGMA\s+/i.test(trimmed)) {
      throw new DomainError("INVALID_SQL", "PRAGMA statements are not allowed");
    }

    // Reject WITH (even if followed by SELECT)
    if (/^\s*WITH\s+/i.test(trimmed)) {
      throw new DomainError("INVALID_SQL", "WITH statements are not allowed in read-mode");
    }

    // Reject DDL/DML
    if (/^\s*(CREATE|DROP|ALTER|REPLACE|INSERT|UPDATE|DELETE)\s+/i.test(trimmed)) {
      throw new DomainError("INVALID_SQL", "DDL/DML statements are not allowed in read-mode");
    }

    // Must be SELECT
    if (!/^\s*SELECT\s+/i.test(trimmed)) {
      throw new DomainError("INVALID_SQL", "Only SELECT statements are allowed in read-mode");
    }

    // Check for sensitive table access (sqlite_*, database_control, schema_migrations)
    const lowerSQL = sql.toLowerCase();
    if (
      lowerSQL.includes("sqlite_") ||
      lowerSQL.includes("database_control") ||
      lowerSQL.includes("schema_migrations")
    ) {
      throw new DomainError("INVALID_SQL", "Access to system/control tables is not allowed");
    }
  }

  /**
   * Validate write-mode SQL: accept only single INSERT/UPDATE/DELETE on business tables.
   * Reject comments, semicolons, WITH, PRAGMA, DDL, and metadata table access.
   */
  static validateWriteSQL(sql: string): void {
    const trimmed = sql.trim();

    if (!trimmed) {
      throw new DomainError("INVALID_SQL", "Empty SQL statement is not allowed");
    }

    // Reject any comments
    if (trimmed.includes("--") || trimmed.includes("/*") || trimmed.includes("*/")) {
      throw new DomainError("INVALID_SQL", "Comments are not allowed");
    }

    // Reject semicolons (no stacking)
    if (trimmed.includes(";")) {
      throw new DomainError("INVALID_SQL", "Multi-statement SQL is not allowed");
    }

    // Reject PRAGMA
    if (/^\s*PRAGMA\s+/i.test(trimmed)) {
      throw new DomainError("INVALID_SQL", "PRAGMA statements are not allowed");
    }

    // Reject WITH
    if (/^\s*WITH\s+/i.test(trimmed)) {
      throw new DomainError("INVALID_SQL", "WITH statements are not allowed in write-mode");
    }

    // Reject DDL
    if (/^\s*(CREATE|DROP|ALTER|REPLACE)\s+/i.test(trimmed)) {
      throw new DomainError("INVALID_SQL", "DDL statements are not allowed");
    }

    // Must be DML: INSERT, UPDATE, or DELETE
    if (!/^\s*(INSERT|UPDATE|DELETE)\s+/i.test(trimmed)) {
      throw new DomainError("INVALID_SQL", "Only INSERT/UPDATE/DELETE statements are allowed in write-mode");
    }

    // Extract table name from DML statement (rough check)
    const tableMatch = trimmed.match(/^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i);
    if (!tableMatch) {
      throw new DomainError("INVALID_SQL", "Cannot determine target table");
    }

    const tableName = tableMatch[2];
    if (!BUSINESS_TABLE_ALLOWLIST.has(tableName)) {
      throw new DomainError(
        "INVALID_SQL",
        `Table '${tableName}' is not allowed; access to system/control tables is not permitted`
      );
    }

    // Check for sensitive table access (sqlite_*, database_control, schema_migrations)
    const lowerSQL = sql.toLowerCase();
    if (
      lowerSQL.includes("sqlite_") ||
      lowerSQL.includes("database_control") ||
      lowerSQL.includes("schema_migrations")
    ) {
      throw new DomainError("INVALID_SQL", "Access to system/control tables is not allowed");
    }
  }
}

/**
 * Concrete SQLite BusinessSession implementation.
 * Lifetime-bound to callback scope with active flag enforcement.
 * All methods check active flag; becomes inactive after finally completes.
 * Never expose outside callback or capture for later use.
 *
 * Read-mode: fail-closed validation accepts only required single SELECT statements.
 * Write-mode: fail-closed validation accepts only single INSERT/UPDATE/DELETE on business tables.
 * Both modes reject comments, semicolons, PRAGMA, WITH, DDL, and metadata/control table access.
 */
export class SqliteBusinessSession implements BusinessSession {
  private active = true;
  private statements = new Map<string, ReturnType<BunDatabase["prepare"]>>();
  private dbRef: BunDatabase | null;

  constructor(
    private db: BunDatabase,
    private sessionMode: BusinessSessionMode,
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
    SQLValidator.validateReadSQL(sql);
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
    SQLValidator.validateReadSQL(sql);
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
    SQLValidator.validateWriteSQL(sql);
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
    SQLValidator.validateWriteSQL(sql);
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
}
