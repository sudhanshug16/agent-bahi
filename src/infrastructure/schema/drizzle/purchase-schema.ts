import { sqliteTable, text, integer, foreignKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { bookSets, accounts } from "./foundation-schema";
import { journalEntries } from "./ledger-schema";
import { parties } from "./sales-schema";

/**
 * Purchase schema: Vendor bills, bill line items, and vendor payments.
 * Posted bills are immutable; payment allocation is append-only.
 */

export const vendorBills = sqliteTable(
  "vendor_bills",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    billNumber: text("bill_number").notNull(),
    vendorId: text("vendor_id").notNull(),
    billDate: text("bill_date").notNull(),
    dueDate: text("due_date"),
    narration: text("narration"),
    status: text("status").notNull(),
    totalMinor: integer("total_minor").notNull(),
    paidMinor: integer("paid_minor").notNull().default(0),
    payableAccountId: text("payable_account_id"),
    postedJournalId: text("posted_journal_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    postedAt: text("posted_at"),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    fkVendor: foreignKey({ columns: [table.vendorId, table.tenantId, table.bookSetId], foreignColumns: [parties.id, parties.tenantId, parties.bookSetId] }).onDelete("no action"),
    fkPayable: foreignKey({ columns: [table.payableAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
    fkJournal: foreignKey({ columns: [table.postedJournalId, table.tenantId, table.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }).onDelete("no action"),
    uqBillNumber: uniqueIndex("uq_vendor_bill_number_scope").on(table.tenantId, table.bookSetId, table.billNumber),
    uqIdTenantBookSet: uniqueIndex("uq_vendor_bills_id_tenant_book_set_v7").on(table.id, table.tenantId, table.bookSetId),
    idxScopeStatus: index("idx_vendor_bills_scope_status_v7").on(table.tenantId, table.bookSetId, table.status, table.billDate, table.id),
  })
);

export const vendorBillLines = sqliteTable(
  "vendor_bill_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    billId: text("bill_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    description: text("description").notNull(),
    expenseAccountId: text("expense_account_id").notNull(),
    amountMinor: integer("amount_minor").notNull(),
  },
  (table) => ({
    fkBill: foreignKey({ columns: [table.billId, table.tenantId, table.bookSetId], foreignColumns: [vendorBills.id, vendorBills.tenantId, vendorBills.bookSetId] }).onDelete("no action"),
    fkExpense: foreignKey({ columns: [table.expenseAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
    uqLineNumber: uniqueIndex("uq_vendor_bill_line_number").on(table.billId, table.lineNumber),
    idxBill: index("idx_vendor_bill_lines_bill_v7").on(table.tenantId, table.bookSetId, table.billId, table.lineNumber),
  })
);

export const vendorPayments = sqliteTable(
  "vendor_payments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    vendorId: text("vendor_id").notNull(),
    paymentDate: text("payment_date").notNull(),
    bankAccountId: text("bank_account_id").notNull(),
    reference: text("reference"),
    amountMinor: integer("amount_minor").notNull(),
    journalId: text("journal_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkVendor: foreignKey({ columns: [table.vendorId, table.tenantId, table.bookSetId], foreignColumns: [parties.id, parties.tenantId, parties.bookSetId] }).onDelete("no action"),
    fkBankAccount: foreignKey({ columns: [table.bankAccountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
    fkJournal: foreignKey({ columns: [table.journalId, table.tenantId, table.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }).onDelete("no action"),
    uqIdTenantBookSet: uniqueIndex("uq_vendor_payments_id_tenant_book_set_v7").on(table.id, table.tenantId, table.bookSetId),
    idxScope: index("idx_vendor_payments_scope_date_v7").on(table.tenantId, table.bookSetId, table.paymentDate, table.id),
  })
);
