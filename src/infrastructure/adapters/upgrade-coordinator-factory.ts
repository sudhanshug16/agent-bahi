import type { UpgradeCoordinatorFaults, UpgradeCoordinatorPort } from "../../application/ports/upgrade.ts";
import type { Dialect } from "../../core/types.ts";
import { SqliteAdapter } from "./sqlite-adapter.ts";
import { BackupService } from "../services/backup-service.ts";
import { UpgradeCoordinator } from "../services/upgrade-coordinator.ts";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";

/** Upgrade composition boundary. It intentionally returns no raw connection or service. */
export class UpgradeCoordinatorFactory {
  static createCoordinator(
    dbPath: string,
    dialect: Dialect = "sqlite",
    faults?: UpgradeCoordinatorFaults,
  ): UpgradeCoordinatorPort {
    if (dialect !== "sqlite") throw new Error(`Only sqlite dialect is supported, got ${dialect}`);
    const safePath = assertSafeSqlitePath(dbPath);
    const database = new SqliteAdapter({ path: safePath });
    const backup = new BackupService(safePath);
    return new UpgradeCoordinator(database, backup, faults);
  }
}
