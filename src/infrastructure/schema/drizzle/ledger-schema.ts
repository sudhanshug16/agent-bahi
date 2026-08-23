import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { bookSets, accounts } from "./foundation-schema";

/**
 * Ledger schema: Double-entry journal and posting.
 * All journal entries are posted immutably on insertion.
 */

export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    postingDate: text("posting_date").notNull(),
    reference: text("reference"),
    narration: text("narration"),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    postedAt: text("posted_at").notNull(),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    uqIdTenantBookSet: uniqueIndex("uq_journal_entries_id_tenant_book_set_v5").on(table.id, table.tenantId, table.bookSetId),
    idxScopeDate: index("idx_journal_entries_scope_date").on(table.tenantId, table.bookSetId, table.postingDate, table.id),
    chkPostingDate: check("chk_journal_entry_posting_date", sql`length(${table.postingDate}) = 10 AND substr(${table.postingDate}, 5, 1) = '-' AND substr(${table.postingDate}, 8, 1) = '-'`),
    chkStatus: check("chk_journal_entry_status", sql`${table.status} = 'POSTED'`),
  })
);

export const journalLines = sqliteTable(
  "journal_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    journalEntryId: text("journal_entry_id").notNull(),
    accountId: text("account_id").notNull(),
    description: text("description"),
    debitMinor: integer("debit_minor").notNull().default(0),
    creditMinor: integer("credit_minor").notNull().default(0),
  },
  (table) => ({
    fkEntry: foreignKey({ columns: [table.journalEntryId, table.tenantId, table.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }).onDelete("no action"),
    fkAccount: foreignKey({ columns: [table.accountId, table.tenantId, table.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }).onDelete("no action"),
    idxEntry: index("idx_journal_lines_entry").on(table.tenantId, table.bookSetId, table.journalEntryId),
    idxAccount: index("idx_journal_lines_account").on(table.tenantId, table.bookSetId, table.accountId),
    chkDebit: check("chk_journal_line_debit", sql`typeof(${table.debitMinor}) = 'integer' AND ${table.debitMinor} >= 0`),
    chkCredit: check("chk_journal_line_credit", sql`typeof(${table.creditMinor}) = 'integer' AND ${table.creditMinor} >= 0`),
    chkOneSide: check("chk_journal_line_one_side", sql`(${table.debitMinor} > 0 AND ${table.creditMinor} = 0) OR (${table.creditMinor} > 0 AND ${table.debitMinor} = 0)`),
  })
);
