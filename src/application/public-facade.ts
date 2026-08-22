/**
 * Public application facade.
 * Separates read-only operations from audited commands.
 * Raw service mutators (TenantService.create/activate, BookSetService.create/archive,
 * AccountService.create/archive, IdempotencyService mutation) are NOT exposed here.
 */

import type { TenantId, BookSetId, AccountId } from "../core/types.ts";
import type { Tenant, BookSet, Account } from "./ports/repositories.ts";
import type { TenantService } from "./services/tenant-service.ts";
import type { BookSetService } from "./services/book-set-service.ts";
import type { AccountService } from "./services/account-service.ts";
import type { BookSetScopeService } from "./services/book-set-scope-service.ts";
import type { CommandEnvelope, CommandResult, TenantCreatePayload } from "./commands.ts";
import { executeTenantCreate, type TenantCreateResult } from "./services/tenant-command-service.ts";
import { executeBookSetCreate, executeBookSetSetDefault, executeBookSetArchive, executeTenantActivate, type BookSetCreateResult, type BookSetSetDefaultResult, type BookSetArchiveResult, type TenantActivateResult } from "./services/bookset-command-service.ts";
import type { BookSetCreatePayload, BookSetSetDefaultPayload, BookSetArchivePayload, TenantActivatePayload } from "./commands.ts";
import type { BusinessSessionRunner } from "./ports/persistence.ts";

/**
 * Read-only tenant operations
 */
export interface TenantReadOperations {
  getTenant(tenantId: TenantId): Promise<Tenant>;
  listActiveTenants(): Promise<Tenant[]>;
}

/**
 * Read-only BookSet operations
 */
export interface BookSetReadOperations {
  getDefault(tenantId: TenantId): Promise<BookSet>;
  getById(bookSetId: BookSetId, tenantId: TenantId): Promise<BookSet>;
  listByTenant(tenantId: TenantId): Promise<BookSet[]>;
}

/**
 * Read-only Account operations
 */
export interface AccountReadOperations {
  getById(accountId: AccountId, tenantId: TenantId, bookSetId: BookSetId): Promise<Account>;
  getByCode(code: string, tenantId: TenantId, bookSetId: BookSetId): Promise<Account | undefined>;
  listByBookSet(tenantId: TenantId, bookSetId: BookSetId): Promise<Account[]>;
}

/**
 * Audited tenant commands
 */
export interface TenantCommands {
  create(envelope: CommandEnvelope<TenantCreatePayload>): Promise<CommandResult<TenantCreateResult>>;
  activate(envelope: CommandEnvelope<TenantActivatePayload>): Promise<CommandResult<TenantActivateResult>>;
}

/**
 * Audited BookSet commands
 */
export interface BookSetCommands {
  create(envelope: CommandEnvelope<BookSetCreatePayload>): Promise<CommandResult<BookSetCreateResult>>;
  setDefault(envelope: CommandEnvelope<BookSetSetDefaultPayload>): Promise<CommandResult<BookSetSetDefaultResult>>;
  archive(envelope: CommandEnvelope<BookSetArchivePayload>): Promise<CommandResult<BookSetArchiveResult>>;
}

/**
 * BookSet scope resolution (read-only)
 */
export interface BookSetScopeOperations {
  resolve(tenantId: TenantId, filter?: { bookSetId?: BookSetId }): Promise<BookSet>;
}

/**
 * Public application facade: typed read and command interfaces.
 * No raw service mutators or persistence handles escape.
 */
export type PublicApplicationFacade = {
  tenant: TenantReadOperations & TenantCommands;
  bookSet: BookSetReadOperations & BookSetCommands;
  account: AccountReadOperations;
  bookSetScope: BookSetScopeOperations;
};

/**
 * Create public facade from internal services and session runner.
 * Wraps raw services to expose only read-only operations and audited commands.
 */
export function createPublicFacade(
  tenantService: TenantService,
  bookSetService: BookSetService,
  accountService: AccountService,
  bookSetScopeService: BookSetScopeService,
  sessionRunner: BusinessSessionRunner,
): PublicApplicationFacade {
  return {
    tenant: {
      getTenant: (tenantId: TenantId) => tenantService.getTenant(tenantId),
      listActiveTenants: () => tenantService.listActiveTenants(),
      create: (envelope: CommandEnvelope<TenantCreatePayload>) => executeTenantCreate(sessionRunner, envelope),
      activate: (envelope: CommandEnvelope<TenantActivatePayload>) => executeTenantActivate(sessionRunner, envelope),
    },
    bookSet: {
      getDefault: (tenantId: TenantId) => bookSetService.getDefault(tenantId),
      getById: (bookSetId: BookSetId, tenantId: TenantId) => bookSetService.getById(bookSetId, tenantId),
      listByTenant: (tenantId: TenantId) => bookSetService.listByTenant(tenantId),
      create: (envelope: CommandEnvelope<BookSetCreatePayload>) => executeBookSetCreate(sessionRunner, envelope),
      setDefault: (envelope: CommandEnvelope<BookSetSetDefaultPayload>) => executeBookSetSetDefault(sessionRunner, envelope),
      archive: (envelope: CommandEnvelope<BookSetArchivePayload>) => executeBookSetArchive(sessionRunner, envelope),
    },
    account: {
      getById: (accountId: AccountId, tenantId: TenantId, bookSetId: BookSetId) => accountService.getById(accountId, tenantId, bookSetId),
      getByCode: (code: string, tenantId: TenantId, bookSetId: BookSetId) => accountService.getByCode(code, tenantId, bookSetId),
      listByBookSet: (tenantId: TenantId, bookSetId: BookSetId) => accountService.listByBookSet(tenantId, bookSetId),
    },
    bookSetScope: {
      resolve: (tenantId: TenantId, filter?: { bookSetId?: BookSetId }) => bookSetScopeService.resolve(tenantId, filter),
    },
  };
}
