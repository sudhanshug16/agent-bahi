import { randomUUID } from "crypto";
import type { BusinessSessionRunner, BusinessSession } from "../ports/persistence.ts";
import type { TenantId, BookSetId } from "../../core/types.ts";
import {
  brandTenantId,
  brandBookSetId,
  TenantNotFoundError,
  currentTimestamp,
  IdempotencyConflictError,
  DomainError,
} from "../../core/types.ts";
import type { Tenant, BookSet } from "../ports/repositories.ts";
import { SqliteTenantRepository } from "../../infrastructure/repositories/tenant-repository.ts";
import { createHash } from "crypto";

/**
 * Application service for tenant operations.
 * Handles:
 * - Atomic tenant+BookSet creation
 * - Idempotent tenant bootstrapping with request deduplication
 * - Tenant activation
 *
 * All operations run within a single BusinessSession.
 * Repositories are constructed session-bound inside the callback.
 * Session/repositories escape the callback scope and subsequent use fails.
 */
export class TenantService {
  constructor(
    private sessionRunner: BusinessSessionRunner,
  ) {}

  /**
   * Create a new tenant with its default BookSet in a single atomic transaction.
   * Idempotent: same request parameters always return the same tenant.
   *
   * COMPANY tenants get: one COMPANY BookSet as default
   * INDIVIDUAL tenants get: one PERSONAL BookSet as default
   *
   * Idempotency mechanism:
   * - Compute request_hash from (tenantKind, tenantName, baseCurrency)
   * - Check tenant_creation_requests table
   * - If same request_id with same hash: return cached result
   * - If same request_id with different hash: throw conflict error
   * - Otherwise: create new tenant and record request
   *
   * Transaction guarantees:
   * 1. Insert tenant in CREATING state (no default_book_set_id yet)
   * 2. Insert default BookSet (COMPANY for COMPANY tenant, PERSONAL for INDIVIDUAL)
   * 3. Update tenant to set default_book_set_id
   * 4. Record tenant_creation_request atomically
   * 5. Commit (auto within BusinessSession)
   *
   * All operations run within a single write-mode BusinessSession.
   * Session becomes inactive after callback; subsequent use throws.
   */
  async createTenantWithDefaultBookSet(
    tenantKind: "COMPANY" | "INDIVIDUAL",
    tenantName: string,
    baseCurrency: string = "INR",
    requestId: string = randomUUID(),
  ): Promise<{ tenant: Tenant; defaultBookSet: BookSet }> {
    const requestHash = this.computeRequestHash(tenantKind, tenantName, baseCurrency);

    return this.sessionRunner.withBusinessSession("write", async (session) => {
      // Check if request already processed
      const existingRequest = await session.querySingle(
        "SELECT tenant_id, request_hash, result_json FROM tenant_creation_requests WHERE request_id = ?",
        [requestId],
      );

      if (existingRequest) {
        if ((existingRequest.request_hash as string) !== requestHash) {
          throw new IdempotencyConflictError(
            `Request ${requestId} already exists with different parameters`,
          );
        }

        if (existingRequest.result_json) {
          return JSON.parse(existingRequest.result_json as string);
        }

        // Partial: idempotency row reserved but result not finalized
        throw new DomainError(
          "IDEMPOTENCY_PARTIAL",
          `Request ${requestId} is partially applied; retry may succeed`,
        );
      }

      // Reserve idempotency row FIRST (tenant_id=NULL, result=NULL)
      const requestRecordId = randomUUID();
      const tenantId = brandTenantId(randomUUID());
      const bookSetId = brandBookSetId(randomUUID());
      const now = currentTimestamp();
      const bookSetKind = tenantKind === "COMPANY" ? "COMPANY" : "PERSONAL";

      await session.execute(
        `INSERT INTO tenant_creation_requests (id, request_id, request_hash, tenant_id, result_json, result_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [requestRecordId, requestId, requestHash, null, null, null, now],
      );

      // Insert tenant with default_book_set_id=NULL (FK will be added later)
      await session.execute(
        `INSERT INTO tenants (id, kind, lifecycle, name, base_currency, default_book_set_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tenantId, tenantKind, "CREATING", tenantName, baseCurrency, null, now, now],
      );

      // Insert BookSet (FK to tenant satisfied)
      await session.execute(
        `INSERT INTO book_sets (id, tenant_id, kind, lifecycle, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [bookSetId, tenantId, bookSetKind, "ACTIVE", now, now],
      );

      // Update tenant default_book_set_id (trigger validates same-tenant row exists)
      await session.execute(
        `UPDATE tenants SET default_book_set_id = ?, updated_at = ? WHERE id = ?`,
        [bookSetId, now, tenantId],
      );

      // Construct result and finalize idempotency row
      const tenant: Tenant = {
        id: tenantId,
        kind: tenantKind,
        lifecycle: "CREATING",
        name: tenantName,
        baseCurrency,
        defaultBookSetId: bookSetId,
        createdAt: now,
        updatedAt: now,
      };

      const defaultBookSet: BookSet = {
        id: bookSetId,
        tenantId,
        kind: bookSetKind,
        lifecycle: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      };

      const result = { tenant, defaultBookSet };
      const resultJson = JSON.stringify(result);
      const resultHash = this.computeRequestHash(JSON.stringify(result));

      // Update idempotency row with final result
      await session.execute(
        `UPDATE tenant_creation_requests SET tenant_id = ?, result_json = ?, result_hash = ? WHERE request_id = ?`,
        [tenantId, resultJson, resultHash, requestId],
      );

      return result;
    });
  }

  private computeRequestHash(
    ...parts: (string | any)[]
  ): string {
    const payload = parts.map(p =>
      typeof p === 'string' ? p : JSON.stringify(p)
    ).join('|');
    return createHash("sha256").update(payload).digest("hex");
  }

  /**
   * Activate a tenant (transition from CREATING to ACTIVE).
   * Only valid for tenants in CREATING state.
   * Runs in write-mode session.
   */
  async activateTenant(tenantId: TenantId): Promise<Tenant> {
    return this.sessionRunner.withBusinessSession("write", async (session) => {
      const repo = new SqliteTenantRepository(session);
      await repo.activate(tenantId);
      return repo.getById(tenantId);
    });
  }

  /**
   * Get tenant by ID (read-only).
   * Runs in read-mode session.
   */
  async getTenant(tenantId: TenantId): Promise<Tenant> {
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const repo = new SqliteTenantRepository(session);
      return repo.getById(tenantId);
    });
  }

  /**
   * List all active tenants (read-only).
   * Runs in read-mode session.
   */
  async listActiveTenants(): Promise<Tenant[]> {
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const repo = new SqliteTenantRepository(session);
      return repo.listActive();
    });
  }
}
