import type { Database } from "../../application/ports/persistence.ts";
import type { BookSetRepository, BookSet } from "../../application/ports/repositories.ts";
import type { TenantId, BookSetId } from "../../core/types.ts";
import { brandBookSetId, brandTenantId, DomainError, CrossTenantViolationError } from "../../core/types.ts";

export class SqliteBookSetRepository implements BookSetRepository {
  constructor(private db: Database) {}

  async create(bookSet: BookSet): Promise<void> {
    const tx = await this.db.beginTransaction();

    try {
      // Verify tenant exists and get its kind
      const tenant = await tx.executeSingle(
        "SELECT id, kind FROM tenants WHERE id = ?",
        [bookSet.tenantId],
      );

      if (!tenant) {
        throw new DomainError("TENANT_NOT_FOUND", `Tenant not found: ${bookSet.tenantId}`);
      }

      const tenantKind = tenant.kind as string;

      // Enforce BookSet kind cardinality based on tenant kind
      if (tenantKind === "COMPANY" && bookSet.kind !== "COMPANY") {
        throw new DomainError(
          "INVALID_BOOK_SET_KIND",
          `COMPANY tenant can only have COMPANY BookSet, not ${bookSet.kind}`,
          { tenantKind, bookSetKind: bookSet.kind },
        );
      }

      if (tenantKind === "INDIVIDUAL" && bookSet.kind === "COMPANY") {
        throw new DomainError(
          "INVALID_BOOK_SET_KIND",
          `INDIVIDUAL tenant cannot have COMPANY BookSet`,
          { tenantKind, bookSetKind: bookSet.kind },
        );
      }

      // Insert the BookSet
      await tx.execute(
        `INSERT INTO book_sets (id, tenant_id, kind, lifecycle, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          bookSet.id,
          bookSet.tenantId,
          bookSet.kind,
          bookSet.lifecycle,
          bookSet.createdAt,
          bookSet.updatedAt,
        ],
      );

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async getById(bookSetId: BookSetId, tenantId: TenantId): Promise<BookSet> {
    const result = await this.db.querySingle(
      `SELECT id, tenant_id, kind, lifecycle, created_at, updated_at
       FROM book_sets WHERE id = ? AND tenant_id = ?`,
      [bookSetId, tenantId],
    );

    if (!result) {
      throw new DomainError("BOOK_SET_NOT_FOUND", `BookSet not found: ${bookSetId}`);
    }

    if ((result.tenant_id as string) !== tenantId) {
      throw new CrossTenantViolationError("getBookSet", tenantId, brandTenantId(result.tenant_id as string));
    }

    return {
      id: brandBookSetId(result.id as string),
      tenantId: brandTenantId(result.tenant_id as string),
      kind: result.kind as "COMPANY" | "PERSONAL" | "PROPRIETORSHIP",
      lifecycle: result.lifecycle as "ACTIVE" | "ARCHIVED",
      createdAt: result.created_at as string,
      updatedAt: result.updated_at as string,
    };
  }

  async getDefault(tenantId: TenantId): Promise<BookSet> {
    const result = await this.db.querySingle(
      `SELECT bs.id, bs.tenant_id, bs.kind, bs.lifecycle, bs.created_at, bs.updated_at
       FROM book_sets bs
       JOIN tenants t ON bs.id = t.default_book_set_id
       WHERE t.id = ?`,
      [tenantId],
    );

    if (!result) {
      throw new DomainError("DEFAULT_BOOK_SET_NOT_FOUND", `No default BookSet for tenant: ${tenantId}`);
    }

    return {
      id: brandBookSetId(result.id as string),
      tenantId: brandTenantId(result.tenant_id as string),
      kind: result.kind as "COMPANY" | "PERSONAL" | "PROPRIETORSHIP",
      lifecycle: result.lifecycle as "ACTIVE" | "ARCHIVED",
      createdAt: result.created_at as string,
      updatedAt: result.updated_at as string,
    };
  }

  async getByKind(
    tenantId: TenantId,
    kind: "COMPANY" | "PERSONAL" | "PROPRIETORSHIP",
  ): Promise<BookSet | null> {
    const result = await this.db.querySingle(
      `SELECT id, tenant_id, kind, lifecycle, created_at, updated_at
       FROM book_sets WHERE tenant_id = ? AND kind = ?`,
      [tenantId, kind],
    );

    if (!result) return null;

    return {
      id: brandBookSetId(result.id as string),
      tenantId: brandTenantId(result.tenant_id as string),
      kind: result.kind as "COMPANY" | "PERSONAL" | "PROPRIETORSHIP",
      lifecycle: result.lifecycle as "ACTIVE" | "ARCHIVED",
      createdAt: result.created_at as string,
      updatedAt: result.updated_at as string,
    };
  }

  async listByTenant(tenantId: TenantId): Promise<BookSet[]> {
    const results = await this.db.query(
      `SELECT id, tenant_id, kind, lifecycle, created_at, updated_at
       FROM book_sets WHERE tenant_id = ? ORDER BY id`,
      [tenantId],
    );

    return results.rows.map((row) => ({
      id: brandBookSetId(row.id as string),
      tenantId: brandTenantId(row.tenant_id as string),
      kind: row.kind as "COMPANY" | "PERSONAL" | "PROPRIETORSHIP",
      lifecycle: row.lifecycle as "ACTIVE" | "ARCHIVED",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  async archive(bookSetId: BookSetId, tenantId: TenantId): Promise<void> {
    const tx = await this.db.beginTransaction();

    try {
      // Verify ownership and not default
      const bookSet = await tx.executeSingle(
        `SELECT bs.id, bs.tenant_id, t.default_book_set_id
         FROM book_sets bs
         LEFT JOIN tenants t ON bs.tenant_id = t.id
         WHERE bs.id = ?`,
        [bookSetId],
      );

      if (!bookSet) {
        throw new DomainError("BOOK_SET_NOT_FOUND", `BookSet not found: ${bookSetId}`);
      }

      if ((bookSet.tenant_id as string) !== tenantId) {
        throw new CrossTenantViolationError("archiveBookSet", tenantId, brandTenantId(bookSet.tenant_id as string));
      }

      if ((bookSet.default_book_set_id as string) === bookSetId) {
        throw new DomainError(
          "CANNOT_ARCHIVE_DEFAULT_BOOK_SET",
          "Cannot archive the default BookSet for tenant",
        );
      }

      // Archive
      await tx.execute(
        `UPDATE book_sets SET lifecycle = ?, updated_at = ? WHERE id = ?`,
        ["ARCHIVED", new Date().toISOString(), bookSetId],
      );

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }
}
