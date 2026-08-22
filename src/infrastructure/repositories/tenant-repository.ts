import type { Database } from "../../application/ports/persistence.ts";
import type { TenantRepository, Tenant, BookSet } from "../../application/ports/repositories.ts";
import type { TenantId, BookSetId } from "../../core/types.ts";
import { brandTenantId, brandBookSetId, TenantNotFoundError, CrossTenantViolationError } from "../../core/types.ts";

/**
 * SQL-based tenant repository implementation.
 * Enforces invariants:
 * - One COMPANY BookSet per COMPANY tenant
 * - One PERSONAL BookSet per INDIVIDUAL tenant
 * - Cannot archive if default BookSet is active
 */
export class SqliteTenantRepository implements TenantRepository {
  constructor(private db: Database) {}

  async create(tenant: Tenant, defaultBookSet: BookSet): Promise<void> {
    const tx = await this.db.beginTransaction();

    try {
      // Insert tenant (initially CREATING, no default yet)
      await tx.execute(
        `INSERT INTO tenants (id, kind, lifecycle, name, base_currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          tenant.id,
          tenant.kind,
          "CREATING",
          tenant.name,
          tenant.baseCurrency,
          tenant.createdAt,
          tenant.updatedAt,
        ],
      );

      // Insert default BookSet
      await tx.execute(
        `INSERT INTO book_sets (id, tenant_id, kind, lifecycle, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          defaultBookSet.id,
          tenant.id,
          defaultBookSet.kind,
          "ACTIVE",
          defaultBookSet.createdAt,
          defaultBookSet.updatedAt,
        ],
      );

      // Set tenant default_book_set_id
      await tx.execute(
        `UPDATE tenants SET default_book_set_id = ?, updated_at = ? WHERE id = ?`,
        [defaultBookSet.id, tenant.updatedAt, tenant.id],
      );

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async getById(tenantId: TenantId): Promise<Tenant> {
    const result = await this.db.querySingle(
      `SELECT id, kind, lifecycle, name, base_currency, default_book_set_id, created_at, updated_at
       FROM tenants WHERE id = ?`,
      [tenantId],
    );

    if (!result) {
      throw new TenantNotFoundError(tenantId);
    }

    return {
      id: brandTenantId(result.id as string),
      kind: result.kind as "COMPANY" | "INDIVIDUAL",
      lifecycle: result.lifecycle as "CREATING" | "ACTIVE" | "ARCHIVED",
      name: result.name as string,
      baseCurrency: result.base_currency as string,
      defaultBookSetId: result.default_book_set_id ? brandBookSetId(result.default_book_set_id as string) : undefined,
      createdAt: result.created_at as string,
      updatedAt: result.updated_at as string,
    };
  }

  async listActive(): Promise<Tenant[]> {
    const results = await this.db.query(
      `SELECT id, kind, lifecycle, name, base_currency, default_book_set_id, created_at, updated_at
       FROM tenants WHERE lifecycle = 'ACTIVE' ORDER BY id`,
    );

    return results.rows.map((row) => ({
      id: brandTenantId(row.id as string),
      kind: row.kind as "COMPANY" | "INDIVIDUAL",
      lifecycle: row.lifecycle as "CREATING" | "ACTIVE" | "ARCHIVED",
      name: row.name as string,
      baseCurrency: row.base_currency as string,
      defaultBookSetId: row.default_book_set_id ? brandBookSetId(row.default_book_set_id as string) : undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  async update(tenant: Tenant): Promise<void> {
    await this.db.execute(
      `UPDATE tenants SET kind = ?, lifecycle = ?, name = ?, base_currency = ?, default_book_set_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        tenant.kind,
        tenant.lifecycle,
        tenant.name,
        tenant.baseCurrency,
        tenant.defaultBookSetId,
        tenant.updatedAt,
        tenant.id,
      ],
    );
  }

  async activate(tenantId: TenantId): Promise<void> {
    const tx = await this.db.beginTransaction();

    try {
      // Verify tenant exists and is in CREATING state
      const tenant = await tx.executeSingle(
        `SELECT id, lifecycle FROM tenants WHERE id = ?`,
        [tenantId],
      );

      if (!tenant) {
        throw new TenantNotFoundError(tenantId);
      }

      if (tenant.lifecycle !== "CREATING") {
        throw new Error(`Cannot activate tenant in ${tenant.lifecycle} state`);
      }

      // Transition to ACTIVE
      await tx.execute(
        `UPDATE tenants SET lifecycle = ?, updated_at = ? WHERE id = ?`,
        ["ACTIVE", new Date().toISOString(), tenantId],
      );

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async archive(tenantId: TenantId): Promise<void> {
    const tx = await this.db.beginTransaction();

    try {
      // Verify tenant exists
      const tenant = await tx.executeSingle(
        `SELECT id, default_book_set_id FROM tenants WHERE id = ?`,
        [tenantId],
      );

      if (!tenant) {
        throw new TenantNotFoundError(tenantId);
      }

      // Verify default BookSet is not active (or doesn't exist)
      if (tenant.default_book_set_id) {
        const bookSet = await tx.executeSingle(
          `SELECT id, lifecycle FROM book_sets WHERE id = ?`,
          [tenant.default_book_set_id],
        );

        if (bookSet && bookSet.lifecycle === "ACTIVE") {
          throw new Error(`Cannot archive tenant with active default BookSet ${bookSet.id}`);
        }
      }

      // Transition to ARCHIVED
      await tx.execute(
        `UPDATE tenants SET lifecycle = ?, updated_at = ? WHERE id = ?`,
        ["ARCHIVED", new Date().toISOString(), tenantId],
      );

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }
}
