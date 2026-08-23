import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
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

describe.serial("remote MCP Streamable HTTP", () => {
  it("smokes the compiled CLI/server binary", async () => {
    const binary = join(root, "dist", "agent-bahi");
    expect(await Bun.file(binary).exists()).toBe(true);
    const directory = mkdtempSync(join(tmpdir(), "agent-bahi-compiled-http-"));
    const path = join(directory, "books.sqlite");
    const initialized = spawn(binary, ["--database", path, "database.init", "--json"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const initializedCode = await new Promise<number | null>((resolve) => initialized.once("close", resolve));
    expect(initializedCode).toBe(0);
    const child = spawn(binary, ["--database", path, "mcp", "serve", "--port", "39106"], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`compiled MCP startup timed out: ${Buffer.concat(stderr).toString()}`)), 10_000);
        child.stderr.on("data", (chunk) => {
          if (Buffer.from(chunk).toString().includes('"event":"mcp.server.started"')) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("exit", (code) => reject(new Error(`compiled MCP exited before startup: ${code}`)));
      });
      expect((await fetch("http://127.0.0.1:39106/healthz")).status).toBe(200);
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("close", () => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("starts through the documented CLI command, emits safe JSON diagnostics, and shuts down on SIGTERM", async () => {
    const database = await initializedDatabase();
    const port = 39104;
    const child = spawn(process.execPath, [join(root, "src/cli.ts"), "--database", database.path, "mcp", "serve", "--port", String(port)], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`MCP startup timed out: ${Buffer.concat(stderr).toString()}`)), 10_000);
        child.stderr.on("data", (chunk) => {
          if (Buffer.from(chunk).toString().includes('"event":"mcp.server.started"')) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("exit", (code) => reject(new Error(`MCP exited before startup: ${code}`)));
      });
      const diagnostic = JSON.parse(Buffer.concat(stderr).toString().split("\n").find((line) => line.includes('"mcp.server.started"'))!) as Record<string, unknown>;
      expect(diagnostic.bindUrl).toBe(`http://127.0.0.1:${port}/mcp`);
      expect(diagnostic.authMode).toBe("none-loopback");
      expect(String(diagnostic.database)).not.toContain(database.directory);
      expect(await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).toMatchObject({ ok: true, status: "LIVE" });
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("close", () => resolve()));
      rmSync(database.directory, { recursive: true, force: true });
    }
  });

  it("serves health/readiness and the same initialize/tools/list/call contract as stdio", async () => {
    const database = await initializedDatabase();
    const server = await startRemoteMcpServer({ databasePath: database.path, port: 39101 });
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
      const server = await startRemoteMcpServer({ databasePath: database.path, host: "0.0.0.0", port: 39102, allowRemote: true, token: "correct-secret", allowedHosts: ["127.0.0.1"] });
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
    const server = await startRemoteMcpServer({ databasePath: database.path, port: 39103, requestTimeoutMs: 50 });
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
    const server = await startRemoteMcpServer({ databasePath: path, port: 39105 });
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
