import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError } from "../../core/types.ts";
import { CURRENT_SCHEMA_MANIFEST } from "../../infrastructure/schema/current-manifest.ts";

export interface CompanyStatusInput {
  tenantId?: TenantId;
  bookSetId?: BookSetId;
  asOfDate?: string;
}

export interface CompanyStatusCompatibility {
  status: string;
  currentSchemaVersion?: number;
  requiredSchemaVersion: number;
  currentDataFormatVersion?: number;
  requiredDataFormatVersion: number;
}

export interface CompanyStatusIssue {
  severity: "BLOCKED" | "HIGH" | "MEDIUM" | "INFO";
  code: string;
  bookSetId?: string;
  count?: number;
  amountMinor?: number;
}

export interface CompanyStatusResult {
  databaseCompatibility: {
    status: string;
    currentSchemaVersion: number;
    requiredSchemaVersion: number;
    currentDataFormatVersion: number;
    requiredDataFormatVersion: number;
  };
  selectedTenant: {
    tenantId: string;
    name: string;
    kind: string;
    lifecycle: string;
  };
  asOfDate: string;
  summaries: CompanyStatusBookSetSummary[];
  issues: CompanyStatusIssue[];
  overallReadiness: "BLOCKED" | "REVIEW_REQUIRED" | "READY";
  drillDown: CompanyStatusDrillDown[];
}

export interface CompanyStatusBookSetSummary {
  bookSet: {
    bookSetId: string;
    tenantId: string;
    kind: string;
    displayName: string;
    lifecycle: string;
  };
  ledger: {
    asOfDate: string;
    totalDebitMinor: number;
    totalCreditMinor: number;
    isBalanced: boolean;
  };
  receivables: CompanyStatusOpenBalance;
  payables: CompanyStatusOpenBalance;
  drafts: {
    invoiceCount: number;
    billCount: number;
  };
  bankReconciliation: {
    latestByBankAccount: CompanyStatusBankSummary[];
    truncated: boolean;
  };
  gst: {
    registrationsApplicableAsOf: {
      count: number;
      truncated: boolean;
      registrations: Array<{
        registrationId: string;
        gstinLastFour: string;
        state?: string;
        scheme?: string;
      }>;
    };
    postedSalesActivity: CompanyStatusTaxActivity;
    postedPurchaseActivity: CompanyStatusTaxActivity;
    pendingReviewItc: {
      count: number;
      amountMinor: number;
      risk: "NONE" | "REVIEW_REQUIRED";
    };
  };
  tdsTcs: {
    unverifiedProfileCount: number;
    unverifiedRuleCount: number;
    undepositedLiabilityCount: number;
    undepositedLiabilityMinor: number;
    rejectedCaseCount: number;
    unsubmittedCaseCount: number;
  };
  assets: {
    manualEvidenceCount: number;
    previewNeededCount: number;
    taxRuleMissingCount: number;
    taxUnrunCount: number;
    disposedOpenAnomalyCount: number;
  };
  fx: {
    foreignOpenItemCount: number;
    missingOrUnverifiedRateCount: number;
    unreversedRevaluationCount: number;
    settlementMismatchCount: number;
  };
  payroll: {
    employeeCount: number;
    preparedRunCount: number;
    pendingClaimCount: number;
    reviewRuleCount: number;
    postedNetPayableMinor: number;
  };
  expenses: {
    submittedClaimCount: number;
    pendingReviewClaimCount: number;
    openReimbursementPayableMinor: number;
    openAdvanceCount: number;
    openAdvanceMinor: number;
    evidenceExceptionCount: number;
  };
  compliance: {
    obligationCount: number;
    openCount: number;
    overdueCount: number;
    unknownApplicabilityCount: number;
    missingFactsCount: number;
    blockedPredecessorCount: number;
  };
  cashBank: {
    status: "UNAVAILABLE";
    reason: "ACCOUNT_CLASSIFICATION_UNAVAILABLE";
  };
}

export interface CompanyStatusOpenBalance {
  count: number;
  totalMinor: number;
  overdue: {
    count: number;
    amountMinor: number;
  };
}

export interface CompanyStatusTaxActivity {
  count: number;
  taxMinor: number;
}

export interface CompanyStatusBankSummary {
  bankAccountId: string;
  bankAccountCode: string;
  bankAccountName: string;
  statementId: string;
  periodStart: string;
  periodEnd: string;
  matchedCount: number;
  unmatchedCount: number;
  differenceMinor: number;
  openingDifferenceMinor: number;
  closingDifferenceMinor: number;
  arithmeticValid: boolean;
  isReconciled: boolean;
}

export interface CompanyStatusDrillDown {
  operationId: string;
  inputTemplate: Record<string, string>;
}

function assertIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("INVALID_REPORT_DATE", `${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new DomainError("INVALID_REPORT_DATE", `${field} must be a valid ISO date`);
}

function numeric(value: unknown, field = "amount"): number {
  const result = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  if (!Number.isSafeInteger(result)) throw new DomainError("STATUS_AMOUNT_UNSAFE", `${field} exceeds the safe integer range`);
  return result;
}

function add(left: number, right: number, field = "amount"): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new DomainError("STATUS_AMOUNT_UNSAFE", `${field} exceeds the safe integer range`);
  return result;
}

function countRows(rows: readonly unknown[]): number {
  if (rows.length > Number.MAX_SAFE_INTEGER) throw new DomainError("STATUS_AMOUNT_UNSAFE", "row count exceeds the safe integer range");
  return rows.length;
}

function invocationDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function maskGstin(value: unknown): string {
  const gstin = String(value);
  return gstin.length <= 4 ? gstin : `****${gstin.slice(-4)}`;
}

async function selectTenant(session: BusinessSession, requestedTenantId?: TenantId): Promise<Record<string, unknown>> {
  if (requestedTenantId) {
    const row = await session.querySingle("SELECT id, kind, lifecycle, name FROM tenants WHERE id = ?", [requestedTenantId]);
    if (!row) throw new DomainError("TENANT_NOT_FOUND", "tenant does not exist", { tenantId: requestedTenantId });
    if (String(row.lifecycle) !== "ACTIVE") throw new DomainError("TENANT_INACTIVE", "tenant is not ACTIVE", { tenantId: requestedTenantId });
    return row;
  }
  const rows = await session.query("SELECT id, kind, lifecycle, name FROM tenants WHERE lifecycle = 'ACTIVE' ORDER BY id LIMIT 2");
  if (rows.rows.length === 0) throw new DomainError("NO_ACTIVE_TENANT", "no ACTIVE tenant is available");
  if (rows.rows.length > 1) throw new DomainError("TENANT_AMBIGUOUS", "tenantId is required when more than one ACTIVE tenant exists");
  return rows.rows[0]!;
}

async function selectBookSets(session: BusinessSession, tenantId: string, requestedBookSetId?: BookSetId): Promise<Record<string, unknown>[]> {
  if (requestedBookSetId) {
    const row = await session.querySingle(
      "SELECT id, tenant_id, kind, display_name, lifecycle FROM book_sets WHERE tenant_id = ? AND id = ?",
      [tenantId, requestedBookSetId],
    );
    if (!row) throw new DomainError("BOOK_SET_NOT_FOUND", "BookSet does not belong to tenant", { tenantId, bookSetId: requestedBookSetId });
    if (String(row.lifecycle) !== "ACTIVE") throw new DomainError("BOOK_SET_INACTIVE", "BookSet is not ACTIVE", { tenantId, bookSetId: requestedBookSetId });
    return [row];
  }
  const rows = await session.query(
    "SELECT id, tenant_id, kind, display_name, lifecycle FROM book_sets WHERE tenant_id = ? AND lifecycle = 'ACTIVE' ORDER BY id",
    [tenantId],
  );
  return rows.rows;
}

async function ledgerHealth(session: BusinessSession, tenantId: string, bookSetId: string, asOfDate: string): Promise<CompanyStatusBookSetSummary["ledger"]> {
  const rows = await session.query(
    `SELECT jl.debit_minor, jl.credit_minor
     FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.tenant_id = je.tenant_id AND jl.book_set_id = je.book_set_id
     WHERE je.tenant_id = ? AND je.book_set_id = ? AND je.status = 'POSTED' AND je.posting_date <= ?`,
    [tenantId, bookSetId, asOfDate],
  );
  let totalDebitMinor = 0;
  let totalCreditMinor = 0;
  for (const row of rows.rows) {
    totalDebitMinor = add(totalDebitMinor, numeric(row.debit_minor, "ledger debit"), "ledger debit total");
    totalCreditMinor = add(totalCreditMinor, numeric(row.credit_minor, "ledger credit"), "ledger credit total");
  }
  return { asOfDate, totalDebitMinor, totalCreditMinor, isBalanced: totalDebitMinor === totalCreditMinor };
}

async function openBalance(session: BusinessSession, table: "sales_invoices" | "vendor_bills", dateColumn: "issue_date" | "bill_date", tenantId: string, bookSetId: string, asOfDate: string): Promise<CompanyStatusOpenBalance> {
  const withholding = table === "vendor_bills" ? "withholding_minor" : "0";
  const settled = table === "vendor_bills" ? "paid_minor + withholding_minor" : "paid_minor";
  const rows = await session.query(
    `SELECT total_minor, paid_minor, ${withholding} AS withholding_minor, due_date
     FROM ${table}
     WHERE tenant_id = ? AND book_set_id = ? AND status = 'POSTED' AND ${dateColumn} <= ? AND ${settled} < total_minor
        OR tenant_id = ? AND book_set_id = ? AND status = 'PARTIALLY_PAID' AND ${dateColumn} <= ? AND ${settled} < total_minor
      ORDER BY ${dateColumn}, id`,
    [tenantId, bookSetId, asOfDate, tenantId, bookSetId, asOfDate],
  );
  let totalMinor = 0;
  let overdueCount = 0;
  let overdueMinor = 0;
  for (const row of rows.rows) {
    const outstanding = numeric(row.total_minor, "open balance total") - numeric(row.paid_minor, "open balance paid") - numeric(row.withholding_minor, "open balance withholding");
    totalMinor = add(totalMinor, outstanding, "open balance total");
    if (row.due_date !== null && row.due_date !== undefined && String(row.due_date) < asOfDate) {
      overdueCount += 1;
      overdueMinor = add(overdueMinor, outstanding, "overdue amount");
    }
  }
  return {
    count: countRows(rows.rows),
    totalMinor,
    overdue: { count: overdueCount, amountMinor: overdueMinor },
  };
}

async function draftCounts(session: BusinessSession, tenantId: string, bookSetId: string): Promise<CompanyStatusBookSetSummary["drafts"]> {
  const invoices = await session.query("SELECT id FROM sales_invoices WHERE tenant_id = ? AND book_set_id = ? AND status = 'DRAFT'", [tenantId, bookSetId]);
  const bills = await session.query("SELECT id FROM vendor_bills WHERE tenant_id = ? AND book_set_id = ? AND status = 'DRAFT'", [tenantId, bookSetId]);
  return { invoiceCount: countRows(invoices.rows), billCount: countRows(bills.rows) };
}

async function bankReconciliation(session: BusinessSession, tenantId: string, bookSetId: string): Promise<CompanyStatusBookSetSummary["bankReconciliation"]> {
  const statementRows = await session.query(
    `SELECT bs.id, bs.bank_account_id, bs.period_start, bs.period_end, bs.opening_balance_minor, bs.closing_balance_minor,
            a.code AS bank_account_code, a.name AS bank_account_name
     FROM bank_statements bs
     JOIN accounts a ON a.id = bs.bank_account_id AND a.tenant_id = bs.tenant_id AND a.book_set_id = bs.book_set_id
     WHERE bs.tenant_id = ? AND bs.book_set_id = ?
     ORDER BY bs.bank_account_id, bs.period_end DESC, bs.id DESC`,
    [tenantId, bookSetId],
  );
  const seenAccounts = new Set<string>();
  const statements = statementRows.rows.filter((statement) => {
    const accountId = String(statement.bank_account_id);
    if (seenAccounts.has(accountId)) return false;
    seenAccounts.add(accountId);
    return true;
  }).slice(0, 50);
  const result: CompanyStatusBankSummary[] = [];
  for (const statement of statements) {
    const lines = await session.query(
      `SELECT l.signed_amount_minor,
              l.id
       FROM bank_statement_lines l
       WHERE l.tenant_id = ? AND l.book_set_id = ? AND l.statement_id = ?
       ORDER BY l.line_number, l.id`,
      [tenantId, bookSetId, statement.id],
    );
    const matches = await session.query("SELECT statement_line_id FROM bank_matches WHERE tenant_id = ? AND book_set_id = ? AND statement_id = ? AND status = 'ACTIVE'", [tenantId, bookSetId, statement.id]);
    const matchedLineIds = new Set(matches.rows.map((match) => String(match.statement_line_id)));
    let net = 0;
    let matchedCount = 0;
    for (const line of lines.rows) {
      net = add(net, numeric(line.signed_amount_minor, "bank statement line"), "bank statement net");
      if (matchedLineIds.has(String(line.id))) matchedCount += 1;
    }
    const opening = numeric(statement.opening_balance_minor, "bank opening balance");
    const closing = numeric(statement.closing_balance_minor, "bank closing balance");
    const arithmeticValid = add(opening, net, "bank arithmetic") === closing;
    const bookRows = await session.query(
      `SELECT je.posting_date, jl.debit_minor, jl.credit_minor
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.tenant_id = je.tenant_id AND jl.book_set_id = je.book_set_id
       WHERE je.tenant_id = ? AND je.book_set_id = ? AND je.status = 'POSTED' AND jl.account_id = ?`,
      [tenantId, bookSetId, statement.bank_account_id],
    );
    let bookBefore = 0;
    let bookEnding = 0;
    for (const line of bookRows.rows) {
      const amount = numeric(line.debit_minor, "bank debit") - numeric(line.credit_minor, "bank credit");
      if (String(line.posting_date) < String(statement.period_start)) bookBefore = add(bookBefore, amount, "bank book balance");
      if (String(line.posting_date) <= String(statement.period_end)) bookEnding = add(bookEnding, amount, "bank book balance");
    }
    const unmatchedCount = lines.rows.length - matchedCount;
    const openingDifferenceMinor = opening - bookBefore;
    const closingDifferenceMinor = closing - bookEnding;
    result.push({
      bankAccountId: String(statement.bank_account_id),
      bankAccountCode: String(statement.bank_account_code),
      bankAccountName: String(statement.bank_account_name),
      statementId: String(statement.id),
      periodStart: String(statement.period_start),
      periodEnd: String(statement.period_end),
      matchedCount,
      unmatchedCount,
      differenceMinor: closingDifferenceMinor,
      openingDifferenceMinor,
      closingDifferenceMinor,
      arithmeticValid,
      isReconciled: arithmeticValid && unmatchedCount === 0 && openingDifferenceMinor === 0 && closingDifferenceMinor === 0,
    });
  }
  return { latestByBankAccount: result, truncated: seenAccounts.size > 50 };
}

async function gstStatus(session: BusinessSession, tenantId: string, bookSetId: string, asOfDate: string): Promise<CompanyStatusBookSetSummary["gst"]> {
  const registrations = await session.query(
    `SELECT id, gstin, state, scheme
     FROM gst_registrations
     WHERE tenant_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND effective_to IS NULL
        OR tenant_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND effective_to >= ?
     ORDER BY id`,
    [tenantId, asOfDate, tenantId, asOfDate, asOfDate],
  );
  const sales = await session.query(
    `SELECT s.tax_minor
     FROM gst_tax_snapshots s JOIN sales_invoices d ON d.id = s.sales_invoice_id AND d.tenant_id = s.tenant_id AND d.book_set_id = s.book_set_id
     WHERE s.tenant_id = ? AND s.book_set_id = ? AND s.document_type = 'SALE' AND d.status <> 'DRAFT' AND d.issue_date <= ?`,
    [tenantId, bookSetId, asOfDate],
  );
  const purchases = await session.query(
    `SELECT s.tax_minor
     FROM gst_tax_snapshots s JOIN vendor_bills d ON d.id = s.vendor_bill_id AND d.tenant_id = s.tenant_id AND d.book_set_id = s.book_set_id
     WHERE s.tenant_id = ? AND s.book_set_id = ? AND s.document_type = 'PURCHASE' AND d.status <> 'DRAFT' AND d.bill_date <= ?`,
    [tenantId, bookSetId, asOfDate],
  );
  const pendingItc = await session.query(
    `SELECT s.tax_minor
     FROM gst_tax_snapshots s JOIN vendor_bills d ON d.id = s.vendor_bill_id AND d.tenant_id = s.tenant_id AND d.book_set_id = s.book_set_id
     WHERE s.tenant_id = ? AND s.book_set_id = ? AND s.document_type = 'PURCHASE' AND s.itc_treatment = 'PENDING_REVIEW' AND d.status <> 'DRAFT' AND d.bill_date <= ?`,
    [tenantId, bookSetId, asOfDate],
  );
  const taxTotal = (rows: readonly Record<string, unknown>[], field: string): number => rows.reduce((total, row) => add(total, numeric(row.tax_minor, field), field), 0);
  return {
    registrationsApplicableAsOf: {
      count: registrations.rows.length,
      truncated: registrations.rows.length > 20,
      registrations: registrations.rows.slice(0, 20).map((row) => ({
        registrationId: String(row.id),
        gstinLastFour: maskGstin(row.gstin),
        ...(row.state == null ? {} : { state: String(row.state) }),
        ...(row.scheme == null ? {} : { scheme: String(row.scheme) }),
      })),
    },
    postedSalesActivity: { count: countRows(sales.rows), taxMinor: taxTotal(sales.rows, "GST sales tax") },
    postedPurchaseActivity: { count: countRows(purchases.rows), taxMinor: taxTotal(purchases.rows, "GST purchase tax") },
    pendingReviewItc: {
      count: countRows(pendingItc.rows),
      amountMinor: taxTotal(pendingItc.rows, "pending ITC amount"),
      risk: pendingItc.rows.length > 0 ? "REVIEW_REQUIRED" : "NONE",
    },
  };
}

async function tdsTcsStatus(session: BusinessSession, tenantId: string, bookSetId: string, asOfDate: string): Promise<CompanyStatusBookSetSummary["tdsTcs"]> {
  const profiles = await session.query("SELECT id FROM party_tax_profiles WHERE tenant_id = ? AND book_set_id = ? AND verification_status <> 'VERIFIED'", [tenantId, bookSetId]);
  const deductors = await session.query("SELECT id FROM tenant_deductor_profiles WHERE tenant_id = ? AND verification_status <> 'VERIFIED'", [tenantId]);
  const rules = await session.query("SELECT id, effective_from, effective_to FROM tax_rule_snapshots WHERE tenant_id = ? AND source_verified = 0", [tenantId]);
  const liabilities = await session.query("SELECT id, tax_amount_minor FROM withholding_events WHERE tenant_id = ? AND book_set_id = ? AND event_date <= ? AND status = 'POSTED'", [tenantId, bookSetId, asOfDate]);
  let undepositedLiabilityCount = 0; let undepositedLiabilityMinor = 0;
  for (const row of liabilities.rows) { const allocations = await session.query("SELECT amount_minor FROM withholding_deposit_allocations WHERE tenant_id = ? AND book_set_id = ? AND event_id = ?", [tenantId, bookSetId, String(row.id)]); const deposited = allocations.rows.reduce((sum, item) => sum + numeric(item.amount_minor, "TDS/TCS deposit"), 0); const outstanding = numeric(row.tax_amount_minor, "TDS/TCS liability") - deposited; if (outstanding > 0) { undepositedLiabilityCount += 1; undepositedLiabilityMinor = add(undepositedLiabilityMinor, outstanding, "TDS/TCS liability total"); } }
  const cases = await session.query("SELECT state FROM withholding_compliance_cases WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  let rejectedCaseCount = 0; let unsubmittedCaseCount = 0;
  for (const row of cases.rows) { if (String(row.state) === "REJECTED") rejectedCaseCount += 1; if (["PREPARED", "EXPORTED"].includes(String(row.state))) unsubmittedCaseCount += 1; }
  const effectiveUnverifiedRules = rules.rows.filter((row) => String(row.effective_from) <= asOfDate && (row.effective_to === null || row.effective_to === undefined || String(row.effective_to) >= asOfDate)).length;
  return { unverifiedProfileCount: profiles.rows.length + deductors.rows.length, unverifiedRuleCount: effectiveUnverifiedRules, undepositedLiabilityCount, undepositedLiabilityMinor, rejectedCaseCount, unsubmittedCaseCount };
}

async function assetStatus(session: BusinessSession, tenantId: string, bookSetId: string, asOfDate: string): Promise<CompanyStatusBookSetSummary["assets"]> {
  const manual = await session.query("SELECT id FROM fixed_assets WHERE tenant_id = ? AND book_set_id = ? AND source_vendor_bill_line_id IS NULL AND acquisition_date <= ?", [tenantId, bookSetId, asOfDate]);
  const active = await session.query("SELECT id, tax_block_id FROM fixed_assets WHERE tenant_id = ? AND book_set_id = ? AND status = 'ACTIVE' AND put_to_use_date <= ?", [tenantId, bookSetId, asOfDate]);
  const postedAssets = await session.query("SELECT dl.asset_id FROM asset_depreciation_lines dl JOIN asset_depreciation_runs dr ON dr.id = dl.run_id AND dr.tenant_id = dl.tenant_id AND dr.book_set_id = dl.book_set_id WHERE dl.tenant_id = ? AND dl.book_set_id = ? AND dr.status = 'POSTED' AND dr.period_end <= ? ORDER BY dl.asset_id", [tenantId, bookSetId, asOfDate]);
  const postedAssetIds = new Set(postedAssets.rows.map((row) => String(row.asset_id)));
  const previewNeededCount = active.rows.filter((row) => !postedAssetIds.has(String(row.id))).length;
  const missingRule = await session.query("SELECT a.id, b.id AS block_id, r.id AS rule_id, r.source_verified, r.effective_from, r.effective_to FROM fixed_assets a LEFT JOIN asset_tax_blocks b ON b.id = a.tax_block_id AND b.tenant_id = a.tenant_id AND b.book_set_id = a.book_set_id LEFT JOIN asset_tax_rule_snapshots r ON r.id = b.rule_snapshot_id AND r.tenant_id = a.tenant_id WHERE a.tenant_id = ? AND a.book_set_id = ? AND a.status = 'ACTIVE'", [tenantId, bookSetId]);
  const missingRuleCount = missingRule.rows.filter((row) => row.block_id == null || row.rule_id == null || Number(row.source_verified) !== 1 || String(row.effective_from) > asOfDate || (row.effective_to != null && String(row.effective_to) < asOfDate)).length;
  const taxBlocks = await session.query("SELECT id FROM asset_tax_blocks WHERE tenant_id = ? AND book_set_id = ? ORDER BY id", [tenantId, bookSetId]);
  let taxUnrunCount = 0;
  for (const block of taxBlocks.rows) { const run = await session.querySingle("SELECT l.id FROM asset_tax_run_lines l JOIN asset_tax_runs r ON r.id = l.run_id AND r.tenant_id = l.tenant_id AND r.book_set_id = l.book_set_id WHERE l.block_id = ? AND l.tenant_id = ? AND l.book_set_id = ? AND r.period_end <= ?", [block.id, tenantId, bookSetId, asOfDate]); if (!run) taxUnrunCount += 1; }
  const anomalies = await session.query("SELECT id FROM fixed_assets WHERE tenant_id = ? AND book_set_id = ? AND status = 'DISPOSED' AND disposed_at IS NULL OR tenant_id = ? AND book_set_id = ? AND status = 'ACTIVE' AND disposed_at IS NOT NULL", [tenantId, bookSetId, tenantId, bookSetId]);
  return { manualEvidenceCount: manual.rows.length, previewNeededCount, taxRuleMissingCount: missingRuleCount, taxUnrunCount, disposedOpenAnomalyCount: anomalies.rows.length };
}

async function fxStatus(session: BusinessSession, tenantId: string, bookSetId: string): Promise<CompanyStatusBookSetSummary["fx"]> {
  const documents = await session.query("SELECT document_type, document_id, total_foreign_minor FROM fx_document_facts WHERE tenant_id = ? AND book_set_id = ? ORDER BY document_type, document_id", [tenantId, bookSetId]);
  let foreignOpenItemCount = 0;
  for (const document of documents.rows) {
    const allocations = await session.query("SELECT foreign_minor FROM fx_allocation_facts WHERE tenant_id = ? AND book_set_id = ? AND document_type = ? AND document_id = ?", [tenantId, bookSetId, document.document_type, document.document_id]);
    const settled = allocations.rows.reduce((total, row) => total + Number(row.foreign_minor), 0);
    if (settled < Number(document.total_foreign_minor)) foreignOpenItemCount += 1;
  }
  const documentRates = await session.query("SELECT rate_snapshot_id FROM fx_document_facts WHERE tenant_id=? AND book_set_id=? ORDER BY document_id", [tenantId, bookSetId]);
  let missingOrUnverifiedRateCount = 0;
  for (const document of documentRates.rows) {
    const rate = await session.querySingle("SELECT id, verified FROM fx_rate_snapshots WHERE id=? AND tenant_id=? AND book_set_id=?", [document.rate_snapshot_id, tenantId, bookSetId]);
    if (!rate || Number(rate.verified) !== 1) missingOrUnverifiedRateCount += 1;
  }
  const unreversed = await session.query("SELECT DISTINCT r.id FROM fx_revaluation_runs r JOIN fx_revaluation_lines l ON l.run_id=r.id AND l.tenant_id=r.tenant_id AND l.book_set_id=r.book_set_id LEFT JOIN fx_revaluation_reversals x ON x.run_id=r.id AND x.tenant_id=r.tenant_id AND x.book_set_id=r.book_set_id WHERE r.tenant_id=? AND r.book_set_id=? AND r.status='POSTED' AND x.id IS NULL", [tenantId, bookSetId]);
  const mismatches = await session.query("SELECT id FROM fx_allocation_facts WHERE tenant_id=? AND book_set_id=? AND actual_bank_base_minor <= 0", [tenantId, bookSetId]);
  return { foreignOpenItemCount, missingOrUnverifiedRateCount, unreversedRevaluationCount: unreversed.rows.length, settlementMismatchCount: mismatches.rows.length };
}

async function payrollStatus(session: BusinessSession, tenantId: string, bookSetId: string): Promise<CompanyStatusBookSetSummary["payroll"]> {
  const employees = await session.query("SELECT id FROM payroll_employees WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  const runs = await session.query("SELECT id FROM payroll_pay_runs WHERE tenant_id = ? AND book_set_id = ? AND status = 'PREPARED'", [tenantId, bookSetId]);
  const claims = await session.query("SELECT id FROM payroll_claims WHERE tenant_id = ? AND book_set_id = ? AND status = 'PENDING'", [tenantId, bookSetId]);
  const rules = await session.query("SELECT id FROM payroll_rule_snapshots WHERE tenant_id = ? AND book_set_id = ? AND status <> 'VERIFIED'", [tenantId, bookSetId]);
  const payable = await session.query("SELECT net_minor FROM payroll_pay_run_employees WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  return { employeeCount: employees.rows.length, preparedRunCount: runs.rows.length, pendingClaimCount: claims.rows.length, reviewRuleCount: rules.rows.length, postedNetPayableMinor: payable.rows.reduce((total, row) => total + Number(row.net_minor ?? 0), 0) };
}

async function expenseStatus(session: BusinessSession, tenantId: string, bookSetId: string): Promise<CompanyStatusBookSetSummary["expenses"]> {
  const submitted = await session.query("SELECT id FROM expense_claims WHERE tenant_id = ? AND book_set_id = ? AND status = 'SUBMITTED'", [tenantId, bookSetId]);
  const claims = await session.query("SELECT id, business_total_minor FROM expense_claims WHERE tenant_id = ? AND book_set_id = ? AND status IN ('POSTED','PARTIALLY_SETTLED')", [tenantId, bookSetId]);
  let openReimbursementPayableMinor = 0;
  for (const claim of claims.rows) {
    const allocated = await session.querySingle("SELECT COALESCE(SUM(amount_minor), 0) AS amount FROM expense_advance_allocations WHERE tenant_id = ? AND book_set_id = ? AND claim_id = ?", [tenantId, bookSetId, String(claim.id)]);
    const reimbursed = await session.querySingle("SELECT COALESCE(SUM(amount_minor), 0) AS amount FROM expense_reimbursements WHERE tenant_id = ? AND book_set_id = ? AND claim_id = ?", [tenantId, bookSetId, String(claim.id)]);
    openReimbursementPayableMinor = add(openReimbursementPayableMinor, Math.max(0, numeric(claim.business_total_minor) - numeric(allocated?.amount) - numeric(reimbursed?.amount)), "expense reimbursement payable");
  }
  const advances = await session.query("SELECT id, amount_minor FROM expense_advances WHERE tenant_id = ? AND book_set_id = ? AND status IN ('OPEN','PARTIALLY_SETTLED')", [tenantId, bookSetId]);
  let openAdvanceMinor = 0;
  for (const advance of advances.rows) {
    const allocated = await session.querySingle("SELECT COALESCE(SUM(amount_minor), 0) AS amount FROM expense_advance_allocations WHERE tenant_id = ? AND book_set_id = ? AND advance_id = ?", [tenantId, bookSetId, String(advance.id)]);
    const repaid = await session.querySingle("SELECT COALESCE(SUM(amount_minor), 0) AS amount FROM expense_advance_repayments WHERE tenant_id = ? AND book_set_id = ? AND advance_id = ?", [tenantId, bookSetId, String(advance.id)]);
    openAdvanceMinor = add(openAdvanceMinor, Math.max(0, numeric(advance.amount_minor) - numeric(allocated?.amount) - numeric(repaid?.amount)), "expense advance total");
  }
  const exceptions = await session.query("SELECT l.id FROM expense_claim_lines l JOIN expense_claims c ON c.id = l.claim_id AND c.tenant_id = l.tenant_id AND c.book_set_id = l.book_set_id WHERE l.tenant_id = ? AND l.book_set_id = ? AND c.status NOT IN ('REJECTED','CANCELLED') AND l.evidence_status <> 'ATTACHED'", [tenantId, bookSetId]);
  return { submittedClaimCount: submitted.rows.length, pendingReviewClaimCount: submitted.rows.length, openReimbursementPayableMinor, openAdvanceCount: advances.rows.length, openAdvanceMinor, evidenceExceptionCount: exceptions.rows.length };
}

async function complianceStatus(session: BusinessSession, tenantId: string, bookSetId: string, asOfDate: string): Promise<CompanyStatusBookSetSummary["compliance"]> {
  const obligations = await session.query("SELECT id, rule_id, gst_registration_id, period_start, period_end, due_date FROM compliance_obligations WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  let openCount = 0; let overdueCount = 0; let blockedPredecessorCount = 0;
  for (const obligation of obligations.rows) {
    const event = await session.querySingle("SELECT event_type FROM compliance_obligation_events WHERE obligation_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1", [obligation.id, tenantId, bookSetId]);
    const status = String(event?.event_type ?? "OPEN");
    if (!["CLOSED", "WAIVED", "EXEMPT"].includes(status)) { openCount += 1; if (String(obligation.due_date) < asOfDate) overdueCount += 1; }
    if (status === "OPEN") {
      const predecessors = await session.query("SELECT predecessor_rule_id, required_status FROM compliance_rule_predecessors WHERE rule_id = ? AND tenant_id = ? AND book_set_id = ?", [obligation.rule_id, tenantId, bookSetId]);
      for (const predecessor of predecessors.rows) {
        const predecessorObligation = obligation.gst_registration_id == null ? await session.querySingle("SELECT id FROM compliance_obligations WHERE rule_id = ? AND tenant_id = ? AND book_set_id = ? AND period_start = ? AND period_end = ? AND gst_registration_id IS NULL", [predecessor.predecessor_rule_id, tenantId, bookSetId, obligation.period_start, obligation.period_end]) : await session.querySingle("SELECT id FROM compliance_obligations WHERE rule_id = ? AND tenant_id = ? AND book_set_id = ? AND period_start = ? AND period_end = ? AND gst_registration_id = ?", [predecessor.predecessor_rule_id, tenantId, bookSetId, obligation.period_start, obligation.period_end, obligation.gst_registration_id]);
        const predecessorStatus = predecessorObligation ? await session.querySingle("SELECT event_type FROM compliance_obligation_events WHERE obligation_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1", [predecessorObligation.id, tenantId, bookSetId]) : undefined;
        if (!predecessorObligation || String(predecessorStatus?.event_type) !== String(predecessor.required_status)) blockedPredecessorCount += 1;
      }
    }
  }
  const decisions = await session.query("SELECT decision, missing_keys_json FROM compliance_applicability_decisions WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  const unknown = decisions.rows.filter((row) => String(row.decision) === "UNKNOWN");
  const missing = unknown.filter((row) => { try { return (JSON.parse(String(row.missing_keys_json)) as unknown[]).length > 0; } catch { return true; } });
  return { obligationCount: obligations.rows.length, openCount, overdueCount, unknownApplicabilityCount: unknown.length, missingFactsCount: missing.length, blockedPredecessorCount };
}

function issuesFor(summary: CompanyStatusBookSetSummary): CompanyStatusIssue[] {
  const issues: CompanyStatusIssue[] = [];
  if (!summary.ledger.isBalanced) issues.push({ severity: "BLOCKED", code: "LEDGER_UNBALANCED", bookSetId: summary.bookSet.bookSetId, amountMinor: Math.abs(summary.ledger.totalDebitMinor - summary.ledger.totalCreditMinor) });
  if (summary.receivables.overdue.count > 0) issues.push({ severity: "HIGH", code: "RECEIVABLES_OVERDUE", bookSetId: summary.bookSet.bookSetId, count: summary.receivables.overdue.count, amountMinor: summary.receivables.overdue.amountMinor });
  if (summary.payables.overdue.count > 0) issues.push({ severity: "HIGH", code: "PAYABLES_OVERDUE", bookSetId: summary.bookSet.bookSetId, count: summary.payables.overdue.count, amountMinor: summary.payables.overdue.amountMinor });
  for (const bank of summary.bankReconciliation.latestByBankAccount) {
    if (!bank.isReconciled) issues.push({ severity: "HIGH", code: "BANK_RECONCILIATION_REVIEW", bookSetId: summary.bookSet.bookSetId, count: bank.unmatchedCount, amountMinor: bank.differenceMinor });
  }
  if (summary.gst.pendingReviewItc.count > 0) issues.push({ severity: "MEDIUM", code: "GST_ITC_PENDING_REVIEW", bookSetId: summary.bookSet.bookSetId, count: summary.gst.pendingReviewItc.count, amountMinor: summary.gst.pendingReviewItc.amountMinor });
  if (summary.tdsTcs.unverifiedProfileCount > 0) issues.push({ severity: "HIGH", code: "TDS_TCS_PROFILE_UNVERIFIED", bookSetId: summary.bookSet.bookSetId, count: summary.tdsTcs.unverifiedProfileCount });
  if (summary.tdsTcs.unverifiedRuleCount > 0) issues.push({ severity: "HIGH", code: "TDS_TCS_RULE_UNVERIFIED", bookSetId: summary.bookSet.bookSetId, count: summary.tdsTcs.unverifiedRuleCount });
  if (summary.tdsTcs.undepositedLiabilityCount > 0) issues.push({ severity: "HIGH", code: "TDS_TCS_LIABILITY_UNDEPOSITED", bookSetId: summary.bookSet.bookSetId, count: summary.tdsTcs.undepositedLiabilityCount, amountMinor: summary.tdsTcs.undepositedLiabilityMinor });
  if (summary.tdsTcs.rejectedCaseCount > 0) issues.push({ severity: "HIGH", code: "TDS_TCS_CASE_REJECTED", bookSetId: summary.bookSet.bookSetId, count: summary.tdsTcs.rejectedCaseCount });
  if (summary.tdsTcs.unsubmittedCaseCount > 0) issues.push({ severity: "MEDIUM", code: "TDS_TCS_CASE_UNSUBMITTED", bookSetId: summary.bookSet.bookSetId, count: summary.tdsTcs.unsubmittedCaseCount });
  if (summary.assets.manualEvidenceCount > 0) issues.push({ severity: "MEDIUM", code: "FIXED_ASSET_MANUAL_EVIDENCE", bookSetId: summary.bookSet.bookSetId, count: summary.assets.manualEvidenceCount });
  if (summary.assets.previewNeededCount > 0) issues.push({ severity: "MEDIUM", code: "FIXED_ASSET_DEPRECIATION_PREVIEW_NEEDED", bookSetId: summary.bookSet.bookSetId, count: summary.assets.previewNeededCount });
  if (summary.assets.taxRuleMissingCount > 0) issues.push({ severity: "HIGH", code: "FIXED_ASSET_TAX_RULE_MISSING", bookSetId: summary.bookSet.bookSetId, count: summary.assets.taxRuleMissingCount });
  if (summary.assets.taxUnrunCount > 0) issues.push({ severity: "MEDIUM", code: "FIXED_ASSET_TAX_UNRUN", bookSetId: summary.bookSet.bookSetId, count: summary.assets.taxUnrunCount });
  if (summary.assets.disposedOpenAnomalyCount > 0) issues.push({ severity: "BLOCKED", code: "FIXED_ASSET_DISPOSAL_ANOMALY", bookSetId: summary.bookSet.bookSetId, count: summary.assets.disposedOpenAnomalyCount });
  if (summary.expenses.pendingReviewClaimCount > 0) issues.push({ severity: "HIGH", code: "EXPENSE_CLAIMS_PENDING_REVIEW", bookSetId: summary.bookSet.bookSetId, count: summary.expenses.pendingReviewClaimCount });
  if (summary.expenses.evidenceExceptionCount > 0) issues.push({ severity: "MEDIUM", code: "EXPENSE_EVIDENCE_EXCEPTION", bookSetId: summary.bookSet.bookSetId, count: summary.expenses.evidenceExceptionCount });
  if (summary.expenses.openReimbursementPayableMinor > 0) issues.push({ severity: "INFO", code: "EXPENSE_REIMBURSEMENT_PAYABLE", bookSetId: summary.bookSet.bookSetId, amountMinor: summary.expenses.openReimbursementPayableMinor });
  if (summary.expenses.openAdvanceMinor > 0) issues.push({ severity: "INFO", code: "EXPENSE_ADVANCES_OPEN", bookSetId: summary.bookSet.bookSetId, count: summary.expenses.openAdvanceCount, amountMinor: summary.expenses.openAdvanceMinor });
  if (summary.compliance.unknownApplicabilityCount > 0) issues.push({ severity: "HIGH", code: "COMPLIANCE_APPLICABILITY_UNKNOWN", bookSetId: summary.bookSet.bookSetId, count: summary.compliance.unknownApplicabilityCount });
  if (summary.compliance.missingFactsCount > 0) issues.push({ severity: "HIGH", code: "COMPLIANCE_FACTS_MISSING", bookSetId: summary.bookSet.bookSetId, count: summary.compliance.missingFactsCount });
  if (summary.compliance.blockedPredecessorCount > 0) issues.push({ severity: "HIGH", code: "COMPLIANCE_BLOCKED_PREDECESSOR", bookSetId: summary.bookSet.bookSetId, count: summary.compliance.blockedPredecessorCount });
  if (summary.compliance.overdueCount > 0) issues.push({ severity: "HIGH", code: "COMPLIANCE_OBLIGATION_OVERDUE", bookSetId: summary.bookSet.bookSetId, count: summary.compliance.overdueCount });
  if (summary.fx.missingOrUnverifiedRateCount > 0) issues.push({ severity: "HIGH", code: "FX_RATE_MISSING_OR_UNVERIFIED", bookSetId: summary.bookSet.bookSetId, count: summary.fx.missingOrUnverifiedRateCount });
  if (summary.fx.foreignOpenItemCount > 0) issues.push({ severity: "INFO", code: "FX_FOREIGN_OPEN_ITEMS", bookSetId: summary.bookSet.bookSetId, count: summary.fx.foreignOpenItemCount });
  if (summary.fx.unreversedRevaluationCount > 0) issues.push({ severity: "HIGH", code: "FX_REVALUATION_UNREVERSED", bookSetId: summary.bookSet.bookSetId, count: summary.fx.unreversedRevaluationCount });
  if (summary.fx.settlementMismatchCount > 0) issues.push({ severity: "BLOCKED", code: "FX_SETTLEMENT_MISMATCH", bookSetId: summary.bookSet.bookSetId, count: summary.fx.settlementMismatchCount });
  if (summary.payroll.pendingClaimCount > 0) issues.push({ severity: "HIGH", code: "PAYROLL_CLAIMS_PENDING", bookSetId: summary.bookSet.bookSetId, count: summary.payroll.pendingClaimCount });
  if (summary.payroll.reviewRuleCount > 0) issues.push({ severity: "HIGH", code: "PAYROLL_RULE_REVIEW_REQUIRED", bookSetId: summary.bookSet.bookSetId, count: summary.payroll.reviewRuleCount });
  if (summary.payroll.preparedRunCount > 0) issues.push({ severity: "MEDIUM", code: "PAYROLL_RUN_PENDING_APPROVAL", bookSetId: summary.bookSet.bookSetId, count: summary.payroll.preparedRunCount });
  issues.push({ severity: "INFO", code: "CASH_BANK_UNAVAILABLE", bookSetId: summary.bookSet.bookSetId });
  return issues;
}

function issueRank(issue: CompanyStatusIssue): number {
  return { BLOCKED: 0, HIGH: 1, MEDIUM: 2, INFO: 3 }[issue.severity];
}

function drillDown(tenantId: string, bookSetId: string, asOfDate: string, compliance?: CompanyStatusBookSetSummary["compliance"]): CompanyStatusDrillDown[] {
  const result: CompanyStatusDrillDown[] = [
    { operationId: "ledger.trial-balance", inputTemplate: { tenantId, bookSetId, asOfDate } },
    { operationId: "ledger.balance-sheet", inputTemplate: { tenantId, bookSetId, asOfDate } },
    { operationId: "ledger.profit-and-loss", inputTemplate: { tenantId, bookSetId, fromDate: "<YYYY-MM-DD>", toDate: asOfDate } },
    { operationId: "invoice.outstanding", inputTemplate: { tenantId, bookSetId } },
    { operationId: "bill.outstanding", inputTemplate: { tenantId, bookSetId } },
    { operationId: "bank-statement.list", inputTemplate: { tenantId, bookSetId } },
    { operationId: "gst.registration.list", inputTemplate: { tenantId, date: asOfDate } },
    { operationId: "asset.register.report", inputTemplate: { tenantId, bookSetId, asOfDate } },
    { operationId: "asset.depreciation.report", inputTemplate: { tenantId, bookSetId, periodStart: "<YYYY-MM-DD>", periodEnd: asOfDate } },
    { operationId: "asset.tax.report", inputTemplate: { tenantId, bookSetId, periodStart: "<YYYY-MM-DD>", periodEnd: asOfDate } },
    { operationId: "payroll.register", inputTemplate: { tenantId, bookSetId } },
    { operationId: "payroll.payslip.list", inputTemplate: { tenantId, bookSetId } },
    { operationId: "expense.claim.list", inputTemplate: { tenantId, bookSetId } },
    { operationId: "expense.open-items", inputTemplate: { tenantId, bookSetId } },
    { operationId: "expense.evidence-exceptions", inputTemplate: { tenantId, bookSetId } },
  ];
  if (compliance && (compliance.obligationCount > 0 || compliance.unknownApplicabilityCount > 0)) {
    result.push({ operationId: "compliance.obligation.calendar", inputTemplate: { tenantId, bookSetId, fromDate: "<YYYY-MM-DD>", toDate: asOfDate, asOfDate } }, { operationId: "compliance.status", inputTemplate: { tenantId, bookSetId, asOfDate } });
  }
  return result;
}

export class CompanyStatusService {
  constructor(
    private readonly sessionRunner: BusinessSessionRunner,
    private readonly compatibilityProvider: () => Promise<CompanyStatusCompatibility> = async () => ({
      status: "READY",
      currentSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
      requiredSchemaVersion: CURRENT_SCHEMA_MANIFEST.schemaVersion,
      currentDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
      requiredDataFormatVersion: CURRENT_SCHEMA_MANIFEST.dataFormatVersion,
    }),
  ) {}

  async status(input: CompanyStatusInput = {}): Promise<CompanyStatusResult> {
    const asOfDate = input.asOfDate ?? invocationDate();
    assertIsoDate(asOfDate, "asOfDate");
    const compatibility = await this.compatibilityProvider();
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const tenant = await selectTenant(session, input.tenantId);
      const tenantId = String(tenant.id);
      const bookSets = await selectBookSets(session, tenantId, input.bookSetId);
      const summaries: CompanyStatusBookSetSummary[] = [];
      for (const bookSet of bookSets) {
        const bookSetId = String(bookSet.id);
        const summary: CompanyStatusBookSetSummary = {
          bookSet: { bookSetId, tenantId, kind: String(bookSet.kind), displayName: String(bookSet.display_name), lifecycle: String(bookSet.lifecycle) },
          ledger: await ledgerHealth(session, tenantId, bookSetId, asOfDate),
          receivables: await openBalance(session, "sales_invoices", "issue_date", tenantId, bookSetId, asOfDate),
          payables: await openBalance(session, "vendor_bills", "bill_date", tenantId, bookSetId, asOfDate),
          drafts: await draftCounts(session, tenantId, bookSetId),
          bankReconciliation: await bankReconciliation(session, tenantId, bookSetId),
          gst: await gstStatus(session, tenantId, bookSetId, asOfDate),
          tdsTcs: await tdsTcsStatus(session, tenantId, bookSetId, asOfDate),
          assets: await assetStatus(session, tenantId, bookSetId, asOfDate),
          fx: await fxStatus(session, tenantId, bookSetId),
          payroll: await payrollStatus(session, tenantId, bookSetId),
          expenses: await expenseStatus(session, tenantId, bookSetId),
          compliance: await complianceStatus(session, tenantId, bookSetId, asOfDate),
          cashBank: { status: "UNAVAILABLE", reason: "ACCOUNT_CLASSIFICATION_UNAVAILABLE" },
        };
        summaries.push(summary);
      }
      const issues = summaries.flatMap(issuesFor).sort((left, right) => issueRank(left) - issueRank(right) || (left.code.localeCompare(right.code)) || String(left.bookSetId ?? "").localeCompare(String(right.bookSetId ?? "")));
      const hasBlocked = issues.some((issue) => issue.severity === "BLOCKED");
      return {
        databaseCompatibility: {
          status: compatibility.status,
          currentSchemaVersion: compatibility.currentSchemaVersion ?? compatibility.requiredSchemaVersion,
          requiredSchemaVersion: compatibility.requiredSchemaVersion,
          currentDataFormatVersion: compatibility.currentDataFormatVersion ?? compatibility.requiredDataFormatVersion,
          requiredDataFormatVersion: compatibility.requiredDataFormatVersion,
        },
        selectedTenant: { tenantId, name: String(tenant.name), kind: String(tenant.kind), lifecycle: String(tenant.lifecycle) },
        asOfDate,
        summaries,
        issues,
        overallReadiness: hasBlocked ? "BLOCKED" : issues.length > 0 ? "REVIEW_REQUIRED" : "READY",
        drillDown: summaries.flatMap((summary) => drillDown(tenantId, summary.bookSet.bookSetId, asOfDate, summary.compliance)),
      };
    });
  }
}
