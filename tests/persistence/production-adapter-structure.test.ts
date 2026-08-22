import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, realpath, rmdir, unlink } from "node:fs/promises";
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

  it("keeps the only mutating entry no-argument and does not expose caller cleanup", () => {
    expect(runProductionAdapterGate.length).toBe(0);
  });

  async function gateTempDirectories(): Promise<string[]> {
    const tempRoot = Bun.env.TMPDIR ?? "/tmp";
    const paths = (await readdir(tempRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("agent-bahi-production-gate-"))
      .map((entry) => join(tempRoot, entry.name));
    return (await Promise.all(paths.map((path) => realpath(path)))).sort();
  }

  async function runGateChild(script: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: process.cwd(),
      env: { ...Bun.env, PATH: "/nonexistent" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr };
  }

  it("removes a newly-created directory when sentinel write fails", async () => {
    const before = await gateTempDirectories();
    const externalDirectory = await mkdtemp(join(Bun.env.TMPDIR ?? "/tmp", "agent-bahi-external-sentinel-"));
    await Bun.write(join(externalDirectory, "caller-owned.sqlite"), "caller-owned database");
    await Bun.write(join(externalDirectory, "caller-owned.sentinel"), "caller-owned sentinel");
    const script = `
      const forgedDatabasePath = ${JSON.stringify(join(externalDirectory, "forged.sqlite"))};
      const originalWrite = Bun.write.bind(Bun);
      Bun.write = async () => { throw new Error("injected sentinel write failure"); };
      const gate = await import(${JSON.stringify(`${process.cwd()}/scripts/production-adapter-gate.ts`)});
      const first = gate.runProductionAdapterGate(forgedDatabasePath, { dialect: "sqlite", sqlite: { path: forgedDatabasePath } }, () => { throw new Error("forged cleanup"); });
      const concurrent = gate.runProductionAdapterGate();
      const [results, concurrentResults] = await Promise.all([first, concurrent]);
      const replayResults = await gate.runProductionAdapterGate();
      console.log(JSON.stringify({ results, concurrentResults, replayResults }));
      void originalWrite;
    `;
    try {
      const child = await runGateChild(script);
      const after = await gateTempDirectories();
      expect(child.exitCode).toBe(0);
      const payload = JSON.parse(child.stdout.trim());
      expect(payload.results[0]).toEqual({ dialect: "sqlite", status: "BLOCKED", reason: "ADAPTER_OPERATION_FAILED" });
      expect(payload.concurrentResults.every((result: { reason?: string }) => result.reason === "GATE_REPLAY_REJECTED")).toBe(true);
      expect(payload.replayResults.every((result: { reason?: string }) => result.reason === "GATE_REPLAY_REJECTED")).toBe(true);
      expect(after).toEqual(before);
      expect(await Bun.file(join(externalDirectory, "caller-owned.sqlite")).text()).toBe("caller-owned database");
      expect(await Bun.file(join(externalDirectory, "caller-owned.sentinel")).text()).toBe("caller-owned sentinel");
      expect(await Bun.file(join(externalDirectory, "forged.sqlite")).exists()).toBe(false);
    } finally {
      await Bun.file(join(externalDirectory, "caller-owned.sqlite")).delete();
      await Bun.file(join(externalDirectory, "caller-owned.sentinel")).delete();
      await rmdir(externalDirectory);
    }
  });

  // This exercises the deterministic pre-cleanup replacement boundary. A
  // precise post-verification scheduling race would require a production hook;
  // the implementation therefore keeps identity/sentinel checks immediately
  // before each known-file unlink without exporting an arbitrary target seam.
  it("leaves a renamed original and same-name replacement intact", async () => {
    const before = await gateTempDirectories();
    const script = `
      const { mkdir, rename, rmdir } = await import("node:fs/promises");
      const originalWrite = Bun.write.bind(Bun);
      let replacementDirectory = "";
      let originalDirectory = "";
      let replaced = false;
      Bun.write = async (path, data) => {
        await originalWrite(path, data);
        if (!replaced && String(path).endsWith("/ownership.sentinel")) {
          replaced = true;
          replacementDirectory = String(path).slice(0, String(path).lastIndexOf("/"));
          originalDirectory = replacementDirectory + "-original";
          await rename(replacementDirectory, originalDirectory);
          await mkdir(replacementDirectory);
          await originalWrite(replacementDirectory + "/unexpected-entry", "must survive");
        }
      };
      const gate = await import(${JSON.stringify(`${process.cwd()}/scripts/production-adapter-gate.ts`)});
      const results = await gate.runProductionAdapterGate();
      console.log(JSON.stringify({ results, replacementDirectory, originalDirectory }));
    `;
    let replacementDirectory = "";
    let originalDirectory = "";
    try {
      const child = await runGateChild(script);
      const after = await gateTempDirectories();
      const payload = JSON.parse(child.stdout.trim());
      replacementDirectory = payload.replacementDirectory;
      originalDirectory = payload.originalDirectory;
      expect(child.exitCode).toBe(0);
      expect(payload.results[0]).toEqual({ dialect: "sqlite", status: "BLOCKED", reason: "CLEANUP_FAILED" });
      expect(after).toEqual([...before, replacementDirectory, originalDirectory].sort());
      expect(await Bun.file(join(replacementDirectory, "unexpected-entry")).text()).toBe("must survive");
      expect(await Bun.file(join(originalDirectory, "ownership.sentinel")).text()).toMatch(/^agent-bahi-production-gate:/);
    } finally {
      if (replacementDirectory) {
        for (const name of ["database.sqlite", "database.sqlite-wal", "database.sqlite-shm", "unexpected-entry"]) {
          try {
            await unlink(join(replacementDirectory, name));
          } catch {}
        }
        await rmdir(replacementDirectory);
      }
      if (originalDirectory) {
        await unlink(join(originalDirectory, "ownership.sentinel")).catch(() => {});
        await rmdir(originalDirectory);
      }
    }
  });

});
