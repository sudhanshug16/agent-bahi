import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { classifySqliteError, toDomainError } from "../../src/infrastructure/sqlite/error-classifier.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { DomainError } from "../../src/core/types.ts";

const nativeError = (message: string, fields: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), fields);

describe("SQLite error classification", () => {
  test("uses exact structured BUSY and LOCKED codes, including extended numeric codes", () => {
    const cases: Array<[unknown, string]> = [
      [nativeError("native secret", { code: "SQLITE_BUSY" }), "SQLITE_CONTENTION_BUSY"],
      [nativeError("native secret", { code: "SQLITE_BUSY_SNAPSHOT" }), "SQLITE_CONTENTION_BUSY"],
      [nativeError("native secret", { errno: 5 | (2 << 8) }), "SQLITE_CONTENTION_BUSY"],
      [nativeError("native secret", { code: "SQLITE_LOCKED_SHAREDCACHE" }), "SQLITE_CONTENTION_LOCKED"],
      [nativeError("native secret", { errno: 6 | (1 << 8) }), "SQLITE_CONTENTION_LOCKED"],
    ];

    for (const [error, code] of cases) {
      const classified = classifySqliteError(error);
      expect(classified.code).toBe(code);
      expect(classified.isContention).toBe(true);
      expect(toDomainError(classified).code).toBe(code);
    }
  });

  test("recognizes structured constraints but not arbitrary identifiers", () => {
    expect(classifySqliteError(nativeError("secret", { errno: 19 })).code).toBe("SQLITE_CONSTRAINT");
    expect(classifySqliteError(nativeError("secret", { code: "SQLITE_CONSTRAINT_UNIQUE" })).code)
      .toBe("SQLITE_CONSTRAINT");

    for (const message of [
      "table busy for tenant tenant-secret",
      "bookset locked; password=secret",
      "tenant constraint failed: secret",
      "a SQLITE_BUSY identifier is not a native code",
    ]) {
      const classified = classifySqliteError(new Error(message));
      expect(classified.code).toBe("DATABASE_QUERY_FAILED");
      expect(classified.isContention).toBe(false);
    }
  });

  test("uses only narrow native phrases and never leaks raw diagnostics", () => {
    expect(classifySqliteError(new Error("database is locked")).code).toBe("SQLITE_CONTENTION_BUSY");
    expect(classifySqliteError(new Error("database table is locked")).code).toBe("SQLITE_CONTENTION_LOCKED");
    expect(classifySqliteError(new Error("unique constraint failed")).code).toBe("SQLITE_CONSTRAINT");

    const secret = "sql-secret tenant-secret /private/secret.sqlite";
    const domainError = toDomainError(classifySqliteError(nativeError(`database exploded ${secret}`)));
    expect(domainError.code).toBe("DATABASE_QUERY_FAILED");
    expect(domainError.message).toBe("SQLite database operation failed");
    expect(domainError.message).not.toContain(secret);
    expect(JSON.stringify(domainError.context)).not.toContain(secret);
  });

  test("preserves an existing DomainError unchanged", () => {
    const original = new DomainError("EXISTING", "safe existing message", { marker: "kept" });
    const classified = classifySqliteError(original);
    expect(toDomainError(classified)).toBe(original);
    expect(classified.message).toBe(original.message);
  });
});

describe("SQLite contention and lifecycle", () => {
  let directory: string;
  let dbPath: string;
  let dbA: BunDatabase | undefined;
  let dbB: SqliteAdapter | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-contention-"));
    dbPath = join(directory, "contention.sqlite");
    const init = new BunDatabase(dbPath, { strict: true, create: true, safeIntegers: true });
    try {
      init.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 0;");
      init.exec("CREATE TABLE test_table (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    } finally {
      init.close();
    }
    dbA = new BunDatabase(dbPath, { strict: true, create: false, safeIntegers: true });
    dbA.exec("PRAGMA busy_timeout = 0");
    dbB = new SqliteAdapter({ path: dbPath });
  });

  afterEach(async () => {
    try {
      dbA?.close();
    } catch {
      // Setup failure or prior cleanup must not mask the assertion.
    }
    try {
      await dbB?.close();
    } catch {
      // Setup failure or prior cleanup must not mask the assertion.
    }
    await rm(directory, { recursive: true, force: true });
  });

  test("real two-connection write contention is exact BUSY and succeeds after release", async () => {
    dbA!.exec("BEGIN IMMEDIATE");
    await expect(dbB!.query("INSERT INTO test_table (id, value) VALUES (?, ?)", ["a", "b"]))
      .rejects.toMatchObject({ code: "SQLITE_CONTENTION_BUSY" });

    dbA!.exec("ROLLBACK");
    await expect(dbB!.query("INSERT INTO test_table (id, value) VALUES (?, ?)", ["a", "b"]))
      .resolves.toMatchObject({ rowCount: 0 });
  });

  test("migration acquisition retries BUSY, then invokes callback exactly once", async () => {
    dbA!.exec("BEGIN IMMEDIATE");
    let attempts = 0;
    const release = setTimeout(() => dbA!.exec("ROLLBACK"), 130);
    try {
      await expect(dbB!.withMigrationLease(async () => {
        attempts += 1;
        return "success";
      }, 1200)).resolves.toBe("success");
    } finally {
      clearTimeout(release);
    }
    expect(attempts).toBe(1);
  });

  test("callback failure is not retried and is returned unchanged", async () => {
    let attempts = 0;
    const callbackError = new Error("callback-secret");
    await expect(dbB!.withMigrationLease(async () => {
      attempts += 1;
      throw callbackError;
    }, 500)).rejects.toBe(callbackError);
    expect(attempts).toBe(1);
  });

  test("constraints fail immediately and do not become contention", async () => {
    await dbB!.executeRaw("CREATE TABLE unique_test (id TEXT PRIMARY KEY, value TEXT UNIQUE NOT NULL)");
    await dbB!.query("INSERT INTO unique_test (id, value) VALUES (?, ?)", ["one", "same"]);
    const started = Date.now();
    let caught: unknown;
    try {
      await dbB!.unitOfWork().execute(async (tx) => {
        await tx.execute("INSERT INTO unique_test (id, value) VALUES (?, ?)", ["two", "same"]);
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "SQLITE_CONSTRAINT" });
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("advisory lock returns false only after real BUSY contention exhausts its window", async () => {
    dbA!.exec("BEGIN IMMEDIATE");
    const started = Date.now();
    await expect(dbB!.acquireAdvisoryLock("test_lock", 180)).resolves.toBe(false);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(700);
    dbA!.exec("ROLLBACK");
  });

  test("advisory lock release allows a subsequent acquisition", async () => {
    await expect(dbB!.acquireAdvisoryLock("test_lock", 500)).resolves.toBe(true);
    await dbB!.releaseAdvisoryLock("test_lock");
    await expect(dbB!.acquireAdvisoryLock("test_lock", 500)).resolves.toBe(true);
    await dbB!.releaseAdvisoryLock("test_lock");
  });

  test("corrupt advisory/open failures fail fast as safe generic DomainErrors", async () => {
    const corruptPath = join(directory, "corrupt.sqlite");
    await writeFile(corruptPath, "not-a-sqlite-database");
    const started = Date.now();
    let openError: unknown;
    try {
      new SqliteAdapter({ path: corruptPath });
    } catch (error) {
      openError = error;
    }
    expect(openError).toMatchObject({ code: "DATABASE_QUERY_FAILED", message: "SQLite database operation failed" });
    expect(Date.now() - started).toBeLessThan(500);

    const adapter = dbB! as unknown as { dbPath: string };
    adapter.dbPath = corruptPath;
    const lockStarted = Date.now();
    await expect(dbB!.acquireAdvisoryLock("test_lock", 1000)).rejects.toMatchObject({
      code: "DATABASE_QUERY_FAILED",
      message: "SQLite database operation failed",
    });
    expect(Date.now() - lockStarted).toBeLessThan(500);
  });

  test("failed COMMIT attempts rollback, preserves classified error, and deactivates transaction", async () => {
    const tx = await dbB!.beginTransaction();
    const native = (dbB as any).db as BunDatabase;
    const originalExec = native.exec.bind(native);
    const calls: string[] = [];
    native.exec = (sql: string) => {
      calls.push(sql);
      if (sql === "COMMIT") throw nativeError("commit-secret /tmp/db", { code: "SQLITE_BUSY", errno: 5 });
      return originalExec(sql);
    };
    try {
      await expect(tx.commit()).rejects.toMatchObject({
        code: "SQLITE_CONTENTION_BUSY",
        message: "SQLite operation blocked by BUSY contention",
      });
    } finally {
      native.exec = originalExec;
    }
    expect(calls).toEqual(["COMMIT", "ROLLBACK"]);
    expect(tx.isActive()).toBe(false);
    await expect(tx.commit()).rejects.toMatchObject({ code: "TRANSACTION_NOT_ACTIVE" });
    expect(calls).toEqual(["COMMIT", "ROLLBACK"]);
  });

  test("failed migration COMMIT cleanup keeps callback count and original error", async () => {
    const native = (dbB as any).db as BunDatabase;
    const originalExec = native.exec.bind(native);
    const calls: string[] = [];
    native.exec = (sql: string) => {
      calls.push(sql);
      if (sql === "COMMIT") throw nativeError("migration-secret", { code: "SQLITE_BUSY", errno: 5 });
      return originalExec(sql);
    };
    let callbackCount = 0;
    let capturedSession: any;
    try {
      await expect(dbB!.withMigrationLease(async (session) => {
        capturedSession = session;
        callbackCount += 1;
        return "done";
      })).rejects.toMatchObject({ code: "SQLITE_CONTENTION_BUSY" });
    } finally {
      native.exec = originalExec;
    }
    expect(callbackCount).toBe(1);
    expect(calls).toEqual(["BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"]);
    await capturedSession._commit();
    expect(calls).toEqual(["BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"]);
    await expect(capturedSession.execute("SELECT 1")).rejects.toMatchObject({ code: "MIGRATION_SESSION_INACTIVE" });
  });
});
