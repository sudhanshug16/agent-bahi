import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { tenants, bookSets, accounts, evidence } from "./foundation-schema";
import { payrollEmployees } from "./payroll-schema";
import { journalEntries } from "./ledger-schema";

const scope = (table: any) => foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action");

export const expenseClaimants = sqliteTable("expense_claimants", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), claimantType: text("claimant_type").notNull(), displayName: text("display_name").notNull(), payrollEmployeeId: text("payroll_employee_id"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => ({
  fkScope: scope(t), fkTenant: foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }),
  fkEmployee: foreignKey({ columns: [t.payrollEmployeeId, t.tenantId, t.bookSetId], foreignColumns: [payrollEmployees.id, payrollEmployees.tenantId, payrollEmployees.bookSetId] }),
  uqScope: uniqueIndex("uq_expense_claimants_scope_key").on(t.id, t.tenantId, t.bookSetId), idxScope: index("idx_expense_claimants_scope").on(t.tenantId, t.bookSetId, t.displayName),
  chkType: check("chk_expense_claimant_type", sql`${t.claimantType} IN ('EMPLOYEE','DIRECTOR','PROPRIETOR','OWNER')`), chkName: check("chk_expense_claimant_name", sql`length(trim(${t.displayName})) > 0`),
}));

export const expenseClaims = sqliteTable("expense_claims", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), claimantId: text("claimant_id").notNull(), creatorActorId: text("creator_actor_id").notNull(), reimbursementLiabilityAccountId: text("reimbursement_liability_account_id").notNull(), claimDate: text("claim_date").notNull(), narration: text("narration"), status: text("status").notNull(), businessTotalMinor: integer("business_total_minor").notNull().default(0), submittedAt: text("submitted_at"), reviewerActorId: text("reviewer_actor_id"), reviewObservation: text("review_observation"), allocationConfirmationFactsJson: text("allocation_confirmation_facts_json"), reviewedAt: text("reviewed_at"), postedAt: text("posted_at"), postedJournalId: text("posted_journal_id"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => ({
  fkScope: scope(t), fkClaimant: foreignKey({ columns: [t.claimantId, t.tenantId, t.bookSetId], foreignColumns: [expenseClaimants.id, expenseClaimants.tenantId, expenseClaimants.bookSetId] }), fkLiability: foreignKey({ columns: [t.reimbursementLiabilityAccountId, t.tenantId, t.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }), fkJournal: foreignKey({ columns: [t.postedJournalId, t.tenantId, t.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }),
  uqScope: uniqueIndex("uq_expense_claims_scope_key").on(t.id, t.tenantId, t.bookSetId), idxStatus: index("idx_expense_claims_status").on(t.tenantId, t.bookSetId, t.status, t.claimDate),
  chkStatus: check("chk_expense_claim_status", sql`${t.status} IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','PARTIALLY_SETTLED','SETTLED','CANCELLED')`), chkDate: check("chk_expense_claim_date", sql`length(${t.claimDate}) = 10`), chkBusiness: check("chk_expense_claim_business_total", sql`typeof(${t.businessTotalMinor}) = 'integer' AND ${t.businessTotalMinor} >= 0`),
}));

export const expenseClaimLines = sqliteTable("expense_claim_lines", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), claimId: text("claim_id").notNull(), lineNumber: integer("line_number").notNull(), description: text("description").notNull(), grossMinor: integer("gross_minor").notNull(), businessMinor: integer("business_minor").notNull(), personalMinor: integer("personal_minor").notNull(), expenseAccountId: text("expense_account_id").notNull(), evidenceId: text("evidence_id"), evidenceStatus: text("evidence_status").notNull(), explanation: text("explanation"), createdAt: text("created_at").notNull(),
}, (t) => ({
  fkScope: scope(t), fkClaim: foreignKey({ columns: [t.claimId, t.tenantId, t.bookSetId], foreignColumns: [expenseClaims.id, expenseClaims.tenantId, expenseClaims.bookSetId] }), fkAccount: foreignKey({ columns: [t.expenseAccountId, t.tenantId, t.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }), fkEvidence: foreignKey({ columns: [t.evidenceId], foreignColumns: [evidence.id] }),
  uqLine: uniqueIndex("uq_expense_claim_lines_number").on(t.claimId, t.lineNumber), uqScope: uniqueIndex("uq_expense_claim_lines_scope_key").on(t.id, t.tenantId, t.bookSetId), idxEvidence: index("idx_expense_claim_lines_evidence").on(t.tenantId, t.bookSetId, t.evidenceStatus),
  chkAmounts: check("chk_expense_claim_line_amounts", sql`typeof(${t.grossMinor}) = 'integer' AND ${t.grossMinor} > 0 AND typeof(${t.businessMinor}) = 'integer' AND ${t.businessMinor} >= 0 AND typeof(${t.personalMinor}) = 'integer' AND ${t.personalMinor} >= 0 AND ${t.grossMinor} = ${t.businessMinor} + ${t.personalMinor}`), chkEvidence: check("chk_expense_claim_line_evidence_status", sql`${t.evidenceStatus} IN ('ATTACHED','MISSING','EXPLANATION_ONLY','INVALID')`), chkDescription: check("chk_expense_claim_line_description", sql`length(trim(${t.description})) > 0`),
}));

export const expenseAdvances = sqliteTable("expense_advances", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), claimantId: text("claimant_id").notNull(), issueDate: text("issue_date").notNull(), amountMinor: integer("amount_minor").notNull(), advanceAssetAccountId: text("advance_asset_account_id").notNull(), bankAccountId: text("bank_account_id").notNull(), status: text("status").notNull(), issuedJournalId: text("issued_journal_id").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => ({
  fkScope: scope(t), fkClaimant: foreignKey({ columns: [t.claimantId, t.tenantId, t.bookSetId], foreignColumns: [expenseClaimants.id, expenseClaimants.tenantId, expenseClaimants.bookSetId] }), fkAsset: foreignKey({ columns: [t.advanceAssetAccountId, t.tenantId, t.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }), fkBank: foreignKey({ columns: [t.bankAccountId, t.tenantId, t.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }), fkJournal: foreignKey({ columns: [t.issuedJournalId, t.tenantId, t.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }),
  uqScope: uniqueIndex("uq_expense_advances_scope_key").on(t.id, t.tenantId, t.bookSetId), idxStatus: index("idx_expense_advances_status").on(t.tenantId, t.bookSetId, t.status, t.issueDate), chkStatus: check("chk_expense_advance_status", sql`${t.status} IN ('OPEN','PARTIALLY_SETTLED','SETTLED')`), chkAmount: check("chk_expense_advance_amount", sql`typeof(${t.amountMinor}) = 'integer' AND ${t.amountMinor} > 0`),
}));

export const expenseAdvanceAllocations = sqliteTable("expense_advance_allocations", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), advanceId: text("advance_id").notNull(), claimId: text("claim_id").notNull(), amountMinor: integer("amount_minor").notNull(), journalId: text("journal_id").notNull(), createdAt: text("created_at").notNull(),
}, (t) => ({
  fkScope: scope(t), fkAdvance: foreignKey({ columns: [t.advanceId, t.tenantId, t.bookSetId], foreignColumns: [expenseAdvances.id, expenseAdvances.tenantId, expenseAdvances.bookSetId] }), fkClaim: foreignKey({ columns: [t.claimId, t.tenantId, t.bookSetId], foreignColumns: [expenseClaims.id, expenseClaims.tenantId, expenseClaims.bookSetId] }), fkJournal: foreignKey({ columns: [t.journalId, t.tenantId, t.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }), idxAdvance: index("idx_expense_advance_allocations_advance").on(t.tenantId, t.bookSetId, t.advanceId), chkAmount: check("chk_expense_advance_allocation_amount", sql`typeof(${t.amountMinor}) = 'integer' AND ${t.amountMinor} > 0`),
}));

export const expenseAdvanceRepayments = sqliteTable("expense_advance_repayments", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), advanceId: text("advance_id").notNull(), amountMinor: integer("amount_minor").notNull(), bankAccountId: text("bank_account_id").notNull(), journalId: text("journal_id").notNull(), createdAt: text("created_at").notNull(),
}, (t) => ({
  fkScope: scope(t), fkAdvance: foreignKey({ columns: [t.advanceId, t.tenantId, t.bookSetId], foreignColumns: [expenseAdvances.id, expenseAdvances.tenantId, expenseAdvances.bookSetId] }), fkBank: foreignKey({ columns: [t.bankAccountId, t.tenantId, t.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }), fkJournal: foreignKey({ columns: [t.journalId, t.tenantId, t.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }), idxAdvance: index("idx_expense_advance_repayments_advance").on(t.tenantId, t.bookSetId, t.advanceId), chkAmount: check("chk_expense_advance_repayment_amount", sql`typeof(${t.amountMinor}) = 'integer' AND ${t.amountMinor} > 0`),
}));

export const expenseReimbursements = sqliteTable("expense_reimbursements", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), claimId: text("claim_id").notNull(), amountMinor: integer("amount_minor").notNull(), bankAccountId: text("bank_account_id").notNull(), journalId: text("journal_id").notNull(), createdAt: text("created_at").notNull(),
}, (t) => ({
  fkScope: scope(t), fkClaim: foreignKey({ columns: [t.claimId, t.tenantId, t.bookSetId], foreignColumns: [expenseClaims.id, expenseClaims.tenantId, expenseClaims.bookSetId] }), fkBank: foreignKey({ columns: [t.bankAccountId, t.tenantId, t.bookSetId], foreignColumns: [accounts.id, accounts.tenantId, accounts.bookSetId] }), fkJournal: foreignKey({ columns: [t.journalId, t.tenantId, t.bookSetId], foreignColumns: [journalEntries.id, journalEntries.tenantId, journalEntries.bookSetId] }), idxClaim: index("idx_expense_reimbursements_claim").on(t.tenantId, t.bookSetId, t.claimId), chkAmount: check("chk_expense_reimbursement_amount", sql`typeof(${t.amountMinor}) = 'integer' AND ${t.amountMinor} > 0`),
}));
