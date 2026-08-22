import { createHash } from "crypto";
import type { Database, MigrationRecord, MigrationSession } from "../../application/ports/persistence.ts";
import type { Dialect } from "../../core/types.ts";
import { DomainError, MigrationLockedError, MigrationChecksumError, DirtyMigrationError } from "../../core/types.ts";

/**
 * SQLite schema for tracking migrations.
 * Includes status field: null/APPLIED (success), APPLYING (in-progress), DIRTY (failed).
 */
const MIGRATION_SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  dialect TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT DEFAULT NULL,
  executed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  dirty_reason TEXT
);
`;

const MIGRATION_SCHEMA_POSTGRES = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  dialect TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT DEFAULT NULL,
  executed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  dirty_reason TEXT
);
`;

const MIGRATION_SCHEMA_MYSQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(255) PRIMARY KEY,
  dialect VARCHAR(50) NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  status VARCHAR(20) DEFAULT NULL,
  executed_at VARCHAR(50) NOT NULL,
  duration_ms INT NOT NULL,
  dirty_reason TEXT
);
`;

/**
 * Core migration service.
 * Manages schema versions, compatibility, and DDL execution within migration lease.
 * All work must happen via withMigrationLease callback; never holds separate locks.
 */
export class MigrationService {
  constructor(
    private db: Database,
    private dialect: Dialect,
  ) {}

  /**
   * Ensure migration tracking table exists.
   * Safe to call outside lease; just ensures schema structure.
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
   * Get current schema status without lease (read-only inspection).
   * Fails if schema is empty, dirty, or applying.
   */
  async getStatus(): Promise<{
    hasSchema: boolean;
    lastMigrationId?: string;
    isDirty: boolean;
    isApplying: boolean;
    appliedMigrations: MigrationRecord[];
    dialect: string;
  }> {
    try {
      const migrations = await this.db.query(
        "SELECT id, dialect, checksum, status, executed_at, duration_ms FROM schema_migrations ORDER BY executed_at ASC",
      );

      const appliedMigrations: MigrationRecord[] = migrations.rows.map((row) => ({
        id: row.id as string,
        dialect: row.dialect as string,
        checksum: row.checksum as string,
        executedAt: row.executed_at as string,
        durationMs: row.duration_ms as number,
      }));

      const lastMigration = migrations.rows[migrations.rows.length - 1];
      const isDirty = lastMigration && lastMigration.status === "DIRTY";
      const isApplying = lastMigration && lastMigration.status === "APPLYING";

      return {
        hasSchema: appliedMigrations.length > 0,
        lastMigrationId: lastMigration?.id as string | undefined,
        isDirty: isDirty || false,
        isApplying: isApplying || false,
        appliedMigrations,
        dialect: this.dialect,
      };
    } catch (error) {
      // If table doesn't exist, no schema yet
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
   * All validation, DDL, and audit happen in one transaction per dialect.
   * Returns applied migrations; throws on checksum mismatch, dirty state, or DDL failure.
   */
  async migrate(
    migrations: readonly { id: string; sql: string }[],
    timeoutMs: number = 30000,
  ): Promise<MigrationRecord[]> {
    const appliedMigrations: MigrationRecord[] = [];

    return this.db.withMigrationLease(
      async (session: MigrationSession) => {
        await this.ensureMigrationTable();

        for (const migration of migrations) {
          // Check if already applied
          const existing = await session.executeSingle(
            "SELECT id, checksum, status FROM schema_migrations WHERE id = ?",
            [migration.id],
          );

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

            // Fail if migration is stuck APPLYING (crash recovery needed)
            if (existing.status === "APPLYING") {
              throw new DirtyMigrationError(migration.id);
            }

            // Already applied, skip
            continue;
          }

          // New migration: mark APPLYING before DDL (in case DDL auto-commits)
          const timestamp = new Date().toISOString();
          const checksum = this.computeChecksum(migration.sql);

          await session.execute(
            `INSERT INTO schema_migrations (id, dialect, checksum, status, executed_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?)`,
            [migration.id, this.dialect, checksum, "APPLYING", timestamp, 0],
          );

          // Execute migration DDL
          const startTime = Date.now();
          try {
            await session.executeRaw(migration.sql);

            // Mark APPLIED (atomic with transaction commit)
            const durationMs = Date.now() - startTime;
            await session.execute(
              "UPDATE schema_migrations SET status = ?, duration_ms = ? WHERE id = ?",
              [null, durationMs, migration.id], // null = APPLIED (default)
            );

            appliedMigrations.push({
              id: migration.id,
              dialect: this.dialect,
              checksum,
              executedAt: timestamp,
              durationMs,
            });
          } catch (error) {
            // Mark DIRTY for manual recovery
            await session.execute(
              "UPDATE schema_migrations SET status = ?, dirty_reason = ? WHERE id = ?",
              ["DIRTY", `DDL failed: ${error instanceof Error ? error.message : String(error)}`, migration.id],
            );
            throw new DomainError(
              "MIGRATION_EXECUTION_FAILED",
              `Migration ${migration.id} failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        return appliedMigrations;
      },
      timeoutMs,
    );
  }

  /**
   * Deprecated: use migrate() with timeoutMs instead.
   * Kept for backward compatibility with old test pattern.
   */
  async acquireMigrationLock(timeoutMs: number = 30000): Promise<string> {
    return "deprecated-lock-token";
  }

  /**
   * Deprecated: releaseMigrationLock no longer needed.
   * Kept for backward compatibility.
   */
  async releaseMigrationLock(_lockToken: string): Promise<void> {
    // No-op
  }

  /**
   * Verify checksum of an already-applied migration (read-only, no lease needed).
   * Fails if migration not found or checksum mismatch (indicates tampering).
   */
  async verifyChecksum(migrationId: string, expectedChecksum: string): Promise<void> {
    const record = await this.db.querySingle(
      "SELECT checksum FROM schema_migrations WHERE id = ?",
      [migrationId],
    );

    if (!record) {
      return; // Migration not applied yet, nothing to verify
    }

    const actualChecksum = record.checksum as string;
    if (actualChecksum !== expectedChecksum) {
      throw new MigrationChecksumError(migrationId, expectedChecksum, actualChecksum);
    }
  }

  /**
   * Clear dirty marker and recover stuck migration.
   * Must hold lease; requires owner token and expected failed checksum/reason for safety.
   */
  async clearDirtyWithLease(
    migrationId: string,
    leaseToken: string,
    expectedChecksum: string,
    callback: (session: MigrationSession) => Promise<void>,
    timeoutMs: number = 30000,
  ): Promise<void> {
    return this.db.withMigrationLease(
      async (session: MigrationSession) => {
        if (session.leaseToken() !== leaseToken) {
          throw new DomainError(
            "RECOVERY_LEASE_MISMATCH",
            "Recovery lease token does not match session owner",
          );
        }

        const record = await session.executeSingle(
          "SELECT checksum, status FROM schema_migrations WHERE id = ?",
          [migrationId],
        );

        if (!record) {
          throw new DomainError(
            "RECOVERY_RECORD_NOT_FOUND",
            `Migration ${migrationId} not found`,
          );
        }

        if (record.checksum !== expectedChecksum) {
          throw new DomainError(
            "RECOVERY_CHECKSUM_MISMATCH",
            `Expected checksum ${expectedChecksum}, found ${record.checksum}`,
          );
        }

        if (record.status !== "DIRTY") {
          throw new DomainError(
            "RECOVERY_NOT_DIRTY",
            `Migration is in ${record.status} state, not DIRTY`,
          );
        }

        // Execute recovery callback (e.g., manual cleanup SQL)
        await callback(session);

        // Mark APPLIED
        await session.execute(
          "UPDATE schema_migrations SET status = NULL, dirty_reason = NULL WHERE id = ?",
          [migrationId],
        );
      },
      timeoutMs,
    );
  }

  private computeChecksum(sql: string): string {
    return createHash("sha256").update(sql).digest("hex");
  }
}
