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
import { executeGstRegistrationCreate, getGstRegistration, listGstRegistrations, executePartyGstProfileCreate, listPartyGstProfiles, listGstRegister, type GstRegistrationCreatePayload, type GstRegistrationCreateResult, type GstRegistrationView, type PartyGstProfileCreatePayload, type PartyGstProfileCreateResult, type PartyGstProfileView, type GstRegisterRow } from "./services/gst-service.ts";
import { recordOutwardFacts, getOutwardFacts, listOutwardFacts, prepareReturn, validateReturn, exportReviewPack, recordObservation, getReturn, listReturns, readinessReport, type GstOutwardFactsPayload, type GstOutwardFactsView, type GstReturnPreparePayload, type GstReturnPrepareResult, type GstReturnValidateResult, type GstReturnExportPackPayload, type GstReturnExportPackResult, type GstReturnObservationPayload, type GstEnvelope } from "./services/gst-return-readiness-service.ts";
import type { CompanyStatusInput, CompanyStatusResult, CompanyStatusService } from "./services/company-status-service.ts";
import { executeDeductorProfileCreate, executePartyTaxProfileCreate, executeTaxRuleSnapshotCreate, executeWithholdingDeposit, listDeductorProfiles, listPartyTaxProfiles, listWithholdingRegister, type DeductorProfilePayload, type PartyTaxProfilePayload, type TaxRuleSnapshotPayload, type WithholdingDepositPayload, type WithholdingEventRow, type TaxKind } from "./services/tds-tcs-service.ts";
import { executeAssetRegister, executeDepreciation, executeAssetTaxRule, executeTaxBlock, executeTaxCompute, executeAssetDispose, listAssetRegister, listBookDepreciation, listTaxSchedule, bookTaxReconciliation, type AssetRegisterPayload, type AssetRegisterResult, type DepreciationPreviewPayload, type DepreciationResult, type AssetTaxRulePayload, type TaxRuleResult, type TaxBlockPayload, type TaxBlockResult, type TaxComputePayload, type TaxRunResult, type AssetDisposePayload, type AssetDisposeResult, type AssetRegisterRow, type DepreciationLineResult, type TaxLineResult } from "./services/fixed-assets-service.ts";
import { registerCurrency, createFxRateSnapshot, registerFxPolicy, postFxRevaluation, fxOutstanding, type CurrencyRegisterPayload, type FxRateSnapshotPayload, type FxPolicyPayload, type FxRevaluationPayload, type FxReportRow } from "./services/fx-service.ts";
import { createEmployee, getEmployee, listEmployees, createEmployeeProfile, createSalaryStructure, createSalaryVersion, createRuleSnapshot, createClaim, reviewClaim, preparePayRun, approvePayRun, postPayRun, listPayslips, createPaymentBatch, exportBankCsv, createRemittance, updateRemittance, payrollRegister, type EmployeeCreatePayload, type EmployeeProfilePayload, type SalaryStructurePayload, type SalaryVersionPayload, type SalaryComponentInput, type RuleSnapshotPayload, type ClaimPayload, type ClaimReviewPayload, type PayRunPreparePayload, type PayRunActionPayload, type PayrollBankBatchPayload, type BankExportPayload, type RemittancePayload, type RemittanceActionPayload, type EmployeeResult } from "./services/payroll-service.ts";
import { createClaimant, getClaimant, listClaimants, createClaim as createExpenseClaim, submitClaim, reviewClaim as reviewExpenseClaim, postClaim, getClaim as getExpenseClaim, listClaims as listExpenseClaims, issueAdvance, getAdvance, listAdvances, repayAdvance, recordReimbursement, expenseRegister, expenseOpenItems, evidenceExceptions, type ClaimantCreatePayload, type ClaimantView, type ExpenseClaimCreatePayload, type ExpenseClaimSubmitPayload, type ExpenseClaimReviewPayload, type ExpenseClaimPostPayload, type ExpenseClaimView, type ExpenseAdvanceIssuePayload, type ExpenseAdvanceRepayPayload, type ExpenseAdvanceView, type ExpenseReimbursementPayload, type ExpenseRegisterRow, type ExpenseOpenItems, type ExpenseEvidenceException } from "./services/expense-claims-service.ts";
import { createFactProfile, getFactProfile, listFactProfiles, createRuleSnapshot as createComplianceRuleSnapshot, getRuleSnapshot, listRuleSnapshots, createDeadlineSnapshot, getDeadlineSnapshot, listDeadlineSnapshots, createRulePredecessor, evaluateApplicability, getApplicabilityDecision, listApplicabilityDecisions, generateObligation, getObligation, listObligations, calendar, attachArtifact, recordObligationEvent, complianceStatus, type ComplianceEnvelope, type ComplianceFactProfileCreatePayload, type ComplianceRuleCreatePayload, type ComplianceDeadlineCreatePayload, type CompliancePredecessorCreatePayload, type ComplianceApplicabilityPayload, type ComplianceGeneratePayload, type ComplianceArtifactAttachPayload, type ComplianceEventPayload, type ObligationStatus } from "./services/compliance-obligations-service.ts";
import { PeriodCloseService, type PeriodClosePayload, type PeriodReopenPayload, type PeriodPlan, type PeriodEventResult } from "./services/period-close-service.ts";
import { ClosePackService, type ClosePackExportPayload, type ClosePackExportResult, type ClosePackManifest } from "./services/close-pack-service.ts";
import { executeTenantPanSet, getTenantPanProfile, revealTenantPan, type TenantPanProfileView, type TenantPanReveal, type TenantPanSetPayload, type TenantPanSetResult } from "./services/tenant-pan-service.ts";
import { createTaxCase, refreshTaxCaseMembership, taxCaseStatus, importTaxCaseSource, listTaxCaseSources, taxCaseSourceStatus, type TaxCaseStatus } from "./services/tax-case-service.ts";
import { proposeTaxCaseFact, confirmTaxCaseFact, rejectTaxCaseFact, listTaxCaseFacts, recordTaxCaseReconciliation, listTaxCaseReconciliations, taxCaseFactSummary } from "./services/tax-case-facts-service.ts";
import { previewTaxCaseFilingSnapshot, sealTaxCaseFilingSnapshot, showTaxCaseFilingSnapshot, statusTaxCaseFilingSnapshot, type FilingSnapshotPreview } from "./services/tax-case-filing-snapshot-service.ts";
import type { TaxCaseCreatePayload, TaxCaseMembershipRefreshPayload, TaxCaseSourceImportPayload, TaxCaseFactProposePayload, TaxCaseFactDecisionPayload, TaxCaseReconciliationRecordPayload, TaxCaseFilingSnapshotSealPayload } from "./commands.ts";

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

export interface TenantPanOperations {
  set(envelope: CommandEnvelope<TenantPanSetPayload>): Promise<CommandResult<TenantPanSetResult>>;
  get(tenantId: TenantId): Promise<TenantPanProfileView | null>;
  reveal(tenantId: TenantId): Promise<TenantPanReveal>;
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
export interface GstRegistrationOperations {
  create(envelope: CommandEnvelope<GstRegistrationCreatePayload>): Promise<CommandResult<GstRegistrationCreateResult>>;
  get(tenantId: TenantId, registrationId: string): Promise<GstRegistrationView>;
  list(tenantId: TenantId, date?: string): Promise<GstRegistrationView[]>;
}
export interface PartyGstProfileOperations {
  create(envelope: SalesCommandEnvelope<PartyGstProfileCreatePayload>): Promise<CommandResult<PartyGstProfileCreateResult>>;
  list(tenantId: TenantId, bookSetId: BookSetId, partyId: string, date?: string): Promise<PartyGstProfileView[]>;
}
export interface GstRegisterOperations {
  sales(args: { tenantId: TenantId; bookSetId: BookSetId; gstin: string; fromDate?: string; toDate?: string }): Promise<GstRegisterRow[]>;
  purchases(args: { tenantId: TenantId; bookSetId: BookSetId; gstin: string; fromDate?: string; toDate?: string }): Promise<GstRegisterRow[]>;
}
export interface GstReturnReadinessOperations {
  outwardFacts: { record(envelope: GstEnvelope<GstOutwardFactsPayload>): Promise<CommandResult<{ factsId: string; invoiceId: string }>>; get(tenantId: TenantId, bookSetId: BookSetId, factsId: string): Promise<GstOutwardFactsView>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<GstOutwardFactsView[]> };
  return: { prepare(envelope: GstEnvelope<GstReturnPreparePayload>): Promise<CommandResult<GstReturnPrepareResult>>; validate(tenantId: TenantId, bookSetId: BookSetId, snapshotId: string, actorId: string): Promise<GstReturnValidateResult>; exportReviewPack(envelope: GstEnvelope<GstReturnExportPackPayload>): Promise<CommandResult<GstReturnExportPackResult>>; recordObservation(envelope: GstEnvelope<GstReturnObservationPayload>): Promise<CommandResult<{ observationId: string; returnId: string }>>; get(tenantId: TenantId, bookSetId: BookSetId, returnId: string): Promise<Record<string, unknown>>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<Array<Record<string, unknown>>>; readinessReport(tenantId: TenantId, bookSetId: BookSetId): Promise<Array<{ returnId: string; gstin: string; periodFrom: string; periodTo: string; readinessStatus?: string; lastExportedAt?: string }>> };
}
export interface CompanyStatusOperations { status(input?: CompanyStatusInput): Promise<CompanyStatusResult>; }
export interface ExpenseOperations {
  claimant: { create(envelope: CommandEnvelope<ClaimantCreatePayload> & { bookSetId: BookSetId }): Promise<CommandResult<{ claimantId: string; status: "ACTIVE" }>>; get(tenantId: TenantId, bookSetId: BookSetId, claimantId: string): Promise<ClaimantView>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<ClaimantView[]> };
  claim: { create(envelope: CommandEnvelope<ExpenseClaimCreatePayload> & { bookSetId: BookSetId }): Promise<CommandResult<{ claimId: string; status: "DRAFT" }>>; submit(envelope: CommandEnvelope<ExpenseClaimSubmitPayload> & { bookSetId: BookSetId }): Promise<CommandResult<{ claimId: string; status: "SUBMITTED"; businessTotalMinor: number }>>; review(envelope: CommandEnvelope<ExpenseClaimReviewPayload> & { bookSetId: BookSetId }): Promise<CommandResult<{ claimId: string; status: "APPROVED" | "REJECTED" }>>; post(envelope: CommandEnvelope<ExpenseClaimPostPayload> & { bookSetId: BookSetId }): Promise<CommandResult<Record<string, unknown>>>; get(tenantId: TenantId, bookSetId: BookSetId, claimId: string): Promise<ExpenseClaimView>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<ExpenseClaimView[]> };
  advance: { issue(envelope: CommandEnvelope<ExpenseAdvanceIssuePayload> & { bookSetId: BookSetId }): Promise<CommandResult<{ advanceId: string; status: "OPEN"; journalId: string }>>; get(tenantId: TenantId, bookSetId: BookSetId, advanceId: string): Promise<ExpenseAdvanceView>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<ExpenseAdvanceView[]>; repay(envelope: CommandEnvelope<ExpenseAdvanceRepayPayload> & { bookSetId: BookSetId }): Promise<CommandResult<Record<string, unknown>>> };
  reimbursement: { record(envelope: CommandEnvelope<ExpenseReimbursementPayload> & { bookSetId: BookSetId }): Promise<CommandResult<Record<string, unknown>>> };
  register(tenantId: TenantId, bookSetId: BookSetId): Promise<ExpenseRegisterRow[]>;
  openItems(tenantId: TenantId, bookSetId: BookSetId): Promise<ExpenseOpenItems>;
  evidenceExceptions(tenantId: TenantId, bookSetId: BookSetId): Promise<ExpenseEvidenceException[]>;
}
export interface FxOperations {
  currency: { register(envelope: CommandEnvelope<CurrencyRegisterPayload>): Promise<CommandResult<unknown>> };
  rate: { create(envelope: SalesCommandEnvelope<FxRateSnapshotPayload>): Promise<CommandResult<unknown>> };
  revaluation: { policy(envelope: SalesCommandEnvelope<FxPolicyPayload>): Promise<CommandResult<unknown>>; post(envelope: SalesCommandEnvelope<FxRevaluationPayload>): Promise<CommandResult<unknown>>; reverse(envelope: SalesCommandEnvelope<FxRevaluationPayload>): Promise<CommandResult<unknown>> };
  exposure(tenantId: TenantId, bookSetId: BookSetId): Promise<FxReportRow[]>;
}
export interface TaxOperations {
  deductorProfile: { create(envelope: CommandEnvelope<DeductorProfilePayload>): Promise<CommandResult<unknown>>; list(tenantId: TenantId, date?: string): Promise<Record<string, unknown>[]> };
  partyProfile: { create(envelope: SalesCommandEnvelope<PartyTaxProfilePayload>): Promise<CommandResult<unknown>>; list(tenantId: TenantId, bookSetId: BookSetId, partyId: string, date?: string): Promise<Record<string, unknown>[]> };
  ruleSnapshot: { create(envelope: CommandEnvelope<TaxRuleSnapshotPayload>): Promise<CommandResult<unknown>> };
  deposit(envelope: SalesCommandEnvelope<WithholdingDepositPayload>): Promise<CommandResult<unknown>>;
  register(tenantId: TenantId, bookSetId: BookSetId, taxKind: TaxKind): Promise<WithholdingEventRow[]>;
}
export interface FixedAssetOperations {
  register(envelope: SalesCommandEnvelope<AssetRegisterPayload>): Promise<CommandResult<AssetRegisterResult>>;
  depreciation: { preview(envelope: SalesCommandEnvelope<DepreciationPreviewPayload>): Promise<CommandResult<DepreciationResult>>; post(envelope: SalesCommandEnvelope<DepreciationPreviewPayload>): Promise<CommandResult<DepreciationResult>> };
  taxRule: { create(envelope: CommandEnvelope<AssetTaxRulePayload>): Promise<CommandResult<TaxRuleResult>> };
  taxBlock: { register(envelope: SalesCommandEnvelope<TaxBlockPayload>): Promise<CommandResult<TaxBlockResult>> };
  tax: { compute(envelope: SalesCommandEnvelope<TaxComputePayload>): Promise<CommandResult<TaxRunResult>> };
  dispose(envelope: SalesCommandEnvelope<AssetDisposePayload>): Promise<CommandResult<AssetDisposeResult>>;
  reports: { register(tenantId: TenantId, bookSetId: BookSetId, asOfDate?: string): Promise<AssetRegisterRow[]>; depreciation(tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<DepreciationLineResult[]>; tax(tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<TaxLineResult[]>; reconciliation(tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<Array<{ assetId: string; assetNumber: string; bookDepreciationMinor: number; taxDepreciationMinor: number; differenceMinor: number }>> };
}
export interface PayrollOperations {
  employee: { create(envelope: CommandEnvelope<EmployeeCreatePayload> & { bookSetId: BookSetId }): Promise<CommandResult<EmployeeResult>>; get(tenantId: TenantId, bookSetId: BookSetId, employeeId: string): Promise<EmployeeResult>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<EmployeeResult[]> };
  employeeProfile: { create(envelope: CommandEnvelope<EmployeeProfilePayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>> };
  salary: { structure(envelope: CommandEnvelope<SalaryStructurePayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>>; version(envelope: CommandEnvelope<SalaryVersionPayload> & { bookSetId: BookSetId }, components?: SalaryComponentInput[]): Promise<CommandResult<unknown>> };
  ruleSnapshot: { create(envelope: CommandEnvelope<RuleSnapshotPayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>> };
  claim: { create(envelope: CommandEnvelope<ClaimPayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>>; review(envelope: CommandEnvelope<ClaimReviewPayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>> };
  payRun: { prepare(envelope: CommandEnvelope<PayRunPreparePayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>>; approve(envelope: CommandEnvelope<PayRunActionPayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>>; post(envelope: CommandEnvelope<PayRunActionPayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>> };
  payslip: { list(tenantId: TenantId, bookSetId: BookSetId, payRunId?: string): Promise<Array<Record<string, unknown>>> };
  paymentBatch: { create(envelope: CommandEnvelope<PayrollBankBatchPayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>>; export(envelope: CommandEnvelope<BankExportPayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>> };
  remittance: { create(envelope: CommandEnvelope<RemittancePayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>>; update(envelope: CommandEnvelope<RemittanceActionPayload> & { bookSetId: BookSetId }): Promise<CommandResult<unknown>> };
  register(tenantId: TenantId, bookSetId: BookSetId, periodStart?: string, periodEnd?: string): Promise<Array<Record<string, unknown>>>;
}
export interface ComplianceOperations {
  factProfile: { create(envelope: ComplianceEnvelope<ComplianceFactProfileCreatePayload>): Promise<CommandResult<unknown>>; get(tenantId: TenantId, bookSetId: BookSetId, factProfileId: string): Promise<Record<string, unknown>>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<Array<Record<string, unknown>>> };
  rule: { create(envelope: ComplianceEnvelope<ComplianceRuleCreatePayload>): Promise<CommandResult<unknown>>; get(tenantId: TenantId, bookSetId: BookSetId, ruleId: string): Promise<Record<string, unknown>>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<Array<Record<string, unknown>>> };
  deadline: { create(envelope: ComplianceEnvelope<ComplianceDeadlineCreatePayload>): Promise<CommandResult<unknown>>; get(tenantId: TenantId, bookSetId: BookSetId, deadlineId: string): Promise<Record<string, unknown>>; list(tenantId: TenantId, bookSetId: BookSetId, filter?: { fromDate?: string; toDate?: string; code?: string }): Promise<Array<Record<string, unknown>>> };
  predecessor: { create(envelope: ComplianceEnvelope<CompliancePredecessorCreatePayload>): Promise<CommandResult<unknown>> };
  applicability: { evaluate(envelope: ComplianceEnvelope<ComplianceApplicabilityPayload>): Promise<CommandResult<unknown>>; get(tenantId: TenantId, bookSetId: BookSetId, decisionId: string): Promise<Record<string, unknown>>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<Array<Record<string, unknown>>> };
  obligation: { generate(envelope: ComplianceEnvelope<ComplianceGeneratePayload>): Promise<CommandResult<unknown>>; get(tenantId: TenantId, bookSetId: BookSetId, obligationId: string): Promise<Record<string, unknown>>; list(tenantId: TenantId, bookSetId: BookSetId, filter?: { status?: ObligationStatus; code?: string }): Promise<Array<Record<string, unknown>>>; calendar(tenantId: TenantId, bookSetId: BookSetId, fromDate: string, toDate: string, asOfDate: string, filter?: { status?: ObligationStatus; code?: string }): Promise<Array<Record<string, unknown>>>; event(envelope: ComplianceEnvelope<ComplianceEventPayload>): Promise<CommandResult<unknown>> };
  artifact: { attach(envelope: ComplianceEnvelope<ComplianceArtifactAttachPayload>): Promise<CommandResult<unknown>> };
  status(tenantId: TenantId, bookSetId: BookSetId, asOfDate: string): Promise<Record<string, unknown>>;
}

export interface PeriodCloseOperations {
  preview(tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<PeriodPlan>;
  close(envelope: CommandEnvelope<PeriodClosePayload> & { bookSetId: BookSetId }): Promise<CommandResult<PeriodEventResult>>;
  reopenPreview(tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<PeriodPlan>;
  reopen(envelope: CommandEnvelope<PeriodReopenPayload> & { bookSetId: BookSetId }): Promise<CommandResult<PeriodEventResult>>;
  status(tenantId: TenantId, bookSetId: BookSetId): Promise<Array<Record<string, unknown>>>;
}

export interface ClosePackOperations {
  export(envelope: CommandEnvelope<ClosePackExportPayload> & { bookSetId: BookSetId }): Promise<CommandResult<ClosePackExportResult>>;
  getManifest(tenantId: TenantId, bookSetId: BookSetId, manifestId: string): Promise<ClosePackManifest | null>;
  getSection(tenantId: TenantId, bookSetId: BookSetId, manifestId: string, sectionName: string): Promise<string | null>;
}

export interface TaxCaseOperations {
  create(envelope: CommandEnvelope<TaxCaseCreatePayload>): Promise<CommandResult<Record<string, unknown>>>;
  membershipRefresh(envelope: CommandEnvelope<TaxCaseMembershipRefreshPayload>): Promise<CommandResult<Record<string, unknown>>>;
  status(tenantId: TenantId, taxCaseId: string): Promise<TaxCaseStatus>;
  source: {
    import(envelope: CommandEnvelope<TaxCaseSourceImportPayload>): Promise<CommandResult<Record<string, unknown>>>;
    list(tenantId: TenantId, taxCaseId: string): Promise<Record<string, unknown>[]>;
    status(tenantId: TenantId, taxCaseId: string, sourceId: string): Promise<Record<string, unknown>>;
  };
  fact: {
    propose(envelope: CommandEnvelope<TaxCaseFactProposePayload>): Promise<CommandResult<Record<string, unknown>>>;
    confirm(envelope: CommandEnvelope<TaxCaseFactDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>;
    reject(envelope: CommandEnvelope<TaxCaseFactDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>;
    list(tenantId: TenantId, taxCaseId: string, sourceId?: string): Promise<Record<string, unknown>[]>;
    summary(tenantId: TenantId, taxCaseId: string): Promise<Record<string, unknown>>;
  };
  reconciliation: {
    record(envelope: CommandEnvelope<TaxCaseReconciliationRecordPayload>): Promise<CommandResult<Record<string, unknown>>>;
    list(tenantId: TenantId, taxCaseId: string, factId?: string): Promise<Record<string, unknown>[]>;
    summary(tenantId: TenantId, taxCaseId: string): Promise<Record<string, unknown>>;
  };
  filingSnapshot: {
    preview(tenantId: TenantId, taxCaseId: string): Promise<FilingSnapshotPreview>;
    seal(envelope: CommandEnvelope<TaxCaseFilingSnapshotSealPayload>): Promise<CommandResult<Record<string, unknown>>>;
    show(tenantId: TenantId, taxCaseId: string, snapshotId: string): Promise<Record<string, unknown>>;
    status(tenantId: TenantId, taxCaseId: string, snapshotId: string): Promise<Record<string, unknown>>;
  };
}

/**
 * Public application facade: typed read and command interfaces.
 * No raw service mutators or persistence handles escape.
 */
export type PublicApplicationFacade = {
  tenant: TenantReadOperations & TenantCommands & { pan: TenantPanOperations };
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
  gst: { registration: GstRegistrationOperations; partyProfile: PartyGstProfileOperations; register: GstRegisterOperations; returnReadiness: GstReturnReadinessOperations };
  tax: TaxOperations;
  fixedAssets: FixedAssetOperations;
  fx: FxOperations;
  company: CompanyStatusOperations;
  payroll: PayrollOperations;
  expense: ExpenseOperations;
  compliance: ComplianceOperations;
  periodClose: PeriodCloseOperations;
  closePack: ClosePackOperations;
  taxCase: TaxCaseOperations;
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
  companyStatusService: CompanyStatusService,
): PublicApplicationFacade {
  const periodCloseService = new PeriodCloseService(sessionRunner);
  const closePackService = new ClosePackService(sessionRunner);
  const facade: PublicApplicationFacade = {
    tenant: {
      getTenant: (tenantId: TenantId) => tenantService.getTenant(tenantId),
      listActiveTenants: () => tenantService.listActiveTenants(),
      create: (envelope: CommandEnvelope<TenantCreatePayload>) => executeTenantCreate(sessionRunner, envelope),
      activate: (envelope: CommandEnvelope<TenantActivatePayload>) => executeTenantActivate(sessionRunner, envelope),
      pan: {
        set: (envelope: CommandEnvelope<TenantPanSetPayload>) => executeTenantPanSet(sessionRunner, envelope),
        get: (tenantId: TenantId) => getTenantPanProfile(sessionRunner, tenantId),
        reveal: (tenantId: TenantId) => revealTenantPan(sessionRunner, tenantId),
      },
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
    gst: {
      registration: {
        create: (envelope) => executeGstRegistrationCreate(sessionRunner, envelope as CommandEnvelope<GstRegistrationCreatePayload> & { bookSetId: BookSetId }),
        get: (tenantId, registrationId) => getGstRegistration(sessionRunner, tenantId, registrationId),
        list: (tenantId, date) => listGstRegistrations(sessionRunner, tenantId, date),
      },
      partyProfile: {
        create: (envelope) => executePartyGstProfileCreate(sessionRunner, envelope),
        list: (tenantId, bookSetId, partyId, date) => listPartyGstProfiles(sessionRunner, tenantId, bookSetId, partyId, date),
      },
      register: {
        sales: (args) => listGstRegister(sessionRunner, { ...args, documentType: "SALE" }),
        purchases: (args) => listGstRegister(sessionRunner, { ...args, documentType: "PURCHASE" }),
      },
      returnReadiness: {
        outwardFacts: {
          record: (envelope) => recordOutwardFacts(sessionRunner, envelope),
          get: (tenantId, bookSetId, factsId) => getOutwardFacts(sessionRunner, tenantId, bookSetId, factsId),
          list: (tenantId, bookSetId) => listOutwardFacts(sessionRunner, tenantId, bookSetId),
        },
        return: {
          prepare: (envelope) => prepareReturn(sessionRunner, envelope),
          validate: (tenantId, bookSetId, snapshotId, actorId) => validateReturn(sessionRunner, tenantId, bookSetId, snapshotId, actorId),
          exportReviewPack: (envelope) => exportReviewPack(sessionRunner, envelope),
          recordObservation: (envelope) => recordObservation(sessionRunner, envelope),
          get: (tenantId, bookSetId, returnId) => getReturn(sessionRunner, tenantId, bookSetId, returnId),
          list: (tenantId, bookSetId) => listReturns(sessionRunner, tenantId, bookSetId),
          readinessReport: (tenantId, bookSetId) => readinessReport(sessionRunner, tenantId, bookSetId),
        },
      },
    },
    company: { status: (input) => companyStatusService.status(input) },
    expense: {
      claimant: { create: (envelope) => createClaimant(sessionRunner, envelope), get: (tenantId, bookSetId, claimantId) => getClaimant(sessionRunner, tenantId, bookSetId, claimantId), list: (tenantId, bookSetId) => listClaimants(sessionRunner, tenantId, bookSetId) },
      claim: { create: (envelope) => createExpenseClaim(sessionRunner, envelope), submit: (envelope) => submitClaim(sessionRunner, envelope), review: (envelope) => reviewExpenseClaim(sessionRunner, envelope), post: (envelope) => postClaim(sessionRunner, envelope), get: (tenantId, bookSetId, claimId) => getExpenseClaim(sessionRunner, tenantId, bookSetId, claimId), list: (tenantId, bookSetId) => listExpenseClaims(sessionRunner, tenantId, bookSetId) },
      advance: { issue: (envelope) => issueAdvance(sessionRunner, envelope), get: (tenantId, bookSetId, advanceId) => getAdvance(sessionRunner, tenantId, bookSetId, advanceId), list: (tenantId, bookSetId) => listAdvances(sessionRunner, tenantId, bookSetId), repay: (envelope) => repayAdvance(sessionRunner, envelope) },
      reimbursement: { record: (envelope) => recordReimbursement(sessionRunner, envelope) },
      register: (tenantId, bookSetId) => expenseRegister(sessionRunner, tenantId, bookSetId),
      openItems: (tenantId, bookSetId) => expenseOpenItems(sessionRunner, tenantId, bookSetId),
      evidenceExceptions: (tenantId, bookSetId) => evidenceExceptions(sessionRunner, tenantId, bookSetId),
    },
    payroll: {
      employee: { create: (envelope) => createEmployee(sessionRunner, envelope), get: (tenantId, bookSetId, employeeId) => getEmployee(sessionRunner, tenantId, bookSetId, employeeId), list: (tenantId, bookSetId) => listEmployees(sessionRunner, tenantId, bookSetId) },
      employeeProfile: { create: (envelope) => createEmployeeProfile(sessionRunner, envelope) },
      salary: { structure: (envelope) => createSalaryStructure(sessionRunner, envelope), version: (envelope, components) => createSalaryVersion(sessionRunner, envelope, components) },
      ruleSnapshot: { create: (envelope) => createRuleSnapshot(sessionRunner, envelope) },
      claim: { create: (envelope) => createClaim(sessionRunner, envelope), review: (envelope) => reviewClaim(sessionRunner, envelope) },
      payRun: { prepare: (envelope) => preparePayRun(sessionRunner, envelope), approve: (envelope) => approvePayRun(sessionRunner, envelope), post: (envelope) => postPayRun(sessionRunner, envelope) },
      payslip: { list: (tenantId, bookSetId, payRunId) => listPayslips(sessionRunner, tenantId, bookSetId, payRunId) },
      paymentBatch: { create: (envelope) => createPaymentBatch(sessionRunner, envelope), export: (envelope) => exportBankCsv(sessionRunner, envelope) },
      remittance: { create: (envelope) => createRemittance(sessionRunner, envelope), update: (envelope) => updateRemittance(sessionRunner, envelope) },
      register: (tenantId, bookSetId, periodStart, periodEnd) => payrollRegister(sessionRunner, tenantId, bookSetId, periodStart, periodEnd),
    },
    compliance: {
      factProfile: { create: (envelope) => createFactProfile(sessionRunner, envelope), get: (tenantId, bookSetId, id) => getFactProfile(sessionRunner, tenantId, bookSetId, id), list: (tenantId, bookSetId) => listFactProfiles(sessionRunner, tenantId, bookSetId) },
      rule: { create: (envelope) => createComplianceRuleSnapshot(sessionRunner, envelope), get: (tenantId, bookSetId, id) => getRuleSnapshot(sessionRunner, tenantId, bookSetId, id), list: (tenantId, bookSetId) => listRuleSnapshots(sessionRunner, tenantId, bookSetId) },
      deadline: { create: (envelope) => createDeadlineSnapshot(sessionRunner, envelope), get: (tenantId, bookSetId, id) => getDeadlineSnapshot(sessionRunner, tenantId, bookSetId, id), list: (tenantId, bookSetId, filter) => listDeadlineSnapshots(sessionRunner, tenantId, bookSetId, filter) },
      predecessor: { create: (envelope) => createRulePredecessor(sessionRunner, envelope) },
      applicability: { evaluate: (envelope) => evaluateApplicability(sessionRunner, envelope), get: (tenantId, bookSetId, id) => getApplicabilityDecision(sessionRunner, tenantId, bookSetId, id), list: (tenantId, bookSetId) => listApplicabilityDecisions(sessionRunner, tenantId, bookSetId) },
      obligation: { generate: (envelope) => generateObligation(sessionRunner, envelope), get: (tenantId, bookSetId, id) => getObligation(sessionRunner, tenantId, bookSetId, id), list: (tenantId, bookSetId, filter) => listObligations(sessionRunner, tenantId, bookSetId, filter), calendar: (tenantId, bookSetId, fromDate, toDate, asOfDate, filter) => calendar(sessionRunner, tenantId, bookSetId, fromDate, toDate, asOfDate, filter), event: (envelope) => recordObligationEvent(sessionRunner, envelope) },
      artifact: { attach: (envelope) => attachArtifact(sessionRunner, envelope) },
      status: (tenantId, bookSetId, asOfDate) => complianceStatus(sessionRunner, tenantId, bookSetId, asOfDate),
    },
    periodClose: {
      preview: (tenantId, bookSetId, periodStart, periodEnd) => periodCloseService.preview(tenantId, bookSetId, periodStart, periodEnd),
      close: (envelope) => periodCloseService.close(envelope),
      reopenPreview: (tenantId, bookSetId, periodStart, periodEnd) => periodCloseService.reopenPreview(tenantId, bookSetId, periodStart, periodEnd),
      reopen: (envelope) => periodCloseService.reopen(envelope),
      status: (tenantId, bookSetId) => periodCloseService.status(tenantId, bookSetId),
    },
    closePack: {
      export: (envelope) => closePackService.export(envelope),
      getManifest: (tenantId, bookSetId, manifestId) => closePackService.getManifest(tenantId, bookSetId, manifestId),
      getSection: (tenantId, bookSetId, manifestId, sectionName) => closePackService.getSection(tenantId, bookSetId, manifestId, sectionName),
    },
    taxCase: {
      create: (envelope) => createTaxCase(sessionRunner, envelope),
      membershipRefresh: (envelope) => refreshTaxCaseMembership(sessionRunner, envelope),
      status: (tenantId, taxCaseId) => taxCaseStatus(sessionRunner, tenantId, taxCaseId),
      source: {
        import: (envelope) => importTaxCaseSource(sessionRunner, envelope),
        list: (tenantId, taxCaseId) => listTaxCaseSources(sessionRunner, tenantId, taxCaseId),
        status: (tenantId, taxCaseId, sourceId) => taxCaseSourceStatus(sessionRunner, tenantId, taxCaseId, sourceId),
      },
      fact: {
        propose: (envelope) => proposeTaxCaseFact(sessionRunner, envelope),
        confirm: (envelope) => confirmTaxCaseFact(sessionRunner, envelope),
        reject: (envelope) => rejectTaxCaseFact(sessionRunner, envelope),
        list: (tenantId, taxCaseId, sourceId) => listTaxCaseFacts(sessionRunner, tenantId, taxCaseId, sourceId),
        summary: (tenantId, taxCaseId) => taxCaseFactSummary(sessionRunner, tenantId, taxCaseId),
      },
      reconciliation: {
        record: (envelope) => recordTaxCaseReconciliation(sessionRunner, envelope),
        list: (tenantId, taxCaseId, factId) => listTaxCaseReconciliations(sessionRunner, tenantId, taxCaseId, factId),
        summary: (tenantId, taxCaseId) => taxCaseFactSummary(sessionRunner, tenantId, taxCaseId),
      },
      filingSnapshot: {
        preview: (tenantId, taxCaseId) => previewTaxCaseFilingSnapshot(sessionRunner, tenantId, taxCaseId),
        seal: (envelope) => sealTaxCaseFilingSnapshot(sessionRunner, envelope),
        show: (tenantId, taxCaseId, snapshotId) => showTaxCaseFilingSnapshot(sessionRunner, tenantId, taxCaseId, snapshotId),
        status: (tenantId, taxCaseId, snapshotId) => statusTaxCaseFilingSnapshot(sessionRunner, tenantId, taxCaseId, snapshotId),
      },
    },
    fx: {
      currency: { register: (envelope) => registerCurrency(sessionRunner, envelope) },
      rate: { create: (envelope) => createFxRateSnapshot(sessionRunner, envelope) },
      revaluation: { policy: (envelope) => registerFxPolicy(sessionRunner, envelope), post: (envelope) => postFxRevaluation(sessionRunner, envelope), reverse: (envelope) => postFxRevaluation(sessionRunner, envelope, true) },
      exposure: (tenantId, bookSetId) => fxOutstanding(sessionRunner, tenantId, bookSetId),
    },
    tax: {
      deductorProfile: { create: (envelope) => executeDeductorProfileCreate(sessionRunner, envelope), list: (tenantId, date) => listDeductorProfiles(sessionRunner, tenantId, date) },
      partyProfile: { create: (envelope) => executePartyTaxProfileCreate(sessionRunner, envelope), list: (tenantId, bookSetId, partyId, date) => listPartyTaxProfiles(sessionRunner, tenantId, bookSetId, partyId, date) },
      ruleSnapshot: { create: (envelope) => executeTaxRuleSnapshotCreate(sessionRunner, envelope) },
      deposit: (envelope) => executeWithholdingDeposit(sessionRunner, envelope),
      register: (tenantId, bookSetId, taxKind) => listWithholdingRegister(sessionRunner, tenantId, bookSetId, taxKind),
    },
    fixedAssets: {
      register: (envelope) => executeAssetRegister(sessionRunner, envelope),
      depreciation: { preview: (envelope) => executeDepreciation(sessionRunner, envelope, false), post: (envelope) => executeDepreciation(sessionRunner, envelope, true) },
      taxRule: { create: (envelope) => executeAssetTaxRule(sessionRunner, envelope) },
      taxBlock: { register: (envelope) => executeTaxBlock(sessionRunner, envelope) },
      tax: { compute: (envelope) => executeTaxCompute(sessionRunner, envelope) },
      dispose: (envelope) => executeAssetDispose(sessionRunner, envelope),
      reports: { register: (tenantId, bookSetId, asOfDate) => listAssetRegister(sessionRunner, tenantId, bookSetId, asOfDate), depreciation: (tenantId, bookSetId, periodStart, periodEnd) => listBookDepreciation(sessionRunner, tenantId, bookSetId, periodStart, periodEnd), tax: (tenantId, bookSetId, periodStart, periodEnd) => listTaxSchedule(sessionRunner, tenantId, bookSetId, periodStart, periodEnd), reconciliation: (tenantId, bookSetId, periodStart, periodEnd) => bookTaxReconciliation(sessionRunner, tenantId, bookSetId, periodStart, periodEnd) },
    },
  };
  // Keep the historical enumerable facade surface stable for CLI consumers;
  // GST is still a typed public property and is directly accessible.
  Object.defineProperty(facade, "gst", { value: facade.gst, enumerable: false, writable: false, configurable: false });
  Object.defineProperty(facade, "fx", { value: facade.fx, enumerable: false, writable: false, configurable: false });
  Object.defineProperty(facade, "periodClose", { value: facade.periodClose, enumerable: false, writable: false, configurable: false });
  return facade;
}
