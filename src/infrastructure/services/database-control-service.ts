import type { ColumnMetadata, Database, MigrationSession, TableMetadata } from "../../application/ports/persistence.ts";
import type { Dialect } from "../../core/types.ts";
import { DomainError } from "../../core/types.ts";
import { DialectSqlBuilder } from "../sql/dialect-sql-builder.ts";
import { DATABASE_CONTROL_CHECKSUM, DATABASE_CONTROL_TABLE_DDL } from "../schema/database-control-schema.ts";
import { CURRENT_SCHEMA_MANIFEST, V2_SCHEMA_MANIFEST, V3_SCHEMA_MANIFEST, type SqliteSchemaManifest } from "../schema/current-manifest.ts";

/**
 * Database control inspection status.
 */
export type DatabaseControlStatus = "UNINITIALIZED" | "UNAVAILABLE" | "AVAILABLE";

export type DatabaseControlInspectionReason =
  | "TABLE_MISSING"
  | "TABLE_KIND_MISMATCH"
  | "TABLE_COLUMN_COUNT_MISMATCH"
  | "TABLE_COLUMN_MISSING"
  | "TABLE_COLUMN_NAME_MISMATCH"
  | "TABLE_COLUMN_TYPE_MISMATCH"
  | "TABLE_COLUMN_NULLABILITY_MISMATCH"
  | "TABLE_COLUMN_PRIMARY_KEY_MISMATCH"
  | "TABLE_COLUMN_CID_MISMATCH"
  | "TABLE_COLUMN_NOTNULL_FIELD_MISMATCH"
  | "TABLE_COLUMN_PK_FIELD_MISMATCH"
  | "TABLE_COLUMN_HIDDEN_FIELD_MISMATCH"
  | "TABLE_COLUMN_DEFAULT_MISMATCH"
  | "TABLE_DDL_MISMATCH"
  | "MIGRATION_HISTORY_MISMATCH"
  | "TABLE_EMPTY"
  | "ROW_COUNT_MISMATCH"
  | "ROW_DATA_INVALID"
  | "INSPECTION_FAILED";

/**
 * Database control metadata record from database_control table.
 * Represents the complete state when status is AVAILABLE.
 */
export interface DatabaseControlRecord {
  schemaVersion: number;
  dataFormatVersion: number;
  readerCompatibilityMin: number;
  readerCompatibilityMax: number;
  requiredWriterProtocol: number;
  state: "READY" | "APPLYING" | "RECOVERY_REQUIRED";
  revision: number;
  generation: number;
  lastMigrationId: string;
  lastMigrationChecksum: string;
  lastWriterCliVersion: string;
  lastWriterBuildId: string;
  lastWriterAt: string;
  createdAt: string;
  updatedAt: string;
  recoveryReason: string | null;
}

/**
 * Database control inspection result.
 */
export interface DatabaseControlInspection {
  status: DatabaseControlStatus;
  record?: DatabaseControlRecord;
  reason?: DatabaseControlInspectionReason;
}

/**
 * Initialization parameters for database_control.
 */
export interface DatabaseControlInitParams {
  cliVersion: string;
  buildId: string;
  now: Date;
}

/**
 * Reader compatibility check parameters.
 */
export interface DatabaseControlReaderParams {
  readerProtocol: number;
}

/**
 * Writer compatibility check parameters.
 */
export interface DatabaseControlWriterParams {
  writerProtocol: number;
}

/**
 * Database control service: singleton metadata authority for schema versions,
 * compatibility, and database state.
 *
 * Key invariants:
 * - Exactly one row (id=1), enforced via CHECK constraint
 * - Cannot repair or pre-seed; initialize() inserts first row atomically
 * - Binds to exact APPLIED 0002-database-control migration checksum
 * - Never creates/repairs in inspect(); fails closed on malformed state
 */
export class DatabaseControlService {
  constructor(
    private db: Database,
    private dialect: Dialect,
    private expectedManifest?: SqliteSchemaManifest,
  ) {}

  /**
   * Metadata-only inspection: never creates, repairs, or modifies.
   * Returns status and optionally a complete record if AVAILABLE.
   *
   * Status mapping:
   * - UNINITIALIZED: table missing, or exact canonical table with valid history and zero rows
   * - UNAVAILABLE: table present but malformed, invalid data, partial schema,
   *                unexpected row count, unknown state, or mismatch to expected
   *                migration identity/checksum
   * - AVAILABLE: exactly one structurally and semantically valid row exists
   */
  async inspect(): Promise<DatabaseControlInspection> {
    try {
      // Validate sqlite_schema and table_xinfo before reading rows. A malformed
      // empty object is unavailable; emptiness is not an escape hatch.
      const tableMetadata = await this.readDatabaseControlMetadata();
      if (!tableMetadata) return { status: "UNINITIALIZED", reason: "TABLE_MISSING" };
      const schemaError = DatabaseControlService.validateDatabaseControlTableSchema(tableMetadata);
      if (schemaError) return { status: "UNAVAILABLE", reason: schemaError };

      const migrationHistory = await this.db.query(
        "SELECT id, dialect, checksum, status FROM schema_migrations ORDER BY rowid",
      );
      const expectedManifest = this.manifestForHistory(migrationHistory.rows);
      if (!expectedManifest || migrationHistory.rowCount !== expectedManifest.migrations.length || expectedManifest.migrations.some((expected, index) => {
        const actual = migrationHistory.rows[index];
        return !actual || actual.id !== expected.id || actual.dialect !== expected.dialect || actual.checksum !== expected.checksum || actual.status !== expected.status;
      })) {
        return { status: "UNAVAILABLE", reason: "MIGRATION_HISTORY_MISMATCH" };
      }

      // Query the table contents
      const rows = await this.db.query(
        `SELECT id, schema_version, data_format_version, reader_compatibility_min,
                reader_compatibility_max, required_writer_protocol, state, revision,
                generation, last_migration_id, last_migration_checksum,
                last_writer_cli_version, last_writer_build_id, last_writer_at,
                created_at, updated_at, recovery_reason
         FROM database_control`,
        [],
      );

      // Exactly zero rows is UNINITIALIZED
      if (rows.rowCount === 0) {
        return { status: "UNINITIALIZED", reason: "TABLE_EMPTY" };
      }

      // Anything other than exactly one row is UNAVAILABLE
      if (rows.rowCount !== 1) {
        return { status: "UNAVAILABLE", reason: "ROW_COUNT_MISMATCH" };
      }

      const row = rows.rows[0];

      // Validate row structure and parse record
      const validation = this.validateAndParseRecord(row, expectedManifest);
      if (validation.error) {
        return { status: "UNAVAILABLE", reason: "ROW_DATA_INVALID" };
      }

      return { status: "AVAILABLE", record: validation.record };
    } catch (error) {
      // Any database error during inspection means UNAVAILABLE
      return {
        status: "UNAVAILABLE",
        reason: "INSPECTION_FAILED",
      };
    }
  }

  private async readDatabaseControlMetadata(): Promise<TableMetadata | null> {
    const catalog = await this.db.query(
      "SELECT type, sql FROM sqlite_schema WHERE name = 'database_control' AND type IN ('table', 'view')",
    );
    const object = catalog.rows[0];
    if (!object) return null;

    const kind = object.type === "view" ? "VIEW" : object.type === "table" ? "TABLE" : undefined;
    if (!kind) return null;

    const xinfo = await this.db.query("PRAGMA table_xinfo(database_control)");
    const columns: ColumnMetadata[] = xinfo.rows.map((column) => {
      const notnull = Number(column.notnull);
      const pk = Number(column.pk);
      return {
        cid: Number(column.cid),
        name: String(column.name),
        type: String(column.type ?? ""),
        nullable: notnull === 0 && pk === 0,
        default: column.dflt_value === null ? null : String(column.dflt_value),
        primaryKey: pk > 0,
        notnull,
        dflt_value: column.dflt_value ?? null,
        pk,
        hidden: Number(column.hidden),
      };
    });

    return { name: "database_control", kind, columns, checks: [], ddl: object.sql == null ? undefined : String(object.sql) };
  }

  /**
   * An omitted manifest is resolved only from an exact immutable history
   * prefix. There is deliberately no "current" fallback: a v2 database must
   * not be represented as v3 before 0003 has run.
   */
  private manifestForHistory(rows: readonly Record<string, unknown>[]): SqliteSchemaManifest | undefined {
    if (this.expectedManifest) return this.expectedManifest;
    const candidates = [V2_SCHEMA_MANIFEST, V3_SCHEMA_MANIFEST, CURRENT_SCHEMA_MANIFEST];
    return candidates.find((candidate) => rows.length === candidate.migrations.length && candidate.migrations.every((migration, index) => {
      const actual = rows[index];
      return actual?.id === migration.id && actual?.dialect === migration.dialect && actual?.checksum === migration.checksum && actual?.status === migration.status;
    }));
  }

  /**
   * Initialize the database control row under migration lease.
   * Validates the exact 0002 table schema, requires exact 0002 history row status APPLIED
   * with 64-hex checksum, and inserts id=1 from that history checksum.
   *
   * Idempotent: if exact valid row already exists, returns it without rewriting audit fields.
   * Never repairs or overwrites malformed/conflicting state; fails safe.
   *
   * Requires: withMigrationLease callback context.
   */
  async initialize(params: DatabaseControlInitParams, session: MigrationSession): Promise<DatabaseControlRecord> {
    const builder = new DialectSqlBuilder();

    // First, validate the table schema exists and is exactly correct
    const tableMetadata = await session.getTableMetadata("database_control");
    if (!tableMetadata) {
      throw new DomainError("DATABASE_CONTROL_UNINITIALIZED", "Database control table is unavailable");
    }

    // Validate table schema structure
    const schemaError = DatabaseControlService.validateDatabaseControlTableSchema(tableMetadata);
    if (schemaError) {
      throw new DomainError("DATABASE_CONTROL_MALFORMED", "database_control schema is not canonical");
    }

    // Fetch 0002 migration from schema_migrations
    const migrationRecord = await session.executeSingle(
      `SELECT id, checksum, status FROM schema_migrations WHERE id = ${builder.placeholder()}`,
      ["0002-database-control"],
    );

    if (!migrationRecord) {
      throw new DomainError(
        "DATABASE_CONTROL_MISSING_MIGRATION",
        "Required migration history is unavailable",
      );
    }

    if (migrationRecord.status !== "APPLIED") {
      throw new DomainError(
        "DATABASE_CONTROL_MIGRATION_NOT_APPLIED",
        "Required migration history is not applied",
      );
    }

    const migrationChecksum = String(migrationRecord.checksum);
    if (!this.isValidHexChecksum(migrationChecksum)) {
      throw new DomainError(
        "DATABASE_CONTROL_INVALID_CHECKSUM",
        "Required migration history checksum is malformed",
      );
    }

    // Validate migration checksum matches corrected 0002
    if (migrationChecksum !== DATABASE_CONTROL_CHECKSUM) {
      throw new DomainError(
        "DATABASE_CONTROL_CHECKSUM_MISMATCH",
        "Required migration history checksum is not canonical",
      );
    }

    const history = await session.execute("SELECT id, dialect, checksum, status FROM schema_migrations ORDER BY rowid");
    const expectedManifest = this.manifestForHistory(history.rows);
    if (!expectedManifest) {
      throw new DomainError("DATABASE_CONTROL_MIGRATION_NOT_APPLIED", "Applied migration history is not a known production sequence");
    }

    // Check for existing row
    const existingRow = await session.executeSingle(
      `SELECT id, last_migration_checksum
       FROM database_control WHERE id = 1`,
    );

    if (existingRow) {
      // Row exists; validate it matches exactly
      const existingChecksum = String(existingRow.last_migration_checksum);
      if (existingChecksum !== expectedManifest.migrations.at(-1)?.checksum) {
        throw new DomainError(
          "DATABASE_CONTROL_CHECKSUM_MISMATCH",
          "Existing database_control row checksum is not canonical",
        );
      }

      // Return existing row without modification, using only the pinned session.
      const existingRecord = await this.readDatabaseControlRecord(session, expectedManifest);
      if (existingRecord) {
        return existingRecord;
      }

      throw new DomainError(
        "DATABASE_CONTROL_READ_FAILED",
        "Existing database control row is unavailable",
      );
    }

    // Insert new row with initial state
    const now = params.now.toISOString();
    const insertSql = `
      INSERT INTO database_control (
        id, schema_version, data_format_version, reader_compatibility_min,
        reader_compatibility_max, required_writer_protocol, state, revision,
        generation, last_migration_id, last_migration_checksum,
        last_writer_cli_version, last_writer_build_id, last_writer_at,
        created_at, updated_at, recovery_reason
      ) VALUES (${Array.from({ length: 17 }, () => builder.placeholder()).join(", ")})
    `;

    const lastMigration = expectedManifest.migrations.at(-1)!;
    await session.execute(insertSql, [
      1, // id
      expectedManifest.schemaVersion,
      expectedManifest.dataFormatVersion,
      expectedManifest.readerCompatibilityMin,
      expectedManifest.readerCompatibilityMax,
      expectedManifest.writerProtocol,
      "READY", // state
      expectedManifest.revision,
      expectedManifest.generation,
      lastMigration.id, // last_migration_id
      lastMigration.checksum, // last_migration_checksum
      params.cliVersion, // last_writer_cli_version
      params.buildId, // last_writer_build_id
      now, // last_writer_at
      now, // created_at
      now, // updated_at
      null, // recovery_reason
    ]);

    // Read back the inserted row using the same session.
    const readbackRecord = await this.readDatabaseControlRecord(session, expectedManifest);
    if (readbackRecord) {
      return readbackRecord;
    }

    throw new DomainError(
      "DATABASE_CONTROL_INSERT_FAILED",
      "database_control row could not be read after initialization",
    );
  }

  /**
   * Read and validate the complete database_control row through the pinned
   * migration session. Invalid rows are reported to the caller as undefined so
   * the caller can preserve its operation-specific failure code.
   */
  private async readDatabaseControlRecord(
    session: MigrationSession,
    expectedManifest: SqliteSchemaManifest,
  ): Promise<DatabaseControlRecord | undefined> {
    const row = await session.executeSingle(
      `SELECT id, schema_version, data_format_version, reader_compatibility_min,
              reader_compatibility_max, required_writer_protocol, state, revision,
              generation, last_migration_id, last_migration_checksum,
              last_writer_cli_version, last_writer_build_id, last_writer_at,
              created_at, updated_at, recovery_reason
       FROM database_control WHERE id = 1`,
    );

    if (!row) return undefined;
    return this.validateAndParseRecord(row, expectedManifest).record;
  }

  /**
   * Verify reader protocol compatibility.
   * Requires status AVAILABLE + state READY.
   * Reader protocol must be within [readerCompatibilityMin, readerCompatibilityMax] inclusive.
   */
  async requireCompatibleReader(params: DatabaseControlReaderParams): Promise<void> {
    const inspection = await this.inspect();

    if (inspection.status !== "AVAILABLE") {
      throw new DomainError(
        "DATABASE_CONTROL_UNAVAILABLE",
        "Database control is unavailable",
      );
    }

    const record = inspection.record!;

    if (record.state !== "READY") {
      throw new DomainError(
        "DATABASE_CONTROL_NOT_READY",
        "Database control is not ready",
      );
    }

    if (
      params.readerProtocol < record.readerCompatibilityMin ||
      params.readerProtocol > record.readerCompatibilityMax
    ) {
      throw new DomainError(
        "DATABASE_READER_INCOMPATIBLE",
        "Reader protocol is incompatible",
      );
    }
  }

  /**
   * Verify writer protocol compatibility.
   * Requires status AVAILABLE + state READY.
   * Writer protocol must exactly equal requiredWriterProtocol.
   */
  async requireCompatibleWriter(params: DatabaseControlWriterParams): Promise<void> {
    const inspection = await this.inspect();

    if (inspection.status !== "AVAILABLE") {
      throw new DomainError(
        "DATABASE_CONTROL_UNAVAILABLE",
        "Database control is unavailable",
      );
    }

    const record = inspection.record!;

    if (record.state !== "READY") {
      throw new DomainError(
        "DATABASE_CONTROL_NOT_READY",
        "Database control is not ready",
      );
    }

    if (params.writerProtocol !== record.requiredWriterProtocol) {
      throw new DomainError(
        "DATABASE_WRITER_INCOMPATIBLE",
        "Writer protocol is incompatible",
      );
    }
  }

  /**
   * Validate table schema structure against expected database_control schema.
   * Validates exact column count, order, names, types, nullability, and all xinfo fields.
   * Also validates stored DDL against expected canonical SQL (exact match, no formatting tolerance).
   * Returns safe error code (not raw schema values) if invalid, undefined if valid.
   */
  static validateDatabaseControlTableSchema(metadata: TableMetadata): DatabaseControlInspectionReason | undefined {
    // Must be a TABLE, not a VIEW
    if (metadata.kind !== "TABLE") {
      return "TABLE_KIND_MISMATCH";
    }

    // Exact column count: 17 columns
    const actualColumns = metadata.columns || [];
    const EXPECTED_COLUMN_COUNT = 17;

    if (actualColumns.length !== EXPECTED_COLUMN_COUNT) {
      return "TABLE_COLUMN_COUNT_MISMATCH";
    }

    // Validate each column's exact specification
    // Using ColumnMetadata structure with exact xinfo fields
    const expectedSpecs = [
      { cid: 0, name: "id", type: "INTEGER", nullable: false, primaryKey: true, notnull: 0, pk: 1, hidden: 0, dflt_value: null },
      { cid: 1, name: "schema_version", type: "INTEGER", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 2, name: "data_format_version", type: "INTEGER", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 3, name: "reader_compatibility_min", type: "INTEGER", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 4, name: "reader_compatibility_max", type: "INTEGER", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 5, name: "required_writer_protocol", type: "INTEGER", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 6, name: "state", type: "TEXT", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 7, name: "revision", type: "INTEGER", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 8, name: "generation", type: "INTEGER", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 9, name: "last_migration_id", type: "TEXT", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 10, name: "last_migration_checksum", type: "TEXT", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 11, name: "last_writer_cli_version", type: "TEXT", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 12, name: "last_writer_build_id", type: "TEXT", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 13, name: "last_writer_at", type: "TEXT", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 14, name: "created_at", type: "TEXT", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 15, name: "updated_at", type: "TEXT", nullable: false, primaryKey: false, notnull: 1, pk: 0, hidden: 0, dflt_value: null },
      { cid: 16, name: "recovery_reason", type: "TEXT", nullable: true, primaryKey: false, notnull: 0, pk: 0, hidden: 0, dflt_value: null },
    ];

    for (let i = 0; i < expectedSpecs.length; i++) {
      const expected = expectedSpecs[i];
      const actual = actualColumns[i];

      if (!actual) {
        return "TABLE_COLUMN_MISSING";
      }

      if (actual.name !== expected.name) {
        return "TABLE_COLUMN_NAME_MISMATCH";
      }

      const actualType = (actual.type || "").toUpperCase();
      const expectedType = expected.type.toUpperCase();
      if (actualType !== expectedType) {
        return "TABLE_COLUMN_TYPE_MISMATCH";
      }

      if (actual.nullable !== expected.nullable) {
        return "TABLE_COLUMN_NULLABILITY_MISMATCH";
      }

      if (actual.primaryKey !== expected.primaryKey) {
        return "TABLE_COLUMN_PRIMARY_KEY_MISMATCH";
      }

      if (actual.cid !== expected.cid) {
        return "TABLE_COLUMN_CID_MISMATCH";
      }

      // Validate exact xinfo fields (no formatting tolerance)
      if (actual.notnull !== expected.notnull) {
        return "TABLE_COLUMN_NOTNULL_FIELD_MISMATCH";
      }

      if ((actual.pk ?? 0) !== expected.pk) {
        return "TABLE_COLUMN_PK_FIELD_MISMATCH";
      }

      if ((actual.hidden ?? 0) !== expected.hidden) {
        return "TABLE_COLUMN_HIDDEN_FIELD_MISMATCH";
      }

      // Exact dflt_value equality check (null === null)
      if (actual.dflt_value !== expected.dflt_value) {
        return "TABLE_COLUMN_DEFAULT_MISMATCH";
      }
    }

    // Validate exact DDL from sqlite_schema.sql
    // No formatting tolerance: must match canonical DDL exactly
    const storedDdl = metadata.ddl || "";
    if (storedDdl !== DATABASE_CONTROL_TABLE_DDL) {
      return "TABLE_DDL_MISMATCH";
    }

    return undefined;
  }

  /**
   * Validate and parse a row from database_control into a DatabaseControlRecord.
   * Returns either a valid record or an error message.
   */
  private validateAndParseRecord(
    row: Record<string, unknown>,
    expectedManifest: SqliteSchemaManifest = CURRENT_SCHEMA_MANIFEST,
  ): { record?: DatabaseControlRecord; error?: string } {
    try {
      // Validate id is exactly 1
      let id: number;
      try {
        id = this.parseInteger(row.id, "id");
      } catch (e) {
        return { error: `Failed to parse id: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (id !== 1) {
        return { error: `Invalid id: expected 1, got ${id}` };
      }

      // Parse integer fields with strict validation
      let schemaVersion: number;
      try {
        schemaVersion = this.parseInteger(row.schema_version, "schema_version");
      } catch (e) {
        return { error: `Failed to parse schema_version: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (schemaVersion < 1 || schemaVersion !== expectedManifest.schemaVersion) return { error: "schema_version is not canonical" };

      let dataFormatVersion: number;
      try {
        dataFormatVersion = this.parseInteger(row.data_format_version, "data_format_version");
      } catch (e) {
        return { error: `Failed to parse data_format_version: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (dataFormatVersion < 1 || dataFormatVersion !== expectedManifest.dataFormatVersion) return { error: "data_format_version is not canonical" };

      let readerMin: number;
      try {
        readerMin = this.parseInteger(row.reader_compatibility_min, "reader_compatibility_min");
      } catch (e) {
        return { error: `Failed to parse reader_compatibility_min: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (readerMin < 1 || readerMin !== expectedManifest.readerCompatibilityMin) return { error: "reader_compatibility_min is not canonical" };

      let readerMax: number;
      try {
        readerMax = this.parseInteger(row.reader_compatibility_max, "reader_compatibility_max");
      } catch (e) {
        return { error: `Failed to parse reader_compatibility_max: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (readerMax < readerMin || readerMax !== expectedManifest.readerCompatibilityMax) return { error: "reader_compatibility_max is not canonical" };

      let writerProtocol: number;
      try {
        writerProtocol = this.parseInteger(row.required_writer_protocol, "required_writer_protocol");
      } catch (e) {
        return { error: `Failed to parse required_writer_protocol: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (writerProtocol < 1 || writerProtocol !== expectedManifest.writerProtocol) return { error: "required_writer_protocol is not canonical" };

      let revision: number;
      try {
        revision = this.parseInteger(row.revision, "revision");
      } catch (e) {
        return { error: `Failed to parse revision: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (revision < 1 || revision !== expectedManifest.revision) return { error: "revision is not canonical" };

      let generation: number;
      try {
        generation = this.parseInteger(row.generation, "generation");
      } catch (e) {
        return { error: `Failed to parse generation: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (generation < 1 || generation !== expectedManifest.generation) return { error: "generation is not canonical" };

      // Parse state
      const state = String(row.state);
      if (!["READY", "APPLYING", "RECOVERY_REQUIRED"].includes(state)) {
        return { error: `Invalid state: ${state}` };
      }

      // Validate state-specific recovery_reason constraint
      const recoveryReason = row.recovery_reason === null || row.recovery_reason === undefined ? null : String(row.recovery_reason);
      if (state === "RECOVERY_REQUIRED" && !recoveryReason) {
        return { error: "RECOVERY_REQUIRED state requires nonblank recovery_reason" };
      }
      if ((state === "READY" || state === "APPLYING") && recoveryReason) {
        return { error: `${state} state requires NULL recovery_reason` };
      }

      // Parse string fields
      let lastMigrationId: string;
      try {
        lastMigrationId = this.parseNonblankString(row.last_migration_id, "last_migration_id")!;
      } catch (e) {
        return { error: `Failed to parse last_migration_id: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (!lastMigrationId) return { error: "last_migration_id is blank" };
      const expectedMigration = expectedManifest.migrations.at(-1);
      if (!expectedMigration || lastMigrationId !== expectedMigration.id) return { error: "last_migration_id is not canonical" };

      let lastMigrationChecksum: string;
      try {
        lastMigrationChecksum = this.parseNonblankString(row.last_migration_checksum, "last_migration_checksum")!;
      } catch (e) {
        return { error: `Failed to parse last_migration_checksum: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (!lastMigrationChecksum) return { error: "last_migration_checksum is blank" };
      if (!this.isValidHexChecksum(lastMigrationChecksum)) {
        return { error: "last_migration_checksum is not 64 hex characters" };
      }
      if (!expectedMigration || lastMigrationChecksum !== expectedMigration.checksum) {
        return { error: "last_migration_checksum is not canonical" };
      }

      let lastWriterCliVersion: string;
      try {
        lastWriterCliVersion = this.parseNonblankString(row.last_writer_cli_version, "last_writer_cli_version")!;
      } catch (e) {
        return { error: `Failed to parse last_writer_cli_version: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (!lastWriterCliVersion) return { error: "last_writer_cli_version is blank" };

      let lastWriterBuildId: string;
      try {
        lastWriterBuildId = this.parseNonblankString(row.last_writer_build_id, "last_writer_build_id")!;
      } catch (e) {
        return { error: `Failed to parse last_writer_build_id: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (!lastWriterBuildId) return { error: "last_writer_build_id is blank" };

      // Parse and validate timestamp fields (must be valid ISO strings)
      let lastWriterAt: string;
      try {
        lastWriterAt = this.parseTimestamp(row.last_writer_at, "last_writer_at")!;
      } catch (e) {
        return { error: `Failed to parse last_writer_at: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (!lastWriterAt) return { error: "last_writer_at is not a valid ISO timestamp" };

      let createdAt: string;
      try {
        createdAt = this.parseTimestamp(row.created_at, "created_at")!;
      } catch (e) {
        return { error: `Failed to parse created_at: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (!createdAt) return { error: "created_at is not a valid ISO timestamp" };

      let updatedAt: string;
      try {
        updatedAt = this.parseTimestamp(row.updated_at, "updated_at")!;
      } catch (e) {
        return { error: `Failed to parse updated_at: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (!updatedAt) return { error: "updated_at is not a valid ISO timestamp" };

      return {
        record: {
          schemaVersion,
          dataFormatVersion,
          readerCompatibilityMin: readerMin,
          readerCompatibilityMax: readerMax,
          requiredWriterProtocol: writerProtocol,
          state: state as "READY" | "APPLYING" | "RECOVERY_REQUIRED",
          revision,
          generation,
          lastMigrationId,
          lastMigrationChecksum,
          lastWriterCliVersion,
          lastWriterBuildId,
          lastWriterAt,
          createdAt,
          updatedAt,
          recoveryReason,
        },
      };
    } catch (error) {
      return {
        error: `Row validation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private parseInteger(value: unknown, fieldName: string): number {
    if (typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value)) {
      return value;
    }
    if (typeof value === "bigint") {
      if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
        return Number(value);
      }
    }
    if (typeof value === "string") {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed) && String(parsed) === value && Number.isSafeInteger(parsed)) {
        return parsed;
      }
    }
    throw new Error(`${fieldName} is not a valid integer`);
  }

  private parseNonblankString(value: unknown, fieldName: string): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.length > 0) return value;
    throw new Error(`${fieldName} is not a nonblank string`);
  }

  private parseTimestamp(value: unknown, fieldName: string): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.length > 0) {
      // Must parse as ISO and re-stringify to validate canonical format.
      const date = new Date(value);
      if (!Number.isNaN(date.getTime()) && date.toISOString() === value) {
        return value;
      }
    }
    throw new Error(`${fieldName} is not a valid canonical UTC ISO string: ${String(value)}`);
  }

  private isValidHexChecksum(value: string): boolean {
    return value.length === 64 && /^[0-9a-f]{64}$/.test(value);
  }
}
