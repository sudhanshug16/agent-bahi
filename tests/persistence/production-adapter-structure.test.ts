import { describe, expect, it } from "bun:test";
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
    const error = normalizeBunSqlError(new Error("mysql://user:super-secret@db:3306/app: authentication failed"), "mysql");
    expect(JSON.stringify(error)).not.toContain("super-secret");
  });
});
