import { randomUUID } from "crypto";
import { rm } from "node:fs/promises";
import { DatabaseFactory } from "../src/infrastructure/adapters/database-factory.ts";
import type { DatabaseConfig } from "../src/infrastructure/config/database.ts";
import { parseDatabaseUrl } from "../src/infrastructure/config/database.ts";
import { MigrationService } from "../src/infrastructure/services/migration-service.ts";

interface GateResult {
  dialect: string;
  status: "PASS" | "BLOCKED";
  reason?: string;
}

function safeReason(error: unknown): string {
  if (error instanceof Error) return error.name || "adapter operation failed";
  return "adapter operation failed";
}

async function runDialect(config: DatabaseConfig): Promise<GateResult> {
  let db: ReturnType<typeof DatabaseFactory.createDatabase> | null = null;
  const suffix = randomUUID().replace(/-/g, "");
  const table = `__agent_bahi_gate_${suffix}`;
  const migrationId = `production-gate-${config.dialect}-${suffix}`;
  const sql = `CREATE TABLE ${table} (id TEXT PRIMARY KEY)`;
  try {
    db = DatabaseFactory.createDatabase(config);
    const migration = new MigrationService(db, config.dialect);
    const applied = await migration.migrate([{ id: migrationId, sql }]);
    const status = await migration.getStatus();
    if (applied.length !== 1 || !status.appliedMigrations.some((item) => item.id === migrationId)) {
      return { dialect: config.dialect, status: "BLOCKED", reason: "migration lifecycle did not report APPLIED" };
    }
    await migration.verifyChecksum(migrationId, status.appliedMigrations.find((item) => item.id === migrationId)!.checksum);
    await db.executeRaw(`DROP TABLE ${table}`);
    try {
      await db.query(`SELECT 1 FROM ${table}`);
      return { dialect: config.dialect, status: "BLOCKED", reason: "owned table remained after cleanup" };
    } catch {
      return { dialect: config.dialect, status: "PASS" };
    }
  } catch (error) {
    return { dialect: config.dialect, status: "BLOCKED", reason: safeReason(error) };
  } finally {
    if (db) await db.close().catch(() => undefined);
    if (config.sqlite) {
      for (const suffix of ["", "-wal", "-shm"]) await rm(`${config.sqlite.path}${suffix}`, { force: true }).catch(() => undefined);
      if (await Bun.file(config.sqlite.path).exists()) return { dialect: config.dialect, status: "BLOCKED", reason: "owned SQLite resource remained after cleanup" };
    }
  }
}

const sqliteUrl = Bun.env.AGENT_BAHI_SQLITE_URL ?? `sqlite:///tmp/agent-bahi-production-gate-${randomUUID()}.sqlite`;
const configs: Array<DatabaseConfig | null> = [parseDatabaseUrl(sqliteUrl)];
const postgresUrl = Bun.env.AGENT_BAHI_POSTGRES_URL;
const mysqlUrl = Bun.env.AGENT_BAHI_MYSQL_URL;
configs.push(postgresUrl ? parseDatabaseUrl(postgresUrl) : null);
configs.push(mysqlUrl ? parseDatabaseUrl(mysqlUrl) : null);

const results: GateResult[] = [];
for (const config of configs) {
  if (!config) {
    results.push({ dialect: results.length === 1 ? "postgresql" : "mysql", status: "BLOCKED", reason: "configured connection URL is unavailable" });
    continue;
  }
  results.push(await runDialect(config));
}

for (const result of results) console.log(JSON.stringify(result));
if (results.some((result) => result.status !== "PASS")) process.exitCode = 1;
