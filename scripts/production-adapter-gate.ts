import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "crypto";
import { DatabaseFactory } from "../src/infrastructure/adapters/database-factory.ts";
import type { DatabaseConfig } from "../src/infrastructure/config/database.ts";
import { DialectSqlBuilder } from "../src/infrastructure/sql/dialect-sql-builder.ts";
import { MigrationService } from "../src/infrastructure/services/migration-service.ts";
import { startMySQLContainer, startPostgresContainer } from "../spikes/gate0/database-integration.ts";

interface GateResult {
  dialect: string;
  status: "PASS" | "BLOCKED";
  reason?: string;
}

interface GateCapability {
  _brand: "GateCapability";
  token: string;
  targetHash: string;
  active: boolean;
}

interface OwnedResource {
  canonical: { dialect: string; path?: string; host?: string; port?: number };
  capability: GateCapability;
}

const gateCapabilityRegistry = new Map<string, OwnedResource>();

function computeTargetHash(dialect: string, config?: { path?: string; host?: string; port?: number }): string {
  const canonical = `${dialect}:${config?.path || `${config?.host}:${config?.port}`}`;
  return createHash("sha256").update(canonical).digest("hex");
}

function createGateCapability(dialect: string, config?: { path?: string; host?: string; port?: number }): GateCapability {
  const token = crypto.randomUUID();
  const targetHash = computeTargetHash(dialect, config);
  const capability: GateCapability = { _brand: "GateCapability", token, targetHash, active: true };
  const canonical = { dialect, ...config };
  gateCapabilityRegistry.set(token, { canonical, capability });
  return capability;
}

function validateGateCapability(capability: GateCapability, dialect: string, config?: { path?: string; host?: string; port?: number }): boolean {
  if (capability._brand !== "GateCapability" || !capability.active) return false;
  const registered = gateCapabilityRegistry.get(capability.token);
  if (!registered) return false;
  const expectedHash = computeTargetHash(dialect, config);
  return capability.targetHash === expectedHash && registered.capability.active;
}

function revokeGateCapability(token: string): void {
  const resource = gateCapabilityRegistry.get(token);
  if (resource) {
    resource.capability.active = false;
  }
}

export interface OwnedSqliteResource {
  directory: string;
  databasePath: string;
  sentinelPath: string;
  sentinel: string;
}

export async function createOwnedSqliteResource(): Promise<{ config: DatabaseConfig; resource: OwnedSqliteResource; capability: GateCapability }> {
  const directory = await mkdtemp(`${Bun.env.TMPDIR ?? "/tmp"}/agent-bahi-production-gate-`);
  const databasePath = `${directory}/database.sqlite`;
  const sentinelPath = `${directory}/ownership.sentinel`;
  const sentinel = `agent-bahi-production-gate:${crypto.randomUUID()}`;
  const capability = createGateCapability("sqlite", { path: databasePath });
  await Bun.write(sentinelPath, sentinel);
  return {
    config: { dialect: "sqlite", sqlite: { path: databasePath } },
    resource: { directory, databasePath, sentinelPath, sentinel },
    capability,
  };
}

export async function cleanupOwnedSqliteResource(resource: OwnedSqliteResource, capability: GateCapability): Promise<string | null> {
  if (!(await Bun.file(resource.sentinelPath).exists()) || (await Bun.file(resource.sentinelPath).text()) !== resource.sentinel) {
    return "SQLite ownership sentinel missing or mismatched";
  }
  revokeGateCapability(capability.token);
  try {
    for (const path of [resource.databasePath, `${resource.databasePath}-wal`, `${resource.databasePath}-shm`, resource.sentinelPath]) {
      if (await Bun.file(path).exists()) await Bun.file(path).delete();
    }
    await rm(resource.directory, { recursive: true, force: true });
  } catch {
    return "owned SQLite cleanup operation failed";
  }
  for (const path of [resource.databasePath, `${resource.databasePath}-wal`, `${resource.databasePath}-shm`, resource.sentinelPath, resource.directory]) {
    if (await Bun.file(path).exists()) return "owned SQLite resource remained after cleanup";
  }
  return null;
}

function safeReason(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "IntegrationBlockedError") return "DISPOSABLE_RESOURCE_UNAVAILABLE";
    if (/docker|container|network|image|database container/i.test(error.message)) return "DISPOSABLE_RESOURCE_UNAVAILABLE";
    const allowedNames = new Set(["Error", "TypeError", "SyntaxError", "RangeError"]);
    if (allowedNames.has(error.name)) return error.name;
    return "adapter operation failed";
  }
  return "adapter operation failed";
}

async function verifyOwnedTableAbsent(
  db: ReturnType<typeof DatabaseFactory.createDatabase>,
  config: DatabaseConfig,
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
  if (result.rows.length !== 0) throw new Error("owned table remained after cleanup");
}

export async function runDialect(
  config: DatabaseConfig,
  ownedSqlite?: { resource: OwnedSqliteResource; capability: GateCapability },
  ownedDatabase?: { config: DatabaseConfig; cleanup: () => Promise<void>; capability: GateCapability },
): Promise<GateResult> {
  if (config.dialect === "sqlite") {
    if (!ownedSqlite || config.sqlite?.path !== ownedSqlite.resource.databasePath || !validateGateCapability(ownedSqlite.capability, "sqlite", { path: ownedSqlite.resource.databasePath })) {
      return { dialect: config.dialect, status: "BLOCKED", reason: "GATE_OWNERSHIP_REQUIRED" };
    }
  } else if (config.dialect === "postgresql") {
    if (!ownedDatabase || !validateGateCapability(ownedDatabase.capability, "postgresql", { host: config.postgresql?.host, port: config.postgresql?.port })) {
      return { dialect: config.dialect, status: "BLOCKED", reason: "GATE_OWNERSHIP_REQUIRED" };
    }
  } else if (config.dialect === "mysql") {
    if (!ownedDatabase || !validateGateCapability(ownedDatabase.capability, "mysql", { host: config.mysql?.host, port: config.mysql?.port })) {
      return { dialect: config.dialect, status: "BLOCKED", reason: "GATE_OWNERSHIP_REQUIRED" };
    }
  } else {
    return { dialect: config.dialect, status: "BLOCKED", reason: "GATE_OWNERSHIP_REQUIRED" };
  }
  let db: ReturnType<typeof DatabaseFactory.createDatabase> | null = null;
  const suffix = crypto.randomUUID().replace(/-/g, "");
  const table = `__agent_bahi_gate_${suffix}`;
  const migrationId = `production-gate-${config.dialect}-${suffix}`;
  const sql = config.dialect === "mysql"
    ? `CREATE TABLE ${table} (id VARCHAR(255) PRIMARY KEY)`
    : `CREATE TABLE ${table} (id TEXT PRIMARY KEY)`;
  let result: GateResult = { dialect: config.dialect, status: "BLOCKED", reason: "adapter operation did not complete" };
  try {
    db = DatabaseFactory.createDatabase(config);
    const migration = new MigrationService(db, config.dialect);
    const applied = await migration.migrate([{ id: migrationId, sql }]);
    const status = await migration.getStatus();
    if (applied.length !== 1 || !status.appliedMigrations.some((item) => item.id === migrationId)) {
      result = { dialect: config.dialect, status: "BLOCKED", reason: "migration lifecycle did not report APPLIED" };
    } else {
      await migration.verifyChecksum(migrationId, status.appliedMigrations.find((item) => item.id === migrationId)!.checksum);
      await db.executeRaw(`DROP TABLE ${table}`);
      await verifyOwnedTableAbsent(db, config, table);
      result = { dialect: config.dialect, status: "PASS" };
    }
  } catch (error) {
    result = { dialect: config.dialect, status: "BLOCKED", reason: safeReason(error) };
  } finally {
    const cleanupFailures: string[] = [];
    try {
      if (db) await db.close();
    } catch (error) {
      cleanupFailures.push(`database close failed: ${safeReason(error)}`);
    }
    if (ownedDatabase) {
      try {
        revokeGateCapability(ownedDatabase.capability.token);
        await ownedDatabase.cleanup();
      } catch (error) {
        cleanupFailures.push(`disposable database cleanup failed: ${safeReason(error)}`);
      }
    }
    const cleanupFailure = cleanupFailures.length > 0 ? cleanupFailures.join("; ") : null;
    if (cleanupFailure) {
      result = result.status === "PASS"
        ? { dialect: config.dialect, status: "BLOCKED", reason: `cleanup failed: ${cleanupFailure}` }
        : { ...result, reason: `${result.reason ?? "operation failed"}; cleanup failed: ${cleanupFailure}` };
    }
  }
  return result;
}

async function main(): Promise<void> {
  const results: GateResult[] = [];
  let ownedSqlite: Awaited<ReturnType<typeof createOwnedSqliteResource>> | null = null;
  try {
    ownedSqlite = await createOwnedSqliteResource();
    results.push(await runDialect(ownedSqlite.config, { resource: ownedSqlite.resource, capability: ownedSqlite.capability }));
  } catch (error) {
    results.push({ dialect: "sqlite", status: "BLOCKED", reason: safeReason(error) });
  } finally {
    if (ownedSqlite) {
      try {
        const failure = await cleanupOwnedSqliteResource(ownedSqlite.resource, ownedSqlite.capability);
        if (failure) {
          results[0] = { ...results[0], status: "BLOCKED", reason: `cleanup failed: ${failure}` };
        }
      } catch (error) {
        results[0] = { ...results[0], status: "BLOCKED", reason: `cleanup failed: ${safeReason(error)}` };
      }
    }
  }

  for (const dialect of ["postgresql", "mysql"] as const) {
    let owned: { config: DatabaseConfig; cleanup: () => Promise<void>; capability: GateCapability } | null = null;
    try {
      const started = dialect === "postgresql"
        ? await startPostgresContainer(`production-gate-${crypto.randomUUID()}`)
        : await startMySQLContainer(`production-gate-${crypto.randomUUID()}`);
      const config: DatabaseConfig = dialect === "postgresql"
        ? {
            dialect,
            postgresql: {
              host: started.config.host,
              port: started.config.port,
              database: started.config.database,
              username: started.config.username,
              password: started.config.password,
            },
          }
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
          };
      const capability = createGateCapability(dialect, { host: started.config.host, port: started.config.port });
      owned = { config, cleanup: started.cleanup, capability };
      results.push(await runDialect(owned.config, undefined, owned));
    } catch (error) {
      let reason = safeReason(error);
      if (owned) {
        try {
          revokeGateCapability(owned.capability.token);
          await owned.cleanup();
        } catch (cleanupError) {
          reason = `${reason}; cleanup failed: ${safeReason(cleanupError)}`;
        }
      }
      results.push({ dialect, status: "BLOCKED", reason });
    }
  }

  for (const result of results) console.log(JSON.stringify(result));
  if (results.some((result) => result.status !== "PASS")) process.exitCode = 1;
}

if (import.meta.main) await main();
