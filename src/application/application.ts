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
import { BOOKSET_V3_UPGRADE_PLAN, BOOKSET_V4_UPGRADE_PLAN, JOURNAL_V5_UPGRADE_PLAN } from "../infrastructure/schema/upgrade-plans.ts";
import { CORE_MIGRATIONS } from "../infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_MIGRATIONS } from "../infrastructure/schema/database-control-schema.ts";
import { V2_SCHEMA_MANIFEST, V3_SCHEMA_MANIFEST, V4_SCHEMA_MANIFEST } from "../infrastructure/schema/current-manifest.ts";
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

/**
 * Each upgrade hop gets its own deterministic, no-replace artifact. The
 * coordinator owns collision handling, so an existing path is never replaced
 * or silently reused for a different hop.
 */
function backupDestinationForHop(basePath: string, hop: "v2-to-v3" | "v3-to-v4" | "v4-to-v5"): string {
  return basePath.endsWith(".sqlite")
    ? `${basePath.slice(0, -".sqlite".length)}.${hop}.sqlite`
    : `${basePath}.${hop}.sqlite`;
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
 * Production bootstrap. The v2 foundation is initialized first, then the
 * immutable coordinator applies 0003 (v2->v3) and 0004 (v3->v4) in sequence.
 * Returns the public facade.
 */
export async function bootstrapSqliteApplication(
  dbPath: string,
  options: SqliteBootstrapOptions,
): Promise<PublicApplicationFacade> {
  const db = new SqliteAdapter({ path: dbPath });
  const now = options.now ?? new Date();
  try {
    await new MigrationService(db, "sqlite").migrate([
      { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
      { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
    ]);
    const control = new DatabaseControlService(db, "sqlite");
    await db.withMigrationLease((session) => control.initialize({
      cliVersion: options.cliVersion ?? "agent-bahi",
      buildId: options.buildId ?? "bootstrap",
      now,
    }, session).then(() => undefined));

    const inspection = await control.inspect();
    if (inspection.status !== "AVAILABLE" || !inspection.record) {
      throw new Error("Database control did not converge to a known foundation state");
    }

    // Every versioned upgrade uses the coordinator
    // and its verified pre-DDL backup boundary.
    if (inspection.record.schemaVersion === V2_SCHEMA_MANIFEST.schemaVersion) {
      await new UpgradeCoordinator(db, new BackupService({
        sourcePath: dbPath,
        expectedSourceManifest: V2_SCHEMA_MANIFEST,
      })).upgrade({
        plan: BOOKSET_V3_UPGRADE_PLAN,
        backupDestinationPath: backupDestinationForHop(options.backupDestinationPath, "v2-to-v3"),
        cliVersion: options.cliVersion ?? "agent-bahi",
        buildId: options.buildId ?? "bootstrap",
        now,
      });
    }

    const postV3Inspection = await new DatabaseControlService(db, "sqlite", V3_SCHEMA_MANIFEST).inspect();
    if (postV3Inspection.status === "AVAILABLE" && postV3Inspection.record?.schemaVersion === V3_SCHEMA_MANIFEST.schemaVersion) {
      await new UpgradeCoordinator(db, new BackupService({
        sourcePath: dbPath,
        expectedSourceManifest: V3_SCHEMA_MANIFEST,
      })).upgrade({
        plan: BOOKSET_V4_UPGRADE_PLAN,
        backupDestinationPath: backupDestinationForHop(options.backupDestinationPath, "v3-to-v4"),
        cliVersion: options.cliVersion ?? "agent-bahi",
        buildId: options.buildId ?? "bootstrap",
        now,
      });
    }

    const postV4Inspection = await new DatabaseControlService(db, "sqlite", V4_SCHEMA_MANIFEST).inspect();
    if (postV4Inspection.status === "AVAILABLE" && postV4Inspection.record?.schemaVersion === V4_SCHEMA_MANIFEST.schemaVersion) {
      await new UpgradeCoordinator(db, new BackupService({
        sourcePath: dbPath,
        expectedSourceManifest: V4_SCHEMA_MANIFEST,
      })).upgrade({
        plan: JOURNAL_V5_UPGRADE_PLAN,
        backupDestinationPath: backupDestinationForHop(options.backupDestinationPath, "v4-to-v5"),
        cliVersion: options.cliVersion ?? "agent-bahi",
        buildId: options.buildId ?? "bootstrap",
        now,
      });
    }
  } finally {
    await db.close();
  }
  return createSqliteApplication(dbPath);
}
