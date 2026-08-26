import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";

/** Canonical local directory used by implicit database backup operations. */
export function defaultBackupDirectory(databasePath: string): string {
  const canonical = assertSafeSqlitePath(databasePath);
  return `${canonical}.backups`;
}
