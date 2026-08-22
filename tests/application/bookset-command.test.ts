/**
 * Comprehensive tests for BookSet command service with idempotency and audit.
 * Tests cover success, replay, corruption, cross-tenant isolation, failure injection.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database as BunDatabase } from "bun:sqlite";
import type { BusinessSessionRunner, BusinessSession } from "../../src/application/ports/persistence.ts";
import {
  executeBookSetCreate,
  executeBookSetSetDefault,
  executeBookSetArchive,
  executeTenantActivate,
  type BookSetCreateResult,
  type BookSetSetDefaultResult,
  type BookSetArchiveResult,
  type TenantActivateResult,
} from "../../src/application/services/bookset-command-service.ts";
import type { CommandEnvelope, BookSetCreatePayload, BookSetSetDefaultPayload, BookSetArchivePayload, TenantActivatePayload } from "../../src/application/commands.ts";
import {
  canonicalJson,
  computeResultHash,
} from "../../src/application/commands.ts";
import { brandTenantId, brandBookSetId, IdempotencyConflictError, IdempotencyCorruptError, DomainError } from "../../src/core/types.ts";
import { initializeTestDatabase, createTestSessionRunner } from "../fixtures/database-fixture.ts";

describe("BookSet command service", () => {
  let db: BunDatabase;
  let sessionRunner: BusinessSessionRunner;

  beforeEach(async () => {
    db = await initializeTestDatabase();
    sessionRunner = createTestSessionRunner(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("bookset.create", () => {
    it("creates a BookSet and records audit + idempotency", async () => {
      const tenantId = brandTenantId("test-tenant-1");
      const requestId = "req-create-1";

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "My Personal" };
      const envelope: CommandEnvelope<BookSetCreatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId,
        actor: { kind: "HUMAN", id: "user-1" },
        source: "CLI",
        reason: "test create",
        payload,
      };

      const result = await executeBookSetCreate(sessionRunner, envelope);

      expect(result.replayed).toBeUndefined();
      const resultData = JSON.parse(result.resultJson) as BookSetCreateResult;
      expect(resultData.kind).toBe("PERSONAL");
      expect(resultData.displayName).toBe("My Personal");
      expect(resultData.lifecycle).toBe("ACTIVE");

      // Verify audit record
      const audit = await sessionRunner.withBusinessSession("read", async (session) => {
        return session.querySingle(
          "SELECT * FROM audit_records WHERE tenant_id = ? AND request_id = ?",
          [tenantId, requestId],
        );
      });
      expect(audit).toBeDefined();
      expect(audit?.command).toBe("bookset.create");
      expect(audit?.action).toBe("bookset.create");
      expect(audit?.actor_type).toBe("HUMAN");
      expect(audit?.source).toBe("CLI");
      expect(audit?.reason).toBe("test create");

      // Verify idempotency record
      const idempotency = await sessionRunner.withBusinessSession("read", async (session) => {
        return session.querySingle(
          "SELECT * FROM idempotency_records WHERE tenant_id = ? AND request_id = ?",
          [tenantId, requestId],
        );
      });
      expect(idempotency).toBeDefined();
      expect(idempotency?.result_json).toBe(result.resultJson);
      expect(idempotency?.result_hash).toBe(result.resultHash);
    });

    it("replays identical request with exact byte-equal resultJson", async () => {
      const tenantId = brandTenantId("test-tenant-2");
      const requestId = "req-create-2";

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "My Personal" };
      const envelope: CommandEnvelope<BookSetCreatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId,
        actor: { kind: "HUMAN", id: "user-2" },
        source: "CLI",
        reason: "test create",
        payload,
      };

      const result1 = await executeBookSetCreate(sessionRunner, envelope);
      const result2 = await executeBookSetCreate(sessionRunner, envelope);

      // Second call should be replay
      expect(result2.replayed).toBe(true);
      expect(result2.resultJson).toBe(result1.resultJson);
      expect(result2.resultHash).toBe(result1.resultHash);

      // Should only have one audit record
      const auditCount = await sessionRunner.withBusinessSession("read", async (session) => {
        const result = await session.querySingle(
          "SELECT COUNT(*) as cnt FROM audit_records WHERE tenant_id = ? AND request_id = ?",
          [tenantId, requestId],
        );
        return Number(result?.cnt || 0);
      });
      expect(auditCount).toBe(1);
    });

    it("fails with IDEMPOTENCY_CONFLICT on different request hash", async () => {
      const tenantId = brandTenantId("test-tenant-3");
      const requestId = "req-create-3";

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      const payload1: BookSetCreatePayload = { kind: "PERSONAL", displayName: "My Personal" };
      const envelope1: CommandEnvelope<BookSetCreatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId,
        actor: { kind: "HUMAN", id: "user-3" },
        source: "CLI",
        reason: "test create",
        payload: payload1,
      };

      await executeBookSetCreate(sessionRunner, envelope1);

      const payload2: BookSetCreatePayload = { kind: "PROPRIETORSHIP", displayName: "Business" };
      const envelope2: CommandEnvelope<BookSetCreatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId,
        actor: { kind: "HUMAN", id: "user-3" },
        source: "MCP",
        reason: "different reason",
        payload: payload2,
      };

      try {
        await executeBookSetCreate(sessionRunner, envelope2);
        expect.unreachable("Should throw IdempotencyConflictError");
      } catch (error) {
        expect(error).toBeInstanceOf(IdempotencyConflictError);
      }
    });

    it("prevents creation of multiple COMPANY BookSets for COMPANY tenant", async () => {
      const tenantId = brandTenantId("test-tenant-4");

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "COMPANY", "CREATING", "Test Company", "INR", now, now],
        );
      });

      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "Invalid" };
      const envelope: CommandEnvelope<BookSetCreatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId: "req-1",
        actor: { kind: "SYSTEM", id: "system" },
        source: "INTERNAL",
        reason: "test",
        payload,
      };

      try {
        await executeBookSetCreate(sessionRunner, envelope);
        expect.unreachable("Should throw DomainError");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
      }
    });
  });

  describe("bookset.set-default", () => {
    it("sets default BookSet for tenant", async () => {
      const tenantId = brandTenantId("test-tenant-5");
      const bookSetId = brandBookSetId("bs-1");
      const defaultBookSetId = brandBookSetId("bs-default-1");
      const requestId = "req-set-default-1";

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [defaultBookSetId, tenantId, "PERSONAL", "Default", "ACTIVE", now, now],
        );
        await session.execute(
          "UPDATE tenants SET lifecycle = ?, default_book_set_id = ?, updated_at = ? WHERE id = ?",
          ["ACTIVE", defaultBookSetId, now, tenantId],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [bookSetId, tenantId, "PROPRIETORSHIP", "Business", "ACTIVE", now, now],
        );
      });

      const payload: BookSetSetDefaultPayload = { bookSetId };
      const envelope: CommandEnvelope<BookSetSetDefaultPayload> = {
        schemaVersion: 1,
        tenantId,
        requestId,
        actor: { kind: "HUMAN", id: "user-1" },
        source: "CLI",
        reason: "test set default",
        payload,
      };

      const result = await executeBookSetSetDefault(sessionRunner, envelope);

      expect(result.replayed).toBeUndefined();
      const resultData = JSON.parse(result.resultJson) as BookSetSetDefaultResult;
      expect(resultData.bookSetId).toBe(bookSetId);

      // Verify tenant updated
      const tenant = await sessionRunner.withBusinessSession("read", async (session) => {
        return session.querySingle("SELECT default_book_set_id FROM tenants WHERE id = ?", [tenantId]);
      });
      expect(tenant?.default_book_set_id).toBe(bookSetId);
    });

    it("fails when setting archived BookSet as default", async () => {
      const tenantId = brandTenantId("test-tenant-6");
      const bookSetId = brandBookSetId("bs-2");
      const defaultBookSetId = brandBookSetId("bs-default-2");

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [defaultBookSetId, tenantId, "PERSONAL", "Default", "ACTIVE", now, now],
        );
        await session.execute(
          "UPDATE tenants SET lifecycle = ?, default_book_set_id = ?, updated_at = ? WHERE id = ?",
          ["ACTIVE", defaultBookSetId, now, tenantId],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [bookSetId, tenantId, "PROPRIETORSHIP", "Business", "ARCHIVED", now, now],
        );
      });

      const payload: BookSetSetDefaultPayload = { bookSetId };
      const envelope: CommandEnvelope<BookSetSetDefaultPayload> = {
        schemaVersion: 1,
        tenantId,
        requestId: "req-set-default-2",
        actor: { kind: "HUMAN", id: "user-2" },
        source: "CLI",
        reason: "test",
        payload,
      };

      try {
        await executeBookSetSetDefault(sessionRunner, envelope);
        expect.unreachable("Should throw DomainError");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
      }
    });
  });

  describe("bookset.archive", () => {
    it("archives a BookSet", async () => {
      const tenantId = brandTenantId("test-tenant-7");
      const bookSetId = brandBookSetId("bs-3");
      const defaultBookSetId = brandBookSetId("bs-default-3");
      const requestId = "req-archive-1";

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [defaultBookSetId, tenantId, "PERSONAL", "Default", "ACTIVE", now, now],
        );
        await session.execute(
          "UPDATE tenants SET lifecycle = ?, default_book_set_id = ?, updated_at = ? WHERE id = ?",
          ["ACTIVE", defaultBookSetId, now, tenantId],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [bookSetId, tenantId, "PROPRIETORSHIP", "Business", "ACTIVE", now, now],
        );
      });

      const payload: BookSetArchivePayload = { bookSetId };
      const envelope: CommandEnvelope<BookSetArchivePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId,
        actor: { kind: "HUMAN", id: "user-1" },
        source: "CLI",
        reason: "test archive",
        payload,
      };

      const result = await executeBookSetArchive(sessionRunner, envelope);

      expect(result.replayed).toBeUndefined();
      const resultData = JSON.parse(result.resultJson) as BookSetArchiveResult;
      expect(resultData.bookSetId).toBe(bookSetId);

      // Verify BookSet archived
      const bookSet = await sessionRunner.withBusinessSession("read", async (session) => {
        return session.querySingle("SELECT lifecycle FROM book_sets WHERE id = ?", [bookSetId]);
      });
      expect(bookSet?.lifecycle).toBe("ARCHIVED");
    });

    it("prevents archival of default BookSet", async () => {
      const tenantId = brandTenantId("test-tenant-8");
      const bookSetId = brandBookSetId("bs-4");

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [bookSetId, tenantId, "PERSONAL", "Personal", "ACTIVE", now, now],
        );
        await session.execute(
          "UPDATE tenants SET lifecycle = ?, default_book_set_id = ?, updated_at = ? WHERE id = ?",
          ["ACTIVE", bookSetId, now, tenantId],
        );
      });

      const payload: BookSetArchivePayload = { bookSetId };
      const envelope: CommandEnvelope<BookSetArchivePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId: "req-archive-2",
        actor: { kind: "HUMAN", id: "user-1" },
        source: "CLI",
        reason: "test",
        payload,
      };

      try {
        await executeBookSetArchive(sessionRunner, envelope);
        expect.unreachable("Should throw DomainError");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
      }
    });
  });

  describe("tenant.activate", () => {
    it("activates a CREATING tenant", async () => {
      const tenantId = brandTenantId("test-tenant-9");
      const bookSetId = brandBookSetId("bs-5");
      const requestId = "req-activate-1";

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [bookSetId, tenantId, "PERSONAL", "Personal", "ACTIVE", now, now],
        );
        await session.execute(
          "UPDATE tenants SET default_book_set_id = ?, updated_at = ? WHERE id = ?",
          [bookSetId, now, tenantId],
        );
      });

      const payload: TenantActivatePayload = { defaultBookSetId: bookSetId };
      const envelope: CommandEnvelope<TenantActivatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId,
        actor: { kind: "SYSTEM", id: "system" },
        source: "INTERNAL",
        reason: "test activate",
        payload,
      };

      const result = await executeTenantActivate(sessionRunner, envelope);

      expect(result.replayed).toBeUndefined();
      const resultData = JSON.parse(result.resultJson) as TenantActivateResult;
      expect(resultData.tenantId).toBe(tenantId);

      // Verify tenant activated
      const tenant = await sessionRunner.withBusinessSession("read", async (session) => {
        return session.querySingle("SELECT lifecycle FROM tenants WHERE id = ?", [tenantId]);
      });
      expect(tenant?.lifecycle).toBe("ACTIVE");
    });

    it("fails when activating non-CREATING tenant", async () => {
      const tenantId = brandTenantId("test-tenant-10");
      const bookSetId = brandBookSetId("bs-6");

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [bookSetId, tenantId, "PERSONAL", "Personal", "ACTIVE", now, now],
        );
        await session.execute(
          "UPDATE tenants SET lifecycle = ?, default_book_set_id = ?, updated_at = ? WHERE id = ?",
          ["ACTIVE", bookSetId, now, tenantId],
        );
      });

      const payload: TenantActivatePayload = { defaultBookSetId: bookSetId };
      const envelope: CommandEnvelope<TenantActivatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId: "req-activate-2",
        actor: { kind: "SYSTEM", id: "system" },
        source: "INTERNAL",
        reason: "test",
        payload,
      };

      try {
        await executeTenantActivate(sessionRunner, envelope);
        expect.unreachable("Should throw DomainError");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
      }
    });

    it("fails when asserting wrong default BookSet ID", async () => {
      const tenantId = brandTenantId("test-tenant-11");
      const bookSetId = brandBookSetId("bs-7");
      const wrongBookSetId = brandBookSetId("bs-wrong");

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [bookSetId, tenantId, "PERSONAL", "Personal", "ACTIVE", now, now],
        );
        await session.execute(
          "UPDATE tenants SET default_book_set_id = ?, updated_at = ? WHERE id = ?",
          [bookSetId, now, tenantId],
        );
      });

      const payload: TenantActivatePayload = { defaultBookSetId: wrongBookSetId };
      const envelope: CommandEnvelope<TenantActivatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId: "req-activate-3",
        actor: { kind: "SYSTEM", id: "system" },
        source: "INTERNAL",
        reason: "test",
        payload,
      };

      try {
        await executeTenantActivate(sessionRunner, envelope);
        expect.unreachable("Should throw DomainError");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
      }
    });
  });

  describe("cross-tenant isolation", () => {
    it("prevents accessing BookSet from different tenant", async () => {
      const tenant1 = brandTenantId("tenant-1");
      const tenant2 = brandTenantId("tenant-2");
      const bookSetId = brandBookSetId("bs-cross");
      const bs1Default = brandBookSetId("bs1-default");
      const bs2Default = brandBookSetId("bs2-default");

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        // First insert tenants in CREATING state (no default_book_set_id yet)
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenant1, "INDIVIDUAL", "CREATING", "Tenant 1", "INR", now, now],
        );
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenant2, "INDIVIDUAL", "CREATING", "Tenant 2", "INR", now, now],
        );
        // Now insert book_sets (FKs to tenants are satisfied)
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [bs1Default, tenant1, "PERSONAL", "Default 1", "ACTIVE", now, now],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [bs2Default, tenant2, "PERSONAL", "Default 2", "ACTIVE", now, now],
        );
        await session.execute(
          "INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [bookSetId, tenant1, "PROPRIETORSHIP", "Business", "ACTIVE", now, now],
        );
        // Now update tenants to set lifecycle=ACTIVE and default_book_set_id
        await session.execute(
          "UPDATE tenants SET lifecycle = ?, default_book_set_id = ?, updated_at = ? WHERE id = ?",
          ["ACTIVE", bs1Default, now, tenant1],
        );
        await session.execute(
          "UPDATE tenants SET lifecycle = ?, default_book_set_id = ?, updated_at = ? WHERE id = ?",
          ["ACTIVE", bs2Default, now, tenant2],
        );
      });

      const payload: BookSetArchivePayload = { bookSetId };
      const envelope: CommandEnvelope<BookSetArchivePayload> = {
        schemaVersion: 1,
        tenantId: tenant2,
        requestId: "req-cross",
        actor: { kind: "HUMAN", id: "user" },
        source: "CLI",
        reason: "test",
        payload,
      };

      try {
        await executeBookSetArchive(sessionRunner, envelope);
        expect.unreachable("Should throw DomainError (cross-tenant)");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
      }
    });
  });

  describe("idempotency immutability", () => {
    it("prevents UPDATE of finalized idempotency_records", async () => {
      const tenantId = brandTenantId("test-tenant-12");
      const requestId = "req-immutable-1";

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "Personal" };
      const envelope: CommandEnvelope<BookSetCreatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId,
        actor: { kind: "HUMAN", id: "user" },
        source: "CLI",
        reason: "test",
        payload,
      };

      await executeBookSetCreate(sessionRunner, envelope);

      try {
        await sessionRunner.withBusinessSession("write", async (session) => {
          await session.execute(
            "UPDATE idempotency_records SET result_json = ? WHERE tenant_id = ? AND request_id = ?",
            ['{"invalid": true}', tenantId, requestId],
          );
        });
        expect.unreachable("Should prevent UPDATE on idempotency_records");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it("prevents DELETE of finalized idempotency_records", async () => {
      const tenantId = brandTenantId("test-tenant-13");
      const requestId = "req-immutable-2";

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "Personal" };
      const envelope: CommandEnvelope<BookSetCreatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId,
        actor: { kind: "HUMAN", id: "user" },
        source: "CLI",
        reason: "test",
        payload,
      };

      await executeBookSetCreate(sessionRunner, envelope);

      try {
        await sessionRunner.withBusinessSession("write", async (session) => {
          await session.execute(
            "DELETE FROM idempotency_records WHERE tenant_id = ? AND request_id = ?",
            [tenantId, requestId],
          );
        });
        expect.unreachable("Should prevent DELETE on idempotency_records");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe("audit records immutability", () => {
    it("prevents UPDATE of audit_records", async () => {
      const tenantId = brandTenantId("test-tenant-14");
      const requestId = "req-audit-immutable-1";

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "Personal" };
      const envelope: CommandEnvelope<BookSetCreatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId,
        actor: { kind: "HUMAN", id: "user" },
        source: "CLI",
        reason: "test",
        payload,
      };

      await executeBookSetCreate(sessionRunner, envelope);

      try {
        await sessionRunner.withBusinessSession("write", async (session) => {
          await session.execute(
            "UPDATE audit_records SET reason = ? WHERE tenant_id = ? AND request_id = ?",
            ["modified", tenantId, requestId],
          );
        });
        expect.unreachable("Should prevent UPDATE on audit_records");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it("prevents DELETE of audit_records", async () => {
      const tenantId = brandTenantId("test-tenant-15");
      const requestId = "req-audit-immutable-2";

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "Personal" };
      const envelope: CommandEnvelope<BookSetCreatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId,
        actor: { kind: "HUMAN", id: "user" },
        source: "CLI",
        reason: "test",
        payload,
      };

      await executeBookSetCreate(sessionRunner, envelope);

      try {
        await sessionRunner.withBusinessSession("write", async (session) => {
          await session.execute(
            "DELETE FROM audit_records WHERE tenant_id = ? AND request_id = ?",
            [tenantId, requestId],
          );
        });
        expect.unreachable("Should prevent DELETE on audit_records");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe("canonical JSON serialization", () => {
    it("produces same hash for keys in different order", () => {
      const obj1 = { b: 2, a: 1, c: 3 };
      const obj2 = { a: 1, c: 3, b: 2 };

      const json1 = canonicalJson(obj1);
      const json2 = canonicalJson(obj2);
      const hash1 = computeResultHash(json1);
      const hash2 = computeResultHash(json2);

      expect(json1).toBe(json2);
      expect(hash1).toBe(hash2);
    });

    it("detects metadata differences", () => {
      const obj1 = canonicalJson({ command: "bookset.create", value: 1 });
      const obj2 = canonicalJson({ command: "bookset.archive", value: 1 });

      const hash1 = computeResultHash(obj1);
      const hash2 = computeResultHash(obj2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("strict runtime envelope and payload validation", () => {
    beforeEach(async () => {
      db = await initializeTestDatabase();
      sessionRunner = createTestSessionRunner(db);
    });

    afterEach(() => {
      db.close();
    });

    it("rejects invalid schemaVersion", async () => {
      const tenantId = brandTenantId("test-tenant-invalid-schema");

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "My Personal" };
      const envelope: any = {
        schemaVersion: 2,  // Invalid: must be 1
        tenantId,
        requestId: "req-1",
        actor: { kind: "HUMAN", id: "user-1" },
        source: "CLI",
        reason: "test",
        payload,
      };

      try {
        await executeBookSetCreate(sessionRunner, envelope);
        expect.unreachable("Should reject invalid schemaVersion");
      } catch (error) {
        expect((error as any).code).toBe("INVALID_SCHEMA_VERSION");
      }
    });

    it("rejects blank or oversized tenantId", async () => {
      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "My Personal" };

      // Blank tenantId
      try {
        const envelope: any = {
          schemaVersion: 1,
          tenantId: "",
          requestId: "req-1",
          actor: { kind: "HUMAN", id: "user-1" },
          source: "CLI",
          reason: "test",
          payload,
        };
        await executeBookSetCreate(sessionRunner, envelope);
        expect.unreachable("Should reject blank tenantId");
      } catch (error) {
        expect((error as any).code).toBe("INVALID_TENANT_ID");
      }

      // Oversized tenantId
      try {
        const envelope: any = {
          schemaVersion: 1,
          tenantId: "x".repeat(200),
          requestId: "req-1",
          actor: { kind: "HUMAN", id: "user-1" },
          source: "CLI",
          reason: "test",
          payload,
        };
        await executeBookSetCreate(sessionRunner, envelope);
        expect.unreachable("Should reject oversized tenantId");
      } catch (error) {
        expect((error as any).code).toBe("INVALID_TENANT_ID");
      }
    });

    it("rejects invalid actor kind", async () => {
      const tenantId = brandTenantId("test-tenant-invalid-actor");

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "My Personal" };
      const envelope: any = {
        schemaVersion: 1,
        tenantId,
        requestId: "req-1",
        actor: { kind: "INVALID", id: "user-1" },
        source: "CLI",
        reason: "test",
        payload,
      };

      try {
        await executeBookSetCreate(sessionRunner, envelope);
        expect.unreachable("Should reject invalid actor kind");
      } catch (error) {
        expect((error as any).code).toBe("INVALID_ACTOR_KIND");
      }
    });

    it("rejects invalid command source", async () => {
      const tenantId = brandTenantId("test-tenant-invalid-source");

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "My Personal" };
      const envelope: any = {
        schemaVersion: 1,
        tenantId,
        requestId: "req-1",
        actor: { kind: "HUMAN", id: "user-1" },
        source: "INVALID_SOURCE",
        reason: "test",
        payload,
      };

      try {
        await executeBookSetCreate(sessionRunner, envelope);
        expect.unreachable("Should reject invalid source");
      } catch (error) {
        expect((error as any).code).toBe("INVALID_SOURCE");
      }
    });

    it("rejects blank displayName and trims whitespace", async () => {
      const tenantId = brandTenantId("test-tenant-displayname");

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      // Blank displayName
      try {
        const payload: any = { kind: "PERSONAL", displayName: "" };
        const envelope: CommandEnvelope<BookSetCreatePayload> = {
          schemaVersion: 1,
          tenantId,
          requestId: "req-1",
          actor: { kind: "HUMAN", id: "user-1" },
          source: "CLI",
          reason: "test",
          payload,
        };
        await executeBookSetCreate(sessionRunner, envelope);
        expect.unreachable("Should reject blank displayName");
      } catch (error) {
        expect((error as any).code).toBe("INVALID_DISPLAY_NAME");
      }

      // Whitespace-only displayName
      try {
        const payload: any = { kind: "PERSONAL", displayName: "   " };
        const envelope: CommandEnvelope<BookSetCreatePayload> = {
          schemaVersion: 1,
          tenantId,
          requestId: "req-2",
          actor: { kind: "HUMAN", id: "user-1" },
          source: "CLI",
          reason: "test",
          payload,
        };
        await executeBookSetCreate(sessionRunner, envelope);
        expect.unreachable("Should reject whitespace-only displayName");
      } catch (error) {
        expect((error as any).code).toBe("INVALID_DISPLAY_NAME");
      }

      // Valid displayName with leading/trailing whitespace gets trimmed
      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "  Trimmed Name  " };
      const envelope: CommandEnvelope<BookSetCreatePayload> = {
        schemaVersion: 1,
        tenantId,
        requestId: "req-3",
        actor: { kind: "HUMAN", id: "user-1" },
        source: "CLI",
        reason: "test",
        payload,
      };

      const result = await executeBookSetCreate(sessionRunner, envelope);
      const resultData = JSON.parse(result.resultJson);
      expect(resultData.displayName).toBe("Trimmed Name");  // Trimmed
    });

    it("rejects invalid ISO requestedAt format", async () => {
      const tenantId = brandTenantId("test-tenant-requestedat");

      await sessionRunner.withBusinessSession("write", async (session) => {
        const now = new Date().toISOString();
        await session.execute(
          "INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [tenantId, "INDIVIDUAL", "CREATING", "Test Tenant", "INR", now, now],
        );
      });

      const payload: BookSetCreatePayload = { kind: "PERSONAL", displayName: "My Personal" };
      const envelope: any = {
        schemaVersion: 1,
        tenantId,
        requestId: "req-1",
        actor: { kind: "HUMAN", id: "user-1" },
        source: "CLI",
        reason: "test",
        requestedAt: "not-an-iso-date",
        payload,
      };

      try {
        await executeBookSetCreate(sessionRunner, envelope);
        expect.unreachable("Should reject invalid requestedAt");
      } catch (error) {
        expect((error as any).code).toBe("INVALID_REQUESTED_AT");
      }
    });
  });
});
