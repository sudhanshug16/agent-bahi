import type { BusinessSessionRunner } from "../ports/persistence.ts";
import type { AccountId, TenantId, BookSetId } from "../../core/types.ts";
import type { Account } from "../ports/repositories.ts";
import { SqliteAccountRepository } from "../../infrastructure/repositories/account-repository.ts";

/**
 * Application service for Account operations.
 * All operations run within a BusinessSession via the session runner.
 */
export class AccountService {
  constructor(private sessionRunner: BusinessSessionRunner) {}

  async create(account: Account): Promise<void> {
    return this.sessionRunner.withBusinessSession("write", async (session) => {
      const repo = new SqliteAccountRepository(session);
      await repo.create(account);
    });
  }

  async getById(accountId: AccountId, tenantId: TenantId, bookSetId: BookSetId): Promise<Account> {
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const repo = new SqliteAccountRepository(session);
      return repo.getById(accountId, tenantId, bookSetId);
    });
  }

  async getByCode(code: string, tenantId: TenantId, bookSetId: BookSetId): Promise<Account | undefined> {
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const repo = new SqliteAccountRepository(session);
      const result = await repo.getByCode(code, tenantId, bookSetId);
      return result ?? undefined;
    });
  }

  async listByBookSet(tenantId: TenantId, bookSetId: BookSetId): Promise<Account[]> {
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const repo = new SqliteAccountRepository(session);
      return repo.listByBookSet(tenantId, bookSetId);
    });
  }

  async archive(accountId: AccountId, tenantId: TenantId, bookSetId: BookSetId): Promise<void> {
    return this.sessionRunner.withBusinessSession("write", async (session) => {
      const repo = new SqliteAccountRepository(session);
      await repo.archive(accountId, tenantId, bookSetId);
    });
  }
}
