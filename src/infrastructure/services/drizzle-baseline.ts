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
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Database as BunDatabase } from "bun:sqlite";
import type { MigrationSession } from "../../application/ports/persistence.ts";
import { DomainError } from "../../core/types.ts";

export const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations" as const;
export const DRIZZLE_BASELINE_MIGRATION_ID = "0009_drizzle_v8_baseline" as const;
export const DRIZZLE_GST_V1_MIGRATION_ID = "0010_gst_v1" as const;
export const DRIZZLE_TDS_TCS_MIGRATION_ID = "0011_tds_tcs_v1" as const;
/** Backwards-compatible name for the current official Drizzle migration. */
export const DRIZZLE_GST_MIGRATION_ID = DRIZZLE_TDS_TCS_MIGRATION_ID;

const DRIZZLE_MIGRATIONS_DIRECTORY = join(import.meta.dir, "../../..", "drizzle");
export const DRIZZLE_JOURNAL_DDL = `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
\t\t\t\tid SERIAL PRIMARY KEY,
\t\t\t\thash text NOT NULL,
\t\t\t\tcreated_at numeric
\t\t\t)` as const;

const officialJournal = JSON.parse(readFileSync(join(DRIZZLE_MIGRATIONS_DIRECTORY, "meta", "_journal.json"), "utf8")) as {
  entries?: Array<{ idx: number; tag: string; when: number }>;
};
const officialEntry = officialJournal.entries?.find((entry) => entry.tag === DRIZZLE_BASELINE_MIGRATION_ID);
const gstEntry = officialJournal.entries?.find((entry) => entry.tag === DRIZZLE_GST_V1_MIGRATION_ID);
const currentEntry = officialJournal.entries?.find((entry) => entry.tag === DRIZZLE_TDS_TCS_MIGRATION_ID);
if (!officialEntry || !Number.isSafeInteger(officialEntry.when)) {
  throw new Error("Official Drizzle baseline journal entry is missing or malformed");
}
if (!gstEntry || !Number.isSafeInteger(gstEntry.when) || !currentEntry || !Number.isSafeInteger(currentEntry.when)) {
  throw new Error("Official Drizzle current journal entry is missing or malformed");
}
export const DRIZZLE_BASELINE_HASH = createHash("sha256")
  .update(readFileSync(join(DRIZZLE_MIGRATIONS_DIRECTORY, `${DRIZZLE_BASELINE_MIGRATION_ID}.sql`)))
  .digest("hex");
export const DRIZZLE_BASELINE_CREATED_AT = officialEntry.when;
export const DRIZZLE_GST_V1_HASH = createHash("sha256")
  .update(readFileSync(join(DRIZZLE_MIGRATIONS_DIRECTORY, `${DRIZZLE_GST_V1_MIGRATION_ID}.sql`)))
  .digest("hex");
export const DRIZZLE_GST_V1_CREATED_AT = gstEntry.when;
export const DRIZZLE_TDS_TCS_HASH = createHash("sha256")
  .update(readFileSync(join(DRIZZLE_MIGRATIONS_DIRECTORY, `${DRIZZLE_GST_MIGRATION_ID}.sql`)))
  .digest("hex");
export const DRIZZLE_TDS_TCS_CREATED_AT = currentEntry.when;
export const DRIZZLE_GST_HASH = DRIZZLE_TDS_TCS_HASH;
export const DRIZZLE_GST_CREATED_AT = DRIZZLE_TDS_TCS_CREATED_AT;

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

export function officialDrizzleJournal(): ReadonlyArray<DrizzleJournalRecord> {
  // Drizzle's SQLite SERIAL declaration yields a NULL id for the first row;
  // preserve that official result rather than inventing an identifier.
  return [
    { id: null, hash: DRIZZLE_BASELINE_HASH, createdAt: DRIZZLE_BASELINE_CREATED_AT },
    { id: null, hash: DRIZZLE_GST_V1_HASH, createdAt: DRIZZLE_GST_V1_CREATED_AT },
    { id: null, hash: DRIZZLE_TDS_TCS_HASH, createdAt: DRIZZLE_TDS_TCS_CREATED_AT },
  ];
}

/** Validate the exact official journal prefix without inferring trust from count. */
export function validateOfficialDrizzleJournal(rows: readonly Record<string, unknown>[]): void {
  const expected = officialDrizzleJournal();
  if (rows.length === 0 || rows.length > expected.length) throw new DomainError("DRIZZLE_JOURNAL_MISMATCH", "Official Drizzle migration journal is not an exact prefix");
  rows.forEach((row, index) => {
    const expectedRow = expected[index]!;
    const hash = String(row.hash ?? "");
    const createdAt = typeof row.created_at === "bigint" ? Number(row.created_at) : Number(row.created_at);
    const id = row.id === null || row.id === undefined ? null : Number(row.id);
    if (id !== expectedRow.id || hash !== expectedRow.hash || createdAt !== expectedRow.createdAt) {
      throw new DomainError("DRIZZLE_JOURNAL_MISMATCH", "Official Drizzle migration journal is not an exact prefix");
    }
  });
}

/** Seed only the official baseline row; DDL and values match Drizzle's migrator. */
export async function seedOfficialDrizzleBaseline(session: MigrationSession): Promise<void> {
  await session.executeRaw(DRIZZLE_JOURNAL_DDL);
  const rows = (await session.execute(
    `SELECT id, hash, created_at FROM ${DRIZZLE_MIGRATIONS_TABLE} ORDER BY created_at ASC, id ASC`,
  )).rows;
  if (rows.length === 0) {
    await session.execute(
      `INSERT INTO ${DRIZZLE_MIGRATIONS_TABLE} ("hash", "created_at") VALUES (?, ?)`,
      [DRIZZLE_BASELINE_HASH, DRIZZLE_BASELINE_CREATED_AT],
    );
    return;
  }
  validateOfficialDrizzleJournal(rows);
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
      && String(existing.last_migration_id) === DRIZZLE_GST_MIGRATION_ID
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
      DRIZZLE_GST_MIGRATION_ID,
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

/** Advance compatibility metadata after an explicit Drizzle journal upgrade. */
export async function synchronizeDrizzleControl(
  session: MigrationSession,
  options: DrizzleControlInitializationOptions,
): Promise<void> {
  const journal = await readDrizzleJournal(session);
  if (journal.hash !== DRIZZLE_GST_HASH) throw new DomainError("DRIZZLE_JOURNAL_MISMATCH", "GST migration is not the current official Drizzle journal entry");
  const row = await session.executeSingle("SELECT schema_version, data_format_version, state, revision, generation FROM database_control WHERE id = 1");
  if (!row || Number(row.schema_version) !== 8 || Number(row.data_format_version) !== 1 || String(row.state) !== "READY" || Number(row.revision) !== 7 || Number(row.generation) !== 1) {
    throw new DomainError("DRIZZLE_CONTROL_MISMATCH", "Cannot advance non-canonical v8 compatibility metadata");
  }
  const now = options.now.toISOString();
  await session.execute(
    "UPDATE database_control SET last_migration_id = ?, last_migration_checksum = ?, last_writer_cli_version = ?, last_writer_build_id = ?, last_writer_at = ?, updated_at = ? WHERE id = 1",
    [DRIZZLE_GST_MIGRATION_ID, journal.hash, options.cliVersion, options.buildId, now, now],
  );
}
