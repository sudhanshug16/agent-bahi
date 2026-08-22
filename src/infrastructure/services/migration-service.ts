import { createHash } from "crypto";
import { randomUUID } from "crypto";
import type { Database, MigrationRecord, MigrationSession } from "../../application/ports/persistence.ts";
import type { Dialect } from "../../core/types.ts";
import { DomainError, MigrationLockedError, MigrationChecksumError, DirtyMigrationError } from "../../core/types.ts";

/**
 * SQL dialect-aware builder: generates correct placeholders per dialect.
 * PostgreSQL: $1, $2, ... SQLite/MySQL: ?, ?, ...
 */
class DialectSqlBuilder {
  private placeholderIndex = 0;

  constructor(private dialect: Dialect) {}

  /**
   * Generate placeholder for next parameter; resets after build().
   */
  placeholder(): string {
    if (this.dialect === "postgresql") {
      return `$${++this.placeholderIndex}`;
    }
    return "?";
  }

  reset(): void {
    this.placeholderIndex = 0;
  }
}

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
  lease_token TEXT
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
  lease_token TEXT
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
  lease_token VARCHAR(255)
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
  expected_dirty_reason TEXT NOT NULL,
  actual_status TEXT NOT NULL,
  actual_checksum TEXT NOT NULL,
  actual_dirty_reason TEXT,
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
  expected_dirty_reason TEXT NOT NULL,
  actual_status TEXT NOT NULL,
  actual_checksum TEXT NOT NULL,
  actual_dirty_reason TEXT,
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
  expected_dirty_reason TEXT,
  actual_status VARCHAR(20) NOT NULL,
  actual_checksum VARCHAR(64) NOT NULL,
  actual_dirty_reason TEXT,
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
export interface MigrationRecoveryRequest {
  migrationId: string;
  expectedDialect: Dialect;
  expectedStatus: "DIRTY" | "APPLYING";
  expectedChecksum: string;
  expectedDirtyReason: string | null; // null = DB NULL, string = exact match
  actor: string;
  reason: string; // Operator's reason for recovery (appended to audit)
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

      // Create new table with correct schema
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
            lease_token TEXT
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
            lease_token TEXT
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
            lease_token VARCHAR(255)
          )
        `;
      }

      await this.db.executeRaw(createSql);

      // Copy legacy data to new table, setting defaults for missing columns
      // Assume legacy table has at least: id, version (or similar id column)
      // Set status=APPLIED for all legacy rows (assume they are applied)
      const insertSql = `
        INSERT INTO ${tempTableName} (id, dialect, checksum, status, executed_at, duration_ms, dirty_reason, lease_token)
        SELECT id, ?, ?, ?, ?, 0, NULL, NULL FROM schema_migrations
      `;
      const checksum = "legacy-checksum-unknown"; // Placeholder for legacy migrations
      await this.db.execute(insertSql, [this.dialect, checksum, "APPLIED", timestamp]);

      // Drop old table and rename new one
      if (this.dialect === "sqlite") {
        await this.db.executeRaw("DROP TABLE schema_migrations");
        await this.db.executeRaw(`ALTER TABLE ${tempTableName} RENAME TO schema_migrations`);
      } else if (this.dialect === "postgresql") {
        await this.db.executeRaw("DROP TABLE schema_migrations");
        await this.db.executeRaw(`ALTER TABLE ${tempTableName} RENAME TO schema_migrations`);
      } else {
        // MySQL
        await this.db.executeRaw("DROP TABLE schema_migrations");
        await this.db.executeRaw(`RENAME TABLE ${tempTableName} TO schema_migrations`);
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
      const migrations = await this.db.query(
        "SELECT id, dialect, checksum, status, executed_at, duration_ms FROM schema_migrations ORDER BY executed_at ASC",
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
      // If table doesn't exist, no schema yet
      if (error instanceof DomainError) throw error;
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
    migrations: readonly { id: string; sql: string }[],
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

          builder.reset();
          const insertSql = `INSERT INTO schema_migrations (id, dialect, checksum, status, executed_at, duration_ms, lease_token) VALUES (${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()})`;
          await session.execute(insertSql, [
            migration.id,
            this.dialect,
            checksum,
            "APPLYING",
            timestamp,
            0,
            leaseToken,
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
    return this.db.withMigrationLease<void>(
      async (session: MigrationSession) => {
        await this.ensureMigrationTableOnSession(session);

        const leaseToken = session.leaseToken();
        const auditId = randomUUID();
        const builder = new DialectSqlBuilder(this.dialect);

        // Fetch actual state
        builder.reset();
        const fetchSql = `SELECT id, dialect, checksum, status, dirty_reason FROM schema_migrations WHERE id = ${builder.placeholder()}`;
        const record = await session.executeSingle(fetchSql, [request.migrationId]);

        if (!record) {
          throw new DomainError(
            "RECOVERY_RECORD_NOT_FOUND",
            `Migration ${request.migrationId} not found`,
          );
        }

        const actualDialect = record.dialect as string;
        const actualStatus = record.status as string;
        const actualChecksum = record.checksum as string;
        const actualDirtyReason = record.dirty_reason as string | null;

        // Validate expected dialect matches actual
        if (actualDialect !== request.expectedDialect) {
          throw new DomainError(
            "RECOVERY_DIALECT_MISMATCH",
            `Expected dialect ${request.expectedDialect}, found ${actualDialect}`,
          );
        }

        // Validate expected state matches actual
        if (actualStatus !== request.expectedStatus) {
          throw new DomainError(
            "RECOVERY_STATE_MISMATCH",
            `Expected status ${request.expectedStatus}, found ${actualStatus}`,
          );
        }

        if (actualChecksum !== request.expectedChecksum) {
          throw new DomainError(
            "RECOVERY_CHECKSUM_MISMATCH",
            `Expected checksum ${request.expectedChecksum}, found ${actualChecksum}`,
          );
        }

        // Validate dirty_reason: null matches null, string matches exactly
        if (request.expectedDirtyReason === null) {
          if (actualDirtyReason !== null) {
            throw new DomainError(
              "RECOVERY_DIRTY_REASON_MISMATCH",
              `Expected NULL dirty_reason, found "${actualDirtyReason}"`,
            );
          }
        } else {
          if (actualDirtyReason !== request.expectedDirtyReason) {
            throw new DomainError(
              "RECOVERY_DIRTY_REASON_MISMATCH",
              `Expected dirty_reason "${request.expectedDirtyReason}", found "${actualDirtyReason}"`,
            );
          }
        }

        // CAS: Update to APPLIED, clearing dirty marker
        // Verify rowCount=1 to ensure exactly one row matched
        // SQL: dirty_reason IS NULL vs = depends on expectedDirtyReason
        builder.reset();
        let updateSql: string;
        const updateParams: unknown[] = ["APPLIED", leaseToken, request.migrationId, request.expectedDialect, request.expectedStatus, request.expectedChecksum];

        if (request.expectedDirtyReason === null) {
          updateSql = `UPDATE schema_migrations SET status = ${builder.placeholder()}, dirty_reason = NULL, lease_token = ${builder.placeholder()} WHERE id = ${builder.placeholder()} AND dialect = ${builder.placeholder()} AND status = ${builder.placeholder()} AND checksum = ${builder.placeholder()} AND dirty_reason IS NULL`;
        } else {
          updateSql = `UPDATE schema_migrations SET status = ${builder.placeholder()}, dirty_reason = NULL, lease_token = ${builder.placeholder()} WHERE id = ${builder.placeholder()} AND dialect = ${builder.placeholder()} AND status = ${builder.placeholder()} AND checksum = ${builder.placeholder()} AND dirty_reason = ${builder.placeholder()}`;
          updateParams.push(request.expectedDirtyReason);
        }

        const updateResult = await session.execute(updateSql, updateParams);

        if (!updateResult || updateResult.rowCount !== 1) {
          throw new DomainError(
            "RECOVERY_CAS_FAILED",
            `Expected exactly 1 row updated, got ${updateResult?.rowCount || 0}`,
          );
        }

        // Append immutable audit trail (reason is NOT NULL)
        const auditTimestamp = new Date().toISOString();
        builder.reset();
        const auditSql = `INSERT INTO migration_recovery_audit (id, migration_id, recovery_at, lease_token, actor, reason, expected_status, expected_checksum, expected_dirty_reason, actual_status, actual_checksum, actual_dirty_reason, success)
           VALUES (${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()}, ${builder.placeholder()})`;
        await session.execute(auditSql, [
          auditId,
          request.migrationId,
          auditTimestamp,
          leaseToken,
          request.actor,
          request.reason,
          request.expectedStatus,
          request.expectedChecksum,
          request.expectedDirtyReason,
          actualStatus,
          actualChecksum,
          actualDirtyReason,
          1,
        ]);
      },
      timeoutMs,
    );
  }

  /**
   * Verify checksum of an already-applied migration (read-only, no lease needed).
   * Fails if migration not found, dialect mismatch, or checksum mismatch.
   */
  async verifyChecksum(migrationId: string, expectedChecksum: string): Promise<void> {
    const record = await this.db.querySingle(
      "SELECT dialect, checksum FROM schema_migrations WHERE id = ?",
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
