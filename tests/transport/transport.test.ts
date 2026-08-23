import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();

async function cli(db: string, args: string[], input?: unknown): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [join(root, "src/cli.ts"), "--database", db, ...args], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  if (input !== undefined) child.stdin.end(JSON.stringify(input)); else child.stdin.end();
  const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
  return { code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

function json(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe("shared CLI and stdio MCP transport", () => {
  it("reports an empty database without creating or mutating it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-bahi-transport-"));
    const db = join(dir, "empty.sqlite");
    try {
      const result = await cli(db, ["database.status", "--json"]);
      expect(result.code).toBe(0);
      expect(json(result.stdout).result).toMatchObject({ status: "UNINITIALIZED" });
      expect(() => statSync(db)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps human failures on stderr while successful human output stays on stdout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-bahi-human-"));
    const db = join(dir, "human.sqlite");
    try {
      const unknown = await cli(db, ["operations", "run", "unknown.operation", "--input", "-"], {});
      expect(unknown.code).toBe(2);
      expect(unknown.stdout).toBe("");
      expect(unknown.stderr).toContain("UNKNOWN_OPERATION");

      expect((await cli(db, ["database.init", "--json"])).code).toBe(0);
      const domain = await cli(db, ["operations", "run", "tenant.get", "--input", "-"], { tenantId: "missing-tenant" });
      expect(domain.code).toBe(4);
      expect(domain.stdout).toBe("");
      expect(domain.stderr).toContain("TENANT_NOT_FOUND");

      const success = await cli(db, ["database.status"]);
      expect(success.code).toBe(0);
      expect(success.stdout).toContain('"status": "READY"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses one typed operation dispatcher for CLI and official MCP stdio", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-bahi-mcp-"));
    const db = join(dir, "books.sqlite");
    const request = {
      schemaVersion: 1,
      tenantId: "tenant-transport",
      requestId: "request-transport-1",
      actor: { kind: "HUMAN", id: "test" },
      source: "CLI",
      reason: "transport test",
      payload: { kind: "COMPANY", name: "Transport Test" },
    };
    let transport: StdioClientTransport | undefined;
    try {
      expect((await cli(db, ["database.init", "--json"])).code).toBe(0);
      const cliResult = json((await cli(db, ["operations", "run", "tenant.create", "--input", "-", "--json"], request)).stdout);
      transport = new StdioClientTransport({ command: process.execPath, args: [join(root, "src/mcp.ts"), "--database", db], cwd: root, stderr: "pipe" });
      const client = new Client({ name: "agent-bahi-test", version: "1" }, { capabilities: {} });
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === "tenant.create")).toBe(true);
      expect(tools.tools.some((tool) => tool.name === "database.init")).toBe(false);
      const mcpResult = await client.callTool({ name: "tenant.create", arguments: request });
      expect(mcpResult.isError).not.toBe(true);
      expect((mcpResult.structuredContent as { resultHash: string }).resultHash).toBe(String(cliResult.resultHash));
      expect((mcpResult.structuredContent as { replayed?: boolean }).replayed).toBe(true);
      const operatorResult = await client.callTool({ name: "database.init", arguments: {} });
      expect(operatorResult.isError).toBe(true);
      await client.close();
    } finally {
      await transport?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes company.status through the status shortcut and MCP with the same dispatcher result shape", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-bahi-company-status-transport-"));
    const db = join(dir, "books.sqlite");
    let transport: StdioClientTransport | undefined;
    try {
      expect((await cli(db, ["database.init", "--json"])).code).toBe(0);
      const created = json((await cli(db, ["operations", "run", "tenant.create", "--input", "-", "--json"], {
        schemaVersion: 1, tenantId: "status-transport", requestId: "status-transport-create", actor: { kind: "HUMAN", id: "test" }, source: "CLI", reason: "status transport", payload: { kind: "COMPANY", name: "Status Transport" },
      })).stdout);
      const tenantId = String((created.result as { tenantId: string }).tenantId);
      const bookSetId = String((created.result as { defaultBookSetId: string }).defaultBookSetId);
      expect((await cli(db, ["operations", "run", "tenant.activate", "--input", "-", "--json"], {
        schemaVersion: 1, tenantId, requestId: "status-transport-activate", actor: { kind: "HUMAN", id: "test" }, source: "CLI", reason: "activate status transport", payload: { defaultBookSetId: bookSetId },
      })).code).toBe(0);
      const cliStatus = await cli(db, ["status", "--as-of-date", "2026-08-23", "--json"]);
      expect(cliStatus.code).toBe(0);
      const cliEnvelope = json(cliStatus.stdout);
      expect(cliEnvelope.operationId).toBe("company.status");

      transport = new StdioClientTransport({ command: process.execPath, args: [join(root, "src/mcp.ts"), "--database", db], cwd: root, stderr: "pipe" });
      const client = new Client({ name: "agent-bahi-status-test", version: "1" }, { capabilities: {} });
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === "company.status")).toBe(true);
      const mcpResult = await client.callTool({ name: "company.status", arguments: { asOfDate: "2026-08-23" } });
      expect(mcpResult.isError).not.toBe(true);
      expect((mcpResult.structuredContent as { ok: boolean; operationId: string; resultHash: string }).ok).toBe(true);
      expect((mcpResult.structuredContent as { operationId: string }).operationId).toBe("company.status");
      expect((mcpResult.structuredContent as { resultHash: string }).resultHash).toBe(String(cliEnvelope.resultHash));
      await client.close();
    } finally {
      await transport?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a BookSet read when the tenant scope does not own it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-bahi-scope-"));
    const db = join(dir, "books.sqlite");
    const envelope = (tenantId: string, requestId: string, name: string) => ({
      schemaVersion: 1, tenantId, requestId, actor: { kind: "HUMAN", id: "test" }, source: "CLI", reason: "scope test",
      payload: { kind: "COMPANY", name },
    });
    try {
      expect((await cli(db, ["database.init", "--json"])).code).toBe(0);
      const first = json((await cli(db, ["operations", "run", "tenant.create", "--input", "-", "--json"], envelope("tenant-a", "request-a", "A"))).stdout);
      const second = json((await cli(db, ["operations", "run", "tenant.create", "--input", "-", "--json"], envelope("tenant-b", "request-b", "B"))).stdout);
      const firstBookSet = (first.result as { defaultBookSetId?: string }).defaultBookSetId;
      const secondTenant = (second.result as { tenantId?: string }).tenantId ?? "tenant-b";
      expect(firstBookSet).toBeString();
      const crossScope = json((await cli(db, ["operations", "run", "book-set.get", "--input", "-", "--json"], { tenantId: secondTenant, bookSetId: firstBookSet })).stdout);
      expect(crossScope.ok).toBe(false);
      expect((crossScope.error as { code: string }).code).toMatch(/BOOK_SET|TENANT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
