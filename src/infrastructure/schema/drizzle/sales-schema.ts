import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { bookSets, accounts } from "./foundation-schema";
import { journalEntries } from "./ledger-schema";

/**
 * Sales schema: Customers (parties), invoices, line items, and bank receipts.
 * Posted invoices are immutable; payment allocation is append-only.
 */

export const parties = sqliteTable(
  "parties",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    partyRole: text("party_role").notNull().default("CUSTOMER"),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    uqIdTenantBookSet: uniqueIndex("uq_parties_id_tenant_book_set_v6").on(table.id, table.tenantId, table.bookSetId),
    idxScopeName: index("idx_parties_scope_name_v6").on(table.tenantId, table.bookSetId, table.displayName),
    idxScopeRole: index("idx_parties_scope_role_v7").on(table.tenantId, table.bookSetId, table.partyRole, table.displayName),
    chkDisplayName: check("chk_party_display_name", sql`length(${table.displayName}) > 0 AND ${table.displayName} = trim(${table.displayName})`),
    chkRole: check("chk_party_role", sql`${table.partyRole} IN ('CUSTOMER', 'VENDOR', 'BOTH')`),
    chkStatus: check("chk_party_status", sql`${table.status} IN ('ACTIVE', 'ARCHIVED')`),
  })
);

export const salesInvoices = sqliteTable(
  "sales_invoices",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    customerId: text("customer_id").notNull(),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date"),
    narration: text("narration"),
    status: text("status").notNull(),
    totalMinor: integer("total_minor").notNull(),
    paidMinor: integer("paid_minor").notNull().default(0),
    receivableAccountId: text("receivable_account_id"),
    postedJournalId: text("posted_journal_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    postedAt: text("posted_at"),
    gstInputJson: text("gst_input_json"),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    fkCustomer: foreignKey({ columns: [table.customerId, table.tenantId, table.bookSetId], foreignColumns: [parties.id, parties.tenantId, parties.bookSetId] }).onDelete("no action"),
    fkReceivable: foreignKey({ columns: [table.receivableAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
    fkJournal: foreignKey({ columns: [table.postedJournalId, table.tenantId, table.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }).onDelete("no action"),
    uqInvoiceNumber: uniqueIndex("uq_sales_invoice_number_scope").on(table.tenantId, table.bookSetId, table.invoiceNumber),
    uqIdTenantBookSet: uniqueIndex("uq_sales_invoices_id_tenant_book_set_v6").on(table.id, table.tenantId, table.bookSetId),
    idxScopeStatus: index("idx_sales_invoice_scope_status_v6").on(table.tenantId, table.bookSetId, table.status, table.issueDate, table.id),
    chkTotal: check("chk_sales_invoice_total", sql`typeof(${table.totalMinor}) = 'integer' AND ${table.totalMinor} > 0`),
    chkPaid: check("chk_sales_invoice_paid", sql`typeof(${table.paidMinor}) = 'integer' AND ${table.paidMinor} >= 0 AND ${table.paidMinor} <= ${table.totalMinor}`),
    chkStatus: check("chk_sales_invoice_status", sql`${table.status} IN ('DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID')`),
    chkStatusFields: check("chk_sales_invoice_status_fields", sql`(${table.status} = 'DRAFT' AND ${table.receivableAccountId} IS NULL AND ${table.postedJournalId} IS NULL AND ${table.postedAt} IS NULL AND ${table.paidMinor} = 0) OR (${table.status} IN ('POSTED', 'PARTIALLY_PAID', 'PAID') AND ${table.receivableAccountId} IS NOT NULL AND ${table.postedJournalId} IS NOT NULL AND ${table.postedAt} IS NOT NULL)`),
    chkPaidStatus: check("chk_sales_invoice_paid_status", sql`(${table.status} = 'POSTED' AND ${table.paidMinor} = 0) OR (${table.status} = 'PARTIALLY_PAID' AND ${table.paidMinor} > 0 AND ${table.paidMinor} < ${table.totalMinor}) OR (${table.status} = 'PAID' AND ${table.paidMinor} = ${table.totalMinor}) OR ${table.status} = 'DRAFT'`),
  })
);

export const salesInvoiceLines = sqliteTable(
  "sales_invoice_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    description: text("description").notNull(),
    revenueAccountId: text("revenue_account_id").notNull(),
    amountMinor: integer("amount_minor").notNull(),
  },
  (table) => ({
    fkInvoice: foreignKey({ columns: [table.invoiceId, table.tenantId, table.bookSetId], foreignColumns: [salesInvoices.id, salesInvoices.tenantId, salesInvoices.bookSetId] }).onDelete("no action"),
    fkRevenue: foreignKey({ columns: [table.revenueAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
    uqLineNumber: uniqueIndex("uq_sales_invoice_line_number").on(table.invoiceId, table.lineNumber),
    idxInvoice: index("idx_sales_invoice_lines_invoice_v6").on(table.tenantId, table.bookSetId, table.invoiceId, table.lineNumber),
    chkLineNumber: check("chk_sales_invoice_line_number", sql`typeof(${table.lineNumber}) = 'integer' AND ${table.lineNumber} > 0`),
    chkDescription: check("chk_sales_invoice_line_description", sql`length(${table.description}) > 0`),
    chkAmount: check("chk_sales_invoice_line_amount", sql`typeof(${table.amountMinor}) = 'integer' AND ${table.amountMinor} > 0`),
  })
);

export const bankReceipts = sqliteTable(
  "bank_receipts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    customerId: text("customer_id").notNull(),
    bankAccountId: text("bank_account_id").notNull(),
    receiptDate: text("receipt_date").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    reference: text("reference"),
    journalId: text("journal_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkCustomer: foreignKey({ columns: [table.customerId, table.tenantId, table.bookSetId], foreignColumns: [parties.id, parties.tenantId, parties.bookSetId] }).onDelete("no action"),
    fkBankAccount: foreignKey({ columns: [table.bankAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
    fkJournal: foreignKey({ columns: [table.journalId, table.tenantId, table.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }).onDelete("no action"),
    uqIdTenantBookSet: uniqueIndex("uq_bank_receipts_id_tenant_book_set_v6").on(table.id, table.tenantId, table.bookSetId),
    idxScope: index("idx_bank_receipts_scope_date_v6").on(table.tenantId, table.bookSetId, table.receiptDate, table.id),
    chkAmount: check("chk_bank_receipt_amount", sql`typeof(${table.amountMinor}) = 'integer' AND ${table.amountMinor} > 0`),
  })
);

export const bankReceiptAllocations = sqliteTable(
  "bank_receipt_allocations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    receiptId: text("receipt_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    amountMinor: integer("amount_minor").notNull(),
  },
  (table) => ({
    fkReceipt: foreignKey({ columns: [table.receiptId, table.tenantId, table.bookSetId], foreignColumns: [bankReceipts.id, bankReceipts.tenantId, bankReceipts.bookSetId] }).onDelete("no action"),
    fkInvoice: foreignKey({ columns: [table.invoiceId, table.tenantId, table.bookSetId], foreignColumns: [salesInvoices.id, salesInvoices.tenantId, salesInvoices.bookSetId] }).onDelete("no action"),
    uqInvoice: uniqueIndex("uq_bank_receipt_allocation_invoice").on(table.receiptId, table.invoiceId),
    idxInvoice: index("idx_bank_receipt_allocations_invoice_v6").on(table.tenantId, table.bookSetId, table.invoiceId),
    chkAmount: check("chk_bank_receipt_allocation_amount", sql`typeof(${table.amountMinor}) = 'integer' AND ${table.amountMinor} > 0`),
  }),
);
