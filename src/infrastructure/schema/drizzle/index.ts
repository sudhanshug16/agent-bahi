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

// Ledger schema
export { journalEntries, journalLines } from "./ledger-schema";

// Sales schema
export { parties, salesInvoices, salesInvoiceLines, bankReceipts, bankReceiptAllocations } from "./sales-schema";

// Purchase schema
export { vendorBills, vendorBillLines, vendorPayments, vendorPaymentAllocations } from "./purchase-schema";

// Bank reconciliation schema
export { bankStatements, bankStatementLines, bankMatches } from "./bank-reconciliation-schema";
