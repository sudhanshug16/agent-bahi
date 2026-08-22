import { createHash } from "crypto";
import { randomUUID } from "crypto";
import type { Database, MigrationRecord, MigrationSession, TableMetadata } from "../../application/ports/persistence.ts";
import type { Dialect } from "../../core/types.ts";
import { DomainError, MigrationLockedError, MigrationChecksumError, DirtyMigrationError } from "../../core/types.ts";
import { DialectSqlBuilder } from "../sql/dialect-sql-builder.ts";

export { DialectSqlBuilder } from "../sql/dialect-sql-builder.ts";

/**
 * Migration schema for SQLite.
 * Explicit status: APPLYING (in-progress), APPLIED (success), DIRTY (failed).
 * lease_token used for ownership validation during recovery.
 */
const MIGRATION_SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT NOT NULL PRIMARY KEY,
  dialect TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
  executed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  dirty_reason TEXT,
  lease_token TEXT,
  manifest_version INTEGER,
  verification_manifest_hash TEXT,
  manifest_json TEXT
);
`;

/**
 * Audit trail for recovery operations (immutable append-only).
 * reason is NOT NULL; triggers prevent UPDATE/DELETE.
 */
const RECOVERY_AUDIT_SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS migration_recovery_audit (
  id TEXT PRIMARY KEY,
  migration_id TEXT NOT NULL,
  recovery_at TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  expected_status TEXT NOT NULL,
  expected_checksum TEXT NOT NULL,
  expected_dirty_reason_state TEXT NOT NULL CHECK (expected_dirty_reason_state IN ('NONE', 'PRESENT')),
  expected_dirty_reason TEXT,
  actual_status TEXT NOT NULL,
  actual_checksum TEXT NOT NULL,
  actual_dirty_reason_state TEXT NOT NULL CHECK (actual_dirty_reason_state IN ('NONE', 'PRESENT')),
  actual_dirty_reason TEXT,
  verification_manifest_hash TEXT,
  manifest_version INTEGER,
  probe_results_json TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('PASS', 'FAIL')),
  success BOOLEAN NOT NULL,
  FOREIGN KEY (migration_id) REFERENCES schema_migrations(id)
);

CREATE TRIGGER IF NOT EXISTS migration_recovery_audit_no_update BEFORE UPDATE ON migration_recovery_audit
BEGIN
  SELECT RAISE(ABORT, 'migration_recovery_audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS migration_recovery_audit_no_delete BEFORE DELETE ON migration_recovery_audit
BEGIN
  SELECT RAISE(ABORT, 'migration_recovery_audit is append-only');
END;
`;

/**
 * Migration recovery request: parameters for recoverDirty.
 * Validates exact expected state (id + dialect + checksum + status + dirty_reason).
 * expectedDirtyReason: null matches NULL in DB, string matches exact string.
 */
export interface MigrationVerificationProbe {
  id: string;
  sql: string;
  expectedRows: readonly Record<string, unknown>[];
}

export interface MigrationVerificationManifest {
  version: number;
  dialect: Dialect;
  probes: readonly MigrationVerificationProbe[];
  retrySafe: boolean;
}

export interface MigrationDefinition {
  id: string;
  sql: string;
  manifest?: MigrationVerificationManifest;
}

export interface MigrationRecoveryRequest {
  migrationId: string;
  expectedDialect: Dialect;
  expectedStatus: "DIRTY" | "APPLYING";
  expectedChecksum: string;
  expectedDirtyReason: string | null; // null = DB NULL, string = exact match
  actor: string;
  reason: string; // Operator's reason for recovery (appended to audit)
  definition: MigrationDefinition;
}

type DirtyReasonState = "NONE" | "PRESENT";
type LegacySchemaType = "gate0" | "dirty_flag" | "strict_status_lease" | "nullable_status";

interface SchemaColumnSpec {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

const CURRENT_COLUMN_NAMES = [
  "id", "dialect", "checksum", "status", "executed_at", "duration_ms",
  "dirty_reason", "lease_token", "manifest_version", "verification_manifest_hash", "manifest_json",
] as const;

const INTERNAL_CONTROL_IDENTIFIERS = /^(?:schema_migrations|schema_migrations_stage_[a-f0-9_]+)$/;

function dirtyReasonState(value: string | null): DirtyReasonState {
  return value === null ? "NONE" : "PRESENT";
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalRows(rows: readonly Record<string, unknown>[]): string[] {
  return rows.map((row) => canonicalJson(row)).sort();
}

function canonicalManifest(manifest: MigrationVerificationManifest): MigrationVerificationManifest {
  return {
    version: manifest.version,
    dialect: manifest.dialect,
    retrySafe: manifest.retrySafe,
    probes: [...manifest.probes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((probe) => ({ id: probe.id, sql: probe.sql.trim(), expectedRows: canonicalRows(probe.expectedRows).map((row) => JSON.parse(row) as Record<string, unknown>) })),
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function hashRows(rows: readonly Record<string, unknown>[]): string {
  return hashCanonical(canonicalRows(rows));
}

function manifestHash(manifest: MigrationVerificationManifest): string {
  return hashCanonical(canonicalManifest(manifest));
}

function validateManifest(manifest: MigrationVerificationManifest, dialect: Dialect): void {
  if (manifest.version !== 1 || manifest.dialect !== dialect || manifest.probes.length === 0) {
    throw new DomainError("MIGRATION_MANIFEST_INVALID", "Migration verification manifest is incomplete or uses the wrong dialect");
  }
  const ids = new Set<string>();
  for (const probe of manifest.probes) {
    if (!probe.id || ids.has(probe.id) || !/^SELECT\b/i.test(probe.sql.trim()) || probe.sql.includes(";")) {
      throw new DomainError("MIGRATION_MANIFEST_INVALID", "Migration verification probes must have unique IDs and be single read-only SELECT statements");
    }
    ids.add(probe.id);
  }
}

function parseManifest(value: unknown): MigrationVerificationManifest | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") return null;
    const candidate = parsed as { version?: unknown; dialect?: unknown; probes?: unknown; retrySafe?: unknown };
    if (candidate.version !== 1 || candidate.dialect !== "sqlite" || !Array.isArray(candidate.probes) || typeof candidate.retrySafe !== "boolean") return null;
    const probes: MigrationVerificationProbe[] = [];
    const ids = new Set<string>();
    for (const probe of candidate.probes) {
      if (probe === null || typeof probe !== "object") return null;
      const item = probe as { id?: unknown; sql?: unknown; expectedRows?: unknown };
      if (typeof item.id !== "string" || item.id.length === 0 || ids.has(item.id) || typeof item.sql !== "string" || !/^SELECT\b/i.test(item.sql.trim()) || item.sql.includes(";") || !Array.isArray(item.expectedRows)) return null;
      if (item.expectedRows.some((row) => row === null || typeof row !== "object" || Array.isArray(row))) return null;
      ids.add(item.id);
      probes.push({ id: item.id, sql: item.sql, expectedRows: item.expectedRows as Record<string, unknown>[] });
    }
    return { version: 1, dialect: "sqlite", probes, retrySafe: candidate.retrySafe };
  } catch {
    return null;
  }
}

/**
 * Internal: tagged failure result to persist DIRTY outside savepoint.
 * Returned from callback to indicate DDL failure that needs DIRTY marker persisted.
 */
interface MigrationFailureResult {
  _isFailure: true;
  migrationId: string;
  errorMessage: string;
}

/**
 * Core migration service.
 * Manages schema versions, compatibility, and DDL execution within migration lease.
 * All work must happen via withMigrationLease callback; never holds separate locks.
 *
 * Key semantic: DIRTY markers persist by returning failure result (not throwing),
 * so the outer transaction commits with DIRTY in place.
 * Control tables created on active session (inside lease), never via raw Database.
 */
export class MigrationService {
  constructor(
    private db: Database,
    private dialect: Dialect,
  ) {}

  /**
   * Upgrade legacy schema_migrations to current schema.
   * Acquires migration lease BEFORE any probe; delegates to private helper.
   * Idempotent: detects schema type and applies upgrade only if needed.
   */
  async upgradeControlSchema(timeoutMs: number = 30000): Promise<void> {
    await this.db.withMigrationLease(
      async (session: MigrationSession) => {
        await this.upgradeControlSchemaOnSession(session);
      },
      timeoutMs,
    );
  }

  /**
   * Private helper for schema upgrade, called within migration lease.
   * Detects legacy schema type, validates data, and upgrades to current schema.
   * All operations use session (pinned connection), never raw db.*.
   * Empty legacy tables are upgraded; unknown/hybrid/view/malformed schemas fail unchanged.
   */
  private async upgradeControlSchemaOnSession(session: MigrationSession): Promise<void> {
    try {
      const metadata = await session.getTableMetadata("schema_migrations");

      // Table doesn't exist yet; will be created on first migrate()
      if (metadata === null) return;

      this.rejectNonTable(metadata);

      // If already in current format (has 11 required columns), validate and no-op
      if (this.isCurrentSchema(metadata)) {
        this.validateCurrentSchema(metadata);
        return;
      }

      // Detect legacy schema type using exact equality
      const schemaType = this.detectLegacySchemaType(metadata);

      // Unknown/hybrid/malformed schemas fail closed, leave table unchanged
      if (!schemaType) this.throwUnknownSchema();

      const canonicalRows = await this.extractCanonicalRows(session, "schema_migrations", schemaType);

      // Create staging table with current schema
      const stagingTable = `schema_migrations_stage_${randomUUID().replace(/-/g, "_")}`;
      await this.createStagingTable(session, stagingTable);

      // Copy canonical rows to staging
      await this.copyCanonicalRows(session, stagingTable, canonicalRows);

      // Validate staging has exact rows
      await this.validateRowCount(session, stagingTable, canonicalRows.length);
      await this.validateExactRows(session, stagingTable, canonicalRows);

      await session.executeRaw(`DROP TABLE ${this.quoteIdentifier("schema_migrations")}`);
      await session.executeRaw(`ALTER TABLE ${this.quoteIdentifier(stagingTable)} RENAME TO ${this.quoteIdentifier("schema_migrations")}`);

      // Validate schema and rows after swap
      const finalMetadata = await session.getTableMetadata("schema_migrations");
      if (finalMetadata === null) {
        throw new DomainError(
          "CONTROL_SCHEMA_UPGRADE_FAILED",
          "schema_migrations table missing after upgrade"
        );
      }

      if (!this.isCurrentSchema(finalMetadata)) {
        throw new DomainError(
          "CONTROL_SCHEMA_UPGRADE_FAILED",
          "schema_migrations table has incorrect schema after upgrade"
        );
      }

      this.validateCurrentSchema(finalMetadata);
      await this.validateExactRows(session, "schema_migrations", canonicalRows);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "CONTROL_SCHEMA_UPGRADE_FAILED",
        `Failed to upgrade control schema: ${error instanceof Error ? error.message : String(error)}`,
        { dialect: this.dialect }
      );
    }
  }

  private rejectNonTable(metadata: TableMetadata): void {
    if (metadata.kind !== "TABLE") {
      throw new DomainError("CONTROL_SCHEMA_UPGRADE_FAILED", `schema_migrations must be a BASE TABLE, not ${metadata.kind}`);
    }
  }

  private throwUnknownSchema(): never {
    throw new DomainError("CONTROL_SCHEMA_UPGRADE_FAILED", "schema_migrations table has unknown/hybrid/partial schema that cannot be safely upgraded; no mutation performed");
  }

  private quoteIdentifier(identifier: string): string {
    if (!INTERNAL_CONTROL_IDENTIFIERS.test(identifier)) {
      throw new DomainError("CONTROL_SCHEMA_UPGRADE_FAILED", "Internal schema-upgrade identifier is not allowlisted");
    }
    return `"${identifier}"`;
  }

  private normalizeColumnType(rawType: string): string {
    const type = rawType.trim().toLowerCase().replace(/\s+/g, " ");
    return type;
  }

  private columnSpecs(kind: "current" | LegacySchemaType): SchemaColumnSpec[] {
    const text = "text";
    const checksum = "text";
    const executedAt = "text";
    const lease = "text";
    const manifestHash = "text";
    const integer = "integer";
    const common: SchemaColumnSpec[] = [
      { name: "id", type: text, nullable: false, primaryKey: true },
      { name: "dialect", type: text, nullable: false, primaryKey: false },
      { name: "checksum", type: checksum, nullable: false, primaryKey: false },
    ];
    if (kind === "current") return [
      ...common,
      { name: "status", type: text, nullable: false, primaryKey: false },
      { name: "executed_at", type: executedAt, nullable: false, primaryKey: false },
      { name: "duration_ms", type: integer, nullable: false, primaryKey: false },
      { name: "dirty_reason", type: "text", nullable: true, primaryKey: false },
      { name: "lease_token", type: lease, nullable: true, primaryKey: false },
      { name: "manifest_version", type: integer, nullable: true, primaryKey: false },
      { name: "verification_manifest_hash", type: manifestHash, nullable: true, primaryKey: false },
      { name: "manifest_json", type: "text", nullable: true, primaryKey: false },
    ];
    if (kind === "gate0") return [
      { name: "logical_id", type: text, nullable: false, primaryKey: true },
      { name: "checksum", type: checksum, nullable: false, primaryKey: false },
      { name: "applied_at", type: executedAt, nullable: false, primaryKey: false },
    ];
    const status = text;
    const duration = { name: "duration_ms", type: integer, nullable: false, primaryKey: false };
    if (kind === "dirty_flag") return [...common,
      { name: "executed_at", type: executedAt, nullable: false, primaryKey: false }, duration,
      { name: "dirty", type: integer, nullable: false, primaryKey: false },
      { name: "dirty_reason", type: "text", nullable: true, primaryKey: false }];
    if (kind === "strict_status_lease") return [...common,
      { name: "status", type: status, nullable: false, primaryKey: false },
      { name: "executed_at", type: executedAt, nullable: false, primaryKey: false }, duration,
      { name: "lease_token", type: lease, nullable: true, primaryKey: false }];
    return [...common,
      { name: "status", type: status, nullable: true, primaryKey: false },
      { name: "executed_at", type: executedAt, nullable: false, primaryKey: false }, duration];
  }

  private metadataMatches(metadata: TableMetadata, specs: SchemaColumnSpec[]): boolean {
    if (metadata.kind !== "TABLE" || metadata.columns.length !== specs.length) return false;
    return metadata.columns.every((column, index) => {
      const expected = specs[index];
      const defaultValue = column.default === undefined || column.default === null ? null : column.default.trim();
      return column.name === expected.name && this.normalizeColumnType(column.type) === expected.type
        && column.nullable === expected.nullable && column.primaryKey === expected.primaryKey && defaultValue === null;
    });
  }

  private hasRequiredStatusCheck(metadata: TableMetadata): boolean {
    return (metadata.checks ?? []).some((check) => {
      const expression = check.toLowerCase().replace(/::[a-z0-9_]+/g, "").replace(/\s+/g, " ");
      const values = [...expression.matchAll(/[\'\"](applying|applied|dirty)[\'\"]/g)].map((match) => match[1]);
      return [...new Set(values)].sort().join(",") === "applied,applying,dirty"
        && expression.includes("status") && (expression.includes(" in ") || expression.includes("any") || expression.includes("array"))
        && !expression.includes(" or ") && !expression.includes(" not ") && !expression.includes("<>") && !expression.includes("!=");
    });
  }

  private isCurrentSchema(metadata: TableMetadata): boolean {
    return this.metadataMatches(metadata, this.columnSpecs("current")) && this.hasRequiredStatusCheck(metadata);
  }

  private validateCurrentSchema(metadata: TableMetadata): void {
    if (!this.isCurrentSchema(metadata)) {
      throw new DomainError(
        "CONTROL_SCHEMA_UPGRADE_FAILED",
        "schema_migrations current schema is malformed (kind, ordered columns, types, nullability, defaults, primary key, or status CHECK)",
      );
    }
  }

  private detectLegacySchemaType(metadata: TableMetadata): LegacySchemaType | null {
    const candidates: LegacySchemaType[] = ["gate0", "dirty_flag", "strict_status_lease", "nullable_status"];
    return candidates.find((candidate) => this.metadataMatches(metadata, this.columnSpecs(candidate))) ?? null;
  }

  private async extractCanonicalRows(
    session: MigrationSession,
    tableName: string,
    schemaType: LegacySchemaType,
  ): Promise<Array<Record<string, unknown>>> {
    const rows = (await session.execute(`SELECT * FROM ${this.quoteIdentifier(tableName)}`)).rows;

    // Transform legacy rows to canonical format based on schema type
    return rows.map(row => {
      const canonical: Record<string, unknown> = {};

      // Helper to preserve string values exactly; never invent empty strings
      const asString = (value: unknown): string => {
        if (typeof value === "string" && value.length > 0) return value;
        throw new DomainError("CONTROL_SCHEMA_UPGRADE_FAILED", "Cannot upgrade row with missing or non-string required field");
      };

      // Helper to preserve exact integer values as BigInt (prevent Number precision loss)
      const asBigInt = (value: unknown): bigint => {
        if (value === null || value === undefined) {
          throw new DomainError(
            "CONTROL_SCHEMA_UPGRADE_FAILED",
            "Cannot upgrade row with missing required numeric field"
          );
        }
        if (typeof value === "bigint") return value;
        if (typeof value === "number") {
          if (!Number.isFinite(value)) {
            throw new DomainError(
              "CONTROL_SCHEMA_UPGRADE_FAILED",
              `Cannot upgrade row with non-finite numeric value ${value}`
            );
          }
          if (!Number.isInteger(value)) {
            throw new DomainError(
              "CONTROL_SCHEMA_UPGRADE_FAILED",
              `Cannot upgrade row with non-integer numeric value ${value}`
            );
          }
          if (!Number.isSafeInteger(value)) {
            throw new DomainError(
              "CONTROL_SCHEMA_UPGRADE_FAILED",
              `Cannot upgrade unsafe integer value ${value}; refusing lossy coercion`,
            );
          }
          return BigInt(value);
        }
        if (typeof value === "string" && /^-?(?:0|[1-9]\d*)$/.test(value)) return BigInt(value);
        throw new DomainError("CONTROL_SCHEMA_UPGRADE_FAILED", "Cannot upgrade non-integer numeric value without loss");
      };

      // Helper to handle nullable string fields (preserve null or exact value)
      const asNullableString = (value: unknown): string | null => {
        if (value === null || value === undefined) return null;
        if (typeof value === "string") return value;
        throw new DomainError("CONTROL_SCHEMA_UPGRADE_FAILED", "Cannot upgrade non-string nullable field without loss");
      };

      // Helper to validate exact enum values
      const asStatus = (value: unknown): string => {
        if (value === "APPLIED" || value === "APPLYING" || value === "DIRTY") return value;
        if (value === null || value === undefined) {
          throw new DomainError(
            "CONTROL_SCHEMA_UPGRADE_FAILED",
            "Cannot upgrade row with NULL status in legacy schema"
          );
        }
        throw new DomainError(
          "CONTROL_SCHEMA_UPGRADE_FAILED",
          `Cannot upgrade row with invalid status value ${value}`
        );
      };

      switch (schemaType) {
        case "gate0":
          // Gate0 requires: logical_id, checksum, applied_at
          canonical.id = asString(row.logical_id);
          canonical.dialect = this.dialect;
          canonical.checksum = asString(row.checksum);
          canonical.status = "APPLIED";
          canonical.executed_at = asString(row.applied_at);
          canonical.duration_ms = BigInt(0);
          canonical.dirty_reason = null;
          canonical.lease_token = null;
          canonical.manifest_version = null;
          canonical.verification_manifest_hash = null;
          canonical.manifest_json = null;
          break;

        case "dirty_flag":
          // Dirty flag requires: id, dialect, checksum, executed_at, duration_ms, dirty, dirty_reason
          canonical.id = asString(row.id);
          canonical.dialect = asString(row.dialect);
          canonical.checksum = asString(row.checksum);
          // Exact dirty=0 -> APPLIED, dirty=1 -> DIRTY (only these exact values)
          const dirtyVal = asBigInt(row.dirty);
          if (dirtyVal !== BigInt(0) && dirtyVal !== BigInt(1)) {
            throw new DomainError(
              "CONTROL_SCHEMA_UPGRADE_FAILED",
              `Cannot upgrade row with invalid dirty value ${dirtyVal}; must be 0 or 1`
            );
          }
          canonical.status = dirtyVal === BigInt(1) ? "DIRTY" : "APPLIED";
          canonical.executed_at = asString(row.executed_at);
          canonical.duration_ms = asBigInt(row.duration_ms);
          canonical.dirty_reason = dirtyVal === BigInt(1) ? asNullableString(row.dirty_reason) : null;
          canonical.lease_token = null;
          canonical.manifest_version = null;
          canonical.verification_manifest_hash = null;
          canonical.manifest_json = null;
          break;

        case "strict_status_lease":
          // Strict status + lease: preserve every value exactly
          canonical.id = asString(row.id);
          canonical.dialect = asString(row.dialect);
          canonical.checksum = asString(row.checksum);
          canonical.status = asStatus(row.status);
          canonical.executed_at = asString(row.executed_at);
          canonical.duration_ms = asBigInt(row.duration_ms);
          canonical.dirty_reason = null; // Not present in this schema
          canonical.lease_token = asNullableString(row.lease_token);
          canonical.manifest_version = null;
          canonical.verification_manifest_hash = null;
          canonical.manifest_json = null;
          break;

        case "strict_status_lease":
          // Strict status + lease: preserve every value exactly
          canonical.id = asString(row.id);
          canonical.dialect = asString(row.dialect);
          canonical.checksum = asString(row.checksum);
          canonical.status = asStatus(row.status);
          canonical.executed_at = asString(row.executed_at);
          canonical.duration_ms = asBigInt(row.duration_ms);
          canonical.dirty_reason = null; // Not present in this schema
          canonical.lease_token = asNullableString(row.lease_token);
          canonical.manifest_version = null;
          canonical.verification_manifest_hash = null;
          canonical.manifest_json = null;
          break;

        case "nullable_status":
          // Nullable status: preserve valid APPLIED/APPLYING/DIRTY; fail closed on NULL/unknown
          canonical.id = asString(row.id);
          canonical.dialect = asString(row.dialect);
          canonical.checksum = asString(row.checksum);
          const statusVal = row.status;
          // Only preserve valid enum values
          if (statusVal === "APPLIED" || statusVal === "APPLYING" || statusVal === "DIRTY") {
            canonical.status = statusVal;
            canonical.dirty_reason = null;
          } else {
            // NULL, unknown, or invalid status: fail closed
            throw new DomainError(
              "CONTROL_SCHEMA_UPGRADE_FAILED",
              `Cannot upgrade row with NULL or invalid status value ${statusVal}; must be APPLIED, APPLYING, or DIRTY`
            );
          }
          canonical.executed_at = asString(row.executed_at);
          canonical.duration_ms = asBigInt(row.duration_ms);
          canonical.lease_token = null;
          canonical.manifest_version = null;
          canonical.verification_manifest_hash = null;
          canonical.manifest_json = null;
          break;

        default:
          throw new DomainError(
            "CONTROL_SCHEMA_UPGRADE_FAILED",
            `Unknown schema type ${schemaType}`
          );
      }

      return canonical;
    });
  }

  private async createStagingTable(session: MigrationSession, stagingTable: string): Promise<void> {
    const quotedStagingTable = this.quoteIdentifier(stagingTable);
    await session.executeRaw(`
      CREATE TABLE ${quotedStagingTable} (
        id TEXT NOT NULL PRIMARY KEY,
        dialect TEXT NOT NULL,
        checksum TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
        executed_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        dirty_reason TEXT,
        lease_token TEXT,
        manifest_version INTEGER,
        verification_manifest_hash TEXT,
        manifest_json TEXT
      )
    `);
  }

  private async copyCanonicalRows(
    session: MigrationSession,
    stagingTable: string,
    rows: Array<Record<string, unknown>>
  ): Promise<void> {
    if (rows.length === 0) return;

    const builder = new DialectSqlBuilder();
    const colNames = ["id", "dialect", "checksum", "status", "executed_at", "duration_ms",
                      "dirty_reason", "lease_token", "manifest_version", "verification_manifest_hash", "manifest_json"];

    for (const row of rows) {
      const placeholders = colNames.map(() => builder.placeholder()).join(", ");
      const sql = `INSERT INTO ${this.quoteIdentifier(stagingTable)} (${colNames.join(", ")}) VALUES (${placeholders})`;
      const values = colNames.map(col => row[col]);
      await session.execute(sql, values);
    }
  }

  private async validateRowCount(session: MigrationSession, tableName: string, expectedCount: number): Promise<void> {
    const result = (await session.execute(`SELECT COUNT(*) as count FROM ${this.quoteIdentifier(tableName)}`)).rows[0];
    const actualCount = this.exactInteger((result as any)?.count, "row count");
    if (actualCount !== BigInt(expectedCount)) {
      throw new DomainError(
        "CONTROL_SCHEMA_UPGRADE_FAILED",
        `Row count mismatch: expected ${expectedCount}, got ${actualCount.toString()}`
      );
    }
  }

  private async validateExactRows(
    session: MigrationSession,
    tableName: string,
    expectedRows: Array<Record<string, unknown>>
  ): Promise<void> {
    const actualRows = (await session.execute(`SELECT * FROM ${this.quoteIdentifier(tableName)}`)).rows;

    if (actualRows.length !== expectedRows.length) {
      throw new DomainError(
        "CONTROL_SCHEMA_UPGRADE_FAILED",
        `Row count validation failed: expected ${expectedRows.length}, got ${actualRows.length}`
      );
    }

    const expectedById = new Map(expectedRows.map((row) => [row.id as string, canonicalJson(this.normalizeCanonicalRow(row))]));
    const actualById = new Map(actualRows.map((row) => [row.id as string, canonicalJson(this.normalizeCanonicalRow(row))]));
    if (expectedById.size !== expectedRows.length || actualById.size !== actualRows.length) {
      throw new DomainError("CONTROL_SCHEMA_UPGRADE_FAILED", "Duplicate or missing migration IDs during exact row validation");
    }

    for (const [actualId, actualJson] of actualById) {
      const expectedJson = expectedById.get(actualId);

      if (!expectedJson) {
        throw new DomainError(
          "CONTROL_SCHEMA_UPGRADE_FAILED",
          `Row ${actualId} not found in expected rows`
        );
      }

      if (actualJson !== expectedJson) {
        throw new DomainError(
          "CONTROL_SCHEMA_UPGRADE_FAILED",
          `Row ${actualId} mismatch: expected ${expectedJson}, got ${actualJson}`
        );
      }
    }
  }


  private exactInteger(value: unknown, label: string): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^-?(?:0|[1-9]\d*)$/.test(value)) return BigInt(value);
    throw new DomainError("CONTROL_SCHEMA_UPGRADE_FAILED", `Cannot compare ${label} without lossless integer normalization`);
  }

  private normalizeCanonicalRow(row: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    for (const name of CURRENT_COLUMN_NAMES) {
      const value = row[name];
      if (name === "duration_ms" || name === "manifest_version") {
        normalized[name] = value === null || value === undefined ? null : this.exactInteger(value, name);
      } else {
        normalized[name] = value;
      }
    }
    return normalized;
  }

  /**
   * Ensure migration tracking tables exist on active session.
   * Called inside lease to avoid concurrent DDL.
   * Must be called before any migration work.
   * Idempotent: safe to call multiple times.
   */
  private async ensureMigrationTableOnSession(session: MigrationSession): Promise<void> {
    try {
      await session.executeRaw(MIGRATION_SCHEMA_SQLITE);

      // Also ensure immutable audit table
      await session.executeRaw(RECOVERY_AUDIT_SCHEMA_SQLITE);
    } catch (error) {
      // Ignore "already exists" errors as tables may have been created by prior run
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes("already exists")) {
        throw new DomainError(
          "MIGRATION_TABLE_SETUP_FAILED",
          `Failed to set up migration tracking table: ${errorMsg}`,
        );
      }
    }
  }

  /**
   * Get current schema status without lease (read-only inspection).
   * Scans entire catalog; reports ALL blocking APPLYING/DIRTY rows with dialect mismatch check.
   * Fails if any row has wrong dialect.
   */
  async getStatus(): Promise<{
    hasSchema: boolean;
    lastMigrationId?: string;
    isDirty: boolean;
    isApplying: boolean;
    appliedMigrations: MigrationRecord[];
    dialect: string;
    blockingRows?: Array<{ id: string; status: string; dialect: string }>;
  }> {
    try {
      const migrations = await this.db.query(
        "SELECT id, dialect, checksum, status, executed_at, duration_ms FROM schema_migrations ORDER BY executed_at ASC",
        [],
      );

      const appliedMigrations: MigrationRecord[] = [];
      const blockingRows: Array<{ id: string; status: string; dialect: string }> = [];
      let isDirty = false;
      let isApplying = false;

      for (const row of migrations.rows) {
        const rowDialect = row.dialect as string;
        const rowId = row.id as string;
        const rowStatus = row.status as string;

        // Check for dialect mismatch
        if (rowDialect !== this.dialect) {
          throw new DomainError(
            "MIGRATION_DIALECT_MISMATCH",
            `Migration ${rowId} has dialect ${rowDialect}, expected ${this.dialect}`,
            { migrationId: rowId, expectedDialect: this.dialect, actualDialect: rowDialect }
          );
        }

        // Collect blocking rows (APPLYING or DIRTY)
        if (rowStatus === "APPLYING" || rowStatus === "DIRTY") {
          blockingRows.push({
            id: rowId,
            status: rowStatus,
            dialect: rowDialect,
          });
          if (rowStatus === "DIRTY") isDirty = true;
          if (rowStatus === "APPLYING") isApplying = true;
        }

        appliedMigrations.push({
          id: rowId,
          dialect: rowDialect,
          checksum: row.checksum as string,
          executedAt: row.executed_at as string,
          durationMs: row.duration_ms as number,
        });
      }

      return {
        hasSchema: appliedMigrations.length > 0,
        lastMigrationId: appliedMigrations[appliedMigrations.length - 1]?.id,
        isDirty,
        isApplying,
        appliedMigrations,
        dialect: this.dialect,
        blockingRows: blockingRows.length > 0 ? blockingRows : undefined,
      };
    } catch (error) {
      // Only an explicitly classified missing control table means an uninitialized DB.
      if (!(error instanceof DomainError) || error.code !== "CONTROL_TABLE_MISSING") throw error;
      return {
        hasSchema: false,
        isDirty: false,
        isApplying: false,
        appliedMigrations: [],
        dialect: this.dialect,
      };
    }
  }

  /**
   * Apply pending migrations atomically within exclusive lease.
   * Returns applied migrations; throws on checksum mismatch, dirty state, or DDL failure.
   *
   * Key semantic: DDL failure persists DIRTY marker and throws after lease commits.
   * SQLite: SAVEPOINT around DDL only; APPLYING inserted before savepoint.
   */
  async migrate(
    migrations: readonly MigrationDefinition[],
    timeoutMs: number = 30000,
  ): Promise<MigrationRecord[]> {
    const appliedMigrations: MigrationRecord[] = [];
    const state: { failureResult: MigrationFailureResult | null } = { failureResult: null };

    await this.db.withMigrationLease<void>(
      async (session: MigrationSession) => {
        // First upgrade legacy schema if needed, then ensure current schema
        await this.upgradeControlSchemaOnSession(session);
        await this.ensureMigrationTableOnSession(session);

        // Preflight: fail if ANY migration is APPLYING or DIRTY (requires recovery first)
        const blockingMigration = await session.executeSingle(
          "SELECT id, status FROM schema_migrations WHERE status IN ('APPLYING', 'DIRTY') LIMIT 1",
        );

        if (blockingMigration) {
          throw new DirtyMigrationError(blockingMigration.id as string);
        }

        for (const migration of migrations) {
          const builder = new DialectSqlBuilder();

          // Check if already applied
          const existingSql = `SELECT id, checksum, status FROM schema_migrations WHERE id = ${builder.placeholder()}`;
          const existing = await session.executeSingle(existingSql, [migration.id]);

          if (existing) {
            // Verify checksum (fail if tampering detected)
            const expectedChecksum = this.computeChecksum(migration.sql);
            if (existing.checksum !== expectedChecksum) {
              throw new MigrationChecksumError(
                migration.id,
                expectedChecksum,
                existing.checksum as string,
              );
            }

            // Fail if migration is stuck APPLYING or DIRTY (requires manual recovery)
            if (existing.status === "APPLYING") {
              throw new DirtyMigrationError(migration.id);
            }
            if (existing.status === "DIRTY") {
              throw new DirtyMigrationError(migration.id);
            }

            // Already applied (status=APPLIED), skip
            continue;
          }

          // New migration: mark APPLYING before DDL.
          const timestamp = new Date().toISOString();
          const checksum = this.computeChecksum(migration.sql);
          const leaseToken = session.leaseToken();
          if (migration.manifest) validateManifest(migration.manifest, this.dialect);
          const manifestJson = migration.manifest ? canonicalJson(canonicalManifest(migration.manifest)) : null;
          const manifestVersion = migration.manifest?.version ?? null;
          const verificationManifestHash = migration.manifest ? manifestHash(migration.manifest) : null;

          const insertSql = `INSERT INTO schema_migrations (id, dialect, checksum, status, executed_at, duration_ms, lease_token, manifest_version, verification_manifest_hash, manifest_json) VALUES (${Array.from({ length: 10 }, () => builder.placeholder()).join(", ")})`;
          await session.execute(insertSql, [
            migration.id,
            this.dialect,
            checksum,
            "APPLYING",
            timestamp,
            0,
            leaseToken,
            manifestVersion,
            verificationManifestHash,
            manifestJson,
          ]);

          const startTime = Date.now();
          try {
            const savepointName = `sp_${migration.id.replace(/[^a-z0-9_]/gi, "_")}`;
            await session.executeRaw(`SAVEPOINT ${savepointName}`);

            try {
              await session.executeRaw(migration.sql);
              await session.executeRaw(`RELEASE SAVEPOINT ${savepointName}`);
            } catch (ddlError) {
              // Rollback savepoint; APPLYING row persists outside savepoint
              try {
                await session.executeRaw(`ROLLBACK TO SAVEPOINT ${savepointName}`);
              } catch {
                // Savepoint already released
              }
              throw ddlError;
            }

            // Mark APPLIED (atomic with transaction commit)
            const durationMs = Date.now() - startTime;
            const updateSql = `UPDATE schema_migrations SET status = ${builder.placeholder()}, duration_ms = ${builder.placeholder()} WHERE id = ${builder.placeholder()}`;
            await session.execute(updateSql, ["APPLIED", durationMs, migration.id]);

            appliedMigrations.push({
              id: migration.id,
              dialect: this.dialect,
              checksum,
              executedAt: timestamp,
              durationMs,
            });
          } catch (error) {
            // Mark DIRTY for manual recovery (persists via return instead of throw)
            const errorMsg = error instanceof Error ? error.message : String(error);
            const dirtySql = `UPDATE schema_migrations SET status = ${builder.placeholder()}, dirty_reason = ${builder.placeholder()} WHERE id = ${builder.placeholder()}`;
            await session.execute(dirtySql, ["DIRTY", `DDL failed: ${errorMsg}`, migration.id]);

            // Store failure result; callback doesn't throw, so transaction commits DIRTY marker
            state.failureResult = {
              _isFailure: true,
              migrationId: migration.id,
              errorMessage: errorMsg,
            };
            return;
          }
        }
      },
      timeoutMs,
    );

    // After lease commits: if DDL failed, throw the typed error
    if (state.failureResult) {
      throw new DomainError(
        "MIGRATION_EXECUTION_FAILED",
        `Migration ${state.failureResult.migrationId} failed: ${state.failureResult.errorMessage}`,
      );
    }

    return appliedMigrations;
  }

  /**
   * Recover a DIRTY migration with lease held and owner/checksum validation.
   * Acquires lease internally; validates exact expected state; appends immutable audit.
   * CAS: verifies id + dialect + checksum + status + dirty_reason all match before recovery.
   * expectedDirtyReason: null matches DB NULL, string matches exact value.
   */
  async recoverDirty(request: MigrationRecoveryRequest, timeoutMs: number = 30000): Promise<void> {
    const outcome: { error: DomainError | null } = { error: null };
    await this.db.withMigrationLease<void>(
      async (session: MigrationSession) => {
        // First upgrade legacy schema if needed, then ensure current schema
        await this.upgradeControlSchemaOnSession(session);
        await this.ensureMigrationTableOnSession(session);

        const leaseToken = session.leaseToken();
        const auditId = randomUUID();
        const builder = new DialectSqlBuilder();
        const fetchSql = `SELECT id, dialect, checksum, status, dirty_reason, manifest_version, verification_manifest_hash, manifest_json FROM schema_migrations WHERE id = ${builder.placeholder()}`;
        const record = await session.executeSingle(fetchSql, [request.migrationId]);
        if (!record) throw new DomainError("RECOVERY_RECORD_NOT_FOUND", `Migration ${request.migrationId} not found`);

        const actualDialect = String(record.dialect);
        const actualStatus = String(record.status);
        const actualChecksum = String(record.checksum);
        const actualDirtyReason = (record.dirty_reason as string | null | undefined) ?? null;
        const expectedState = dirtyReasonState(request.expectedDirtyReason);
        const actualState = dirtyReasonState(actualDirtyReason);
        const storedManifestVersion = typeof record.manifest_version === "number" ? record.manifest_version : (record.manifest_version === null || record.manifest_version === undefined ? null : Number(record.manifest_version));
        const storedManifestHash = typeof record.verification_manifest_hash === "string" ? record.verification_manifest_hash : null;
        const probeResults: Array<Record<string, unknown>> = [];

        const appendAudit = async (success: boolean, verificationStatus: "PASS" | "FAIL"): Promise<void> => {
          const auditBuilder = new DialectSqlBuilder();
          const auditSql = `INSERT INTO migration_recovery_audit (id, migration_id, recovery_at, lease_token, actor, reason, expected_status, expected_checksum, expected_dirty_reason_state, expected_dirty_reason, actual_status, actual_checksum, actual_dirty_reason_state, actual_dirty_reason, verification_manifest_hash, manifest_version, probe_results_json, verification_status, success)
             VALUES (${Array.from({ length: 19 }, () => auditBuilder.placeholder()).join(", ")})`;
          await session.execute(auditSql, [
            auditId,
            request.migrationId,
            new Date().toISOString(),
            leaseToken,
            request.actor,
            request.reason,
            request.expectedStatus,
            request.expectedChecksum,
            expectedState,
            request.expectedDirtyReason,
            actualStatus,
            actualChecksum,
            actualState,
            actualDirtyReason,
            storedManifestHash,
            storedManifestVersion === null ? null : (typeof storedManifestVersion === "number" && Number.isFinite(storedManifestVersion) ? storedManifestVersion : null),
            canonicalJson(probeResults),
            verificationStatus,
            success ? 1 : 0,
          ]);
        };

        const fail = async (error: DomainError): Promise<void> => {
          outcome.error = error;
          await appendAudit(false, "FAIL");
        };

        if (actualDialect !== request.expectedDialect) {
          await fail(new DomainError("RECOVERY_DIALECT_MISMATCH", "Recovery dialect does not match stored migration"));
          return;
        }
        if (actualStatus !== request.expectedStatus) {
          await fail(new DomainError("RECOVERY_STATE_MISMATCH", "Recovery status does not match stored migration"));
          return;
        }
        if (actualChecksum !== request.expectedChecksum) {
          await fail(new DomainError("RECOVERY_CHECKSUM_MISMATCH", "Recovery checksum does not match stored migration"));
          return;
        }
        if (actualDirtyReason !== request.expectedDirtyReason) {
          await fail(new DomainError("RECOVERY_DIRTY_REASON_MISMATCH", "Recovery dirty-reason state does not match stored migration"));
          return;
        }
        const definition = request.definition;
        if (!definition || definition.id !== request.migrationId || this.computeChecksum(definition.sql) !== actualChecksum || !definition.manifest) {
          await fail(new DomainError("RECOVERY_VERIFICATION_REQUIRED", "Recovery requires a complete dialect-specific verification manifest"));
          return;
        }
        try {
          validateManifest(definition.manifest, this.dialect);
        } catch {
          await fail(new DomainError("RECOVERY_VERIFICATION_REQUIRED", "Recovery requires a complete dialect-specific verification manifest"));
          return;
        }
        if (storedManifestHash === null || storedManifestVersion !== definition.manifest.version || storedManifestHash !== manifestHash(definition.manifest)) {
          await fail(new DomainError("RECOVERY_VERIFICATION_REQUIRED", "Recovery definition does not match the persisted verification manifest"));
          return;
        }
        const persistedManifest = parseManifest(record.manifest_json);
        if (!persistedManifest || manifestHash(persistedManifest) !== storedManifestHash) {
          await fail(new DomainError("RECOVERY_VERIFICATION_REQUIRED", "Persisted verification manifest is unavailable or corrupted"));
          return;
        }

        for (const probe of definition.manifest.probes) {
          const normalizedSql = probe.sql.trim();
          if (!/^SELECT\b/i.test(normalizedSql) || normalizedSql.includes(";")) {
            await fail(new DomainError("RECOVERY_VERIFICATION_REQUIRED", "Recovery probes must be deterministic read-only SELECT statements"));
            return;
          }
          const queryHash = hashCanonical(normalizedSql);
          const expectedResultHash = hashRows(probe.expectedRows);
          let result: { rows: Record<string, unknown>[] };
          try {
            result = await session.execute(normalizedSql);
          } catch {
            await fail(new DomainError("RECOVERY_PROBE_MISMATCH", `Recovery probe ${probe.id} could not be evaluated`));
            return;
          }
          const actualResultHash = hashRows(result.rows);
          probeResults.push({ id: probe.id, queryHash, expectedResultHash, actualResultHash, pass: actualResultHash === expectedResultHash });
          if (actualResultHash !== expectedResultHash) {
            await fail(new DomainError("RECOVERY_PROBE_MISMATCH", `Recovery probe ${probe.id} did not match its canonical expected result`));
            return;
          }
        }

        const updateSql = `UPDATE schema_migrations SET status = ${builder.placeholder()}, dirty_reason = NULL, lease_token = ${builder.placeholder()} WHERE id = ${builder.placeholder()} AND dialect = ${builder.placeholder()} AND status = ${builder.placeholder()} AND checksum = ${builder.placeholder()} AND dirty_reason ${request.expectedDirtyReason === null ? "IS NULL" : `= ${builder.placeholder()}`}`;
        const updateParams: unknown[] = ["APPLIED", leaseToken, request.migrationId, request.expectedDialect, request.expectedStatus, request.expectedChecksum];
        if (request.expectedDirtyReason !== null) updateParams.push(request.expectedDirtyReason);
        const updateResult = await session.execute(updateSql, updateParams);
        let updatedRows = updateResult.rowCount;
        if (updatedRows === 0) {
          const changeRow = await session.executeSingle("SELECT changes() AS row_count");
          updatedRows = Number(changeRow?.row_count ?? 0);
        }
        if (updatedRows !== 1) {
          await fail(new DomainError("RECOVERY_CAS_FAILED", "Recovery compare-and-set did not update exactly one row"));
          return;
        }
        await appendAudit(true, "PASS");
      },
      timeoutMs,
    );
    if (outcome.error) throw outcome.error;
  }

  /**
   * Verify checksum of an already-applied migration (read-only, no lease needed).
   * Fails if migration not found, dialect mismatch, or checksum mismatch.
   */
  async verifyChecksum(migrationId: string, expectedChecksum: string): Promise<void> {
    const builder = new DialectSqlBuilder();
    const record = await this.db.querySingle(
      `SELECT dialect, checksum FROM schema_migrations WHERE id = ${builder.placeholder()}`,
      [migrationId],
    );

    if (!record) {
      return; // Migration not applied yet, nothing to verify
    }

    const actualDialect = record.dialect as string;
    const actualChecksum = record.checksum as string;

    // Check dialect matches
    if (actualDialect !== this.dialect) {
      throw new DomainError(
        "MIGRATION_DIALECT_MISMATCH",
        `Migration ${migrationId} has dialect ${actualDialect}, expected ${this.dialect}`,
        { migrationId, expectedDialect: this.dialect, actualDialect }
      );
    }

    // Check checksum matches
    if (actualChecksum !== expectedChecksum) {
      throw new MigrationChecksumError(migrationId, expectedChecksum, actualChecksum);
    }
  }

  private computeChecksum(sql: string): string {
    return createHash("sha256").update(sql).digest("hex");
  }
}
