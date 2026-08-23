import { Database as BunDatabase } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import type { BusinessSession, BusinessSessionMode, BusinessSessionRunner, QueryResult, TableMetadata, ColumnMetadata } from "../../application/ports/persistence.ts";
import { DomainError } from "../../core/types.ts";
import { classifySqliteError, toDomainError } from "../sqlite/error-classifier.ts";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";
import { DatabaseControlService } from "../services/database-control-service.ts";
import { MigrationService, MIGRATION_SCHEMA_SQLITE } from "../services/migration-service.ts";
import { CURRENT_SCHEMA_MANIFEST, type SqliteSchemaManifest } from "../schema/current-manifest.ts";
import { DRIZZLE_GST_HASH, DRIZZLE_GST_MIGRATION_ID, DRIZZLE_MIGRATIONS_TABLE, officialDrizzleJournal } from "../services/drizzle-baseline.ts";

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
  "journal_entries",
  "journal_lines",
  "parties",
  "sales_invoices",
  "sales_invoice_lines",
  "bank_receipts",
  "bank_receipt_allocations",
  "vendor_bills",
  "vendor_bill_lines",
  "vendor_payments",
  "vendor_payment_allocations",
  "bank_statements",
  "bank_statement_lines",
  "bank_matches",
  "party_gst_profiles",
  "gst_tax_snapshots",
  "gst_tax_components",
  "tenant_deductor_profiles",
  "party_tax_profiles",
  "tax_rule_snapshots",
  "withholding_events",
  "withholding_deposits",
  "withholding_deposit_allocations",
  "withholding_compliance_cases",
  "asset_book_policies",
  "fixed_assets",
  "asset_components",
  "asset_depreciation_runs",
  "asset_depreciation_lines",
  "asset_tax_rule_snapshots",
  "asset_tax_blocks",
  "asset_tax_runs",
  "asset_tax_run_lines",
  "asset_disposals",
  "tenant_currencies",
  "fx_rate_snapshots",
  "fx_document_facts",
  "fx_document_line_amounts",
  "fx_allocation_facts",
  "fx_revaluation_policies",
  "fx_revaluation_runs",
  "fx_revaluation_lines",
  "fx_revaluation_reversals",
  "bank_account_currencies",
  "bank_statement_line_currencies",
  "payroll_employees",
  "payroll_employee_profiles",
  "payroll_salary_structures",
  "payroll_salary_versions",
  "payroll_salary_components",
  "payroll_claims",
  "payroll_rule_snapshots",
  "payroll_pay_runs",
  "payroll_pay_run_employees",
  "payroll_component_lines",
  "payroll_payslips",
  "payroll_payment_batches",
  "payroll_payment_allocations",
  "payroll_bank_export_presets",
  "payroll_bank_export_artifacts",
  "payroll_remittances",
  "payroll_remittance_allocations",
  "expense_claimants",
  "expense_claims",
  "expense_claim_lines",
  "expense_advances",
  "expense_advance_allocations",
  "expense_advance_repayments",
  "expense_reimbursements",
  "gst_outward_facts",
  "gst_outward_line_facts",
  "gst_returns",
  "gst_return_snapshots",
  "gst_return_validations",
  "gst_return_exports",
  "gst_return_observations",
]);

const FORBIDDEN_SQL_WORDS = new Set([
  "attach", "detach", "alter", "analyze", "begin", "commit", "create", "delete", "drop", "explain",
  "insert", "pragma", "reindex", "release", "replace", "returning", "rollback", "savepoint", "select",
  "vacuum", "update", "with", "union", "intersect", "except", "from", "join",
]);

const FORBIDDEN_IDENTIFIERS = [
  "sqlite_", "sqlite_master", "sqlite_schema", "database_control", "schema_migrations", "migration_recovery_audit",
];

/**
 * Error indicating business session lock cannot be acquired due to contention.
 * Does not claim knowledge of who holds the lock.
 */
export class BusinessSessionBusyError extends Error {
  readonly code = "BUSINESS_SESSION_BUSY";

  constructor(message: string = "Cannot acquire business session lock; database is busy") {
    super(message);
    this.name = "BUSINESS_SESSION_BUSY";
  }
}

const nestedSessionStore = new AsyncLocalStorage<boolean>();

function invalidSql(message: string): never {
  throw new DomainError("INVALID_SQL", message);
}

function tokenizeSql(sql: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < sql.length) {
    const character = sql[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "'" ) {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === "'" && sql[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (sql[end] === "'") break;
        end += 1;
      }
      if (end >= sql.length) invalidSql("Unterminated string literal is not allowed");
      tokens.push("<string>");
      index = end + 1;
      continue;
    }
    if (character === '"' || character === "`" || character === "[") {
      invalidSql("Quoted identifiers are not allowed");
    }
    if (character === ";" || character === "\0") invalidSql("Multi-statement or invalid SQL is not allowed");
    if (character === "-" && sql[index + 1] === "-") invalidSql("Comments are not allowed");
    if (character === "/" && (sql[index + 1] === "*" || sql[index + 1] === "/")) invalidSql("Comments are not allowed");
    if (character === "*" && sql[index + 1] === "/") invalidSql("Comments are not allowed");
    if (character === "(") tokens.push("(");
    else if (character === ")") tokens.push(")");
    else if (/[A-Za-z_]/.test(character)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end])) end += 1;
      tokens.push(sql.slice(index, end).toLowerCase());
      index = end;
      continue;
    } else {
      tokens.push(character);
    }
    index += 1;
  }
  return tokens;
}

function rejectForbiddenIdentifiers(sql: string): void {
  const lower = sql.toLowerCase();
  for (const identifier of FORBIDDEN_IDENTIFIERS) {
    if (lower.includes(identifier)) invalidSql("Access to control or metadata tables is not allowed");
  }
}

function validateReadSql(sql: string, allowExpressions = false): void {
  if (!sql.trim()) invalidSql("Empty SQL statement is not allowed");
  rejectForbiddenIdentifiers(sql);
  const tokens = tokenizeSql(sql);
  if (tokens[0] !== "select") invalidSql("Only SELECT statements are allowed in read-mode");
  if (!allowExpressions) {
    const hasSubquery = tokens.some((token, index) => token === "(" && tokens[index + 1] === "select");
    const hasUnsupportedExpression = tokens.some((token, index) => token === "(" && !["in", "coalesce", "sum"].includes(tokens[index - 1] ?? ""));
    if (hasSubquery || hasUnsupportedExpression) invalidSql("Subqueries and expression calls are not allowed in read-mode");
  }
  if (tokens.some((token) => FORBIDDEN_SQL_WORDS.has(token) && token !== "select" && token !== "from" && token !== "join")) invalidSql("Unsupported read SQL construct");

  let inTableList = false;
  let expectTable = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "from" || token === "join") {
      inTableList = true;
      expectTable = true;
      continue;
    }
    if (["where", "group", "order", "limit", "offset", "having"].includes(token)) {
      inTableList = false;
      expectTable = false;
      continue;
    }
    if (expectTable) {
      if (!BUSINESS_TABLE_ALLOWLIST.has(token)) invalidSql("Read access is limited to business tables");
      expectTable = false;
      continue;
    }
    if (inTableList && token === ",") expectTable = true;
  }
  if (expectTable) invalidSql("Read access is limited to business tables");
}

function validateWriteSql(sql: string): void {
  if (!sql.trim()) invalidSql("Empty SQL statement is not allowed");
  rejectForbiddenIdentifiers(sql);
  const tokens = tokenizeSql(sql);
  const operation = tokens[0];
  if (operation !== "insert" && operation !== "update" && operation !== "delete") {
    invalidSql("Only INSERT/UPDATE/DELETE statements are allowed in write-mode");
  }
  if (tokens.some((token) => FORBIDDEN_SQL_WORDS.has(token) && ![operation, operation === "delete" ? "from" : ""].includes(token))) {
    invalidSql("Unsupported write SQL construct");
  }

  const targetIndex = operation === "insert" ? 2 : 1;
  if (operation === "insert" && tokens[1] !== "into") invalidSql("INSERT must specify INTO");
  if (operation === "delete" && tokens[1] !== "from") invalidSql("DELETE must specify FROM");
  const target = tokens[targetIndex];
  if (!target || !BUSINESS_TABLE_ALLOWLIST.has(target)) invalidSql("Write access is limited to business tables");
}

function createBusinessSession(db: BunDatabase, mode: BusinessSessionMode): { session: BusinessSession; deactivate: () => void } {
  let active = true;
  let dbRef: BunDatabase | null = db;
  const statements = new Map<string, ReturnType<BunDatabase["prepare"]>>();

  const checkActive = (): void => {
    if (!active || !dbRef) throw new DomainError("BUSINESS_SESSION_INACTIVE", "BusinessSession has been finalized and is no longer active");
  };
  const checkWriteMode = (): void => {
    if (mode === "read") throw new DomainError("BUSINESS_SESSION_READ_ONLY", "Mutation is not allowed in read-mode session");
  };
  const prepare = (sql: string) => {
    checkActive();
    if (!statements.has(sql)) statements.set(sql, dbRef!.prepare(sql));
    return statements.get(sql)!;
  };
  const run = (sql: string, params: unknown[] | undefined, operation: string): QueryResult => {
    try {
      const results = prepare(sql).all(...((params ?? []) as any)) as Record<string, unknown>[];
      return { rows: results, rowCount: results.length };
    } catch (error) {
      throw toDomainError(classifySqliteError(error, operation));
    }
  };
  const get = (sql: string, params: unknown[] | undefined, operation: string): Record<string, unknown> | undefined => {
    try {
      return prepare(sql).get(...((params ?? []) as any)) as Record<string, unknown> | undefined;
    } catch (error) {
      throw toDomainError(classifySqliteError(error, operation));
    }
  };

  const session: BusinessSession = {
    async query(sql, params) {
      checkActive();
      validateReadSql(sql, mode === "write");
      return run(sql, params, "business session query");
    },
    async querySingle(sql, params) {
      checkActive();
      validateReadSql(sql, mode === "write");
      return get(sql, params, "business session querySingle");
    },
    async execute(sql, params) {
      checkActive();
      checkWriteMode();
      validateWriteSql(sql);
      try {
        prepare(sql).run(...((params ?? []) as any));
        return { rows: [], rowCount: 0 };
      } catch (error) {
        throw toDomainError(classifySqliteError(error, "business session execute"));
      }
    },
    async executeSingle(sql, params) {
      checkActive();
      checkWriteMode();
      validateWriteSql(sql);
      return get(sql, params, "business session executeSingle");
    },
    mode() {
      checkActive();
      return mode;
    },
    isActive() {
      return active;
    },
  };

  return {
    session,
    deactivate: () => {
      active = false;
      dbRef = null;
      statements.clear();
    },
  };
}

function normalizeInteger(value: unknown, label: string): number {
  if (typeof value === "bigint" && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", `Database compatibility field ${label} is malformed`);
}

function normalizeDdl(ddl: string): string {
  return ddl.replace(/\bIF\s+NOT\s+EXISTS\b/gi, "").replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
}

function nativeTableMetadata(db: BunDatabase, tableName: string): TableMetadata | null {
  const object = db.prepare("SELECT type, sql FROM sqlite_schema WHERE name = ?").get(tableName) as { type?: string; sql?: string | null } | undefined;
  if (!object) return null;
  const kind = object.type === "view" ? "VIEW" : object.type === "table" ? "TABLE" : undefined;
  if (!kind) throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Database metadata object kind is unsupported");
  const columns = db.prepare(`PRAGMA table_xinfo("${tableName}")`).all() as Array<{
    cid: number | bigint; name: string; type: string; notnull: number | bigint; dflt_value: unknown; pk: number | bigint; hidden: number | bigint;
  }>;
  const normalizedColumns: ColumnMetadata[] = columns.map((column) => ({
    cid: Number(column.cid),
    name: column.name,
    type: column.type,
    nullable: Number(column.notnull) === 0 && Number(column.pk) === 0,
    default: column.dflt_value === null ? null : String(column.dflt_value),
    primaryKey: Number(column.pk) > 0,
    notnull: Number(column.notnull),
    dflt_value: column.dflt_value,
    pk: Number(column.pk),
    hidden: Number(column.hidden),
  }));
  const ddl = object.sql == null ? undefined : String(object.sql);
  const checks = [...(ddl ?? "").matchAll(/CHECK\s*\(((?:[^()]|\([^)]*\))*)\)/gi)].map((match) => match[1].trim());
  return { name: tableName, kind, columns: normalizedColumns, checks, ddl };
}

type GateRecord = {
  readerCompatibilityMin: number;
  readerCompatibilityMax: number;
  requiredWriterProtocol: number;
};

export class SqliteBusinessSessionRunner implements BusinessSessionRunner {
  constructor(
    private dbPath: string,
    private readerProtocol: number,
    private writerProtocol: number,
    private expectedManifest: SqliteSchemaManifest = CURRENT_SCHEMA_MANIFEST,
  ) {
    assertSafeSqlitePath(dbPath);
  }

  async withBusinessSession<T>(mode: BusinessSessionMode, callback: (session: BusinessSession) => Promise<T>): Promise<T> {
    if (nestedSessionStore.getStore()) {
      throw new DomainError("BUSINESS_SESSION_NESTED", "Nested business session detected in same async context; reentrant calls are not allowed");
    }

    return nestedSessionStore.run(true, async () => {
      let connection: BunDatabase | null = null;
      let deactivate: (() => void) | null = null;
      let primaryError: unknown = null;
      try {
        connection = this.openConnection();
        try {
          connection.exec("BEGIN IMMEDIATE");
        } catch (error) {
          const classified = toDomainError(classifySqliteError(error, "BEGIN IMMEDIATE"));
          if (classified.code === "SQLITE_CONTENTION_BUSY" || classified.code === "SQLITE_CONTENTION_LOCKED") {
            throw new BusinessSessionBusyError();
          }
          throw classified;
        }

        const record = this.validateDatabaseControl(connection);
        if (mode === "read") {
          if (this.readerProtocol < record.readerCompatibilityMin || this.readerProtocol > record.readerCompatibilityMax) {
            throw new DomainError("DATABASE_READER_INCOMPATIBLE", "Reader protocol is incompatible");
          }
          try {
            connection.exec("PRAGMA query_only = ON");
          } catch {
            throw new DomainError("DATABASE_QUERY_ONLY_UNAVAILABLE", "Read-only SQLite session could not be enabled");
          }
        } else if (mode === "write" && this.writerProtocol !== record.requiredWriterProtocol) {
          throw new DomainError("DATABASE_WRITER_INCOMPATIBLE", "Writer protocol is incompatible");
        }

        const created = createBusinessSession(connection, mode);
        deactivate = created.deactivate;
        try {
          const result = await callback(created.session);
          try {
            connection.exec("COMMIT");
          } catch (error) {
            primaryError = error;
            throw toDomainError(classifySqliteError(error, "COMMIT"));
          }
          return result;
        } catch (error) {
          primaryError = error;
          throw error;
        }
      } catch (error) {
        if (connection) {
          try {
            connection.exec("ROLLBACK");
          } catch (rollbackError) {
            if (!primaryError) primaryError = rollbackError;
          }
        }
        throw error;
      } finally {
        deactivate?.();
        if (connection) {
          try {
            connection.close();
          } catch (error) {
            if (!primaryError) throw new DomainError("DATABASE_CONNECTION_CLOSE_FAILED", "SQLite connection close failed");
          }
        }
      }
    });
  }

  private openConnection(): BunDatabase {
    try {
      const connection = new BunDatabase(this.dbPath);
      connection.exec("PRAGMA foreign_keys = ON");
      return connection;
    } catch (error) {
      throw toDomainError(classifySqliteError(error, "open connection"));
    }
  }

  private validateDatabaseControl(connection: BunDatabase): GateRecord {
    try {
      const controlMetadata = nativeTableMetadata(connection, "database_control");
      if (!controlMetadata) {
        throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Database control schema is unavailable");
      }
      const drizzleMetadata = nativeTableMetadata(connection, DRIZZLE_MIGRATIONS_TABLE);
      const legacyMetadata = nativeTableMetadata(connection, "schema_migrations");
      if (drizzleMetadata && !legacyMetadata) {
        return this.validateFreshDrizzleDatabase(connection, controlMetadata, drizzleMetadata);
      }
      if (DatabaseControlService.validateDatabaseControlTableSchema(controlMetadata)) {
        throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Database control schema is unavailable");
      }
      const migrationMetadata = nativeTableMetadata(connection, "schema_migrations");
      if (!migrationMetadata || !MigrationService.isCurrentMigrationSchema(migrationMetadata)) {
        throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Migration schema is unavailable");
      }
      if (normalizeDdl(migrationMetadata.ddl ?? "") !== normalizeDdl(MIGRATION_SCHEMA_SQLITE)) {
        throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Migration schema signature is not canonical");
      }

      const controlRows = connection.prepare("SELECT * FROM database_control").all() as Array<Record<string, unknown>>;
      if (controlRows.length !== 1) throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Database control row cardinality is invalid");
      const control = controlRows[0];
      if (normalizeInteger(control.id, "id") !== 1) throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Database control identity is invalid");
      const currentSchemaVersion = normalizeInteger(control.schema_version, "schema_version");
      const currentDataFormatVersion = normalizeInteger(control.data_format_version, "data_format_version");
      if (currentSchemaVersion !== this.expectedManifest.schemaVersion || currentDataFormatVersion !== this.expectedManifest.dataFormatVersion) {
        if (currentSchemaVersion > this.expectedManifest.schemaVersion || currentDataFormatVersion > this.expectedManifest.dataFormatVersion) {
          throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Database schema or data format is newer than this application");
        }
        throw new DomainError("UPDATE_REQUIRED", "Database update is required before business work", {
          currentSchemaVersion,
          requiredSchemaVersion: this.expectedManifest.schemaVersion,
          currentDataFormatVersion,
          requiredDataFormatVersion: this.expectedManifest.dataFormatVersion,
        });
      }
      if (String(control.state) !== "READY") throw new DomainError("DATABASE_CONTROL_NOT_READY", "Database control is not READY");
      if (normalizeInteger(control.generation, "generation") !== this.expectedManifest.generation || normalizeInteger(control.revision, "revision") !== this.expectedManifest.revision) {
        throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Database generation is incompatible");
      }
      if (String(control.last_migration_id) !== this.expectedManifest.migrations.at(-1)!.id || String(control.last_migration_checksum) !== this.expectedManifest.migrations.at(-1)!.checksum) {
        throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Database migration identity is incompatible");
      }

      const migrationRows = connection.prepare("SELECT rowid, id, dialect, checksum, status FROM schema_migrations ORDER BY rowid").all() as Array<Record<string, unknown>>;
      if (migrationRows.length !== this.expectedManifest.migrations.length) throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Migration history cardinality is invalid");
      migrationRows.forEach((row, index) => {
        const expected = this.expectedManifest.migrations[index];
        if (!expected || String(row.id) !== expected.id || String(row.dialect) !== expected.dialect || String(row.checksum) !== expected.checksum || String(row.status) !== expected.status) {
          throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Migration history is not canonical");
        }
      });

      const readerMin = normalizeInteger(control.reader_compatibility_min, "reader_compatibility_min");
      const readerMax = normalizeInteger(control.reader_compatibility_max, "reader_compatibility_max");
      const writer = normalizeInteger(control.required_writer_protocol, "required_writer_protocol");
      if (readerMin !== this.expectedManifest.readerCompatibilityMin || readerMax !== this.expectedManifest.readerCompatibilityMax || writer !== this.expectedManifest.writerProtocol) {
        throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Database protocol metadata is incompatible");
      }
      return { readerCompatibilityMin: readerMin, readerCompatibilityMax: readerMax, requiredWriterProtocol: writer };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Database compatibility validation failed");
    }
  }

  private validateFreshDrizzleDatabase(
    connection: BunDatabase,
    controlMetadata: TableMetadata,
    journalMetadata: TableMetadata,
  ): GateRecord {
    const expectedControlColumns = [
      ["id", "INTEGER", 1, 1],
      ["schema_version", "INTEGER", 1, 0],
      ["data_format_version", "INTEGER", 1, 0],
      ["reader_compatibility_min", "INTEGER", 1, 0],
      ["reader_compatibility_max", "INTEGER", 1, 0],
      ["required_writer_protocol", "INTEGER", 1, 0],
      ["state", "TEXT", 1, 0],
      ["revision", "INTEGER", 1, 0],
      ["generation", "INTEGER", 1, 0],
      ["last_migration_id", "TEXT", 1, 0],
      ["last_migration_checksum", "TEXT", 1, 0],
      ["last_writer_cli_version", "TEXT", 1, 0],
      ["last_writer_build_id", "TEXT", 1, 0],
      ["last_writer_at", "TEXT", 1, 0],
      ["created_at", "TEXT", 1, 0],
      ["updated_at", "TEXT", 1, 0],
      ["recovery_reason", "TEXT", 0, 0],
    ] as const;
    if (controlMetadata.kind !== "TABLE" || controlMetadata.columns.length !== expectedControlColumns.length) {
      throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Fresh Drizzle control schema is unavailable");
    }
    expectedControlColumns.forEach(([name, type, notnull, pk], index) => {
      const actual = controlMetadata.columns[index];
      if (!actual || actual.name !== name || actual.type.toUpperCase() !== type || actual.notnull !== notnull || actual.pk !== pk) {
        throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Fresh Drizzle control schema is not canonical");
      }
    });
    if (journalMetadata.kind !== "TABLE" || journalMetadata.columns.map((column) => column.name).join(",") !== "id,hash,created_at") {
      throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Official Drizzle journal schema is not canonical");
    }

    const controlRows = connection.prepare("SELECT * FROM database_control").all() as Array<Record<string, unknown>>;
    if (controlRows.length !== 1) throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Database control row cardinality is invalid");
    const control = controlRows[0];
    const journalRows = connection.prepare(`SELECT id, hash, created_at FROM ${DRIZZLE_MIGRATIONS_TABLE} ORDER BY created_at ASC, id ASC`).all() as Array<Record<string, unknown>>;
    if (journalRows.length !== officialDrizzleJournal().length) throw new DomainError("UPDATE_REQUIRED", "Database update is required before business work");
    const journal = journalRows.at(-1)!;
    if (String(control.last_migration_id) !== DRIZZLE_GST_MIGRATION_ID
      || String(control.last_migration_checksum) !== String(journal.hash)
      || String(journal.hash) !== DRIZZLE_GST_HASH
      || !/^[0-9a-f]{64}$/.test(String(journal.hash))) {
      throw new DomainError("UPDATE_REQUIRED", "Database update is required before business work");
    }
    const integer = (value: unknown): number => {
      const number = typeof value === "bigint" ? Number(value) : Number(value);
      if (!Number.isSafeInteger(number)) throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Drizzle control integer metadata is malformed");
      return number;
    };
    if (integer(control.id) !== 1 || integer(control.schema_version) !== 8 || integer(control.data_format_version) !== 1
      || integer(control.reader_compatibility_min) !== 1 || integer(control.reader_compatibility_max) !== 1
      || integer(control.required_writer_protocol) !== 1 || integer(control.revision) !== 7 || integer(control.generation) !== 1
      || String(control.state) !== "READY" || control.recovery_reason != null) {
      throw new DomainError("DATABASE_CONTROL_UNAVAILABLE", "Fresh Drizzle control metadata is not ready");
    }
    return { readerCompatibilityMin: 1, readerCompatibilityMax: 1, requiredWriterProtocol: 1 };
  }
}
