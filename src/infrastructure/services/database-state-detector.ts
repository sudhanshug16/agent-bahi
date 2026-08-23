/**
 * Database state detector: Determines the current initialization state of a SQLite database.
 *
 * States:
 * - EMPTY: No schema_migrations table (fresh DB)
 * - LEGACY_V2: schema_migrations exists with 2 entries (foundation only)
 * - LEGACY_V3_TO_V7: schema_migrations has 3-7 entries (legacy upgrade path)
 * - CUSTOM_V8_WITHOUT_DRIZZLE: schema_migrations has 8 entries, no Drizzle journal
 * - DRIZZLE_MANAGED: __drizzle_migrations table exists (official path)
 * - UNKNOWN: Tampered/hybrid/malformed (fails closed)
 */

import { Database as BunDatabase } from "bun:sqlite";
import { DomainError } from "../../core/types.ts";

export type DatabaseState =
  | "EMPTY"
  | "LEGACY_V2"
  | "LEGACY_V3"
  | "LEGACY_V4"
  | "LEGACY_V5"
  | "LEGACY_V6"
  | "LEGACY_V7"
  | "CUSTOM_V8_WITHOUT_DRIZZLE"
  | "DRIZZLE_MANAGED"
  | "UNKNOWN";

export interface DatabaseStateSummary {
  state: DatabaseState;
  schemaVersion?: number;
  hasLegacyMigrations: boolean;
  hasDrizzleMigrations: boolean;
  legacyMigrationCount?: number;
  drizzleMigrationCount?: number;
}

/**
 * Detect the current state of a SQLite database.
 * Never mutates the database; read-only inspection only.
 */
export function detectDatabaseState(db: BunDatabase): DatabaseStateSummary {
  try {
    // Check for legacy schema_migrations table
    const legacyTableExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    ).get() as { "1": number } | undefined;

    // Check for Drizzle migrations table
    const drizzleTableExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
    ).get() as { "1": number } | undefined;

    // Check for database_control table (v8 marker)
    const controlTableExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'database_control'"
    ).get() as { "1": number } | undefined;

    // If nothing exists, it's empty
    if (!legacyTableExists && !drizzleTableExists && !controlTableExists) {
      return {
        state: "EMPTY",
        hasLegacyMigrations: false,
        hasDrizzleMigrations: false,
      };
    }

    // If only Drizzle migrations exist, it's Drizzle-managed
    if (drizzleTableExists && !legacyTableExists) {
      const drizzleCount = (
        db.prepare("SELECT COUNT(*) as count FROM __drizzle_migrations").get() as {
          count: number;
        }
      ).count;

      return {
        state: "DRIZZLE_MANAGED",
        hasLegacyMigrations: false,
        hasDrizzleMigrations: true,
        drizzleMigrationCount: drizzleCount,
      };
    }

    // If legacy migrations exist, determine which version
    if (legacyTableExists) {
      const migrationCount = (
        db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get() as {
          count: number;
        }
      ).count;

      // Hybrid: has both legacy and Drizzle (should never happen, but detect it)
      if (drizzleTableExists) {
        return {
          state: "UNKNOWN",
          hasLegacyMigrations: true,
          hasDrizzleMigrations: true,
          legacyMigrationCount: migrationCount,
          drizzleMigrationCount: (
            db.prepare("SELECT COUNT(*) as count FROM __drizzle_migrations").get() as {
              count: number;
            }
          ).count,
        };
      }

      // Determine schema version from migration count
      // v2 = 2 migrations (foundation only)
      // v3+ = +1 for each version beyond v2
      const schemaVersion = Math.min(migrationCount, 8); // Cap at 8

      const versionNames: Record<number, DatabaseState> = {
        2: "LEGACY_V2",
        3: "LEGACY_V3",
        4: "LEGACY_V4",
        5: "LEGACY_V5",
        6: "LEGACY_V6",
        7: "LEGACY_V7",
        8: controlTableExists ? "CUSTOM_V8_WITHOUT_DRIZZLE" : "UNKNOWN",
      };

      const state = versionNames[schemaVersion] || "UNKNOWN";

      return {
        state,
        schemaVersion,
        hasLegacyMigrations: true,
        hasDrizzleMigrations: false,
        legacyMigrationCount: migrationCount,
      };
    }

    // Malformed: has control table but no migration history
    return {
      state: "UNKNOWN",
      hasLegacyMigrations: false,
      hasDrizzleMigrations: false,
    };
  } catch (error) {
    throw new DomainError(
      "DATABASE_STATE_DETECTION_FAILED",
      `Failed to detect database state: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Check if database state requires migration before use.
 * Returns true if the database needs to be upgraded before business operations.
 */
export function requiresDatabaseMigration(state: DatabaseStateSummary): boolean {
  return state.state !== "DRIZZLE_MANAGED" && state.state !== "EMPTY";
}

/**
 * Get a human-readable description of the database state.
 */
export function describeDbState(state: DatabaseStateSummary): string {
  const stateDescriptions: Record<DatabaseState, string> = {
    EMPTY: "Empty/Fresh database (no migrations applied)",
    LEGACY_V2: "Legacy v2 (foundation only)",
    LEGACY_V3: "Legacy v3 (BookSet added)",
    LEGACY_V4: "Legacy v4 (Audit records added)",
    LEGACY_V5: "Legacy v5 (Journal ledger added)",
    LEGACY_V6: "Legacy v6 (Sales invoices added)",
    LEGACY_V7: "Legacy v7 (Vendor bills added)",
    CUSTOM_V8_WITHOUT_DRIZZLE: "Custom v8 (Bank reconciliation, custom migrations, needs Drizzle baseline)",
    DRIZZLE_MANAGED: "Drizzle-managed (current official baseline)",
    UNKNOWN: "Unknown/Tampered (fails closed, requires manual recovery)",
  };

  return stateDescriptions[state.state] || "Unknown";
}
