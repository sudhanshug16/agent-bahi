import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { NativeBunSqlite } from "../../src/infrastructure/sqlite/native-sqlite.ts";

describe("NativeBunSqlite adapter", () => {
  test("rejects non-local filesystem paths with the public typed error", () => {
    for (const path of ["/net/example/proof.sqlite", "//server/share/proof.sqlite", "/mnt/remote/proof.sqlite"]) {
      expect(() => new NativeBunSqlite(path)).toThrow("SQLite database path rejected for safety");
    }
  });

  test("rejects unsafe path traversal", () => {
    const tmpdir = process.env.TMPDIR ?? "/tmp";
    expect(() => new NativeBunSqlite(`${tmpdir}/../../../etc/passwd`)).toThrow("SQLite database path rejected for safety");
  });

  test("enforces PRAGMA foreign_keys=ON", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-native-"));
    const path = join(directory, "foreign-keys.sqlite");
    const db = new NativeBunSqlite(path);
    try {
      const results = db.query<{ foreign_keys: number | bigint }>("PRAGMA foreign_keys");
      expect(results.length).toBe(1);
      expect(Number(results[0].foreign_keys)).toBe(1);
    } finally {
      db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("enforces PRAGMA journal_mode=WAL", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-native-"));
    const path = join(directory, "wal.sqlite");
    const db = new NativeBunSqlite(path);
    try {
      const results = db.query<{ journal_mode: string }>("PRAGMA journal_mode");
      expect(results.length).toBe(1);
      expect(results[0].journal_mode?.toLowerCase()).toBe("wal");
    } finally {
      db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("enforces PRAGMA busy_timeout=50", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-native-"));
    const path = join(directory, "busy.sqlite");
    const db = new NativeBunSqlite(path);
    try {
      const results = db.query<{ timeout: number | bigint }>("PRAGMA busy_timeout");
      expect(results.length).toBe(1);
      expect(Number(results[0].timeout)).toBe(50);
    } finally {
      db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("constructor verifies PRAGMA settings are enforced", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-native-"));
    const path = join(directory, "verify.sqlite");

    const db = new NativeBunSqlite(path);
    db.close();

    expect(() => {
      new NativeBunSqlite(path);
    }).not.toThrow();

    await rm(directory, { recursive: true, force: true });
  });
});
