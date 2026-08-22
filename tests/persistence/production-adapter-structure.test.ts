import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { runProductionAdapterGate, safeReason } from "../../scripts/production-adapter-gate.ts";
import { DatabaseFactory } from "../../src/infrastructure/adapters/database-factory.ts";
import { buildMysqlSqlOptions, MysqlAdapter } from "../../src/infrastructure/adapters/mysql-adapter.ts";
import { buildPostgresSqlOptions, PostgresAdapter } from "../../src/infrastructure/adapters/postgres-adapter.ts";
import { normalizeBunSqlError } from "../../src/infrastructure/adapters/bun-sql.ts";
import { startDatabaseContainer, type DockerCommandRunner } from "../../spikes/gate0/database-integration.ts";

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

  async function runGateChild(
    script: string,
    options: { timeoutMs?: number; cleanup?: () => Promise<void> } = {},
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const killGraceMs = 250;
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: process.cwd(),
      env: { ...Bun.env, PATH: "/nonexistent" },
      stdout: "pipe",
      stderr: "pipe",
    });
    let exited = false;
    const exitedPromise = child.exited.then((exitCode) => {
      exited = true;
      return exitCode;
    });
    let timedOut = false;
    const waitForExit = async (durationMs: number): Promise<boolean> => {
      const completed = await Promise.race([
        exitedPromise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), durationMs)),
      ]);
      return completed;
    };

    try {
      if (!(await waitForExit(timeoutMs))) {
        timedOut = true;
        child.kill("SIGTERM");
        if (!(await waitForExit(killGraceMs))) child.kill("SIGKILL");
      }
      const exitCode = await exitedPromise;
      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode: typeof exitCode === "number" ? exitCode : null, stdout, stderr, timedOut };
    } finally {
      // A timeout path and an assertion/error path both terminate and await the
      // child before fixture cleanup. This keeps no process or pipe alive.
      if (!exited) {
        child.kill("SIGTERM");
        if (!(await waitForExit(killGraceMs))) child.kill("SIGKILL");
        await exitedPromise;
      }
      if (options.cleanup) await options.cleanup();
    }
  }

  function parseGateLines(stdout: string): Array<{ dialect: string; status: string; reason?: string }> {
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length !== 3) throw new Error(`expected exactly three live gate results, got ${lines.length}`);
    const results = lines.map((line) => JSON.parse(line) as { dialect: string; status: string; reason?: string });
    const dialects = results.map((result) => result.dialect);
    expect(new Set(dialects)).toEqual(new Set(["sqlite", "postgresql", "mysql"]));
    expect(results.every((result) => result.status === "PASS" || result.status === "BLOCKED")).toBe(true);
    expect(results.every((result) => result.status === "PASS" || typeof result.reason === "string")).toBe(true);
    return results;
  }

  it("terminates a never-resolving child and still runs fixture cleanup", async () => {
    let fixtureCleaned = false;
    const startedAt = performance.now();
    const child = await runGateChild("await new Promise(() => {});", {
      timeoutMs: 100,
      cleanup: async () => { fixtureCleaned = true; },
    });
    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expect(child.timedOut).toBe(true);
    expect(fixtureCleaned).toBe(true);
    expect(child.exitCode).not.toBe(0);
  });

  it("ignores forged path/config/callback arguments and preserves the external fixture and result set", async () => {
    const script = `
      const { mkdtemp, readdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const externalDirectory = await mkdtemp(join(Bun.env.TMPDIR ?? "/tmp", "agent-bahi-caller-owned-"));
      const forgedPath = join(externalDirectory, "caller-owned.sqlite");
      const sentinelPath = join(externalDirectory, "caller-owned.sentinel");
      const callbackMarker = join(externalDirectory, "callback-ran");
      await Bun.write(forgedPath, "caller-owned database bytes");
      await Bun.write(sentinelPath, "caller-owned sentinel bytes");
      const snapshot = async () => ({
        entries: (await readdir(externalDirectory)).sort(),
        database: await Bun.file(forgedPath).text(),
        sentinel: await Bun.file(sentinelPath).text(),
        callback: await Bun.file(callbackMarker).exists(),
      });
      const before = await snapshot();
      const modulePath = ${JSON.stringify(`${process.cwd()}/scripts/production-adapter-gate.ts`)};
      const baselineGate = await import(modulePath + "?baseline");
      const baseline = await baselineGate.runProductionAdapterGate();
      const forgedGate = await import(modulePath + "?forged");
      let callbackRan = false;
      const forged = await forgedGate.runProductionAdapterGate(
        forgedPath,
        { dialect: "sqlite", sqlite: { path: forgedPath } },
        async () => { callbackRan = true; await Bun.write(callbackMarker, "must not run"); },
      );
      const after = await snapshot();
      console.log(JSON.stringify({ externalDirectory, before, after, callbackRan, baseline, forged }));
    `;
    let externalDirectory = "";
    try {
      const child = await runGateChild(script);
      expect(child.exitCode).toBe(0);
      expect(child.timedOut).toBe(false);
      const payload = JSON.parse(child.stdout.trim());
      externalDirectory = payload.externalDirectory;
      expect(payload.callbackRan).toBe(false);
      expect(payload.after).toEqual(payload.before);
      expect(payload.forged).toEqual(payload.baseline);
      expect(payload.forged.map((result: { dialect: string }) => result.dialect)).toEqual(["sqlite", "postgresql", "mysql"]);
    } finally {
      if (externalDirectory) {
        for (const name of ["caller-owned.sqlite", "caller-owned.sentinel", "callback-ran"]) {
          await unlink(join(externalDirectory, name)).catch(() => {});
        }
        await rmdir(externalDirectory).catch(() => {});
      }
    }
  });

  it("parses live gate output as exactly one fail-closed result per dialect", async () => {
    const script = `
      const gate = await import(${JSON.stringify(`${process.cwd()}/scripts/production-adapter-gate.ts`)} + "?live");
      for (const result of await gate.runProductionAdapterGate()) console.log(JSON.stringify(result));
    `;
    const child = await runGateChild(script, { timeoutMs: 5_000 });
    expect(child.exitCode).toBe(0);
    expect(child.timedOut).toBe(false);
    parseGateLines(child.stdout);
  });

  it("reports a forced factory failure as BLOCKED rather than a false PASS", async () => {
    const script = `
      const factory = await import(${JSON.stringify(`${process.cwd()}/src/infrastructure/adapters/database-factory.ts`)});
      factory.DatabaseFactory.createDatabase = () => { throw new Error("forced adapter failure"); };
      const gate = await import(${JSON.stringify(`${process.cwd()}/scripts/production-adapter-gate.ts`)} + "?forced-failure");
      for (const result of await gate.runProductionAdapterGate()) console.log(JSON.stringify(result));
    `;
    const child = await runGateChild(script, { timeoutMs: 5_000 });
    expect(child.exitCode).toBe(0);
    const results = parseGateLines(child.stdout);
    expect(results.find((result) => result.dialect === "sqlite")).toEqual({
      dialect: "sqlite",
      status: "BLOCKED",
      reason: "ADAPTER_OPERATION_FAILED",
    });
  });

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

  it("leaves unknown setup entries and reports cleanup failure", async () => {
    const before = await gateTempDirectories();
    const script = `
      const originalWrite = Bun.write.bind(Bun);
      let directory = "";
      Bun.write = async (path, data) => {
        await originalWrite(path, data);
        if (String(path).endsWith("/ownership.sentinel")) {
          directory = String(path).slice(0, String(path).lastIndexOf("/"));
          await originalWrite(directory + "/unknown-entry", "must survive");
          throw new Error("injected setup failure after sentinel");
        }
      };
      const gate = await import(${JSON.stringify(`${process.cwd()}/scripts/production-adapter-gate.ts`)} + "?unknown-setup");
      const results = await gate.runProductionAdapterGate();
      console.log(JSON.stringify({ directory, results }));
    `;
    let directory = "";
    try {
      const child = await runGateChild(script);
      expect(child.exitCode).toBe(0);
      const payload = JSON.parse(child.stdout.trim());
      directory = payload.directory;
      expect(payload.results[0]).toEqual({ dialect: "sqlite", status: "BLOCKED", reason: "CLEANUP_FAILED" });
      expect(await Bun.file(join(directory, "unknown-entry")).text()).toBe("must survive");
      expect(await Bun.file(join(directory, "ownership.sentinel")).text()).toMatch(/^agent-bahi-production-gate:/);
      expect(await gateTempDirectories()).toEqual([...before, directory].sort());
    } finally {
      if (directory) {
        await unlink(join(directory, "unknown-entry")).catch(() => {});
        await unlink(join(directory, "ownership.sentinel")).catch(() => {});
        await rmdir(directory).catch(() => {});
      }
    }
  });

  // This exercises the deterministic pre-cleanup replacement boundary. A
  // The post-lstat/pre-unlink race is NOT PROVEN without descriptor-relative
  // native primitives. This deterministic replacement test covers the
  // immediately-observable boundary without exporting an arbitrary target seam.
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

  it("runs bounded Docker timeout/signal failure through final container and network cleanup", async () => {
    const calls: string[][] = [];
    const runDocker: DockerCommandRunner = (args) => {
      calls.push(args);
      if (args[0] === "image" && args[1] === "inspect") {
        return { success: true, exitCode: 0, signalCode: null, stdout: "sha256:local", stderr: "" };
      }
      if (args[0] === "network" && args[1] === "create") {
        return { success: true, exitCode: 0, signalCode: null, stdout: "network-id", stderr: "" };
      }
      if (args[0] === "run") {
        return { success: false, exitCode: null, signalCode: "SIGTERM", exitedDueToTimeout: true, stdout: "", stderr: "timed out" };
      }
      if (args[0] === "rm" || (args[0] === "network" && args[1] === "rm")) {
        return { success: true, exitCode: 0, signalCode: null, stdout: "", stderr: "" };
      }
      if (args[0] === "inspect" || (args[0] === "network" && args[1] === "inspect")) {
        return { success: false, exitCode: 1, signalCode: null, stdout: "", stderr: "No such resource" };
      }
      throw new Error(`unexpected injected Docker command: ${args.join(" ")}`);
    };

    let failure: unknown;
    try {
      await startDatabaseContainer("postgres", runDocker);
    } catch (error) {
      failure = error;
    }
    expect(String(failure)).toContain("docker returned no container ID");
    expect(calls.slice(-4).map((args) => args.slice(0, 2))).toEqual([
      ["rm", "-f"],
      ["inspect", "--format={{.Id}}"],
      ["network", "rm"],
      ["network", "inspect"],
    ]);
  });

});
