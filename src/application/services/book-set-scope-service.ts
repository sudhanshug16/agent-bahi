import type { BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSet } from "../ports/repositories.ts";
import type { BookSetId, BookSetKind, TenantId } from "../../core/types.ts";
import { brandBookSetId, brandTenantId, DomainError } from "../../core/types.ts";

export interface BookSetScopeSelector {
  readonly bookSetId?: BookSetId;
  readonly kind?: BookSetKind;
}

/** Read-only active BookSet scope resolution. Mutations must supply an ID. */
export class BookSetScopeService {
  constructor(private readonly sessionRunner: BusinessSessionRunner) {}

  async resolve(tenantId: TenantId, selector?: BookSetScopeSelector): Promise<BookSet> {
    const hasId = selector?.bookSetId !== undefined;
    const hasKind = selector?.kind !== undefined;
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      let rows;
      if (hasId) {
        rows = await session.query(
          `SELECT id, tenant_id, kind, display_name, lifecycle, created_at, updated_at
           FROM book_sets WHERE tenant_id = ? AND id = ?${hasKind ? " AND kind = ?" : ""} AND lifecycle = 'ACTIVE' ORDER BY id LIMIT 2`,
          hasKind ? [tenantId, selector!.bookSetId, selector!.kind] : [tenantId, selector!.bookSetId],
        );
      } else if (hasKind) {
        rows = await session.query(
          `SELECT id, tenant_id, kind, display_name, lifecycle, created_at, updated_at
           FROM book_sets WHERE tenant_id = ? AND kind = ? AND lifecycle = 'ACTIVE' ORDER BY id LIMIT 2`,
          [tenantId, selector!.kind],
        );
      } else {
        rows = await session.query(
          `SELECT id, tenant_id, kind, display_name, lifecycle, created_at, updated_at
           FROM book_sets WHERE tenant_id = ? AND lifecycle = 'ACTIVE' ORDER BY id LIMIT 2`,
          [tenantId],
        );
      }

      if (rows.rows.length === 0) {
        throw new DomainError("BOOK_SET_SCOPE_NOT_FOUND", "No ACTIVE BookSet matches the requested scope", { tenantId });
      }
      if (rows.rows.length > 1 && !hasId) {
        throw new DomainError("BOOK_SET_SCOPE_AMBIGUOUS", "Multiple ACTIVE BookSets match the requested scope", { tenantId });
      }
      const row = rows.rows[0]!;
      return {
        id: brandBookSetId(String(row.id)),
        tenantId: brandTenantId(String(row.tenant_id)),
        kind: row.kind as BookSet["kind"],
        displayName: String(row.display_name),
        lifecycle: row.lifecycle as BookSet["lifecycle"],
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      };
    });
  }
}
