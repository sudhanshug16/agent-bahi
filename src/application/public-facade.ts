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
import type { JournalPostPayload, JournalPostResult } from "./services/journal-command-service.ts";
import { executeJournalPost } from "./services/journal-command-service.ts";
import type { LedgerReportService, TrialBalanceReport, ProfitAndLossReport, BalanceSheetReport } from "./services/ledger-report-service.ts";
import { executePartyCreate, executeInvoiceCreate, executeInvoicePost, executeReceiptRecord, getInvoice, listOutstandingInvoices, type PartyCreatePayload, type PartyCreateResult, type InvoiceCreatePayload, type InvoiceCreateResult, type InvoicePostPayload, type InvoicePostResult, type ReceiptRecordPayload, type ReceiptRecordResult, type InvoiceView } from "./services/sales-command-service.ts";
import { executeBillCreate, executeBillPost, executeVendorPaymentRecord, getBill, listOutstandingBills, type BillCreatePayload, type BillCreateResult, type BillPostPayload, type BillPostResult, type VendorPaymentRecordPayload, type VendorPaymentRecordResult, type BillView } from "./services/purchase-command-service.ts";
import { executeBankStatementImport, getBankStatement, listBankStatements, executeBankMatchConfirm, executeBankMatchUndo, bankMatchCandidates, bankReconciliationStatus, type BankStatementEnvelope, type BankStatementImportResult, type BankStatementView, type BankMatchConfirmEnvelope, type BankMatchUndoEnvelope, type BankMatchResult, type BankMatchCandidate, type BankReconciliationStatus } from "./services/bank-reconciliation-service.ts";

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

export type JournalPostEnvelope = CommandEnvelope<JournalPostPayload> & { bookSetId: BookSetId };

export interface JournalCommands {
  post(envelope: JournalPostEnvelope): Promise<CommandResult<JournalPostResult>>;
}

export interface LedgerReportOperations {
  trialBalance(tenantId: TenantId, bookSetId: BookSetId, asOfDate: string): Promise<TrialBalanceReport>;
  profitAndLoss(tenantId: TenantId, bookSetId: BookSetId, fromDate: string, toDate: string): Promise<ProfitAndLossReport>;
  balanceSheet(tenantId: TenantId, bookSetId: BookSetId, asOfDate: string): Promise<BalanceSheetReport>;
}

export type SalesCommandEnvelope<P> = CommandEnvelope<P> & { bookSetId: BookSetId };
export interface PartyCommands { create(envelope: SalesCommandEnvelope<PartyCreatePayload>): Promise<CommandResult<PartyCreateResult>>; }
export interface InvoiceCommands {
  create(envelope: SalesCommandEnvelope<InvoiceCreatePayload>): Promise<CommandResult<InvoiceCreateResult>>;
  post(envelope: SalesCommandEnvelope<InvoicePostPayload>): Promise<CommandResult<InvoicePostResult>>;
  get(tenantId: TenantId, bookSetId: BookSetId, invoiceId: string): Promise<InvoiceView>;
  outstanding(tenantId: TenantId, bookSetId: BookSetId): Promise<InvoiceView[]>;
}
export interface ReceiptCommands { record(envelope: SalesCommandEnvelope<ReceiptRecordPayload>): Promise<CommandResult<ReceiptRecordResult>>; }
export interface BillCommands {
  create(envelope: SalesCommandEnvelope<BillCreatePayload>): Promise<CommandResult<BillCreateResult>>;
  post(envelope: SalesCommandEnvelope<BillPostPayload>): Promise<CommandResult<BillPostResult>>;
  get(tenantId: TenantId, bookSetId: BookSetId, billId: string): Promise<BillView>;
  outstanding(tenantId: TenantId, bookSetId: BookSetId): Promise<BillView[]>;
}
export interface VendorPaymentCommands { record(envelope: SalesCommandEnvelope<VendorPaymentRecordPayload>): Promise<CommandResult<VendorPaymentRecordResult>>; }
export interface BankStatementCommands {
  import(envelope: BankStatementEnvelope): Promise<CommandResult<BankStatementImportResult>>;
  get(tenantId: TenantId, bookSetId: BookSetId, statementId: string): Promise<BankStatementView>;
  list(tenantId: TenantId, bookSetId: BookSetId, filter?: { statementId?: string }): Promise<BankStatementView[]>;
}
export interface BankMatchCommands {
  confirm(envelope: BankMatchConfirmEnvelope): Promise<CommandResult<BankMatchResult>>;
  undo(envelope: BankMatchUndoEnvelope): Promise<CommandResult<BankMatchResult>>;
  candidates(tenantId: TenantId, bookSetId: BookSetId, statementLineId: string): Promise<BankMatchCandidate[]>;
}
export interface BankReconciliationOperations { status(tenantId: TenantId, bookSetId: BookSetId, statementId: string): Promise<BankReconciliationStatus>; }

/**
 * Public application facade: typed read and command interfaces.
 * No raw service mutators or persistence handles escape.
 */
export type PublicApplicationFacade = {
  tenant: TenantReadOperations & TenantCommands;
  bookSet: BookSetReadOperations & BookSetCommands;
  account: AccountReadOperations;
  bookSetScope: BookSetScopeOperations;
  journal: JournalCommands;
  ledger: LedgerReportOperations;
  party: PartyCommands;
  invoice: InvoiceCommands;
  receipt: ReceiptCommands;
  bill: BillCommands;
  vendorPayment: VendorPaymentCommands;
  bankStatement: BankStatementCommands;
  bankMatch: BankMatchCommands;
  bankReconciliation: BankReconciliationOperations;
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
  ledgerReportService: LedgerReportService,
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
    journal: {
      post: (envelope: JournalPostEnvelope) => executeJournalPost(sessionRunner, envelope),
    },
    ledger: {
      trialBalance: (tenantId, bookSetId, asOfDate) => ledgerReportService.trialBalance(tenantId, bookSetId, asOfDate),
      profitAndLoss: (tenantId, bookSetId, fromDate, toDate) => ledgerReportService.profitAndLoss(tenantId, bookSetId, fromDate, toDate),
      balanceSheet: (tenantId, bookSetId, asOfDate) => ledgerReportService.balanceSheet(tenantId, bookSetId, asOfDate),
    },
    party: { create: (envelope) => executePartyCreate(sessionRunner, envelope) },
    invoice: {
      create: (envelope) => executeInvoiceCreate(sessionRunner, envelope),
      post: (envelope) => executeInvoicePost(sessionRunner, envelope),
      get: (tenantId, bookSetId, invoiceId) => getInvoice(sessionRunner, tenantId, bookSetId, invoiceId),
      outstanding: (tenantId, bookSetId) => listOutstandingInvoices(sessionRunner, tenantId, bookSetId),
    },
    receipt: { record: (envelope) => executeReceiptRecord(sessionRunner, envelope) },
    bill: {
      create: (envelope) => executeBillCreate(sessionRunner, envelope),
      post: (envelope) => executeBillPost(sessionRunner, envelope),
      get: (tenantId, bookSetId, billId) => getBill(sessionRunner, tenantId, bookSetId, billId),
      outstanding: (tenantId, bookSetId) => listOutstandingBills(sessionRunner, tenantId, bookSetId),
    },
    vendorPayment: { record: (envelope) => executeVendorPaymentRecord(sessionRunner, envelope) },
    bankStatement: { import: (envelope) => executeBankStatementImport(sessionRunner, envelope), get: (tenantId, bookSetId, statementId) => getBankStatement(sessionRunner, tenantId, bookSetId, statementId), list: (tenantId, bookSetId, filter) => listBankStatements(sessionRunner, tenantId, bookSetId, filter) },
    bankMatch: { confirm: (envelope) => executeBankMatchConfirm(sessionRunner, envelope), undo: (envelope) => executeBankMatchUndo(sessionRunner, envelope), candidates: (tenantId, bookSetId, statementLineId) => bankMatchCandidates(sessionRunner, tenantId, bookSetId, statementLineId) },
    bankReconciliation: { status: (tenantId, bookSetId, statementId) => bankReconciliationStatus(sessionRunner, tenantId, bookSetId, statementId) },
  };
}
