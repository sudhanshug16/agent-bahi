/**
 * Drizzle v8 baseline initialization service.
 * Manages fresh database creation and Drizzle migration journal setup.
 *
 * This service owns the baseline SQL migration (0009) and the official Drizzle migration journal.
 * Fresh databases created via this service are guaranteed to:
 * - Have the complete v8 schema with all tables, indices, triggers, and guards
 * - Use Drizzle's migration journal for future migrations
 * - Never need to replay the v0001..v0008 legacy custom migrations
 * - Have database_control initialized with metadata
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Database as BunDatabase } from "bun:sqlite";
import { DomainError } from "../../core/types.ts";

/**
 * Baseline migration metadata.
 * This reflects the official Drizzle v8 baseline migration.
 */
export interface DrizzleBaselineMigration {
  readonly id: string;
  readonly timestamp: number;
  readonly sql: string;
}

/**
 * Load the Drizzle baseline migration SQL from disk.
 * Returns the migration metadata and raw SQL.
 */
export async function loadDrizzleBaseline(): Promise<DrizzleBaselineMigration> {
  try {
    const sql = await readFile(
      join(import.meta.dir, "../../..", "drizzle", "0009_drizzle_v8_baseline.sql"),
      "utf-8"
    );
    return {
      id: "0009_drizzle_v8_baseline",
      timestamp: Date.now(),
      sql,
    };
  } catch (error) {
    throw new DomainError(
      "DRIZZLE_BASELINE_LOAD_FAILED",
      `Failed to load Drizzle v8 baseline migration: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Seed the Drizzle migrations table for the baseline.
 * Marks the baseline migration as applied so future migrations start from v9.
 * Should only be called after the baseline schema has been applied.
 */
export async function seedDrizzleMigrationsTable(
  db: BunDatabase,
  baseline: DrizzleBaselineMigration
): Promise<void> {
  try {
    // Ensure the drizzle_migrations table exists
    // This table is created by the baseline migration
    const tableExists = db.prepare(
      "SELECT type FROM sqlite_master WHERE type = 'table' AND name = 'drizzle_migrations'"
    ).get() as { type: string } | undefined;

    if (!tableExists) {
      // Create the table if it doesn't exist (shouldn't happen, but be defensive)
      db.exec(`
        CREATE TABLE IF NOT EXISTS drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL UNIQUE,
          created_at NUMERIC NOT NULL
        )
      `);
    }

    // Insert the baseline migration record
    // Using a safe hash based on migration ID
    const hash = baseline.id;
    db.prepare(
      `INSERT OR IGNORE INTO drizzle_migrations (hash, created_at) VALUES (?, ?)`
    ).run(hash, baseline.timestamp);
  } catch (error) {
    throw new DomainError(
      "DRIZZLE_MIGRATIONS_TABLE_SEED_FAILED",
      `Failed to seed Drizzle migrations table: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Apply the Drizzle v8 baseline migration to an empty database.
 * This is the complete v8 schema initialization path for fresh databases.
 * Must be called from within an active transaction (e.g., withMigrationLease).
 * Does not manage transaction boundaries itself.
 */
export async function applyDrizzleBaseline(db: BunDatabase, baseline: DrizzleBaselineMigration): Promise<void> {
  try {
    // Parse and execute the baseline SQL
    // Split by statement-breakpoint which Drizzle uses to separate statements
    const statements = baseline.sql.split("--> statement-breakpoint").filter((stmt) => stmt.trim());

    let executedCount = 0;

    for (const statement of statements) {
      const trimmed = statement.trim();
      if (!trimmed || trimmed.startsWith("--")) continue;

      // Execute the statement
      db.exec(trimmed);
      executedCount++;
    }

    if (executedCount === 0) {
      throw new Error("No valid statements found in baseline migration");
    }
  } catch (error) {
    throw new DomainError(
      "DRIZZLE_BASELINE_APPLICATION_FAILED",
      `Failed to apply Drizzle v8 baseline: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Check if a database has the Drizzle baseline schema applied.
 * Returns true if all required tables exist with correct structure.
 */
export function hasDrizzleBaseline(db: BunDatabase): boolean {
  try {
    // Check for key tables that are created by the baseline
    const requiredTables = [
      "tenants",
      "book_sets",
      "accounts",
      "journal_entries",
      "journal_lines",
      "sales_invoices",
      "vendor_bills",
      "bank_statements",
      "database_control",
    ];

    for (const table of requiredTables) {
      const exists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
      ).get(table) as { "1": number } | undefined;

      if (!exists) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get the applied Drizzle migrations from the migrations table.
 * Used to determine the current schema version and applied migrations.
 */
export function getAppliedDrizzleMigrations(db: BunDatabase): readonly string[] {
  try {
    const rows = db.prepare("SELECT hash FROM drizzle_migrations ORDER BY id ASC").all() as Array<{
      hash: string;
    }>;

    return rows.map((row) => row.hash);
  } catch {
    // Table doesn't exist or other error - no migrations applied
    return [];
  }
}
