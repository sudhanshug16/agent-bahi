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
const DRIZZLE_MIGRATIONS_DIRECTORY = join(import.meta.dir, "../../..", "drizzle");
export const DRIZZLE_JOURNAL_DDL = `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
\t\t\t\tid INTEGER PRIMARY KEY,
\t\t\t\thash text NOT NULL,
\t\t\t\tcreated_at numeric
\t\t\t)` as const;

const officialJournal = JSON.parse(readFileSync(join(DRIZZLE_MIGRATIONS_DIRECTORY, "meta", "_journal.json"), "utf8")) as {
  entries?: Array<{ idx: number; tag: string; when: number }>;
};

export interface DrizzleMigrationDescriptor {
  readonly id: string;
  readonly order: number;
  readonly createdAt: number;
  readonly sql: string;
  readonly hash: string;
}

const journalEntries = [...(officialJournal.entries ?? [])].sort((left, right) => left.idx - right.idx);
if (journalEntries.length === 0 || journalEntries.some((entry, index) => entry.idx !== index || !/^\d{4}_[^\s]+$/.test(entry.tag) || !Number.isSafeInteger(entry.when))) {
  throw new Error("Official Drizzle journal is missing or malformed");
}

/** The one ordered authority for committed Drizzle journal metadata and SQL. */
export const OFFICIAL_DRIZZLE_MIGRATIONS: readonly DrizzleMigrationDescriptor[] = Object.freeze(journalEntries.map((entry, index) => {
  const sql = readFileSync(join(DRIZZLE_MIGRATIONS_DIRECTORY, `${entry.tag}.sql`), "utf8");
  return Object.freeze({ id: entry.tag, order: index + 1, createdAt: entry.when, sql, hash: createHash("sha256").update(sql).digest("hex") });
}));

function descriptorAt(order: number): DrizzleMigrationDescriptor {
  const descriptor = OFFICIAL_DRIZZLE_MIGRATIONS[order - 1];
  if (!descriptor) throw new Error(`Official Drizzle migration order is invalid: ${order}`);
  return descriptor;
}

export function drizzleMigrationAt(order: number): DrizzleMigrationDescriptor {
  return descriptorAt(order);
}

export function drizzleCurrentMigration(): DrizzleMigrationDescriptor {
  return descriptorAt(OFFICIAL_DRIZZLE_MIGRATIONS.length);
}

export function drizzleBaselineMigration(): DrizzleMigrationDescriptor {
  return descriptorAt(1);
}

export function drizzleCheckpointForJournalLength(length: number): DrizzleMigrationDescriptor | undefined {
  return Number.isSafeInteger(length) && length >= 1 && length <= OFFICIAL_DRIZZLE_MIGRATIONS.length ? OFFICIAL_DRIZZLE_MIGRATIONS[length - 1] : undefined;
}

/** Checkpoints accepted by the backup/upgrade contract, including baseline. */
export function drizzleBackupCheckpointForJournalLength(length: number): DrizzleMigrationDescriptor | undefined {
  const current = OFFICIAL_DRIZZLE_MIGRATIONS.length;
  return [1, 8, 10, 11, 12, 15, 18, current - 1, current].includes(length) ? drizzleCheckpointForJournalLength(length) : undefined;
}

// Compatibility aliases are projections of the canonical descriptors. New
// code should consume OFFICIAL_DRIZZLE_MIGRATIONS or the narrow helpers above.
export const DRIZZLE_BASELINE_MIGRATION_ID = drizzleBaselineMigration().id;
export const DRIZZLE_GST_V1_MIGRATION_ID = descriptorAt(2).id;
export const DRIZZLE_TDS_TCS_MIGRATION_ID = descriptorAt(3).id;
export const DRIZZLE_FIXED_ASSETS_MIGRATION_ID = descriptorAt(4).id;
export const DRIZZLE_FX_V1_MIGRATION_ID = descriptorAt(5).id;
export const DRIZZLE_PAYROLL_V1_MIGRATION_ID = descriptorAt(6).id;
export const DRIZZLE_EXPENSE_CLAIMS_V1_MIGRATION_ID = descriptorAt(7).id;
export const DRIZZLE_GST_RETURN_READINESS_V1_MIGRATION_ID = descriptorAt(8).id;
export const DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_MIGRATION_ID = descriptorAt(9).id;
export const DRIZZLE_PERIOD_CLOSE_V1_MIGRATION_ID = descriptorAt(10).id;
export const DRIZZLE_TENANT_PAN_V1_MIGRATION_ID = descriptorAt(11).id;
export const DRIZZLE_CLOSE_PACK_V1_MIGRATION_ID = descriptorAt(12).id;
export const DRIZZLE_PERSONAL_TAXCASE_FOUNDATION_V1_MIGRATION_ID = descriptorAt(13).id;
export const DRIZZLE_PERSONAL_TAX_SOURCE_INTAKE_V1_MIGRATION_ID = descriptorAt(14).id;
export const DRIZZLE_PERSONAL_TAX_FACTS_RECONCILIATION_V1_MIGRATION_ID = descriptorAt(15).id;
export const DRIZZLE_PERSONAL_TAX_FILING_SNAPSHOT_V1_MIGRATION_ID = descriptorAt(16).id;
export const DRIZZLE_PERSONAL_TAX_SOURCE_READINESS_V1_MIGRATION_ID = descriptorAt(17).id;
export const DRIZZLE_PERSONAL_TAX_POSITION_WORKSHEET_V1_MIGRATION_ID = descriptorAt(18).id;
export const DRIZZLE_PERSONAL_TAX_ITR_ELIGIBILITY_V1_MIGRATION_ID = descriptorAt(19).id;
export const DRIZZLE_PERSONAL_TAX_COMPUTATION_V1_MIGRATION_ID = descriptorAt(20).id;
export const DRIZZLE_PERSONAL_TAX_RETURN_ARTIFACT_V1_MIGRATION_ID = descriptorAt(21).id;
export const DRIZZLE_GST_GSTR1_RETURN_ARTIFACT_V1_MIGRATION_ID = descriptorAt(22).id;
export const DRIZZLE_GST_GSTR1_RETURN_ARTIFACT_V1_HASH = descriptorAt(22).hash;
export const DRIZZLE_GST_GSTR1_RETURN_ARTIFACT_V1_CREATED_AT = descriptorAt(22).createdAt;
/** Backwards-compatible name for the current official Drizzle migration. */
export const DRIZZLE_GST_MIGRATION_ID = drizzleCurrentMigration().id;

export const DRIZZLE_BASELINE_HASH = drizzleBaselineMigration().hash;
export const DRIZZLE_BASELINE_CREATED_AT = drizzleBaselineMigration().createdAt;
export const DRIZZLE_GST_V1_HASH = descriptorAt(2).hash;
export const DRIZZLE_GST_V1_CREATED_AT = descriptorAt(2).createdAt;
export const DRIZZLE_TDS_TCS_HASH = descriptorAt(3).hash;
export const DRIZZLE_TDS_TCS_CREATED_AT = descriptorAt(3).createdAt;
export const DRIZZLE_FIXED_ASSETS_HASH = descriptorAt(4).hash;
export const DRIZZLE_FIXED_ASSETS_CREATED_AT = descriptorAt(4).createdAt;
export const DRIZZLE_FX_V1_HASH = descriptorAt(5).hash;
export const DRIZZLE_FX_V1_CREATED_AT = descriptorAt(5).createdAt;
export const DRIZZLE_PAYROLL_V1_HASH = descriptorAt(6).hash;
export const DRIZZLE_PAYROLL_V1_CREATED_AT = descriptorAt(6).createdAt;
export const DRIZZLE_EXPENSE_CLAIMS_V1_HASH = descriptorAt(7).hash;
export const DRIZZLE_EXPENSE_CLAIMS_V1_CREATED_AT = descriptorAt(7).createdAt;
export const DRIZZLE_GST_RETURN_READINESS_V1_HASH = descriptorAt(8).hash;
export const DRIZZLE_GST_RETURN_READINESS_V1_CREATED_AT = descriptorAt(8).createdAt;
export const DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_HASH = descriptorAt(9).hash;
export const DRIZZLE_COMPLIANCE_OBLIGATIONS_V1_CREATED_AT = descriptorAt(9).createdAt;
export const DRIZZLE_PERIOD_CLOSE_V1_HASH = descriptorAt(10).hash;
export const DRIZZLE_PERIOD_CLOSE_V1_CREATED_AT = descriptorAt(10).createdAt;
export const DRIZZLE_TENANT_PAN_V1_HASH = descriptorAt(11).hash;
export const DRIZZLE_TENANT_PAN_V1_CREATED_AT = descriptorAt(11).createdAt;
export const DRIZZLE_CLOSE_PACK_V1_HASH = descriptorAt(12).hash;
export const DRIZZLE_CLOSE_PACK_V1_CREATED_AT = descriptorAt(12).createdAt;
export const DRIZZLE_PERSONAL_TAXCASE_FOUNDATION_V1_HASH = descriptorAt(13).hash;
export const DRIZZLE_PERSONAL_TAXCASE_FOUNDATION_V1_CREATED_AT = descriptorAt(13).createdAt;
export const DRIZZLE_PERSONAL_TAX_SOURCE_INTAKE_V1_HASH = descriptorAt(14).hash;
export const DRIZZLE_PERSONAL_TAX_SOURCE_INTAKE_V1_CREATED_AT = descriptorAt(14).createdAt;
export const DRIZZLE_PERSONAL_TAX_FACTS_RECONCILIATION_V1_HASH = descriptorAt(15).hash;
export const DRIZZLE_PERSONAL_TAX_FACTS_RECONCILIATION_V1_CREATED_AT = descriptorAt(15).createdAt;
export const DRIZZLE_PERSONAL_TAX_FILING_SNAPSHOT_V1_HASH = descriptorAt(16).hash;
export const DRIZZLE_PERSONAL_TAX_FILING_SNAPSHOT_V1_CREATED_AT = descriptorAt(16).createdAt;
export const DRIZZLE_PERSONAL_TAX_SOURCE_READINESS_V1_HASH = descriptorAt(17).hash;
export const DRIZZLE_PERSONAL_TAX_SOURCE_READINESS_V1_CREATED_AT = descriptorAt(17).createdAt;
export const DRIZZLE_PERSONAL_TAX_POSITION_WORKSHEET_V1_HASH = descriptorAt(18).hash;
export const DRIZZLE_PERSONAL_TAX_POSITION_WORKSHEET_V1_CREATED_AT = descriptorAt(18).createdAt;
export const DRIZZLE_PERSONAL_TAX_ITR_ELIGIBILITY_V1_HASH = descriptorAt(19).hash;
export const DRIZZLE_PERSONAL_TAX_ITR_ELIGIBILITY_V1_CREATED_AT = descriptorAt(19).createdAt;
export const DRIZZLE_PERSONAL_TAX_COMPUTATION_V1_HASH = descriptorAt(20).hash;
export const DRIZZLE_PERSONAL_TAX_COMPUTATION_V1_CREATED_AT = descriptorAt(20).createdAt;
export const DRIZZLE_PERSONAL_TAX_RETURN_ARTIFACT_V1_HASH = descriptorAt(21).hash;
export const DRIZZLE_PERSONAL_TAX_RETURN_ARTIFACT_V1_CREATED_AT = descriptorAt(21).createdAt;
export const DRIZZLE_COMPLIANCE_HASH = descriptorAt(9).hash;
export const DRIZZLE_GST_HASH = drizzleCurrentMigration().hash;
export const DRIZZLE_GST_CREATED_AT = drizzleCurrentMigration().createdAt;

export interface DrizzleControlInitializationOptions {
  readonly cliVersion: string;
  readonly buildId: string;
  readonly now: Date;
}

export interface DrizzleJournalRecord {
  readonly id: number;
  readonly hash: string;
  readonly createdAt: number;
}

export function officialDrizzleJournal(): ReadonlyArray<DrizzleJournalRecord> {
  return OFFICIAL_DRIZZLE_MIGRATIONS.map((migration) => ({ id: migration.order, hash: migration.hash, createdAt: migration.createdAt }));
}

function journalMismatch(): never {
  throw new DomainError("DRIZZLE_JOURNAL_MISMATCH", "Official Drizzle migration journal is not canonical");
}

function parseJournalInteger(value: unknown): number {
  if (typeof value === "bigint") {
    if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) journalMismatch();
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) journalMismatch();
  return value;
}

/** Validate the exact official journal, including cardinality and row shape. */
export function validateOfficialDrizzleJournal(rows: readonly Record<string, unknown>[]): void {
  const expected = officialDrizzleJournal();
  if (rows.length !== expected.length) journalMismatch();
  validateOfficialDrizzleJournalPrefix(rows);
}

/** Validate an official journal prefix for the explicit pending-upgrade path. */
export function validateOfficialDrizzleJournalPrefix(rows: readonly Record<string, unknown>[]): void {
  const expected = officialDrizzleJournal();
  if (rows.length === 0 || rows.length > expected.length) journalMismatch();
  rows.forEach((row, index) => {
    const expectedRow = expected[index]!;
    const keys = Object.keys(row).sort();
    if (keys.length !== 3 || keys[0] !== "created_at" || keys[1] !== "hash" || keys[2] !== "id") journalMismatch();
    if (!Object.prototype.hasOwnProperty.call(row, "id") || !Object.prototype.hasOwnProperty.call(row, "hash") || !Object.prototype.hasOwnProperty.call(row, "created_at")) journalMismatch();
    const id = parseJournalInteger(row.id);
    const createdAt = parseJournalInteger(row.created_at);
    if (id !== index + 1 || id !== expectedRow.id || typeof row.hash !== "string" || row.hash !== expectedRow.hash || createdAt !== expectedRow.createdAt) journalMismatch();
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
  validateOfficialDrizzleJournalPrefix(rows);
}

/**
 * Run the official Drizzle migrator against the committed migration folder.
 * Its synchronous SQLite dialect owns the migration transaction and journal.
 */
export function migrateFreshDrizzleDatabase(db: BunDatabase): void {
  try {
    // Drizzle's SQLite migrator omits id when inserting into its SERIAL column.
    // Pre-create the SQLite-native integer key so every official row is explicit,
    // positive, and deterministically ordered while Drizzle still owns migration
    // application and journal values.
    db.exec(DRIZZLE_JOURNAL_DDL);
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

  const id = parseJournalInteger(row.id);
  const hash = String(row.hash ?? "");
  const createdAt = typeof row.created_at === "bigint" ? Number(row.created_at) : Number(row.created_at);
  if (!/^[0-9a-f]{64}$/.test(hash) || !Number.isSafeInteger(createdAt)) {
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
  if (journal.hash !== DRIZZLE_GST_HASH) throw new DomainError("DRIZZLE_JOURNAL_MISMATCH", "GST return readiness migration is not the current official Drizzle journal entry");
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
