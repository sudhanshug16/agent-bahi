import type { BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import type { BookSet } from "../ports/repositories.ts";
import { SqliteBookSetRepository } from "../../infrastructure/repositories/book-set-repository.ts";

/**
 * Application service for BookSet operations.
 * All operations run within a BusinessSession via the session runner.
 */
export class BookSetService {
  constructor(private sessionRunner: BusinessSessionRunner) {}

  async create(bookSet: BookSet): Promise<void> {
    return this.sessionRunner.withBusinessSession("write", async (session) => {
      const repo = new SqliteBookSetRepository(session);
      await repo.create(bookSet);
    });
  }

  async getDefault(tenantId: TenantId): Promise<BookSet> {
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const repo = new SqliteBookSetRepository(session);
      return repo.getDefault(tenantId);
    });
  }

  async getById(bookSetId: BookSetId, tenantId: TenantId): Promise<BookSet> {
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const repo = new SqliteBookSetRepository(session);
      return repo.getById(bookSetId, tenantId);
    });
  }

  async listByTenant(tenantId: TenantId): Promise<BookSet[]> {
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const repo = new SqliteBookSetRepository(session);
      return repo.listByTenant(tenantId);
    });
  }

  async archive(bookSetId: BookSetId, tenantId: TenantId): Promise<void> {
    return this.sessionRunner.withBusinessSession("write", async (session) => {
      const repo = new SqliteBookSetRepository(session);
      await repo.archive(bookSetId, tenantId);
    });
  }
}
