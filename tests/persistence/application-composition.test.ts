import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSqliteApplication } from "../../src/application/application.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_MIGRATIONS } from "../../src/infrastructure/schema/database-control-schema.ts";

test("production composition exposes typed services without raw persistence handles", async () => {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-application-"));
  const dbPath = join(directory, "application.sqlite");
  const db = new SqliteAdapter({ path: dbPath });
  try {
    const migrations = new MigrationService(db, "sqlite");
    await migrations.migrate([
      { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
      { id: DATABASE_CONTROL_MIGRATIONS.id, sql: DATABASE_CONTROL_MIGRATIONS.sqlite },
    ]);
    const control = new DatabaseControlService(db, "sqlite");
    await db.withMigrationLease((session) => control.initialize({ cliVersion: "0.0.0-test", buildId: "composition", now: new Date() }, session));

    const application = createSqliteApplication(dbPath);
    expect(Object.keys(application).sort()).toEqual(["account", "bookSet", "idempotency", "tenant"]);
    expect((application as Record<string, unknown>).runner).toBeUndefined();
    expect((application as Record<string, unknown>).db).toBeUndefined();

    const requestId = randomUUID();
    const first = await application.tenant.createTenantWithDefaultBookSet("COMPANY", "Composition Corp", "INR", requestId);
    const replay = await application.tenant.createTenantWithDefaultBookSet("COMPANY", "Composition Corp", "INR", requestId);
    expect(replay).toEqual(first);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
