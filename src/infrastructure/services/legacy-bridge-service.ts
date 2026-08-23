/**
 * Legacy database bridge: v2-v8 custom -> Drizzle baseline.
 *
 * Handles two scenarios:
 * 1. v2-v7 legacy databases: mark as ready to migrate, verified v8 reached
 * 2. Custom v8 databases: baseline to Drizzle journal without DDL
 *
 * Failure after backup triggers automatic restore. Unknown/tampered/hybrid schemas fail closed.
 */

import { Database as BunDatabase } from "bun:sqlite";
import type { BackupService } from "../../application/ports/persistence.ts";
import { DomainError } from "../../core/types.ts";
import { V8_SCHEMA_MANIFEST, type SqliteSchemaManifest } from "../schema/migration-catalog.ts";
import { detectDatabaseState, type DatabaseState } from "./database-state-detector.ts";

export type LegacyBridgeErrorCode =
  | "LEGACY_BRIDGE_UNKNOWN_STATE"
  | "LEGACY_BRIDGE_CHECKSUM_MISMATCH"
  | "LEGACY_BRIDGE_HYBRID_SCHEMA"
  | "LEGACY_BRIDGE_PARTIAL_MIGRATION"
  | "LEGACY_BRIDGE_UPGRADE_FAILED"
  | "LEGACY_BRIDGE_BASELINE_FAILED"
  | "LEGACY_BRIDGE_RESTORE_FAILED"
  | "LEGACY_BRIDGE_RECOVERY_REQUIRED";

export class LegacyBridgeError extends DomainError {
  readonly backupPath?: string;

  constructor(code: LegacyBridgeErrorCode, message: string, backupPath?: string) {
    super(code, message, backupPath ? { backup: backupPath } : undefined);
    this.backupPath = backupPath;
  }
}

export interface LegacyBridgeOptions {
  readonly cliVersion: string;
  readonly buildId: string;
  readonly now: Date;
  readonly backupService?: BackupService;
  readonly backupDestinationPath?: string;
}

export interface LegacyBridgeResult {
  readonly state: DatabaseState;
  readonly version?: number;
  readonly requiresUpgrade: boolean;
  readonly backupPath?: string;
}

interface LegacyDatabaseRecord {
  readonly state: DatabaseState;
  readonly version: number;
}

/**
 * Detect and validate legacy database state for bridging.
 * Returns the detected state or throws if tampered/hybrid.
 */
export function detectLegacyState(db: BunDatabase): LegacyDatabaseRecord {
  const state = detectDatabaseState(db);

  // UNKNOWN or hybrid: fail closed
  if (state.state === "UNKNOWN") {
    throw new LegacyBridgeError(
      state.hasDrizzleMigrations && state.hasLegacyMigrations ? "LEGACY_BRIDGE_HYBRID_SCHEMA" : "LEGACY_BRIDGE_UNKNOWN_STATE",
      "Database state is unknown or tampered and cannot be bridged"
    );
  }

  // EMPTY: no bridge needed, already covered by fresh initialization
  if (state.state === "EMPTY") {
    throw new LegacyBridgeError("LEGACY_BRIDGE_UNKNOWN_STATE", "Database is empty");
  }

  // DRIZZLE_MANAGED with no legacy history: already current
  if (state.state === "DRIZZLE_MANAGED" && !state.hasLegacyMigrations) {
    throw new LegacyBridgeError("LEGACY_BRIDGE_UNKNOWN_STATE", "Database is already Drizzle-managed");
  }

  // Extract version number from state string
  const versionMatch = state.state.match(/LEGACY_V(\d+)|CUSTOM_V(\d+)/);
  const version = versionMatch ? (Number(versionMatch[1]) || Number(versionMatch[2])) : NaN;
  if (!Number.isSafeInteger(version) || version < 2 || version > 8) {
    throw new LegacyBridgeError("LEGACY_BRIDGE_UNKNOWN_STATE", `Unsupported database version: ${state.state}`);
  }

  return { state: state.state, version };
}

/**
 * Inspect legacy database without mutation.
 * Returns status and version info for CLI/status reporting.
 */
export function inspectLegacyDatabase(db: BunDatabase): LegacyBridgeResult {
  try {
    const legacy = detectLegacyState(db);
    const requiresUpgrade = legacy.version < 8 || legacy.state === "CUSTOM_V8_WITHOUT_DRIZZLE";

    return {
      state: legacy.state,
      version: legacy.version,
      requiresUpgrade,
    };
  } catch (error) {
    if (error instanceof LegacyBridgeError) {
      throw error;
    }
    throw new LegacyBridgeError(
      "LEGACY_BRIDGE_UNKNOWN_STATE",
      `Failed to inspect legacy database: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
