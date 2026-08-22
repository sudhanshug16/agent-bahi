/**
 * Comprehensive tenant.create command tests.
 * Verifies idempotency, replay, conflict detection, rollback, and public facade isolation.
 */
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Database as BunDatabase } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapSqliteApplication } from "../../src/application/application.ts";
import { createSqliteApplication } from "../../src/application/application.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { BusinessSessionFactory } from "../../src/infrastructure/adapters/business-session-factory.ts";
import type { CommandEnvelope } from "../../src/application/commands.ts";
import type { TenantCreatePayload } from "../../src/application/commands.ts";
import { IdempotencyConflictError } from "../../src/core/types.ts";

describe("tenant.create bootstrap command", () => {
  test("creates tenant in CREATING state with active default BookSet and seed accounts", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "tenant-bootstrap-"));
    const dbPath = join(directory, "test.sqlite");
    try {
      const app = await bootstrapSqliteApplication(dbPath, {
        backupDestinationPath: join(directory, "backup.sqlite"),
      });

      const requestId = randomUUID();
      const envelope: CommandEnvelope<TenantCreatePayload> = {
        schemaVersion: 1 as const,
        tenantId: "temp" as any,
        requestId,
        actor: { kind: "SYSTEM" as const, id: "test" },
        source: "INTERNAL" as const,
        reason: "Bootstrap test",
        payload: { kind: "COMPANY" as const, name: "Test Corp", baseCurrency: "INR" },
      };

      const result = await app.tenant.create(envelope);
      const resultData = JSON.parse(result.resultJson);

      expect(resultData.tenantLifecycle).toBe("CREATING");
      expect(resultData.defaultBookSetId).toBeDefined();
      expect(resultData.seedAccountIds).toBeDefined();
      expect(resultData.seedAccountIds.assets).toBeDefined();
      expect(resultData.seedAccountIds.liabilities).toBeDefined();
      expect(resultData.seedAccountIds.equity).toBeDefined();
      expect(resultData.seedAccountIds.income).toBeDefined();
      expect(resultData.seedAccountIds.expenses).toBeDefined();

      // Verify via SQL that CREATING state is set
      const native = new BunDatabase(dbPath, { readonly: true });
      const tenantRow = native.query("SELECT lifecycle FROM tenants WHERE id = ?").get(resultData.tenantId) as any;
      expect(tenantRow.lifecycle).toBe("CREATING");

      // Verify BookSet is ACTIVE
      const bookSetRow = native.query("SELECT lifecycle FROM book_sets WHERE id = ?").get(resultData.defaultBookSetId) as any;
      expect(bookSetRow.lifecycle).toBe("ACTIVE");

      // Verify seed accounts exist
      const accountCount = native.query("SELECT COUNT(*) as count FROM accounts WHERE tenant_id = ? AND book_set_id = ?").get(resultData.tenantId, resultData.defaultBookSetId) as any;
      expect(accountCount.count).toBe(5);

      native.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("exact replay with same requestId and payload returns exact stored response with no new rows", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "tenant-replay-"));
    const dbPath = join(directory, "test.sqlite");
    try {
      const app = await bootstrapSqliteApplication(dbPath, {
        backupDestinationPath: join(directory, "backup.sqlite"),
      });

      const requestId = randomUUID();
      const envelope: CommandEnvelope<TenantCreatePayload> = {
        schemaVersion: 1 as const,
        tenantId: "temp" as any,
        requestId,
        actor: { kind: "SYSTEM" as const, id: "test" },
        source: "INTERNAL" as const,
        reason: "Replay test",
        payload: { kind: "INDIVIDUAL" as const, name: "John Doe", baseCurrency: "USD" },
      };

      const first = await app.tenant.create(envelope);
      const firstData = JSON.parse(first.resultJson);

      // Count rows before replay
      let native = new BunDatabase(dbPath, { readonly: true });
      const rowsBefore = {
        tenants: (native.query("SELECT COUNT(*) as count FROM tenants").get() as any).count,
        bookSets: (native.query("SELECT COUNT(*) as count FROM book_sets").get() as any).count,
        accounts: (native.query("SELECT COUNT(*) as count FROM accounts").get() as any).count,
        auditRecords: (native.query("SELECT COUNT(*) as count FROM audit_records").get() as any).count,
      };
      native.close();

      // Replay with exact same requestId and payload
      const replay = await app.tenant.create(envelope);
      const replayData = JSON.parse(replay.resultJson);

      expect(replay.replayed).toBe(true);
      expect(replay.resultJson).toBe(first.resultJson);
      expect(replayData).toEqual(firstData);

      // Count rows after replay - should be unchanged
      native = new BunDatabase(dbPath, { readonly: true });
      const rowsAfter = {
        tenants: (native.query("SELECT COUNT(*) as count FROM tenants").get() as any).count,
        bookSets: (native.query("SELECT COUNT(*) as count FROM book_sets").get() as any).count,
        accounts: (native.query("SELECT COUNT(*) as count FROM accounts").get() as any).count,
        auditRecords: (native.query("SELECT COUNT(*) as count FROM audit_records").get() as any).count,
      };
      native.close();

      expect(rowsAfter.tenants).toBe(rowsBefore.tenants);
      expect(rowsAfter.bookSets).toBe(rowsBefore.bookSets);
      expect(rowsAfter.accounts).toBe(rowsBefore.accounts);
      expect(rowsAfter.auditRecords).toBe(rowsBefore.auditRecords);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("same requestId with different payload returns typed IdempotencyConflictError", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "tenant-conflict-"));
    const dbPath = join(directory, "test.sqlite");
    try {
      const app = await bootstrapSqliteApplication(dbPath, {
        backupDestinationPath: join(directory, "backup.sqlite"),
      });

      const requestId = randomUUID();
      const envelope1: CommandEnvelope<TenantCreatePayload> = {
        schemaVersion: 1 as const,
        tenantId: "temp" as any,
        requestId,
        actor: { kind: "SYSTEM" as const, id: "test" },
        source: "INTERNAL" as const,
        reason: "Conflict test 1",
        payload: { kind: "COMPANY" as const, name: "Corp A", baseCurrency: "INR" },
      };

      await app.tenant.create(envelope1);

      // Now try with different payload but same requestId
      const envelope2: CommandEnvelope<TenantCreatePayload> = {
        schemaVersion: 1 as const,
        tenantId: "temp" as any,
        requestId, // Same requestId
        actor: { kind: "SYSTEM" as const, id: "test" },
        source: "INTERNAL" as const,
        reason: "Conflict test 2",
        payload: { kind: "INDIVIDUAL" as const, name: "Corp B", baseCurrency: "USD" }, // Different payload
      };

      await expect(app.tenant.create(envelope2)).rejects.toMatchObject({
        code: "IDEMPOTENCY_CONFLICT",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("one combined tenant.create audit event is recorded per execution", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "tenant-audit-"));
    const dbPath = join(directory, "test.sqlite");
    try {
      const app = await bootstrapSqliteApplication(dbPath, {
        backupDestinationPath: join(directory, "backup.sqlite"),
      });

      const requestId = randomUUID();
      const envelope: CommandEnvelope<TenantCreatePayload> = {
        schemaVersion: 1 as const,
        tenantId: "temp" as any,
        requestId,
        actor: { kind: "HUMAN" as const, id: "user@example.com" },
        source: "CLI" as const,
        reason: "Manual bootstrap",
        payload: { kind: "COMPANY" as const, name: "Audit Test Corp", baseCurrency: "INR" },
      };

      const result = await app.tenant.create(envelope);
      const resultData = JSON.parse(result.resultJson);

      const native = new BunDatabase(dbPath, { readonly: true });
      const auditRecords = native.query(
        "SELECT id, command, action, actor_type, actor_id, request_id, reason FROM audit_records WHERE tenant_id = ? AND request_id = ?",
      ).all(resultData.tenantId, requestId) as any[];
      native.close();

      expect(auditRecords).toHaveLength(1);
      expect(auditRecords[0].command).toBe("tenant.create");
      expect(auditRecords[0].action).toBe("tenant.create");
      expect(auditRecords[0].actor_type).toBe("HUMAN");
      expect(auditRecords[0].actor_id).toBe("user@example.com");
      expect(auditRecords[0].reason).toBe("Manual bootstrap");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("sequential tenant.create with different requestIds creates independent tenants", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "tenant-concurrent-"));
    const dbPath = join(directory, "test.sqlite");
    try {
      const app = await bootstrapSqliteApplication(dbPath, {
        backupDestinationPath: join(directory, "backup.sqlite"),
      });

      const requestId1 = randomUUID();
      const requestId2 = randomUUID();

      const envelope1: CommandEnvelope<TenantCreatePayload> = {
        schemaVersion: 1 as const,
        tenantId: "temp" as any,
        requestId: requestId1,
        actor: { kind: "SYSTEM" as const, id: "conn1" },
        source: "INTERNAL" as const,
        reason: "Concurrent 1",
        payload: { kind: "COMPANY" as const, name: "Concurrent Corp 1", baseCurrency: "INR" },
      };

      const envelope2: CommandEnvelope<TenantCreatePayload> = {
        schemaVersion: 1 as const,
        tenantId: "temp" as any,
        requestId: requestId2,
        actor: { kind: "SYSTEM" as const, id: "conn2" },
        source: "INTERNAL" as const,
        reason: "Concurrent 2",
        payload: { kind: "INDIVIDUAL" as const, name: "Concurrent Person", baseCurrency: "USD" },
      };

      // Execute sequentially
      const result1 = await app.tenant.create(envelope1);
      const result2 = await app.tenant.create(envelope2);

      const data1 = JSON.parse(result1.resultJson);
      const data2 = JSON.parse(result2.resultJson);

      // Verify both tenants were created independently
      expect(data1.tenantId).not.toBe(data2.tenantId);
      expect(data1.tenantKind).toBe("COMPANY");
      expect(data2.tenantKind).toBe("INDIVIDUAL");

      const native = new BunDatabase(dbPath, { readonly: true });
      const tenantCount = (native.query("SELECT COUNT(*) as count FROM tenants").get() as any).count;
      native.close();

      expect(tenantCount).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("public facade does not expose raw tenant service mutators", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "tenant-public-"));
    const dbPath = join(directory, "test.sqlite");
    try {
      const app = await bootstrapSqliteApplication(dbPath, {
        backupDestinationPath: join(directory, "backup.sqlite"),
      });

      // Verify that createTenantWithDefaultBookSet is not available on public facade
      expect((app.tenant as any).createTenantWithDefaultBookSet).toBeUndefined();
      expect((app.tenant as any).activateTenant).toBeUndefined();

      // Verify that raw bookSet methods are not available
      expect((app.bookSet as any).archive).toBeDefined(); // Archive is available as a command
      expect(typeof (app.bookSet as any).archive).toBe("function");

      // Verify that idempotency service is not exposed at all
      expect((app as any).idempotency).toBeUndefined();

      // Verify read-only operations are available
      expect(typeof app.tenant.getTenant).toBe("function");
      expect(typeof app.tenant.listActiveTenants).toBe("function");
      expect(typeof app.bookSet.getDefault).toBe("function");
      expect(typeof app.account.getByCode).toBe("function");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rollback on failure prevents partial state", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "tenant-rollback-"));
    const dbPath = join(directory, "test.sqlite");
    try {
      const app = await bootstrapSqliteApplication(dbPath, {
        backupDestinationPath: join(directory, "backup.sqlite"),
      });

      // Get initial row counts
      const native = new BunDatabase(dbPath, { readonly: true });
      const initialTenantCount = (native.query("SELECT COUNT(*) as count FROM tenants").get() as any).count;
      const initialBookSetCount = (native.query("SELECT COUNT(*) as count FROM book_sets").get() as any).count;
      native.close();

      // Try to create tenant with invalid baseCurrency (too long)
      const invalidEnvelope: CommandEnvelope<TenantCreatePayload> = {
        schemaVersion: 1 as const,
        tenantId: "temp" as any,
        requestId: randomUUID(),
        actor: { kind: "SYSTEM" as const, id: "test" },
        source: "INTERNAL" as const,
        reason: "Invalid currency",
        payload: { kind: "COMPANY" as const, name: "Should Fail", baseCurrency: "VERYLONGCURRENCY" },
      };

      await expect(app.tenant.create(invalidEnvelope)).rejects.toThrow();

      // Verify no new rows were created
      const nativeAfter = new BunDatabase(dbPath, { readonly: true });
      const finalTenantCount = (nativeAfter.query("SELECT COUNT(*) as count FROM tenants").get() as any).count;
      const finalBookSetCount = (nativeAfter.query("SELECT COUNT(*) as count FROM book_sets").get() as any).count;
      nativeAfter.close();

      expect(finalTenantCount).toBe(initialTenantCount);
      expect(finalBookSetCount).toBe(initialBookSetCount);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
