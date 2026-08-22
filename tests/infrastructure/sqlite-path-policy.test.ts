import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp as mkdtempAsync, rm as rmAsync } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DomainError } from "../../src/core/types.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { NativeBunSqlite } from "../../src/infrastructure/sqlite/native-sqlite.ts";

type AdapterKind = "native" | "adapter";
type OpenDatabase = NativeBunSqlite | SqliteAdapter;

async function makeFixture(): Promise<string> {
  return mkdtempAsync(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-sqlite-policy-"));
}

function openDatabase(kind: AdapterKind, path: string): OpenDatabase {
  return kind === "native"
    ? new NativeBunSqlite(path)
    : new SqliteAdapter({ path });
}

async function closeDatabase(database: OpenDatabase): Promise<void> {
  if (database instanceof NativeBunSqlite) {
    database.close();
  } else {
    await database.close();
  }
}

async function createMarker(database: OpenDatabase): Promise<void> {
  if (database instanceof NativeBunSqlite) {
    database.exec("CREATE TABLE marker (id INTEGER PRIMARY KEY)");
  } else {
    await database.execute("CREATE TABLE marker (id INTEGER PRIMARY KEY)");
  }
}

function captureDomainFailure(action: () => unknown): DomainError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }
  throw new Error("Expected a DomainError");
}

describe("canonical SQLite path policy", () => {
  for (const kind of ["native", "adapter"] as const) {
    test(`${kind} creates a missing database file inside an owned fixture`, async () => {
      const directory = await makeFixture();
      const path = join(directory, "missing.sqlite");
      try {
        const database = openDatabase(kind, path);
        await closeDatabase(database);
        expect(await Bun.file(path).exists()).toBe(true);
      } finally {
        await rmAsync(directory, { recursive: true, force: true });
      }
    });

    test(`${kind} reopens an existing regular database file`, async () => {
      const directory = await makeFixture();
      const path = join(directory, "existing.sqlite");
      try {
        const first = openDatabase(kind, path);
        await createMarker(first);
        await closeDatabase(first);

        const reopened = openDatabase(kind, path);
        await closeDatabase(reopened);
        expect(await Bun.file(path).exists()).toBe(true);
      } finally {
        await rmAsync(directory, { recursive: true, force: true });
      }
    });

    test(`${kind} rejects relative paths and traversal components as typed failures`, async () => {
      const directory = await makeFixture();
      try {
        for (const path of ["relative.sqlite", `${directory}/../escape.sqlite`, `${directory}/nested/../../escape.sqlite`]) {
          const error = captureDomainFailure(() => openDatabase(kind, path));
          expect(error.code).toBe("SQLITE_UNSAFE_PATH");
        }
      } finally {
        await rmAsync(directory, { recursive: true, force: true });
      }
    });

    test(`${kind} rejects a final symlink without modifying its target`, async () => {
      if (process.platform === "win32") return;
      const directory = await makeFixture();
      const target = join(directory, "external-target.sqlite");
      const link = join(directory, "database.sqlite");
      const original = "owned external target";
      try {
        writeFileSync(target, original);
        symlinkSync(target, link);

        const error = captureDomainFailure(() => openDatabase(kind, link));
        expect(error.code).toBe("SQLITE_UNSAFE_PATH");
        expect(readFileSync(target, "utf8")).toBe(original);
      } finally {
        await rmAsync(directory, { recursive: true, force: true });
      }
    });

    test(`${kind} canonicalizes a parent symlink before opening and stays on the canonical path`, async () => {
      if (process.platform === "win32") return;
      const directory = await makeFixture();
      const canonicalParent = join(directory, "canonical-parent");
      const retargetedParent = join(directory, "retargeted-parent");
      const alias = join(directory, "parent-alias");
      const pathThroughAlias = join(alias, "database.sqlite");
      try {
        await mkdir(canonicalParent);
        await mkdir(retargetedParent);
        symlinkSync(canonicalParent, alias, "dir");

        const database = openDatabase(kind, pathThroughAlias);
        rmSync(alias);
        symlinkSync(retargetedParent, alias, "dir");
        await createMarker(database);
        await closeDatabase(database);

        expect(await Bun.file(join(canonicalParent, "database.sqlite")).exists()).toBe(true);
        expect(await Bun.file(join(retargetedParent, "database.sqlite")).exists()).toBe(false);
      } finally {
        await rmAsync(directory, { recursive: true, force: true });
      }
    });

    test(`${kind} rejects a directory and does not replace it`, async () => {
      const directory = await makeFixture();
      const databaseDirectory = join(directory, "database.sqlite");
      try {
        await mkdir(databaseDirectory);
        const error = captureDomainFailure(() => openDatabase(kind, databaseDirectory));
        expect(error.code).toBe("SQLITE_UNSAFE_PATH");
        expect(await Bun.file(databaseDirectory).exists()).toBe(false);
      } finally {
        await rmAsync(directory, { recursive: true, force: true });
      }
    });

    test.skipIf(process.platform === "win32")(`${kind} rejects a FIFO without opening or replacing it`, async () => {
      const directory = await makeFixture();
      const fifo = join(directory, "database.sqlite");
      try {
        execFileSync("mkfifo", [fifo]);
        const error = captureDomainFailure(() => openDatabase(kind, fifo));
        expect(error.code).toBe("SQLITE_UNSAFE_PATH");
        expect(await Bun.file(fifo).exists()).toBe(true);
      } finally {
        await rmAsync(directory, { recursive: true, force: true });
      }
    });

    test(`${kind} rejects a non-existent parent without creating it`, async () => {
      const directory = await makeFixture();
      const missingParent = join(directory, "missing-parent");
      try {
        const error = captureDomainFailure(() => openDatabase(kind, join(missingParent, "database.sqlite")));
        expect(error.code).toBe("SQLITE_UNSAFE_PATH");
        expect(await Bun.file(missingParent).exists()).toBe(false);
      } finally {
        await rmAsync(directory, { recursive: true, force: true });
      }
    });
  }

  test("NativeBunSqlite and SqliteAdapter expose identical typed path failures", async () => {
    const directory = await makeFixture();
    try {
      for (const path of [
        "relative.sqlite",
        `${directory}/../escape.sqlite`,
        join(directory, "missing-parent", "database.sqlite"),
      ]) {
        const nativeError = captureDomainFailure(() => openDatabase("native", path));
        const adapterError = captureDomainFailure(() => openDatabase("adapter", path));
        expect({ code: nativeError.code, message: nativeError.message })
          .toEqual({ code: adapterError.code, message: adapterError.message });
      }
    } finally {
      await rmAsync(directory, { recursive: true, force: true });
    }
  });
});
