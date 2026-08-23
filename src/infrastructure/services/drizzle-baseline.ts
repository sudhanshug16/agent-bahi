/**
 * Fresh SQLite initialization owned by Drizzle.
 *
 * The migration files and meta journal under /drizzle are the only source of
 * schema DDL for this path. The official Bun SQLite migrator owns creation
 * and recording of its journal; this module only initializes the separate
 * application compatibility row after that migration has committed.
 */

import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate as migrateDrizzle } from "drizzle-orm/bun-sqlite/migrator";
import { join } from "node:path";
import type { Database as BunDatabase } from "bun:sqlite";
import type { MigrationSession } from "../../application/ports/persistence.ts";
import { DomainError } from "../../core/types.ts";

export const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations" as const;
export const DRIZZLE_BASELINE_MIGRATION_ID = "0009_drizzle_v8_baseline" as const;

const DRIZZLE_MIGRATIONS_DIRECTORY = join(import.meta.dir, "../../..", "drizzle");

export interface DrizzleControlInitializationOptions {
  readonly cliVersion: string;
  readonly buildId: string;
  readonly now: Date;
}

export interface DrizzleJournalRecord {
  readonly id: number | null;
  readonly hash: string;
  readonly createdAt: number;
}

/**
 * Run the official Drizzle migrator against the committed migration folder.
 * Its synchronous SQLite dialect owns the migration transaction and journal.
 */
export function migrateFreshDrizzleDatabase(db: BunDatabase): void {
  try {
    const drizzleDb = drizzle(db);
    migrateDrizzle(drizzleDb, { migrationsFolder: DRIZZLE_MIGRATIONS_DIRECTORY });
  } catch (error) {
    throw new DomainError(
      "DRIZZLE_MIGRATION_FAILED",
      `Official Drizzle migration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Read and validate the official Drizzle journal using the migration lease.
 * No journal row is inserted here: that is exclusively the migrator's job.
 */
export async function readDrizzleJournal(session: MigrationSession): Promise<DrizzleJournalRecord> {
  const row = await session.executeSingle(
    `SELECT id, hash, created_at
     FROM ${DRIZZLE_MIGRATIONS_TABLE}
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
  );
  if (!row) {
    throw new DomainError("DRIZZLE_JOURNAL_MISSING", "Official Drizzle migration journal is empty");
  }

  const id = row.id === null ? null : (typeof row.id === "bigint" ? Number(row.id) : Number(row.id));
  const hash = String(row.hash ?? "");
  const createdAt = typeof row.created_at === "bigint" ? Number(row.created_at) : Number(row.created_at);
  if (id !== null && (!Number.isSafeInteger(id) || id < 1) || !/^[0-9a-f]{64}$/.test(hash) || !Number.isSafeInteger(createdAt)) {
    throw new DomainError("DRIZZLE_JOURNAL_MALFORMED", "Official Drizzle migration journal is malformed");
  }

  return { id, hash, createdAt };
}

/**
 * Initialize the v8 compatibility row after official migration. This is
 * intentionally not DatabaseControlService.initialize(): fresh Drizzle
 * databases have no legacy history and must not be authorized by it.
 */
export async function initializeDrizzleControl(
  session: MigrationSession,
  options: DrizzleControlInitializationOptions,
): Promise<void> {
  const journal = await readDrizzleJournal(session);
  const existing = await session.executeSingle("SELECT * FROM database_control WHERE id = 1");
  if (existing) {
    const valid = String(existing.state) === "READY"
      && Number(existing.schema_version) === 8
      && Number(existing.data_format_version) === 1
      && Number(existing.reader_compatibility_min) === 1
      && Number(existing.reader_compatibility_max) === 1
      && Number(existing.required_writer_protocol) === 1
      && Number(existing.revision) === 7
      && Number(existing.generation) === 1
      && String(existing.last_migration_id) === DRIZZLE_BASELINE_MIGRATION_ID
      && String(existing.last_migration_checksum) === journal.hash
      && existing.recovery_reason == null;
    if (!valid) {
      throw new DomainError("DRIZZLE_CONTROL_MISMATCH", "Fresh Drizzle database control metadata is not canonical");
    }
    return;
  }

  const now = options.now.toISOString();
  await session.execute(
    `INSERT INTO database_control (
       id, schema_version, data_format_version, reader_compatibility_min,
       reader_compatibility_max, required_writer_protocol, state, revision,
       generation, last_migration_id, last_migration_checksum,
       last_writer_cli_version, last_writer_build_id, last_writer_at,
       created_at, updated_at, recovery_reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      1,
      8,
      1,
      1,
      1,
      1,
      "READY",
      7,
      1,
      DRIZZLE_BASELINE_MIGRATION_ID,
      journal.hash,
      options.cliVersion,
      options.buildId,
      now,
      now,
      now,
      null,
    ],
  );
}
