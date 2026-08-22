import type { Database } from "../../application/ports/persistence.ts";
import type { AccountRepository, Account } from "../../application/ports/repositories.ts";
import type { TenantId, BookSetId, AccountId } from "../../core/types.ts";
import { brandAccountId, brandTenantId, brandBookSetId, DomainError, CrossTenantViolationError } from "../../core/types.ts";

export class SqliteAccountRepository implements AccountRepository {
  constructor(private db: Database) {}

  async create(account: Account): Promise<void> {
    const tx = await this.db.beginTransaction();

    try {
      // Verify no reuse of account code in same scope (including archived accounts)
      // Archived accounts keep their code reserved to prevent reuse
      const existing = await tx.executeSingle(
        `SELECT id FROM accounts WHERE tenant_id = ? AND book_set_id = ? AND code = ?`,
        [account.tenantId, account.bookSetId, account.code],
      );

      if (existing) {
        throw new DomainError(
          "ACCOUNT_CODE_ALREADY_EXISTS",
          `Account code already exists in this scope (may be archived): ${account.code}`,
          { tenantId: account.tenantId, bookSetId: account.bookSetId, code: account.code },
        );
      }

      await tx.execute(
        `INSERT INTO accounts (id, tenant_id, book_set_id, code, name, account_type, parent_account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          account.id,
          account.tenantId,
          account.bookSetId,
          account.code,
          account.name,
          account.accountType,
          account.parentAccountId,
          account.createdAt,
          account.updatedAt,
        ],
      );

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async getById(accountId: AccountId, tenantId: TenantId, bookSetId: BookSetId): Promise<Account> {
    const result = await this.db.querySingle(
      `SELECT id, tenant_id, book_set_id, code, name, account_type, parent_account_id, created_at, updated_at
       FROM accounts WHERE id = ? AND tenant_id = ? AND book_set_id = ?`,
      [accountId, tenantId, bookSetId],
    );

    if (!result) {
      throw new DomainError("ACCOUNT_NOT_FOUND", `Account not found: ${accountId}`);
    }

    if ((result.tenant_id as string) !== tenantId || (result.book_set_id as string) !== bookSetId) {
      throw new CrossTenantViolationError("getAccount", tenantId, brandTenantId(result.tenant_id as string));
    }

    return {
      id: brandAccountId(result.id as string),
      tenantId: brandTenantId(result.tenant_id as string),
      bookSetId: brandBookSetId(result.book_set_id as string),
      code: result.code as string,
      name: result.name as string,
      accountType: result.account_type as string,
      parentAccountId: result.parent_account_id ? brandAccountId(result.parent_account_id as string) : undefined,
      createdAt: result.created_at as string,
      updatedAt: result.updated_at as string,
    };
  }

  async getByCode(code: string, tenantId: TenantId, bookSetId: BookSetId): Promise<Account | null> {
    const result = await this.db.querySingle(
      `SELECT id, tenant_id, book_set_id, code, name, account_type, parent_account_id, created_at, updated_at
       FROM accounts WHERE tenant_id = ? AND book_set_id = ? AND code = ?`,
      [tenantId, bookSetId, code],
    );

    if (!result) return null;

    return {
      id: brandAccountId(result.id as string),
      tenantId: brandTenantId(result.tenant_id as string),
      bookSetId: brandBookSetId(result.book_set_id as string),
      code: result.code as string,
      name: result.name as string,
      accountType: result.account_type as string,
      parentAccountId: result.parent_account_id ? brandAccountId(result.parent_account_id as string) : undefined,
      createdAt: result.created_at as string,
      updatedAt: result.updated_at as string,
    };
  }

  async listByBookSet(tenantId: TenantId, bookSetId: BookSetId): Promise<Account[]> {
    const results = await this.db.query(
      `SELECT id, tenant_id, book_set_id, code, name, account_type, parent_account_id, created_at, updated_at
       FROM accounts WHERE tenant_id = ? AND book_set_id = ? ORDER BY code`,
      [tenantId, bookSetId],
    );

    return results.rows.map((row) => ({
      id: brandAccountId(row.id as string),
      tenantId: brandTenantId(row.tenant_id as string),
      bookSetId: brandBookSetId(row.book_set_id as string),
      code: row.code as string,
      name: row.name as string,
      accountType: row.account_type as string,
      parentAccountId: row.parent_account_id ? brandAccountId(row.parent_account_id as string) : undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  async update(account: Account): Promise<void> {
    await this.db.execute(
      `UPDATE accounts SET name = ?, account_type = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ? AND book_set_id = ?`,
      [
        account.name,
        account.accountType,
        account.updatedAt,
        account.id,
        account.tenantId,
        account.bookSetId,
      ],
    );
  }

  async archive(accountId: AccountId, tenantId: TenantId, bookSetId: BookSetId): Promise<void> {
    const tx = await this.db.beginTransaction();

    try {
      // Verify ownership
      const account = await tx.executeSingle(
        `SELECT id, tenant_id, book_set_id FROM accounts WHERE id = ? AND tenant_id = ? AND book_set_id = ?`,
        [accountId, tenantId, bookSetId],
      );

      if (!account) {
        throw new DomainError("ACCOUNT_NOT_FOUND", `Account not found: ${accountId}`);
      }

      if ((account.tenant_id as string) !== tenantId || (account.book_set_id as string) !== bookSetId) {
        throw new CrossTenantViolationError("archiveAccount", tenantId, brandTenantId(account.tenant_id as string));
      }

      // Mark as archived (code remains reserved)
      await tx.execute(
        `UPDATE accounts SET archived_at = ?, updated_at = ? WHERE id = ?`,
        [new Date().toISOString(), new Date().toISOString(), accountId],
      );

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }
}
