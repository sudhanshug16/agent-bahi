import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { CompanyStatusBackupStatus, CompanyStatusBackupStatusProvider } from "../../application/services/company-status-service.ts";
import { BackupService } from "./backup-service.ts";
import { defaultBackupDirectory } from "./backup-paths.ts";

const BACKUP_SUFFIX = ".backup";

/**
 * Read-only provider for the canonical local backup directory.
 *
 * Discovery is deliberately narrow: only regular local files ending in
 * `.backup` are candidates. Every candidate is independently verified; one
 * invalid candidate blocks the aggregate result rather than being ignored.
 */
export function createSqliteBackupStatusProvider(databasePath: string): CompanyStatusBackupStatusProvider {
  return async (): Promise<CompanyStatusBackupStatus> => {
    let directory: string;
    try {
      directory = defaultBackupDirectory(databasePath);
    } catch {
      return blockedStatus(0, 0);
    }

    let entries: Dirent[];
    try {
      if (!existsSync(directory)) return unknownStatus();
      if (!lstatSync(directory).isDirectory()) return blockedStatus(1, 0);
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return blockedStatus(0, 0);
    }

    const candidates = entries.filter((entry) => entry.name.endsWith(BACKUP_SUFFIX));
    if (candidates.length === 0) return unknownStatus();

    let verifiedCount = 0;
    let latestVerifiedAt: string | undefined;
    let backup: BackupService | undefined;
    try {
      backup = new BackupService(databasePath);
    } catch {
      return blockedStatus(candidates.length, 0);
    }

    for (const candidate of candidates) {
      const candidatePath = join(directory, candidate.name);
      try {
        // VerifyBackup performs the regular-file, sidecar, SQLite integrity,
        // catalog, migration-history, and control-state checks. It does not
        // create, alter, or delete the candidate.
        await backup.verifyBackup(candidatePath);
        verifiedCount += 1;
        const modifiedAt = statSync(candidatePath).mtime.toISOString();
        if (!latestVerifiedAt || modifiedAt > latestVerifiedAt) latestVerifiedAt = modifiedAt;
      } catch {
        return blockedStatus(candidates.length, verifiedCount);
      }
    }

    return {
      status: "VERIFIED",
      candidateCount: candidates.length,
      verifiedCount,
      ...(latestVerifiedAt ? { latestVerifiedAt } : {}),
    };
  };
}

function unknownStatus(): CompanyStatusBackupStatus {
  return { status: "UNKNOWN", candidateCount: 0, verifiedCount: 0 };
}

function blockedStatus(candidateCount: number, verifiedCount: number): CompanyStatusBackupStatus {
  return {
    status: "BLOCKED",
    candidateCount,
    verifiedCount,
    blockerCode: "BACKUP_VERIFICATION_FAILED",
  };
}
