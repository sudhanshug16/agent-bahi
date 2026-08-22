/**
 * Comprehensive tenant.create command tests.
 * Verifies idempotency, replay, conflict detection, rollback, and public facade isolation.
 * Includes durable two-connection proof for concurrent idempotency and trigger-based abort recovery.
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
import { BusinessSessionBusyError } from "../../src/infrastructure/adapters/business-session-runner.ts";

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

  test("concurrent identical tenant.create on independent facades with contention handling", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "tenant-concurrent-durable-"));
    const dbPath = join(directory, "test.sqlite");
    try {
      // Bootstrap database once
      await bootstrapSqliteApplication(dbPath, {
        backupDestinationPath: join(directory, "backup.sqlite"),
      });

      // Open TWO independent facade instances
      const app1 = createSqliteApplication(dbPath);
      const app2 = createSqliteApplication(dbPath);

      const requestId = randomUUID();
      const envelope: CommandEnvelope<TenantCreatePayload> = {
        schemaVersion: 1 as const,
        tenantId: "temp" as any,
        requestId,
        actor: { kind: "SYSTEM" as const, id: "concurrent-test" },
        source: "INTERNAL" as const,
        reason: "Concurrent idempotency proof",
        payload: { kind: "COMPANY" as const, name: "Concurrent Corp", baseCurrency: "INR" },
      };

      // Issue identical requests concurrently via Promise.allSettled
      const results = await Promise.allSettled([
        app1.tenant.create(envelope),
        app2.tenant.create(envelope),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

      // Valid scenarios: both fulfilled with exact match, OR one fulfilled + one BUSINESS_SESSION_BUSY
      expect(fulfilled.length + rejected.length).toBe(2);

      if (fulfilled.length === 2) {
        // Both succeeded - verify exact match
        const result1 = fulfilled[0].value;
        const result2 = fulfilled[1].value;
        expect(result1.resultJson).toBe(result2.resultJson);
        expect(result1.resultHash).toBe(result2.resultHash);
      } else if (fulfilled.length === 1 && rejected.length === 1) {
        // One BUSY error expected
        const busyError = rejected[0].reason;
        expect(busyError.code).toBe("BUSINESS_SESSION_BUSY");

        // Retry through the losing facade after winner completes
        const result1 = fulfilled[0].value;
        const retryResult = await app2.tenant.create(envelope);

        // Verify exact match with original
        expect(retryResult.resultJson).toBe(result1.resultJson);
        expect(retryResult.resultHash).toBe(result1.resultHash);
        expect(retryResult.replayed).toBe(true);
      } else {
        throw new Error(`Invalid result: expected 2 fulfilled OR 1 fulfilled + 1 rejected, got ${fulfilled.length} fulfilled, ${rejected.length} rejected`);
      }

      // Query DB and verify exact state
      const native = new BunDatabase(dbPath, { readonly: true });

      // Get the tenant ID from first fulfilled result
      const result1Data = JSON.parse(fulfilled[0].value.resultJson);
      const tenantId = result1Data.tenantId;
      const bookSetId = result1Data.defaultBookSetId;

      // Verify exactly one tenant
      const tenantCount = (native.query("SELECT COUNT(*) as count FROM tenants WHERE id = ?").get(tenantId) as any).count;
      expect(tenantCount).toBe(1);

      // Verify one ACTIVE default BookSet
      const bookSetRow = native.query("SELECT lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?").get(bookSetId, tenantId) as any;
      expect(bookSetRow).toBeDefined();
      expect(bookSetRow.lifecycle).toBe("ACTIVE");

      // Verify five correctly scoped seed accounts
      const accountCount = (native.query("SELECT COUNT(*) as count FROM accounts WHERE tenant_id = ? AND book_set_id = ?").get(tenantId, bookSetId) as any).count;
      expect(accountCount).toBe(5);

      // Verify one tenant.create audit record
      const auditRecords = native.query(
        "SELECT command FROM audit_records WHERE tenant_id = ? AND request_id = ?",
      ).all(tenantId, requestId) as any[];
      expect(auditRecords).toHaveLength(1);
      expect(auditRecords[0].command).toBe("tenant.create");

      // Verify one finalized tenant_creation_requests row
      const tcrRow = native.query(
        "SELECT id, request_id, request_hash, tenant_id, result_json, result_hash FROM tenant_creation_requests WHERE request_id = ?",
      ).get(requestId) as any;
      expect(tcrRow).toBeDefined();
      expect(tcrRow.tenant_id).toBe(tenantId);
      expect(tcrRow.result_json).toBe(fulfilled[0].value.resultJson);
      expect(tcrRow.result_hash).toBe(fulfilled[0].value.resultHash);

      native.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("tenant.create failure with trigger abort reverts all writes, then retry succeeds with idempotency", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "tenant-trigger-abort-"));
    const dbPath = join(directory, "test.sqlite");
    try {
      // Bootstrap database
      await bootstrapSqliteApplication(dbPath, {
        backupDestinationPath: join(directory, "backup.sqlite"),
      });

      const app = createSqliteApplication(dbPath);

      const requestId = randomUUID();
      const envelope: CommandEnvelope<TenantCreatePayload> = {
        schemaVersion: 1 as const,
        tenantId: "temp" as any,
        requestId,
        actor: { kind: "SYSTEM" as const, id: "trigger-abort-test" },
        source: "INTERNAL" as const,
        reason: "Trigger abort recovery test",
        payload: { kind: "INDIVIDUAL" as const, name: "Trigger Test Person", baseCurrency: "USD" },
      };

      // Install trigger that aborts tenant_creation_requests finalization
      const setupDb = new BunDatabase(dbPath);
      setupDb.exec(`
        CREATE TRIGGER tenant_creation_requests_abort_for_test BEFORE UPDATE ON tenant_creation_requests
        WHEN NEW.result_json IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'test: abort finalization');
        END;
      `);
      setupDb.close();

      // Attempt tenant.create - should fail due to trigger abort
      let error: Error | null = null;
      try {
        await app.tenant.create(envelope);
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error!.message).toContain("trigger constraint violation");

      // Query DB: verify zero tenant/BookSet/account/audit/request rows for this attempt
      const queryDb = new BunDatabase(dbPath, { readonly: true });

      const tenantCount = (queryDb.query("SELECT COUNT(*) as count FROM tenants WHERE id = (SELECT DISTINCT tenant_id FROM tenant_creation_requests WHERE request_id = ?)").get(requestId) as any).count;
      expect(tenantCount).toBe(0);

      const bookSetCount = (queryDb.query("SELECT COUNT(*) as count FROM book_sets WHERE tenant_id IN (SELECT DISTINCT tenant_id FROM tenant_creation_requests WHERE request_id = ?)").get(requestId) as any).count;
      expect(bookSetCount).toBe(0);

      const accountCount = (queryDb.query("SELECT COUNT(*) as count FROM accounts WHERE tenant_id IN (SELECT DISTINCT tenant_id FROM tenant_creation_requests WHERE request_id = ?)").get(requestId) as any).count;
      expect(accountCount).toBe(0);

      const auditCount = (queryDb.query("SELECT COUNT(*) as count FROM audit_records WHERE request_id = ?").get(requestId) as any).count;
      expect(auditCount).toBe(0);

      const tcrCount = (queryDb.query("SELECT COUNT(*) as count FROM tenant_creation_requests WHERE request_id = ?").get(requestId) as any).count;
      expect(tcrCount).toBe(0);

      queryDb.close();

      // Drop the abort trigger
      const dropDb = new BunDatabase(dbPath);
      dropDb.exec("DROP TRIGGER tenant_creation_requests_abort_for_test;");
      dropDb.close();

      // Retry with SAME requestId/payload - should succeed
      const retryResult = await app.tenant.create(envelope);
      expect(retryResult).toBeDefined();

      const retryData = JSON.parse(retryResult.resultJson);
      expect(retryData.tenantId).toBeDefined();
      expect(retryData.defaultBookSetId).toBeDefined();
      expect(retryData.seedAccountIds).toBeDefined();

      // Verify state is clean and matches first successful attempt
      const finalDb = new BunDatabase(dbPath, { readonly: true });

      // Verify exactly one tenant
      const finalTenantCount = (finalDb.query("SELECT COUNT(*) as count FROM tenants WHERE id = ?").get(retryData.tenantId) as any).count;
      expect(finalTenantCount).toBe(1);

      // Verify one ACTIVE BookSet
      const bookSetRow = finalDb.query("SELECT lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?").get(retryData.defaultBookSetId, retryData.tenantId) as any;
      expect(bookSetRow.lifecycle).toBe("ACTIVE");

      // Verify five seed accounts
      const finalAccountCount = (finalDb.query("SELECT COUNT(*) as count FROM accounts WHERE tenant_id = ? AND book_set_id = ?").get(retryData.tenantId, retryData.defaultBookSetId) as any).count;
      expect(finalAccountCount).toBe(5);

      // Verify one tenant_creation_requests row (not two)
      const finalTcrCount = (finalDb.query("SELECT COUNT(*) as count FROM tenant_creation_requests WHERE request_id = ?").get(requestId) as any).count;
      expect(finalTcrCount).toBe(1);

      // Verify the finalized row
      const finalTcrRow = finalDb.query("SELECT tenant_id, result_json, result_hash FROM tenant_creation_requests WHERE request_id = ?").get(requestId) as any;
      expect(finalTcrRow.tenant_id).toBe(retryData.tenantId);
      expect(finalTcrRow.result_json).toBeDefined();
      expect(finalTcrRow.result_hash).toBeDefined();

      finalDb.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
