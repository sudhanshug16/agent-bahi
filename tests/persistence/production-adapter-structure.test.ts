import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { runProductionAdapterGate, safeReason } from "../../scripts/production-adapter-gate.ts";
import { DatabaseFactory } from "../../src/infrastructure/adapters/database-factory.ts";
import { buildMysqlSqlOptions, MysqlAdapter } from "../../src/infrastructure/adapters/mysql-adapter.ts";
import { buildPostgresSqlOptions, PostgresAdapter } from "../../src/infrastructure/adapters/postgres-adapter.ts";
import { normalizeBunSqlError } from "../../src/infrastructure/adapters/bun-sql.ts";

describe("native production adapter boundary", () => {
  it("exports only the safe gate entry and pure error sanitizer", async () => {
    const gateModule = await import("../../scripts/production-adapter-gate.ts");
    expect(Object.keys(gateModule).sort()).toEqual(["runProductionAdapterGate", "safeReason"]);
  });

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

  it("sanitizes secret-bearing custom error names and messages to a fixed label", () => {
    const secret = "postgresql://alice:super-secret@external.example:5432/ledger";
    const error = new Error(secret);
    Object.defineProperty(error, "name", { value: `SecretError:${secret}` });
    const reason = safeReason(error);
    expect(reason).toBe("ADAPTER_OPERATION_FAILED");
    expect(reason).not.toContain("SecretError");
    expect(reason).not.toContain("super-secret");
    expect(reason).not.toContain("external.example");
  });

  it("ignores forged extra arguments, rejects concurrent/replay use, and leaves external targets untouched", async () => {
    const externalDirectory = await mkdtemp(join(Bun.env.TMPDIR ?? "/tmp", "agent-bahi-external-sentinel-"));
    const externalPath = join(externalDirectory, "caller-owned.sqlite");
    const externalSentinel = join(externalDirectory, "caller-owned.sentinel");
    await Bun.write(externalPath, "caller-owned database");
    await Bun.write(externalSentinel, "caller-owned sentinel");

    const forgedArgs = [
      externalPath,
      {
        dialect: "postgresql",
        postgresql: { host: "external.example", port: 5432, database: "caller-owned", username: "caller", password: "secret" },
      },
      async () => { await rm(externalDirectory, { recursive: true, force: true }); },
    ];
    const unsafeArityCall = runProductionAdapterGate as unknown as (...args: unknown[]) => Promise<Awaited<ReturnType<typeof runProductionAdapterGate>>>;
    try {
      const first = unsafeArityCall(...forgedArgs);
      const concurrent = runProductionAdapterGate();
      const [firstResults, concurrentResults] = await Promise.all([first, concurrent]);
      expect(firstResults.map((result) => result.dialect)).toEqual(["sqlite", "postgresql", "mysql"]);
      expect(concurrentResults.every((result) => result.reason === "GATE_REPLAY_REJECTED")).toBe(true);
      const replayResults = await runProductionAdapterGate();
      expect(replayResults.every((result) => result.reason === "GATE_REPLAY_REJECTED")).toBe(true);
      expect(await Bun.file(externalPath).text()).toBe("caller-owned database");
      expect(await Bun.file(externalSentinel).text()).toBe("caller-owned sentinel");
    } finally {
      await rm(externalDirectory, { recursive: true, force: true });
    }
  }, { timeout: 180000 });

});
