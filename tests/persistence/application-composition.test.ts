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
    expect(Object.keys(application).sort()).toEqual(["account", "bookSet", "bookSetScope", "tenant"]);
    expect((application as Record<string, unknown>).runner).toBeUndefined();
    expect((application as Record<string, unknown>).db).toBeUndefined();

    const requestId = randomUUID();
    const createEnvelope = {
      schemaVersion: 1 as const,
      tenantId: "temp" as any, // temp value, ignored for bootstrap
      requestId,
      actor: { kind: "SYSTEM" as const, id: "bootstrap" },
      source: "INTERNAL" as const,
      reason: "Bootstrap test",
      payload: { kind: "COMPANY" as const, name: "Composition Corp", baseCurrency: "INR" },
    };
    const first = await application.tenant.create(createEnvelope);
    const replay = await application.tenant.create(createEnvelope);
    expect(replay.resultJson).toEqual(first.resultJson);
    expect(replay.replayed).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bootstrap applies 0003-0004 before business sessions and scope resolution is active-only", async () => {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-bootstrap-"));
  const dbPath = join(directory, "bootstrap.sqlite");
  try {
    const application = await bootstrapSqliteApplication(dbPath, {
      backupDestinationPath: join(directory, "v2.sqlite"),
      cliVersion: "0.0.0-test",
      buildId: "bootstrap-test",
    });
    const native = new BunDatabase(dbPath, { readonly: true, safeIntegers: true });
    expect(native.query("SELECT schema_version, last_migration_id FROM database_control").get()).toEqual({ schema_version: 4n, last_migration_id: "0004-bookset-command-audit" });
    expect(native.query("SELECT id, status FROM schema_migrations ORDER BY rowid").all()).toHaveLength(4);
    native.close();

    const createRequestId = randomUUID();
    const createEnvelope = {
      schemaVersion: 1 as const,
      tenantId: "temp" as any,
      requestId: createRequestId,
      actor: { kind: "SYSTEM" as const, id: "bootstrap" },
      source: "INTERNAL" as const,
      reason: "Scope tenant creation",
      payload: { kind: "INDIVIDUAL" as const, name: "Scope Tenant", baseCurrency: "INR" },
    };
    const createResult = await application.tenant.create(createEnvelope);
    const tenantId = JSON.parse(createResult.resultJson).tenantId;
    const defaultBookSetId = JSON.parse(createResult.resultJson).defaultBookSetId;

    const activateEnvelope = {
      schemaVersion: 1 as const,
      tenantId,
      requestId: randomUUID(),
      actor: { kind: "SYSTEM" as const, id: "bootstrap" },
      source: "INTERNAL" as const,
      reason: "Activate tenant",
      payload: { defaultBookSetId },
    };
    await application.tenant.activate(activateEnvelope);
    await expect(application.bookSetScope.resolve(tenantId)).resolves.toMatchObject({ id: defaultBookSetId, lifecycle: "ACTIVE" });

    const prop1Envelope = {
      schemaVersion: 1 as const,
      tenantId,
      requestId: randomUUID(),
      actor: { kind: "SYSTEM" as const, id: "bootstrap" },
      source: "INTERNAL" as const,
      reason: "Create prop1",
      payload: { kind: "PROPRIETORSHIP" as const, displayName: "  Prop One  " },
    };
    const prop2Envelope = {
      schemaVersion: 1 as const,
      tenantId,
      requestId: randomUUID(),
      actor: { kind: "SYSTEM" as const, id: "bootstrap" },
      source: "INTERNAL" as const,
      reason: "Create prop2",
      payload: { kind: "PROPRIETORSHIP" as const, displayName: "Prop Two" },
    };

    const prop1CreateResult = await application.bookSet.create(prop1Envelope);
    const prop1Result = JSON.parse(prop1CreateResult.resultJson);
    const prop2CreateResult = await application.bookSet.create(prop2Envelope);
    const prop2Result = JSON.parse(prop2CreateResult.resultJson);

    await expect(application.bookSetScope.resolve(tenantId)).rejects.toMatchObject({ code: "BOOK_SET_SCOPE_AMBIGUOUS" });
    await expect(application.bookSetScope.resolve(tenantId, { bookSetId: prop1Result.bookSetId })).resolves.toMatchObject({ displayName: "Prop One" });

    const archiveEnvelope = {
      schemaVersion: 1 as const,
      tenantId,
      requestId: randomUUID(),
      actor: { kind: "SYSTEM" as const, id: "bootstrap" },
      source: "INTERNAL" as const,
      reason: "Archive prop2",
      payload: { bookSetId: prop2Result.bookSetId },
    };
    await application.bookSet.archive(archiveEnvelope);
    await expect(application.bookSetScope.resolve(tenantId, { bookSetId: prop2Result.bookSetId })).rejects.toMatchObject({ code: "BOOK_SET_SCOPE_NOT_FOUND" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
