import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function text(path: string): Promise<string> {
  return readFile(join(root, path), "utf8");
}

describe("local MIT release packaging contract", () => {
  it("is public, MIT licensed, Bun-pinned, and includes both source entrypoints", async () => {
    const manifest = JSON.parse(await text("package.json")) as {
      name: string;
      version: string;
      private?: boolean;
      license: string;
      packageManager: string;
      files: string[];
      bin: Record<string, string>;
      engines: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(manifest).toMatchObject({
      name: "agent-bahi",
      version: "1.0.0",
      license: "MIT",
      packageManager: "bun@1.3.14",
      engines: { bun: "1.3.14" },
      bin: { "agent-bahi": "src/cli.ts", "agent-bahi-mcp": "src/mcp.ts" },
    });
    expect(manifest.private).toBeUndefined();
    expect(manifest.files).toEqual(expect.arrayContaining(["LICENSE", "README.md", "src", "dist"]));
    expect(manifest.scripts["build:release"]).toContain("bun run build");
    expect(manifest.scripts["test:release"]).toBe("bun test tests/release-packaging.test.ts");
  });

  it("ships the canonical generic MIT notice and truthful unsigned release metadata", async () => {
    const license = await text("LICENSE");
    const releaseScript = await text("scripts/release-manifest.ts");
    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright (c) 2026 Agent-Bahi contributors");
    expect(license).toContain("THE SOFTWARE IS PROVIDED \"AS IS\"");
    expect(releaseScript).toContain('signing: "not provided in V1"');
  });

  it("keeps README and operator documentation aligned with the implemented V1 boundary", async () => {
    const readme = await text("README.md");
    const operatorGuide = await text("docs/cli-mcp.md");
    for (const content of [readme, operatorGuide]) {
      expect(content).toContain("SQLite");
      expect(content).toContain("database.init");
      expect(content).toContain("backup");
      expect(content).toContain("restore");
      expect(content).toContain("upgrade");
      expect(content).toContain("stdio");
      expect(content).toContain("plain HTTP");
      expect(content).toContain("Tailscale");
      expect(content).toContain("HTTPS");
      expect(content).toContain("DSC");
      expect(content).not.toContain("Implementation is intentionally not started");
      expect(content).not.toContain("No code exists yet");
    }
    expect(readme).toContain("Trial Balance");
    expect(readme).toContain("Profit and Loss");
    expect(readme).toContain("Balance Sheet");
    expect(readme).toContain("Zoho Books import");
    expect(operatorGuide).toContain('signing: "not provided in V1"');
  });

  it("keeps CLI help runnable and explicit about the release/MCP boundary", async () => {
    const child = Bun.spawn([globalThis.process.execPath, "run", "src/cli.ts", "--help"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("agent-bahi 1.0.0");
    expect(stdout).toContain("database.upgrade");
    expect(stdout).toContain("Local stdio MCP");
    expect(stdout).toContain("TLS proxy/Tailscale");
  });
});
