import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Database as BunDatabase } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSqliteApplication } from "../../src/application/application.ts";
import { brandBookSetId } from "../../src/core/types.ts";

test("production composition exposes typed services without raw persistence handles", async () => {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-application-"));
  const dbPath = join(directory, "application.sqlite");
  try {
    const application = await bootstrapSqliteApplication(dbPath, {
      backupDestinationPath: join(directory, "bootstrap.sqlite"),
      cliVersion: "0.0.0-test",
      buildId: "composition",
    });
    expect(Object.keys(application).sort()).toEqual(["account", "bookSet", "bookSetScope", "idempotency", "tenant"]);
    expect((application as Record<string, unknown>).runner).toBeUndefined();
    expect((application as Record<string, unknown>).db).toBeUndefined();

    const requestId = randomUUID();
    const first = await application.tenant.createTenantWithDefaultBookSet("COMPANY", "Composition Corp", "INR", requestId);
    const replay = await application.tenant.createTenantWithDefaultBookSet("COMPANY", "Composition Corp", "INR", requestId);
    expect(replay).toEqual(first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bootstrap applies 0003 before business sessions and scope resolution is active-only", async () => {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-bootstrap-"));
  const dbPath = join(directory, "bootstrap.sqlite");
  try {
    const application = await bootstrapSqliteApplication(dbPath, {
      backupDestinationPath: join(directory, "v2.sqlite"),
      cliVersion: "0.0.0-test",
      buildId: "bootstrap-test",
    });
    const native = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
    expect(native.query("SELECT schema_version, last_migration_id FROM database_control").get()).toEqual({ schema_version: 3n, last_migration_id: "0003-bookset-display-name" });
    expect(native.query("SELECT id, status FROM schema_migrations ORDER BY rowid").all()).toHaveLength(3);
    native.close();

    const created = await application.tenant.createTenantWithDefaultBookSet("INDIVIDUAL", "Scope Tenant", "INR", randomUUID());
    const tenantId = created.tenant.id;
    await application.tenant.activateTenant(tenantId);
    await expect(application.bookSetScope.resolve(tenantId)).resolves.toMatchObject({ id: created.defaultBookSet.id, lifecycle: "ACTIVE" });

    const now = new Date().toISOString();
    const prop1 = { id: brandBookSetId(randomUUID()), tenantId, kind: "PROPRIETORSHIP" as const, displayName: "  Prop One  ", lifecycle: "ACTIVE" as const, createdAt: now, updatedAt: now };
    const prop2 = { ...prop1, id: brandBookSetId(randomUUID()), displayName: "Prop Two" };
    await application.bookSet.create(prop1);
    await application.bookSet.create(prop2);
    await expect(application.bookSetScope.resolve(tenantId)).rejects.toMatchObject({ code: "BOOK_SET_SCOPE_AMBIGUOUS" });
    await expect(application.bookSetScope.resolve(tenantId, { bookSetId: prop1.id })).resolves.toMatchObject({ displayName: "Prop One" });
    await application.bookSet.archive(prop2.id, tenantId);
    await expect(application.bookSetScope.resolve(tenantId, { bookSetId: prop2.id })).rejects.toMatchObject({ code: "BOOK_SET_SCOPE_NOT_FOUND" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
