import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sanitizeError, startMySQLContainer } from "../../spikes/gate0/database-integration.ts";
import { DomainError } from "../../src/core/types.ts";
import { MysqlAdapter } from "../../src/infrastructure/adapters/mysql-adapter.ts";
import type { QueryResult } from "../../src/application/ports/persistence.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";

const CURRENT_SCHEMA = `
  CREATE TABLE schema_migrations_stage_v1 (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    dialect VARCHAR(50) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
    executed_at VARCHAR(50) NOT NULL,
    duration_ms INT NOT NULL,
    dirty_reason TEXT,
    lease_token VARCHAR(255),
    manifest_version INT,
    verification_manifest_hash VARCHAR(64),
    manifest_json TEXT
  )
`;

const CONTROL_TABLES = [
  "schema_migrations",
  "schema_migrations_stage_v1",
  "schema_migrations_backup_v1",
] as const;

type TableSnapshot = {
  catalog: QueryResult["rows"];
  columns: QueryResult["rows"];
  checks: QueryResult["rows"];
  rows: Record<string, QueryResult["rows"]>;
};

async function querySnapshot(db: MysqlAdapter): Promise<TableSnapshot> {
  const catalog = (await db.query(`
    SELECT TABLE_NAME, TABLE_TYPE, ENGINE, CREATE_OPTIONS
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('schema_migrations', 'schema_migrations_stage_v1', 'schema_migrations_backup_v1')
    ORDER BY TABLE_NAME
  `)).rows;
  const columns = (await db.query(`
    SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION, COLUMN_KEY
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('schema_migrations', 'schema_migrations_stage_v1', 'schema_migrations_backup_v1')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `)).rows;
  const checks = (await db.query(`
    SELECT TABLE_NAME, CONSTRAINT_NAME, CHECK_CLAUSE
    FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('schema_migrations', 'schema_migrations_stage_v1', 'schema_migrations_backup_v1')
    ORDER BY TABLE_NAME, CONSTRAINT_NAME
  `)).rows;
  const rows: Record<string, QueryResult["rows"]> = {};
  for (const tableName of CONTROL_TABLES) {
    const exists = catalog.some((row) => row.TABLE_NAME === tableName);
    if (exists) {
      rows[tableName] = (await db.query(`SELECT * FROM \`${tableName}\` ORDER BY id`)).rows;
    }
  }
  return { catalog, columns, checks, rows };
}

async function resetCurrentTables(db: MysqlAdapter): Promise<void> {
  for (const tableName of [...CONTROL_TABLES].reverse()) {
    await db.executeRaw(`DROP TABLE IF EXISTS \`${tableName}\``);
  }
  await db.executeRaw(CURRENT_SCHEMA.replace("schema_migrations_stage_v1", "schema_migrations_backup_v1"));
  await db.executeRaw(CURRENT_SCHEMA);
}

async function insertRow(db: MysqlAdapter, tableName: "schema_migrations_stage_v1" | "schema_migrations_backup_v1", checksum: string): Promise<void> {
  await db.execute(
    `INSERT INTO \`${tableName}\` (id, dialect, checksum, status, executed_at, duration_ms, dirty_reason, lease_token, manifest_version, verification_manifest_hash, manifest_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["001-core", "mysql", checksum, "APPLIED", "2026-08-22T10:00:00.000Z", 17, null, null, null, null, null],
  );
}

describe("MySQL legacy control-schema recovery", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db: MysqlAdapter | null = null;

  beforeAll(async () => {
    try {
      const started = await startMySQLContainer(`schema-upgrade-${crypto.randomUUID()}`);
      cleanup = started.cleanup;
      db = new MysqlAdapter({
        host: started.config.host,
        port: started.config.port,
        database: started.config.database,
        username: started.config.username,
        password: started.config.password,
        ssl: true,
      });
      await db.query("SELECT 1");
    } catch (error) {
      throw new Error(`MySQL legacy upgrade regression unavailable: ${sanitizeError(error)}`);
    }
  }, { timeout: 180000 });

  beforeEach(async () => {
    if (!db) throw new Error("MySQL container must be available for the live regression");
    await resetCurrentTables(db);
  });

  afterAll(async () => {
    if (db) await db.close();
    if (cleanup) await cleanup();
  });

  it("rejects differing current stage/backup rows before rename and leaves exact state unchanged", async () => {
    if (!db) throw new Error("MySQL container must be available for the live regression");
    await insertRow(db, "schema_migrations_backup_v1", "backup-checksum");
    await insertRow(db, "schema_migrations_stage_v1", "stage-checksum");
    const before = await querySnapshot(db);

    let failure: unknown;
    try {
      await new MigrationService(db, "mysql").upgradeControlSchema();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as DomainError).code).toBe("CONTROL_SCHEMA_UPGRADE_FAILED");
    expect(await querySnapshot(db)).toEqual(before);
    expect(Number((await db.query("SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'")).rows[0]?.count)).toBe(0);
  }, { timeout: 120000 });

  it("recovers equal current stage/backup rows by renaming stage to live", async () => {
    if (!db) throw new Error("MySQL container must be available for the live regression");
    await insertRow(db, "schema_migrations_backup_v1", "same-checksum");
    await insertRow(db, "schema_migrations_stage_v1", "same-checksum");

    await new MigrationService(db, "mysql").upgradeControlSchema();

    const tables = (await db.query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('schema_migrations', 'schema_migrations_stage_v1', 'schema_migrations_backup_v1')
      ORDER BY TABLE_NAME
    `)).rows.map((row) => row.TABLE_NAME);
    expect(tables).toEqual(["schema_migrations", "schema_migrations_backup_v1"]);
    expect((await db.query("SELECT * FROM schema_migrations ORDER BY id")).rows).toEqual(
      (await db.query("SELECT * FROM schema_migrations_backup_v1 ORDER BY id")).rows,
    );
  }, { timeout: 120000 });
});
