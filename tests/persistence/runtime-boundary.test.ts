import { describe, expect, it } from "bun:test";
import { randomUUID } from "crypto";
import { CompatibilityService } from "../../src/infrastructure/services/compatibility-service.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { CLI_VERSION } from "../../src/release.ts";

describe("runtime fail-closed boundaries", () => {
  it("returns uninitialized only for an explicitly missing SQLite control table", async () => {
    const db = new SqliteAdapter({ path: `/tmp/runtime-boundary-missing-${randomUUID()}.sqlite` });
    try {
      await expect(new MigrationService(db, "sqlite").getStatus()).resolves.toMatchObject({ hasSchema: false });
    } finally {
      await db.close();
    }
  });

  it("fails closed with normalized SQLite errors for missing metadata and a closed connection", async () => {
    const db = new SqliteAdapter({ path: `/tmp/runtime-boundary-errors-${randomUUID()}.sqlite` });
    const compatibility = new CompatibilityService(db, "sqlite");
    await expect(compatibility.checkCompatibility(CLI_VERSION)).rejects.toMatchObject({
      code: "INCOMPATIBLE_DATABASE",
    });

    await db.close();
    await expect(new MigrationService(db, "sqlite").getStatus()).rejects.toMatchObject({
      code: "DATABASE_QUERY_FAILED",
      context: { dialect: "sqlite" },
    });
    await expect(compatibility.checkCompatibility(CLI_VERSION)).rejects.toMatchObject({
      code: "INCOMPATIBLE_DATABASE",
      context: { dialect: "sqlite" },
    });
  });

  it("uses SQLite placeholders and preserves read-only compatibility inspection", async () => {
    const db = new SqliteAdapter({ path: `/tmp/runtime-boundary-sqlite-${randomUUID()}.sqlite` });
    try {
      const migration = new MigrationService(db, "sqlite");
      await migration.migrate([{ id: "migration-1", sql: "CREATE TABLE runtime_boundary (id TEXT PRIMARY KEY)" }]);
      const compatibility = new CompatibilityService(db, "sqlite");
      await compatibility.initializeDefaults();
      await expect(compatibility.checkCompatibility(CLI_VERSION)).resolves.toMatchObject({
        compatible: true,
        schemaVersion: "gate0-001-core-sqlite",
      });
    } finally {
      await db.close();
    }
  });
});
