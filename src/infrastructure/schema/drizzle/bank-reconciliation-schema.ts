import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { bookSets, accounts } from "./foundation-schema";
import { journalEntries } from "./ledger-schema";

/**
 * Bank reconciliation schema: Bank statements, statement lines, and matches to journal entries.
 * Bank statements are immutable audit trails; matches are append-only with lifecycle guards.
 */

export const bankStatements = sqliteTable(
  "bank_statements",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    bankAccountId: text("bank_account_id").notNull(),
    externalStatementId: text("external_statement_id").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    openingBalanceMinor: integer("opening_balance_minor").notNull(),
    closingBalanceMinor: integer("closing_balance_minor").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkBookSet: foreignKey({
      columns: [table.bookSetId, table.tenantId],
      foreignColumns: [bookSets.id, bookSets.tenantId],
    }).onDelete("no action"),
    fkBankAccount: foreignKey({
      columns: [table.bankAccountId, table.tenantId, table.bookSetId],
      foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId],
    }).onDelete("no action"),
    uqExternalStatement: uniqueIndex("uq_bank_statement_external").on(table.tenantId, table.bookSetId, table.bankAccountId, table.externalStatementId),
    uqScopeKey: uniqueIndex("uq_bank_statement_scope_key").on(table.id, table.tenantId, table.bookSetId),
    uqAccountKey: uniqueIndex("uq_bank_statement_account_key").on(table.id, table.tenantId, table.bookSetId, table.bankAccountId),
    idxScopePeriod: index("idx_bank_statements_scope_period").on(table.tenantId, table.bookSetId, table.periodStart, table.periodEnd, table.id),
    chkPeriod: check("chk_bank_statement_period", sql`length(${table.periodStart}) = 10 AND length(${table.periodEnd}) = 10 AND ${table.periodStart} <= ${table.periodEnd}`),
    chkOpening: check("chk_bank_statement_opening", sql`typeof(${table.openingBalanceMinor}) = 'integer'`),
    chkClosing: check("chk_bank_statement_closing", sql`typeof(${table.closingBalanceMinor}) = 'integer'`),
    chkHash: check("chk_bank_statement_hash", sql`length(${table.contentHash}) = 64 AND ${table.contentHash} NOT GLOB '*[^0-9a-f]*'`),
  })
);

export const bankStatementLines = sqliteTable(
  "bank_statement_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    statementId: text("statement_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    transactionDate: text("transaction_date").notNull(),
    description: text("description").notNull(),
    reference: text("reference"),
    signedAmountMinor: integer("signed_amount_minor").notNull(),
  },
  (table) => ({
    fkStatement: foreignKey({
      columns: [table.statementId, table.tenantId, table.bookSetId],
      foreignColumns: [bankStatements.id, bankStatements.tenantId, bankStatements.bookSetId],
    }).onDelete("no action"),
    uqLineNumber: uniqueIndex("uq_bank_statement_line_number").on(table.statementId, table.lineNumber),
    uqScopeKey: uniqueIndex("uq_bank_statement_line_scope_key").on(table.id, table.tenantId, table.bookSetId, table.statementId),
    idxScopeDate: index("idx_bank_statement_lines_scope_date").on(table.tenantId, table.bookSetId, table.statementId, table.transactionDate, table.lineNumber),
    chkLineNumber: check("chk_bank_statement_line_number", sql`typeof(${table.lineNumber}) = 'integer' AND ${table.lineNumber} > 0`),
    chkDescription: check("chk_bank_statement_line_description", sql`length(${table.description}) > 0`),
    chkAmount: check("chk_bank_statement_line_amount", sql`typeof(${table.signedAmountMinor}) = 'integer' AND ${table.signedAmountMinor} <> 0`),
  })
);

export const bankMatches = sqliteTable(
  "bank_matches",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    statementId: text("statement_id").notNull(),
    statementLineId: text("statement_line_id").notNull(),
    bankAccountId: text("bank_account_id").notNull(),
    journalEntryId: text("journal_entry_id").notNull(),
    status: text("status").notNull(),
    confirmedAt: text("confirmed_at").notNull(),
    undoneAt: text("undone_at"),
    undoReason: text("undo_reason"),
  },
  (table) => ({
    fkStatement: foreignKey({
      columns: [table.statementId, table.tenantId, table.bookSetId, table.bankAccountId],
      foreignColumns: [bankStatements.id, bankStatements.tenantId, bankStatements.bookSetId, bankStatements.bankAccountId],
    }).onDelete("no action"),
    fkLine: foreignKey({
      columns: [table.statementLineId, table.tenantId, table.bookSetId, table.statementId],
      foreignColumns: [bankStatementLines.id, bankStatementLines.tenantId, bankStatementLines.bookSetId, bankStatementLines.statementId],
    }).onDelete("no action"),
    fkJournal: foreignKey({
      columns: [table.journalEntryId, table.tenantId, table.bookSetId],
      foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId],
    }).onDelete("no action"),
    uqScopeKey: uniqueIndex("uq_bank_match_scope_key").on(table.id, table.tenantId, table.bookSetId),
    uqActiveLine: uniqueIndex("uq_bank_match_active_line").on(table.statementLineId, table.tenantId, table.bookSetId).where(sql`status = 'ACTIVE'`),
    uqActiveJournalAccount: uniqueIndex("uq_bank_match_active_journal_account").on(table.journalEntryId, table.bankAccountId, table.tenantId, table.bookSetId).where(sql`status = 'ACTIVE'`),
    idxScopeStatus: index("idx_bank_matches_scope_status").on(table.tenantId, table.bookSetId, table.status, table.statementId, table.statementLineId),
    chkStatus: check("chk_bank_match_status", sql`${table.status} IN ('ACTIVE', 'UNDONE')`),
    chkLifecycle: check("chk_bank_match_lifecycle", sql`(${table.status} = 'ACTIVE' AND ${table.undoneAt} IS NULL AND ${table.undoReason} IS NULL) OR (${table.status} = 'UNDONE' AND ${table.undoneAt} IS NOT NULL AND ${table.undoReason} IS NOT NULL AND length(trim(${table.undoReason})) > 0)`),
  })
);
