import type { MigrationDefinition, MigrationVerificationManifest, MigrationVerificationProbe, MigrationSession } from "./persistence.ts";
import type { SqliteSchemaManifest } from "../../infrastructure/schema/current-manifest.ts";

export type UpgradeErrorCode =
  | "UPGRADE_PREFLIGHT_FAILED"
  | "UPGRADE_SOURCE_MISMATCH"
  | "UPGRADE_BACKUP_FAILED"
  | "UPGRADE_IDEMPOTENCY_CONFLICT"
  | "UPGRADE_RECOVERY_REQUIRED"
  | "UPGRADE_OUTCOME_UNCERTAIN"
  | "UPGRADE_APPLY_FAILED";

export interface UpgradeBackupReference {
  readonly path: string;
  readonly checksum: string;
  readonly size: number;
}

/** A probe is data, not executable application code. It must be one bounded SELECT. */
export interface UpgradePreflightProbe extends MigrationVerificationProbe {
  readonly maxRows?: number;
}

export interface UpgradePlan {
  readonly sourceManifest: SqliteSchemaManifest;
  readonly targetManifest: SqliteSchemaManifest;
  readonly migration: MigrationDefinition;
  readonly preflightProbes: readonly UpgradePreflightProbe[];
  readonly targetVerificationProbes?: readonly UpgradePreflightProbe[];
  readonly targetVerificationManifest?: MigrationVerificationManifest;
}

export interface UpgradeRequest {
  readonly plan: UpgradePlan;
  /** Safe, no-replace destination. The coordinator creates and owns verification. */
  readonly backupDestinationPath: string;
  readonly cliVersion: string;
  readonly buildId: string;
  readonly now?: Date;
  readonly timeoutMs?: number;
}

export interface UpgradeResult {
  readonly status: "APPLIED" | "ALREADY_APPLIED";
  readonly backup?: UpgradeBackupReference;
  readonly sourceManifestHash: string;
  readonly targetManifestHash: string;
}

export type UpgradeRecoveryRequest = (UpgradeRequest & {
  readonly reason: string;
}) | {
  readonly request: UpgradeRequest;
  readonly reason: string;
};

export interface UpgradeRecoveryResult {
  readonly status: "ROLLED_BACK" | "APPLIED" | "RECOVERY_REQUIRED";
  readonly reason?: string;
}

export interface UpgradeCoordinatorPort {
  upgrade(request: UpgradeRequest): Promise<UpgradeResult>;
  recover(request: UpgradeRecoveryRequest): Promise<UpgradeRecoveryResult>;
  close(): Promise<void>;
}

/** Internal-only seam. It has no public database or connection handle. */
export interface UpgradeCoordinatorFaults {
  readonly afterCommit?: () => void | Promise<void>;
  readonly beforeApply?: (session: MigrationSession) => void | Promise<void>;
  readonly beforeTargetVerification?: (session: MigrationSession) => void | Promise<void>;
}
