import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "crypto";
import type { Database, BusinessSessionRunner } from "../../src/application/ports/persistence.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { BusinessSessionFactory } from "../../src/infrastructure/adapters/business-session-factory.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { CompatibilityService } from "../../src/infrastructure/services/compatibility-service.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import { TenantService } from "../../src/application/services/tenant-service.ts";
import { BookSetService } from "../../src/application/services/book-set-service.ts";
import { AccountService } from "../../src/application/services/account-service.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_MIGRATIONS } from "../../src/infrastructure/schema/database-control-schema.ts";
import { V2_SCHEMA_MANIFEST, CURRENT_SCHEMA_MANIFEST } from "../../src/infrastructure/schema/current-manifest.ts";
import { BOOKSET_V3_MIGRATION } from "../../src/infrastructure/schema/bookset-v3-migration.ts";
import { brandTenantId, brandBookSetId, brandAccountId, currentTimestamp } from "../../src/core/types.ts";

describe("Phase 1A: Production Persistence Foundation", () => {
  let db: Database;
  let sessionRunner: BusinessSessionRunner;
  let migrationService: MigrationService;
  let compatibilityService: CompatibilityService;
  let tenantService: TenantService;
  let bookSetService: BookSetService;
  let accountService: AccountService;
  let dbPath: string;

  beforeEach(async () => {
    // Create ephemeral test database
    dbPath = `/tmp/agent-bahi-test-${randomUUID()}.sqlite`;

    db = new SqliteAdapter({ path: dbPath });
    migrationService = new MigrationService(db, "sqlite");
    compatibilityService = new CompatibilityService(db, "sqlite");

    // Initialize database schema (order matters: core first, then database-control, then bookset-v3)
    await migrationService.migrate([
      {
        id: CORE_MIGRATIONS.id,
        sql: CORE_MIGRATIONS.sqlite,
      },
      {
        id: DATABASE_CONTROL_MIGRATIONS.id,
        sql: DATABASE_CONTROL_MIGRATIONS.sqlite,
      },
      {
        id: BOOKSET_V3_MIGRATION.id,
        sql: BOOKSET_V3_MIGRATION.sqlite,
      },
    ]);

    // Initialize database_control row via migration lease (v3 manifest)
    const controlService = new DatabaseControlService(db, "sqlite", CURRENT_SCHEMA_MANIFEST);
    await db.withMigrationLease(async (session) => {
      return await controlService.initialize(
        {
          cliVersion: "0.0.0-test",
          buildId: "test-build",
          now: new Date(),
        },
        session
      );
    });

    // Now create the session runner (database is v3)
    sessionRunner = BusinessSessionFactory.createSessionRunner(dbPath, "sqlite", 1, 1, CURRENT_SCHEMA_MANIFEST);
    tenantService = new TenantService(sessionRunner);
    bookSetService = new BookSetService(sessionRunner);
    accountService = new AccountService(sessionRunner);

    await compatibilityService.initializeDefaults();
  });

  afterEach(async () => {
    await db.close();
    // Clean up test database file
    try {
      for (const suffix of ["", "-wal", "-shm"]) await Bun.file(`${dbPath}${suffix}`).delete();
    } catch {
      // Ignore deletion errors
    }
  });

  describe("Database Initialization", () => {
    it("should create schema tables", async () => {
      const result = await db.query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
      const tableNames = (result.rows as Array<any>).map((r) => r.name);

      expect(tableNames).toContain("tenants");
      expect(tableNames).toContain("book_sets");
      expect(tableNames).toContain("accounts");
      expect(tableNames).toContain("legal_identities");
      expect(tableNames).toContain("gst_registrations");
      expect(tableNames).toContain("evidence");
      expect(tableNames).toContain("audit_records");
      expect(tableNames).toContain("idempotency_records");
      expect(tableNames).toContain("schema_migrations");
      expect(tableNames).toContain("compatibility_matrix");
    });

    it("should enable foreign key constraints", async () => {
      const result = await db.querySingle("PRAGMA foreign_keys");
      const fkValue = (result as any).foreign_keys;
      expect(fkValue === 1 || fkValue === 1n).toBe(true);
    });

    it("should enable WAL mode", async () => {
      const result = await db.querySingle("PRAGMA journal_mode");
      expect(String((result as any).journal_mode).toLowerCase()).toBe("wal");
    });
  });

  describe("Tenant Creation (Atomic Bootstrap)", () => {
    it("should create COMPANY tenant with COMPANY BookSet", async () => {
      const { tenant, defaultBookSet } = await tenantService.createTenantWithDefaultBookSet(
        "COMPANY",
        "Acme Corp",
        "INR",
      );

      expect(tenant.kind).toBe("COMPANY");
      expect(tenant.name).toBe("Acme Corp");
      expect(tenant.lifecycle).toBe("CREATING");
      expect(defaultBookSet.kind).toBe("COMPANY");
      expect(defaultBookSet.lifecycle).toBe("ACTIVE");
      expect(tenant.defaultBookSetId).toBe(defaultBookSet.id);
    });

    it("should create INDIVIDUAL tenant with PERSONAL BookSet", async () => {
      const { tenant, defaultBookSet } = await tenantService.createTenantWithDefaultBookSet(
        "INDIVIDUAL",
        "John Doe",
        "INR",
      );

      expect(tenant.kind).toBe("INDIVIDUAL");
      expect(defaultBookSet.kind).toBe("PERSONAL");
      expect(tenant.defaultBookSetId).toBe(defaultBookSet.id);
    });

    it("should make tenant activation explicit (CREATING -> ACTIVE)", async () => {
      const { tenant: createdTenant } = await tenantService.createTenantWithDefaultBookSet(
        "COMPANY",
        "Test Co",
      );

      expect(createdTenant.lifecycle).toBe("CREATING");

      const activated = await tenantService.activateTenant(createdTenant.id);
      expect(activated.lifecycle).toBe("ACTIVE");

      // Verify state persisted
      const fetched = await tenantService.getTenant(createdTenant.id);
      expect(fetched.lifecycle).toBe("ACTIVE");
    });

    it("should rollback on a real invalid-parent failure", async () => {
      const tenantId = brandTenantId(randomUUID());
      const invalidBookSetId = brandBookSetId(randomUUID());

      await expect(
        sessionRunner.withBusinessSession("write", async (session) => {
          const now = new Date().toISOString();
          await session.execute(
            "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [tenantId, "COMPANY", "CREATING", "Rollback Corp", "INR", now, now],
          );
          await session.execute(
            "UPDATE tenants SET default_book_set_id = ? WHERE id = ?",
            [invalidBookSetId, tenantId],
          );
        }),
      ).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT" });

      expect(await db.querySingle("SELECT id FROM tenants WHERE id = ?", [tenantId])).toBeNull();
    });
  });

  describe("BookSet Cardinality and Isolation", () => {
    it("should enforce one COMPANY BookSet per COMPANY tenant", async () => {
      const { tenant } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Test Corp");
      const defaultBookSet = await bookSetService.getDefault(tenant.id);

      expect(defaultBookSet.kind).toBe("COMPANY");

      // Try to create another COMPANY BookSet (should fail due to UNIQUE constraint)
      try {
        await bookSetService.create({
          id: brandBookSetId(randomUUID()),
          tenantId: tenant.id,
          kind: "COMPANY",
          displayName: "Company 2",
          lifecycle: "ACTIVE",
          createdAt: currentTimestamp(),
          updatedAt: currentTimestamp(),
        });
        throw new Error("Should have failed");
      } catch (error) {
        expect((error as any).message).toContain("UNIQUE");
      }
    });

    it("should enforce one PERSONAL BookSet per INDIVIDUAL tenant", async () => {
      const { tenant } = await tenantService.createTenantWithDefaultBookSet("INDIVIDUAL", "John Doe");
      const defaultBookSet = await bookSetService.getDefault(tenant.id);

      expect(defaultBookSet.kind).toBe("PERSONAL");

      // Try to create another PERSONAL BookSet (should fail)
      try {
        await bookSetService.create({
          id: brandBookSetId(randomUUID()),
          tenantId: tenant.id,
          kind: "PERSONAL",
          displayName: "Personal 2",
          lifecycle: "ACTIVE",
          createdAt: currentTimestamp(),
          updatedAt: currentTimestamp(),
        });
        throw new Error("Should have failed");
      } catch (error) {
        expect((error as any).message).toContain("UNIQUE");
      }
    });

    it("should allow creating PROPRIETORSHIP BookSet for INDIVIDUAL tenant", async () => {
      const { tenant } = await tenantService.createTenantWithDefaultBookSet("INDIVIDUAL", "John Doe");

      // Create PROPRIETORSHIP
      const propId = brandBookSetId(randomUUID());
      await bookSetService.create({
        id: propId,
        tenantId: tenant.id,
        kind: "PROPRIETORSHIP",
        displayName: "Proprietorship 1",
        lifecycle: "ACTIVE",
        createdAt: currentTimestamp(),
        updatedAt: currentTimestamp(),
      });

      // Verify exists
      const bookSets = await bookSetService.listByTenant(tenant.id);
      const hasProp = bookSets.some((bs) => bs.kind === "PROPRIETORSHIP");
      expect(hasProp).toBe(true);
    });

    it("should prevent archiving default BookSet", async () => {
      const { tenant, defaultBookSet } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Test");

      try {
        await bookSetService.archive(defaultBookSet.id, tenant.id);
        throw new Error("Should have failed");
      } catch (error) {
        expect((error as any).code).toBe("CANNOT_ARCHIVE_DEFAULT_BOOK_SET");
      }
    });
  });

  describe("Account Scope and Code Uniqueness", () => {
    it("should enforce account code uniqueness within BookSet scope", async () => {
      const { tenant, defaultBookSet } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Test");

      const account1 = {
        id: brandAccountId(randomUUID()),
        tenantId: tenant.id,
        bookSetId: defaultBookSet.id,
        code: "1000",
        name: "Cash",
        accountType: "asset",
        createdAt: currentTimestamp(),
        updatedAt: currentTimestamp(),
      };

      await accountService.create(account1);

      // Try to create another account with same code in same BookSet (should fail)
      try {
        await accountService.create({
          ...account1,
          id: brandAccountId(randomUUID()),
          name: "Bank",
        });
        throw new Error("Should have failed");
      } catch (error) {
        expect((error as any).code).toBe("ACCOUNT_CODE_ALREADY_EXISTS");
      }
    });

    it("should allow same account code in different BookSets", async () => {
      const { tenant } = await tenantService.createTenantWithDefaultBookSet("INDIVIDUAL", "John Doe");

      // Create second BookSet (PROPRIETORSHIP)
      const prop1 = {
        id: brandBookSetId(randomUUID()),
        tenantId: tenant.id,
        kind: "PROPRIETORSHIP" as const,
        displayName: "Proprietorship 1",
        lifecycle: "ACTIVE" as const,
        createdAt: currentTimestamp(),
        updatedAt: currentTimestamp(),
      };
      await bookSetService.create(prop1);

      const defaultBookSet = await bookSetService.getDefault(tenant.id);

      // Create account in personal BookSet
      const personal = {
        id: brandAccountId(randomUUID()),
        tenantId: tenant.id,
        bookSetId: defaultBookSet.id,
        code: "1000",
        name: "Cash (Personal)",
        accountType: "asset",
        createdAt: currentTimestamp(),
        updatedAt: currentTimestamp(),
      };
      await accountService.create(personal);

      // Create account with same code in proprietorship BookSet (should succeed)
      const prop = {
        id: brandAccountId(randomUUID()),
        tenantId: tenant.id,
        bookSetId: prop1.id,
        code: "1000",
        name: "Cash (Business)",
        accountType: "asset",
        createdAt: currentTimestamp(),
        updatedAt: currentTimestamp(),
      };
      await accountService.create(prop);

      // Verify both exist
      expect(await accountService.getByCode("1000", tenant.id, defaultBookSet.id)).toBeDefined();
      expect(await accountService.getByCode("1000", tenant.id, prop1.id)).toBeDefined();
    });

    it("should never reuse account code within scope", async () => {
      const { tenant, defaultBookSet } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Test");

      const account1 = {
        id: brandAccountId(randomUUID()),
        tenantId: tenant.id,
        bookSetId: defaultBookSet.id,
        code: "1000",
        name: "Cash",
        accountType: "asset",
        createdAt: currentTimestamp(),
        updatedAt: currentTimestamp(),
      };
      await accountService.create(account1);

      // Delete (conceptually mark as archived) and try to reuse code
      // Note: actual deletion not implemented in this phase, so just verify code is locked

      try {
        await accountService.create({
          id: brandAccountId(randomUUID()),
          tenantId: tenant.id,
          bookSetId: defaultBookSet.id,
          code: "1000",
          name: "Bank",
          accountType: "asset",
          createdAt: currentTimestamp(),
          updatedAt: currentTimestamp(),
        });
        throw new Error("Should have failed");
      } catch (error) {
        expect((error as any).code).toBe("ACCOUNT_CODE_ALREADY_EXISTS");
      }
    });
  });

  describe("Cross-Tenant Isolation", () => {
    it("should reject cross-tenant account access", async () => {
      const { tenant: tenant1 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Corp 1");
      const { tenant: tenant2 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Corp 2");

      const bookSet1 = await bookSetService.getDefault(tenant1.id);
      const bookSet2 = await bookSetService.getDefault(tenant2.id);

      const account1 = {
        id: brandAccountId(randomUUID()),
        tenantId: tenant1.id,
        bookSetId: bookSet1.id,
        code: "1000",
        name: "Cash",
        accountType: "asset",
        createdAt: currentTimestamp(),
        updatedAt: currentTimestamp(),
      };
      await accountService.create(account1);

      // Try to access account1 from tenant2 (should fail with NOT_FOUND since it doesn't exist in their context)
      try {
        await accountService.getById(account1.id, tenant2.id, bookSet2.id);
        throw new Error("Should have failed");
      } catch (error) {
        // NOT_FOUND is acceptable - the account doesn't exist in tenant2's scope
        expect(["ACCOUNT_NOT_FOUND", "CROSS_TENANT_VIOLATION"]).toContain((error as any).code);
      }
    });

    it("should reject cross-tenant BookSet access", async () => {
      const { tenant: tenant1 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Corp 1");
      const { tenant: tenant2 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Corp 2");

      const bookSet1 = await bookSetService.getDefault(tenant1.id);

      // Try to access bookSet1 from tenant2 (should fail with NOT_FOUND)
      try {
        await bookSetService.getById(bookSet1.id, tenant2.id);
        throw new Error("Should have failed");
      } catch (error) {
        // NOT_FOUND is acceptable - the BookSet doesn't exist in tenant2's scope
        expect(["BOOK_SET_NOT_FOUND", "CROSS_TENANT_VIOLATION"]).toContain((error as any).code);
      }
    });
  });

  describe("Compatibility Service", () => {
    it("should initialize default compatibility matrix", async () => {
      const compat = await compatibilityService.checkCompatibility("0.0.0-gate0");
      expect(compat.compatible).toBe(true);
      expect(compat.cliVersion).toBe("0.0.0-gate0");
    });

    it("should fail for incompatible CLI version", async () => {
      try {
        await compatibilityService.checkCompatibility("999.0.0");
        throw new Error("Should have failed");
      } catch (error) {
        expect((error as any).code).toBe("INCOMPATIBLE_DATABASE");
      }
    });

    it("should gate read-only mode for Gate0", async () => {
      const compat = await compatibilityService.checkCompatibility("0.0.0-gate0");
      expect(compat.message).toContain("Read-only");
    });
  });

  describe("Migration Service", () => {
    it("should track applied migrations", async () => {
      const status = await migrationService.getStatus();
      expect(status.hasSchema).toBe(true);
      expect(status.appliedMigrations.length).toBeGreaterThan(0);
      expect(status.appliedMigrations[0].id).toBe("0001-core-schema");
    });

    it("should verify migration checksums", async () => {
      const migrations = await migrationService.getStatus();
      const first = migrations.appliedMigrations[0];

      // Verifying with correct checksum should pass
      await migrationService.verifyChecksum(first.id, first.checksum);

      // Verify with wrong checksum should fail
      try {
        await migrationService.verifyChecksum(first.id, "wrongchecksum");
        throw new Error("Should have failed");
      } catch (error) {
        expect((error as any).code).toBe("MIGRATION_CHECKSUM_MISMATCH");
      }
    });

    it("should enforce callback-only withMigrationLease pattern", async () => {
      // Verify migrate() acquires lease internally
      const applied = await migrationService.migrate([
        {
          id: "test-lease-pattern",
          sql: "CREATE TABLE test_lease (id TEXT PRIMARY KEY)",
        },
      ]);

      // Should have applied the migration
      expect(applied.length).toBeGreaterThan(0);
      expect(applied[0].id).toBe("test-lease-pattern");

      // Verify the migration is recorded
      const record = await db.querySingle(
        "SELECT status FROM schema_migrations WHERE id = ?",
        ["test-lease-pattern"]
      );
      expect((record as any).status).toBe("APPLIED");
    });
  });

  describe("Tenant Service", () => {
    it("should list only active tenants", async () => {
      const { tenant: t1 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Corp 1");
      const { tenant: t2 } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Corp 2");

      // Both are CREATING, not ACTIVE yet
      let activeTenants = await tenantService.listActiveTenants();
      expect(activeTenants.length).toBe(0);

      // Activate t1
      await tenantService.activateTenant(t1.id);
      activeTenants = await tenantService.listActiveTenants();
      expect(activeTenants.length).toBe(1);
      expect(activeTenants[0].id).toBe(t1.id);
    });

    it("should return tenant by ID", async () => {
      const { tenant } = await tenantService.createTenantWithDefaultBookSet("COMPANY", "Test Corp");
      const fetched = await tenantService.getTenant(tenant.id);

      expect(fetched.id).toBe(tenant.id);
      expect(fetched.name).toBe("Test Corp");
    });
  });
});
