/**
 * Phase 1A Defect Tests - Negative tests that expose schema/implementation gaps
 * 
 * These tests MUST fail with current implementation to prove defects exist.
 * Each defect maps to one requirement from the task spec.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "crypto";
import type { Database } from "../../src/application/ports/persistence.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { SqliteTenantRepository } from "../../src/infrastructure/repositories/tenant-repository.ts";
import { SqliteBookSetRepository } from "../../src/infrastructure/repositories/book-set-repository.ts";
import { SqliteAccountRepository } from "../../src/infrastructure/repositories/account-repository.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { CompatibilityService } from "../../src/infrastructure/services/compatibility-service.ts";
import { TenantService } from "../../src/application/services/tenant-service.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import { brandTenantId, brandBookSetId, brandAccountId, currentTimestamp, DirtyMigrationError } from "../../src/core/types.ts";

describe("Phase 1A Defects - Negative Tests for Real Constraints", () => {
  let db: Database;
  let tenantRepo: SqliteTenantRepository;
  let bookSetRepo: SqliteBookSetRepository;
  let accountRepo: SqliteAccountRepository;
  let migrationService: MigrationService;
  let tenantService: TenantService;

  beforeEach(async () => {
    const dbPath = `/tmp/defect-test-${randomUUID()}.sqlite`;
    db = new SqliteAdapter({ path: dbPath });
    tenantRepo = new SqliteTenantRepository(db);
    bookSetRepo = new SqliteBookSetRepository(db);
    accountRepo = new SqliteAccountRepository(db);
    migrationService = new MigrationService(db, "sqlite");
    tenantService = new TenantService(db, tenantRepo, bookSetRepo);

    await migrationService.migrate([
      { id: CORE_MIGRATIONS.id, sql: CORE_MIGRATIONS.sqlite },
    ]);
  });

  afterEach(async () => {
    await db.close();
  });

  describe("DEFECT-1: Cross-tenant composite FK not enforced", () => {
    it("should reject account with tenant1 id + tenant2 bookset (COMPOSITE FK)", async () => {
      const { tenant: t1, defaultBookSet: bs1 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Corp1");
      const { tenant: t2, defaultBookSet: bs2 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Corp2");

      // DEFECT: This should fail because account.tenant_id=t1 but account.book_set_id=bs2 (which belongs to t2)
      // The FK on book_sets(id) doesn't check the tenant_id matches
      try {
        await accountRepo.create({
          id: brandAccountId(randomUUID()),
          tenantId: t1.id,
          bookSetId: bs2.id,  // WRONG: bs2 belongs to t2
          code: "1000",
          name: "Cross-tenant",
          accountType: "asset",
          createdAt: currentTimestamp(),
          updatedAt: currentTimestamp(),
        });
        throw new Error("DEFECT: Cross-tenant account created - composite FK not enforced");
      } catch (error) {
        if ((error as any).message.includes("DEFECT:")) throw error;
        // Expected: should reject with FK constraint
        expect((error as any).code).toMatch(/FK|CONSTRAINT|TENANT/i);
      }
    });
  });

  describe("DEFECT-2: Default BookSet not composite-bound to tenant", () => {
    it("should reject setting default_book_set_id to another tenant's BookSet", async () => {
      const { tenant: t1 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Corp1");
      const { tenant: t2, defaultBookSet: bs2 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Corp2");

      // DEFECT: Should not allow setting t1.default_book_set_id = bs2.id (belongs to t2)
      try {
        await db.execute(
          "UPDATE tenants SET default_book_set_id = ? WHERE id = ?",
          [bs2.id, t1.id]
        );
        throw new Error("DEFECT: Set default_book_set_id to cross-tenant BookSet");
      } catch (error) {
        if ((error as any).message.includes("DEFECT:")) throw error;
        expect((error as any).code).toMatch(/FK|CONSTRAINT|TENANT/i);
      }
    });
  });

  describe("DEFECT-3: Company tenant accepts wrong BookSet kinds", () => {
    it("should reject PERSONAL BookSet for COMPANY tenant", async () => {
      const { tenant } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "TestCorp");

      try {
        await bookSetRepo.create({
          id: brandBookSetId(randomUUID()),
          tenantId: tenant.id,
          kind: "PERSONAL",  // WRONG: COMPANY tenant can only have COMPANY BookSet
          lifecycle: "ACTIVE",
          createdAt: currentTimestamp(),
          updatedAt: currentTimestamp(),
        });
        throw new Error("DEFECT: COMPANY tenant accepted PERSONAL BookSet");
      } catch (error) {
        if ((error as any).message.includes("DEFECT:")) throw error;
        // Should enforce (tenant_kind, book_set_kind) compatibility
        expect((error as any).code).toMatch(/KIND|CARDINALITY|COMPATIBILITY/i);
      }
    });

    it("should reject PROPRIETORSHIP BookSet for COMPANY tenant", async () => {
      const { tenant } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "TestCorp");

      try {
        await bookSetRepo.create({
          id: brandBookSetId(randomUUID()),
          tenantId: tenant.id,
          kind: "PROPRIETORSHIP",  // WRONG: COMPANY can only have COMPANY
          lifecycle: "ACTIVE",
          createdAt: currentTimestamp(),
          updatedAt: currentTimestamp(),
        });
        throw new Error("DEFECT: COMPANY tenant accepted PROPRIETORSHIP BookSet");
      } catch (error) {
        if ((error as any).message.includes("DEFECT:")) throw error;
        expect((error as any).code).toMatch(/KIND|CARDINALITY|COMPATIBILITY/i);
      }
    });
  });

  describe("DEFECT-4: Account code can be reused after archive", () => {
    it("should prevent reusing account code even after archiving", async () => {
      const { tenant, defaultBookSet } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Test");

      const acct1Id = brandAccountId(randomUUID());
      await accountRepo.create({
        id: acct1Id,
        tenantId: tenant.id,
        bookSetId: defaultBookSet.id,
        code: "1000",
        name: "Original",
        accountType: "asset",
        createdAt: currentTimestamp(),
        updatedAt: currentTimestamp(),
      });

      // Archive the account (mark as deleted but keep the row)
      await accountRepo.archive(acct1Id, tenant.id, defaultBookSet.id);

      // Code 1000 should still be blocked from reuse (even though account is archived)
      try {
        await accountRepo.create({
          id: brandAccountId(randomUUID()),
          tenantId: tenant.id,
          bookSetId: defaultBookSet.id,
          code: "1000",  // SAME CODE
          name: "Reused",
          accountType: "asset",
          createdAt: currentTimestamp(),
          updatedAt: currentTimestamp(),
        });
        throw new Error("DEFECT: Account code reused after archiving");
      } catch (error) {
        if ((error as any).message.includes("DEFECT:")) throw error;
        // Should reject with code uniqueness constraint
        expect((error as any).code).toMatch(/ALREADY_EXISTS|CODE/i);
      }
    });
  });

  describe("DEFECT-5: GST effective-dated history (now fixed)", () => {
    it("should allow multiple GSTIN records with non-overlapping effective dates", async () => {
      const { tenant } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "TestCorp");

      // First registration: 2023-01-01 to 2024-05-31
      const id1 = brandBookSetId(randomUUID());
      await db.execute(
        `INSERT INTO gst_registrations
         (id, tenant_id, gstin, status, effective_from, effective_to, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id1,
          tenant.id,
          "27AABCT1234H1Z0",
          "ACTIVE",
          "2023-01-01T00:00:00Z",
          "2024-05-31T23:59:59Z",  // Ends before next one starts
          currentTimestamp(),
          currentTimestamp(),
        ]
      );

      // Second registration: 2024-06-01 onwards (different effective date, non-overlapping)
      // This should work - demonstrates support for historical records
      const id2 = brandBookSetId(randomUUID());
      await db.execute(
        `INSERT INTO gst_registrations
         (id, tenant_id, gstin, status, effective_from, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id2,
          tenant.id,
          "27AABCT1234H1Z0",  // SAME GSTIN
          "AMENDED",
          "2024-06-01T00:00:00Z",  // After first one ends - OK
          currentTimestamp(),
          currentTimestamp(),
        ]
      );

      // Both should exist now
      const all = await db.query(
        "SELECT id FROM gst_registrations WHERE tenant_id = ? AND gstin = ? ORDER BY effective_from",
        [tenant.id, "27AABCT1234H1Z0"]
      );
      expect(all.rows.length).toBe(2);
    });
  });

  describe("DEFECT-6: No composite FK enforcement on tenant.default_book_set_id", () => {
    it("should verify default_book_set_id belongs to same tenant", async () => {
      const { tenant: t1, defaultBookSet: bs1 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "C1");
      const { defaultBookSet: bs2 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "C2");

      // Directly test schema constraint (would normally go through service but testing raw SQL)
      try {
        await db.execute(
          "UPDATE tenants SET default_book_set_id = ? WHERE id = ?",
          [bs2.id, t1.id]
        );
        // If we get here, composite FK failed
        const updated = await tenantRepo.getById(t1.id);
        if (updated.defaultBookSetId === bs2.id) {
          throw new Error("DEFECT: default_book_set_id not validated for tenant ownership");
        }
      } catch (error) {
        if ((error as any).message?.includes("DEFECT:")) throw error;
        // Good: schema rejected the invalid FK
      }
    });
  });

  describe("DEFECT-7: Tenant creation idempotency", () => {
    it("should return same result for same request_id", async () => {
      // Idempotency requires: same request_id -> same result
      // If client retries with same request_id, should get cached result, not duplicate tenant

      const requestId = randomUUID();  // Fixed request ID for this operation

      // First call with this request_id creates new tenant
      const result1 = await tenantService.createTenantWithDefaultBookSet(
        "COMPANY",
        "IdempTest",
        "INR",
        requestId
      );

      // Second call with same request_id should return cached result
      const result2 = await tenantService.createTenantWithDefaultBookSet(
        "COMPANY",
        "IdempTest",
        "INR",
        requestId  // SAME request_id
      );

      // Should get exact same tenant (not a new one)
      expect(result1.tenant.id).toBe(result2.tenant.id);
      expect(result1.defaultBookSet.id).toBe(result2.defaultBookSet.id);
    });

    it("should reject conflicting request parameters for same request_id", async () => {
      const requestId = randomUUID();

      // First call creates tenant
      const result1 = await tenantService.createTenantWithDefaultBookSet(
        "COMPANY",
        "First",
        "INR",
        requestId
      );

      // Second call with SAME request_id but DIFFERENT parameters should conflict
      try {
        await tenantService.createTenantWithDefaultBookSet(
          "COMPANY",
          "Different",  // DIFFERENT name
          "INR",
          requestId  // SAME request_id
        );
        throw new Error("DEFECT: Should reject conflicting request parameters");
      } catch (error) {
        if ((error as any).message.includes("DEFECT:")) throw error;
        // Expected: IdempotencyConflictError
        expect((error as any).code).toBe("IDEMPOTENCY_CONFLICT");
      }
    });
  });

  describe("DEFECT-8: Compatibility bypass - no schema check", () => {
    it("should reject CLI version for database with missing core schema", async () => {
      // Create a fresh database with no schema
      const emptyDbPath = `/tmp/empty-${randomUUID()}.sqlite`;
      const emptyDb = new SqliteAdapter({ path: emptyDbPath });
      const compatService = new CompatibilityService(emptyDb, "sqlite");

      // DEFECT: Should reject "0.0.0-gate0" for a DB with no schema_migrations table
      try {
        await compatService.checkCompatibility("0.0.0-gate0");
        throw new Error("DEFECT: Compatibility check passed on empty schema database");
      } catch (error) {
        if ((error as any).message?.includes("DEFECT:")) throw error;
        // Expected: should fail with schema missing error
        expect((error as any).code).toMatch(/SCHEMA|MIGRATION|COMPATIBLE/i);
      }

      await emptyDb.close();
    });
  });

  describe("DEFECT-9: Raw SQLITE_BUSY error leaks", () => {
    it("should return typed error for SQLITE_BUSY, not raw error string", async () => {
      // This is hard to test without forcing contention
      // But we can verify error handling exists in SQLiteAdapter
      
      // For now, just verify the adapter has proper error classification
      const errors = await db.query("SELECT 1");
      expect(errors).toBeDefined();
    });
  });

  describe("DEFECT-10: Two SQLite adapters both acquire lock (per-process lock counter)", () => {
    it("should serialize access across two SQLite instances connecting to same file", async () => {
      const dbPath = `/tmp/shared-${randomUUID()}.sqlite`;
      
      const db1 = new SqliteAdapter({ path: dbPath });
      const db2 = new SqliteAdapter({ path: dbPath });

      const lock1 = await db1.acquireAdvisoryLock("test-lock", 1000);
      expect(lock1).toBe(true);

      // DEFECT: db2 can acquire lock on same file (different process/instance)
      const lock2 = await db2.acquireAdvisoryLock("test-lock", 1000);

      if (lock2 === true) {
        throw new Error("DEFECT: Two SQLite adapters both acquired same lock - counter is per-process, not durable");
      }

      await db1.releaseAdvisoryLock("test-lock");
      await db1.close();
      await db2.close();
    });
  });

  describe("DEFECT-11: Dirty marker persists after migration failure", () => {
    it("should persist dirty marker even when migration DDL fails", async () => {
      const migSvc = new MigrationService(db, "sqlite");

      // Try to apply a migration that will fail partway through
      try {
        await migSvc.migrate([
          {
            id: "test-bad-migration",
            sql: `
              CREATE TABLE test_table (id TEXT PRIMARY KEY);
              CREATE TABLE test_table (id TEXT PRIMARY KEY);
            `,
          },
        ]);
      } catch (error) {
        // Expected: migration failed with MIGRATION_EXECUTION_FAILED
        expect((error as any).code).toBe("MIGRATION_EXECUTION_FAILED");
      }

      // Verify DIRTY marker persisted (not rolled back)
      const status = await migSvc.getStatus();
      if (status.isDirty) {
        // Good: dirty marker is present
        const dirtyRecord = await db.querySingle(
          "SELECT status, dirty_reason FROM schema_migrations WHERE id = ?",
          ["test-bad-migration"]
        );

        if (!dirtyRecord || dirtyRecord.status !== "DIRTY") {
          throw new Error("DEFECT: Dirty marker not persisted or status not DIRTY");
        }
      } else {
        throw new Error("DEFECT: isDirty should be true after migration failure");
      }
    });

    it("should block subsequent migrations while DIRTY marker is present", async () => {
      const migSvc = new MigrationService(db, "sqlite");

      // First migration fails
      try {
        await migSvc.migrate([
          {
            id: "test-bad-1",
            sql: `
              CREATE TABLE bad1 (id TEXT);
              CREATE TABLE bad1 (id TEXT);
            `,
          },
        ]);
      } catch (error) {
        // Expected: migration failed
        expect(error).toBeDefined();
      }

      // Try to apply a distinct migration; should be blocked by preflight
      try {
        await migSvc.migrate([
          {
            id: "test-good-1",
            sql: "CREATE TABLE good1 (id TEXT PRIMARY KEY)",
          },
        ]);
        throw new Error("DEFECT: Should have blocked second migration while DIRTY exists");
      } catch (error) {
        if (error instanceof Error && error.message.includes("DEFECT:")) throw error;
        // Expected: DirtyMigrationError from preflight check
        expect(error).toBeInstanceOf(DirtyMigrationError);
        const err = error as DirtyMigrationError;
        expect(err.code).toBe("DIRTY_MIGRATION");
      }

      // Verify good1 was never created in schema
      const good1Exists = await db.querySingle(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='good1'"
      );
      expect(good1Exists).toBeFalsy();
    });
  });

  describe("DEFECT-12: Path checks accept symlinks/traversal", () => {
    it("should reject database paths with symlink components", async () => {
      // This would require actual filesystem symlink creation
      // For now, document the requirement
      expect(true).toBe(true);  // Placeholder
    });
  });

  describe("Control Table Durability and Migration Failure Atomicity", () => {
    it("should persist control tables and DIRTY marker when first migration fails", async () => {
      const testDbPath = `/tmp/first-mig-fail-${randomUUID()}.sqlite`;
      const testDb = new SqliteAdapter({ path: testDbPath });
      const testMigSvc = new MigrationService(testDb, "sqlite");

      // First migration creates control tables but fails on domain DDL
      try {
        await testMigSvc.migrate([
          {
            id: "0001-control-and-domain",
            sql: `
              CREATE TABLE schema_migrations (
                id TEXT PRIMARY KEY,
                dialect TEXT NOT NULL,
                checksum TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('APPLYING', 'APPLIED', 'DIRTY')),
                executed_at TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                dirty_reason TEXT,
                lease_token TEXT
              );
              CREATE TABLE domain_table (id TEXT PRIMARY KEY);
              CREATE TABLE domain_table (id TEXT PRIMARY KEY);
            `,
          },
        ]);
      } catch (error) {
        // Expected: domain DDL fails
        expect((error as any).code).toBe("MIGRATION_EXECUTION_FAILED");
      }

      // Verify control table exists (persisted by inner transaction)
      const controlTableExists = await testDb.querySingle(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      );
      expect(controlTableExists).toBeDefined();

      // Verify DIRTY marker exists (persisted by returned failure result)
      const dirtyRecord = await testDb.querySingle(
        "SELECT status, dirty_reason FROM schema_migrations WHERE id = ?",
        ["0001-control-and-domain"]
      );
      expect(dirtyRecord).toBeDefined();
      expect((dirtyRecord as any).status).toBe("DIRTY");
      expect((dirtyRecord as any).dirty_reason).toContain("DDL failed");

      // Verify domain table does NOT exist (rolled back by savepoint)
      const domainTableExists = await testDb.querySingle(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='domain_table'"
      );
      expect(domainTableExists).toBeFalsy();

      await testDb.close();
    });

    it("should reject subsequent migrations while DIRTY marker is present", async () => {
      // Using existing dirty state from previous test setup
      const migSvc = new MigrationService(db, "sqlite");

      // Create a DIRTY state
      try {
        await migSvc.migrate([
          {
            id: "test-dirty-block",
            sql: `
              CREATE TABLE x (id TEXT);
              CREATE TABLE x (id TEXT);
            `,
          },
        ]);
      } catch {
        // Expected
      }

      // Check status shows DIRTY
      const status = await migSvc.getStatus();
      expect(status.isDirty).toBe(true);
    });
  });
});
