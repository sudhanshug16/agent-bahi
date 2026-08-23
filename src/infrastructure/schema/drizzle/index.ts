/**
 * Drizzle ORM schema index: All v8 production tables and their typed definitions.
 * This module is the single source of truth for the Drizzle schema.
 * Fresh database initialization and future migrations use only Drizzle artifacts.
 */

// Foundation schema
export {
  tenants,
  bookSets,
  accounts,
  legalIdentities,
  tenantCreationRequests,
  gstRegistrations,
  evidence,
  auditRecords,
  idempotencyRecords,
  databaseControl,
} from "./foundation-schema";

// Tenant PAN V1
export { tenantPanProfiles } from "./tenant-pan-schema";

// Ledger schema
export { journalEntries, journalLines } from "./ledger-schema";

// Sales schema
export { parties, salesInvoices, salesInvoiceLines, bankReceipts, bankReceiptAllocations } from "./sales-schema";

// Purchase schema
export { vendorBills, vendorBillLines, vendorPayments, vendorPaymentAllocations } from "./purchase-schema";

// Bank reconciliation schema
export { bankStatements, bankStatementLines, bankMatches } from "./bank-reconciliation-schema";

// GST v1 schema
export { partyGstProfiles, gstTaxSnapshots, gstTaxComponents } from "./gst-schema";

// TDS/TCS bookkeeping V1
export {
  tenantDeductorProfiles,
  partyTaxProfiles,
  taxRuleSnapshots,
  withholdingEvents,
  withholdingDeposits,
  withholdingDepositAllocations,
  withholdingComplianceCases,
} from "./tds-tcs-schema";

// Fixed assets V1
export {
  assetBookPolicies,
  fixedAssets,
  assetComponents,
  assetDepreciationRuns,
  assetDepreciationLines,
  assetTaxRuleSnapshots,
  assetTaxBlocks,
  assetTaxRuns,
  assetTaxRunLines,
  assetDisposals,
} from "./fixed-assets-schema";

// Foreign currency V1
export {
  tenantCurrencies,
  fxRateSnapshots,
  fxDocumentFacts,
  fxDocumentLineAmounts,
  fxAllocationFacts,
  fxRevaluationPolicies,
  fxRevaluationRuns,
  fxRevaluationLines,
  fxRevaluationReversals,
  bankAccountCurrencies,
  bankStatementLineCurrencies,
} from "./fx-schema";

// Expense Claims V1
export {
  expenseClaimants,
  expenseClaims,
  expenseClaimLines,
  expenseAdvances,
  expenseAdvanceAllocations,
  expenseAdvanceRepayments,
  expenseReimbursements,
} from "./expense-claims-schema";

// GST Return Readiness V1
export {
  gstOutwardFacts,
  gstOutwardLineFacts,
  gstReturns,
  gstReturnSnapshots,
  gstReturnValidations,
  gstReturnExports,
  gstReturnObservations,
} from "./gst-return-readiness-schema";

// Compliance Obligations & Calendar V1
export {
  complianceFactProfiles,
  complianceRuleSnapshots,
  complianceDeadlineSnapshots,
  complianceApplicabilityDecisions,
  complianceRulePredecessors,
  complianceObligations,
  complianceObligationArtifacts,
  complianceObligationEvents,
} from "./compliance-obligations-schema";

// Period Close V1
export { periodCloseEvents } from "./period-close-schema";
