import { Database as BunDatabase } from "bun:sqlite";
import { assertSafeSqlitePath } from "../infrastructure/sqlite/path-policy.ts";
import type { AccountService } from "./services/account-service.ts";
import type { BookSetService } from "./services/book-set-service.ts";
import type { TenantService } from "./services/tenant-service.ts";
import type { IdempotencyService } from "./services/idempotency-service.ts";
import { AccountService as SqliteAccountService } from "./services/account-service.ts";
import { BookSetService as SqliteBookSetService } from "./services/book-set-service.ts";
import { TenantService as SqliteTenantService } from "./services/tenant-service.ts";
import { IdempotencyService as SqliteIdempotencyService } from "./services/idempotency-service.ts";
import { BookSetScopeService } from "./services/book-set-scope-service.ts";
import { BusinessSessionFactory } from "../infrastructure/adapters/business-session-factory.ts";
import { SqliteAdapter } from "../infrastructure/adapters/sqlite-adapter.ts";
import { BackupService } from "../infrastructure/services/backup-service.ts";
import { UpgradeCoordinator } from "../infrastructure/services/upgrade-coordinator.ts";
import {
  DRIZZLE_MIGRATIONS_TABLE,
  DRIZZLE_GST_HASH,
  officialDrizzleJournal,
  initializeDrizzleControl,
  seedOfficialDrizzleBaseline,
  synchronizeDrizzleControl,
} from "../infrastructure/services/drizzle-baseline.ts";
import type { BackupResult, BackupService as BackupServicePort } from "../application/ports/persistence.ts";
import { detectDatabaseState } from "../infrastructure/services/database-state-detector.ts";
import { ORDERED_UPGRADE_STEPS, CURRENT_SCHEMA_MANIFEST, KNOWN_SCHEMA_MANIFESTS, type SqliteSchemaManifest } from "../infrastructure/schema/migration-catalog.ts";
import { UpgradeError } from "../infrastructure/services/upgrade-coordinator.ts";
import { createPublicFacade, type PublicApplicationFacade } from "./public-facade.ts";
import { LedgerReportService } from "./services/ledger-report-service.ts";

/**
 * Internal composition type (all raw services).
 * Only used within the application module.
 */
export type ApplicationFacade = {
  tenant: TenantService;
  bookSet: BookSetService;
  account: AccountService;
  idempotency: IdempotencyService;
  bookSetScope: BookSetScopeService;
};

/**
 * Public facade type (read-only operations + audited commands).
 * This is what escapes the application module.
 */
export type { PublicApplicationFacade } from "./public-facade.ts";

export interface SqliteBootstrapOptions {
  backupDestinationPath: string;
  cliVersion?: string;
  buildId?: string;
  now?: Date;
}

export interface SqliteDatabaseInitializationOptions {
  cliVersion?: string;
  buildId?: string;
  now?: Date;
}

export interface SqliteDatabaseUpgradeOptions extends SqliteDatabaseInitializationOptions {
  backupDestinationPath: string;
  faults?: {
    beforeLegacyMigration?: () => void | Promise<void>;
    beforeBaselineSeed?: () => void | Promise<void>;
    beforeOfficialMigration?: () => void | Promise<void>;
    beforeFinalVerification?: () => void | Promise<void>;
    beforeRestore?: () => void | Promise<void>;
  };
}

class ReusedVerifiedBackup implements BackupServicePort {
  constructor(private readonly backup: BackupResult) {}
  async createBackup(): Promise<BackupResult> { return this.backup; }
  async verifyBackup(): Promise<boolean> { return true; }
  async restoreFromBackup(): Promise<boolean> { return true; }
}

/**
 * Internal SQLite composition root (all raw services).
 * Only used within this module; does not escape.
 */
function createInternalSqliteApplication(
  dbPath: string,
  readerProtocol = 1,
  writerProtocol = 1,
): ApplicationFacade {
  const sessionRunner = BusinessSessionFactory.createSessionRunner(dbPath, "sqlite", readerProtocol, writerProtocol);
  return {
    tenant: new SqliteTenantService(sessionRunner),
    bookSet: new SqliteBookSetService(sessionRunner),
    account: new SqliteAccountService(sessionRunner),
    idempotency: new SqliteIdempotencyService(sessionRunner),
    bookSetScope: new BookSetScopeService(sessionRunner),
  };
}

/**
 * Public SQLite composition root. Returns public facade with read-only operations
 * and audited commands only. Raw service mutators and persistence handles remain internal.
 */
export function createSqliteApplication(
  dbPath: string,
  readerProtocol = 1,
  writerProtocol = 1,
): PublicApplicationFacade {
  const sessionRunner = BusinessSessionFactory.createSessionRunner(dbPath, "sqlite", readerProtocol, writerProtocol);
  const internal = {
    tenant: new SqliteTenantService(sessionRunner),
    bookSet: new SqliteBookSetService(sessionRunner),
    account: new SqliteAccountService(sessionRunner),
    idempotency: new SqliteIdempotencyService(sessionRunner),
    bookSetScope: new BookSetScopeService(sessionRunner),
  };
  return createPublicFacade(
    internal.tenant,
    internal.bookSet,
    internal.account,
    internal.bookSetScope,
    sessionRunner,
    new LedgerReportService(sessionRunner),
  );
}

/**
 * Explicit operator/test initialization: creates complete v8 schema with Drizzle baseline.
 * This is the fresh database path; never used for upgrades or existing databases.
 * Uses official Drizzle baseline migration instead of replaying legacy v0001..v0008 steps.
 */
export async function initializeSqliteDatabase(
  dbPath: string,
  options: SqliteDatabaseInitializationOptions = {},
): Promise<void> {
  const db = new SqliteAdapter({ path: dbPath });
  const now = options.now ?? new Date();
  try {
    const state = databaseState(dbPath);
    if (state.state !== "EMPTY" && state.state !== "DRIZZLE_MANAGED" && state.state !== "DRIZZLE_BRIDGED") {
      throw new Error("Database is neither empty nor a recognized Drizzle-managed database");
    }
    if (state.state !== "EMPTY") return;

    // The official migrator owns DDL, transaction boundaries, and its journal.
    db.runFreshDrizzleMigrations();
    // Control metadata is initialized only after the migrator has committed.
    await db.withMigrationLease((session) => initializeDrizzleControl(session, {
      cliVersion: options.cliVersion ?? "agent-bahi",
      buildId: options.buildId ?? "initialize",
      now,
    }).then(() => undefined));
  } finally {
    await db.close();
  }
}

/**
 * Explicit operator upgrade action. Normal application construction never
 * calls this function; callers must authorize backup and DDL themselves.
 */
export async function upgradeSqliteDatabase(
  dbPath: string,
  options: SqliteDatabaseUpgradeOptions,
): Promise<void> {
  let db: SqliteAdapter | undefined = new SqliteAdapter({ path: dbPath });
  let closed = false;
  let backup: BackupResult | undefined;
  let sourceManifest: SqliteSchemaManifest | undefined;
  let sourceState: ReturnType<typeof detectDatabaseState> | undefined;
  try {
    const state = databaseState(dbPath);
    sourceState = state;
    if (state.state === "DRIZZLE_MANAGED" || state.state === "DRIZZLE_BRIDGED") {
      const journal = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
      let pending = false;
      try {
        const count = journal.query(`SELECT COUNT(*) AS count FROM ${DRIZZLE_MIGRATIONS_TABLE}`).get() as { count?: number | bigint } | undefined;
        pending = Number(count?.count ?? 0) < officialDrizzleJournal().length;
      } finally { journal.close(); }
      if (pending) {
        const initialBackupService = new BackupService({ sourcePath: dbPath });
        backup = await initialBackupService.createBackup(options.backupDestinationPath);
        if (backup.status !== "SUCCESS" || !backup.path || !backup.manifest?.files[0]) throw new UpgradeError("UPGRADE_BACKUP_FAILED", "Verified invocation-start backup could not be created");
        await initialBackupService.verifyBackup(backup.path);
      }
      await options.faults?.beforeOfficialMigration?.();
      db.runFreshDrizzleMigrations();
      await db.withMigrationLease((session) => synchronizeDrizzleControl(session, {
        cliVersion: options.cliVersion ?? "agent-bahi",
        buildId: options.buildId ?? "upgrade",
        now: options.now ?? new Date(),
      }).then(() => undefined));
      await options.faults?.beforeFinalVerification?.();
      const finalState = databaseState(dbPath);
      if (finalState.state !== state.state) throw new UpgradeError("UPGRADE_APPLY_FAILED", "Official Drizzle migration did not preserve a valid state");
      return;
    }
    if (state.state === "EMPTY") throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Empty databases must be explicitly initialized before upgrade");
    const version = state.schemaVersion;
    sourceManifest = version === undefined ? undefined : KNOWN_SCHEMA_MANIFESTS.find((manifest) => manifest.schemaVersion === version);
    if (!sourceManifest || version === undefined || version < 2 || version > 8) throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Database state is not an exact supported legacy manifest");

    const initialBackupService = new BackupService({ sourcePath: dbPath, expectedSourceManifest: sourceManifest });
    backup = await initialBackupService.createBackup(options.backupDestinationPath, sourceManifest);
    if (backup.status !== "SUCCESS" || !backup.path || !backup.manifest?.files[0]) throw new UpgradeError("UPGRADE_BACKUP_FAILED", "Verified invocation-start backup could not be created");
    await initialBackupService.verifyBackup(backup.path, sourceManifest);
    const reusedBackup = new ReusedVerifiedBackup(backup);

    let schemaVersion = version;
    await options.faults?.beforeLegacyMigration?.();
    for (const step of ORDERED_UPGRADE_STEPS) {
      if (step.targetManifest.schemaVersion <= schemaVersion) continue;
      if (step.sourceManifest.schemaVersion !== schemaVersion) {
        throw new Error(`Database schema cannot advance from v${schemaVersion} with ${step.migration.id}`);
      }
      await new UpgradeCoordinator(db, reusedBackup).upgrade({
        plan: step,
        backupDestinationPath: backup.path,
        cliVersion: options.cliVersion ?? "agent-bahi",
        buildId: options.buildId ?? "upgrade",
        now: options.now ?? new Date(),
      });
      schemaVersion = step.targetManifest.schemaVersion;
    }
    await options.faults?.beforeBaselineSeed?.();
    await db.withMigrationLease((session) => seedOfficialDrizzleBaseline(session).then(() => undefined));
    await options.faults?.beforeOfficialMigration?.();
    db.runFreshDrizzleMigrations();
    await db.withMigrationLease((session) => synchronizeDrizzleControl(session, {
      cliVersion: options.cliVersion ?? "agent-bahi",
      buildId: options.buildId ?? "upgrade",
      now: options.now ?? new Date(),
    }).then(() => undefined));
    await options.faults?.beforeFinalVerification?.();
    if (databaseState(dbPath).state !== "DRIZZLE_BRIDGED") throw new UpgradeError("UPGRADE_APPLY_FAILED", "Explicit bridge did not reach exact DRIZZLE_BRIDGED state");
  } catch (error) {
    if (!backup?.path || !sourceState || (sourceState.state !== "DRIZZLE_MANAGED" && sourceState.state !== "DRIZZLE_BRIDGED" && !sourceManifest)) throw error;
    const original = error instanceof Error ? error.message : String(error);
    try {
      await db?.close();
      closed = true;
      await options.faults?.beforeRestore?.();
      await new BackupService(dbPath).restoreFromBackup(backup.path, dbPath, sourceManifest);
      const restored = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
      try {
        const restoredState = detectDatabaseState(restored);
        if (restoredState.state !== sourceState.state || restoredState.schemaVersion !== sourceState.schemaVersion) throw new Error("restored state differs from invocation-start state");
        const integrity = restored.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
        if (integrity.length !== 1 || String(Object.values(integrity[0] ?? {})[0]) !== "ok" || restored.prepare("PRAGMA foreign_key_check").all().length !== 0) throw new Error("restored integrity or foreign-key check failed");
      } finally { restored.close(); }
    } catch (restoreError) {
      try {
        const recoveryDb = new BunDatabase(dbPath);
        try {
          recoveryDb.exec("BEGIN IMMEDIATE");
          recoveryDb.exec("UPDATE database_control SET state = 'RECOVERY_REQUIRED', recovery_reason = 'Automatic upgrade restore failed; operator recovery required', updated_at = datetime('now') WHERE id = 1");
          recoveryDb.exec("COMMIT");
        } catch { try { recoveryDb.exec("ROLLBACK"); } catch { /* preserve restore failure */ } }
        recoveryDb.close();
      } catch { /* readiness remains blocked by the typed recovery result */ }
      const backupFile = backup.manifest?.files[0];
      throw new UpgradeError("RECOVERY_REQUIRED", `Upgrade failed and restore could not complete: ${original}; ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`, { path: backup.path, checksum: backupFile?.checksum ?? "", size: backupFile?.size ?? 0 });
    }
    const backupFile = backup.manifest?.files[0];
    throw new UpgradeError("UPGRADE_FAILED_RESTORED", `Upgrade failed and invocation-start backup was restored: ${original}`, { path: backup.path, checksum: backupFile?.checksum ?? "", size: backupFile?.size ?? 0 });
  } finally {
    if (db && !closed) await db.close();
  }
}

/** Explicit initialization followed by the explicit upgrade action. */
export async function initializeAndUpgradeSqliteDatabase(
  dbPath: string,
  options: SqliteDatabaseUpgradeOptions,
): Promise<void> {
  const state = databaseState(dbPath);
  if (state.state === "EMPTY") await initializeSqliteDatabase(dbPath, options);
  await upgradeSqliteDatabase(dbPath, options);
}

/** Explicit test/operator composition after initialization and upgrade. */
export async function initializeAndUpgradeSqliteApplication(
  dbPath: string,
  options: SqliteDatabaseUpgradeOptions,
): Promise<PublicApplicationFacade> {
  await initializeAndUpgradeSqliteDatabase(dbPath, options);
  return createSqliteApplication(dbPath);
}

/**
 * Side-effect-free compatibility status for CLI/MCP callers. It never creates
 * schema objects or runs migrations; an older valid database is UPDATE_REQUIRED.
 *
 * Status meanings:
 * - UNINITIALIZED: Empty or missing database (no migration history)
 * - UNAVAILABLE: Database exists but control metadata is missing/invalid
 * - LEGACY_V2..V7: Legacy custom databases requiring explicit upgrade
 * - CUSTOM_V8: Legacy v8 without Drizzle baseline
 * - UPDATE_REQUIRED: Drizzle-managed but not current version
 * - READY: Drizzle-managed and current version
 */
export async function inspectSqliteApplicationCompatibility(dbPath: string): Promise<{
  status: "UNINITIALIZED" | "UNAVAILABLE" | "LEGACY_V2" | "LEGACY_V3" | "LEGACY_V4" | "LEGACY_V5" | "LEGACY_V6" | "LEGACY_V7" | "CUSTOM_V8" | "UPDATE_REQUIRED" | "READY";
  currentSchemaVersion?: number;
  requiredSchemaVersion: number;
  currentDataFormatVersion?: number;
  requiredDataFormatVersion: number;
}> {
  const canonicalPath = assertSafeSqlitePath(dbPath);
  if (!(await Bun.file(canonicalPath).exists())) {
    return {
      status: "UNINITIALIZED",
      requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
      requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
    };
  }
  const native = new BunDatabase(canonicalPath, { readonly: true });
  try {
    const state = detectDatabaseState(native);
    if (state.state === "EMPTY") {
      return {
        status: "UNINITIALIZED",
        requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
        requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
      };
    }

    // Legacy v2-v7 states
    if (state.state === "LEGACY_V2" || state.state === "LEGACY_V3" || state.state === "LEGACY_V4" || state.state === "LEGACY_V5" || state.state === "LEGACY_V6" || state.state === "LEGACY_V7") {
      const control = native.query("SELECT schema_version, data_format_version, state FROM database_control WHERE id = 1").get() as { schema_version?: unknown; data_format_version?: unknown; state?: unknown } | undefined;
      if (!control) {
        return {
          status: state.state as any,
          requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
          requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
        };
      }
      return {
        status: state.state as any,
        currentSchemaVersion: Number(control.schema_version),
        requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
        currentDataFormatVersion: Number(control.data_format_version),
        requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
      };
    }

    // Custom v8 without Drizzle
    if (state.state === "CUSTOM_V8_WITHOUT_DRIZZLE") {
      const control = native.query("SELECT schema_version, data_format_version, state FROM database_control WHERE id = 1").get() as { schema_version?: unknown; data_format_version?: unknown; state?: unknown } | undefined;
      if (!control) {
        return {
          status: "CUSTOM_V8",
          requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
          requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
        };
      }
      return {
        status: "CUSTOM_V8",
        currentSchemaVersion: Number(control.schema_version),
        requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
        currentDataFormatVersion: Number(control.data_format_version),
        requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
      };
    }

    if (state.state === "DRIZZLE_BRIDGED") {
      const journal = native.query(`SELECT hash FROM ${DRIZZLE_MIGRATIONS_TABLE} ORDER BY created_at DESC, id DESC LIMIT 1`).get() as { hash?: unknown } | undefined;
      const ready = state.drizzleMigrationCount === officialDrizzleJournal().length && String(journal?.hash) === DRIZZLE_GST_HASH;
      return {
        status: ready ? "READY" : "UPDATE_REQUIRED",
        currentSchemaVersion: 8,
        requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
        currentDataFormatVersion: 1,
        requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
      };
    }

    // Drizzle-managed (fresh or upgraded)
    if (state.state === "DRIZZLE_MANAGED" && !state.hasLegacyMigrations) {
      const journal = native.query(`SELECT hash FROM ${DRIZZLE_MIGRATIONS_TABLE} ORDER BY created_at DESC, id DESC LIMIT 1`).get() as { hash?: unknown } | undefined;
      const control = native.query("SELECT schema_version, data_format_version, state FROM database_control WHERE id = 1").get() as { schema_version?: unknown; data_format_version?: unknown; state?: unknown } | undefined;
      if (!journal || !control) {
        return {
          status: "UNAVAILABLE",
          requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
          requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
        };
      }
      const ready = Number(control.schema_version) === 8
        && Number(control.data_format_version) === 1
        && String(control.state) === "READY"
        && String(journal.hash) === DRIZZLE_GST_HASH
        && state.drizzleMigrationCount === officialDrizzleJournal().length;
      return {
        status: ready ? "READY" : "UPDATE_REQUIRED",
        currentSchemaVersion: Number(control.schema_version),
        requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
        currentDataFormatVersion: Number(control.data_format_version),
        requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
      };
    }

    // Unknown or hybrid
    return {
      status: "UNAVAILABLE",
      requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
      requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
    };
  } finally {
    native.close();
  }
}

/** Normal construction is side-effect free; callers must choose explicit upgrade separately. */
export function bootstrapSqliteApplication(dbPath: string): PublicApplicationFacade {
  return createSqliteApplication(dbPath);
}

function databaseState(dbPath: string): ReturnType<typeof detectDatabaseState> {
  const native = new BunDatabase(dbPath);
  try {
    return detectDatabaseState(native);
  } finally {
    native.close();
  }
}
