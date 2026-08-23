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
import { MigrationService } from "../infrastructure/services/migration-service.ts";
import { DatabaseControlService } from "../infrastructure/services/database-control-service.ts";
import { BackupService } from "../infrastructure/services/backup-service.ts";
import { UpgradeCoordinator } from "../infrastructure/services/upgrade-coordinator.ts";
import {
  DRIZZLE_MIGRATIONS_TABLE,
  initializeDrizzleControl,
} from "../infrastructure/services/drizzle-baseline.ts";
import { detectDatabaseState } from "../infrastructure/services/database-state-detector.ts";
import { FOUNDATION_MIGRATIONS, ORDERED_UPGRADE_STEPS, CURRENT_SCHEMA_MANIFEST } from "../infrastructure/schema/migration-catalog.ts";
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
}

/**
 * Each upgrade hop gets its own deterministic, no-replace artifact. The
 * coordinator owns collision handling, so an existing path is never replaced
 * or silently reused for a different hop.
 */
function backupDestinationForStep(basePath: string, stepId: string): string {
  if (!/^\d{4}-[a-z0-9-]+$/.test(stepId)) throw new Error("Migration step id is not a safe backup suffix");
  return basePath.endsWith(".sqlite")
    ? `${basePath.slice(0, -".sqlite".length)}.${stepId}.sqlite`
    : `${basePath}.${stepId}.sqlite`;
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
    if (state.hasLegacyMigrations) {
      // Existing legacy fixtures/databases remain on the legacy foundation
      // path until the separately scoped bridge is implemented.
      await new MigrationService(db, "sqlite").migrate(FOUNDATION_MIGRATIONS);
      const control = new DatabaseControlService(db, "sqlite");
      await db.withMigrationLease((session) => control.initialize({
        cliVersion: options.cliVersion ?? "agent-bahi",
        buildId: options.buildId ?? "initialize",
        now,
      }, session).then(() => undefined));
      return;
    }

    if (state.state !== "EMPTY" && state.state !== "DRIZZLE_MANAGED") {
      throw new Error("Database is neither empty nor a recognized Drizzle-managed database");
    }

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
  const db = new SqliteAdapter({ path: dbPath });
  const now = options.now ?? new Date();
  try {
    const state = databaseState(dbPath);
    if (state.state === "DRIZZLE_MANAGED" && !state.hasLegacyMigrations) {
      // No legacy bridge or Drizzle upgrade migration is part of this slice.
      // Fresh v8 databases are already at the current product baseline.
      return;
    }
    const control = new DatabaseControlService(db, "sqlite");
    const inspection = await control.inspect();
    if (inspection.status !== "AVAILABLE" || !inspection.record) {
      throw new Error("Database is not initialized for an explicit upgrade");
    }
    let schemaVersion = inspection.record.schemaVersion;
    for (const step of ORDERED_UPGRADE_STEPS) {
      if (step.targetManifest.schemaVersion <= schemaVersion) continue;
      if (step.sourceManifest.schemaVersion !== schemaVersion) {
        throw new Error(`Database schema cannot advance from v${schemaVersion} with ${step.migration.id}`);
      }
      await new UpgradeCoordinator(db, new BackupService({
        sourcePath: dbPath,
        expectedSourceManifest: step.sourceManifest,
      })).upgrade({
        plan: step,
        backupDestinationPath: backupDestinationForStep(options.backupDestinationPath, step.migration.id),
        cliVersion: options.cliVersion ?? "agent-bahi",
        buildId: options.buildId ?? "upgrade",
        now,
      });
      schemaVersion = step.targetManifest.schemaVersion;
    }
    const finalInspection = await new DatabaseControlService(db, "sqlite", CURRENT_SCHEMA_MANIFEST).inspect();
    if (finalInspection.status !== "AVAILABLE" || finalInspection.record?.schemaVersion !== CURRENT_SCHEMA_MANIFEST.schemaVersion) {
      throw new Error("Explicit database upgrade did not reach the latest catalog manifest");
    }
  } finally {
    await db.close();
  }
}

/** Explicit initialization followed by the explicit upgrade action. */
export async function initializeAndUpgradeSqliteDatabase(
  dbPath: string,
  options: SqliteDatabaseUpgradeOptions,
): Promise<void> {
  await initializeSqliteDatabase(dbPath, options);
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
 */
export async function inspectSqliteApplicationCompatibility(dbPath: string): Promise<{
  status: "UNINITIALIZED" | "UNAVAILABLE" | "UPDATE_REQUIRED" | "READY";
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
        && /^[0-9a-f]{64}$/.test(String(journal.hash));
      return {
        status: ready ? "READY" : "UPDATE_REQUIRED",
        currentSchemaVersion: Number(control.schema_version),
        requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
        currentDataFormatVersion: Number(control.data_format_version),
        requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
      };
    }
    const control = native.query("SELECT schema_version, data_format_version, state FROM database_control WHERE id = 1").get() as { schema_version?: unknown; data_format_version?: unknown; state?: unknown } | undefined;
    if (!control) {
      return {
        status: "UNAVAILABLE",
        requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
        requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
      };
    }
    const currentSchemaVersion = Number(control.schema_version);
    const currentDataFormatVersion = Number(control.data_format_version);
    return {
      status: currentSchemaVersion === CURRENT_SCHEMA_MANIFEST.schemaVersion && currentDataFormatVersion === CURRENT_SCHEMA_MANIFEST.dataFormatVersion && String(control.state) === "READY" ? "READY" : "UPDATE_REQUIRED",
      currentSchemaVersion,
      requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
      currentDataFormatVersion,
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
