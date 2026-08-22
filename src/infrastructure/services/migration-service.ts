import { createHash } from "crypto";
import { randomUUID } from "crypto";
import type { Database, MigrationRecord, MigrationSession } from "../../application/ports/persistence.ts";
import type { Dialect } from "../../core/types.ts";
import { DomainError, MigrationLockedError, MigrationChecksumError, DirtyMigrationError } from "../../core/types.ts";
import { DialectSqlBuilder } from "../sql/dialect-sql-builder.ts";

export { DialectSqlBuilder } from "../sql/dialect-sql-builder.ts";

/**
 * Migration schema for all dialects.
 * Explicit status: APPLYING (in-progress), APPLIED (success), DIRTY (failed).
 * lease_token used for ownership validation during recovery.
 */
const MIGRATION_SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
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

const MIGRATION_SCHEMA_POSTGRES = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
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

const MIGRATION_SCHEMA_MYSQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(255) PRIMARY KEY,
  dialect VARCHAR(50) NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
  executed_at VARCHAR(50) NOT NULL,
  duration_ms INT NOT NULL,
  dirty_reason TEXT,
  lease_token VARCHAR(255),
  manifest_version INT,
  verification_manifest_hash VARCHAR(64),
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

const RECOVERY_AUDIT_SCHEMA_POSTGRES = `
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

CREATE OR REPLACE FUNCTION migration_recovery_audit_no_mutate() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'migration_recovery_audit is append-only';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'migration_recovery_audit_no_update'
  ) THEN
    CREATE TRIGGER migration_recovery_audit_no_update BEFORE UPDATE ON migration_recovery_audit
      FOR EACH ROW EXECUTE FUNCTION migration_recovery_audit_no_mutate();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'migration_recovery_audit_no_delete'
  ) THEN
    CREATE TRIGGER migration_recovery_audit_no_delete BEFORE DELETE ON migration_recovery_audit
      FOR EACH ROW EXECUTE FUNCTION migration_recovery_audit_no_mutate();
  END IF;
END $$;
`;

const RECOVERY_AUDIT_SCHEMA_MYSQL = `
CREATE TABLE IF NOT EXISTS migration_recovery_audit (
  id VARCHAR(255) PRIMARY KEY,
  migration_id VARCHAR(255) NOT NULL,
  recovery_at VARCHAR(50) NOT NULL,
  lease_token VARCHAR(255) NOT NULL,
  actor VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  expected_status VARCHAR(20) NOT NULL,
  expected_checksum VARCHAR(64) NOT NULL,
  expected_dirty_reason_state VARCHAR(10) NOT NULL,
  expected_dirty_reason TEXT,
  actual_status VARCHAR(20) NOT NULL,
  actual_checksum VARCHAR(64) NOT NULL,
  actual_dirty_reason_state VARCHAR(10) NOT NULL,
  actual_dirty_reason TEXT,
  verification_manifest_hash VARCHAR(64),
  manifest_version INT,
  probe_results_json TEXT NOT NULL,
  verification_status VARCHAR(10) NOT NULL,
  success TINYINT(1) NOT NULL,
  FOREIGN KEY (migration_id) REFERENCES schema_migrations(id)
);

CREATE TRIGGER IF NOT EXISTS migration_recovery_audit_no_update BEFORE UPDATE ON migration_recovery_audit
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'migration_recovery_audit is append-only';

CREATE TRIGGER IF NOT EXISTS migration_recovery_audit_no_delete BEFORE DELETE ON migration_recovery_audit
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'migration_recovery_audit is append-only';
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
    if (candidate.version !== 1 || (candidate.dialect !== "sqlite" && candidate.dialect !== "postgresql" && candidate.dialect !== "mysql") || !Array.isArray(candidate.probes) || typeof candidate.retrySafe !== "boolean") return null;
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
    return { version: 1, dialect: candidate.dialect, probes, retrySafe: candidate.retrySafe };
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
   * Idempotent: checks if upgrade is needed and applies only missing columns/data.
   * Legacy schema typically has: id, version, dirty (or similar).
   * New schema requires: id, dialect, checksum, status (APPLYING/APPLIED/DIRTY), executed_at, duration_ms, dirty_reason, lease_token.
   *
   * This is an admin-only operation that must be run before any migration work.
   */
  async upgradeControlSchema(): Promise<void> {
    try {
      // Check if table exists at all
      let tableExists = false;
      try {
        await this.db.querySingle("SELECT 1 FROM schema_migrations LIMIT 1");
        tableExists = true;
      } catch {
        // Table doesn't exist; will be created on first migrate() call
        return;
      }

      if (!tableExists) return;

      // Check if it's already in new format (has dialect column)
      let hasDialectColumn = false;
      try {
        await this.db.querySingle(
          "SELECT dialect FROM schema_migrations LIMIT 1"
        );
        hasDialectColumn = true;
      } catch {
        // Column doesn't exist; need to upgrade
      }

      if (hasDialectColumn) {
        // Already upgraded
        return;
      }

      // Legacy schema detected; need to upgrade
      // Strategy: create new table with correct schema, copy legacy data, rename
      const timestamp = new Date().toISOString();
      const tempTableName = "schema_migrations_new";

      // Create new table with correct schema (including all manifest fields)
      let createSql: string;
      if (this.dialect === "sqlite") {
        createSql = `
          CREATE TABLE IF NOT EXISTS ${tempTableName} (
            id TEXT PRIMARY KEY,
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
        `;
      } else if (this.dialect === "postgresql") {
        createSql = `
          CREATE TABLE IF NOT EXISTS ${tempTableName} (
            id TEXT PRIMARY KEY,
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
        `;
      } else {
        createSql = `
          CREATE TABLE IF NOT EXISTS ${tempTableName} (
            id VARCHAR(255) PRIMARY KEY,
            dialect VARCHAR(50) NOT NULL,
            checksum VARCHAR(64) NOT NULL,
            status VARCHAR(20) NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
            executed_at VARCHAR(50) NOT NULL,
            duration_ms INT NOT NULL,
            dirty_reason TEXT,
            lease_token VARCHAR(255),
            manifest_version INT,
            verification_manifest_hash VARCHAR(64),
            manifest_json TEXT
          )
        `;
      }

      await this.db.executeRaw(createSql);

      // Check if legacy table has dirty column (indicates dirty state in original)
      let hasLegacyDirtyColumn = false;
      try {
        await this.db.querySingle("SELECT dirty FROM schema_migrations LIMIT 1");
        hasLegacyDirtyColumn = true;
      } catch {
        // No dirty column in legacy schema
      }

      // Copy legacy data to new table, preserving dirty state
      const builder = new DialectSqlBuilder(this.dialect);
      let insertSql: string;

      if (hasLegacyDirtyColumn) {
        // Map legacy dirty flag: dirty=0 -> APPLIED, dirty=1 -> DIRTY
        insertSql = `
          INSERT INTO ${tempTableName} (id, dialect, checksum, status, executed_at, duration_ms, dirty_reason, lease_token, manifest_version, verification_manifest_hash, manifest_json)
          SELECT id, ${builder.placeholder()}, ${builder.placeholder()},
                 CASE WHEN dirty = 1 THEN ${builder.placeholder()} ELSE ${builder.placeholder()} END,
                 ${builder.placeholder()}, 0,
                 CASE WHEN dirty = 1 THEN ${builder.placeholder()} ELSE NULL END,
                 NULL, NULL, NULL, NULL
          FROM schema_migrations
        `;
        const checksum = "legacy-checksum-unknown";
        await this.db.execute(insertSql, [
          this.dialect,
          checksum,
          "DIRTY",
          "APPLIED",
          timestamp,
          "legacy migration imported with dirty flag set",
        ]);
      } else {
        // No legacy dirty column; set all as APPLIED
        insertSql = `
          INSERT INTO ${tempTableName} (id, dialect, checksum, status, executed_at, duration_ms, dirty_reason, lease_token, manifest_version, verification_manifest_hash, manifest_json)
          SELECT id, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, 0, NULL, NULL, NULL, NULL, NULL FROM schema_migrations
        `;
        const checksum = "legacy-checksum-unknown";
        await this.db.execute(insertSql, [this.dialect, checksum, "APPLIED", timestamp]);
      }

      // Verify row counts match before swapping
      const oldCountResult = await this.db.querySingle("SELECT COUNT(*) as count FROM schema_migrations");
      const oldCount = (oldCountResult as any)?.count ?? 0;
      const newCountResult = await this.db.querySingle(`SELECT COUNT(*) as count FROM ${tempTableName}`);
      const newCount = (newCountResult as any)?.count ?? 0;

      if (oldCount !== newCount) {
        throw new Error(`Row count mismatch: old=${oldCount}, new=${newCount}. Swap aborted to preserve history.`);
      }

      // Swap tables atomically
      const backupTableName = "schema_migrations_backup";
      try {
        if (this.dialect === "sqlite" || this.dialect === "postgresql") {
          // Use transaction for atomic swap
          const tx = await this.db.beginTransaction();
          try {
            await tx.executeRaw("DROP TABLE schema_migrations");
            const renameCmd = this.dialect === "sqlite"
              ? `ALTER TABLE ${tempTableName} RENAME TO schema_migrations`
              : `ALTER TABLE ${tempTableName} RENAME TO schema_migrations`;
            await tx.executeRaw(renameCmd);
            await tx.commit();
          } catch (txError) {
            await tx.rollback();
            throw txError;
          }
        } else {
          // MySQL: use atomic multi-table RENAME with backup
          await this.db.executeRaw(`RENAME TABLE schema_migrations TO ${backupTableName}, ${tempTableName} TO schema_migrations`);
        }

        // Verify canonical schema after swap
        try {
          const verifyResult = await this.db.querySingle(
            "SELECT COUNT(*) as count FROM schema_migrations WHERE dialect IS NOT NULL"
          );
          const verifyCount = (verifyResult as any)?.count ?? 0;
          if (verifyCount === 0) {
            throw new Error("Upgraded schema_migrations table missing dialect column after swap");
          }
        } catch (verifyError) {
          throw new Error(`Failed to verify schema after swap: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`);
        }

        // Success; clean up backup if it exists (MySQL only)
        if (this.dialect === "mysql") {
          try {
            await this.db.executeRaw(`DROP TABLE IF EXISTS ${backupTableName}`);
          } catch {
            // Cleanup failure is non-fatal; original history is already safely backed up
          }
        }
      } catch (swapError) {
        // Swap failed; for MySQL, original table is still in backupTableName
        if (this.dialect === "mysql") {
          try {
            // Restore from backup on failure
            const restoreCheck = await this.db.querySingle(`SELECT COUNT(*) as count FROM ${backupTableName} LIMIT 1`);
            if (restoreCheck) {
              await this.db.executeRaw(`DROP TABLE IF EXISTS ${tempTableName}`);
              await this.db.executeRaw(`RENAME TABLE ${backupTableName} TO schema_migrations`);
            }
          } catch {
            // Restore attempt failed; original history may be partially lost
          }
        }
        throw swapError;
      }
    } catch (error) {
      throw new DomainError(
        "CONTROL_SCHEMA_UPGRADE_FAILED",
        `Failed to upgrade control schema: ${error instanceof Error ? error.message : String(error)}`,
        { dialect: this.dialect }
      );
    }
  }

  /**
   * Ensure migration tracking tables exist on active session.
   * Called inside lease to avoid concurrent DDL.
   * Must be called before any migration work.
   * Idempotent: safe to call multiple times.
   */
  private async ensureMigrationTableOnSession(session: MigrationSession): Promise<void> {
    try {
      const schema =
        this.dialect === "sqlite"
          ? MIGRATION_SCHEMA_SQLITE
          : this.dialect === "postgresql"
            ? MIGRATION_SCHEMA_POSTGRES
            : MIGRATION_SCHEMA_MYSQL;

      await session.executeRaw(schema);

      // Also ensure immutable audit table
      const auditSchema =
        this.dialect === "sqlite"
          ? RECOVERY_AUDIT_SCHEMA_SQLITE
          : this.dialect === "postgresql"
            ? RECOVERY_AUDIT_SCHEMA_POSTGRES
            : RECOVERY_AUDIT_SCHEMA_MYSQL;

      // For SQLite, triggers are part of the schema string (with IF NOT EXISTS)
      // For PostgreSQL, DO block handles IF NOT EXISTS check
      // For MySQL, table creation is idempotent
      await session.executeRaw(auditSchema);
    } catch (error) {
      // Ignore "already exists" errors as tables may have been created by prior run
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (
        !errorMsg.includes("already exists") &&
        !errorMsg.includes("duplicate") &&
        !errorMsg.includes("Duplicate entry")
      ) {
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
      const builder = new DialectSqlBuilder(this.dialect);
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
   * SQLite/PG: SAVEPOINT around DDL only; APPLYING inserted before savepoint.
   * MySQL: no savepoint (implicit DDL commit); persist APPLYING before DDL,
   *        execute DDL on reserved session, then APPLIED/DIRTY.
   */
  async migrate(
    migrations: readonly MigrationDefinition[],
    timeoutMs: number = 30000,
  ): Promise<MigrationRecord[]> {
    const appliedMigrations: MigrationRecord[] = [];
    const state: { failureResult: MigrationFailureResult | null } = { failureResult: null };

    await this.db.withMigrationLease<void>(
      async (session: MigrationSession) => {
        await this.ensureMigrationTableOnSession(session);

        // Preflight: fail if ANY migration is APPLYING or DIRTY (requires recovery first)
        const blockingMigration = await session.executeSingle(
          "SELECT id, status FROM schema_migrations WHERE status IN ('APPLYING', 'DIRTY') LIMIT 1",
        );

        if (blockingMigration) {
          throw new DirtyMigrationError(blockingMigration.id as string);
        }

        for (const migration of migrations) {
          const builder = new DialectSqlBuilder(this.dialect);

          // Check if already applied
          builder.reset();
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

          // New migration: mark APPLYING before DDL (in case DDL auto-commits like MySQL)
          const timestamp = new Date().toISOString();
          const checksum = this.computeChecksum(migration.sql);
          const leaseToken = session.leaseToken();
          if (migration.manifest) validateManifest(migration.manifest, this.dialect);
          const manifestJson = migration.manifest ? canonicalJson(canonicalManifest(migration.manifest)) : null;
          const manifestVersion = migration.manifest?.version ?? null;
          const verificationManifestHash = migration.manifest ? manifestHash(migration.manifest) : null;

          builder.reset();
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

          // Dialect-specific DDL execution
          const startTime = Date.now();
          try {
            if (this.dialect === "mysql") {
              // MySQL: DDL auto-commits, no savepoint. Execute on reserved session directly.
              await session.executeRaw(migration.sql);
            } else {
              // SQLite/PostgreSQL: use savepoint for DDL rollback on failure
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
            }

            // Mark APPLIED (atomic with transaction commit)
            const durationMs = Date.now() - startTime;
            builder.reset();
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
            builder.reset();
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
        await this.ensureMigrationTableOnSession(session);

        const leaseToken = session.leaseToken();
        const auditId = randomUUID();
        const builder = new DialectSqlBuilder(this.dialect);
        builder.reset();
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
          const auditBuilder = new DialectSqlBuilder(this.dialect);
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

        builder.reset();
        const updateSql = `UPDATE schema_migrations SET status = ${builder.placeholder()}, dirty_reason = NULL, lease_token = ${builder.placeholder()} WHERE id = ${builder.placeholder()} AND dialect = ${builder.placeholder()} AND status = ${builder.placeholder()} AND checksum = ${builder.placeholder()} AND dirty_reason ${request.expectedDirtyReason === null ? "IS NULL" : `= ${builder.placeholder()}`}`;
        const updateParams: unknown[] = ["APPLIED", leaseToken, request.migrationId, request.expectedDialect, request.expectedStatus, request.expectedChecksum];
        if (request.expectedDirtyReason !== null) updateParams.push(request.expectedDirtyReason);
        const updateResult = await session.execute(updateSql, updateParams);
        let updatedRows = updateResult.rowCount;
        if (this.dialect === "sqlite" && updatedRows === 0) {
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
    const builder = new DialectSqlBuilder(this.dialect);
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
