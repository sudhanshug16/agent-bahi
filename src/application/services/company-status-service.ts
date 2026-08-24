import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError } from "../../core/types.ts";
import { CURRENT_SCHEMA_MANIFEST } from "../../infrastructure/schema/current-manifest.ts";

export interface CompanyStatusInput {
  tenantId?: TenantId;
  bookSetId?: BookSetId;
  taxCaseId?: string;
  asOfDate?: string;
  asOfTimestamp?: string;
  focus?: string;
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
  statusVersion: 2;
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
    hasPan: boolean;
    maskedPan?: string;
  };
  tenants: Array<{
    tenantId: string;
    name: string;
    kind: string;
    lifecycle: string;
    bookSetCount: number;
  }>;
  scope: {
    tenantId?: string;
    bookSetId?: string;
    taxCaseId?: string;
    global: boolean;
  };
  asOfDate: string;
  asOfTimestamp: string;
  cards: CompanyStatusCard[];
  overallStatus: CompanyStatusCardState;
  truncation: {
    tenants: boolean;
    bookSets: boolean;
    cards: boolean;
    details: boolean;
  };
  summaries: CompanyStatusBookSetSummary[];
  issues: CompanyStatusIssue[];
  overallReadiness: "BLOCKED" | "REVIEW_REQUIRED" | "READY";
  drillDown: CompanyStatusDrillDown[];
}

export type CompanyStatusCardState = "HEALTHY" | "ACTION_REQUIRED" | "BLOCKED" | "NOT_CONFIGURED" | "NOT_APPLICABLE" | "UNKNOWN";

export interface CompanyStatusCard {
  id: string;
  status: CompanyStatusCardState;
  summary: string;
  counts: Record<string, number>;
  actionCodes: string[];
  blockerCodes: string[];
  asOfDate: string;
  asOfTimestamp: string;
  drillDowns: CompanyStatusDrillDown[];
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
    assetCount: number;
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

function maskIdentifier(value: string): string {
  if (value.length <= 8) return `****${value.slice(-4)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function selectTenants(session: BusinessSession, requestedTenantId?: TenantId): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  if (requestedTenantId) {
    const row = await session.querySingle("SELECT id, kind, lifecycle, name FROM tenants WHERE id = ?", [requestedTenantId]);
    if (!row) throw new DomainError("TENANT_NOT_FOUND", "tenant does not exist", { tenantId: requestedTenantId });
    if (String(row.lifecycle) !== "ACTIVE") throw new DomainError("TENANT_INACTIVE", "tenant is not ACTIVE", { tenantId: requestedTenantId });
    return { rows: [row], truncated: false };
  }
  const rows = await session.query("SELECT id, kind, lifecycle, name FROM tenants WHERE lifecycle = 'ACTIVE' ORDER BY id LIMIT 51");
  if (rows.rows.length === 0) throw new DomainError("NO_ACTIVE_TENANT", "no ACTIVE tenant is available");
  return { rows: rows.rows.slice(0, 50), truncated: rows.rows.length > 50 };
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
    "SELECT id, tenant_id, kind, display_name, lifecycle FROM book_sets WHERE tenant_id = ? AND lifecycle = 'ACTIVE' ORDER BY id LIMIT 51",
    [tenantId],
  );
  return rows.rows.slice(0, 50);
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
     WHERE tenant_id = ? AND book_set_id = ? AND status IN ('POSTED', 'PARTIALLY_PAID') AND ${dateColumn} <= ? AND ${settled} < total_minor
      ORDER BY ${dateColumn}, id`,
    [tenantId, bookSetId, asOfDate],
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
  if (statements.length === 0) return { latestByBankAccount: [], truncated: statementRows.rows.length > 50 };
  const statementIds = statements.map((statement) => String(statement.id));
  const placeholders = statementIds.map(() => "?").join(",");
  const [lineRows, matchRows, bookRows] = await Promise.all([
    session.query(`SELECT l.statement_id, l.signed_amount_minor, l.id FROM bank_statement_lines l WHERE l.tenant_id = ? AND l.book_set_id = ? AND l.statement_id IN (${placeholders}) ORDER BY l.statement_id, l.line_number, l.id`, [tenantId, bookSetId, ...statementIds]),
    session.query(`SELECT statement_id, statement_line_id FROM bank_matches WHERE tenant_id = ? AND book_set_id = ? AND status = 'ACTIVE' AND statement_id IN (${placeholders})`, [tenantId, bookSetId, ...statementIds]),
    session.query("SELECT je.posting_date, jl.account_id, jl.debit_minor, jl.credit_minor FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.tenant_id = je.tenant_id AND jl.book_set_id = je.book_set_id WHERE je.tenant_id = ? AND je.book_set_id = ? AND je.status = 'POSTED'", [tenantId, bookSetId]),
  ]);
  const linesByStatement = new Map<string, Record<string, unknown>[]>();
  for (const line of lineRows.rows) { const key = String(line.statement_id); linesByStatement.set(key, [...(linesByStatement.get(key) ?? []), line]); }
  const matchedLineIdsByStatement = new Map<string, Set<string>>();
  for (const match of matchRows.rows) { const key = String(match.statement_id); const ids = matchedLineIdsByStatement.get(key) ?? new Set<string>(); ids.add(String(match.statement_line_id)); matchedLineIdsByStatement.set(key, ids); }
  for (const statement of statements) {
    const lines = linesByStatement.get(String(statement.id)) ?? [];
    const matchedLineIds = matchedLineIdsByStatement.get(String(statement.id)) ?? new Set<string>();
    let net = 0;
    let matchedCount = 0;
    for (const line of lines) {
      net = add(net, numeric(line.signed_amount_minor, "bank statement line"), "bank statement net");
      if (matchedLineIds.has(String(line.id))) matchedCount += 1;
    }
    const opening = numeric(statement.opening_balance_minor, "bank opening balance");
    const closing = numeric(statement.closing_balance_minor, "bank closing balance");
    const arithmeticValid = add(opening, net, "bank arithmetic") === closing;
    let bookBefore = 0;
    let bookEnding = 0;
    for (const line of bookRows.rows.filter((row) => String(row.account_id) === String(statement.bank_account_id))) {
      const amount = numeric(line.debit_minor, "bank debit") - numeric(line.credit_minor, "bank credit");
      if (String(line.posting_date) < String(statement.period_start)) bookBefore = add(bookBefore, amount, "bank book balance");
      if (String(line.posting_date) <= String(statement.period_end)) bookEnding = add(bookEnding, amount, "bank book balance");
    }
    const unmatchedCount = lines.length - matchedCount;
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
  const liabilities = await session.query("SELECT e.id, e.tax_amount_minor, COALESCE(SUM(a.amount_minor), 0) AS deposited_minor FROM withholding_events e LEFT JOIN withholding_deposit_allocations a ON a.event_id = e.id AND a.tenant_id = e.tenant_id AND a.book_set_id = e.book_set_id WHERE e.tenant_id = ? AND e.book_set_id = ? AND e.event_date <= ? AND e.status = 'POSTED' GROUP BY e.id, e.tax_amount_minor", [tenantId, bookSetId, asOfDate]);
  let undepositedLiabilityCount = 0; let undepositedLiabilityMinor = 0;
  for (const row of liabilities.rows) { const outstanding = numeric(row.tax_amount_minor, "TDS/TCS liability") - numeric(row.deposited_minor, "TDS/TCS deposit"); if (outstanding > 0) { undepositedLiabilityCount += 1; undepositedLiabilityMinor = add(undepositedLiabilityMinor, outstanding, "TDS/TCS liability total"); } }
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
  const taxBlocks = await session.query("SELECT b.id, l.id AS run_line_id FROM asset_tax_blocks b LEFT JOIN asset_tax_run_lines l ON l.block_id = b.id AND l.tenant_id = b.tenant_id AND l.book_set_id = b.book_set_id LEFT JOIN asset_tax_runs r ON r.id = l.run_id AND r.tenant_id = l.tenant_id AND r.book_set_id = l.book_set_id AND r.period_end <= ? WHERE b.tenant_id = ? AND b.book_set_id = ? ORDER BY b.id", [asOfDate, tenantId, bookSetId]);
  const taxUnrunCount = taxBlocks.rows.filter((block) => block.run_line_id == null).length;
  const disposedAnomalies = await session.query("SELECT id FROM fixed_assets WHERE tenant_id = ? AND book_set_id = ? AND status = 'DISPOSED' AND disposed_at IS NULL", [tenantId, bookSetId]);
  const activeAnomalies = await session.query("SELECT id FROM fixed_assets WHERE tenant_id = ? AND book_set_id = ? AND status = 'ACTIVE' AND disposed_at IS NOT NULL", [tenantId, bookSetId]);
  const allAssets = await session.query("SELECT id FROM fixed_assets WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  return { assetCount: allAssets.rows.length, manualEvidenceCount: manual.rows.length, previewNeededCount, taxRuleMissingCount: missingRuleCount, taxUnrunCount, disposedOpenAnomalyCount: disposedAnomalies.rows.length + activeAnomalies.rows.length };
}

async function fxStatus(session: BusinessSession, tenantId: string, bookSetId: string): Promise<CompanyStatusBookSetSummary["fx"]> {
  const documents = await session.query("SELECT document_type, document_id, total_foreign_minor FROM fx_document_facts WHERE tenant_id = ? AND book_set_id = ? ORDER BY document_type, document_id", [tenantId, bookSetId]);
  let foreignOpenItemCount = 0;
  const openDocuments = await session.query("SELECT d.document_id, d.total_foreign_minor, COALESCE(SUM(a.foreign_minor), 0) AS settled_foreign_minor FROM fx_document_facts d LEFT JOIN fx_allocation_facts a ON a.document_type = d.document_type AND a.document_id = d.document_id AND a.tenant_id = d.tenant_id AND a.book_set_id = d.book_set_id WHERE d.tenant_id = ? AND d.book_set_id = ? GROUP BY d.document_id, d.total_foreign_minor", [tenantId, bookSetId]);
  foreignOpenItemCount = openDocuments.rows.filter((document) => Number(document.settled_foreign_minor) < Number(document.total_foreign_minor)).length;
  const documentRates = await session.query("SELECT d.id, r.verified FROM fx_document_facts d LEFT JOIN fx_rate_snapshots r ON r.id = d.rate_snapshot_id AND r.tenant_id = d.tenant_id AND r.book_set_id = d.book_set_id WHERE d.tenant_id=? AND d.book_set_id=? ORDER BY d.document_id", [tenantId, bookSetId]);
  const missingOrUnverifiedRateCount = documentRates.rows.filter((document) => Number(document.verified) !== 1).length;
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
  const claimBalances = await session.query("SELECT id, business_total_minor FROM expense_claims WHERE tenant_id = ? AND book_set_id = ? AND status IN ('POSTED','PARTIALLY_SETTLED')", [tenantId, bookSetId]);
  const claimAllocations = await session.query("SELECT claim_id, amount_minor FROM expense_advance_allocations WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  const reimbursements = await session.query("SELECT claim_id, amount_minor FROM expense_reimbursements WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  const totals = (rows: readonly Record<string, unknown>[]) => { const result = new Map<string, number>(); for (const row of rows) result.set(String(row.claim_id), add(result.get(String(row.claim_id)) ?? 0, numeric(row.amount_minor), "expense allocation")); return result; };
  const allocatedByClaim = totals(claimAllocations.rows); const reimbursedByClaim = totals(reimbursements.rows);
  for (const claim of claimBalances.rows) openReimbursementPayableMinor = add(openReimbursementPayableMinor, Math.max(0, numeric(claim.business_total_minor) - (allocatedByClaim.get(String(claim.id)) ?? 0) - (reimbursedByClaim.get(String(claim.id)) ?? 0)), "expense reimbursement payable");
  const advances = await session.query("SELECT id, amount_minor FROM expense_advances WHERE tenant_id = ? AND book_set_id = ? AND status IN ('OPEN','PARTIALLY_SETTLED')", [tenantId, bookSetId]);
  const advanceAllocations = await session.query("SELECT advance_id, amount_minor FROM expense_advance_allocations WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  const repayments = await session.query("SELECT advance_id, amount_minor FROM expense_advance_repayments WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  const allocatedByAdvance = totals(advanceAllocations.rows.map((row) => ({ claim_id: row.advance_id, amount_minor: row.amount_minor }))); const repaidByAdvance = totals(repayments.rows.map((row) => ({ claim_id: row.advance_id, amount_minor: row.amount_minor })));
  let openAdvanceMinor = 0;
  for (const advance of advances.rows) openAdvanceMinor = add(openAdvanceMinor, Math.max(0, numeric(advance.amount_minor) - (allocatedByAdvance.get(String(advance.id)) ?? 0) - (repaidByAdvance.get(String(advance.id)) ?? 0)), "expense advance total");
  const exceptions = await session.query("SELECT l.id FROM expense_claim_lines l JOIN expense_claims c ON c.id = l.claim_id AND c.tenant_id = l.tenant_id AND c.book_set_id = l.book_set_id WHERE l.tenant_id = ? AND l.book_set_id = ? AND c.status NOT IN ('REJECTED','CANCELLED') AND l.evidence_status <> 'ATTACHED'", [tenantId, bookSetId]);
  return { submittedClaimCount: submitted.rows.length, pendingReviewClaimCount: submitted.rows.length, openReimbursementPayableMinor, openAdvanceCount: advances.rows.length, openAdvanceMinor, evidenceExceptionCount: exceptions.rows.length };
}

async function complianceStatus(session: BusinessSession, tenantId: string, bookSetId: string, asOfDate: string): Promise<CompanyStatusBookSetSummary["compliance"]> {
  const obligations = await session.query("SELECT id, rule_id, gst_registration_id, period_start, period_end, due_date FROM compliance_obligations WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  const events = await session.query("SELECT obligation_id, event_type, occurred_at, rowid FROM compliance_obligation_events WHERE tenant_id = ? AND book_set_id = ? ORDER BY obligation_id, occurred_at DESC, rowid DESC", [tenantId, bookSetId]);
  const predecessors = await session.query("SELECT rule_id, predecessor_rule_id, required_status FROM compliance_rule_predecessors WHERE tenant_id = ? AND book_set_id = ? ORDER BY rule_id, predecessor_rule_id", [tenantId, bookSetId]);
  const latestEvent = new Map<string, string>();
  for (const event of events.rows) if (!latestEvent.has(String(event.obligation_id))) latestEvent.set(String(event.obligation_id), String(event.event_type));
  const obligationByKey = new Map<string, Record<string, unknown>>();
  for (const obligation of obligations.rows) obligationByKey.set(`${String(obligation.rule_id)}|${String(obligation.period_start)}|${String(obligation.period_end)}|${obligation.gst_registration_id == null ? "" : String(obligation.gst_registration_id)}`, obligation);
  let openCount = 0; let overdueCount = 0; let blockedPredecessorCount = 0;
  for (const obligation of obligations.rows) {
    const status = latestEvent.get(String(obligation.id)) ?? "OPEN";
    if (!["CLOSED", "WAIVED", "EXEMPT"].includes(status)) { openCount += 1; if (String(obligation.due_date) < asOfDate) overdueCount += 1; }
    if (status === "OPEN") {
      for (const predecessor of predecessors.rows.filter((item) => String(item.rule_id) === String(obligation.rule_id))) {
        const key = `${String(predecessor.predecessor_rule_id)}|${String(obligation.period_start)}|${String(obligation.period_end)}|${obligation.gst_registration_id == null ? "" : String(obligation.gst_registration_id)}`;
        const predecessorObligation = obligationByKey.get(key);
        if (!predecessorObligation || (latestEvent.get(String(predecessorObligation.id)) ?? "OPEN") !== String(predecessor.required_status)) blockedPredecessorCount += 1;
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

const CARD_LIMIT = 100;
const CARD_FOCUSES = new Set([
  "database", "tenant-bookset", "journal-reports", "ar", "ap", "bank", "gst", "tds-tcs", "fixed-assets", "fx", "payroll", "expenses", "compliance", "period-close", "tenant-pan", "personal-tax", "skills", "remote-mcp",
]);
const FOCUS_ALIASES: Record<string, string> = {
  operations: "database", "blocks-and-partials": "period-close", "unreconciled-bank": "bank", "overdue-invoices": "ar", "unpaid-bills": "ap", "evidence-pending": "expenses", "compliance-obligations": "compliance", "other-exceptions": "tenant-bookset",
};

function cardState(configured: boolean, blocked: boolean, unknown: boolean, action: boolean, notApplicable = false): CompanyStatusCardState {
  if (notApplicable) return "NOT_APPLICABLE";
  if (blocked) return "BLOCKED";
  if (unknown) return "UNKNOWN";
  if (!configured) return "NOT_CONFIGURED";
  return action ? "ACTION_REQUIRED" : "HEALTHY";
}

function countSummary(summaries: readonly CompanyStatusBookSetSummary[], getter: (summary: CompanyStatusBookSetSummary) => number): number {
  return summaries.reduce((total, summary) => total + getter(summary), 0);
}

function card(
  id: string,
  status: CompanyStatusCardState,
  summary: string,
  counts: Record<string, number>,
  actionCodes: string[],
  blockerCodes: string[],
  asOfDate: string,
  asOfTimestamp: string,
  drillDowns: CompanyStatusDrillDown[],
): CompanyStatusCard {
  return { id, status, summary: summary.slice(0, 240), counts, actionCodes: [...new Set(actionCodes)].sort(), blockerCodes: [...new Set(blockerCodes)].sort(), asOfDate, asOfTimestamp, drillDowns };
}

function scopeDrillDowns(tenantId: string | undefined, bookSetId: string | undefined, asOfDate: string, asOfTimestamp: string): CompanyStatusDrillDown[] {
  const scope = {
    ...(tenantId ? { tenantId } : {}),
    ...(bookSetId ? { bookSetId } : {}),
    asOfDate,
    asOfTimestamp,
  };
  return [
    { operationId: "company.status", inputTemplate: scope },
    { operationId: "database.compatibility", inputTemplate: {} },
  ];
}

async function personalTaxCounts(session: BusinessSession, tenantId: string, taxCaseId?: string): Promise<{ caseCount: number; sourceCount: number; readySourceCount: number; factCount: number; reconciliationCount: number; snapshotCount: number; worksheetCount: number; eligibilityCount: number; computationCount: number; returnArtifactCount: number; exportedReturnCount: number; selectedCase?: string }> {
  const caseFilter = taxCaseId ? " AND id = ?" : "";
  const caseArgs = taxCaseId ? [tenantId, taxCaseId] : [tenantId];
  const cases = await session.query(`SELECT id FROM tax_cases WHERE tenant_id = ?${caseFilter}`, caseArgs);
  const ids = cases.rows.map((row) => String(row.id));
  if (ids.length === 0) return { caseCount: 0, sourceCount: 0, readySourceCount: 0, factCount: 0, reconciliationCount: 0, snapshotCount: 0, worksheetCount: 0, eligibilityCount: 0, computationCount: 0, returnArtifactCount: 0, exportedReturnCount: 0 };
  const placeholders = ids.map(() => "?").join(",");
  const args = [tenantId, ...ids];
  const [sources, facts, reconciliations, snapshots, worksheets, eligibility, computations, artifacts, exports] = await Promise.all([
    session.query(`SELECT status FROM tax_case_external_sources WHERE tenant_id = ? AND tax_case_id IN (${placeholders})`, args),
    session.query(`SELECT id FROM tax_case_facts WHERE tenant_id = ? AND tax_case_id IN (${placeholders})`, args),
    session.query(`SELECT id FROM tax_case_fact_reconciliations WHERE tenant_id = ? AND tax_case_id IN (${placeholders})`, args),
    session.query(`SELECT id FROM filing_snapshots WHERE tenant_id = ? AND tax_case_id IN (${placeholders})`, args),
    session.query(`SELECT id FROM personal_tax_position_worksheets WHERE tenant_id = ? AND tax_case_id IN (${placeholders})`, args),
    session.query(`SELECT id FROM tax_case_itr_eligibility_evaluations WHERE tenant_id = ? AND tax_case_id IN (${placeholders})`, args),
    session.query(`SELECT id FROM personal_tax_computations WHERE tenant_id = ? AND tax_case_id IN (${placeholders})`, args),
    session.query(`SELECT id FROM personal_tax_return_artifacts WHERE tenant_id = ? AND tax_case_id IN (${placeholders})`, args),
    session.query(`SELECT id FROM personal_tax_return_export_activities WHERE tenant_id = ? AND tax_case_id IN (${placeholders})`, args),
  ]);
  return {
    caseCount: cases.rows.length,
    sourceCount: sources.rows.length,
    readySourceCount: sources.rows.filter((row) => String(row.status) === "READY").length,
    factCount: facts.rows.length,
    reconciliationCount: reconciliations.rows.length,
    snapshotCount: snapshots.rows.length,
    worksheetCount: worksheets.rows.length,
    eligibilityCount: eligibility.rows.length,
    computationCount: computations.rows.length,
    returnArtifactCount: artifacts.rows.length,
    exportedReturnCount: exports.rows.length,
    ...(taxCaseId ? { selectedCase: taxCaseId } : {}),
  };
}

async function artifactCounts(session: BusinessSession, tenantId: string, bookSetId: string): Promise<{ gstArtifacts: number; gstExported: number; tdsArtifacts: number; tdsExported: number }> {
  const [gst, gstExports, tds, tdsExports] = await Promise.all([
    session.query("SELECT id FROM gst_gstr1_artifacts WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]),
    session.query("SELECT id FROM gst_gstr1_export_activities WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]),
    session.query("SELECT id FROM withholding_statement_artifacts WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]),
    session.query("SELECT id FROM withholding_statement_export_activities WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]),
  ]);
  return { gstArtifacts: gst.rows.length, gstExported: gstExports.rows.length, tdsArtifacts: tds.rows.length, tdsExported: tdsExports.rows.length };
}

async function periodCounts(session: BusinessSession, tenantId: string, bookSetId: string): Promise<{ closeEvents: number; reopened: number; packs: number; stalePacks: number }> {
  const [events, packs] = await Promise.all([
    session.query("SELECT event_type FROM period_close_events WHERE tenant_id = ? AND book_set_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 100", [tenantId, bookSetId]),
    session.query("SELECT period_close_label, period_close_state_hash, period_end FROM close_pack_manifests WHERE tenant_id = ? AND book_set_id = ? ORDER BY created_at DESC, id DESC LIMIT 100", [tenantId, bookSetId]),
  ]);
  return {
    closeEvents: events.rows.length,
    reopened: events.rows.filter((row) => String(row.event_type) === "REOPENED").length,
    packs: packs.rows.length,
    stalePacks: packs.rows.filter((row) => String(row.period_close_label) === "REOPENED").length,
  };
}

async function buildCards(
  session: BusinessSession,
  summaries: readonly CompanyStatusBookSetSummary[],
  tenants: readonly Record<string, unknown>[],
  compatibility: CompanyStatusCompatibility,
  asOfDate: string,
  asOfTimestamp: string,
  tenantId: string | undefined,
  bookSetId: string | undefined,
  taxCaseId: string | undefined,
  panByTenant: ReadonlyMap<string, boolean>,
): Promise<CompanyStatusCard[]> {
  const allIssues = summaries.flatMap(issuesFor);
  const issueCodes = (codes: string[]) => allIssues.filter((issue) => codes.includes(issue.code));
  const firstScope = tenantId ?? (tenants.length === 1 ? String(tenants[0]!.id) : undefined);
  const common = scopeDrillDowns(firstScope, bookSetId, asOfDate, asOfTimestamp);
  const cards: CompanyStatusCard[] = [];
  const compatibilityBlocked = !["READY", "AVAILABLE"].includes(compatibility.status);
  const backupState: CompanyStatusCardState = compatibilityBlocked ? "BLOCKED" : "UNKNOWN";
  cards.push(card("database", backupState, compatibilityBlocked ? "Database upgrade or recovery is required; backup safety cannot be established." : "SQLite schema and data format are compatible, but the latest verified backup is not queryable from the business read fence.", { latestVerifiedBackup: 0 }, ["BACKUP_STATUS_UNAVAILABLE"], compatibilityBlocked ? ["DATABASE_NOT_READY"] : [], asOfDate, asOfTimestamp, [...common, { operationId: "database.compatibility", inputTemplate: {} }, { operationId: "database.backup.list", inputTemplate: {} }, { operationId: "database.upgrade.preview", inputTemplate: {} }]));

  const lifecycleOk = tenants.length > 0 && tenants.every((item) => String(item.lifecycle) === "ACTIVE");
  cards.push(card("tenant-bookset", lifecycleOk ? "HEALTHY" : "BLOCKED", `${tenants.length} active tenant${tenants.length === 1 ? "" : "s"} in scope; ${summaries.length} active BookSet${summaries.length === 1 ? "" : "s"}.`, { tenants: tenants.length, bookSets: summaries.length }, [], lifecycleOk ? [] : ["TENANT_OR_BOOKSET_INACTIVE"], asOfDate, asOfTimestamp, [...common, { operationId: "tenant.list-active", inputTemplate: {} }, { operationId: "book-set.list", inputTemplate: firstScope ? { tenantId: firstScope } : {} }]));

  const ledgerIssues = issueCodes(["LEDGER_UNBALANCED"]);
  cards.push(card("journal-reports", cardState(true, ledgerIssues.length > 0, false, false), ledgerIssues.length ? "Posted journal lines are not balanced." : "Posted journal lines are balanced; core reports are available.", { unbalanced: ledgerIssues.length }, [], ledgerIssues.length ? ["LEDGER_UNBALANCED"] : [], asOfDate, asOfTimestamp, summaries[0] && firstScope ? drillDownsForSummary(summaries[0], asOfDate) : common));

  const arCount = countSummary(summaries, (s) => s.receivables.count);
  const arOverdue = countSummary(summaries, (s) => s.receivables.overdue.count);
  cards.push(card("ar", cardState(true, false, false, arOverdue > 0 || arCount > 0), `${arCount} outstanding customer invoice${arCount === 1 ? "" : "s"}; ${arOverdue} overdue.`, { outstanding: arCount, overdue: arOverdue }, arCount ? ["AR_OUTSTANDING"] : [], [], asOfDate, asOfTimestamp, [...common, { operationId: "invoice.outstanding", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}) } }]));
  const apCount = countSummary(summaries, (s) => s.payables.count);
  const apOverdue = countSummary(summaries, (s) => s.payables.overdue.count);
  cards.push(card("ap", cardState(true, false, false, apOverdue > 0 || apCount > 0), `${apCount} outstanding vendor bill${apCount === 1 ? "" : "s"}; ${apOverdue} overdue.`, { outstanding: apCount, overdue: apOverdue }, apCount ? ["AP_OUTSTANDING"] : [], [], asOfDate, asOfTimestamp, [...common, { operationId: "bill.outstanding", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}) } }]));

  const bankStatements = countSummary(summaries, (s) => s.bankReconciliation.latestByBankAccount.length);
  const bankUnmatched = countSummary(summaries, (s) => s.bankReconciliation.latestByBankAccount.reduce((n, b) => n + b.unmatchedCount, 0));
  const bankBlocked = issueCodes(["BANK_RECONCILIATION_REVIEW"]).some((issue) => issue.amountMinor !== 0);
  cards.push(card("bank", cardState(bankStatements > 0, bankBlocked, false, bankUnmatched > 0), bankStatements === 0 ? "No bank statement has been imported." : `${bankUnmatched} confirmed bank line${bankUnmatched === 1 ? "" : "s"} remain unmatched.`, { statements: bankStatements, unmatched: bankUnmatched }, bankUnmatched ? ["BANK_RECONCILIATION_REVIEW"] : [], bankBlocked ? ["BANK_RECONCILIATION_DIFFERENCE"] : [], asOfDate, asOfTimestamp, [...common, { operationId: "bank-statement.list", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}) } }, { operationId: "bank-reconciliation.status", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}), statementId: "<statement-id>" } }]));

  const artifactData = await Promise.all(summaries.slice(0, CARD_LIMIT).map((summary) => artifactCounts(session, summary.bookSet.tenantId, summary.bookSet.bookSetId)));
  const gstArtifacts = artifactData.reduce((n, item) => n + item.gstArtifacts, 0);
  const gstExports = artifactData.reduce((n, item) => n + item.gstExported, 0);
  const gstRegistrations = countSummary(summaries, (s) => s.gst.registrationsApplicableAsOf.count);
  const gstPending = countSummary(summaries, (s) => s.gst.pendingReviewItc.count);
  cards.push(card("gst", cardState(gstRegistrations > 0, false, gstRegistrations > 0 && gstArtifacts === 0 && countSummary(summaries, (s) => s.gst.postedSalesActivity.count + s.gst.postedPurchaseActivity.count) > 0, gstPending > 0 || gstExports > 0), gstRegistrations === 0 ? "GST registration is not configured for this scope." : `${gstRegistrations} registration${gstRegistrations === 1 ? "" : "s"}; ${gstPending} ITC item${gstPending === 1 ? "" : "s"} need review${gstExports ? `; ${gstExports} export artifact${gstExports === 1 ? "" : "s"} await portal follow-up.` : "."}`, { registrations: gstRegistrations, artifacts: gstArtifacts, exportedNotSubmitted: gstExports, pendingReviewItc: gstPending }, [...(gstPending ? ["GST_ITC_REVIEW_REQUIRED"] : []), ...(gstExports ? ["GST_EXPORTED_NOT_SUBMITTED"] : [])], [], asOfDate, asOfTimestamp, [...common, { operationId: "gst.return.readiness-report", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}) } }, { operationId: "gst.gstr1-artifact.status", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}), artifactId: "<artifact-id>" } }]));

  const tdsProfiles = countSummary(summaries, (s) => s.tdsTcs.unverifiedProfileCount);
  const tdsLiabilities = countSummary(summaries, (s) => s.tdsTcs.undepositedLiabilityCount);
  const tdsCases = countSummary(summaries, (s) => s.tdsTcs.unsubmittedCaseCount + s.tdsTcs.rejectedCaseCount);
  const tdsArtifacts = artifactData.reduce((n, item) => n + item.tdsArtifacts, 0);
  const tdsExports = artifactData.reduce((n, item) => n + item.tdsExported, 0);
  const tdsConfigured = tdsProfiles + tdsLiabilities + tdsCases + tdsArtifacts > 0;
  cards.push(card("tds-tcs", cardState(tdsConfigured, tdsProfiles > 0 || tdsLiabilities > 0, false, tdsCases > 0 || tdsExports > 0), tdsConfigured ? `${tdsLiabilities} withholding liabilities remain undeposited; ${tdsCases} statement case${tdsCases === 1 ? "" : "s"} need follow-up${tdsExports ? `; ${tdsExports} export artifact${tdsExports === 1 ? "" : "s"} await submission.` : "."}` : "TDS/TCS context is not configured.", { unverifiedProfiles: tdsProfiles, undepositedLiabilities: tdsLiabilities, statementCases: tdsCases, exportedNotSubmitted: tdsExports }, [...(tdsCases ? ["TDS_TCS_STATEMENT_FOLLOW_UP"] : []), ...(tdsExports ? ["TDS_TCS_EXPORTED_NOT_SUBMITTED"] : [])], tdsProfiles || tdsLiabilities ? ["TDS_TCS_SOURCE_OR_DEPOSIT_BLOCKED"] : [], asOfDate, asOfTimestamp, [...common, { operationId: "tax.register.tds", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}) } }, { operationId: "withholding.statement.status", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}), artifactId: "<artifact-id>" } }]));

  const assetCount = countSummary(summaries, (s) => s.assets.assetCount);
  const assetFollowUpCount = countSummary(summaries, (s) => s.assets.manualEvidenceCount + s.assets.previewNeededCount + s.assets.taxRuleMissingCount + s.assets.taxUnrunCount + s.assets.disposedOpenAnomalyCount);
  const assetBlocked = countSummary(summaries, (s) => s.assets.disposedOpenAnomalyCount);
  cards.push(card("fixed-assets", cardState(assetCount > 0, assetBlocked > 0, false, assetFollowUpCount > 0), assetCount === 0 ? "No fixed assets are configured." : `${assetFollowUpCount} fixed-asset follow-up item${assetFollowUpCount === 1 ? "" : "s"}.`, { assets: assetCount, followUp: assetFollowUpCount, disposalAnomalies: assetBlocked }, assetFollowUpCount ? ["FIXED_ASSET_DEPRECIATION_OR_TAX_REVIEW"] : [], assetBlocked ? ["FIXED_ASSET_DISPOSAL_ANOMALY"] : [], asOfDate, asOfTimestamp, [...common, { operationId: "asset.register.report", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}), asOfDate } }, { operationId: "asset.depreciation.report", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}), periodStart: "<YYYY-MM-DD>", periodEnd: asOfDate } }]));

  const fxCount = countSummary(summaries, (s) => s.fx.foreignOpenItemCount + s.fx.missingOrUnverifiedRateCount + s.fx.unreversedRevaluationCount + s.fx.settlementMismatchCount);
  const fxBlocked = countSummary(summaries, (s) => s.fx.settlementMismatchCount);
  cards.push(card("fx", cardState(fxCount > 0, fxBlocked > 0, false, fxCount > fxBlocked), fxCount === 0 ? "No foreign-currency exposure is configured." : `${fxCount} FX exposure/revaluation follow-up item${fxCount === 1 ? "" : "s"}.`, { followUp: fxCount, settlementMismatches: fxBlocked }, fxCount > fxBlocked ? ["FX_REVIEW_REQUIRED"] : [], fxBlocked ? ["FX_SETTLEMENT_MISMATCH"] : [], asOfDate, asOfTimestamp, [...common, { operationId: "fx.exposure.report", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}) } }]));

  const payrollEmployees = countSummary(summaries, (s) => s.payroll.employeeCount);
  const payrollIssues = countSummary(summaries, (s) => s.payroll.preparedRunCount + s.payroll.pendingClaimCount + s.payroll.reviewRuleCount);
  cards.push(card("payroll", cardState(payrollEmployees > 0, false, false, payrollIssues > 0), payrollEmployees === 0 ? "Payroll is not configured." : `${payrollEmployees} employee${payrollEmployees === 1 ? "" : "s"}; ${payrollIssues} pay-run/statutory review item${payrollIssues === 1 ? "" : "s"}.`, { employees: payrollEmployees, followUp: payrollIssues }, payrollIssues ? ["PAYROLL_REVIEW_REQUIRED"] : [], [], asOfDate, asOfTimestamp, [...common, { operationId: "payroll.register", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}) } }, { operationId: "payroll.payslip.list", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}) } }]));

  const expenseClaims = countSummary(summaries, (s) => s.expenses.submittedClaimCount + s.expenses.evidenceExceptionCount + s.expenses.openAdvanceCount);
  cards.push(card("expenses", cardState(expenseClaims > 0, false, false, expenseClaims > 0), expenseClaims === 0 ? "Expense claims are not configured." : `${expenseClaims} expense evidence/review item${expenseClaims === 1 ? "" : "s"}.`, { followUp: expenseClaims, evidenceExceptions: countSummary(summaries, (s) => s.expenses.evidenceExceptionCount) }, expenseClaims ? ["EXPENSE_EVIDENCE_OR_REVIEW_REQUIRED"] : [], [], asOfDate, asOfTimestamp, [...common, { operationId: "expense.claim.list", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}) } }, { operationId: "expense.evidence-exceptions", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}) } }]));

  const complianceUnknown = countSummary(summaries, (s) => s.compliance.unknownApplicabilityCount + s.compliance.missingFactsCount);
  const complianceOverdue = countSummary(summaries, (s) => s.compliance.overdueCount);
  const complianceOpen = countSummary(summaries, (s) => s.compliance.openCount);
  const complianceConfigured = countSummary(summaries, (s) => s.compliance.obligationCount);
  cards.push(card("compliance", cardState(complianceConfigured > 0 || complianceUnknown > 0, complianceOverdue > 0, complianceUnknown > 0, complianceOpen > 0), complianceConfigured === 0 && complianceUnknown === 0 ? "No compliance obligations are configured." : `${complianceOpen} open obligation${complianceOpen === 1 ? "" : "s"}; ${complianceOverdue} overdue; ${complianceUnknown} applicability/fact item${complianceUnknown === 1 ? "" : "s"} unknown.`, { configured: complianceConfigured, open: complianceOpen, overdue: complianceOverdue, unknown: complianceUnknown }, complianceOpen ? ["COMPLIANCE_OBLIGATION_REVIEW"] : [], complianceOverdue ? ["COMPLIANCE_OBLIGATION_OVERDUE"] : [], asOfDate, asOfTimestamp, [...common, { operationId: "compliance.obligation.calendar", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}), fromDate: "<YYYY-MM-DD>", toDate: asOfDate, asOfDate } }, { operationId: "compliance.status", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}), asOfDate } }]));

  const periodData = await Promise.all(summaries.slice(0, CARD_LIMIT).map((summary) => periodCounts(session, summary.bookSet.tenantId, summary.bookSet.bookSetId)));
  const closeEvents = periodData.reduce((n, item) => n + item.closeEvents, 0);
  const reopened = periodData.reduce((n, item) => n + item.reopened + item.stalePacks, 0);
  cards.push(card("period-close", cardState(closeEvents + periodData.reduce((n, item) => n + item.packs, 0) > 0, false, false, reopened > 0), reopened > 0 ? "Period close or CA pack evidence is stale/reopened." : closeEvents > 0 ? "Period close evidence is present." : "Period close is not configured.", { closeEvents, staleOrReopened: reopened }, reopened ? ["PERIOD_CLOSE_OR_PACK_STALE"] : [], [], asOfDate, asOfTimestamp, [...common, { operationId: "period.status", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}) } }, { operationId: "report.close-pack.get", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), ...(bookSetId ? { bookSetId } : {}), manifestId: "<manifest-id>" } }]));

  const panMissing = tenants.filter((tenant) => !panByTenant.get(String(tenant.id))).length;
  cards.push(card("tenant-pan", cardState(tenants.length > 0, false, false, panMissing > 0), panMissing ? `${panMissing} tenant${panMissing === 1 ? "" : "s"} has no PAN profile.` : "Tenant PAN profiles are configured and masked.", { missing: panMissing }, panMissing ? ["TENANT_PAN_MISSING"] : [], [], asOfDate, asOfTimestamp, [...common, { operationId: "tenant.pan.get", inputTemplate: firstScope ? { tenantId: firstScope } : {} }]));

  const individualTenants = tenants.filter((tenant) => String(tenant.kind) === "INDIVIDUAL");
  const taxData = await Promise.all(individualTenants.slice(0, CARD_LIMIT).map((tenant) => personalTaxCounts(session, String(tenant.id), taxCaseId)));
  const taxCases = taxData.reduce((n, item) => n + item.caseCount, 0);
  const taxSources = taxData.reduce((n, item) => n + item.sourceCount, 0);
  const taxReadySources = taxData.reduce((n, item) => n + item.readySourceCount, 0);
  const taxFacts = taxData.reduce((n, item) => n + item.factCount, 0);
  const taxReconciliations = taxData.reduce((n, item) => n + item.reconciliationCount, 0);
  const taxSnapshots = taxData.reduce((n, item) => n + item.snapshotCount, 0);
  const taxWorksheets = taxData.reduce((n, item) => n + item.worksheetCount, 0);
  const taxEligibility = taxData.reduce((n, item) => n + item.eligibilityCount, 0);
  const taxComputations = taxData.reduce((n, item) => n + item.computationCount, 0);
  const taxArtifacts = taxData.reduce((n, item) => n + item.returnArtifactCount, 0);
  const taxExports = taxData.reduce((n, item) => n + item.exportedReturnCount, 0);
  const taxUnknown = taxCases > 0 && (taxSources === 0 || taxReadySources < taxSources);
  cards.push(card("personal-tax", cardState(individualTenants.length > 0 && taxCases > 0, false, taxUnknown, taxExports > 0 || (taxCases > 0 && taxSources === 0), individualTenants.length === 0), individualTenants.length === 0 ? "Personal TaxCase is not applicable to company tenants." : taxCases === 0 ? "No Personal TaxCase is configured." : `${taxCases} TaxCase${taxCases === 1 ? "" : "s"}; ${taxSources} source${taxSources === 1 ? "" : "s"}, ${taxReadySources} ready${taxExports ? `; ${taxExports} exported return artifact${taxExports === 1 ? "" : "s"} await portal follow-up.` : "."}`, { taxCases, sources: taxSources, readySources: taxReadySources, facts: taxFacts, reconciliations: taxReconciliations, snapshots: taxSnapshots, worksheets: taxWorksheets, eligibilityEvaluations: taxEligibility, computations: taxComputations, returnArtifacts: taxArtifacts, exportedNotSubmitted: taxExports }, [...(taxUnknown ? ["PERSONAL_TAX_SOURCE_READINESS_UNKNOWN"] : []), ...(taxExports ? ["PERSONAL_TAX_EXPORTED_NOT_SUBMITTED"] : [])], [], asOfDate, asOfTimestamp, [...common, { operationId: "tax-case.status", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), taxCaseId: taxCaseId ?? "<tax-case-id>" } }, { operationId: "tax-case.source.list", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), taxCaseId: taxCaseId ?? "<tax-case-id>" } }, { operationId: "tax-case.return-artifact.status", inputTemplate: { ...(firstScope ? { tenantId: firstScope } : {}), taxCaseId: taxCaseId ?? "<tax-case-id>", artifactId: "<artifact-id>" } }]));

  cards.push(card("skills", "HEALTHY", "The shared operation and skill registry is loaded; references resolve through the live catalog.", {}, [], [], asOfDate, asOfTimestamp, [{ operationId: "agent.skill.check", inputTemplate: {} }, { operationId: "agent.operation.list", inputTemplate: {} }]));
  cards.push(card("remote-mcp", compatibilityBlocked ? "BLOCKED" : "HEALTHY", compatibilityBlocked ? "Database readiness blocks safe MCP business operations." : "Remote MCP readiness is queryable; MCP does not upgrade or mutate the database.", {}, [], compatibilityBlocked ? ["DATABASE_NOT_READY"] : [], asOfDate, asOfTimestamp, [{ operationId: "database.compatibility", inputTemplate: {} }, { operationId: "agent.operation.list", inputTemplate: {} }]));
  return cards.slice(0, CARD_LIMIT);
}

function drillDownsForSummary(summary: CompanyStatusBookSetSummary, asOfDate: string): CompanyStatusDrillDown[] {
  return drillDown(summary.bookSet.tenantId, summary.bookSet.bookSetId, asOfDate, summary.compliance);
}

function overallCardStatus(cards: readonly CompanyStatusCard[]): CompanyStatusCardState {
  const rank: Record<CompanyStatusCardState, number> = { BLOCKED: 0, UNKNOWN: 1, ACTION_REQUIRED: 2, NOT_CONFIGURED: 3, NOT_APPLICABLE: 4, HEALTHY: 5 };
  return cards.reduce<CompanyStatusCardState>((worst, item) => rank[item.status] < rank[worst] ? item.status : worst, "HEALTHY");
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
    const asOfTimestamp = input.asOfTimestamp ?? `${asOfDate}T23:59:59.999Z`;
    if (Number.isNaN(Date.parse(asOfTimestamp))) throw new DomainError("INVALID_STATUS_AS_OF", "asOfTimestamp must be an ISO timestamp");
    const normalizedFocus = input.focus ? (FOCUS_ALIASES[input.focus] ?? input.focus) : undefined;
    if (normalizedFocus && !CARD_FOCUSES.has(normalizedFocus)) throw new DomainError("INVALID_STATUS_FOCUS", "focus must be a registered status card focus", { focus: input.focus, allowed: [...CARD_FOCUSES, ...Object.keys(FOCUS_ALIASES)].sort() });
    if (input.bookSetId && !input.tenantId) throw new DomainError("TENANT_SCOPE_REQUIRED", "tenantId is required when bookSetId is supplied");
    const compatibility = await this.compatibilityProvider();
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const selected = await selectTenants(session, input.tenantId);
      if (input.taxCaseId && selected.rows.length !== 1) throw new DomainError("TAX_CASE_SCOPE_REQUIRED", "taxCaseId requires one explicit tenant scope");
      const panRows = await session.query("SELECT tenant_id, masked_display FROM tenant_pan_profiles WHERE tenant_id IN (${TENANTS})".replace("${TENANTS}", selected.rows.map(() => "?").join(",")), selected.rows.map((tenant) => String(tenant.id)));
      const panByTenant = new Map(panRows.rows.map((row) => [String(row.tenant_id), true]));
      const maskedPanByTenant = new Map(panRows.rows.map((row) => [String(row.tenant_id), String(row.masked_display)]));
      const summaries: CompanyStatusBookSetSummary[] = [];
      for (const tenant of selected.rows) {
        const tenantId = String(tenant.id);
        const bookSets = await selectBookSets(session, tenantId, input.bookSetId);
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
      }
      const global = !input.tenantId && selected.rows.length > 1;
      const rawIssues = summaries.flatMap(issuesFor).sort((left, right) => issueRank(left) - issueRank(right) || (left.code.localeCompare(right.code)) || String(left.bookSetId ?? "").localeCompare(String(right.bookSetId ?? "")));
      const issues = global ? rawIssues.map((issue) => issue.bookSetId ? { ...issue, bookSetId: maskIdentifier(issue.bookSetId) } : issue) : rawIssues;
      const hasBlocked = issues.some((issue) => issue.severity === "BLOCKED");
      const tenants = selected.rows.map((tenant) => ({ tenantId: global ? maskIdentifier(String(tenant.id)) : String(tenant.id), name: String(tenant.name), kind: String(tenant.kind), lifecycle: String(tenant.lifecycle), bookSetCount: summaries.filter((summary) => summary.bookSet.tenantId === String(tenant.id)).length }));
      const selectedTenant = selected.rows.length === 1 && !global ? selected.rows[0] : selected.rows.length === 1 ? selected.rows[0] : undefined;
      const cards = await buildCards(session, summaries, selected.rows, compatibility, asOfDate, asOfTimestamp, input.tenantId ? String(input.tenantId) : undefined, input.bookSetId ? String(input.bookSetId) : undefined, input.taxCaseId, panByTenant);
      const focusedCards = normalizedFocus ? cards.filter((item) => item.id === normalizedFocus) : cards;
      const outputSummaries = global ? summaries.map((summary) => ({ ...summary, bookSet: { ...summary.bookSet, tenantId: maskIdentifier(summary.bookSet.tenantId), bookSetId: maskIdentifier(summary.bookSet.bookSetId) } })) : summaries;
      const outputDrillDown = global ? [] : summaries.flatMap((summary) => drillDown(summary.bookSet.tenantId, summary.bookSet.bookSetId, asOfDate, summary.compliance));
      return {
        statusVersion: 2,
        databaseCompatibility: {
          status: compatibility.status,
          currentSchemaVersion: compatibility.currentSchemaVersion ?? compatibility.requiredSchemaVersion,
          requiredSchemaVersion: compatibility.requiredSchemaVersion,
          currentDataFormatVersion: compatibility.currentDataFormatVersion ?? compatibility.requiredDataFormatVersion,
          requiredDataFormatVersion: compatibility.requiredDataFormatVersion,
        },
        selectedTenant: selectedTenant ? { tenantId: String(selectedTenant.id), name: String(selectedTenant.name), kind: String(selectedTenant.kind), lifecycle: String(selectedTenant.lifecycle), hasPan: !!panByTenant.get(String(selectedTenant.id)), ...(maskedPanByTenant.get(String(selectedTenant.id)) ? { maskedPan: maskedPanByTenant.get(String(selectedTenant.id)) } : {}) } : { tenantId: "MULTIPLE", name: "Multiple active tenants", kind: "MIXED", lifecycle: "ACTIVE", hasPan: false },
        tenants,
        scope: { ...(input.tenantId ? { tenantId: String(input.tenantId) } : {}), ...(input.bookSetId ? { bookSetId: String(input.bookSetId) } : {}), ...(input.taxCaseId ? { taxCaseId: input.taxCaseId } : {}), global },
        asOfDate,
        asOfTimestamp,
        cards: focusedCards,
        overallStatus: overallCardStatus(cards),
        truncation: { tenants: selected.truncated, bookSets: false, cards: cards.length > CARD_LIMIT, details: summaries.length > CARD_LIMIT },
        summaries: outputSummaries,
        issues,
        overallReadiness: hasBlocked ? "BLOCKED" : issues.length > 0 ? "REVIEW_REQUIRED" : "READY",
        drillDown: outputDrillDown,
      };
    });
  }
}
