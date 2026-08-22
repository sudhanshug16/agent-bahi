import type {
  Database,
  MigrationSession,
  BackupService,
} from "../../application/ports/persistence.ts";
import type {
  UpgradeBackupReference,
  UpgradeCoordinatorFaults,
  UpgradeCoordinatorPort,
  UpgradeErrorCode,
  UpgradePlan,
  UpgradePreflightProbe,
  UpgradeRecoveryRequest,
  UpgradeRecoveryResult,
  UpgradeRequest,
  UpgradeResult,
} from "../../application/ports/upgrade.ts";
import { DomainError } from "../../core/types.ts";
import {
  computeSqliteMigrationChecksum,
  CURRENT_SCHEMA_MANIFEST,
  schemaManifestHash,
  type SqliteSchemaManifest,
} from "../schema/current-manifest.ts";
import { DatabaseControlService } from "./database-control-service.ts";
import { MIGRATION_SCHEMA_SQLITE, MigrationService, verificationManifestHash } from "./migration-service.ts";
import { DATABASE_CONTROL_TABLE_DDL } from "../schema/database-control-schema.ts";

type ControlRow = Record<string, unknown>;
type HistoryRow = Record<string, unknown>;

const SAFE_REASON = "Upgrade recovery requires operator review";

export class UpgradeError extends DomainError {
  readonly backup?: UpgradeBackupReference;

  constructor(code: UpgradeErrorCode, message: string, backup?: UpgradeBackupReference) {
    super(code, message, backup ? { backup } : undefined);
    this.backup = backup;
  }
}

function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function assertManifestSerializable(value: unknown): void {
  if (typeof value === "bigint" || typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    throw new UpgradeError("UPGRADE_PREFLIGHT_FAILED", "Upgrade probes must use manifest-serializable values");
  }
  if (Array.isArray(value)) {
    value.forEach(assertManifestSerializable);
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      if (!key.trim()) throw new UpgradeError("UPGRADE_PREFLIGHT_FAILED", "Upgrade probe result keys must be nonblank");
      assertManifestSerializable(entry);
    });
  }
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade source metadata is malformed");
  void field;
  return parsed as number;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function normalizeDdl(ddl: string): string {
  return ddl.replace(/\bIF\s+NOT\s+EXISTS\b/gi, "").replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
}

function validateProbe(probe: UpgradePreflightProbe): void {
  if (!probe.id.trim() || !probe.sql.trim()) throw new UpgradeError("UPGRADE_PREFLIGHT_FAILED", "Upgrade preflight probe is malformed");
  const sql = probe.sql.trim();
  if (!/^select\b/i.test(sql) || /;|\b(?:insert|update|delete|replace|drop|alter|create|pragma|vacuum|attach|detach|begin|commit|rollback|with|union|intersect|except)\b/i.test(sql)) {
    throw new UpgradeError("UPGRADE_PREFLIGHT_FAILED", "Upgrade preflight must be one read-only SELECT");
  }
  if (!/\blimit\s+(?:[0-9]+|\?)/i.test(sql)) throw new UpgradeError("UPGRADE_PREFLIGHT_FAILED", "Upgrade preflight must be bounded");
  const maxRows = probe.maxRows ?? 100;
  if (!Number.isSafeInteger(maxRows) || maxRows < 0 || maxRows > 1000 || probe.expectedRows.length > maxRows) {
    throw new UpgradeError("UPGRADE_PREFLIGHT_FAILED", "Upgrade preflight bound is invalid");
  }
  const literalLimit = /\blimit\s+([0-9]+)/i.exec(sql)?.[1];
  if (literalLimit !== undefined && Number(literalLimit) > maxRows) throw new UpgradeError("UPGRADE_PREFLIGHT_FAILED", "Upgrade preflight bound is invalid");
  assertManifestSerializable(probe.expectedRows);
}

function validateManifestShape(manifest: SqliteSchemaManifest): void {
  if (manifest.manifestVersion < 1 || manifest.schemaVersion < 1 || manifest.dataFormatVersion < 1 || manifest.generation < 1 || manifest.revision < 1) {
    throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade manifest metadata is invalid");
  }
  if (manifest.readerCompatibilityMin < 1 || manifest.readerCompatibilityMax < manifest.readerCompatibilityMin || manifest.writerProtocol < 1) {
    throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade protocol metadata is invalid");
  }
  for (const migration of manifest.migrations) {
    if (!migration.id || !/^[0-9a-f]{64}$/.test(migration.checksum) || migration.dialect !== "sqlite" || migration.status !== "APPLIED") {
      throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade manifest migration metadata is invalid");
    }
  }
}

export function validateUpgradePlan(plan: UpgradePlan): void {
  validateManifestShape(plan.sourceManifest);
  validateManifestShape(plan.targetManifest);
  const source = plan.sourceManifest.migrations;
  const target = plan.targetManifest.migrations;
  if (target.length !== source.length + 1) throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade plan must append exactly one migration");
  for (let index = 0; index < source.length; index += 1) {
    if (canonicalJson(source[index]) !== canonicalJson(target[index])) throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade plan changes an existing migration");
  }
  const appended = target.at(-1)!;
  const definitionChecksum = computeSqliteMigrationChecksum(plan.migration.sql);
  if (appended.id !== plan.migration.id || appended.checksum !== definitionChecksum || (plan.migration.manifest && plan.migration.manifest.dialect !== "sqlite") || (plan.targetVerificationManifest && plan.targetVerificationManifest.dialect !== "sqlite")) {
    throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade migration identity does not match its definition");
  }
  if (plan.targetManifest.schemaVersion !== plan.sourceManifest.schemaVersion + 1 || plan.targetManifest.revision !== plan.sourceManifest.revision + 1) {
    throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade schema and revision must advance exactly one step");
  }
  if (plan.targetManifest.dataFormatVersion !== plan.sourceManifest.dataFormatVersion || plan.targetManifest.generation !== plan.sourceManifest.generation) {
    throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade data format or generation changed unexpectedly");
  }
  for (const probe of [...plan.preflightProbes, ...(plan.targetVerificationProbes ?? []), ...(plan.targetVerificationManifest?.probes ?? []), ...(plan.migration.manifest?.probes ?? [])]) validateProbe(probe);
}

export class UpgradeCoordinator implements UpgradeCoordinatorPort {
  constructor(
    private readonly db: Database,
    private readonly backupService: BackupService,
    private readonly faults: UpgradeCoordinatorFaults = {},
  ) {}

  async close(): Promise<void> {
    await this.db.close();
  }

  async upgrade(request: UpgradeRequest): Promise<UpgradeResult> {
    validateUpgradePlan(request.plan);
    const sourceHash = schemaManifestHash(request.plan.sourceManifest);
    const targetHash = schemaManifestHash(request.plan.targetManifest);
    let backup: UpgradeBackupReference | undefined;
    try {
      const result = await this.db.withMigrationLease(async (session) => {
        const state = await this.readState(session);
        if (state.control && this.isExactTarget(state, request.plan.targetManifest)) {
          return { status: "ALREADY_APPLIED", sourceManifestHash: sourceHash, targetManifestHash: targetHash } as UpgradeResult;
        }
        this.rejectExistingConflictOrRecovery(state, request.plan);
        await this.assertExactSource(session, state, request.plan.sourceManifest);
        await this.runProbes(session, request.plan.preflightProbes, "preflight");

        let created;
        try {
          created = await this.backupService.createBackup(request.backupDestinationPath, request.plan.sourceManifest);
          if (created.status !== "SUCCESS" || !created.path || !created.manifest?.checksum || !created.manifest.files[0]) {
            throw new Error("backup unavailable");
          }
          await this.backupService.verifyBackup(created.path, request.plan.sourceManifest);
        } catch (error) {
          const code = error instanceof DomainError ? error.code : "";
          if (["BACKUP_HISTORY_MISMATCH", "BACKUP_SCHEMA_MISMATCH", "BACKUP_SOURCE_NOT_READY", "BACKUP_CONTROL_CHANGED"].includes(code)) {
            throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade source changed or does not match its manifest");
          }
          throw new UpgradeError("UPGRADE_BACKUP_FAILED", "Verified upgrade backup could not be created");
        }
        backup = {
          path: created.path,
          checksum: created.manifest.files[0].checksum,
          size: created.manifest.files[0].size,
        };
        await this.assertExactSource(session, await this.readState(session), request.plan.sourceManifest);
        await this.faults.beforeApply?.(session);

        const verificationManifest = request.plan.migration.manifest ?? request.plan.targetVerificationManifest;
        const metadata = canonicalJson({
          // Keep the upgrade identity fields used by the coordinator while
          // persisting the exact verification manifest consumed by
          // MigrationService.recoverDirty. Older coordinator records remain
          // readable as coordinator metadata; new records are recoverable.
          backup: { checksum: backup.checksum, size: backup.size },
          sourceManifestHash: sourceHash,
          targetManifestHash: targetHash,
          verificationManifest: verificationManifest ?? null,
        });
        const appended = request.plan.targetManifest.migrations.at(-1)!;
        const timestamp = (request.now ?? new Date()).toISOString();
        await session.execute(
          `INSERT INTO schema_migrations (id, dialect, checksum, status, executed_at, duration_ms, dirty_reason, lease_token, manifest_version, verification_manifest_hash, manifest_json)
           VALUES (?, ?, ?, 'APPLYING', ?, 0, NULL, ?, ?, ?, ?)`,
          [appended.id, "sqlite", appended.checksum, timestamp, session.leaseToken(), verificationManifest?.version ?? null, verificationManifest ? verificationManifestHash(verificationManifest) : null, metadata],
        );
        const applying = await session.execute(
          `UPDATE database_control SET state = 'APPLYING', updated_at = ? WHERE id = 1 AND state = 'READY' AND revision = ? AND schema_version = ? AND data_format_version = ? AND generation = ? AND last_migration_id = ? AND last_migration_checksum = ?`,
          [timestamp, request.plan.sourceManifest.revision, request.plan.sourceManifest.schemaVersion, request.plan.sourceManifest.dataFormatVersion, request.plan.sourceManifest.generation, request.plan.sourceManifest.migrations.at(-1)!.id, request.plan.sourceManifest.migrations.at(-1)!.checksum],
        );
        void applying;
        const controlApplying = await session.executeSingle("SELECT state FROM database_control WHERE id = 1");
        if (safeText(controlApplying?.state) !== "APPLYING") throw new UpgradeError("UPGRADE_APPLY_FAILED", "Upgrade control transition failed");

        await session.executeRaw(request.plan.migration.sql);
        await this.faults.beforeTargetVerification?.(session);
        await this.runProbes(session, this.targetProbes(request.plan), "target verification");
        await session.execute("UPDATE schema_migrations SET status = 'APPLIED', duration_ms = ? WHERE id = ? AND status = 'APPLYING' AND checksum = ?", [0, appended.id, appended.checksum]);
        const applied = await session.executeSingle("SELECT status FROM schema_migrations WHERE id = ?", [appended.id]);
        if (safeText(applied?.status) !== "APPLIED") throw new UpgradeError("UPGRADE_APPLY_FAILED", "Upgrade history transition failed");
        await this.writeTargetControl(session, request.plan.targetManifest, request.cliVersion, request.buildId, timestamp);
        return { status: "APPLIED", backup, sourceManifestHash: sourceHash, targetManifestHash: targetHash } as UpgradeResult;
      }, request.timeoutMs);
      try {
        await this.faults.afterCommit?.();
      } catch {
        throw new UpgradeError("UPGRADE_OUTCOME_UNCERTAIN", "Upgrade commit outcome is uncertain", backup);
      }
      return result;
    } catch (error) {
      if (error instanceof UpgradeError) {
        if (backup && !error.backup) throw new UpgradeError(error.code as UpgradeErrorCode, error.message, backup);
        throw error;
      }
      if (backup) throw new UpgradeError("UPGRADE_APPLY_FAILED", "Upgrade failed after verified backup", backup);
      throw new UpgradeError("UPGRADE_APPLY_FAILED", "Upgrade failed before completion");
    }
  }

  async recover(recovery: UpgradeRecoveryRequest): Promise<UpgradeRecoveryResult> {
    const request = "request" in recovery ? recovery.request : recovery;
    validateUpgradePlan(request.plan);
    try {
      return await this.db.withMigrationLease(async (session) => {
        const state = await this.readState(session);
        if (this.isExactTarget(state, request.plan.targetManifest)) return { status: "APPLIED" };
        if (this.isExactSource(state, request.plan.sourceManifest)) return { status: "ROLLED_BACK" };
        if (safeText(state.control?.state) === "RECOVERY_REQUIRED") return { status: "RECOVERY_REQUIRED", reason: SAFE_REASON };

        const targetHistory = this.historyMatches(state.history, request.plan.targetManifest);
        const appended = request.plan.targetManifest.migrations.at(-1)!;
        const appendedRow = state.history.find((row) => safeText(row.id) === appended.id);
        if (safeText(state.control?.state) === "APPLYING" && (targetHistory || (appendedRow && safeText(appendedRow.status) === "APPLYING" && await this.targetLooksPresent(session, request.plan)))) {
          if (appendedRow && safeText(appendedRow.status) !== "APPLIED") {
            await session.execute("UPDATE schema_migrations SET status = 'APPLIED', dirty_reason = NULL WHERE id = ? AND checksum = ?", [appended.id, appended.checksum]);
          }
          await this.writeTargetControl(session, request.plan.targetManifest, request.cliVersion, request.buildId, (request.now ?? new Date()).toISOString());
          return { status: "APPLIED" };
        }

        const control = await session.executeSingle("SELECT * FROM database_control WHERE id = 1");
        if (!control || !this.canonicalControlRow(control)) throw new UpgradeError("UPGRADE_RECOVERY_REQUIRED", "Upgrade recovery state cannot be safely updated");
        const reason = SAFE_REASON;
        await session.execute("UPDATE database_control SET state = 'RECOVERY_REQUIRED', recovery_reason = ?, updated_at = ? WHERE id = 1", [reason, new Date().toISOString()]);
        return { status: "RECOVERY_REQUIRED", reason };
      }, request.timeoutMs);
    } catch (error) {
      if (error instanceof UpgradeError) throw error;
      throw new UpgradeError("UPGRADE_RECOVERY_REQUIRED", "Upgrade recovery could not complete");
    }
  }

  private async readState(session: MigrationSession): Promise<{ control?: ControlRow; history: HistoryRow[] }> {
    const control = await session.executeSingle("SELECT * FROM database_control WHERE id = 1");
    const history = (await session.execute("SELECT id, dialect, checksum, status, dirty_reason, manifest_json FROM schema_migrations ORDER BY rowid")).rows;
    return { control, history };
  }

  private isExactSource(state: { control?: ControlRow; history: HistoryRow[] }, manifest: SqliteSchemaManifest): boolean {
    return !!state.control && safeText(state.control.state) === "READY" && this.controlMatches(state.control, manifest) && this.historyMatches(state.history, manifest);
  }

  private isExactTarget(state: { control?: ControlRow; history: HistoryRow[] }, manifest: SqliteSchemaManifest): boolean {
    if (!this.isExactSource(state, manifest)) return false;
    const last = state.history.at(-1);
    return !!last && typeof last.manifest_json === "string" && last.manifest_json.includes(schemaManifestHash(manifest));
  }

  private controlMatches(control: ControlRow, manifest: SqliteSchemaManifest): boolean {
    return integer(control.schema_version, "schema_version") === manifest.schemaVersion
      && integer(control.data_format_version, "data_format_version") === manifest.dataFormatVersion
      && integer(control.generation, "generation") === manifest.generation
      && integer(control.revision, "revision") === manifest.revision
      && integer(control.reader_compatibility_min, "reader_compatibility_min") === manifest.readerCompatibilityMin
      && integer(control.reader_compatibility_max, "reader_compatibility_max") === manifest.readerCompatibilityMax
      && integer(control.required_writer_protocol, "required_writer_protocol") === manifest.writerProtocol
      && safeText(control.last_migration_id) === manifest.migrations.at(-1)!.id
      && safeText(control.last_migration_checksum) === manifest.migrations.at(-1)!.checksum
      && control.recovery_reason == null;
  }

  private canonicalControlRow(control: ControlRow): boolean {
    const state = safeText(control.state);
    const reason = control.recovery_reason == null ? null : safeText(control.recovery_reason);
    return integer(control.id, "id") === 1
      && ["READY", "APPLYING", "RECOVERY_REQUIRED"].includes(state)
      && ((state === "RECOVERY_REQUIRED" && !!reason?.trim()) || (state !== "RECOVERY_REQUIRED" && reason === null));
  }

  private historyMatches(history: readonly HistoryRow[], manifest: SqliteSchemaManifest): boolean {
    return history.length === manifest.migrations.length && manifest.migrations.every((migration, index) => {
      const row = history[index];
      return !!row && safeText(row.id) === migration.id && safeText(row.dialect) === migration.dialect && safeText(row.checksum) === migration.checksum && safeText(row.status) === migration.status && row.dirty_reason == null;
    });
  }

  private rejectExistingConflictOrRecovery(state: { control?: ControlRow; history: HistoryRow[] }, plan: UpgradePlan): void {
    if (safeText(state.control?.state) === "APPLYING" || safeText(state.control?.state) === "RECOVERY_REQUIRED" || state.history.some((row) => ["APPLYING", "DIRTY"].includes(safeText(row.status)))) {
      throw new UpgradeError("UPGRADE_RECOVERY_REQUIRED", "Upgrade recovery is required before another upgrade");
    }
    const appended = plan.targetManifest.migrations.at(-1)!;
    const existing = state.history.find((row) => safeText(row.id) === appended.id);
    if (existing && (safeText(existing.checksum) !== appended.checksum || safeText(existing.manifest_json).includes(schemaManifestHash(plan.targetManifest)) === false)) {
      throw new UpgradeError("UPGRADE_IDEMPOTENCY_CONFLICT", "Upgrade migration identity conflicts with stored history");
    }
  }

  private async assertExactSource(session: MigrationSession, state: { control?: ControlRow; history: HistoryRow[] }, manifest: SqliteSchemaManifest): Promise<void> {
    const metadata = await session.getTableMetadata("schema_migrations");
    const controlMetadata = await session.getTableMetadata("database_control");
    if (!metadata || normalizeDdl(metadata.ddl ?? "") !== normalizeDdl(MIGRATION_SCHEMA_SQLITE) || !MigrationService.isCurrentMigrationSchema(metadata) || !controlMetadata || DatabaseControlService.validateDatabaseControlTableSchema(controlMetadata) || normalizeDdl(controlMetadata.ddl ?? "") !== normalizeDdl(DATABASE_CONTROL_TABLE_DDL)) {
      throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade source schema is not canonical");
    }
    if (!this.isExactSource(state, manifest)) throw new UpgradeError("UPGRADE_SOURCE_MISMATCH", "Upgrade source does not match its manifest");
  }

  private async runProbes(session: MigrationSession, probes: readonly UpgradePreflightProbe[], phase: string): Promise<void> {
    try {
      for (const probe of probes) {
        const result = await session.execute(probe.sql);
        const maxRows = probe.maxRows ?? 100;
        if (result.rows.length > maxRows || canonicalJson(result.rows) !== canonicalJson(probe.expectedRows)) throw new Error(phase);
      }
    } catch (error) {
      if (error instanceof UpgradeError) throw error;
      throw new UpgradeError("UPGRADE_PREFLIGHT_FAILED", "Upgrade preflight verification failed");
    }
  }

  private async targetLooksPresent(session: MigrationSession, plan: UpgradePlan): Promise<boolean> {
    try {
      await this.runProbes(session, this.targetProbes(plan), "target verification");
      return true;
    } catch {
      return false;
    }
  }

  private async writeTargetControl(session: MigrationSession, manifest: SqliteSchemaManifest, cliVersion: string, buildId: string, timestamp: string): Promise<void> {
    const last = manifest.migrations.at(-1)!;
    await session.execute(
      `UPDATE database_control SET schema_version = ?, data_format_version = ?, reader_compatibility_min = ?, reader_compatibility_max = ?, required_writer_protocol = ?, state = 'READY', revision = ?, generation = ?, last_migration_id = ?, last_migration_checksum = ?, last_writer_cli_version = ?, last_writer_build_id = ?, last_writer_at = ?, updated_at = ?, recovery_reason = NULL WHERE id = 1 AND state = 'APPLYING'`,
      [manifest.schemaVersion, manifest.dataFormatVersion, manifest.readerCompatibilityMin, manifest.readerCompatibilityMax, manifest.writerProtocol, manifest.revision, manifest.generation, last.id, last.checksum, cliVersion, buildId, timestamp, timestamp],
    );
    const row = await session.executeSingle("SELECT * FROM database_control WHERE id = 1");
    if (!row || safeText(row.state) !== "READY" || !this.controlMatches(row, manifest)) throw new UpgradeError("UPGRADE_APPLY_FAILED", "Upgrade control publication failed");
  }

  private targetProbes(plan: UpgradePlan): readonly UpgradePreflightProbe[] {
    return plan.targetVerificationProbes ?? plan.targetVerificationManifest?.probes ?? plan.migration.manifest?.probes ?? [];
  }
}

export function createUpgradeCoordinator(db: Database, backupService: BackupService, faults?: UpgradeCoordinatorFaults): UpgradeCoordinator {
  return new UpgradeCoordinator(db, backupService, faults);
}

export { CURRENT_SCHEMA_MANIFEST };
