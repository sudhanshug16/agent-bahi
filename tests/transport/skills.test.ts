import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SKILL_GUIDES, checkSkillGuide, validateSkillGuides } from "../../src/transport/skills.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

const root = process.cwd();

async function cli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [join(root, "src/cli.ts"), ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
  return { code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

function parsed(text: string): Record<string, unknown> { return JSON.parse(text) as Record<string, unknown>; }

describe("canonical Agent-Bahi skill guides and help operations", () => {
  it("contains unique guides with no registry integrity issues", () => {
    expect(SKILL_GUIDES).toHaveLength(10);
    expect(new Set(SKILL_GUIDES.map((guide) => guide.id)).size).toBe(10);
    expect(validateSkillGuides()).toEqual([]);
    for (const guide of SKILL_GUIDES) {
      expect(guide.preflightOperations.length).toBeGreaterThan(0);
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(guide.humanOnlyGates.length).toBeGreaterThan(0);
      expect(guide.operationReferences.length).toBeGreaterThan(0);
      expect(guide.completionEvidence.length).toBeGreaterThan(0);
    }
  });

  it("reports READY and PARTIAL according to structured external boundaries", () => {
    const statuses = Object.fromEntries(SKILL_GUIDES.map((guide) => [guide.id, checkSkillGuide(guide).status]));
    expect(statuses["daily-bookkeeping"]).toBe("READY");
    expect(statuses["bank-reconciliation"]).toBe("READY");
    expect(statuses["gst-gstr1-return"]).toBe("PARTIAL");
    expect(statuses["tds-tcs-bookkeeping"]).toBe("PARTIAL");
    expect(statuses["payroll-run"]).toBe("PARTIAL");
    expect(statuses["period-close-and-ca-pack"]).toBe("PARTIAL");
    expect(statuses["personal-income-tax-return"]).toBe("PARTIAL");
    expect(statuses["mca-private-company-annual-filing"]).toBe("PARTIAL");
  });

  it("detects missing operations, missing human gates, and scope transitions", () => {
    const base = SKILL_GUIDES[0];
    const broken = {
      ...base,
      id: "broken-test",
      operationReferences: ["fake.operation", "journal.post"],
      humanOnlyGates: [],
      steps: [{ ...base.steps[0], operationId: "fake.operation", scope: "taxCase" as const }, { ...base.steps[0], id: "scope-test", operationId: "journal.post", scope: "taxCase" as const }],
    };
    const issues = validateSkillGuides([broken]);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["MISSING_OPERATION", "MISSING_HUMAN_GATE", "INVALID_SCOPE_TRANSITION"]));
    const report = checkSkillGuide(broken);
    expect(report.status).toBe("BROKEN");
    expect(report.missingOperationIds).toEqual(["fake.operation"]);
  });

  it("dispatches bounded list/show/check and operation metadata without a database", async () => {
    const dispatcher = new OperationDispatcher({ databasePath: join(root, "does-not-exist.sqlite"), source: "CLI" });
    const list = await dispatcher.dispatch("agent.skill.list", {});
    expect(list.ok).toBe(true);
    expect(JSON.stringify(list)).toContain("daily-bookkeeping");
    const show = await dispatcher.dispatch("agent.operation.show", { operationId: "journal.post" });
    expect(show).toMatchObject({ ok: true, operationId: "agent.operation.show" });
    expect(JSON.stringify(show)).toContain("inputSchema");
    expect(JSON.stringify(show)).toContain("remediation");
    const check = await dispatcher.dispatch("agent.skill.check", { id: "daily-bookkeeping" });
    expect(check).toMatchObject({ ok: true, operationId: "agent.skill.check" });
    expect(JSON.stringify(check)).toContain('"status":"READY"');
    const unknown = await dispatcher.dispatch("agent.skill.show", { id: "missing" });
    expect(unknown).toMatchObject({ ok: false, error: { code: "UNKNOWN_SKILL" } });
  });

  it("keeps CLI human and JSON output on the documented streams", async () => {
    const human = await cli(["skills", "list"]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("daily-bookkeeping");
    expect(human.stderr).toBe("");
    const json = await cli(["operations", "show", "journal.post", "--json"]);
    expect(json.code).toBe(0);
    expect(parsed(json.stdout)).toMatchObject({ ok: true, operationId: "agent.operation.show" });
    expect(json.stderr).toBe("");
    const unknown = await cli(["skills", "show", "missing", "--json"]);
    expect(unknown.code).toBe(2);
    expect(parsed(unknown.stdout)).toMatchObject({ ok: false, error: { code: "UNKNOWN_SKILL" } });
    expect(unknown.stderr).toBe("");
  });

  it("exposes the same five metadata operations through MCP", async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, "src/mcp.ts"), "--database", join(root, "does-not-exist.sqlite")], cwd: root, stderr: "pipe" });
    const client = new Client({ name: "agent-bahi-skill-test", version: "1" }, { capabilities: {} });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(["agent.skill.list", "agent.skill.show", "agent.skill.check", "agent.operation.list", "agent.operation.show"]));
      const result = await client.callTool({ name: "agent.skill.check", arguments: { id: "daily-bookkeeping" } });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.structuredContent)).toContain('"status":"READY"');
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("keeps Markdown entrypoints aligned and free of secret-like literals", () => {
    const directories = readdirSync(join(root, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(directories.map((entry) => entry.name).sort()).toEqual(SKILL_GUIDES.map((guide) => guide.id).sort());
    for (const entry of directories) {
      const body = readFileSync(join(root, "skills", entry.name, "SKILL.md"), "utf8");
      expect(body).not.toMatch(/https?:\/\/|\b(password|passwd|token|secret|credential|api[_ -]?key)\b/i);
    }
  });
});
