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
import { DatabaseControlService, type DatabaseControlRecord, type DatabaseControlInspection } from "./database-control-service.ts";
import { CORE_SCHEMA_SQLITE, CORE_MIGRATIONS } from "../schema/core-schema.ts";
import {
  DATABASE_CONTROL_CHECKSUM,
  DATABASE_CONTROL_TABLE_DDL,
} from "../schema/database-control-schema.ts";
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
}

export interface BackupServiceOptions {
  sourcePath: string;
  /** Deterministic failure seams used by behavioral tests. */
  afterVacuum?: () => void | Promise<void>;
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

const EXPECTED_MIGRATION_CHECKSUM = createHash("sha256")
  .update(CORE_MIGRATIONS.sqlite)
  .digest("hex");

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
  private readonly afterVacuum?: () => void;
  private readonly beforePublication?: () => void;

  constructor(sourcePath: string | BackupServiceOptions) {
    const requestedPath = typeof sourcePath === "string" ? sourcePath : sourcePath.sourcePath;
    this.afterVacuum = typeof sourcePath === "string" ? undefined : sourcePath.afterVacuum;
    this.beforePublication = typeof sourcePath === "string" ? undefined : sourcePath.beforePublication;
    this.sourcePath = canonicalExistingRegularPath(requestedPath, "BACKUP_SOURCE_UNSAFE");
    this.sourceIdentity = regularIdentity(this.sourcePath, "BACKUP_SOURCE_UNSAFE");
  }

  async createBackup(destinationPath: string): Promise<BackupResult> {
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
      const initial = await this.captureSourceExpectation();
      await this.vacuumInto(stagingPath);
      await this.afterVacuum?.();
      stagingIdentity = regularIdentity(stagingPath, "BACKUP_FAILED");

      const after = await this.captureSourceExpectation();
      if (after.control !== undefined && !sameControl(initial.control, after.control)) {
        throw new DomainError("BACKUP_CONTROL_CHANGED", "Source database control changed during backup");
      }
      if (initial.history !== after.history || initial.catalog !== after.catalog) {
        throw new DomainError("BACKUP_CONTROL_CHANGED", "Source database metadata changed during backup");
      }

      await this.verifySqliteFile(stagingPath, initial);
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

  async verifyBackup(backupPath: string): Promise<boolean> {
    const canonicalPath = canonicalExistingRegularPath(backupPath, "BACKUP_DESTINATION_UNSAFE");
    ensureNoSidecars(canonicalPath);
    try {
      await this.verifySqliteFile(canonicalPath);
      ensureNoSidecars(canonicalPath);
      return true;
    } catch (error) {
      throw normalizeBackupError(error, "BACKUP_VERIFICATION_FAILED");
    }
  }

  private async captureSourceExpectation(): Promise<SourceExpectation> {
    let db: BunDatabase | undefined;
    try {
      assertIdentity(this.sourcePath, this.sourceIdentity, "BACKUP_CONTROL_CHANGED");
      db = openReadonly(this.sourcePath);
      assertIdentity(this.sourcePath, this.sourceIdentity, "BACKUP_CONTROL_CHANGED");
      const expectation = await captureExpectation(db);
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

  private async verifySqliteFile(path: string, expected?: SourceExpectation): Promise<void> {
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

      const actual = await captureExpectation(db);
      if (expected && (actual.history !== expected.history || actual.catalog !== expected.catalog || !sameControl(actual.control, expected.control))) {
        throw new DomainError("BACKUP_VERIFICATION_FAILED", "SQLite snapshot metadata does not match the source");
      }
    } catch (error) {
      throw normalizeBackupError(error, "BACKUP_VERIFICATION_FAILED");
    } finally {
      closeDatabase(db);
    }
  }
}

export { BackupService as SqliteBackupService };

async function captureExpectation(db: BunDatabase): Promise<SourceExpectation> {
  const port = readonlyPort(db);
  const controlService = new DatabaseControlService(port, "sqlite");
  const control = await controlService.inspect();
  if (control.status !== "AVAILABLE" || !control.record) {
    throw new DomainError("BACKUP_SOURCE_UNAVAILABLE", "Database control is unavailable");
  }
  if (control.record.state !== "READY") {
    throw new DomainError("BACKUP_SOURCE_NOT_READY", "Database control is not ready");
  }

  const historyRows = queryRows<MigrationRow>(db, `
    SELECT id, dialect, checksum, status, executed_at, duration_ms,
           dirty_reason, lease_token, manifest_version,
           verification_manifest_hash, manifest_json
    FROM schema_migrations ORDER BY id ASC
  `);
  validateMigrationHistory(historyRows);

  const catalog = queryRows<CatalogRow>(db, `
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type ASC, name ASC, tbl_name ASC, sql ASC
  `);
  validateCanonicalSchema(catalog);

  return {
    control: control.record,
    history: canonicalHash(historyRows),
    catalog: canonicalHash(catalog),
  };
}

function validateMigrationHistory(rows: MigrationRow[]): void {
  if (rows.length !== 2) {
    throw new DomainError("BACKUP_HISTORY_MISMATCH", "SQLite migration history is not the accepted history");
  }
  const expected = new Map([
    ["0001-core-schema", EXPECTED_MIGRATION_CHECKSUM],
    ["0002-database-control", DATABASE_CONTROL_CHECKSUM],
  ]);
  for (const row of rows) {
    if (row.dialect !== "sqlite" || row.status !== "APPLIED" || row.dirty_reason !== null || row.id === undefined || expected.get(row.id) !== row.checksum) {
      throw new DomainError("BACKUP_HISTORY_MISMATCH", "SQLite migration history is not the accepted history");
    }
  }
  if (![...expected.keys()].every((id) => rows.some((row) => row.id === id))) {
    throw new DomainError("BACKUP_HISTORY_MISMATCH", "SQLite migration history is incomplete");
  }
}

function validateCanonicalSchema(catalog: CatalogRow[]): void {
  const expected = expectedCatalog();
  const actualByName = new Map(catalog.map((row) => [`${row.type}:${row.name}`, row]));
  for (const expectedRow of expected) {
    const actual = actualByName.get(`${expectedRow.type}:${expectedRow.name}`);
    if (!actual || canonicalJson(actual) !== canonicalJson(expectedRow)) {
      throw new DomainError("BACKUP_SCHEMA_MISMATCH", "SQLite schema catalog is not canonical");
    }
  }
}

let cachedExpectedCatalog: CatalogRow[] | undefined;
function expectedCatalog(): CatalogRow[] {
  if (cachedExpectedCatalog) return cachedExpectedCatalog;
  const db = new BunDatabase(":memory:", { strict: true, safeIntegers: true });
  try {
    db.exec(MIGRATION_SCHEMA_SQLITE);
    db.exec(RECOVERY_AUDIT_SCHEMA_SQLITE);
    db.exec(CORE_SCHEMA_SQLITE);
    db.exec(DATABASE_CONTROL_TABLE_DDL);
    cachedExpectedCatalog = queryRows<CatalogRow>(db, `
      SELECT type, name, tbl_name, sql
      FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type ASC, name ASC, tbl_name ASC, sql ASC
    `);
    return cachedExpectedCatalog;
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
