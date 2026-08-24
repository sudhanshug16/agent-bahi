import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtempSync, rmSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRemoteMcpServer } from "../../src/mcp-http.ts";

const root = process.cwd();
setDefaultTimeout(15_000);

async function cli(db: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [join(root, "src/cli.ts"), "--database", db, ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
  return { code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

async function initializedDatabase(): Promise<{ directory: string; path: string }> {
  const directory = mkdtempSync(join(tmpdir(), "agent-bahi-remote-http-"));
  const path = join(directory, "books.sqlite");
  expect((await cli(path, ["database.init", "--json"])).code).toBe(0);
  return { directory, path };
}

async function waitForClose(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    new Promise<void>((resolve) => child.once("close", () => resolve())),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
  }
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await waitForClose(child);
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastStatus: number | undefined;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      lastStatus = response.status;
      if (response.status === 200) return;
    } catch {
      // The listener may be live before the HTTP endpoint is accepting requests.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`MCP health check timed out (last status: ${lastStatus ?? "unreachable"})`);
}

async function compileSmokeBinary(): Promise<{ directory: string; binary: string }> {
  const directory = mkdtempSync(join(tmpdir(), "agent-bahi-compiled-bin-"));
  const binary = join(directory, "agent-bahi");
  const build = spawn(process.execPath, ["build", join(root, "src/cli.ts"), "--compile", "--outfile", binary], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  build.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  build.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  try {
    const code = await new Promise<number | null>((resolve) => build.once("close", resolve));
    if (code !== 0) throw new Error(`compiled smoke build failed (${code}): ${Buffer.concat(stderr).toString() || Buffer.concat(stdout).toString()}`);
    return { directory, binary };
  } catch (error) {
    await terminate(build);
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

async function waitForStartup(child: ChildProcess, stderr: Buffer[]): Promise<Record<string, unknown>> {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`MCP startup timed out: ${Buffer.concat(stderr).toString()}`)), 10_000);
    const onData = (chunk: Buffer) => {
      stderr.push(Buffer.from(chunk));
      buffer += chunk.toString();
      for (const line of buffer.split("\n")) {
        if (!line.includes('"event":"mcp.server.started"')) continue;
        try {
          clearTimeout(timer);
          resolve(JSON.parse(line) as Record<string, unknown>);
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
        return;
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      reject(new Error(`MCP exited before startup: ${code ?? signal ?? "unknown"}`));
    };
    child.stderr?.on("data", onData);
    child.once("close", onClose);
  });
}

describe.serial("remote MCP Streamable HTTP", () => {
  it("smokes the compiled CLI/server binary", async () => {
    const compiled = await compileSmokeBinary();
    const directory = mkdtempSync(join(tmpdir(), "agent-bahi-compiled-http-"));
    const path = join(directory, "books.sqlite");
    const initialized = spawn(compiled.binary, ["--database", path, "database.init", "--json"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const child = spawn(compiled.binary, ["--database", path, "mcp", "serve", "--port", "0"], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    try {
      const initializedCode = await new Promise<number | null>((resolve) => initialized.once("close", resolve));
      expect(initializedCode).toBe(0);
      const diagnostic = await waitForStartup(child, stderr);
      const bindUrl = new URL(String(diagnostic.bindUrl));
      expect(bindUrl.hostname).toBe("127.0.0.1");
      expect(bindUrl.port).not.toBe("0");
      await waitForHealth(`${bindUrl.origin}/healthz`);
    } finally {
      await terminate(initialized);
      await terminate(child);
      rmSync(directory, { recursive: true, force: true });
      rmSync(compiled.directory, { recursive: true, force: true });
    }
  }, { timeout: 60_000 });

  it("starts through the documented CLI command, emits safe JSON diagnostics, and shuts down on SIGTERM", async () => {
    const database = await initializedDatabase();
    const child = spawn(process.execPath, [join(root, "src/cli.ts"), "--database", database.path, "mcp", "serve", "--port", "0"], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    try {
      const diagnostic = await waitForStartup(child, stderr);
      const bindUrl = new URL(String(diagnostic.bindUrl));
      expect(bindUrl.hostname).toBe("127.0.0.1");
      expect(bindUrl.pathname).toBe("/mcp");
      expect(bindUrl.port).not.toBe("0");
      expect(diagnostic.authMode).toBe("none-loopback");
      expect(String(diagnostic.database)).not.toContain(database.directory);
      expect(await (await fetch(`${bindUrl.origin}/healthz`)).json()).toMatchObject({ ok: true, status: "LIVE" });
    } finally {
      await terminate(child);
      rmSync(database.directory, { recursive: true, force: true });
    }
  });

  it("serves health/readiness and the same initialize/tools/list/call contract as stdio", async () => {
    const database = await initializedDatabase();
    const server = await startRemoteMcpServer({ databasePath: database.path, port: 0 });
    const transport = new StreamableHTTPClientTransport(new URL(server.url));
    const client = new Client({ name: "remote-http-test", version: "1" }, { capabilities: {} });
    try {
      expect((await fetch(server.url.replace("/mcp", "/healthz"))).status).toBe(200);
      expect((await fetch(server.url.replace("/mcp", "/readyz"))).status).toBe(200);
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === "tenant.create")).toBe(true);
      expect(tools.tools.some((tool) => tool.name === "database.init")).toBe(false);
      const result = await client.callTool({ name: "agent.skill.list", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ ok: true, operationId: "agent.skill.list" });
      const [parallelA, parallelB] = await Promise.all([
        client.callTool({ name: "agent.skill.list", arguments: {} }),
        client.callTool({ name: "agent.operation.list", arguments: {} }),
      ]);
      expect(parallelA.isError).not.toBe(true);
      expect(parallelB.isError).not.toBe(true);
      const unknown = await client.callTool({ name: "missing.operation", arguments: {} });
      expect(unknown.isError).toBe(true);
    } finally {
      await client.close().catch(() => undefined);
      await server.stop();
      rmSync(database.directory, { recursive: true, force: true });
    }
  });

  it("requires remote binding acknowledgement and bearer authentication without reflecting tokens", async () => {
    const database = await initializedDatabase();
    try {
      await expect(startRemoteMcpServer({ databasePath: database.path, host: "0.0.0.0", port: 0 })).rejects.toThrow("--allow-remote");
      const server = await startRemoteMcpServer({ databasePath: database.path, host: "0.0.0.0", port: 0, allowRemote: true, token: "correct-secret", allowedHosts: ["127.0.0.1"] });
      try {
        const url = new URL(server.url);
        const invalid = await fetch(url, { method: "POST", headers: { host: `127.0.0.1:${server.port}`, authorization: "Bearer wrong-secret", accept: "application/json, text/event-stream", "content-type": "application/json" }, body: "{}" });
        expect(invalid.status).toBe(401);
        expect(await invalid.text()).not.toContain("correct-secret");
        const forbidden = await fetch(url, { method: "POST", headers: { host: `evil.example:${server.port}`, authorization: "Bearer correct-secret", accept: "application/json, text/event-stream", "content-type": "application/json" }, body: "{}" });
        expect(forbidden.status).toBe(403);
      } finally {
        await server.stop();
      }
    } finally {
      rmSync(database.directory, { recursive: true, force: true });
    }
  });

  it("bounds malformed and oversized POST bodies and returns typed compatibility remediation", async () => {
    const database = await initializedDatabase();
    const server = await startRemoteMcpServer({ databasePath: database.path, port: 0, requestTimeoutMs: 50 });
    try {
      const malformed = await fetch(server.url, { method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json" }, body: "not-json" });
      expect(malformed.status).toBe(400);
      const oversized = await fetch(server.url, { method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json", connection: "close" }, body: JSON.stringify({ value: "x".repeat(1_100_000) }) });
      expect(oversized.status).toBe(413);
      const wrongContentType = await fetch(server.url, { method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "text/plain" }, body: "{}" });
      expect(wrongContentType.status).toBe(415);
      const wrongOrigin = await fetch(server.url, { method: "POST", headers: { origin: "http://evil.example", accept: "application/json, text/event-stream", "content-type": "application/json" }, body: "{}" });
      expect(wrongOrigin.status).toBe(403);
    } finally {
      await server.stop();
      rmSync(database.directory, { recursive: true, force: true });
    }
  });

  it("keeps readiness read-only and returns CLI-owned remediation for an uninitialized database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-bahi-remote-ready-"));
    const path = join(directory, "not-initialized.sqlite");
    const server = await startRemoteMcpServer({ databasePath: path, port: 0 });
    try {
      const response = await fetch(server.url.replace("/mcp", "/readyz"));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, status: "NOT_READY", error: { code: "UNINITIALIZED" } });
    } finally {
      await server.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
