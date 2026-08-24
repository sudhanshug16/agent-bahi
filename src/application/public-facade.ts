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
import type { CommandEnvelope, CommandResult, TenantCreatePayload, AccountCreatePayload } from "./commands.ts";
import { executeAccountCreate, type AccountCreateResult } from "./services/account-command-service.ts";
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
import { inspectBankFileForScope, importBankFile, type SourceFileEnvelope, type SourceFilePreview, type SourceImportResult } from "./services/source-registry-service.ts";
import { previewSourceStaging, stageSource, statusSourceStaging, listSourceStaging, type SourceStagingEnvelope, type SourceStagingPreview, type SourceStagingReport, type SourceStagingListResult } from "./services/source-staging-service.ts";
import { previewZohoBackup, importZohoBackup, statusZohoBackup, type ZohoBackupEnvelope, type ZohoBackupPreview, type ZohoBackupReport } from "./services/zoho-backup-import-service.ts";
import { executeGstRegistrationCreate, getGstRegistration, listGstRegistrations, executePartyGstProfileCreate, listPartyGstProfiles, listGstRegister, type GstRegistrationCreatePayload, type GstRegistrationCreateResult, type GstRegistrationView, type PartyGstProfileCreatePayload, type PartyGstProfileCreateResult, type PartyGstProfileView, type GstRegisterRow } from "./services/gst-service.ts";
import { recordOutwardFacts, getOutwardFacts, listOutwardFacts, prepareReturn, validateReturn, exportReviewPack, recordObservation, getReturn, listReturns, readinessReport, type GstOutwardFactsPayload, type GstOutwardFactsView, type GstReturnPreparePayload, type GstReturnPrepareResult, type GstReturnValidateResult, type GstReturnExportPackPayload, type GstReturnExportPackResult, type GstReturnObservationPayload, type GstEnvelope } from "./services/gst-return-readiness-service.ts";
import { registerGstReturnSchemaPack, verifyGstReturnSchemaPack, rejectGstReturnSchemaPack, showGstReturnSchemaPack, previewGstr1Artifact, prepareGstr1Artifact, validateGstr1Artifact, exportGstr1Artifact, showGstr1Artifact, statusGstr1Artifact, contentGstr1Artifact } from "./services/gst-gstr1-artifact-service.ts";
import type { GstReturnSchemaPackRegisterPayload, GstReturnSchemaPackDecisionPayload, Gstr1ArtifactBindingPayload, Gstr1ArtifactValidatePayload, Gstr1ArtifactExportPayload } from "./commands.ts";
import type { GstGstr3bSchemaPackRegisterPayload, GstGstr3bSchemaPackDecisionPayload, GstGstr3bFactPayload, GstGstr3bFactDecisionPayload, GstGstr3bArtifactBindingPayload, GstGstr3bArtifactValidatePayload, GstGstr3bArtifactExportPayload } from "./commands.ts";
import { registerGstGstr3bSchemaPack, verifyGstGstr3bSchemaPack, rejectGstGstr3bSchemaPack, showGstGstr3bSchemaPack, proposeGstGstr3bFact, confirmGstGstr3bFact, rejectGstGstr3bFact, listGstGstr3bFacts, previewGstGstr3b, prepareGstGstr3b, validateGstGstr3b, exportGstGstr3b, showGstGstr3b, statusGstGstr3b, contentGstGstr3b } from "./services/gst-gstr3b-artifact-service.ts";
import type { CompanyStatusInput, CompanyStatusResult, CompanyStatusService } from "./services/company-status-service.ts";
import { executeDeductorProfileCreate, executePartyTaxProfileCreate, executeTaxRuleSnapshotCreate, executeWithholdingDeposit, listDeductorProfiles, listPartyTaxProfiles, listWithholdingRegister, type DeductorProfilePayload, type PartyTaxProfilePayload, type TaxRuleSnapshotPayload, type WithholdingDepositPayload, type WithholdingEventRow, type TaxKind } from "./services/tds-tcs-service.ts";
import { executeAssetRegister, executeDepreciation, executeAssetTaxRule, executeTaxBlock, executeTaxCompute, executeAssetDispose, listAssetRegister, listBookDepreciation, listTaxSchedule, bookTaxReconciliation, type AssetRegisterPayload, type AssetRegisterResult, type DepreciationPreviewPayload, type DepreciationResult, type AssetTaxRulePayload, type TaxRuleResult, type TaxBlockPayload, type TaxBlockResult, type TaxComputePayload, type TaxRunResult, type AssetDisposePayload, type AssetDisposeResult, type AssetRegisterRow, type DepreciationLineResult, type TaxLineResult } from "./services/fixed-assets-service.ts";
import { registerCurrency, createFxRateSnapshot, registerFxPolicy, postFxRevaluation, fxOutstanding, type CurrencyRegisterPayload, type FxRateSnapshotPayload, type FxPolicyPayload, type FxRevaluationPayload, type FxReportRow } from "./services/fx-service.ts";
import { createEmployee, getEmployee, listEmployees, createEmployeeProfile, createSalaryStructure, createSalaryVersion, createRuleSnapshot, createClaim, reviewClaim, preparePayRun, approvePayRun, postPayRun, listPayslips, createPaymentBatch, exportBankCsv, createRemittance, updateRemittance, payrollRegister, type EmployeeCreatePayload, type EmployeeProfilePayload, type SalaryStructurePayload, type SalaryVersionPayload, type SalaryComponentInput, type RuleSnapshotPayload, type ClaimPayload, type ClaimReviewPayload, type PayRunPreparePayload, type PayRunActionPayload, type PayrollBankBatchPayload, type BankExportPayload, type RemittancePayload, type RemittanceActionPayload, type EmployeeResult } from "./services/payroll-service.ts";
import { createClaimant, getClaimant, listClaimants, createClaim as createExpenseClaim, submitClaim, reviewClaim as reviewExpenseClaim, postClaim, getClaim as getExpenseClaim, listClaims as listExpenseClaims, issueAdvance, getAdvance, listAdvances, repayAdvance, recordReimbursement, expenseRegister, expenseOpenItems, evidenceExceptions, type ClaimantCreatePayload, type ClaimantView, type ExpenseClaimCreatePayload, type ExpenseClaimSubmitPayload, type ExpenseClaimReviewPayload, type ExpenseClaimPostPayload, type ExpenseClaimView, type ExpenseAdvanceIssuePayload, type ExpenseAdvanceRepayPayload, type ExpenseAdvanceView, type ExpenseReimbursementPayload, type ExpenseRegisterRow, type ExpenseOpenItems, type ExpenseEvidenceException } from "./services/expense-claims-service.ts";
import { createFactProfile, getFactProfile, listFactProfiles, createRuleSnapshot as createComplianceRuleSnapshot, getRuleSnapshot, listRuleSnapshots, createDeadlineSnapshot, getDeadlineSnapshot, listDeadlineSnapshots, createRulePredecessor, evaluateApplicability, getApplicabilityDecision, listApplicabilityDecisions, generateObligation, getObligation, listObligations, calendar, attachArtifact, recordObligationEvent, complianceStatus, type ComplianceEnvelope, type ComplianceFactProfileCreatePayload, type ComplianceRuleCreatePayload, type ComplianceDeadlineCreatePayload, type CompliancePredecessorCreatePayload, type ComplianceApplicabilityPayload, type ComplianceGeneratePayload, type ComplianceArtifactAttachPayload, type ComplianceEventPayload, type ObligationStatus } from "./services/compliance-obligations-service.ts";
import { PeriodCloseService, type PeriodClosePayload, type PeriodReopenPayload, type PeriodPlan, type PeriodEventResult } from "./services/period-close-service.ts";
import { ClosePackService, type ClosePackExportPayload, type ClosePackExportResult, type ClosePackManifest } from "./services/close-pack-service.ts";
import { FiscalYearRolloverService, type FiscalYearRolloverFinalizePayload, type FiscalYearRolloverPreview, type FiscalYearRolloverResult } from "./services/fiscal-year-rollover-service.ts";
import { registerMcaFormPack, verifyMcaFormPack, rejectMcaFormPack, showMcaFormPack, proposeMcaCompanyFact, confirmMcaCompanyFact, rejectMcaCompanyFact, listMcaCompanyFacts, previewMcaAnnual, prepareMcaAnnual, validateMcaAnnual, exportMcaAnnual, showMcaAnnual, statusMcaAnnual, contentMcaAnnual, packageStatusMcaAnnual } from "./services/mca-annual-filing-artifact-service.ts";
import type { McaFormPackRegisterPayload, McaFormPackDecisionPayload, McaCompanyFactPayload, McaCompanyFactDecisionPayload, McaAnnualArtifactBindingPayload, McaAnnualArtifactValidatePayload, McaAnnualArtifactExportPayload } from "./commands.ts";
import { executeTenantPanSet, getTenantPanProfile, revealTenantPan, type TenantPanProfileView, type TenantPanReveal, type TenantPanSetPayload, type TenantPanSetResult } from "./services/tenant-pan-service.ts";
import { createTaxCase, refreshTaxCaseMembership, taxCaseStatus, importTaxCaseSource, listTaxCaseSources, taxCaseSourceStatus, type TaxCaseStatus } from "./services/tax-case-service.ts";
import { proposeTaxCaseFact, confirmTaxCaseFact, rejectTaxCaseFact, listTaxCaseFacts, recordTaxCaseReconciliation, listTaxCaseReconciliations, taxCaseFactSummary } from "./services/tax-case-facts-service.ts";
import { prepareTaxCaseSourceAssessment, confirmTaxCaseSourceAssessment, rejectTaxCaseSourceAssessment, showTaxCaseSourceAssessment, taxCaseSourceReadinessStatus } from "./services/tax-case-source-readiness-service.ts";
import { previewTaxCaseFilingSnapshot, sealTaxCaseFilingSnapshot, showTaxCaseFilingSnapshot, statusTaxCaseFilingSnapshot, type FilingSnapshotPreview } from "./services/tax-case-filing-snapshot-service.ts";
import { generateTaxCasePositionWorksheet, previewTaxCasePositionWorksheet, showTaxCasePositionWorksheet, statusTaxCasePositionWorksheet, type TaxPositionWorksheet, type TaxPositionWorksheetView } from "./services/tax-case-position-worksheet-service.ts";
import { registerPersonalTaxAuthorityPack, verifyPersonalTaxAuthorityPack, rejectPersonalTaxAuthorityPack, showPersonalTaxAuthorityPack, recordTaxCaseEligibilityFact, evaluateTaxCaseItrEligibility, showTaxCaseItrEligibility, selectTaxCaseItrForm, statusTaxCaseItrForm } from "./services/tax-case-itr-eligibility-service.ts";
import type { TaxCaseCreatePayload, TaxCaseMembershipRefreshPayload, TaxCaseSourceImportPayload, TaxCaseFactProposePayload, TaxCaseFactDecisionPayload, TaxCaseReconciliationRecordPayload, TaxCaseFilingSnapshotSealPayload, TaxCasePositionGeneratePayload, TaxCaseSourceAssessmentPreparePayload, TaxCaseSourceAssessmentDecisionPayload, AuthorityPackRegisterPayload, AuthorityPackDecisionPayload, TaxCaseEligibilityFactRecordPayload, TaxCaseItrEligibilityEvaluatePayload, TaxCaseItrFormSelectPayload } from "./commands.ts";
import type { ComputationPackRegisterPayload, ComputationPackDecisionPayload, ComputationInputsRecordPayload, ComputationApprovePayload, ReturnSchemaPackRegisterPayload, ReturnSchemaPackDecisionPayload, ReturnArtifactBindingPayload, ReturnArtifactValidatePayload, ReturnArtifactExportPayload, WithholdingStatementSchemaPackRegisterPayload, WithholdingStatementSchemaPackDecisionPayload, WithholdingStatementFactPayload, WithholdingStatementFactDecisionPayload, WithholdingStatementBindingPayload, WithholdingStatementArtifactValidatePayload, WithholdingStatementArtifactExportPayload } from "./commands.ts";
import { registerPersonalTaxComputationPack, verifyPersonalTaxComputationPack, rejectPersonalTaxComputationPack, showPersonalTaxComputationPack, recordPersonalTaxComputationInputs, previewPersonalTaxComputation, generatePersonalTaxComputation, showPersonalTaxComputation, statusPersonalTaxComputation, approvePersonalTaxComputation } from "./services/tax-case-computation-service.ts";
import { registerReturnSchemaPack, verifyReturnSchemaPack, rejectReturnSchemaPack, showReturnSchemaPack, previewReturnArtifact, prepareReturnArtifact, validateReturnArtifact, exportReturnArtifact, showReturnArtifact, statusReturnArtifact, contentReturnArtifact } from "./services/tax-case-return-artifact-service.ts";
import { registerWithholdingStatementSchemaPack, verifyWithholdingStatementSchemaPack, rejectWithholdingStatementSchemaPack, showWithholdingStatementSchemaPack, proposeWithholdingStatementFact, confirmWithholdingStatementFact, rejectWithholdingStatementFact, listWithholdingStatementFacts, previewWithholdingStatement, prepareWithholdingStatement, validateWithholdingStatement, exportWithholdingStatement, showWithholdingStatement, statusWithholdingStatement, contentWithholdingStatement } from "./services/withholding-statement-artifact-service.ts";
import { registerPayrollStatutoryPack, verifyPayrollStatutoryPack, rejectPayrollStatutoryPack, showPayrollStatutoryPack, previewPayrollStatutoryArtifact, preparePayrollStatutoryArtifact, validatePayrollStatutoryArtifact, exportPayrollStatutoryArtifact, showPayrollStatutoryArtifact, statusPayrollStatutoryArtifact, contentPayrollStatutoryArtifact } from "./services/payroll-statutory-artifact-service.ts";
import type { PayrollStatutoryPackRegisterPayload, PayrollStatutoryPackDecisionPayload, PayrollStatutoryArtifactBindingPayload, PayrollStatutoryArtifactValidatePayload, PayrollStatutoryArtifactExportPayload } from "./commands.ts";

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
export interface AccountCommands { create(envelope: SalesCommandEnvelope<AccountCreatePayload>): Promise<CommandResult<AccountCreateResult>>; }

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
  inspectFile(envelope: SourceFileEnvelope): Promise<SourceFilePreview>;
  importFile(envelope: SourceFileEnvelope): Promise<CommandResult<SourceImportResult>>;
  get(tenantId: TenantId, bookSetId: BookSetId, statementId: string): Promise<BankStatementView>;
  list(tenantId: TenantId, bookSetId: BookSetId, filter?: { statementId?: string }): Promise<BankStatementView[]>;
}
export interface ZohoBackupCommands {
  preview(envelope: ZohoBackupEnvelope): Promise<ZohoBackupPreview>;
  import(envelope: ZohoBackupEnvelope): Promise<CommandResult<ZohoBackupReport>>;
  status(tenantId: TenantId, bookSetId: BookSetId, importId: string): Promise<ZohoBackupReport & { reportHash: string; sourceId: string }>;
}
export interface SourceStagingCommands {
  preview(envelope: SourceStagingEnvelope): SourceStagingPreview;
  stage(envelope: SourceStagingEnvelope): Promise<CommandResult<SourceStagingReport>>;
  status(tenantId: TenantId, bookSetId: BookSetId, stagingId: string): Promise<SourceStagingReport>;
  list(tenantId: TenantId, bookSetId: BookSetId, limit?: number): Promise<SourceStagingListResult>;
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
export interface GstGstr1ArtifactOperations {
  schemaPack: { register(envelope: CommandEnvelope<GstReturnSchemaPackRegisterPayload>): Promise<CommandResult<Record<string, unknown>>>; verify(envelope: CommandEnvelope<GstReturnSchemaPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; reject(envelope: CommandEnvelope<GstReturnSchemaPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; show(packId: string): Promise<Record<string, unknown>> };
  artifact: { preview(tenantId: TenantId, bookSetId: BookSetId, payload: Gstr1ArtifactBindingPayload): Promise<Record<string, unknown>>; prepare(envelope: CommandEnvelope<Gstr1ArtifactBindingPayload>): Promise<CommandResult<Record<string, unknown>>>; validate(envelope: CommandEnvelope<Gstr1ArtifactValidatePayload>): Promise<CommandResult<Record<string, unknown>>>; export(envelope: CommandEnvelope<Gstr1ArtifactExportPayload>): Promise<CommandResult<Record<string, unknown>>>; show(tenantId: TenantId, bookSetId: BookSetId, artifactId: string): Promise<Record<string, unknown>>; status(tenantId: TenantId, bookSetId: BookSetId, artifactId: string): Promise<Record<string, unknown>>; content(tenantId: TenantId, bookSetId: BookSetId, artifactId: string, revealSensitive?: boolean, actorKind?: string): Promise<Record<string, unknown>> };
}
export interface GstGstr3bArtifactOperations {
  schemaPack: { register(envelope: CommandEnvelope<GstGstr3bSchemaPackRegisterPayload>): Promise<CommandResult<Record<string, unknown>>>; verify(envelope: CommandEnvelope<GstGstr3bSchemaPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; reject(envelope: CommandEnvelope<GstGstr3bSchemaPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; show(packId: string): Promise<Record<string, unknown>> };
  fact: { propose(envelope: SalesCommandEnvelope<GstGstr3bFactPayload>): Promise<CommandResult<Record<string, unknown>>>; confirm(envelope: SalesCommandEnvelope<GstGstr3bFactDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; reject(envelope: SalesCommandEnvelope<GstGstr3bFactDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<Record<string, unknown>[]> };
  artifact: { preview(tenantId: TenantId, payload: GstGstr3bArtifactBindingPayload): Promise<Record<string, unknown>>; prepare(envelope: SalesCommandEnvelope<GstGstr3bArtifactBindingPayload>): Promise<CommandResult<Record<string, unknown>>>; validate(envelope: SalesCommandEnvelope<GstGstr3bArtifactValidatePayload>): Promise<CommandResult<Record<string, unknown>>>; export(envelope: SalesCommandEnvelope<GstGstr3bArtifactExportPayload>): Promise<CommandResult<Record<string, unknown>>>; show(tenantId: TenantId, bookSetId: BookSetId, artifactId: string): Promise<Record<string, unknown>>; status(tenantId: TenantId, bookSetId: BookSetId, artifactId: string): Promise<Record<string, unknown>>; content(tenantId: TenantId, bookSetId: BookSetId, artifactId: string, revealSensitive?: boolean, actorKind?: string): Promise<Record<string, unknown>> };
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
export interface WithholdingStatementOperations {
  schemaPack: { register(envelope: CommandEnvelope<WithholdingStatementSchemaPackRegisterPayload>): Promise<CommandResult<Record<string, unknown>>>; verify(envelope: CommandEnvelope<WithholdingStatementSchemaPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; reject(envelope: CommandEnvelope<WithholdingStatementSchemaPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; show(packId: string): Promise<Record<string, unknown>> };
  fact: { propose(envelope: CommandEnvelope<WithholdingStatementFactPayload>): Promise<CommandResult<Record<string, unknown>>>; confirm(envelope: CommandEnvelope<WithholdingStatementFactDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; reject(envelope: CommandEnvelope<WithholdingStatementFactDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<Record<string, unknown>[]> };
  statement: { preview(tenantId: TenantId, payload: WithholdingStatementBindingPayload): Promise<Record<string, unknown>>; prepare(envelope: CommandEnvelope<WithholdingStatementBindingPayload>): Promise<CommandResult<Record<string, unknown>>>; validate(envelope: CommandEnvelope<WithholdingStatementArtifactValidatePayload>): Promise<CommandResult<Record<string, unknown>>>; export(envelope: CommandEnvelope<WithholdingStatementArtifactExportPayload>): Promise<CommandResult<Record<string, unknown>>>; show(tenantId: TenantId, bookSetId: BookSetId, artifactId: string): Promise<Record<string, unknown>>; status(tenantId: TenantId, bookSetId: BookSetId, artifactId: string): Promise<Record<string, unknown>>; content(tenantId: TenantId, bookSetId: BookSetId, artifactId: string, revealSensitive?: boolean, actorKind?: string): Promise<Record<string, unknown>> };
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
  statutory: {
    pack: { register(envelope: CommandEnvelope<PayrollStatutoryPackRegisterPayload> & { bookSetId: BookSetId }): Promise<CommandResult<Record<string, unknown>>>; verify(envelope: CommandEnvelope<PayrollStatutoryPackDecisionPayload> & { bookSetId: BookSetId }): Promise<CommandResult<Record<string, unknown>>>; reject(envelope: CommandEnvelope<PayrollStatutoryPackDecisionPayload> & { bookSetId: BookSetId }): Promise<CommandResult<Record<string, unknown>>>; show(packId: string): Promise<Record<string, unknown>> };
    artifact: { preview(tenantId: TenantId, payload: PayrollStatutoryArtifactBindingPayload): Promise<Record<string, unknown>>; prepare(envelope: CommandEnvelope<PayrollStatutoryArtifactBindingPayload> & { bookSetId: BookSetId }): Promise<CommandResult<Record<string, unknown>>>; validate(envelope: CommandEnvelope<PayrollStatutoryArtifactValidatePayload> & { bookSetId: BookSetId }): Promise<CommandResult<Record<string, unknown>>>; export(envelope: CommandEnvelope<PayrollStatutoryArtifactExportPayload> & { bookSetId: BookSetId }): Promise<CommandResult<Record<string, unknown>>>; show(tenantId: TenantId, bookSetId: BookSetId, artifactId: string): Promise<Record<string, unknown>>; status(tenantId: TenantId, bookSetId: BookSetId, artifactId: string): Promise<Record<string, unknown>>; content(tenantId: TenantId, bookSetId: BookSetId, artifactId: string, revealSensitive?: boolean, actorKind?: string): Promise<Record<string, unknown>> };
  };
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

export interface FiscalYearRolloverOperations {
  preview(tenantId: TenantId, bookSetId: BookSetId, financialYear: string): Promise<FiscalYearRolloverPreview>;
  finalize(envelope: CommandEnvelope<FiscalYearRolloverFinalizePayload> & { bookSetId: BookSetId }): Promise<CommandResult<FiscalYearRolloverResult>>;
  show(tenantId: TenantId, bookSetId: BookSetId, financialYear: string, rolloverId: string): Promise<Record<string, unknown>>;
  status(tenantId: TenantId, bookSetId: BookSetId, financialYear: string): Promise<Record<string, unknown>>;
  export(tenantId: TenantId, bookSetId: BookSetId, financialYear: string, rolloverId: string, format: string): Promise<Record<string, unknown>>;
}

export interface McaAnnualOperations {
  formPack: { register(envelope: CommandEnvelope<McaFormPackRegisterPayload>): Promise<CommandResult<Record<string, unknown>>>; verify(envelope: CommandEnvelope<McaFormPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; reject(envelope: CommandEnvelope<McaFormPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; show(packId: string): Promise<Record<string, unknown>> };
  fact: { propose(envelope: CommandEnvelope<McaCompanyFactPayload> & { bookSetId: BookSetId }): Promise<CommandResult<Record<string, unknown>>>; confirm(envelope: CommandEnvelope<McaCompanyFactDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; reject(envelope: CommandEnvelope<McaCompanyFactDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; list(tenantId: TenantId, bookSetId: BookSetId): Promise<Record<string, unknown>[]> };
  annual: { preview(tenantId: TenantId, payload: McaAnnualArtifactBindingPayload): Promise<Record<string, unknown>>; prepare(envelope: CommandEnvelope<McaAnnualArtifactBindingPayload>): Promise<CommandResult<Record<string, unknown>>>; validate(envelope: CommandEnvelope<McaAnnualArtifactValidatePayload>): Promise<CommandResult<Record<string, unknown>>>; export(envelope: CommandEnvelope<McaAnnualArtifactExportPayload>): Promise<CommandResult<Record<string, unknown>>>; show(tenantId: TenantId, bookSetId: BookSetId, artifactId: string): Promise<Record<string, unknown>>; status(tenantId: TenantId, bookSetId: BookSetId, artifactId: string): Promise<Record<string, unknown>>; content(tenantId: TenantId, bookSetId: BookSetId, artifactId: string, revealSensitive?: boolean, actorKind?: string): Promise<Record<string, unknown>>; packageStatus(tenantId: TenantId, bookSetId: BookSetId, financialYear: string): Promise<Record<string, unknown>> };
}

export interface TaxCaseOperations {
  create(envelope: CommandEnvelope<TaxCaseCreatePayload>): Promise<CommandResult<Record<string, unknown>>>;
  membershipRefresh(envelope: CommandEnvelope<TaxCaseMembershipRefreshPayload>): Promise<CommandResult<Record<string, unknown>>>;
  status(tenantId: TenantId, taxCaseId: string): Promise<TaxCaseStatus>;
  source: {
    import(envelope: CommandEnvelope<TaxCaseSourceImportPayload>): Promise<CommandResult<Record<string, unknown>>>;
    list(tenantId: TenantId, taxCaseId: string): Promise<Record<string, unknown>[]>;
    status(tenantId: TenantId, taxCaseId: string, sourceId: string): Promise<Record<string, unknown>>;
    assessment: {
      prepare(envelope: CommandEnvelope<TaxCaseSourceAssessmentPreparePayload>): Promise<CommandResult<Record<string, unknown>>>;
      confirm(envelope: CommandEnvelope<TaxCaseSourceAssessmentDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>;
      reject(envelope: CommandEnvelope<TaxCaseSourceAssessmentDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>;
      show(tenantId: TenantId, taxCaseId: string, sourceId: string, assessmentId: string): Promise<Record<string, unknown>>;
    };
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
  position: {
    preview(tenantId: TenantId, taxCaseId: string, filingSnapshotId: string): Promise<TaxPositionWorksheet>;
    generate(envelope: CommandEnvelope<TaxCasePositionGeneratePayload>): Promise<CommandResult<Record<string, unknown>>>;
    show(tenantId: TenantId, taxCaseId: string, worksheetId: string): Promise<TaxPositionWorksheetView>;
    status(tenantId: TenantId, taxCaseId: string, worksheetId: string): Promise<Record<string, unknown>>;
  };
  eligibilityFacts: { record(envelope: CommandEnvelope<TaxCaseEligibilityFactRecordPayload>): Promise<CommandResult<Record<string, unknown>>> };
  itrEligibility: { evaluate(envelope: CommandEnvelope<TaxCaseItrEligibilityEvaluatePayload>): Promise<CommandResult<Record<string, unknown>>>; show(tenantId: TenantId, taxCaseId: string, evaluationId: string): Promise<Record<string, unknown>> };
  itrForm: { select(envelope: CommandEnvelope<TaxCaseItrFormSelectPayload>): Promise<CommandResult<Record<string, unknown>>>; status(tenantId: TenantId, taxCaseId: string, selectionId?: string): Promise<Record<string, unknown>> };
  computationInputs: { record(envelope: CommandEnvelope<ComputationInputsRecordPayload>): Promise<CommandResult<Record<string, unknown>>> };
  computation: { preview(tenantId: TenantId, payload: ComputationInputsRecordPayload): Promise<Record<string, unknown>>; generate(envelope: CommandEnvelope<ComputationInputsRecordPayload & { inputSetId?: string }>): Promise<CommandResult<Record<string, unknown>>>; show(tenantId: TenantId, taxCaseId: string, computationId: string): Promise<Record<string, unknown>>; status(tenantId: TenantId, taxCaseId: string, computationId: string): Promise<Record<string, unknown>>; approve(envelope: CommandEnvelope<ComputationApprovePayload>): Promise<CommandResult<Record<string, unknown>>> };
  returnArtifact: { preview(tenantId: TenantId, payload: ReturnArtifactBindingPayload): Promise<Record<string, unknown>>; prepare(envelope: CommandEnvelope<ReturnArtifactBindingPayload>): Promise<CommandResult<Record<string, unknown>>>; validate(envelope: CommandEnvelope<ReturnArtifactValidatePayload>): Promise<CommandResult<Record<string, unknown>>>; export(envelope: CommandEnvelope<ReturnArtifactExportPayload>): Promise<CommandResult<Record<string, unknown>>>; show(tenantId: TenantId, taxCaseId: string, artifactId: string): Promise<Record<string, unknown>>; status(tenantId: TenantId, taxCaseId: string, artifactId: string): Promise<Record<string, unknown>>; content(tenantId: TenantId, taxCaseId: string, artifactId: string, revealSensitive?: boolean, actorKind?: string): Promise<Record<string, unknown>> };
}

export interface TaxAuthorityOperations {
  pack: { register(envelope: CommandEnvelope<AuthorityPackRegisterPayload>): Promise<CommandResult<Record<string, unknown>>>; verify(envelope: CommandEnvelope<AuthorityPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; reject(envelope: CommandEnvelope<AuthorityPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; show(packId: string): Promise<Record<string, unknown>> };
  computationPack: { register(envelope: CommandEnvelope<ComputationPackRegisterPayload>): Promise<CommandResult<Record<string, unknown>>>; verify(envelope: CommandEnvelope<ComputationPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; reject(envelope: CommandEnvelope<ComputationPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; show(packId: string): Promise<Record<string, unknown>> };
  returnSchemaPack: { register(envelope: CommandEnvelope<ReturnSchemaPackRegisterPayload>): Promise<CommandResult<Record<string, unknown>>>; verify(envelope: CommandEnvelope<ReturnSchemaPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; reject(envelope: CommandEnvelope<ReturnSchemaPackDecisionPayload>): Promise<CommandResult<Record<string, unknown>>>; show(packId: string): Promise<Record<string, unknown>> };
}

/**
 * Public application facade: typed read and command interfaces.
 * No raw service mutators or persistence handles escape.
 */
export type PublicApplicationFacade = {
  tenant: TenantReadOperations & TenantCommands & { pan: TenantPanOperations };
  bookSet: BookSetReadOperations & BookSetCommands;
  account: AccountReadOperations & AccountCommands;
  bookSetScope: BookSetScopeOperations;
  journal: JournalCommands;
  ledger: LedgerReportOperations;
  party: PartyCommands;
  invoice: InvoiceCommands;
  receipt: ReceiptCommands;
  bill: BillCommands;
  vendorPayment: VendorPaymentCommands;
  bankStatement: BankStatementCommands;
  zohoBackup: ZohoBackupCommands;
  sourceStaging: SourceStagingCommands;
  bankMatch: BankMatchCommands;
  bankReconciliation: BankReconciliationOperations;
  gst: { registration: GstRegistrationOperations; partyProfile: PartyGstProfileOperations; register: GstRegisterOperations; returnReadiness: GstReturnReadinessOperations; gstr1Artifact: GstGstr1ArtifactOperations; gstr3bArtifact: GstGstr3bArtifactOperations };
  tax: TaxOperations;
  withholdingStatement: WithholdingStatementOperations;
  fixedAssets: FixedAssetOperations;
  fx: FxOperations;
  company: CompanyStatusOperations;
  payroll: PayrollOperations;
  expense: ExpenseOperations;
  compliance: ComplianceOperations;
  periodClose: PeriodCloseOperations;
  closePack: ClosePackOperations;
  fiscalYearRollover: FiscalYearRolloverOperations;
  mca: McaAnnualOperations;
  taxCase: TaxCaseOperations;
  taxAuthority: TaxAuthorityOperations;
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
  sourceRoot?: string,
): PublicApplicationFacade {
  const periodCloseService = new PeriodCloseService(sessionRunner);
  const closePackService = new ClosePackService(sessionRunner);
  const fiscalYearRolloverService = new FiscalYearRolloverService(sessionRunner);
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
      create: (envelope) => executeAccountCreate(sessionRunner, envelope),
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
    bankStatement: { import: (envelope) => executeBankStatementImport(sessionRunner, envelope), inspectFile: (envelope) => inspectBankFileForScope(sessionRunner, envelope, sourceRoot), importFile: (envelope) => importBankFile(sessionRunner, envelope, sourceRoot), get: (tenantId, bookSetId, statementId) => getBankStatement(sessionRunner, tenantId, bookSetId, statementId), list: (tenantId, bookSetId, filter) => listBankStatements(sessionRunner, tenantId, bookSetId, filter) },
    zohoBackup: { preview: (envelope) => previewZohoBackup(sessionRunner, envelope, sourceRoot), import: (envelope) => importZohoBackup(sessionRunner, envelope, sourceRoot), status: (tenantId, bookSetId, importId) => statusZohoBackup(sessionRunner, tenantId, bookSetId, importId) },
    sourceStaging: { preview: (envelope) => previewSourceStaging(envelope, sourceRoot), stage: (envelope) => stageSource(sessionRunner, envelope, sourceRoot), status: (tenantId, bookSetId, stagingId) => statusSourceStaging(sessionRunner, tenantId, bookSetId, stagingId), list: (tenantId, bookSetId, limit) => listSourceStaging(sessionRunner, tenantId, bookSetId, limit) },
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
      gstr1Artifact: {
        schemaPack: { register: (envelope) => registerGstReturnSchemaPack(sessionRunner, envelope), verify: (envelope) => verifyGstReturnSchemaPack(sessionRunner, envelope), reject: (envelope) => rejectGstReturnSchemaPack(sessionRunner, envelope), show: (packId) => showGstReturnSchemaPack(sessionRunner, packId) },
        artifact: { preview: (tenantId, bookSetId, payload) => previewGstr1Artifact(sessionRunner, tenantId, bookSetId, payload), prepare: (envelope) => prepareGstr1Artifact(sessionRunner, envelope as never), validate: (envelope) => validateGstr1Artifact(sessionRunner, envelope as never), export: (envelope) => exportGstr1Artifact(sessionRunner, envelope as never), show: (tenantId, bookSetId, artifactId) => showGstr1Artifact(sessionRunner, tenantId, bookSetId, artifactId), status: (tenantId, bookSetId, artifactId) => statusGstr1Artifact(sessionRunner, tenantId, bookSetId, artifactId), content: (tenantId, bookSetId, artifactId, revealSensitive, actorKind) => contentGstr1Artifact(sessionRunner, tenantId, bookSetId, artifactId, revealSensitive, actorKind) },
      },
      gstr3bArtifact: {
        schemaPack: { register: (envelope) => registerGstGstr3bSchemaPack(sessionRunner, envelope), verify: (envelope) => verifyGstGstr3bSchemaPack(sessionRunner, envelope), reject: (envelope) => rejectGstGstr3bSchemaPack(sessionRunner, envelope), show: (packId) => showGstGstr3bSchemaPack(sessionRunner, packId) },
        fact: { propose: (envelope) => proposeGstGstr3bFact(sessionRunner, envelope as never), confirm: (envelope) => confirmGstGstr3bFact(sessionRunner, envelope as never), reject: (envelope) => rejectGstGstr3bFact(sessionRunner, envelope as never), list: (tenantId, bookSetId) => listGstGstr3bFacts(sessionRunner, tenantId, bookSetId) },
        artifact: { preview: (tenantId, payload) => previewGstGstr3b(sessionRunner, tenantId, payload), prepare: (envelope) => prepareGstGstr3b(sessionRunner, envelope as never), validate: (envelope) => validateGstGstr3b(sessionRunner, envelope as never), export: (envelope) => exportGstGstr3b(sessionRunner, envelope as never), show: (tenantId, bookSetId, artifactId) => showGstGstr3b(sessionRunner, tenantId, bookSetId, artifactId), status: (tenantId, bookSetId, artifactId) => statusGstGstr3b(sessionRunner, tenantId, bookSetId, artifactId), content: (tenantId, bookSetId, artifactId, revealSensitive, actorKind) => contentGstGstr3b(sessionRunner, tenantId, bookSetId, artifactId, revealSensitive, actorKind) },
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
      statutory: {
        pack: { register: (envelope) => registerPayrollStatutoryPack(sessionRunner, envelope), verify: (envelope) => verifyPayrollStatutoryPack(sessionRunner, envelope), reject: (envelope) => rejectPayrollStatutoryPack(sessionRunner, envelope), show: (packId) => showPayrollStatutoryPack(sessionRunner, packId) },
        artifact: { preview: (tenantId, payload) => previewPayrollStatutoryArtifact(sessionRunner, tenantId, payload), prepare: (envelope) => preparePayrollStatutoryArtifact(sessionRunner, envelope), validate: (envelope) => validatePayrollStatutoryArtifact(sessionRunner, envelope), export: (envelope) => exportPayrollStatutoryArtifact(sessionRunner, envelope), show: (tenantId, bookSetId, artifactId) => showPayrollStatutoryArtifact(sessionRunner, tenantId, bookSetId, artifactId), status: (tenantId, bookSetId, artifactId) => statusPayrollStatutoryArtifact(sessionRunner, tenantId, bookSetId, artifactId), content: (tenantId, bookSetId, artifactId, revealSensitive, actorKind) => contentPayrollStatutoryArtifact(sessionRunner, tenantId, bookSetId, artifactId, revealSensitive, actorKind) },
      },
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
    fiscalYearRollover: {
      preview: (tenantId, bookSetId, financialYear) => fiscalYearRolloverService.preview(tenantId, bookSetId, financialYear),
      finalize: (envelope) => fiscalYearRolloverService.finalize(envelope),
      show: (tenantId, bookSetId, financialYear, rolloverId) => fiscalYearRolloverService.show(tenantId, bookSetId, financialYear, rolloverId),
      status: (tenantId, bookSetId, financialYear) => fiscalYearRolloverService.status(tenantId, bookSetId, financialYear),
      export: (tenantId, bookSetId, financialYear, rolloverId, format) => fiscalYearRolloverService.export(tenantId, bookSetId, financialYear, rolloverId, format),
    },
    mca: {
      formPack: { register: (envelope) => registerMcaFormPack(sessionRunner, envelope), verify: (envelope) => verifyMcaFormPack(sessionRunner, envelope), reject: (envelope) => rejectMcaFormPack(sessionRunner, envelope), show: (packId) => showMcaFormPack(sessionRunner, packId) },
      fact: { propose: (envelope) => proposeMcaCompanyFact(sessionRunner, envelope as never), confirm: (envelope) => confirmMcaCompanyFact(sessionRunner, envelope), reject: (envelope) => rejectMcaCompanyFact(sessionRunner, envelope), list: (tenantId, bookSetId) => listMcaCompanyFacts(sessionRunner, tenantId, bookSetId) },
      annual: { preview: (tenantId, payload) => previewMcaAnnual(sessionRunner, tenantId, payload as never), prepare: (envelope) => prepareMcaAnnual(sessionRunner, envelope as never), validate: (envelope) => validateMcaAnnual(sessionRunner, envelope), export: (envelope) => exportMcaAnnual(sessionRunner, envelope), show: (tenantId, bookSetId, artifactId) => showMcaAnnual(sessionRunner, tenantId, bookSetId, artifactId), status: (tenantId, bookSetId, artifactId) => statusMcaAnnual(sessionRunner, tenantId, bookSetId, artifactId), content: (tenantId, bookSetId, artifactId, revealSensitive, actorKind) => contentMcaAnnual(sessionRunner, tenantId, bookSetId, artifactId, revealSensitive, actorKind), packageStatus: (tenantId, bookSetId, financialYear) => packageStatusMcaAnnual(sessionRunner, tenantId, bookSetId, financialYear) },
    },
    taxCase: {
      create: (envelope) => createTaxCase(sessionRunner, envelope),
      membershipRefresh: (envelope) => refreshTaxCaseMembership(sessionRunner, envelope),
      status: (tenantId, taxCaseId) => taxCaseStatus(sessionRunner, tenantId, taxCaseId),
      source: {
        import: (envelope) => importTaxCaseSource(sessionRunner, envelope),
        list: (tenantId, taxCaseId) => listTaxCaseSources(sessionRunner, tenantId, taxCaseId),
        status: async (tenantId, taxCaseId, sourceId) => ({ ...(await taxCaseSourceStatus(sessionRunner, tenantId, taxCaseId, sourceId)), ...(await taxCaseSourceReadinessStatus(sessionRunner, tenantId, taxCaseId, sourceId)) }),
        assessment: {
          prepare: (envelope) => prepareTaxCaseSourceAssessment(sessionRunner, envelope),
          confirm: (envelope) => confirmTaxCaseSourceAssessment(sessionRunner, envelope),
          reject: (envelope) => rejectTaxCaseSourceAssessment(sessionRunner, envelope),
          show: (tenantId, taxCaseId, sourceId, assessmentId) => showTaxCaseSourceAssessment(sessionRunner, tenantId, taxCaseId, sourceId, assessmentId),
        },
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
      position: {
        preview: (tenantId, taxCaseId, filingSnapshotId) => previewTaxCasePositionWorksheet(sessionRunner, tenantId, taxCaseId, filingSnapshotId),
        generate: (envelope) => generateTaxCasePositionWorksheet(sessionRunner, envelope),
        show: (tenantId, taxCaseId, worksheetId) => showTaxCasePositionWorksheet(sessionRunner, tenantId, taxCaseId, worksheetId),
        status: (tenantId, taxCaseId, worksheetId) => statusTaxCasePositionWorksheet(sessionRunner, tenantId, taxCaseId, worksheetId),
      },
      eligibilityFacts: { record: (envelope) => recordTaxCaseEligibilityFact(sessionRunner, envelope) },
      itrEligibility: { evaluate: (envelope) => evaluateTaxCaseItrEligibility(sessionRunner, envelope), show: (tenantId, taxCaseId, evaluationId) => showTaxCaseItrEligibility(sessionRunner, tenantId, taxCaseId, evaluationId) },
      itrForm: { select: (envelope) => selectTaxCaseItrForm(sessionRunner, envelope), status: (tenantId, taxCaseId, selectionId) => statusTaxCaseItrForm(sessionRunner, tenantId, taxCaseId, selectionId) },
      computationInputs: { record: (envelope) => recordPersonalTaxComputationInputs(sessionRunner, envelope) },
      computation: { preview: (tenantId, payload) => previewPersonalTaxComputation(sessionRunner, tenantId, payload), generate: (envelope) => generatePersonalTaxComputation(sessionRunner, envelope), show: (tenantId, taxCaseId, computationId) => showPersonalTaxComputation(sessionRunner, tenantId, taxCaseId, computationId), status: (tenantId, taxCaseId, computationId) => statusPersonalTaxComputation(sessionRunner, tenantId, taxCaseId, computationId), approve: (envelope) => approvePersonalTaxComputation(sessionRunner, envelope) },
      returnArtifact: { preview: (tenantId, payload) => previewReturnArtifact(sessionRunner, tenantId, payload), prepare: (envelope) => prepareReturnArtifact(sessionRunner, envelope), validate: (envelope) => validateReturnArtifact(sessionRunner, envelope), export: (envelope) => exportReturnArtifact(sessionRunner, envelope), show: (tenantId, taxCaseId, artifactId) => showReturnArtifact(sessionRunner, tenantId, taxCaseId, artifactId), status: (tenantId, taxCaseId, artifactId) => statusReturnArtifact(sessionRunner, tenantId, taxCaseId, artifactId), content: (tenantId, taxCaseId, artifactId, revealSensitive, actorKind) => contentReturnArtifact(sessionRunner, tenantId, taxCaseId, artifactId, revealSensitive, actorKind) },
    },
    taxAuthority: { pack: { register: (envelope) => registerPersonalTaxAuthorityPack(sessionRunner, envelope), verify: (envelope) => verifyPersonalTaxAuthorityPack(sessionRunner, envelope), reject: (envelope) => rejectPersonalTaxAuthorityPack(sessionRunner, envelope), show: (packId) => showPersonalTaxAuthorityPack(sessionRunner, packId) }, computationPack: { register: (envelope) => registerPersonalTaxComputationPack(sessionRunner, envelope), verify: (envelope) => verifyPersonalTaxComputationPack(sessionRunner, envelope), reject: (envelope) => rejectPersonalTaxComputationPack(sessionRunner, envelope), show: (packId) => showPersonalTaxComputationPack(sessionRunner, packId) }, returnSchemaPack: { register: (envelope) => registerReturnSchemaPack(sessionRunner, envelope), verify: (envelope) => verifyReturnSchemaPack(sessionRunner, envelope), reject: (envelope) => rejectReturnSchemaPack(sessionRunner, envelope), show: (packId) => showReturnSchemaPack(sessionRunner, packId) } },
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
    withholdingStatement: {
      schemaPack: { register: (envelope) => registerWithholdingStatementSchemaPack(sessionRunner, envelope), verify: (envelope) => verifyWithholdingStatementSchemaPack(sessionRunner, envelope), reject: (envelope) => rejectWithholdingStatementSchemaPack(sessionRunner, envelope), show: (packId) => showWithholdingStatementSchemaPack(sessionRunner, packId) },
      fact: { propose: (envelope) => proposeWithholdingStatementFact(sessionRunner, envelope), confirm: (envelope) => confirmWithholdingStatementFact(sessionRunner, envelope), reject: (envelope) => rejectWithholdingStatementFact(sessionRunner, envelope), list: (tenantId, bookSetId) => listWithholdingStatementFacts(sessionRunner, tenantId, bookSetId) },
      statement: { preview: (tenantId, payload) => previewWithholdingStatement(sessionRunner, tenantId, payload), prepare: (envelope) => prepareWithholdingStatement(sessionRunner, envelope), validate: (envelope) => validateWithholdingStatement(sessionRunner, envelope), export: (envelope) => exportWithholdingStatement(sessionRunner, envelope), show: (tenantId, bookSetId, artifactId) => showWithholdingStatement(sessionRunner, tenantId, bookSetId, artifactId), status: (tenantId, bookSetId, artifactId) => statusWithholdingStatement(sessionRunner, tenantId, bookSetId, artifactId), content: (tenantId, bookSetId, artifactId, revealSensitive, actorKind) => contentWithholdingStatement(sessionRunner, tenantId, bookSetId, artifactId, revealSensitive, actorKind) },
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
  Object.defineProperty(facade, "taxAuthority", { value: facade.taxAuthority, enumerable: false, writable: false, configurable: false });
  return facade;
}
