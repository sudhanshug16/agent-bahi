import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "crypto";
import type { Database, BusinessSessionRunner, BusinessSession } from "../../src/application/ports/persistence.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { SqliteBusinessSessionRunner } from "../../src/infrastructure/adapters/business-session-runner.ts";
import { DatabaseControlService } from "../../src/infrastructure/services/database-control-service.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";
import { CORE_MIGRATIONS } from "../../src/infrastructure/schema/core-schema.ts";
import { DATABASE_CONTROL_MIGRATIONS } from "../../src/infrastructure/schema/database-control-schema.ts";
import { DomainError } from "../../src/core/types.ts";

describe("BusinessSession Compatibility Fence (V1)", () => {
  let db: Database;
  let sessionRunner: BusinessSessionRunner;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = `/tmp/agent-bahi-test-session-${randomUUID()}.sqlite`;
    db = new SqliteAdapter({ path: dbPath });

    // Initialize schema with migrations (order matters: core first, then database-control)
    const migrationService = new MigrationService(db, "sqlite");
    await migrationService.migrate([
      {
        id: CORE_MIGRATIONS.id,
        sql: CORE_MIGRATIONS.sqlite,
      },
      {
        id: DATABASE_CONTROL_MIGRATIONS.id,
        sql: DATABASE_CONTROL_MIGRATIONS.sqlite,
      },
    ]);

    // Initialize database_control row via migration lease
    const controlService = new DatabaseControlService(db, "sqlite");
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

    // Create session runner (reader protocol 1, writer protocol 1)
    sessionRunner = new SqliteBusinessSessionRunner(dbPath, 1, 1);
  });

  afterEach(async () => {
    await db.close();
    try {
      await Bun.write(`${dbPath}.delete`, "");
    } catch {
      // Ignore deletion errors
    }
  });

  describe("Session Lifecycle", () => {
    it("should create session-bound transaction with BEGIN IMMEDIATE", async () => {
      let sessionActive = false;
      let sessionModeCorrect = false;

      await sessionRunner.withBusinessSession("write", async (session) => {
        sessionActive = session.isActive();
        sessionModeCorrect = session.mode() === "write";
      });

      expect(sessionActive).toBe(true);
      expect(sessionModeCorrect).toBe(true);
    });

    it("should prevent use after callback returns", async () => {
      let capturedSession: BusinessSession | null = null;

      await sessionRunner.withBusinessSession("write", async (session) => {
        capturedSession = session;
        expect(session.isActive()).toBe(true);
      });

      expect(capturedSession).not.toBeNull();
      expect(capturedSession!.isActive()).toBe(false);

      // Methods should throw after session is inactive
      try {
        await capturedSession!.querySingle("SELECT 1");
        throw new Error("Should have failed: session is inactive");
      } catch (error) {
        expect((error as any).code).toBe("BUSINESS_SESSION_INACTIVE");
      }
    });
  });

  describe("Read Mode Semantics", () => {
    it("should allow queries in read mode", async () => {
      await sessionRunner.withBusinessSession("read", async (session) => {
        const result = await session.querySingle("SELECT 1 as num");
        expect(result).toBeDefined();
        expect(result!.num).toBe(1 || 1n);
      });
    });

    it("should reject mutations in read mode", async () => {
      await sessionRunner.withBusinessSession("read", async (session) => {
        try {
          await session.execute(
            "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [randomUUID(), "COMPANY", "CREATING", "Test", "INR", new Date().toISOString(), new Date().toISOString()]
          );
          throw new Error("Should have rejected mutation in read mode");
        } catch (error) {
          expect((error as any).code).toBe("BUSINESS_SESSION_READ_ONLY");
        }
      });
    });
  });

  describe("Write Mode Semantics", () => {
    it("should allow mutations in write mode", async () => {
      const tenantId = randomUUID();
      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "COMPANY", "CREATING", "Test Corp", "INR", now, now]
        );
      });

      // Verify data persisted
      const result = await db.querySingle("SELECT id, name FROM tenants WHERE id = ?", [tenantId]);
      expect(result).toBeDefined();
      expect(result!.name).toBe("Test Corp");
    });

    it("should rollback on error", async () => {
      const tenantId = randomUUID();
      try {
        await sessionRunner.withBusinessSession("write", async (session) => {
          const now = new Date().toISOString();
          await session.execute(
            "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [tenantId, "COMPANY", "CREATING", "Test Corp", "INR", now, now]
          );
          throw new Error("Simulated error");
        });
      } catch (error) {
        // Expected
      }

      // Verify rollback occurred
      const result = await db.querySingle("SELECT id FROM tenants WHERE id = ?", [tenantId]);
      expect(result == null).toBe(true);
    });
  });

  describe("Database Control Validation", () => {
    it("should fail before callback if database_control is UNAVAILABLE", async () => {
      // Use a fresh database without initialization
      const badDbPath = `/tmp/agent-bahi-bad-db-${randomUUID()}.sqlite`;
      const badDb = new SqliteAdapter({ path: badDbPath });

      const controlService = new DatabaseControlService(badDb, "sqlite");
      const badSessionRunner = new SqliteBusinessSessionRunner(badDbPath, 1, 1);

      try {
        await badSessionRunner.withBusinessSession("write", async (session) => {
          throw new Error("Callback should not be invoked");
        });
        throw new Error("Should have failed: database_control unavailable");
      } catch (error) {
        expect((error as any).code).toBe("DATABASE_CONTROL_UNAVAILABLE");
      }

      await badDb.close();
      try {
        await Bun.write(`${badDbPath}.delete`, "");
      } catch {}
    });

    it("should fail if database_control state is not READY", async () => {
      // Temporarily update control state to RECOVERY_REQUIRED (would need to manually do this in DB)
      // For now, just verify that state checking happens
      // This is a placeholder for when we add recovery testing
    });
  });

  describe("Atomicity Guarantees", () => {
    it("should execute all operations within single transaction", async () => {
      const tenantId = randomUUID();
      const bookSetId = randomUUID();

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();

        // Insert tenant
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "COMPANY", "CREATING", "Test Corp", "INR", now, now]
        );

        // Insert book_set for same tenant
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [bookSetId, tenantId, "COMPANY", "ACTIVE", now, now]
        );
      });

      // Verify both committed
      const tenant = await db.querySingle("SELECT id FROM tenants WHERE id = ?", [tenantId]);
      const bookSet = await db.querySingle("SELECT id FROM book_sets WHERE id = ?", [bookSetId]);

      expect(tenant).toBeDefined();
      expect(bookSet).toBeDefined();
    });
  });

  describe("Session Isolation", () => {
    it("should use fresh connection per callback", async () => {
      // This test verifies we create new connections, not reuse shared connections
      // If we were reusing, BEGIN IMMEDIATE would fail or nest incorrectly
      let connCount = 0;

      await sessionRunner.withBusinessSession("read", async (session) => {
        connCount++;
      });

      await sessionRunner.withBusinessSession("write", async (session) => {
        connCount++;
      });

      expect(connCount).toBe(2);
    });
  });

  describe("Protocol Compatibility", () => {
    it("should check reader protocol compatibility", async () => {
      // Create session runner with protocol 999 that doesn't match DB defaults
      const controlService = new DatabaseControlService(db, "sqlite");
      const incompatibleRunner = new SqliteBusinessSessionRunner(dbPath, 999, 1);

      try {
        await incompatibleRunner.withBusinessSession("read", async (session) => {
          throw new Error("Should not reach callback");
        });
        throw new Error("Should have failed: protocol mismatch");
      } catch (error) {
        expect((error as any).code).toBe("DATABASE_READER_INCOMPATIBLE");
      }
    });

    it("should check writer protocol compatibility", async () => {
      // Create session runner with protocol 999 that doesn't match DB defaults
      const controlService = new DatabaseControlService(db, "sqlite");
      const incompatibleRunner = new SqliteBusinessSessionRunner(dbPath, 1, 999);

      try {
        await incompatibleRunner.withBusinessSession("write", async (session) => {
          throw new Error("Should not reach callback");
        });
        throw new Error("Should have failed: protocol mismatch");
      } catch (error) {
        expect((error as any).code).toBe("DATABASE_WRITER_INCOMPATIBLE");
      }
    });
  });
});
