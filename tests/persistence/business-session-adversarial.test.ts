import { Database as BunDatabase } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { BusinessSessionRunner } from "../../src/application/ports/persistence.ts";
import { BusinessSessionFactory } from "../../src/infrastructure/adapters/business-session-factory.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_CHECKSUM, DATABASE_CONTROL_TABLE_DDL, DATABASE_CONTROL_MIGRATIONS } from "../../src/infrastructure/schema/database-control-schema.ts";
import { V2_SCHEMA_MANIFEST } from "../../src/infrastructure/schema/current-manifest.ts";
import { MIGRATION_SCHEMA_SQLITE } from "../../src/infrastructure/services/migration-service.ts";

const dbControlMigrationChecksum = checksum(DATABASE_CONTROL_MIGRATIONS.sqlite);
const coreMigrationChecksum = checksum(CORE_MIGRATIONS.sqlite);

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalMigrationDdl(): string {
  return MIGRATION_SCHEMA_SQLITE.replace(/CREATE TABLE IF NOT EXISTS/gi, "CREATE TABLE");
}

type FixtureOptions = {
  controlDdl?: string;
  migrationDdl?: string;
  controlRows?: Array<unknown[]>;
  seedControl?: boolean;
  seedMigrations?: boolean;
};

async function createCanonicalFixture(options: FixtureOptions = {}): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-session-adversarial-"));
  const path = join(directory, "database.sqlite");
  const db = new BunDatabase(path, { create: true, safeIntegers: true });
  try {
    db.exec(options.migrationDdl ?? MIGRATION_SCHEMA_SQLITE);
    db.exec(options.controlDdl ?? DATABASE_CONTROL_TABLE_DDL);
    if (options.seedMigrations !== false) {
      const insertMigration = db.prepare(
        `INSERT INTO schema_migrations
         (id, dialect, checksum, status, executed_at, duration_ms, lease_token, manifest_version, verification_manifest_hash, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertMigration.run("0001-core-schema", "sqlite", coreMigrationChecksum, "APPLIED", "2026-01-01T00:00:00.000Z", 1, null, null, null, null);
      insertMigration.run("0002-database-control", "sqlite", dbControlMigrationChecksum, "APPLIED", "2026-01-01T00:00:01.000Z", 1, null, null, null, null);
    }
    const insertControl = options.seedControl !== false || (options.controlRows?.length ?? 0) > 0
      ? db.prepare(
        `INSERT INTO database_control
         (id, schema_version, data_format_version, reader_compatibility_min,
          reader_compatibility_max, required_writer_protocol, state, revision,
          generation, last_migration_id, last_migration_checksum,
          last_writer_cli_version, last_writer_build_id, last_writer_at,
          created_at, updated_at, recovery_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      : null;
    if (options.seedControl !== false) {
      insertControl!.run(1, 2, 1, 1, 1, 1, "READY", 1, 1, "0002-database-control", DATABASE_CONTROL_CHECKSUM, "0.0.0-test", "adversarial", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", null);
    }
    for (const row of options.controlRows ?? []) {
      insertControl!.run(...row as any[]);
    }
  } finally {
    db.close();
  }
  return { directory, path };
}

async function withFixture<T>(callback: (path: string) => Promise<T>, options: FixtureOptions = {}): Promise<T> {
  const fixture = await createCanonicalFixture(options);
  try {
    return await callback(fixture.path);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
}

async function mutate(path: string, sql: string): Promise<void> {
  const db = new BunDatabase(path, { create: false, safeIntegers: true });
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

async function expectGateRejects(path: string, expectedCode = "DATABASE_CONTROL_UNAVAILABLE"): Promise<void> {
  const runner = BusinessSessionFactory.createSessionRunner(path, "sqlite", 1, 1, V2_SCHEMA_MANIFEST);
  let callbackCount = 0;
  await expect(
    runner.withBusinessSession("write", async () => {
      callbackCount += 1;
    }),
  ).rejects.toMatchObject({ code: expectedCode });
  expect(callbackCount).toBe(0);
}

describe("BusinessSession adversarial compatibility gate", () => {
  const controlSchemaCases: Array<[string, string]> = [
    ["missing control column", DATABASE_CONTROL_TABLE_DDL.replace("  updated_at TEXT NOT NULL,\n", "").replace("  CONSTRAINT chk_updated_at CHECK(trim(updated_at)<>''),\n", "")],
    ["wrong control column type", DATABASE_CONTROL_TABLE_DDL.replace("schema_version INTEGER", "schema_version TEXT")],
    ["extra control column", DATABASE_CONTROL_TABLE_DDL.replace("  recovery_reason TEXT,\n", "  extra TEXT,\n  recovery_reason TEXT,\n")],
    ["wrong control DDL signature", DATABASE_CONTROL_TABLE_DDL.replace("chk_id_singleton", "chk_id_singleton_changed")],
  ];

  for (const [name, ddl] of controlSchemaCases) {
    test(`rejects ${name} before callback`, async () => {
      await withFixture(async (path) => {
        await expectGateRejects(path);
      }, { controlDdl: ddl, seedControl: false });
    });
  }

  test("rejects zero control rows before callback", async () => {
    await withFixture(async (path) => {
      await mutate(path, "DELETE FROM database_control");
      await expectGateRejects(path);
    });
  });

  test("rejects multiple control rows before callback", async () => {
    await withFixture(async (path) => {
      await expectGateRejects(path);
    }, {
      controlDdl: DATABASE_CONTROL_TABLE_DDL.replace("id INTEGER PRIMARY KEY", "id INTEGER").replace("  CONSTRAINT chk_id_singleton CHECK(id=1),\n", ""),
      controlRows: [[2, 2, 1, 1, 1, 1, "READY", 1, 1, "0002-database-control", DATABASE_CONTROL_CHECKSUM, "0.0.0-test", "adversarial", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", null]],
    });
  });

  const migrationSchemaCases: Array<[string, string]> = [
    ["missing migration column", MIGRATION_SCHEMA_SQLITE.replace("  verification_manifest_hash TEXT,\n  manifest_json TEXT\n", "  verification_manifest_hash TEXT\n")],
    ["wrong migration column type", MIGRATION_SCHEMA_SQLITE.replace("duration_ms INTEGER", "duration_ms TEXT")],
    ["extra migration column", MIGRATION_SCHEMA_SQLITE.replace("  manifest_json TEXT\n", "  extra TEXT,\n  manifest_json TEXT\n")],
    ["wrong migration DDL signature", MIGRATION_SCHEMA_SQLITE.replace("status TEXT", "status TEXT /* signature */")],
  ];
  for (const [name, ddl] of migrationSchemaCases) {
    test(`rejects ${name} before callback`, async () => {
      await withFixture(async (path) => {
        await expectGateRejects(path);
      }, { migrationDdl: ddl, seedMigrations: false });
    });
  }

  for (const [name, sql] of [
    ["stale schema version", "UPDATE database_control SET schema_version = 1"],
    ["future schema version", "UPDATE database_control SET schema_version = 99"],
    ["stale data format version", "PRAGMA ignore_check_constraints=ON; UPDATE database_control SET data_format_version = 0"],
    ["future data format version", "UPDATE database_control SET data_format_version = 99"],
    ["wrong generation", "UPDATE database_control SET generation = 2"],
    ["wrong last migration identity", "UPDATE database_control SET last_migration_id = 'other'"],
    ["wrong last migration checksum", "UPDATE database_control SET last_migration_checksum = printf('%064d', 0)"],
    ["wrong migration checksum", "UPDATE schema_migrations SET checksum = printf('%064d', 0) WHERE id = '0001-core-schema'"],
    ["wrong migration dialect", "UPDATE schema_migrations SET dialect = 'mysql' WHERE id = '0001-core-schema'"],
    ["non-applied migration", "UPDATE schema_migrations SET status = 'DIRTY' WHERE id = '0001-core-schema'"],
    ["missing migration", "DELETE FROM schema_migrations WHERE id = '0001-core-schema'"],
    ["extra migration", "INSERT INTO schema_migrations (id, dialect, checksum, status, executed_at, duration_ms) VALUES ('0003-extra', 'sqlite', printf('%064d', 0), 'APPLIED', '2026-01-01T00:00:02.000Z', 1)"],
    ["metadata from A cannot authorize changed B", "UPDATE schema_migrations SET checksum = printf('%064d', 1) WHERE id = '0001-core-schema'"],
  ] as Array<[string, string]>) {
    test(`rejects ${name} before callback`, async () => {
      await withFixture(async (path) => {
        await mutate(path, sql);
        await expectGateRejects(path, name.startsWith("stale") ? "UPDATE_REQUIRED" : "DATABASE_CONTROL_UNAVAILABLE");
      });
    });
  }
});

describe("BusinessSession adversarial SQL policy", () => {
  test("rejects non-business read tables, quoted identifiers, comments, and subqueries", async () => {
    await withFixture(async (path) => {
      await mutate(path, "CREATE TABLE secret_data (value TEXT NOT NULL)");
      const runner = BusinessSessionFactory.createSessionRunner(path, "sqlite", 1, 1, V2_SCHEMA_MANIFEST);
      const attempts = [
        "SELECT value FROM secret_data",
        "SELECT tenants.id FROM tenants JOIN secret_data ON 1 = 1",
        "SELECT value FROM \"tenants\"",
        "SELECT value FROM (SELECT 1 AS value)",
        "SELECT tenants.id FROM tenants, secret_data",
        "SELECT 1 /* comment */",
        "SELECT 1 -- comment",
        "SELECT value FROM pragma_database_list",
      ];
      await runner.withBusinessSession("read", async (session) => {
        for (const sql of attempts) {
          await expect(session.query(sql)).rejects.toMatchObject({ code: "INVALID_SQL" });
        }
      });
    });
  });

  test("rejects write-side subqueries, returning, CTE, metadata, attach, and quoted identifiers", async () => {
    await withFixture(async (path) => {
      await mutate(path, "CREATE TABLE secret_data (value TEXT NOT NULL)");
      const runner = BusinessSessionFactory.createSessionRunner(path, "sqlite", 1, 1, V2_SCHEMA_MANIFEST);
      const attempts = [
        "INSERT INTO tenants (id) SELECT value FROM secret_data",
        "INSERT INTO tenants (id) VALUES (?) RETURNING id",
        "WITH copied AS (SELECT value FROM secret_data) INSERT INTO tenants (id) SELECT value FROM copied",
        "INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)",
        "CREATE TABLE secret_created (id TEXT)",
        "PRAGMA user_version = 99",
        "ATTACH DATABASE ? AS external_db",
        "INSERT INTO \"tenants\" (id) VALUES (?)",
        "UPDATE tenants SET name = ? /* comment */",
      ];
      await runner.withBusinessSession("write", async (session) => {
        for (const sql of attempts) {
          await expect(session.execute(sql, ["value"])).rejects.toMatchObject({ code: "INVALID_SQL" });
        }
      });
    });
  });
});

describe("BusinessSession concurrency, lifetime, and cleanup", () => {
  test("enables query_only only after the compatibility gate and before the read callback", async () => {
    await withFixture(async (path) => {
      await mutate(path, "CREATE TABLE tenants (id TEXT PRIMARY KEY)");
      const runner = BusinessSessionFactory.createSessionRunner(path, "sqlite", 1, 1, V2_SCHEMA_MANIFEST) as any;
      const statements: string[] = [];
      const originalOpen = runner.openConnection.bind(runner);
      runner.openConnection = () => {
        const connection = originalOpen();
        const originalExec = connection.exec.bind(connection);
        connection.exec = (sql: string) => {
          statements.push(sql);
          return originalExec(sql);
        };
        return connection;
      };
      let callbackIndex = -1;
      await runner.withBusinessSession("read", async (session: import("../../src/application/ports/persistence.ts").BusinessSession) => {
        callbackIndex = statements.length;
        await session.query("SELECT id FROM tenants");
      });
      const beginIndex = statements.indexOf("BEGIN IMMEDIATE");
      const queryOnlyIndex = statements.indexOf("PRAGMA query_only = ON");
      expect(beginIndex).toBeGreaterThanOrEqual(0);
      expect(queryOnlyIndex).toBeGreaterThan(beginIndex);
      expect(callbackIndex).toBeGreaterThan(queryOnlyIndex);
    });
  });

  test("rejects nested sessions but reports independent connection contention as BUSY", async () => {
    await withFixture(async (path) => {
      const runner = BusinessSessionFactory.createSessionRunner(path, "sqlite", 1, 1, V2_SCHEMA_MANIFEST);
      await runner.withBusinessSession("read", async () => {
        await expect(runner.withBusinessSession("read", async () => undefined)).rejects.toMatchObject({ code: "BUSINESS_SESSION_NESTED" });
      });
      let release!: () => void;
      const released = new Promise<void>((resolve) => { release = resolve; });
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      let callbackCount = 0;
      const held = runner.withBusinessSession("write", async () => {
        started();
        await released;
      });
      await startedPromise;

      const independentRunner = BusinessSessionFactory.createSessionRunner(path, "sqlite", 1, 1, V2_SCHEMA_MANIFEST);
      await expect(independentRunner.withBusinessSession("read", async () => {
        callbackCount += 1;
      })).rejects.toMatchObject({ code: "BUSINESS_SESSION_BUSY" });
      expect(callbackCount).toBe(0);
      release();
      await held;
    });
  });

  test("captured sessions are inactive after callback errors and fixtures leave no marker files", async () => {
    const fixture = await createCanonicalFixture();
    let captured: import("../../src/application/ports/persistence.ts").BusinessSession | undefined;
    try {
      const runner = BusinessSessionFactory.createSessionRunner(fixture.path, "sqlite", 1, 1, V2_SCHEMA_MANIFEST);
      await expect(runner.withBusinessSession("write", async (session) => {
        captured = session;
        throw new Error("rollback-test");
      })).rejects.toThrow("rollback-test");
      expect(captured?.isActive()).toBe(false);
      await expect(captured!.query("SELECT 1")).rejects.toMatchObject({ code: "BUSINESS_SESSION_INACTIVE" });
      expect(await Bun.file(`${fixture.path}.delete`).exists()).toBe(false);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  test("sanitizes commit and close failures", async () => {
    await withFixture(async (path) => {
      const commitRunner = BusinessSessionFactory.createSessionRunner(path, "sqlite", 1, 1, V2_SCHEMA_MANIFEST) as any;
      const originalCommitOpen = commitRunner.openConnection.bind(commitRunner);
      commitRunner.openConnection = () => {
        const connection = originalCommitOpen();
        const originalExec = connection.exec.bind(connection);
        connection.exec = (sql: string) => {
          if (sql === "COMMIT") throw new Error("native commit details must not escape");
          return originalExec(sql);
        };
        return connection;
      };
      await expect(commitRunner.withBusinessSession("write", async () => undefined)).rejects.toMatchObject({ code: "DATABASE_QUERY_FAILED" });

      const closeRunner = BusinessSessionFactory.createSessionRunner(path, "sqlite", 1, 1, V2_SCHEMA_MANIFEST) as any;
      const originalCloseOpen = closeRunner.openConnection.bind(closeRunner);
      closeRunner.openConnection = () => {
        const connection = originalCloseOpen();
        const originalClose = connection.close.bind(connection);
        connection.close = () => {
          originalClose();
          throw new Error("native close details must not escape");
        };
        return connection;
      };
      await expect(closeRunner.withBusinessSession("read", async () => undefined)).rejects.toMatchObject({ code: "DATABASE_CONNECTION_CLOSE_FAILED" });
    });
  });
});
