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
import { BOOKSET_V3_UPGRADE_PLAN } from "../infrastructure/schema/upgrade-plans.ts";
import { CORE_MIGRATIONS } from "../infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_MIGRATIONS } from "../infrastructure/schema/database-control-schema.ts";
import { V2_SCHEMA_MANIFEST } from "../infrastructure/schema/current-manifest.ts";

export type ApplicationFacade = {
  tenant: TenantService;
  bookSet: BookSetService;
  account: AccountService;
  idempotency: IdempotencyService;
  bookSetScope: BookSetScopeService;
};

export interface SqliteBootstrapOptions {
  backupDestinationPath: string;
  cliVersion?: string;
  buildId?: string;
  now?: Date;
}

/**
 * Production SQLite composition root. Only typed application services escape;
 * database adapters, runners, sessions, and native handles remain internal.
 */
export function createSqliteApplication(
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
 * Production bootstrap. The v2 foundation is initialized first, then the
 * immutable coordinator applies 0003 while no business session exists.
 */
export async function bootstrapSqliteApplication(
  dbPath: string,
  options: SqliteBootstrapOptions,
): Promise<ApplicationFacade> {
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
    if (inspection.record.schemaVersion === V2_SCHEMA_MANIFEST.schemaVersion) {
      await new UpgradeCoordinator(db, new BackupService({
        sourcePath: dbPath,
        expectedSourceManifest: V2_SCHEMA_MANIFEST,
      })).upgrade({
        plan: BOOKSET_V3_UPGRADE_PLAN,
        backupDestinationPath: options.backupDestinationPath,
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
