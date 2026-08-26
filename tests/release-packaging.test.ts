import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The release helper is intentionally executed by Node in the workflow; Bun tests import it to inject deterministic fetch responses.
// @ts-expect-error JavaScript release helper has no generated declaration file.
import { checkNpmVersion } from "../scripts/npm-version-preflight.mjs";

const root = process.cwd();

async function text(path: string): Promise<string> {
  return readFile(join(root, path), "utf8");
}

async function runPackMetadataParser(workflow: string, metadata: unknown): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const startMarker = "TARBALL=\"$(node -e '";
  const endMarker = "' \"$PACKAGE_NAME\" \"$PACK_JSON\")\"";
  const start = workflow.indexOf(startMarker);
  const end = workflow.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error("pack metadata parser is missing");
  const parser = workflow.slice(start + startMarker.length, end);
  const child = Bun.spawn(["node", "-e", parser, "@sudhanshug/agent-bahi", JSON.stringify(metadata)], {
    cwd: root,
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
      repository: { type: string; url: string };
      homepage: string;
      bugs: { url: string };
      publishConfig: { access: string; registry: string };
    };

    expect(manifest).toMatchObject({
      name: "@sudhanshug/agent-bahi",
      version: "1.0.1",
      license: "MIT",
      packageManager: "bun@1.3.14",
      engines: { bun: "1.3.14" },
      bin: { "agent-bahi": "src/cli.ts", "agent-bahi-mcp": "src/mcp.ts" },
      repository: { type: "git", url: "git+https://github.com/sudhanshug16/agent-bahi.git" },
      homepage: "https://github.com/sudhanshug16/agent-bahi",
      bugs: { url: "https://github.com/sudhanshug16/agent-bahi/issues" },
      publishConfig: { access: "public", registry: "https://registry.npmjs.org/" },
    });
    expect(manifest.private).toBeUndefined();
    expect(manifest.files).toEqual(expect.arrayContaining(["LICENSE", "README.md", "docs", "drizzle", "runtime-versions.json", "skills", "src", "scripts"]));
    expect(manifest.files).not.toContain("dist");
    expect(manifest.scripts["build:release"]).toContain("bun run build");
    expect(manifest.scripts.build).toContain("--no-compile-autoload-dotenv --no-compile-autoload-bunfig");
    expect(manifest.scripts["build:macos-arm64"]).toContain("--no-compile-autoload-dotenv --no-compile-autoload-bunfig");
    expect(manifest.scripts["test:release"]).toBe("bun test tests/release-packaging.test.ts");
    expect(manifest.scripts["release:check"]).toBe("bun run typecheck && bun run validate:skills && bun test");
    expect(manifest.scripts.prepublishOnly).toBe("bun run release:check");
  });

  it("ships executable Bun entrypoints and the Trusted Publishing workflow", async () => {
    const [cli, mcp, workflow] = await Promise.all([text("src/cli.ts"), text("src/mcp.ts"), text(".github/workflows/publish-npm.yml")]);
    for (const entrypoint of [cli, mcp]) expect(entrypoint.startsWith("#!/usr/bin/env bun\n")).toBe(true);
    expect(workflow).toContain("name: Publish npm");
    expect(workflow).toContain("actions/checkout@v6");
    const pushTrigger = workflow.slice(workflow.indexOf("  push:"), workflow.indexOf("  workflow_dispatch:"));
    expect(pushTrigger).toContain("      - .github/workflows/publish-npm.yml");
    expect(workflow).toContain("actions/setup-node@v7");
    expect(workflow).not.toContain("actions/setup-node@v6");
    expect(workflow).toContain("node-version: 24.15.0");
    expect(workflow).not.toContain("registry-url:");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("oven-sh/setup-bun@v2");
    expect(workflow).toContain("bun-version: 1.3.14");
    expect(workflow).toContain("npm install --global npm@12.0.2");
    expect(workflow).toContain('test "$(npm --version)" = "12.0.2"');
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun run release:check");
    expect(workflow).toContain("scripts/npm-version-preflight.mjs");
    expect(workflow).toContain('echo "npm publish preflight: checking exact registry version."');
    expect(workflow).toContain('echo "npm publish stage: starting Trusted Publishing publish."');
    expect(workflow).not.toContain("npm view");
    expect(workflow).not.toContain("--silent");
    expect(workflow).toContain('if [ -s "$PREFLIGHT_ERROR" ]; then');
    expect(workflow).toContain("npm version preflight failed without diagnostics; refusing to publish.");
    expect(workflow).toContain('elif [ ! -s "$LATEST_NPM_LOG" ]; then');
    expect(workflow).toContain("npm publish failed; npm debug log was empty:");
    expect(workflow).toContain("npm pack --dry-run");
    expect(workflow).toContain("npm pack --pack-destination \"$RUNNER_TEMP\" --json");
    expect(workflow).toContain("!Array.isArray(metadata)");
    expect(workflow).toContain("Object.keys(metadata).length === 1");
    expect(workflow).toContain("Object.hasOwn(metadata, packageName)");
    expect(workflow).toContain("typeof filename !== \"string\"");
    expect(workflow).toContain("/^[A-Za-z0-9][A-Za-z0-9._-]*\\.tgz$/");
    expect(workflow).toContain("path.basename(filename) !== filename");
    expect(workflow).toContain("process.stdout.write(filename)");
    expect(workflow).toContain("npm install --ignore-scripts");
    expect(workflow).toContain("agent-bahi --version");
    expect(workflow).toContain("agent-bahi --help");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain('if [ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] || [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then');
    expect(workflow).toContain("Refusing to publish: GitHub Actions OIDC environment is unavailable.");
    expect(workflow).toContain('if [ -n "${NODE_AUTH_TOKEN:-}" ]; then');
    expect(workflow).toContain("reject_npmrc_auth_token() {");
    expect(workflow).toContain("grep -Eqi '(^|:)_authtoken[[:space:]]*=' \"$npmrc_path\"");
    expect(workflow).toContain('reject_npmrc_auth_token ".npmrc"');
    expect(workflow).toContain('reject_npmrc_auth_token "$HOME/.npmrc"');
    expect(workflow).toContain('if [ -n "${NPM_CONFIG_USERCONFIG:-}" ]; then');
    expect(workflow).toContain('reject_npmrc_auth_token "$NPM_CONFIG_USERCONFIG"');
    expect(workflow).toContain("Refusing to publish: NODE_AUTH_TOKEN is set");
    expect(workflow).toContain("Refusing to publish: npm config contains _authToken");
    expect(workflow).toContain("npm publish --access public --provenance --loglevel verbose");
    expect(workflow).toContain('NPM_LOG_DIR="$RUNNER_TEMP/npm-publish-debug"');
    expect(workflow).toContain('mkdir -p "$NPM_LOG_DIR"');
    expect(workflow).toContain('export npm_config_logs_dir="$NPM_LOG_DIR"');
    expect(workflow).toContain("redact_npm_log() {");
    expect(workflow).toContain("https?://[^[:space:]]+");
    expect(workflow).toContain("ACTIONS_ID_TOKEN_REQUEST_TOKEN[[:space:]]*[:=]");
    expect(workflow).toContain("authorization|proxy-authorization|cookie|set-cookie");
    expect(workflow).toContain("access[_-]?token|id[_-]?token|refresh[_-]?token");
    expect(workflow).toContain("bearer|jwt");
    expect(workflow).toContain("eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+");
    expect(workflow).toContain("mapfile -d '' NPM_LOGS");
    expect(workflow).toContain('redact_npm_log "$LATEST_NPM_LOG" >&2');
    expect(workflow).toContain("PUBLISH_STATUS=$?");
    expect(workflow).toContain('exit "$PUBLISH_STATUS"');
    expect(workflow).not.toMatch(/(?:echo|cat)[^\n]*ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
    expect(workflow).not.toMatch(/(?:echo|cat)[^\n]*ACTIONS_ID_TOKEN_REQUEST_URL/);
    expect(workflow).not.toContain('cat "$LATEST_NPM_LOG"');
    expect(workflow).not.toMatch(/^\s*(?:export\s+)?NODE_AUTH_TOKEN\s*=/m);
    expect(workflow).not.toMatch(/^\s*NODE_AUTH_TOKEN:\s*/m);
    expect(workflow).not.toContain("npm stage publish");
    expect(workflow).toContain("--provenance");

    const publishCommand = workflow.indexOf("npm publish --access public");
    const logDirectory = workflow.indexOf('NPM_LOG_DIR="$RUNNER_TEMP/npm-publish-debug"');
    const redactor = workflow.indexOf("redact_npm_log() {");
    const publishStatus = workflow.indexOf("PUBLISH_STATUS=$?");
    const failureBranch = workflow.indexOf('if [ "$PUBLISH_STATUS" -ne 0 ]; then');
    const diagnosticNoExit = workflow.indexOf("set +e", failureBranch);
    const diagnosticRestoreExit = workflow.indexOf("set -e", diagnosticNoExit);
    const redactedEmission = workflow.indexOf('redact_npm_log "$LATEST_NPM_LOG" >&2');
    const propagatedStatus = workflow.indexOf('exit "$PUBLISH_STATUS"');
    expect(logDirectory).toBeLessThan(publishCommand);
    expect(redactor).toBeGreaterThan(logDirectory);
    expect(publishStatus).toBeGreaterThan(publishCommand);
    expect(diagnosticNoExit).toBeGreaterThan(failureBranch);
    expect(redactedEmission).toBeGreaterThan(redactor);
    expect(redactedEmission).toBeGreaterThan(publishStatus);
    expect(diagnosticRestoreExit).toBeGreaterThan(redactedEmission);
    expect(propagatedStatus).toBeGreaterThan(redactedEmission);
    expect(propagatedStatus).toBeGreaterThan(diagnosticRestoreExit);
    expect(workflow.indexOf("npm install --global npm@12.0.2")).toBeLessThan(publishCommand);
    expect(workflow.indexOf('echo "npm publish preflight: checking exact registry version."')).toBeLessThan(publishCommand);
    expect(workflow.indexOf('echo "npm publish stage: starting Trusted Publishing publish."')).toBeLessThan(publishCommand);
    expect(workflow.indexOf('if [ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] || [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then')).toBeLessThan(publishCommand);
    expect(workflow.indexOf('if [ -n "${NODE_AUTH_TOKEN:-}" ]; then')).toBeLessThan(publishCommand);
    expect(workflow.indexOf('reject_npmrc_auth_token ".npmrc"')).toBeLessThan(publishCommand);
    expect(workflow.indexOf('reject_npmrc_auth_token "$HOME/.npmrc"')).toBeLessThan(publishCommand);
    expect(workflow.indexOf('reject_npmrc_auth_token "$NPM_CONFIG_USERCONFIG"')).toBeLessThan(publishCommand);
    expect(workflow.indexOf("--loglevel verbose", publishCommand)).toBeGreaterThan(publishCommand);
  });

  it("makes the npm version preflight fail closed around mocked registry responses", async () => {
    const request = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
      async () => ({ status, ok, json: async () => body }) as Response;

    expect(await checkNpmVersion({
      packageName: "@sudhanshug/agent-bahi",
      packageVersion: "1.0.1",
      fetchImpl: request(200, { versions: { "1.0.1": {} } }),
    })).toBe("exists");

    expect(await checkNpmVersion({
      packageName: "@sudhanshug/agent-bahi",
      packageVersion: "1.0.1",
      fetchImpl: request(200, { versions: { "0.9.0": {} } }),
    })).toBe("absent");

    await expect(checkNpmVersion({
      packageName: "@sudhanshug/agent-bahi",
      packageVersion: "1.0.1",
      fetchImpl: request(503, { error: "registry unavailable" }),
    })).rejects.toThrow("registry returned HTTP 503");

    await expect(checkNpmVersion({
      packageName: "@sudhanshug/agent-bahi",
      packageVersion: "1.0.1",
      fetchImpl: request(200, "not a packument"),
    })).rejects.toThrow("registry packument is malformed");

    await expect(checkNpmVersion({
      packageName: "@sudhanshug/agent-bahi",
      packageVersion: "1.0.1",
      fetchImpl: async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } }) as unknown as Response,
    })).rejects.toThrow("registry returned malformed JSON");
  });

  it("parses npm 12 pack metadata and rejects unsafe filenames", async () => {
    const workflow = await text(".github/workflows/publish-npm.yml");
    const npm12Metadata = {
      "@sudhanshug/agent-bahi": {
        id: "@sudhanshug/agent-bahi@1.0.1",
        name: "@sudhanshug/agent-bahi",
        version: "1.0.1",
        filename: "sudhanshug-agent-bahi-1.0.1.tgz",
      },
    };
    const valid = await runPackMetadataParser(workflow, npm12Metadata);
    expect(valid.exitCode).toBe(0);
    expect(valid.stdout).toBe("sudhanshug-agent-bahi-1.0.1.tgz");
    expect(valid.stderr).toBe("");

    for (const metadata of [
      [],
      { "@sudhanshug/agent-bahi": {} },
      { "@sudhanshug/agent-bahi": { filename: "../agent-bahi.tgz" } },
      { "@sudhanshug/agent-bahi": { filename: "/tmp/agent-bahi.tgz" } },
      { "@sudhanshug/agent-bahi": { filename: "agent-bahi.zip" } },
      {
        "@sudhanshug/agent-bahi": { filename: "agent-bahi.tgz" },
        "@other/package": { filename: "other.tgz" },
      },
    ]) {
      const invalid = await runPackMetadataParser(workflow, metadata);
      expect(invalid.exitCode).not.toBe(0);
    }
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
      expect(content).toContain("@sudhanshug/agent-bahi");
      expect(content).toContain("Bun `1.3.14`");
      expect(content).toContain("agent-bahi");
      expect(content).toContain("agent-bahi-mcp");
      expect(content).toContain(".github/workflows/publish-npm.yml");
      expect(content).toContain("Trusted Publishing");
      expect(content).toContain("automatic provenance");
      expect(content).toContain("long-lived npm token");
      expect(content).toContain("compiled binaries");
    }
    expect(readme).toContain("Trial Balance");
    expect(readme).toContain("Profit and Loss");
    expect(readme).toContain("Balance Sheet");
    expect(readme).toContain("Zoho Books import");
    expect(operatorGuide).toContain('signing: "not provided in V1"');
    expect(readme).not.toContain("does not publish packages");
    expect(operatorGuide).not.toContain("does not imply\nthat an npm package");
    expect(operatorGuide).not.toContain("does not publish to npm");
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
    expect(stdout).toContain("agent-bahi 1.0.1");
    expect(stdout).toContain("database.upgrade");
    expect(stdout).toContain("Local stdio MCP");
    expect(stdout).toContain("TLS proxy/Tailscale");
  });

  it("supports the installed package's version flag", async () => {
    const child = Bun.spawn([globalThis.process.execPath, "run", "src/cli.ts", "--version"], {
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
    expect(stdout.trim()).toBe("1.0.1");
  });
});
