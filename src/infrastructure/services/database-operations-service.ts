import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { Database as BunDatabase } from "bun:sqlite";
import { DomainError } from "../../core/types.ts";
import { CLI_VERSION, BUILD_COMMIT, PROTOCOL_VERSION, pathHash } from "../../release.ts";
import { versionResult } from "../../release.ts";
import { inspectSqliteApplicationCompatibility, upgradeSqliteDatabase } from "../../application/application.ts";
import { BackupService } from "./backup-service.ts";
import { CURRENT_SCHEMA_MANIFEST, KNOWN_SCHEMA_MANIFESTS, ORDERED_UPGRADE_STEPS } from "../schema/migration-catalog.ts";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";
import { detectDatabaseState } from "./database-state-detector.ts";
import { appendOperationReceipt, receiptDatabasePathHash, type OperationReceipt } from "./operation-receipt.ts";

export type CompatibilityStatus = "CURRENT" | "UPGRADE_REQUIRED" | "CLI_TOO_OLD" | "DIRTY_IN_PROGRESS" | "UNKNOWN_TAMPERED" | "UNINITIALIZED";

export interface CompatibilityResult {
  readonly status: CompatibilityStatus;
  readonly databasePathHash: string;
  readonly currentSchemaVersion?: number;
  readonly currentDataFormatVersion?: number;
  readonly requiredSchemaVersion: number;
  readonly requiredDataFormatVersion: number;
  readonly cliVersion: string;
  readonly remediation: { readonly command: string; readonly reason: string };
}

export interface OperationContext {
  readonly requestId: string;
  readonly actor: { readonly kind: "HUMAN"; readonly id: string };
  readonly yes: boolean;
}

const backupSuffix = ".backup";

function requireAbsolutePath(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || !value.startsWith("/")) throw new DomainError("INVALID_INPUT", `${field} must be an absolute path`);
  return value;
}

function requireContext(input: Record<string, unknown>): OperationContext {
  const requestId = input.requestId;
  const actor = input.actor;
  if (typeof requestId !== "string" || requestId.trim() === "") throw new DomainError("INVALID_INPUT", "requestId is required");
  if (!actor || typeof actor !== "object" || Array.isArray(actor) || (actor as Record<string, unknown>).kind !== "HUMAN" || typeof (actor as Record<string, unknown>).id !== "string" || String((actor as Record<string, unknown>).id).trim() === "") {
    throw new DomainError("INVALID_INPUT", "actor must be {kind: HUMAN, id}");
  }
  if (input.yes !== true) throw new DomainError("CONFIRMATION_REQUIRED", "Mutating database operations require --yes confirmation");
  return { requestId, actor: { kind: "HUMAN", id: String((actor as Record<string, unknown>).id) }, yes: true };
}

function safeReadOnlyDatabase(path: string): BunDatabase | undefined {
  const canonical = assertSafeSqlitePath(path);
  if (!existsSync(canonical)) return undefined;
  try { return new BunDatabase(canonical, { readonly: true, safeIntegers: true, strict: true }); } catch { return undefined; }
}

function table(db: BunDatabase, name: string): boolean {
  return !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(name);
}

function migrationManifest(schemaVersion: number | undefined) {
  return KNOWN_SCHEMA_MANIFESTS.find((manifest) => manifest.schemaVersion === schemaVersion);
}

function remediation(path: string, status: CompatibilityStatus, requestId = "<request-id>"): CompatibilityResult["remediation"] {
  const command = status === "UNINITIALIZED"
    ? `agent-bahi --database ${path} db status`
    : status === "CURRENT"
      ? `agent-bahi --database ${path} db status`
      : `agent-bahi --database ${path} db upgrade apply --request-id ${requestId} --actor-id <human-id> --yes`;
  const reason = status === "CLI_TOO_OLD" ? "Update the Agent-Bahi binary before inspecting or changing this database."
    : status === "DIRTY_IN_PROGRESS" ? "Stop concurrent database work and resolve the recorded recovery state before retrying."
      : status === "UNKNOWN_TAMPERED" ? "Do not repair in place; inspect the verified backup and use the explicit restore workflow."
        : status === "UPGRADE_REQUIRED" ? "Update the binary, then run the explicit database upgrade command."
          : "No database mutation is required.";
  return { command, reason };
}

export async function inspectDatabaseCompatibility(databasePath: string, cliVersion = CLI_VERSION): Promise<CompatibilityResult> {
  const canonical = assertSafeSqlitePath(databasePath);
  const base = { databasePathHash: pathHash(canonical), requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion, requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion, cliVersion };
  const db = safeReadOnlyDatabase(canonical);
  if (!db) {
    const result = { ...base, status: "UNINITIALIZED" as const };
    return { ...result, remediation: remediation(canonical, result.status) };
  }
  try {
    if (table(db, "database_control")) {
      const control = db.query("SELECT schema_version, data_format_version, reader_compatibility_min, state, recovery_reason FROM database_control WHERE id = 1").get() as Record<string, unknown> | undefined;
      const historyDirty = table(db, "schema_migrations") && !!db.query("SELECT 1 FROM schema_migrations WHERE status IN ('DIRTY', 'APPLYING') LIMIT 1").get();
      if (String(control?.state) === "APPLYING" || String(control?.state) === "RECOVERY_REQUIRED" || historyDirty) {
        const result = { ...base, status: "DIRTY_IN_PROGRESS" as const, currentSchemaVersion: Number(control?.schema_version), currentDataFormatVersion: Number(control?.data_format_version) };
        return { ...result, remediation: remediation(canonical, result.status) };
      }
      if (Number(control?.reader_compatibility_min) > PROTOCOL_VERSION) {
        const result = { ...base, status: "CLI_TOO_OLD" as const, currentSchemaVersion: Number(control?.schema_version), currentDataFormatVersion: Number(control?.data_format_version) };
        return { ...result, remediation: remediation(canonical, result.status) };
      }
    }
    const state = detectDatabaseState(db);
    if (state.state === "EMPTY") {
      const result = { ...base, status: "UNINITIALIZED" as const };
      return { ...result, remediation: remediation(canonical, result.status) };
    }
    if (state.state === "DRIZZLE_MANAGED" || state.state === "DRIZZLE_BRIDGED") {
      const inspected = await inspectSqliteApplicationCompatibility(canonical);
      const result = { ...base, status: inspected.status === "READY" ? "CURRENT" as const : "UPGRADE_REQUIRED" as const, currentSchemaVersion: inspected.currentSchemaVersion, currentDataFormatVersion: inspected.currentDataFormatVersion };
      return { ...result, remediation: remediation(canonical, result.status) };
    }
    if (state.state.startsWith("LEGACY_") || state.state === "CUSTOM_V8_WITHOUT_DRIZZLE") {
      const result = { ...base, status: "UPGRADE_REQUIRED" as const, currentSchemaVersion: state.schemaVersion, currentDataFormatVersion: 1 };
      return { ...result, remediation: remediation(canonical, result.status) };
    }
    const result = { ...base, status: "UNKNOWN_TAMPERED" as const };
    return { ...result, remediation: remediation(canonical, result.status) };
  } catch {
    const result = { ...base, status: "UNKNOWN_TAMPERED" as const };
    return { ...result, remediation: remediation(canonical, result.status) };
  } finally { db.close(); }
}

export function defaultBackupDirectory(databasePath: string): string {
  const canonical = assertSafeSqlitePath(databasePath);
  return `${canonical}.backups`;
}

function checksum(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function backupView(path: string): Record<string, unknown> {
  const canonical = assertSafeSqlitePath(path);
  if (!existsSync(canonical) || !lstatSync(canonical).isFile()) throw new DomainError("BACKUP_NOT_FOUND", "Backup file was not found");
  const stat = statSync(canonical);
  return { name: basename(canonical), pathHash: pathHash(canonical), size: stat.size, fileHash: checksum(canonical), modifiedAt: stat.mtime.toISOString() };
}

function assertExpectedBackupHash(path: string, expected: unknown): Record<string, unknown> {
  const view = backupView(path);
  if (expected !== undefined && (typeof expected !== "string" || expected !== view.fileHash)) {
    throw new DomainError("BACKUP_VERIFICATION_FAILED", "Backup hash does not match the requested verified hash");
  }
  return view;
}

function destinationFor(databasePath: string, input: Record<string, unknown>, requestId: string): string {
  const explicit = input.destinationPath ?? input.backupDestinationPath;
  if (explicit !== undefined) return requireAbsolutePath(explicit, "destinationPath");
  return join(defaultBackupDirectory(databasePath), `${requestId}${backupSuffix}`);
}

function ensureDefaultBackupDirectory(databasePath: string, input: Record<string, unknown>): void {
  if (input.destinationPath === undefined && input.backupDestinationPath === undefined && input.safetyBackupPath === undefined) {
    mkdirSync(defaultBackupDirectory(databasePath), { recursive: true, mode: 0o700 });
  }
}

function manifestForCompatibility(compatibility: CompatibilityResult) {
  return migrationManifest(compatibility.currentSchemaVersion) ?? CURRENT_SCHEMA_MANIFEST;
}

function makeReceipt(databasePath: string, operation: string, context: OperationContext, startedAt: string, outcome: OperationReceipt["outcome"], extra: Partial<OperationReceipt> = {}): OperationReceipt {
  const completedAt = new Date().toISOString();
  return { schemaVersion: 1, operation, requestId: context.requestId, actor: context.actor, cliVersion: CLI_VERSION, buildCommit: BUILD_COMMIT, databasePathHash: receiptDatabasePathHash(databasePath), startedAt, completedAt, durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)), outcome, ...extra };
}

function writeReceipt(databasePath: string, receipt: OperationReceipt): void {
  try {
    appendOperationReceipt(databasePath, receipt);
  } catch {
    throw new DomainError("OPERATION_RECEIPT_FAILED", "Operation receipt could not be durably appended; treat the database operation outcome as requiring operator review");
  }
}

export async function databaseOperation(operation: string, databasePath: string, input: Record<string, unknown>): Promise<unknown> {
  // Version is metadata-only and must remain usable before a database exists.
  if (operation === "system.version") return versionResult();
  const canonical = assertSafeSqlitePath(databasePath);
  if (operation === "database.compatibility") return inspectDatabaseCompatibility(canonical);
  if (operation === "database.status") return inspectSqliteApplicationCompatibility(canonical);
  if (operation === "database.upgrade.preview") {
    const compatibility = await inspectDatabaseCompatibility(canonical);
    const from = compatibility.currentSchemaVersion ?? 0;
    const migrations = compatibility.status === "UPGRADE_REQUIRED" && Number.isSafeInteger(from)
      ? ORDERED_UPGRADE_STEPS.filter((step) => step.sourceManifest.schemaVersion >= from && step.targetManifest.schemaVersion <= CURRENT_SCHEMA_MANIFEST.schemaVersion).map((step) => ({ id: step.migration.id, checksum: step.targetManifest.migrations.at(-1)!.checksum, fromSchemaVersion: step.sourceManifest.schemaVersion, toSchemaVersion: step.targetManifest.schemaVersion }))
      : [];
    return { compatibility, fromSchemaVersion: compatibility.currentSchemaVersion, toSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion, fromDataFormatVersion: compatibility.currentDataFormatVersion, toDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion, migrations, migrationIds: migrations.map((migration) => migration.id), checksums: migrations.map((migration) => migration.checksum), requiresUpgrade: compatibility.status === "UPGRADE_REQUIRED" };
  }
  if (operation === "database.upgrade.status") {
    const compatibility = await inspectDatabaseCompatibility(canonical);
    const receiptFile = `${canonical}.agent-bahi-receipts.jsonl`;
    let lastReceipt: unknown;
    if (existsSync(receiptFile)) {
      const lines = readFileSync(receiptFile, "utf8").trim().split("\n").filter(Boolean);
      try { lastReceipt = lines.length ? JSON.parse(lines.at(-1)!) : undefined; } catch { lastReceipt = { status: "UNKNOWN_TAMPERED" }; }
    }
    return { compatibility, lastReceipt, receiptPathHash: pathHash(receiptFile) };
  }
  if (operation === "database.backup.list") {
    const directory = input.backupDirectory ? requireAbsolutePath(input.backupDirectory, "backupDirectory") : defaultBackupDirectory(canonical);
    if (!existsSync(directory)) return { backupDirectoryPathHash: pathHash(directory), backups: [] };
    const backups = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(backupSuffix)).map((entry) => backupView(join(directory, entry.name)));
    return { backupDirectoryPathHash: pathHash(directory), backups };
  }
  if (operation === "database.backup.show") return backupView(requireAbsolutePath(input.backupPath, "backupPath"));
  if (operation === "database.backup.verify") {
    const backupPath = requireAbsolutePath(input.backupPath, "backupPath");
    const compatibility = await inspectDatabaseCompatibility(canonical);
    const verified = await new BackupService({ sourcePath: canonical, expectedSourceManifest: manifestForCompatibility(compatibility) }).verifyBackup(backupPath, manifestForCompatibility(compatibility));
    return { verified, backup: assertExpectedBackupHash(backupPath, input.backupHash) };
  }
  const context = requireContext(input);
  const startedAt = new Date().toISOString();
  const before = await inspectDatabaseCompatibility(canonical);
  if (operation === "database.backup.create") {
    ensureDefaultBackupDirectory(canonical, input);
    const destinationPath = destinationFor(canonical, input, context.requestId);
    try {
      const manifest = manifestForCompatibility(before);
      const result = await new BackupService({ sourcePath: canonical, expectedSourceManifest: manifest }).createBackup(destinationPath, manifest);
      const file = result.manifest?.files[0];
      const receipt = makeReceipt(canonical, operation, context, startedAt, "SUCCESS", { backup: file ? { pathHash: pathHash(result.path!), fileHash: file.checksum, size: file.size } : undefined });
      writeReceipt(canonical, receipt);
      return { ...result, receipt: { requestId: context.requestId, outcome: receipt.outcome, databasePathHash: receipt.databasePathHash } };
    } catch (error) {
      writeReceipt(canonical, makeReceipt(canonical, operation, context, startedAt, "FAILED"));
      throw error;
    }
  }
  if (operation === "database.backup.restore") {
    const backupPath = requireAbsolutePath(input.backupPath, "backupPath");
    const targetPath = input.targetPath === undefined ? canonical : requireAbsolutePath(input.targetPath, "targetPath");
    if (assertSafeSqlitePath(targetPath) !== canonical) throw new DomainError("INVALID_INPUT", "targetPath must match the explicit database path");
    const manifest = manifestForCompatibility(before);
    ensureDefaultBackupDirectory(canonical, input);
    const safetyPath = input.safetyBackupPath ? requireAbsolutePath(input.safetyBackupPath, "safetyBackupPath") : join(defaultBackupDirectory(canonical), `${context.requestId}.pre-restore${backupSuffix}`);
    try {
      assertExpectedBackupHash(backupPath, input.backupHash);
      const safety = await new BackupService({ sourcePath: canonical, expectedSourceManifest: manifest }).createBackup(safetyPath, manifest);
      await new BackupService({ sourcePath: canonical, expectedSourceManifest: manifest }).restoreFromBackup(backupPath, canonical, manifest);
      const after = await inspectDatabaseCompatibility(canonical);
      if (after.status === "UNKNOWN_TAMPERED" || after.status === "DIRTY_IN_PROGRESS") throw new DomainError("RESTORE_FAILED", "Restored database did not pass compatibility verification");
      const file = safety.manifest?.files[0];
      const receipt = makeReceipt(canonical, operation, context, startedAt, "SUCCESS", { backup: file ? { pathHash: pathHash(safety.path!), fileHash: file.checksum, size: file.size } : undefined });
      writeReceipt(canonical, receipt);
      return { restored: true, verified: true, safetyBackup: file ? { pathHash: pathHash(safety.path!), checksum: file.checksum, size: file.size } : undefined, receipt: { requestId: context.requestId, outcome: receipt.outcome } };
    } catch (error) {
      writeReceipt(canonical, makeReceipt(canonical, operation, context, startedAt, "RECOVERY_FAILED", { recovery: "Target may require operator inspection; retained backups were not deleted." }));
      throw error;
    }
  }
  if (operation === "database.upgrade.apply") {
    const preview = await databaseOperation("database.upgrade.preview", canonical, {}) as Record<string, unknown>;
    ensureDefaultBackupDirectory(canonical, input);
    const destinationPath = destinationFor(canonical, input, context.requestId);
    try {
      await upgradeSqliteDatabase(canonical, { backupDestinationPath: destinationPath, cliVersion: CLI_VERSION, buildId: BUILD_COMMIT, requestId: context.requestId });
      const after = await inspectDatabaseCompatibility(canonical);
      const backup = existsSync(destinationPath) ? backupView(destinationPath) : undefined;
      const receipt = makeReceipt(canonical, operation, context, startedAt, "SUCCESS", { from: { schemaVersion: before.currentSchemaVersion, dataFormatVersion: before.currentDataFormatVersion }, to: { schemaVersion: after.currentSchemaVersion, dataFormatVersion: after.currentDataFormatVersion }, migrations: (preview.migrations as Array<{ id: string; checksum: string }> | undefined)?.map((migration) => ({ id: migration.id, checksum: migration.checksum })), backup: backup ? { pathHash: String(backup.pathHash), fileHash: String(backup.fileHash), size: Number(backup.size) } : undefined });
      writeReceipt(canonical, receipt);
      return { upgraded: true, compatibility: after, preview, backup, receipt: { requestId: context.requestId, outcome: receipt.outcome } };
    } catch (error) {
      const code = error instanceof DomainError ? error.code : "";
      const outcome: OperationReceipt["outcome"] = code === "UPGRADE_FAILED_RESTORED" ? "RECOVERED" : code === "RECOVERY_REQUIRED" ? "RECOVERY_FAILED" : "FAILED";
      writeReceipt(canonical, makeReceipt(canonical, operation, context, startedAt, outcome, { from: { schemaVersion: before.currentSchemaVersion, dataFormatVersion: before.currentDataFormatVersion }, migrations: (preview.migrations as Array<{ id: string; checksum: string }> | undefined)?.map((migration) => ({ id: migration.id, checksum: migration.checksum })), recovery: outcome === "RECOVERED" ? "Verified invocation-start backup restored." : outcome === "RECOVERY_FAILED" ? "Recovery failed; business work must not continue in this process." : undefined }));
      throw error;
    }
  }
  throw new DomainError("UNKNOWN_OPERATION", `Unknown database operation: ${operation}`);
}

export function operationActorInput(input: Record<string, unknown>): Record<string, unknown> {
  return { ...input, actor: { kind: "HUMAN", id: input.actorId ?? "operator" }, yes: input.yes === true };
}
