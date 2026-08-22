import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import {
  getDefaultSqlitePath,
  parseDatabaseUrl,
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

  test("derives a deterministic default SQLite path and restores TMPDIR", async () => {
    const controlledTmpDir = await mkdtemp(join(tmpdir(), "agent-bahi-config-"));
    const originalTmpDir = Bun.env.TMPDIR;

    try {
      Bun.env.TMPDIR = controlledTmpDir;
      const expectedPath = join(controlledTmpDir, "agent-bahi.sqlite");

      expect(getDefaultSqlitePath()).toBe(expectedPath);
      expect(getDefaultSqlitePath()).toBe(expectedPath);
    } finally {
      if (originalTmpDir === undefined) {
        delete Bun.env.TMPDIR;
      } else {
        Bun.env.TMPDIR = originalTmpDir;
      }
      await rm(controlledTmpDir, { recursive: true, force: true });
    }

    expect(Bun.env.TMPDIR).toBe(originalTmpDir);
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
