import { describe, expect, it } from "bun:test";
import { cleanupOwnedSqliteResource, createOwnedSqliteResource, runDialect } from "../../scripts/production-adapter-gate.ts";
import { DatabaseFactory } from "../../src/infrastructure/adapters/database-factory.ts";
import { buildMysqlSqlOptions, MysqlAdapter } from "../../src/infrastructure/adapters/mysql-adapter.ts";
import { buildPostgresSqlOptions, PostgresAdapter } from "../../src/infrastructure/adapters/postgres-adapter.ts";
import { normalizeBunSqlError } from "../../src/infrastructure/adapters/bun-sql.ts";

describe("native production adapter boundary", () => {
  it("factory-created clients are constructed and do not expose initialize-only state", async () => {
    const postgres = DatabaseFactory.createDatabase({ dialect: "postgresql", postgresql: { host: "127.0.0.1", port: 1, database: "missing", username: "user", password: "secret" } });
    const mysql = DatabaseFactory.createDatabase({ dialect: "mysql", mysql: { host: "127.0.0.1", port: 1, database: "missing", username: "user", password: "secret", ssl: true } });
    expect((postgres as PostgresAdapter).constructor.name).toBe("PostgresAdapter");
    expect((mysql as MysqlAdapter).constructor.name).toBe("MysqlAdapter");
    expect(await postgres.isConnected()).toBe(false);
    expect(await mysql.isConnected()).toBe(false);
    await postgres.close();
    await mysql.close();
  });

  it("propagates configured TLS without putting credentials in normalized errors", () => {
    expect(buildPostgresSqlOptions({ host: "db", port: 5432, database: "app", sslMode: "require" }).tls).toBe(true);
    expect(buildMysqlSqlOptions({ host: "db", port: 3306, database: "app", ssl: true }).tls).toBe(true);
    const error = normalizeBunSqlError(new Error("mysql://user:super-secret@db:3306/app: authentication failed; username=user; private key=KEYDATA"), "mysql");
    expect(JSON.stringify(error)).not.toContain("super-secret");
    expect(JSON.stringify(error)).not.toContain("KEYDATA");
    expect(JSON.stringify(error)).not.toContain("user");
  });

  it("never removes an externally supplied SQLite file", async () => {
    const externalPath = `/tmp/agent-bahi-external-${crypto.randomUUID()}.sqlite`;
    await Bun.write(externalPath, "caller-owned database");
    const owned = await createOwnedSqliteResource();
    try {
      expect(owned.config.sqlite?.path).not.toBe(externalPath);
      expect(await cleanupOwnedSqliteResource(owned.resource)).toBeNull();
      expect(await Bun.file(externalPath).exists()).toBe(true);
    } finally {
      await Bun.file(externalPath).delete();
    }
  });

  it("does not read arbitrary external PostgreSQL or MySQL URLs", async () => {
    const source = await Bun.file("scripts/production-adapter-gate.ts").text();
    expect(source).not.toContain("AGENT_BAHI_POSTGRES_URL");
    expect(source).not.toContain("AGENT_BAHI_MYSQL_URL");
    expect(source).toContain("startPostgresContainer");
    expect(source).toContain("startMySQLContainer");
  });

  it("blocks arbitrary relational targets before any adapter connection or write", async () => {
    const postgres = await runDialect({
      dialect: "postgresql",
      postgresql: { host: "external.example", port: 5432, database: "caller-owned", username: "caller", password: "secret" },
    });
    const mysql = await runDialect({
      dialect: "mysql",
      mysql: { host: "external.example", port: 3306, database: "caller-owned", username: "caller", password: "secret", ssl: true },
    });
    expect(postgres).toEqual({ dialect: "postgresql", status: "BLOCKED", reason: "GATE_OWNERSHIP_REQUIRED" });
    expect(mysql).toEqual({ dialect: "mysql", status: "BLOCKED", reason: "GATE_OWNERSHIP_REQUIRED" });
  });
});
