import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "crypto";
import type { Database, BusinessSessionRunner } from "../../src/application/ports/persistence.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { BusinessSessionFactory } from "../../src/infrastructure/adapters/business-session-factory.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { TenantService } from "../../src/application/services/tenant-service.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import { IdempotencyConflictError, DomainError } from "../../src/core/types.ts";

describe("Phase 1A: Idempotency and FK Enforcement Regression Tests", () => {
  let db: Database;
  let sessionRunner: BusinessSessionRunner;
  let tenantService: TenantService;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = `/tmp/agent-bahi-test-idempotency-${randomUUID()}.sqlite`;
    db = new SqliteAdapter({ path: dbPath });
    sessionRunner = BusinessSessionFactory.createSessionRunner(dbPath, "sqlite", 1, 1);

    const migrationService = new MigrationService(db, "sqlite");
    tenantService = new TenantService(sessionRunner);

    // Initialize database schema
    await migrationService.migrate([
      {
        id: CORE_MIGRATIONS.id,
        sql: CORE_MIGRATIONS.sqlite,
      },
    ]);
  });

  afterEach(async () => {
    await db.close();
    try {
      await Bun.write(`${dbPath}.delete`, "");
    } catch {
      // Ignore deletion errors
    }
  });

  describe("FK Enforcement with nullable columns", () => {
    it("should enable PRAGMA foreign_keys", async () => {
      const result = await db.querySingle("PRAGMA foreign_keys");
      expect((result as any).foreign_keys === 1 || (result as any).foreign_keys === 1n).toBe(true);
    });

    it("should enforce tenant FK on book_sets", async () => {
      try {
        // Try to insert book_set with non-existent tenant_id
        await db.execute(
          `INSERT INTO book_sets (id, tenant_id, kind, lifecycle, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), "nonexistent-tenant", "COMPANY", "ACTIVE", new Date().toISOString(), new Date().toISOString()],
        );
        throw new Error("Should have failed FK constraint");
      } catch (error) {
        expect(error).toMatchObject({
          code: "SQLITE_CONSTRAINT",
          message: "SQLite foreign key constraint violation",
        });
      }
    });

    it("should enforce composite default_book_set_id -> (tenant_id, book_set.id) trigger", async () => {
      // Create tenant and book_set for different tenants in same transaction
      try {
        await db.unitOfWork().execute(async (tx) => {
          const tenant1Id = randomUUID();
          const tenant2Id = randomUUID();
          const bookSetId = randomUUID();
          const now = new Date().toISOString();

          // Insert both tenants first
          await tx.execute(
            `INSERT INTO tenants (id, kind, lifecycle, name, base_currency, default_book_set_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [tenant1Id, "COMPANY", "CREATING", "Tenant 1", "INR", null, now, now],
          );

          await tx.execute(
            `INSERT INTO tenants (id, kind, lifecycle, name, base_currency, default_book_set_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [tenant2Id, "COMPANY", "CREATING", "Tenant 2", "INR", null, now, now],
          );

          // Insert book_set for tenant2
          await tx.execute(
            `INSERT INTO book_sets (id, tenant_id, kind, lifecycle, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [bookSetId, tenant2Id, "COMPANY", "ACTIVE", now, now],
          );

          // Try to update tenant1's default_book_set_id to book_set from tenant2
          // This should fail the trigger
          await tx.execute(
            `UPDATE tenants SET default_book_set_id = ? WHERE id = ?`,
            [bookSetId, tenant1Id],
          );
        });
        throw new Error("Should have failed composite trigger");
      } catch (error) {
        expect(error).toMatchObject({
          code: "SQLITE_CONSTRAINT",
          message: "SQLite trigger constraint violation",
        });
      }
    });
  });

  describe("Idempotency and request_id replay", () => {
    it("should return cached result on same request_id replay", async () => {
      const requestId = randomUUID();

      // First call
      const result1 = await tenantService.createTenantWithDefaultBookSet(
        "COMPANY",
        "Test Corp",
        "INR",
        requestId,
      );

      // Second call with same request_id
      const result2 = await tenantService.createTenantWithDefaultBookSet(
        "COMPANY",
        "Test Corp",
        "INR",
        requestId,
      );

      expect(result1.tenant.id).toBe(result2.tenant.id);
      expect(result1.defaultBookSet.id).toBe(result2.defaultBookSet.id);
    });

    it("should fail on same request_id with different parameters", async () => {
      const requestId = randomUUID();

      // First call
      await tenantService.createTenantWithDefaultBookSet(
        "COMPANY",
        "Test Corp 1",
        "INR",
        requestId,
      );

      // Second call with same request_id but different name
      try {
        await tenantService.createTenantWithDefaultBookSet(
          "COMPANY",
          "Test Corp 2",
          "INR",
          requestId,
        );
        throw new Error("Should have failed idempotency check");
      } catch (error) {
        expect(error instanceof IdempotencyConflictError).toBe(true);
      }
    });

    it("should enforce UNIQUE request_id constraint", async () => {
      const requestId = randomUUID();

      // First call reserves the request row
      const result1 = await tenantService.createTenantWithDefaultBookSet(
        "COMPANY",
        "Test Corp",
        "INR",
        requestId,
      );

      // Second call with same request_id should return cached result
      const result2 = await tenantService.createTenantWithDefaultBookSet(
        "COMPANY",
        "Test Corp",
        "INR",
        requestId,
      );

      expect(result1.tenant.id).toBe(result2.tenant.id);
      expect(result1.defaultBookSet.id).toBe(result2.defaultBookSet.id);

      // Verify only one tenant created in database
      const tenants = await db.query("SELECT COUNT(*) as count FROM tenants WHERE name = 'Test Corp'");
      const count = (tenants.rows[0] as any).count;
      expect(count === 1 || count === 1n).toBe(true);
    });

    it("should not leak partial rows on idempotency reserve", async () => {
      const requestId = randomUUID();

      // First call creates tenant
      const result1 = await tenantService.createTenantWithDefaultBookSet(
        "COMPANY",
        "Test Corp",
        "INR",
        requestId,
      );

      // Verify the row structure is complete (no NULL result_json on finalized row)
      const req = await db.querySingle(
        "SELECT tenant_id, result_json FROM tenant_creation_requests WHERE request_id = ?",
        [requestId],
      );

      expect(req?.tenant_id).toBe(result1.tenant.id);
      expect(req?.result_json).toBeDefined();
      expect(req?.result_json).not.toBeNull();
    });
  });

  describe("Transaction rollback and partial failure cleanup", () => {
    it("should not leave partial tenant/bookset/request rows on failure", async () => {
      const requestId = randomUUID();

      try {
        await db.unitOfWork().execute(async (tx) => {
          // Simulate the full create flow
          const tenantId = randomUUID();
          const bookSetId = randomUUID();
          const now = new Date().toISOString();

          // Reserve request row
          await tx.execute(
            `INSERT INTO tenant_creation_requests (id, request_id, request_hash, tenant_id, result_json, result_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [randomUUID(), requestId, "test-hash", null, null, null, now],
          );

          // Create tenant
          await tx.execute(
            `INSERT INTO tenants (id, kind, lifecycle, name, base_currency, default_book_set_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [tenantId, "COMPANY", "CREATING", "Fail Test", "INR", null, now, now],
          );

          // Create book_set
          await tx.execute(
            `INSERT INTO book_sets (id, tenant_id, kind, lifecycle, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [bookSetId, tenantId, "COMPANY", "ACTIVE", now, now],
          );

          // Simulate failure before finalizing request row
          throw new Error("Simulated failure");
        });
      } catch (error) {
        // Expected
      }

      // Verify no partial rows were left
      const requests = await db.query(
        "SELECT COUNT(*) as count FROM tenant_creation_requests WHERE request_id = ?",
        [requestId],
      );
      const requestCount = (requests.rows[0] as any).count;
      expect(requestCount === 0 || requestCount === 0n).toBe(true);

      const tenants = await db.query("SELECT COUNT(*) as count FROM tenants WHERE name = 'Fail Test'");
      const tenantCount = (tenants.rows[0] as any).count;
      expect(tenantCount === 0 || tenantCount === 0n).toBe(true);
    });
  });
});
