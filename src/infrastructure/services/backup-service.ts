import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname } from "node:path";
import { Database as BunDatabase } from "bun:sqlite";
import type { BackupResult, Database, BackupService as BackupServicePort, QueryResult } from "../../application/ports/persistence.ts";
import { DomainError } from "../../core/types.ts";
import { classifySqliteError, toDomainError } from "../sqlite/error-classifier.ts";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";
import { DatabaseControlService, type DatabaseControlRecord } from "./database-control-service.ts";
import { CORE_SCHEMA_SQLITE } from "../schema/core-schema.ts";
import { DATABASE_CONTROL_TABLE_DDL } from "../schema/database-control-schema.ts";
import { CURRENT_SCHEMA_MANIFEST, V2_SCHEMA_MANIFEST, V3_SCHEMA_MANIFEST, V4_SCHEMA_MANIFEST, type SqliteSchemaManifest } from "../schema/current-manifest.ts";
import { BOOKSET_V3_MIGRATION } from "../schema/bookset-v3-migration.ts";
import { BOOKSET_V4_MIGRATION } from "../schema/bookset-v4-migration.ts";
import { JOURNAL_V5_MIGRATION } from "../schema/journal-v5-migration.ts";
import { MIGRATION_SCHEMA_SQLITE, RECOVERY_AUDIT_SCHEMA_SQLITE } from "./migration-service.ts";

type CatalogRow = {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
};

type MigrationRow = {
  id: string;
  dialect: string;
  checksum: string;
  status: string;
  executed_at: string;
  duration_ms: number | bigint;
  dirty_reason: string | null;
  lease_token: string | null;
  manifest_version: number | bigint | null;
  verification_manifest_hash: string | null;
  manifest_json: string | null;
};

interface SourceExpectation {
  control: DatabaseControlRecord;
  history: string;
  catalog: string;
  catalogRows: CatalogRow[];
}

export interface BackupServiceOptions {
  sourcePath: string;
  /** Expected source identity for an upgrade; defaults to the production v2 manifest. */
  expectedSourceManifest?: SqliteSchemaManifest;
  /** Deterministic failure seams used by behavioral tests. */
  afterVacuum?: (stagingPath: string) => void | Promise<void>;
  beforePublication?: () => void | Promise<void>;
}

interface InodeIdentity {
  dev: number;
  ino: number;
}

const BACKUP_ERROR_CODES = new Set([
  "BACKUP_SOURCE_UNSAFE",
  "BACKUP_SOURCE_UNAVAILABLE",
  "BACKUP_SOURCE_NOT_READY",
  "BACKUP_DESTINATION_UNSAFE",
  "BACKUP_DESTINATION_EXISTS",
  "BACKUP_DESTINATION_RACE",
  "BACKUP_SCHEMA_MISMATCH",
  "BACKUP_HISTORY_MISMATCH",
  "BACKUP_CONTROL_CHANGED",
  "BACKUP_VERIFICATION_FAILED",
  "BACKUP_DURABILITY_FAILED",
  "BACKUP_PUBLICATION_FAILED",
  "BACKUP_FAILED",
]);

/**
 * SQLite-only, create-and-verify backup service.
 *
 * VACUUM INTO is deliberately run on a separate non-transactional connection.
 * It is a committed-data snapshot; this service does not claim to quiesce
 * concurrent writers globally.
 */
export class BackupService implements BackupServicePort {
  private readonly sourcePath: string;
  private readonly sourceIdentity: InodeIdentity;
  private readonly afterVacuum?: (stagingPath: string) => void | Promise<void>;
  private readonly beforePublication?: () => void;
  private readonly expectedSourceManifest?: SqliteSchemaManifest;

  constructor(sourcePath: string | BackupServiceOptions) {
    const requestedPath = typeof sourcePath === "string" ? sourcePath : sourcePath.sourcePath;
    this.afterVacuum = typeof sourcePath === "string" ? undefined : sourcePath.afterVacuum;
    this.beforePublication = typeof sourcePath === "string" ? undefined : sourcePath.beforePublication;
    this.expectedSourceManifest = typeof sourcePath === "string" ? undefined : sourcePath.expectedSourceManifest;
    this.sourcePath = canonicalExistingRegularPath(requestedPath, "BACKUP_SOURCE_UNSAFE");
    this.sourceIdentity = regularIdentity(this.sourcePath, "BACKUP_SOURCE_UNSAFE");
  }

  async createBackup(destinationPath: string, expectedSourceManifest?: SqliteSchemaManifest): Promise<BackupResult> {
    const finalPath = canonicalDestinationPath(destinationPath);
    if (samePath(finalPath, this.sourcePath)) {
      throw new DomainError("BACKUP_DESTINATION_EXISTS", "Backup destination conflicts with the source");
    }
    assertDestinationMissing(finalPath);

    const stagingPath = `${finalPath}.staging-${randomUUID()}`;
    assertStagingMissing(stagingPath);

    let stagingIdentity: InodeIdentity | undefined;
    let finalIdentity: InodeIdentity | undefined;

    try {
      const sourceManifest = expectedSourceManifest ?? this.expectedSourceManifest;
      const initial = await this.captureSourceExpectation(sourceManifest);
      await this.vacuumInto(stagingPath);
      await this.afterVacuum?.(stagingPath);
      stagingIdentity = regularIdentity(stagingPath, "BACKUP_FAILED");

      const after = await this.captureSourceExpectation(sourceManifest);
      if (after.control !== undefined && !sameControl(initial.control, after.control)) {
        throw new DomainError("BACKUP_CONTROL_CHANGED", "Source database control changed during backup");
      }
      if (initial.history !== after.history || initial.catalog !== after.catalog) {
        throw new DomainError("BACKUP_CONTROL_CHANGED", "Source database metadata changed during backup");
      }

      await this.verifySqliteFile(stagingPath, initial, sourceManifest);
      ensureNoSidecars(stagingPath);
      chmodSync(stagingPath, 0o600);
      fsyncFile(stagingPath);

      // link() is the no-replace publication primitive: EEXIST loses a race
      // without following or replacing the destination path.
      await this.beforePublication?.();
      try {
        linkSync(stagingPath, finalPath);
      } catch (error) {
        if (isErrno(error, "EEXIST")) {
          throw new DomainError("BACKUP_DESTINATION_RACE", "Backup destination appeared during publication");
        }
        throw error;
      }
      finalIdentity = regularIdentity(finalPath, "BACKUP_PUBLICATION_FAILED");
      if (!sameIdentity(finalIdentity, stagingIdentity)) {
        throw new DomainError("BACKUP_PUBLICATION_FAILED", "Backup publication identity changed");
      }
      chmodSync(finalPath, 0o600);
      fsyncFile(finalPath);
      fsyncDirectory(dirname(finalPath));
      ensureNoSidecars(finalPath);

      const beforeHash = regularIdentity(finalPath, "BACKUP_PUBLICATION_FAILED");
      if (!sameIdentity(beforeHash, finalIdentity)) {
        throw new DomainError("BACKUP_PUBLICATION_FAILED", "Completed backup identity changed");
      }
      let fd: number | undefined;
      let bytes: Buffer;
      let hashedStat: InodeIdentity & { size: number };
      try {
        fd = openSync(finalPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const descriptorStat = fstatSync(fd);
        if (descriptorStat.isSymbolicLink()) throw new Error("symbolic link");
        bytes = readFileSync(fd);
        hashedStat = { dev: Number(descriptorStat.dev), ino: Number(descriptorStat.ino), size: descriptorStat.size };
      } catch {
        throw new DomainError("BACKUP_PUBLICATION_FAILED", "Completed backup could not be read safely");
      } finally {
        if (fd !== undefined) {
          try { closeSync(fd); } catch { /* publication already failed closed */ }
        }
      }
      const afterHash = regularIdentity(finalPath, "BACKUP_PUBLICATION_FAILED");
      if (!sameIdentity(hashedStat, afterHash) || !sameIdentity(afterHash, finalIdentity) || afterHash.size !== bytes.byteLength) {
        throw new DomainError("BACKUP_PUBLICATION_FAILED", "Completed backup identity changed");
      }
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const size = afterHash.size;

      unlinkExact(stagingPath, stagingIdentity, true);
      stagingIdentity = undefined;

      return {
        status: "SUCCESS",
        path: finalPath,
        manifest: {
          timestamp: new Date().toISOString(),
          checksum,
          files: [{ name: basename(finalPath), checksum, size }],
        },
      };
    } catch (error) {
      unlinkExact(stagingPath, stagingIdentity);
      unlinkExact(finalPath, finalIdentity);
      throw normalizeBackupError(error);
    }
  }

  async verifyBackup(backupPath: string, expectedSourceManifest?: SqliteSchemaManifest): Promise<boolean> {
    const canonicalPath = canonicalExistingRegularPath(backupPath, "BACKUP_DESTINATION_UNSAFE");
    ensureNoSidecars(canonicalPath);
    try {
      await this.verifySqliteFile(canonicalPath, undefined, expectedSourceManifest ?? this.expectedSourceManifest);
      ensureNoSidecars(canonicalPath);
      return true;
    } catch (error) {
      throw normalizeBackupError(error, "BACKUP_VERIFICATION_FAILED");
    }
  }

  private async captureSourceExpectation(expectedSourceManifest?: SqliteSchemaManifest): Promise<SourceExpectation> {
    let db: BunDatabase | undefined;
    try {
      assertIdentity(this.sourcePath, this.sourceIdentity, "BACKUP_CONTROL_CHANGED");
      db = openReadonly(this.sourcePath);
      assertIdentity(this.sourcePath, this.sourceIdentity, "BACKUP_CONTROL_CHANGED");
      const expectation = await captureExpectation(db, expectedSourceManifest);
      return expectation;
    } catch (error) {
      throw normalizeBackupError(error, "BACKUP_SOURCE_UNAVAILABLE");
    } finally {
      closeDatabase(db);
    }
  }

  private async vacuumInto(stagingPath: string): Promise<void> {
    let db: BunDatabase | undefined;
    try {
      assertIdentity(this.sourcePath, this.sourceIdentity, "BACKUP_CONTROL_CHANGED");
      db = openReadonly(this.sourcePath);
      assertIdentity(this.sourcePath, this.sourceIdentity, "BACKUP_CONTROL_CHANGED");
      // The path is a bound value. Never interpolate a filesystem path into SQL.
      db.prepare("VACUUM INTO ?").run(stagingPath);
    } catch (error) {
      throw normalizeBackupError(error);
    } finally {
      closeDatabase(db);
    }
  }

  private async verifySqliteFile(path: string, expected?: SourceExpectation, expectedSourceManifest?: SqliteSchemaManifest): Promise<void> {
    let db: BunDatabase | undefined;
    try {
      db = openReadonly(path);
      const integrity = db.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
      if (integrity.length !== 1 || Object.values(integrity[0] ?? {}).length !== 1 || String(Object.values(integrity[0] ?? {})[0]) !== "ok") {
        throw new DomainError("BACKUP_VERIFICATION_FAILED", "SQLite integrity verification failed");
      }

      const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeys.length !== 0) {
        throw new DomainError("BACKUP_VERIFICATION_FAILED", "SQLite foreign-key verification failed");
      }

      const actual = await captureExpectation(db, expectedSourceManifest);
      if (expected) {
        validateExactCatalogMatch(actual.catalogRows, expected.catalogRows);
        if (actual.history !== expected.history || actual.catalog !== expected.catalog || !sameControl(actual.control, expected.control)) {
          throw new DomainError("BACKUP_VERIFICATION_FAILED", "SQLite snapshot metadata does not match the source");
        }
      }
    } catch (error) {
      throw normalizeBackupError(error, "BACKUP_VERIFICATION_FAILED");
    } finally {
      closeDatabase(db);
    }
  }
}

export { BackupService as SqliteBackupService };

async function captureExpectation(db: BunDatabase, expectedManifest?: SqliteSchemaManifest): Promise<SourceExpectation> {
  const port = readonlyPort(db);
  const historyRows = queryRows<MigrationRow>(db, `
    SELECT id, dialect, checksum, status, executed_at, duration_ms,
           dirty_reason, lease_token, manifest_version,
           verification_manifest_hash, manifest_json
    FROM schema_migrations ORDER BY id ASC
  `);
  const manifest = expectedManifest ?? manifestForHistory(historyRows);
  if (!manifest) throw new DomainError("BACKUP_HISTORY_MISMATCH", "SQLite migration history is not an accepted immutable sequence");
  validateMigrationHistory(historyRows, manifest);

  const controlService = new DatabaseControlService(port, "sqlite", manifest);
  const control = await controlService.inspect();
  let controlRecord = control.record;
  if (control.status !== "AVAILABLE" || !controlRecord) {
    // A valid but changed READY row must still be captured so the second
    // snapshot comparison can report BACKUP_CONTROL_CHANGED. Malformed rows
    // remain unavailable and fail closed.
    if (control.reason !== "ROW_DATA_INVALID") {
      throw new DomainError("BACKUP_SOURCE_UNAVAILABLE", "Database control is unavailable");
    }
    controlRecord = looseControlRecord(db);
    const expectedLast = manifest.migrations.at(-1);
    if (controlRecord.schemaVersion !== manifest.schemaVersion
      || controlRecord.dataFormatVersion !== manifest.dataFormatVersion
      || controlRecord.readerCompatibilityMin !== manifest.readerCompatibilityMin
      || controlRecord.readerCompatibilityMax !== manifest.readerCompatibilityMax
      || controlRecord.requiredWriterProtocol !== manifest.writerProtocol
      || controlRecord.generation !== manifest.generation
      || controlRecord.revision !== manifest.revision
      || !expectedLast
      || controlRecord.lastMigrationId !== expectedLast.id
      || controlRecord.lastMigrationChecksum !== expectedLast.checksum) {
      throw new DomainError("BACKUP_CONTROL_CHANGED", "Source database control changed during backup");
    }
  }
  if (controlRecord.state !== "READY") {
    throw new DomainError("BACKUP_SOURCE_NOT_READY", "Database control is not ready");
  }

  const catalogRows = queryRows<CatalogRow>(db, `
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type ASC, name ASC, tbl_name ASC, sql ASC
  `);
  validateCanonicalSchema(catalogRows, manifest);

  return {
    control: controlRecord,
    history: canonicalHash(historyRows),
    catalog: canonicalHash(catalogRows),
    catalogRows,
  };
}

function manifestForHistory(rows: readonly MigrationRow[]): SqliteSchemaManifest | undefined {
  return [V2_SCHEMA_MANIFEST, V3_SCHEMA_MANIFEST, V4_SCHEMA_MANIFEST, CURRENT_SCHEMA_MANIFEST].find((candidate) => candidate.migrations.length === rows.length && candidate.migrations.every((migration, index) => {
    const actual = rows[index];
    return actual?.id === migration.id && actual?.dialect === migration.dialect && actual?.checksum === migration.checksum && actual?.status === migration.status && actual?.dirty_reason === null;
  }));
}

function looseControlRecord(db: BunDatabase): DatabaseControlRecord {
  const row = db.prepare(`SELECT schema_version, data_format_version,
    reader_compatibility_min, reader_compatibility_max, required_writer_protocol,
    state, revision, generation, last_migration_id, last_migration_checksum,
    last_writer_cli_version, last_writer_build_id, last_writer_at, created_at,
    updated_at, recovery_reason FROM database_control WHERE id = 1`).get() as Record<string, unknown> | undefined;
  if (!row || safeInteger(row.schema_version) === undefined || safeInteger(row.data_format_version) === undefined || safeInteger(row.reader_compatibility_min) === undefined || safeInteger(row.reader_compatibility_max) === undefined || safeInteger(row.required_writer_protocol) === undefined || safeInteger(row.revision) === undefined || safeInteger(row.generation) === undefined || row.state !== "READY" || typeof row.last_migration_id !== "string" || typeof row.last_migration_checksum !== "string" || typeof row.last_writer_cli_version !== "string" || typeof row.last_writer_build_id !== "string" || typeof row.last_writer_at !== "string" || typeof row.created_at !== "string" || typeof row.updated_at !== "string" || row.recovery_reason !== null) {
    throw new DomainError("BACKUP_SOURCE_UNAVAILABLE", "Database control is unavailable");
  }
  return {
    schemaVersion: safeInteger(row.schema_version)!,
    dataFormatVersion: safeInteger(row.data_format_version)!,
    readerCompatibilityMin: safeInteger(row.reader_compatibility_min)!,
    readerCompatibilityMax: safeInteger(row.reader_compatibility_max)!,
    requiredWriterProtocol: safeInteger(row.required_writer_protocol)!,
    state: "READY",
    revision: safeInteger(row.revision)!,
    generation: safeInteger(row.generation)!,
    lastMigrationId: row.last_migration_id as string,
    lastMigrationChecksum: row.last_migration_checksum as string,
    lastWriterCliVersion: row.last_writer_cli_version as string,
    lastWriterBuildId: row.last_writer_build_id as string,
    lastWriterAt: row.last_writer_at as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    recoveryReason: null,
  };
}

function safeInteger(value: unknown): number | undefined {
  const number = typeof value === "bigint" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) ? number : undefined;
}

function validateMigrationHistory(rows: MigrationRow[], expectedManifest: SqliteSchemaManifest = CURRENT_SCHEMA_MANIFEST): void {
  if (rows.length !== expectedManifest.migrations.length) {
    throw new DomainError("BACKUP_HISTORY_MISMATCH", "SQLite migration history is not the accepted history");
  }
  const expected = expectedManifest.migrations;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const migration = expected[index];
    if (!migration || row.dialect !== migration.dialect || row.status !== migration.status || row.dirty_reason !== null || row.id !== migration.id || row.checksum !== migration.checksum) {
      throw new DomainError("BACKUP_HISTORY_MISMATCH", "SQLite migration history is not the accepted history");
    }
  }
}

function validateCanonicalSchema(catalog: CatalogRow[], expectedManifest: SqliteSchemaManifest): void {
  const expected = expectedCatalog(expectedManifest);
  const actualByName = new Map(catalog.map((row) => [`${row.type}:${row.name}`, row]));
  for (const expectedRow of expected) {
    const actual = actualByName.get(`${expectedRow.type}:${expectedRow.name}`);
    if (!actual || canonicalJson(actual) !== canonicalJson(expectedRow)) {
      throw new DomainError("BACKUP_SCHEMA_MISMATCH", "SQLite schema catalog is not canonical");
    }
  }
}

function validateExactCatalogMatch(actual: CatalogRow[], expected: CatalogRow[]): void {
  if (actual.length !== expected.length) {
    throw new DomainError("BACKUP_SCHEMA_MISMATCH", "SQLite schema catalog is not canonical");
  }
  const expectedCanonical = expected.map(canonicalJson);
  const actualCanonical = actual.map(canonicalJson);
  for (let i = 0; i < expectedCanonical.length; i++) {
    if (expectedCanonical[i] !== actualCanonical[i]) {
      throw new DomainError("BACKUP_SCHEMA_MISMATCH", "SQLite schema catalog is not canonical");
    }
  }
}

const cachedExpectedCatalog = new Map<string, CatalogRow[]>();
function expectedCatalog(expectedManifest: SqliteSchemaManifest = CURRENT_SCHEMA_MANIFEST): CatalogRow[] {
  const key = expectedManifest.schemaVersion + ":" + expectedManifest.revision;
  const cached = cachedExpectedCatalog.get(key);
  if (cached) return cached;
  const db = new BunDatabase(":memory:", { strict: true, safeIntegers: true });
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(MIGRATION_SCHEMA_SQLITE);
    db.exec(RECOVERY_AUDIT_SCHEMA_SQLITE);
    db.exec(CORE_SCHEMA_SQLITE);
    db.exec(DATABASE_CONTROL_TABLE_DDL);
    // The expected catalog is the actual production schema for the requested
    // history, not the v2 source catalog. Apply the immutable sequence through
    // the requested target so a v4 history cannot pass with missing 0004
    // objects or triggers.
    if (expectedManifest.schemaVersion >= 3) db.exec(BOOKSET_V3_MIGRATION.sqlite);
    if (expectedManifest.schemaVersion >= 4) db.exec(BOOKSET_V4_MIGRATION.sqlite);
    if (expectedManifest.schemaVersion >= 5) db.exec(JOURNAL_V5_MIGRATION.sqlite);
    const catalog = queryRows<CatalogRow>(db, `
      SELECT type, name, tbl_name, sql
      FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type ASC, name ASC, tbl_name ASC, sql ASC
    `);
    cachedExpectedCatalog.set(key, catalog);
    return catalog;
  } finally {
    db.close();
  }
}

function openReadonly(path: string): BunDatabase {
  try {
    const db = new BunDatabase(path, { strict: true, safeIntegers: true, readonly: true, create: false });
    db.exec("PRAGMA foreign_keys = ON");
    return db;
  } catch (error) {
    throw normalizeBackupError(error, "BACKUP_SOURCE_UNAVAILABLE");
  }
}

function readonlyPort(db: BunDatabase): Database {
  return {
    query: async (sql: string, params?: unknown[]): Promise<QueryResult> => {
      const rows = db.prepare(sql).all(...((params ?? []) as any)) as Record<string, unknown>[];
      return { rows, rowCount: rows.length };
    },
  } as unknown as Database;
}

function queryRows<T extends Record<string, unknown>>(db: BunDatabase, sql: string): T[] {
  return db.prepare(sql).all() as T[];
}

function canonicalExistingRegularPath(path: string, code: string): string {
  try {
    const canonical = assertSafeSqlitePath(path);
    const stat = lstatSync(canonical);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not regular");
    return canonical;
  } catch {
    throw new DomainError(code, code === "BACKUP_SOURCE_UNSAFE" ? "SQLite backup source is not a safe regular local file" : "SQLite backup path is not a safe regular local file");
  }
}

function canonicalDestinationPath(path: string): string {
  try {
    const canonical = assertSafeSqlitePath(path);
    const parent = realpathSync(dirname(canonical));
    return `${parent}/${basename(canonical)}`;
  } catch {
    throw new DomainError("BACKUP_DESTINATION_UNSAFE", "SQLite backup destination is not a safe absolute local path");
  }
}

function assertDestinationMissing(path: string): void {
  try {
    lstatSync(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return;
    throw new DomainError("BACKUP_DESTINATION_EXISTS", "SQLite backup destination is unavailable");
  }
  throw new DomainError("BACKUP_DESTINATION_EXISTS", "SQLite backup destination already exists");
}

function assertStagingMissing(path: string): void {
  try {
    lstatSync(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return;
    throw new DomainError("BACKUP_FAILED", "SQLite backup staging path is unavailable");
  }
  throw new DomainError("BACKUP_FAILED", "SQLite backup staging path is unavailable");
}

function regularIdentity(path: string, code: string): InodeIdentity & { size: number } {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not regular");
    return { dev: Number(stat.dev), ino: Number(stat.ino), size: stat.size };
  } catch {
    throw new DomainError(code, "SQLite backup artifact is not a regular file");
  }
}

function assertIdentity(path: string, expected: InodeIdentity, code: string): void {
  const actual = regularIdentity(path, code);
  if (!sameIdentity(actual, expected)) {
    throw new DomainError(code, "SQLite backup source identity changed");
  }
}

function unlinkExact(path: string, expected?: InodeIdentity, failClosed = false): void {
  if (!expected) return;
  try {
    const current = lstatSync(path);
    if (current.isSymbolicLink() || Number(current.dev) !== expected.dev || Number(current.ino) !== expected.ino) return;
    unlinkSync(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return;
    if (failClosed) throw new DomainError("BACKUP_PUBLICATION_FAILED", "SQLite backup staging publication could not be finalized");
  }
}

function fsyncFile(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    fsyncSync(fd);
  } catch {
    throw new DomainError("BACKUP_DURABILITY_FAILED", "SQLite backup file durability could not be confirmed");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function fsyncDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch (error) {
    if (!isErrno(error, "EINVAL") && !isErrno(error, "ENOTSUP") && !isErrno(error, "EOPNOTSUPP") && !isErrno(error, "EBADF")) {
      throw new DomainError("BACKUP_DURABILITY_FAILED", "SQLite backup directory durability could not be confirmed");
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function ensureNoSidecars(path: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    try {
      lstatSync(`${path}${suffix}`);
      throw new DomainError("BACKUP_VERIFICATION_FAILED", "SQLite backup output has unsupported sidecar files");
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (!isErrno(error, "ENOENT")) throw new DomainError("BACKUP_VERIFICATION_FAILED", "SQLite backup sidecars could not be inspected");
    }
  }
}

function closeDatabase(db: BunDatabase | undefined): void {
  if (!db) return;
  try {
    db.close();
  } catch {
    // A close failure is surfaced by the operation that owns durability.
  }
}

function samePath(left: string, right: string): boolean {
  return left === right;
}

function sameIdentity(left: InodeIdentity, right: InodeIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameControl(left: DatabaseControlRecord, right: DatabaseControlRecord): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function normalizeBackupError(error: unknown, fallbackCode = "BACKUP_FAILED"): DomainError {
  if (error instanceof DomainError) {
    if (error.code === "SQLITE_CONTENTION_BUSY" || error.code === "SQLITE_CONTENTION_LOCKED") return error;
    if (BACKUP_ERROR_CODES.has(error.code)) return error;
  }
  const classified = classifySqliteError(error, "backup");
  if (classified.code === "SQLITE_CONTENTION_BUSY" || classified.code === "SQLITE_CONTENTION_LOCKED") return toDomainError(classified);
  return new DomainError(fallbackCode, fallbackMessage(fallbackCode));
}

function fallbackMessage(code: string): string {
  switch (code) {
    case "BACKUP_SOURCE_UNAVAILABLE": return "SQLite backup source is unavailable";
    case "BACKUP_VERIFICATION_FAILED": return "SQLite backup verification failed";
    default: return "SQLite backup failed";
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
