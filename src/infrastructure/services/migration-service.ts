import { createHash } from "crypto";
import type { Database, MigrationRecord } from "../../application/ports/persistence.ts";
import type { Dialect } from "../../core/types.ts";
import { DomainError, MigrationLockedError, MigrationChecksumError, DirtyMigrationError } from "../../core/types.ts";

/**
 * SQLite schema for tracking migrations.
 */
const MIGRATION_SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  dialect TEXT NOT NULL,
  checksum TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 0,
  dirty_reason TEXT
);
`;

const MIGRATION_SCHEMA_POSTGRES = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  dialect TEXT NOT NULL,
  checksum TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  dirty BOOLEAN NOT NULL DEFAULT false,
  dirty_reason TEXT
);
`;

const MIGRATION_SCHEMA_MYSQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(255) PRIMARY KEY,
  dialect VARCHAR(50) NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  executed_at VARCHAR(50) NOT NULL,
  duration_ms INT NOT NULL,
  dirty BOOLEAN NOT NULL DEFAULT false,
  dirty_reason TEXT
);
`;

/**
 * Core migration service.
 * Manages schema versions, compatibility, and DDL execution.
 */
export class MigrationService {
  private lockToken: string | null = null;

  constructor(
    private db: Database,
    private dialect: Dialect,
  ) {}

  /**
   * Ensure migration tracking table exists.
   */
  async ensureMigrationTable(): Promise<void> {
    try {
      const schema =
        this.dialect === "sqlite"
          ? MIGRATION_SCHEMA_SQLITE
          : this.dialect === "postgresql"
            ? MIGRATION_SCHEMA_POSTGRES
            : MIGRATION_SCHEMA_MYSQL;

      await this.db.executeRaw(schema);
    } catch (error) {
      throw new DomainError(
        "MIGRATION_TABLE_SETUP_FAILED",
        `Failed to set up migration tracking table: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get current schema compatibility status.
   */
  async getStatus(): Promise<{
    hasSchema: boolean;
    lastMigrationId?: string;
    isDirty: boolean;
    appliedMigrations: MigrationRecord[];
    dialect: string;
  }> {
    try {
      const migrations = await this.db.query(
        "SELECT id, dialect, checksum, executed_at, duration_ms FROM schema_migrations ORDER BY executed_at ASC",
      );

      const appliedMigrations: MigrationRecord[] = migrations.rows.map((row) => ({
        id: row.id as string,
        dialect: row.dialect as string,
        checksum: row.checksum as string,
        executedAt: row.executed_at as string,
        durationMs: row.duration_ms as number,
      }));

      const lastMigration = appliedMigrations[appliedMigrations.length - 1];

      // Check if last migration is marked dirty
      const dirtyCheck = await this.db.querySingle(
        "SELECT dirty, dirty_reason FROM schema_migrations WHERE id = ?",
        lastMigration ? [lastMigration.id] : [],
      );

      const isDirty = dirtyCheck && (dirtyCheck.dirty === 1 || dirtyCheck.dirty === true);

      return {
        hasSchema: appliedMigrations.length > 0,
        lastMigrationId: lastMigration?.id,
        isDirty: isDirty || false,
        appliedMigrations,
        dialect: this.dialect,
      };
    } catch (error) {
      // If table doesn't exist, no schema yet
      return {
        hasSchema: false,
        isDirty: false,
        appliedMigrations: [],
        dialect: this.dialect,
      };
    }
  }

  /**
   * Acquire exclusive migration lock.
   * Prevents concurrent schema changes.
   *
   * SQLite: PRAGMA locking_mode = EXCLUSIVE
   * PostgreSQL: pg_advisory_lock
   * MySQL: GET_LOCK
   */
  async acquireMigrationLock(timeoutMs: number = 30000): Promise<string> {
    const lockName = "agent-bahi-migration";

    try {
      const acquired = await this.db.acquireAdvisoryLock(lockName, timeoutMs);
      if (!acquired) {
        throw new MigrationLockedError(
          `Failed to acquire migration lock within ${timeoutMs}ms. Another process may be running migrations.`,
        );
      }

      this.lockToken = lockName;
      return lockName;
    } catch (error) {
      if (error instanceof MigrationLockedError) throw error;
      throw new MigrationLockedError(
        `Migration lock acquisition failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Release exclusive migration lock.
   */
  async releaseMigrationLock(lockToken: string): Promise<void> {
    try {
      await this.db.releaseAdvisoryLock(lockToken);
      this.lockToken = null;
    } catch (error) {
      throw new DomainError(
        "MIGRATION_LOCK_RELEASE_FAILED",
        `Failed to release migration lock: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Apply pending migrations.
   * Must acquire migration lock first.
   */
  async migrate(migrations: readonly { id: string; sql: string }[]): Promise<MigrationRecord[]> {
    if (!this.lockToken) {
      throw new DomainError(
        "MIGRATION_LOCK_REQUIRED",
        "Migration lock not held. Call acquireMigrationLock() first.",
      );
    }

    const appliedMigrations: MigrationRecord[] = [];

    try {
      await this.ensureMigrationTable();

      for (const migration of migrations) {
        // Check if already applied
        const existing = await this.db.querySingle(
          "SELECT id FROM schema_migrations WHERE id = ?",
          [migration.id],
        );

        if (existing) {
          // Verify checksum hasn't changed (indicates tampering)
          await this.verifyChecksum(migration.id, this.computeChecksum(migration.sql));
          continue;
        }

        // Execute migration and record
        const startTime = Date.now();

        try {
          const tx = await this.db.beginTransaction();
          try {
            // Execute migration SQL
            await tx.executeRaw(migration.sql);

            // Record successful execution
            const checksum = this.computeChecksum(migration.sql);
            const durationMs = Date.now() - startTime;
            const timestamp = new Date().toISOString();

            await tx.execute(
              `INSERT INTO schema_migrations (id, dialect, checksum, executed_at, duration_ms, dirty)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [migration.id, this.dialect, checksum, timestamp, durationMs, 0],
            );

            await tx.commit();

            appliedMigrations.push({
              id: migration.id,
              dialect: this.dialect,
              checksum,
              executedAt: timestamp,
              durationMs,
            });
          } catch (txError) {
            await tx.rollback();
            // Mark as dirty for recovery
            await this.markDirty(migration.id, `Migration failed: ${txError instanceof Error ? txError.message : String(txError)}`);
            throw txError;
          }
        } catch (error) {
          throw new DomainError(
            "MIGRATION_EXECUTION_FAILED",
            `Migration ${migration.id} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return appliedMigrations;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "MIGRATION_SERVICE_ERROR",
        `Migration error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Verify migration checksum against what's stored.
   */
  async verifyChecksum(migrationId: string, expectedChecksum: string): Promise<void> {
    const record = await this.db.querySingle(
      "SELECT checksum FROM schema_migrations WHERE id = ?",
      [migrationId],
    );

    if (!record) {
      return; // Migration not applied yet
    }

    const actualChecksum = record.checksum as string;
    if (actualChecksum !== expectedChecksum) {
      throw new MigrationChecksumError(migrationId, expectedChecksum, actualChecksum);
    }
  }

  /**
   * Mark migration as dirty (failed mid-execution).
   * Requires manual recovery.
   */
  async markDirty(migrationId: string, reason: string): Promise<void> {
    try {
      await this.db.execute(
        "UPDATE schema_migrations SET dirty = ?, dirty_reason = ? WHERE id = ?",
        [1, reason, migrationId],
      );
    } catch (error) {
      throw new DomainError(
        "MARK_DIRTY_FAILED",
        `Failed to mark migration as dirty: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Clear dirty marker (manual recovery completion).
   */
  async clearDirty(): Promise<void> {
    try {
      await this.db.execute("UPDATE schema_migrations SET dirty = ?, dirty_reason = NULL WHERE dirty = ?", [0, 1]);
    } catch (error) {
      throw new DomainError(
        "CLEAR_DIRTY_FAILED",
        `Failed to clear dirty marker: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private computeChecksum(sql: string): string {
    return createHash("sha256").update(sql).digest("hex");
  }
}
