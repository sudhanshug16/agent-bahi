import { sqliteTable, text, integer, foreignKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";
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
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    fkCustomer: foreignKey({ columns: [table.customerId, table.tenantId, table.bookSetId], foreignColumns: [parties.id, parties.tenantId, parties.bookSetId] }).onDelete("no action"),
    fkReceivable: foreignKey({ columns: [table.receivableAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
    fkJournal: foreignKey({ columns: [table.postedJournalId, table.tenantId, table.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }).onDelete("no action"),
    uqInvoiceNumber: uniqueIndex("uq_sales_invoice_number_scope").on(table.tenantId, table.bookSetId, table.invoiceNumber),
    uqIdTenantBookSet: uniqueIndex("uq_sales_invoices_id_tenant_book_set_v6").on(table.id, table.tenantId, table.bookSetId),
    idxScopeStatus: index("idx_sales_invoice_scope_status_v6").on(table.tenantId, table.bookSetId, table.status, table.issueDate, table.id),
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
  })
);
