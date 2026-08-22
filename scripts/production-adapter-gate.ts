import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdtemp, realpath, readdir, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseFactory } from "../src/infrastructure/adapters/database-factory.ts";
import type { DatabaseConfig } from "../src/infrastructure/config/database.ts";
import { DialectSqlBuilder } from "../src/infrastructure/sql/dialect-sql-builder.ts";
import { MigrationService } from "../src/infrastructure/services/migration-service.ts";
import { IntegrationBlockedError, startMySQLContainer, startPostgresContainer } from "../spikes/gate0/database-integration.ts";

type GateDialect = "sqlite" | "postgresql" | "mysql";
type GateResult = {
  dialect: GateDialect;
  status: "PASS" | "BLOCKED";
  reason?: string;
};

type ResourceState = "NEW" | "RUNNING" | "CLEANING" | "REVOKED";

const REASONS = {
  adapterFailure: "ADAPTER_OPERATION_FAILED",
  cleanupFailure: "CLEANUP_FAILED",
  disposableUnavailable: "DISPOSABLE_RESOURCE_UNAVAILABLE",
  gateReplay: "GATE_REPLAY_REJECTED",
  lifecycleFailure: "RESOURCE_LIFECYCLE_REJECTED",
  ownershipFailure: "OWNERSHIP_VERIFICATION_FAILED",
} as const;

const DIALECTS: readonly GateDialect[] = ["sqlite", "postgresql", "mysql"];

interface GateCapability {
  readonly token: string;
  readonly targetHash: string;
}

interface ResourceLifecycle {
  state: ResourceState;
}

interface CanonicalSqliteResource {
  readonly kind: "sqlite";
  readonly dialect: "sqlite";
  readonly config: Readonly<DatabaseConfig>;
  readonly directory: string;
  readonly databasePath: string;
  readonly sentinelPath: string;
  readonly sentinel: string;
  readonly directoryIdentity: DirectoryIdentity;
  readonly capability: GateCapability;
  readonly lifecycle: ResourceLifecycle;
  readonly dispose: () => Promise<string | null>;
}

interface CanonicalDatabaseResource {
  readonly kind: "database";
  readonly dialect: "postgresql" | "mysql";
  readonly config: Readonly<DatabaseConfig>;
  readonly containerId: string;
  readonly host: string;
  readonly port: number;
  readonly capability: GateCapability;
  readonly lifecycle: ResourceLifecycle;
  readonly dispose: () => Promise<string | null>;
}

type CanonicalResource = CanonicalSqliteResource | CanonicalDatabaseResource;

interface DirectoryIdentity {
  readonly realpath: string;
  readonly dev: number;
  readonly ino: number;
}

// These are module-private by design. Nothing outside this module can create,
// replace, inspect, or clean a registered resource.
const ownedResources = new Map<string, CanonicalResource>();
let gateInvocationState: ResourceState = "NEW";

function targetHash(dialect: GateDialect, target: string): string {
  return createHash("sha256").update(`${dialect}:${target}`).digest("hex");
}

function createCapability(dialect: GateDialect, target: string): GateCapability {
  return Object.freeze({ token: randomUUID(), targetHash: targetHash(dialect, target) });
}

function freezeConfig(config: DatabaseConfig): Readonly<DatabaseConfig> {
  if (config.sqlite) Object.freeze(config.sqlite);
  if (config.postgresql) Object.freeze(config.postgresql);
  if (config.mysql) Object.freeze(config.mysql);
  return Object.freeze(config);
}

function resourceIsRegistered(resource: CanonicalResource): boolean {
  const target = resource.kind === "sqlite"
    ? resource.databasePath
    : `${resource.host}:${resource.port}`;
  return ownedResources.get(resource.capability.token) === resource
    && resource.capability.targetHash === targetHash(resource.dialect, target);
}

function claimResource(resource: CanonicalResource): boolean {
  // This synchronous check-and-set is the lifecycle gate. JavaScript cannot
  // interleave another caller between these statements.
  if (!resourceIsRegistered(resource) || resource.lifecycle.state !== "NEW") return false;
  resource.lifecycle.state = "RUNNING";
  return true;
}

function beginCleanup(resource: CanonicalResource): boolean {
  if (!resourceIsRegistered(resource)) return false;
  if (resource.lifecycle.state !== "RUNNING") return false;
  resource.lifecycle.state = "CLEANING";
  return true;
}

function revokeResource(resource: CanonicalResource): void {
  resource.lifecycle.state = "REVOKED";
  ownedResources.delete(resource.capability.token);
}

/**
 * Convert any error to a fixed label. The error's name and message are never
 * returned or inspected, so this remains safe for direct adversarial testing.
 */
export function safeReason(error: unknown): string {
  if (error instanceof IntegrationBlockedError) return REASONS.disposableUnavailable;
  if (error instanceof GateCleanupError) return REASONS.cleanupFailure;
  if (error instanceof GateLifecycleError) return REASONS.lifecycleFailure;
  return REASONS.adapterFailure;
}

class GateLifecycleError extends Error {}
class GateCleanupError extends Error {}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function sameDirectoryIdentity(stat: { dev: number; ino: number }, identity: DirectoryIdentity): boolean {
  return stat.dev === identity.dev && stat.ino === identity.ino;
}

async function readDirectoryIdentity(path: string): Promise<DirectoryIdentity> {
  const pathStat = await lstat(path);
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) throw new GateLifecycleError();
  const canonicalPath = await realpath(path);
  const stat = await lstat(canonicalPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new GateLifecycleError();
  return { realpath: canonicalPath, dev: stat.dev, ino: stat.ino };
}

async function directoryIdentityMatches(path: string, identity: DirectoryIdentity): Promise<boolean> {
  try {
    const current = await readDirectoryIdentity(path);
    return current.realpath === identity.realpath && current.dev === identity.dev && current.ino === identity.ino;
  } catch {
    return false;
  }
}

async function verifyOwnedSqliteDirectory(resource: CanonicalSqliteResource, requireSentinel = true): Promise<boolean> {
  try {
    const directoryStat = await lstat(resource.directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || !sameDirectoryIdentity(directoryStat, resource.directoryIdentity)) return false;
    if (await realpath(resource.directory) !== resource.directoryIdentity.realpath) return false;

    if (!requireSentinel) return true;

    const sentinelStat = await lstat(resource.sentinelPath);
    if (!sentinelStat.isFile() || sentinelStat.isSymbolicLink()) return false;
    const sentinel = await Bun.file(resource.sentinelPath).text();
    return sentinel === resource.sentinel;
  } catch {
    return false;
  }
}

async function removeFreshSqliteDirectory(
  path: string,
  identity: DirectoryIdentity | null,
  createdStat?: { dev: number; ino: number },
): Promise<string | null> {
  try {
    if (!identity && !createdStat) return REASONS.cleanupFailure;
    const current = await readDirectoryIdentity(path);
    if (identity && (current.realpath !== identity.realpath || current.dev !== identity.dev || current.ino !== identity.ino)) return REASONS.cleanupFailure;
    if (createdStat && (current.dev !== createdStat.dev || current.ino !== createdStat.ino)) return REASONS.cleanupFailure;

    // Validate the complete allowlist before deleting anything. An unknown
    // entry remains in place, along with the proven sentinel, for inspection.
    if (!(await directoryIdentityMatches(path, current))) return REASONS.cleanupFailure;
    const entries = await readdir(current.realpath, { withFileTypes: true });
    if (entries.some((entry) => entry.name !== "ownership.sentinel" || !entry.isFile() || entry.isSymbolicLink())) {
      return REASONS.cleanupFailure;
    }
    if (entries.length === 1) {
      if (!(await directoryIdentityMatches(path, current))) return REASONS.cleanupFailure;
      const sentinelPath = join(current.realpath, "ownership.sentinel");
      const sentinelStat = await lstat(sentinelPath);
      if (!sentinelStat.isFile() || sentinelStat.isSymbolicLink()) return REASONS.cleanupFailure;
      if (!(await directoryIdentityMatches(path, current))) return REASONS.cleanupFailure;
      await unlink(sentinelPath);
    }
    if (!(await directoryIdentityMatches(path, current))) return REASONS.cleanupFailure;
    const remaining = await readdir(current.realpath, { withFileTypes: true });
    if (remaining.length !== 0) return REASONS.cleanupFailure;
    if (!(await directoryIdentityMatches(path, current))) return REASONS.cleanupFailure;
    await rmdir(current.realpath);
    return null;
  } catch {
    // Constructor failure must never broaden cleanup beyond the exact fresh
    // directory. If identity, contents, or emptiness cannot be proven, leave
    // the path in place and report cleanup failure.
    return REASONS.cleanupFailure;
  }
}

async function unlinkOwnedSqliteFile(resource: CanonicalSqliteResource, path: string): Promise<string | null> {
  if (!(await verifyOwnedSqliteDirectory(resource))) return REASONS.ownershipFailure;
  let originalStat: { dev: number; ino: number };
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return REASONS.ownershipFailure;
    originalStat = { dev: stat.dev, ino: stat.ino };
  } catch (error) {
    return isMissingPath(error) ? null : REASONS.cleanupFailure;
  }

  // Revalidate the exact parent immediately before the unlink and reject a
  // replacement of the allowlisted file. A post-lstat/pre-unlink race is NOT
  // PROVEN safe here without descriptor-relative native primitives.
  if (!(await verifyOwnedSqliteDirectory(resource))) return REASONS.ownershipFailure;
  try {
    const currentStat = await lstat(path);
    if (!currentStat.isFile() || currentStat.isSymbolicLink() || currentStat.dev !== originalStat.dev || currentStat.ino !== originalStat.ino) {
      return REASONS.ownershipFailure;
    }
  } catch {
    return REASONS.cleanupFailure;
  }
  if (!(await verifyOwnedSqliteDirectory(resource))) return REASONS.ownershipFailure;
  try {
    await unlink(path);
    return null;
  } catch {
    return REASONS.cleanupFailure;
  }
}

async function cleanupOwnedSqlite(resource: CanonicalSqliteResource): Promise<string | null> {
  if (!beginCleanup(resource)) return REASONS.lifecycleFailure;

  let failure: string | null = null;
  try {
    // Ownership is checked before any deletion. In particular, a missing or
    // replaced sentinel leaves every file untouched.
    if (!(await verifyOwnedSqliteDirectory(resource))) {
      failure = REASONS.ownershipFailure;
    } else {
      const exactPaths = [
        resource.databasePath,
        `${resource.databasePath}-wal`,
        `${resource.databasePath}-shm`,
        resource.sentinelPath,
      ];
      for (const path of exactPaths) {
        failure = await unlinkOwnedSqliteFile(resource, path);
        if (failure) break;
      }
      if (!failure) {
        if (!(await verifyOwnedSqliteDirectory(resource, false))) {
          failure = REASONS.ownershipFailure;
        } else {
          // The directory identity is checked immediately before readdir and
          // again immediately before rmdir. The post-check race remains
          // unproven without descriptor-relative native primitives.
          if (!(await directoryIdentityMatches(resource.directory, resource.directoryIdentity))) {
            failure = REASONS.ownershipFailure;
          }
        }
        if (!failure) {
          const entries = await readdir(resource.directory, { withFileTypes: true });
          if (entries.length !== 0) {
            failure = REASONS.cleanupFailure;
          } else {
            try {
              if (!(await directoryIdentityMatches(resource.directory, resource.directoryIdentity))) {
                failure = REASONS.ownershipFailure;
              } else {
                await rmdir(resource.directory);
              }
            } catch {
              failure = REASONS.cleanupFailure;
            }
          }
        }
      }
    }
  } catch {
    failure = REASONS.cleanupFailure;
  } finally {
    // Revocation is unconditional, including failed sentinel verification.
    revokeResource(resource);
  }
  return failure;
}

async function createOwnedSqlite(): Promise<CanonicalSqliteResource> {
  const directory = await mkdtemp(join(Bun.env.TMPDIR ?? "/tmp", "agent-bahi-production-gate-"));
  let identity: DirectoryIdentity | null = null;
  let createdStat: { dev: number; ino: number } | undefined;
  try {
    const initialStat = await lstat(directory);
    if (!initialStat.isDirectory() || initialStat.isSymbolicLink()) throw new GateLifecycleError();
    createdStat = { dev: initialStat.dev, ino: initialStat.ino };
    identity = await readDirectoryIdentity(directory);
    const databasePath = join(identity.realpath, "database.sqlite");
    const sentinelPath = join(identity.realpath, "ownership.sentinel");
    const sentinel = `agent-bahi-production-gate:${randomUUID()}`;
    await Bun.write(sentinelPath, sentinel);

    const capability = createCapability("sqlite", databasePath);
    let resource!: CanonicalSqliteResource;
    resource = Object.freeze({
      kind: "sqlite",
      dialect: "sqlite",
      config: freezeConfig({ dialect: "sqlite", sqlite: { path: databasePath } }),
      directory: identity.realpath,
      databasePath,
      sentinelPath,
      sentinel,
      directoryIdentity: identity,
      capability,
      lifecycle: { state: "NEW" as ResourceState },
      dispose: () => cleanupOwnedSqlite(resource),
    });
    ownedResources.set(capability.token, resource);
    return resource;
  } catch (error) {
    const cleanupFailure = await removeFreshSqliteDirectory(directory, identity, createdStat);
    if (cleanupFailure) throw new GateCleanupError();
    throw error;
  }
}

async function createOwnedDatabase(dialect: "postgresql" | "mysql"): Promise<CanonicalDatabaseResource> {
  const started = dialect === "postgresql"
    ? await startPostgresContainer(`production-gate-${randomUUID()}`)
    : await startMySQLContainer(`production-gate-${randomUUID()}`);

  const config = dialect === "postgresql"
    ? {
        dialect,
        postgresql: {
          host: started.config.host,
          port: started.config.port,
          database: started.config.database,
          username: started.config.username,
          password: started.config.password,
        },
      } satisfies DatabaseConfig
    : {
        dialect,
        mysql: {
          host: started.config.host,
          port: started.config.port,
          database: started.config.database,
          username: started.config.username,
          password: started.config.password,
          ssl: true,
        },
      } satisfies DatabaseConfig;
  const canonicalConfig = freezeConfig(config);
  const containerId = started.config.containerName;
  const capability = createCapability(dialect, `${started.config.host}:${started.config.port}`);
  let resource!: CanonicalDatabaseResource;
  resource = Object.freeze({
    kind: "database",
    dialect,
    config: canonicalConfig,
    containerId,
    host: started.config.host,
    port: started.config.port,
    capability,
    lifecycle: { state: "NEW" as ResourceState },
    // The starter creates this closure over the exact container/network IDs;
    // no caller-supplied callback or target reaches the public gate entry.
    dispose: async () => {
      if (!beginCleanup(resource)) return REASONS.lifecycleFailure;
      try {
        await started.cleanup();
        return null;
      } catch {
        return REASONS.cleanupFailure;
      } finally {
        revokeResource(resource);
      }
    },
  });
  ownedResources.set(capability.token, resource);
  return resource;
}

async function verifyOwnedTableAbsent(
  db: ReturnType<typeof DatabaseFactory.createDatabase>,
  config: Readonly<DatabaseConfig>,
  table: string,
): Promise<void> {
  const builder = new DialectSqlBuilder(config.dialect);
  const placeholder = builder.placeholder();
  const catalogQuery = config.dialect === "sqlite"
    ? `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${placeholder}`
    : config.dialect === "postgresql"
      ? `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ${placeholder}`
      : `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ${placeholder}`;
  const result = await db.query(catalogQuery, [table]);
  if (result.rows.length !== 0) throw new GateLifecycleError();
}

async function runDialect(resource: CanonicalResource): Promise<GateResult> {
  if (!claimResource(resource)) {
    return { dialect: resource.dialect, status: "BLOCKED", reason: REASONS.lifecycleFailure };
  }

  let db: ReturnType<typeof DatabaseFactory.createDatabase> | null = null;
  const suffix = randomUUID().replaceAll("-", "");
  const table = `__agent_bahi_gate_${suffix}`;
  const migrationId = `production-gate-${resource.dialect}-${suffix}`;
  const sql = resource.dialect === "mysql"
    ? `CREATE TABLE ${table} (id VARCHAR(255) PRIMARY KEY)`
    : `CREATE TABLE ${table} (id TEXT PRIMARY KEY)`;
  let result: GateResult = { dialect: resource.dialect, status: "BLOCKED", reason: REASONS.adapterFailure };

  try {
    // Claiming the resource proves only the module-private capability. The
    // SQLite path must be revalidated at the final use boundary as well, so a
    // replaced directory cannot cause Bun SQLite to create database/WAL/SHM
    // files in a caller-owned path.
    if (resource.kind === "sqlite" && !(await verifyOwnedSqliteDirectory(resource))) {
      result = { dialect: resource.dialect, status: "BLOCKED", reason: REASONS.ownershipFailure };
    } else {
      db = DatabaseFactory.createDatabase(resource.config);
    }
    if (db) {
      const migration = new MigrationService(db, resource.dialect);
      const applied = await migration.migrate([{ id: migrationId, sql }]);
      const status = await migration.getStatus();
      const appliedMigration = status.appliedMigrations.find((item) => item.id === migrationId);
      if (applied.length !== 1 || !appliedMigration) {
        result = { dialect: resource.dialect, status: "BLOCKED", reason: REASONS.adapterFailure };
      } else {
        await migration.verifyChecksum(migrationId, appliedMigration.checksum);
        await db.executeRaw(`DROP TABLE ${table}`);
        await verifyOwnedTableAbsent(db, resource.config, table);
        result = { dialect: resource.dialect, status: "PASS" };
      }
    }
  } catch (error) {
    result = { dialect: resource.dialect, status: "BLOCKED", reason: safeReason(error) };
  } finally {
    const cleanupFailures: string[] = [];
    try {
      if (db) await db.close();
    } catch {
      cleanupFailures.push(REASONS.cleanupFailure);
    }
    const cleanupFailure = await resource.dispose();
    if (cleanupFailure) cleanupFailures.push(cleanupFailure);
    if (cleanupFailures.length > 0) {
      result = result.status === "PASS"
        ? { dialect: resource.dialect, status: "BLOCKED", reason: REASONS.cleanupFailure }
        : { ...result, reason: REASONS.cleanupFailure };
    }
  }
  return result;
}

async function runOwnedDialect(dialect: GateDialect): Promise<GateResult> {
  let resource: CanonicalResource | null = null;
  try {
    resource = dialect === "sqlite" ? await createOwnedSqlite() : await createOwnedDatabase(dialect);
    return await runDialect(resource);
  } catch (error) {
    // Database-container startup cleans its own partially-created resources;
    // a fully registered resource is cleaned here if construction succeeded
    // but execution failed before runDialect claimed it.
    if (resource && resource.lifecycle.state === "NEW") {
      resource.lifecycle.state = "RUNNING";
      const cleanupFailure = await resource.dispose();
      return { dialect, status: "BLOCKED", reason: cleanupFailure ?? safeReason(error) };
    }
    return { dialect, status: "BLOCKED", reason: safeReason(error) };
  }
}

function replayResults(): GateResult[] {
  return DIALECTS.map((dialect) => ({ dialect, status: "BLOCKED", reason: REASONS.gateReplay }));
}

function completeResults(results: readonly GateResult[]): GateResult[] {
  const byDialect = new Map<GateDialect, GateResult>();
  for (const result of results) {
    if (!DIALECTS.includes(result.dialect) || byDialect.has(result.dialect)) {
      return DIALECTS.map((dialect) => ({ dialect, status: "BLOCKED", reason: REASONS.adapterFailure }));
    }
    byDialect.set(result.dialect, result);
  }
  if (byDialect.size !== DIALECTS.length) {
    return DIALECTS.map((dialect) => ({ dialect, status: "BLOCKED", reason: REASONS.adapterFailure }));
  }
  return DIALECTS.map((dialect) => byDialect.get(dialect)!);
}

/**
 * Run the local-owned SQLite/PostgreSQL/MySQL adapter gate.
 *
 * This is intentionally the only public mutating entry. Its arguments are
 * omitted from the signature and are never read at runtime.
 */
export async function runProductionAdapterGate(): Promise<GateResult[]> {
  if (gateInvocationState !== "NEW") return replayResults();
  gateInvocationState = "RUNNING";
  try {
    const results: GateResult[] = [];
    for (const dialect of DIALECTS) results.push(await runOwnedDialect(dialect));
    return completeResults(results);
  } finally {
    gateInvocationState = "REVOKED";
  }
}

async function main(): Promise<void> {
  const results = await runProductionAdapterGate();
  for (const result of results) console.log(JSON.stringify(result));
  if (results.some((result) => result.status !== "PASS")) process.exitCode = 1;
}

if (import.meta.main) await main();
