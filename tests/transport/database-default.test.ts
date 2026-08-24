import { describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const fixtureRoot = process.platform === "darwin" ? "/private/tmp" : tmpdir();

function runCli(args: string[], cwd: string, home: string, xdgDataHome: string, extraEnv: Record<string, string | undefined> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const environment: Record<string, string | undefined> = { ...process.env, HOME: home, XDG_DATA_HOME: xdgDataHome, ...extraEnv };
  for (const key of ["AGENT_BAHI_DATABASE", "LOCALAPPDATA"]) {
    if (!(key in extraEnv)) delete environment[key];
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, "src/cli.ts"), ...args], { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("close", (code) => resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
  });
}

describe("platform-default SQLite lifecycle", () => {
  test("database.init creates and reuses the host platform default without touching cwd", async () => {
    const fixture = mkdtempSync(join(fixtureRoot, "agent-bahi-default-"));
    const home = join(fixture, "home");
    const dataHome = join(fixture, "xdg-data");
    const unrelatedCwd = join(fixture, "unrelated-cwd");
    mkdirSync(home);
    mkdirSync(unrelatedCwd);
    try {
      const first = await runCli(["database.init", "--json"], unrelatedCwd, home, dataHome);
      expect(first.code).toBe(0);
      expect(first.stderr).toBe("");
      const databaseRoot = process.platform === "darwin"
        ? join(home, "Library", "Application Support", "agent-bahi")
        : process.platform === "win32"
          ? join(home, "AppData", "Local", "agent-bahi")
          : join(dataHome, "agent-bahi");
      const databasePath = join(databaseRoot, "agent-bahi.sqlite");
      expect(lstatSync(databaseRoot).isDirectory()).toBe(true);
      expect(lstatSync(databasePath).isFile()).toBe(true);
      if (process.platform !== "win32") {
        expect(lstatSync(databaseRoot).mode & 0o777).toBe(0o700);
        expect(lstatSync(databasePath).mode & 0o777).toBe(0o600);
      }
      expect(() => lstatSync(join(unrelatedCwd, "agent-bahi.sqlite"))).toThrow();

      const second = await runCli(["database.init", "--json"], unrelatedCwd, home, dataHome);
      expect(second.code).toBe(0);
      expect(lstatSync(databasePath).isFile()).toBe(true);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("help, version, and read-only status do not initialize the default", async () => {
    const fixture = mkdtempSync(join(fixtureRoot, "agent-bahi-default-read-"));
    const home = join(fixture, "home");
    const dataHome = join(fixture, "xdg-data");
    mkdirSync(home);
    try {
      expect((await runCli([], fixture, home, dataHome)).code).toBe(0);
      expect((await runCli(["version", "--json"], fixture, home, dataHome)).code).toBe(0);
      expect((await runCli(["database.status", "--json"], fixture, home, dataHome)).code).toBe(4);
      const defaultRoot = process.platform === "darwin" ? join(home, "Library", "Application Support", "agent-bahi") : process.platform === "win32" ? join(home, "AppData", "Local", "agent-bahi") : join(dataHome, "agent-bahi");
      expect(() => lstatSync(defaultRoot)).toThrow();
      expect(() => lstatSync(join(fixture, "agent-bahi.sqlite"))).toThrow();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("explicit and environment paths still require an existing parent", async () => {
    const fixture = mkdtempSync(join(fixtureRoot, "agent-bahi-default-parent-"));
    const home = join(fixture, "home");
    mkdirSync(home);
    try {
      const explicitParent = join(fixture, "missing-explicit");
      const explicit = await runCli(["--database", join(explicitParent, "books.sqlite"), "database.init", "--json"], fixture, home, join(fixture, "xdg"));
      expect(explicit.code).toBe(4);
      expect(() => lstatSync(explicitParent)).toThrow();

      const environmentParent = join(fixture, "missing-environment");
      const environment = await runCli(["database.init", "--json"], fixture, home, join(fixture, "xdg"), { AGENT_BAHI_DATABASE: join(environmentParent, "books.sqlite") });
      expect(environment.code).toBe(4);
      expect(() => lstatSync(environmentParent)).toThrow();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("rejects a platform-default symlink collision without following it", async () => {
    if (process.platform === "win32") return;
    const fixture = mkdtempSync(join(fixtureRoot, "agent-bahi-default-symlink-"));
    const home = join(fixture, "home");
    const dataHome = join(fixture, "xdg-data");
    const target = join(fixture, "outside");
    mkdirSync(home);
    mkdirSync(target);
    const databaseParent = process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : dataHome;
    mkdirSync(databaseParent, { recursive: true });
    symlinkSync(target, join(databaseParent, "agent-bahi"), "dir");
    try {
      const result = await runCli(["database.init", "--json"], fixture, home, dataHome);
      expect(result.code).toBe(4);
      expect(result.stdout).toContain("SQLITE_UNSAFE_PATH");
      expect(() => lstatSync(join(target, "agent-bahi.sqlite"))).toThrow();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("rejects a symlink-redirection component before creating a database in its target", async () => {
    if (process.platform === "win32") return;
    const fixture = mkdtempSync(join(fixtureRoot, "agent-bahi-default-redirect-"));
    const home = join(fixture, "home");
    const dataHome = join(fixture, "xdg-data");
    const target = join(fixture, "redirect-target");
    mkdirSync(home);
    mkdirSync(target);
    if (process.platform === "darwin") {
      mkdirSync(join(home, "Library"), { recursive: true });
      symlinkSync(target, join(home, "Library", "Application Support"), "dir");
    } else {
      symlinkSync(target, dataHome, "dir");
    }
    try {
      const result = await runCli(["database.init", "--json"], fixture, home, dataHome);
      expect(result.code).toBe(4);
      expect(result.stdout).toContain("SQLITE_UNSAFE_PATH");
      expect(() => lstatSync(join(target, "agent-bahi.sqlite"))).toThrow();
      expect(() => lstatSync(join(target, "agent-bahi"))).toThrow();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
