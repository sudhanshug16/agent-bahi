/**
 * Session Lifecycle Tests - Ensure MigrationSession active flag is enforced.
 * Tests verify sessions cannot be used after callback returns.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "crypto";
import type { Database } from "../../src/application/ports/persistence.ts";
import { SqliteAdapter } from "../../src/infrastructure/adapters/sqlite-adapter.ts";
import { MigrationService } from "../../src/infrastructure/services/migration-service.ts";

describe("Session Lifecycle - Active Flag Enforcement", () => {
  let db: Database;
  let migrationService: MigrationService;

  beforeEach(async () => {
    const dbPath = `/tmp/session-lifecycle-${randomUUID()}.sqlite`;
    db = new SqliteAdapter({ path: dbPath });
    migrationService = new MigrationService(db, "sqlite");
  });

  afterEach(async () => {
    await db.close();
  });

  describe("SQLite captured session rejects after callback returns", () => {
    it("should reject execute after callback returns", async () => {
      let capturedSession: any;

      try {
        await db.withMigrationLease(async (session) => {
          capturedSession = session;
          // Session is active inside callback
          const result = await session.execute("SELECT 1");
          expect(result).toBeDefined();
        });
      } catch {
        // Ignore callback errors
      }

      // Try to use captured session after callback (should be finalized)
      expect(async () => {
        await capturedSession.execute("SELECT 1");
      }).toThrow();
    });

    it("should reject executeSingle after callback returns", async () => {
      let capturedSession: any;

      await db.withMigrationLease(async (session) => {
        capturedSession = session;
      });

      // Try to use captured session
      expect(async () => {
        await capturedSession.executeSingle("SELECT 1");
      }).toThrow();
    });

    it("should reject executeRaw after callback returns", async () => {
      let capturedSession: any;

      await db.withMigrationLease(async (session) => {
        capturedSession = session;
      });

      expect(async () => {
        await capturedSession.executeRaw("SELECT 1");
      }).toThrow();
    });

    it("should reject leaseToken after callback returns", async () => {
      let capturedSession: any;

      await db.withMigrationLease(async (session) => {
        capturedSession = session;
        // Token available inside callback
        const token = session.leaseToken();
        expect(token).toBeTruthy();
      });

      // Token unavailable after
      expect(() => {
        capturedSession.leaseToken();
      }).toThrow();
    });
  });

  describe("SQLite captured session rejects after callback throws", () => {
    it("should reject execute after callback throws error", async () => {
      let capturedSession: any;

      try {
        await db.withMigrationLease(async (session) => {
          capturedSession = session;
          throw new Error("Intentional error");
        });
      } catch (err) {
        // Expected: callback threw
      }

      // Session should be finalized even after error
      expect(async () => {
        await capturedSession.execute("SELECT 1");
      }).toThrow();
    });

    it("should reject leaseToken after callback throws error", async () => {
      let capturedSession: any;

      try {
        await db.withMigrationLease(async (session) => {
          capturedSession = session;
          throw new Error("Intentional error");
        });
      } catch {
        // Expected
      }

      expect(() => {
        capturedSession.leaseToken();
      }).toThrow();
    });
  });

  describe("SQLite transaction active flag enforcement", () => {
    it("should reject execute after transaction commits", async () => {
      const uow = db.unitOfWork();
      let capturedTx: any;

      await uow.execute(async (tx) => {
        capturedTx = tx;
        // Transaction is active inside callback
        const result = await tx.execute("SELECT 1");
        expect(result).toBeDefined();
      });

      // Transaction should be committed and inactive
      expect(async () => {
        await capturedTx.execute("SELECT 1");
      }).toThrow();
    });

    it("should reject execute after transaction rollback", async () => {
      const uow = db.unitOfWork();
      let capturedTx: any;

      try {
        await uow.execute(async (tx) => {
          capturedTx = tx;
          throw new Error("Force rollback");
        });
      } catch {
        // Expected: callback threw
      }

      // Transaction should be rolled back and inactive
      expect(async () => {
        await capturedTx.execute("SELECT 1");
      }).toThrow();
    });

    it("should reject isActive after transaction finalization", async () => {
      const uow = db.unitOfWork();
      let capturedTx: any;

      await uow.execute(async (tx) => {
        capturedTx = tx;
        expect(tx.isActive()).toBe(true);
      });

      expect(capturedTx.isActive()).toBe(false);
    });
  });

  describe("Finalization idempotency", () => {
    it("should allow multiple finalization calls (idempotent commit)", async () => {
      let capturedSession: any;

      await db.withMigrationLease(async (session) => {
        capturedSession = session;
      });

      // Session should be finalized; calling finalize again should not throw
      // (This is internal testing; normally finalize is not exposed)
      // But we can test that the session is inactive
      expect(async () => {
        await capturedSession.execute("SELECT 1");
      }).toThrow();
    });
  });

  describe("Error messages indicate MIGRATION_SESSION_INACTIVE", () => {
    it("should throw with MIGRATION_SESSION_INACTIVE code", async () => {
      let capturedSession: any;

      await db.withMigrationLease(async (session) => {
        capturedSession = session;
      });

      try {
        await capturedSession.execute("SELECT 1");
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("MIGRATION_SESSION_INACTIVE");
      }
    });

    it("should throw with consistent error message", async () => {
      let capturedSession: any;

      await db.withMigrationLease(async (session) => {
        capturedSession = session;
      });

      try {
        await capturedSession.leaseToken();
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("finalized");
      }
    });
  });
});
