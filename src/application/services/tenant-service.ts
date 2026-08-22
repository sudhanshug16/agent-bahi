import { randomUUID } from "crypto";
import type { Database } from "../ports/persistence.ts";
import type { TenantRepository, BookSetRepository } from "../ports/repositories.ts";
import type { TenantId, BookSetId } from "../../core/types.ts";
import {
  brandTenantId,
  brandBookSetId,
  TenantNotFoundError,
  currentTimestamp,
  IdempotencyConflictError,
} from "../../core/types.ts";
import type { Tenant, BookSet } from "../ports/repositories.ts";

/**
 * Application service for tenant operations.
 * Handles:
 * - Atomic tenant+BookSet creation
 * - Idempotent tenant bootstrapping with request deduplication
 * - Tenant activation
 */
import { createHash } from "crypto";

export class TenantService {
  constructor(
    private db: Database,
    private tenantRepo: TenantRepository,
    private bookSetRepo: BookSetRepository,
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
   * 5. Commit
   */
  async createTenantWithDefaultBookSet(
    tenantKind: "COMPANY" | "INDIVIDUAL",
    tenantName: string,
    baseCurrency: string = "INR",
    requestId: string = randomUUID(),  // Can be provided for true idempotency
  ): Promise<{ tenant: Tenant; defaultBookSet: BookSet }> {
    // Compute request hash from parameters
    const requestHash = this.computeRequestHash(tenantKind, tenantName, baseCurrency);

    // Use UnitOfWork for atomic transaction with automatic rollback
    // Insert-first pattern: idempotency record + tenant + bookset all in one transaction
    return this.db.unitOfWork().execute(async (tx) => {
      // Check if request was already processed (WITHIN transaction for consistency)
      const existingRequest = await tx.executeSingle(
        "SELECT tenant_id, result_json, request_hash FROM tenant_creation_requests WHERE request_id = ?",
        [requestId],
      );

      if (existingRequest) {
        // Request already exists - verify hash matches
        if ((existingRequest.request_hash as string) !== requestHash) {
          // Hash mismatch - client sent same request_id with different parameters
          throw new IdempotencyConflictError(
            `Request ${requestId} already exists with different parameters`,
          );
        }

        // Hash matches - return cached result
        if (existingRequest.result_json) {
          const result = JSON.parse(existingRequest.result_json as string);
          return result;
        }
      }

      // New request - create tenant and BookSet atomically with request record
      const tenantId = brandTenantId(randomUUID());
      const bookSetId = brandBookSetId(randomUUID());
      const now = currentTimestamp();

      // Determine default BookSet kind based on tenant kind
      const bookSetKind = tenantKind === "COMPANY" ? "COMPANY" : "PERSONAL";

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

      // Create idempotency record FIRST (insert-first pattern)
      const result = { tenant, defaultBookSet };
      const resultJson = JSON.stringify(result);
      const resultHash = this.computeRequestHash(JSON.stringify(result));

      // Insert request record first - if this fails, nothing is created
      await tx.execute(
        `INSERT INTO tenant_creation_requests (id, request_id, request_hash, tenant_id, result_json, result_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), requestId, requestHash, tenantId, resultJson, resultHash, now],
      );

      // Now create tenant and BookSet (transaction will rollback if either fails)
      // Insert tenant
      await tx.execute(
        `INSERT INTO tenants (id, kind, lifecycle, name, base_currency, default_book_set_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tenantId, tenant.kind, "CREATING", tenant.name, tenant.baseCurrency, bookSetId, now, now],
      );

      // Insert BookSet
      await tx.execute(
        `INSERT INTO book_sets (id, tenant_id, kind, lifecycle, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [bookSetId, tenantId, bookSetKind, "ACTIVE", now, now],
      );

      // Entire transaction committed by UnitOfWork - no partial state possible
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
   */
  async activateTenant(tenantId: TenantId): Promise<Tenant> {
    await this.tenantRepo.activate(tenantId);
    return this.tenantRepo.getById(tenantId);
  }

  /**
   * Get tenant by ID.
   */
  async getTenant(tenantId: TenantId): Promise<Tenant> {
    return this.tenantRepo.getById(tenantId);
  }

  /**
   * List all active tenants.
   */
  async listActiveTenants(): Promise<Tenant[]> {
    return this.tenantRepo.listActive();
  }
}
