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
 * - Idempotent tenant bootstrapping
 * - Tenant activation
 */
export class TenantService {
  constructor(
    private db: Database,
    private tenantRepo: TenantRepository,
    private bookSetRepo: BookSetRepository,
  ) {}

  /**
   * Create a new tenant with its default BookSet in a single atomic transaction.
   *
   * COMPANY tenants get: one COMPANY BookSet as default
   * INDIVIDUAL tenants get: one PERSONAL BookSet as default
   *
   * Transaction order:
   * 1. Insert tenant in CREATING state (no default_book_set_id yet)
   * 2. Insert default BookSet (COMPANY for COMPANY tenant, PERSONAL for INDIVIDUAL)
   * 3. Update tenant to set default_book_set_id
   * 4. Commit
   *
   * If failure at step 2 or 3, entire transaction rolls back (no partial state).
   */
  async createTenantWithDefaultBookSet(
    tenantKind: "COMPANY" | "INDIVIDUAL",
    tenantName: string,
    baseCurrency: string = "INR",
  ): Promise<{ tenant: Tenant; defaultBookSet: BookSet }> {
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

    await this.tenantRepo.create(tenant, defaultBookSet);

    return { tenant, defaultBookSet };
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
