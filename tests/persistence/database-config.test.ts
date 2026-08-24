import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import {
  getDefaultSqlitePath,
  parseDatabaseUrl,
  resolveDatabasePath,
  validateDatabaseConfig,
  type DatabaseConfig,
} from "../../src/infrastructure/config/database.ts";
import { DatabaseFactory } from "../../src/infrastructure/adapters/database-factory.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { DomainError } from "../../src/core/types.ts";

function expectDomainErrorCode(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe(code);
}

describe("database configuration", () => {
  test("accepts absolute local SQLite URLs and decodes their paths", () => {
    const absolute = parseDatabaseUrl("sqlite:///tmp/agent-bahi%20absolute.sqlite");
    const localhost = parseDatabaseUrl("sqlite://localhost/tmp/agent-bahi%20localhost.sqlite");

    expect(absolute).toEqual({
      dialect: "sqlite",
      sqlite: { path: "/tmp/agent-bahi absolute.sqlite" },
    });
    expect(localhost).toEqual({
      dialect: "sqlite",
      sqlite: { path: "/tmp/agent-bahi localhost.sqlite" },
    });
  });

  test("rejects empty, malformed, incomplete, unsafe, and credentialed SQLite URLs", () => {
    for (const url of [
      "",
      "sqlite://%",
      "sqlite:///tmp/agent-bahi%ZZ.sqlite",
      "sqlite://localhost",
      "sqlite:///",
      "sqlite://remote.example/tmp/agent-bahi.sqlite",
      "sqlite://user:password@localhost/tmp/agent-bahi.sqlite",
      "sqlite://localhost:5432/tmp/agent-bahi.sqlite",
    ]) {
      expectDomainErrorCode(() => parseDatabaseUrl(url), "INVALID_DATABASE_URL");
    }
  });

  test("rejects explicit remote, unsupported, and file URL schemes", () => {
    for (const scheme of ["postgresql", "postgres", "mysql", "http", "https", "oracle", "file"]) {
      expectDomainErrorCode(
        () => parseDatabaseUrl(`${scheme}://example.test/database.sqlite`),
        "INVALID_DATABASE_URL",
      );
    }
  });

  test("validates SQLite config and exact forged-config error codes", () => {
    expect(() => validateDatabaseConfig({ dialect: "sqlite", sqlite: { path: "/tmp/agent-bahi.sqlite" } })).not.toThrow();

    const forgedRemote = { dialect: "postgresql", sqlite: { path: "/tmp/agent-bahi.sqlite" } } as unknown as DatabaseConfig;
    expectDomainErrorCode(() => validateDatabaseConfig(forgedRemote), "UNSUPPORTED_DATABASE_DIALECT");

    const missingSqlite = { dialect: "sqlite" } as unknown as DatabaseConfig;
    expectDomainErrorCode(() => validateDatabaseConfig(missingSqlite), "INVALID_DATABASE_CONFIG");
  });

  test("resolves platform defaults, precedence, and malformed platform environment values without filesystem access", () => {
    expect(resolveDatabasePath({ platform: "darwin", home: "/Users/tester", env: {} })).toEqual({
      path: "/Users/tester/Library/Application Support/agent-bahi/agent-bahi.sqlite",
      source: "platform-default",
    });
    expect(resolveDatabasePath({ platform: "linux", home: "/home/tester", env: { XDG_DATA_HOME: "/tmp/data" } })).toEqual({
      path: "/tmp/data/agent-bahi/agent-bahi.sqlite",
      source: "platform-default",
    });
    expect(resolveDatabasePath({ platform: "linux", home: "/home/tester", env: { XDG_DATA_HOME: "relative/data" } })).toEqual({
      path: "/home/tester/.local/share/agent-bahi/agent-bahi.sqlite",
      source: "platform-default",
    });
    expect(resolveDatabasePath({ platform: "win32", home: "C:\\Users\\tester", env: { LOCALAPPDATA: "C:\\Data" } })).toEqual({
      path: "C:\\Data\\agent-bahi\\agent-bahi.sqlite",
      source: "platform-default",
    });
    expect(resolveDatabasePath({ platform: "win32", home: "C:\\Users\\tester", env: { LOCALAPPDATA: "relative" } })).toEqual({
      path: "C:\\Users\\tester\\AppData\\Local\\agent-bahi\\agent-bahi.sqlite",
      source: "platform-default",
    });
    expect(resolveDatabasePath({ platform: "freebsd", home: "/home/tester", env: {} })).toEqual({
      path: "/home/tester/.local/share/agent-bahi/agent-bahi.sqlite",
      source: "platform-default",
    });
    expect(resolveDatabasePath({ platform: "linux", home: "/home/tester", env: { AGENT_BAHI_DATABASE: "/var/lib/agent-bahi.sqlite" } })).toEqual({
      path: "/var/lib/agent-bahi.sqlite",
      source: "environment",
    });
    expect(resolveDatabasePath({ explicitPath: "relative.sqlite", platform: "linux", home: "/home/tester", env: { AGENT_BAHI_DATABASE: "/var/lib/ignored.sqlite" } })).toEqual({
      path: "relative.sqlite",
      source: "explicit",
    });
    expect(() => resolveDatabasePath({ platform: "linux", home: "", env: {} })).toThrow(DomainError);
    expect(() => resolveDatabasePath({ platform: "linux", env: {} })).toThrow(/absolute home directory/);
  });

  test("getDefaultSqlitePath uses the host platform default rather than TMPDIR", () => {
    expect(getDefaultSqlitePath()).toBe(resolveDatabasePath().path);
    expect(getDefaultSqlitePath()).toEndWith("agent-bahi/agent-bahi.sqlite");
  });

  test("creates a working isolated SQLite adapter and rejects forged remote config before opening", async () => {
    const controlledTmpDir = await mkdtemp(join(tmpdir(), "agent-bahi-factory-"));
    const sqlitePath = join(controlledTmpDir, `factory-${randomUUID()}.sqlite`);
    const forgedPath = join(controlledTmpDir, "forged-remote.sqlite");

    try {
      const database = DatabaseFactory.createDatabase({ dialect: "sqlite", sqlite: { path: sqlitePath } });
      expect(database).toBeInstanceOf(SqliteAdapter);

      try {
        expect(await database.isConnected()).toBe(true);
        const result = await database.querySingle("SELECT 1 AS value");
        expect(Number(result?.value)).toBe(1);
      } finally {
        await database.close();
      }

      const forgedRemote = {
        dialect: "postgresql",
        sqlite: { path: forgedPath },
      } as unknown as DatabaseConfig;
      expectDomainErrorCode(() => DatabaseFactory.createDatabase(forgedRemote), "UNSUPPORTED_DATABASE_DIALECT");
      expect(await Bun.file(forgedPath).exists()).toBe(false);
    } finally {
      await rm(controlledTmpDir, { recursive: true, force: true });
    }
  });
});
