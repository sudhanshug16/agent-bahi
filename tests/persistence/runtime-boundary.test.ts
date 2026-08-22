import { describe, expect, it } from "bun:test";
import type { Database, QueryResult } from "../../src/application/ports/persistence.ts";
import { CompatibilityService } from "../../src/infrastructure/services/compatibility-service.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { DomainError } from "../../src/core/types.ts";

function fakeDatabase(overrides: Partial<Database>): Database {
  return {
    query: async (): Promise<QueryResult> => ({ rows: [], rowCount: 0 }),
    querySingle: async (): Promise<Record<string, unknown> | undefined> => undefined,
    execute: async (): Promise<QueryResult> => ({ rows: [], rowCount: 0 }),
    executeSingle: async (): Promise<Record<string, unknown> | undefined> => undefined,
    executeRaw: async (): Promise<void> => undefined,
    beginTransaction: async () => { throw new Error("unused"); },
    unitOfWork: () => { throw new Error("unused"); },
    withMigrationLease: async () => { throw new Error("unused"); },
    isConnected: async () => true,
    close: async () => undefined,
    acquireAdvisoryLock: async () => true,
    releaseAdvisoryLock: async () => undefined,
    ...overrides,
  };
}

describe("runtime fail-closed boundaries", () => {
  it("returns uninitialized only for an explicitly missing SQLite control table", async () => {
    const missing = fakeDatabase({ query: async () => { throw new DomainError("CONTROL_TABLE_MISSING", "missing"); } });
    await expect(new MigrationService(missing, "sqlite").getStatus()).resolves.toMatchObject({ hasSchema: false });

    const refused = fakeDatabase({ query: async () => { throw new DomainError("DATABASE_CONNECTION_FAILED", "refused"); } });
    await expect(new MigrationService(refused, "postgresql").getStatus()).rejects.toMatchObject({ code: "DATABASE_CONNECTION_FAILED" });
  });

  it("uses exact PostgreSQL verifyChecksum numbering and preserves inspection read-only", async () => {
    let verifySql = "";
    let verifyParams: unknown[] = [];
    const pg = fakeDatabase({
      querySingle: async (sql, params) => {
        verifySql = sql;
        verifyParams = params ?? [];
        return { dialect: "postgresql", checksum: "good" };
      },
    });
    await new MigrationService(pg, "postgresql").verifyChecksum("migration-1", "good");
    expect(verifySql).toContain("WHERE id = $1");
    expect(verifyParams).toEqual(["migration-1"]);

    let writes = 0;
    const compatibility = fakeDatabase({
      querySingle: async () => ({ id: "migration-1", status: "APPLIED" }),
      query: async () => ({ rows: [{ schema_logical_id: "migration-1", data_format_version: "1", read_policy: "read_only" }], rowCount: 1 }),
      execute: async () => { writes += 1; return { rows: [], rowCount: 0 }; },
      executeRaw: async () => { writes += 1; },
    });
    await new CompatibilityService(compatibility, "postgresql").checkCompatibility("1.0.0");
    expect(writes).toBe(0);
  });
});
