import { describe, expect, test } from "bun:test";
import { NativeBunSqlite } from "../../src/infrastructure/sqlite/native-sqlite.ts";

function cleanupDb(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      const file = Bun.file(`${path}${suffix}`);
      if (file) {
        file.delete().catch(() => {
          // ignore
        });
      }
    } catch {
      // ignore
    }
  }
}

describe("NativeBunSqlite adapter", () => {
  test("rejects non-local filesystem paths", () => {
    expect(() => new NativeBunSqlite("/net/example/proof.sqlite")).toThrow("refusing non-local");
    expect(() => new NativeBunSqlite("//server/share/proof.sqlite")).toThrow("refusing non-local");
    expect(() => new NativeBunSqlite("/mnt/remote/proof.sqlite")).toThrow("refusing non-local");
  });

  test("rejects unsafe path traversal", () => {
    const tmpdir = process.env.TMPDIR ?? "/tmp";
    expect(() => new NativeBunSqlite(`${tmpdir}/../../../etc/passwd`)).toThrow("refusing non-local");
  });

  test("enforces PRAGMA foreign_keys=ON", () => {
    const tmpdir = process.env.TMPDIR ?? "/tmp";
    const path = `${tmpdir}/test-fk-${crypto.randomUUID()}.sqlite`;
    const db = new NativeBunSqlite(path);
    try {
      const results = db.query<{ foreign_keys: number | bigint }>("PRAGMA foreign_keys");
      expect(results.length).toBe(1);
      expect(Number(results[0].foreign_keys)).toBe(1);
    } finally {
      db.close();
      cleanupDb(path);
    }
  });

  test("enforces PRAGMA journal_mode=WAL", () => {
    const tmpdir = process.env.TMPDIR ?? "/tmp";
    const path = `${tmpdir}/test-wal-${crypto.randomUUID()}.sqlite`;
    const db = new NativeBunSqlite(path);
    try {
      const results = db.query<{ journal_mode: string }>("PRAGMA journal_mode");
      expect(results.length).toBe(1);
      expect(results[0].journal_mode?.toLowerCase()).toBe("wal");
    } finally {
      db.close();
      cleanupDb(path);
    }
  });

  test("enforces PRAGMA busy_timeout=50", () => {
    const tmpdir = process.env.TMPDIR ?? "/tmp";
    const path = `${tmpdir}/test-busy-${crypto.randomUUID()}.sqlite`;
    const db = new NativeBunSqlite(path);
    try {
      const results = db.query<{ timeout: number | bigint }>("PRAGMA busy_timeout");
      expect(results.length).toBe(1);
      expect(Number(results[0].timeout)).toBe(50);
    } finally {
      db.close();
      cleanupDb(path);
    }
  });

  test("constructor verifies PRAGMA settings are enforced", () => {
    const tmpdir = process.env.TMPDIR ?? "/tmp";
    const path = `${tmpdir}/test-verify-${crypto.randomUUID()}.sqlite`;

    const db = new NativeBunSqlite(path);
    db.close();

    expect(() => {
      new NativeBunSqlite(path);
    }).not.toThrow();

    cleanupDb(path);
  });
});
