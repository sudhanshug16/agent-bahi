/**
 * Database compatibility validator for fresh Drizzle and bridged legacy databases.
 * Determines readiness based on database state and migration source.
 *
 * Fresh Drizzle databases:
 * - Validated via the official __drizzle_migrations table and database_control metadata
 * - Never require schema_migrations legacy table
 * - Drizzle journal is sole source of truth
 *
 * Bridged legacy databases (v2..v8 upgraded via legacy bridge):
 * - Preserve existing schema_migrations as immutable audit trail
 * - Validated during one-time bridge initialization
 * - After baseline, use Drizzle journal for future upgrades
 */

import { Database as BunDatabase } from "bun:sqlite";
import { DomainError } from "../../core/types.ts";

export interface DatabaseCompatibility {
  status: "READY" | "UPDATE_REQUIRED" | "UNINITIALIZED" | "UNAVAILABLE";
  schemaVersion: number;
  source: "DRIZZLE" | "LEGACY" | "EMPTY" | "UNKNOWN";
  requiresLegacyBridge: boolean;
}

/**
 * Check compatibility for a database using Drizzle-first logic.
 * For fresh Drizzle DBs, validates only Drizzle sources.
 * For legacy-bridged DBs, validates both sources but prefers Drizzle after bridge.
 */
export function checkDatabaseCompatibility(db: BunDatabase): DatabaseCompatibility {
  try {
    // Check for Drizzle baseline
    const hasDrizzleTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
    ).get() as { "1": number } | undefined;

    // Check for legacy table
    const hasLegacyTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    ).get() as { "1": number } | undefined;

    // Check for database_control
    const hasControl = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'database_control'"
    ).get() as { "1": number } | undefined;

    // Check for core tables (foundation marker)
    const hasCoreSchema = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tenants'"
    ).get() as { "1": number } | undefined;

    // Empty database
    if (!hasDrizzleTable && !hasLegacyTable && !hasControl && !hasCoreSchema) {
      return {
        status: "UNINITIALIZED",
        schemaVersion: 0,
        source: "EMPTY",
        requiresLegacyBridge: false,
      };
    }

    // Fresh Drizzle database: has drizzle_migrations but no legacy table
    if (hasDrizzleTable && !hasLegacyTable && hasControl && hasCoreSchema) {
      const control = db.prepare("SELECT schema_version, data_format_version, state, last_migration_id, last_migration_checksum FROM database_control WHERE id = 1").get() as {
        schema_version: number | bigint;
        data_format_version: number | bigint;
        state: string;
        last_migration_id: string;
        last_migration_checksum: string;
      } | undefined;
      const journal = db.prepare("SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC, id DESC").all() as Array<{ id: number | bigint; hash: string; created_at: number | bigint }>;

      if (!control || journal.length !== 1) {
        return {
          status: "UNAVAILABLE",
          schemaVersion: 0,
          source: "DRIZZLE",
          requiresLegacyBridge: false,
        };
      }

      return {
        status: Number(control.schema_version) === 8
          && Number(control.data_format_version) === 1
          && control.state === "READY"
          && control.last_migration_id === "0009_drizzle_v8_baseline"
          && control.last_migration_checksum === journal[0]?.hash
          && /^[0-9a-f]{64}$/.test(journal[0]?.hash ?? "") ? "READY" : "UPDATE_REQUIRED",
        schemaVersion: Number(control.schema_version),
        source: "DRIZZLE",
        requiresLegacyBridge: false,
      };
    }

    // Bridged database: has both legacy and Drizzle, or legacy with control
    if (hasLegacyTable && hasControl && hasCoreSchema) {
      const control = db.prepare("SELECT schema_version FROM database_control").get() as {
        schema_version: number;
      } | undefined;

      if (!control) {
        return {
          status: "UNAVAILABLE",
          schemaVersion: 0,
          source: "LEGACY",
          requiresLegacyBridge: true,
        };
      }

      return {
        status: control.schema_version === 8 ? "READY" : "UPDATE_REQUIRED",
        schemaVersion: control.schema_version,
        source: hasDrizzleTable ? "DRIZZLE" : "LEGACY",
        requiresLegacyBridge: true,
      };
    }

    // Tampered/unknown state
    return {
      status: "UNAVAILABLE",
      schemaVersion: 0,
      source: "UNKNOWN",
      requiresLegacyBridge: false,
    };
  } catch (error) {
    throw new DomainError(
      "DATABASE_COMPATIBILITY_CHECK_FAILED",
      `Failed to check database compatibility: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Verify that database is ready for business operations.
 * Fresh Drizzle DBs must be v8+.
 * Bridged DBs must have completed migration to v8.
 */
export function assertDatabaseReady(compatibility: DatabaseCompatibility): void {
  if (compatibility.status !== "READY") {
    throw new DomainError(
      compatibility.status === "UNINITIALIZED" ? "DATABASE_UNINITIALIZED" : "DATABASE_NOT_READY",
      `Database is not ready for operations (status: ${compatibility.status}, version: ${compatibility.schemaVersion})`
    );
  }
}
