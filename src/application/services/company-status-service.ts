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
  const rows = await session.query(
    `SELECT total_minor, paid_minor, due_date
     FROM ${table}
     WHERE tenant_id = ? AND book_set_id = ? AND status = 'POSTED' AND ${dateColumn} <= ? AND paid_minor < total_minor
        OR tenant_id = ? AND book_set_id = ? AND status = 'PARTIALLY_PAID' AND ${dateColumn} <= ? AND paid_minor < total_minor
      ORDER BY ${dateColumn}, id`,
    [tenantId, bookSetId, asOfDate, tenantId, bookSetId, asOfDate],
  );
  let totalMinor = 0;
  let overdueCount = 0;
  let overdueMinor = 0;
  for (const row of rows.rows) {
    const outstanding = numeric(row.total_minor, "open balance total") - numeric(row.paid_minor, "open balance paid");
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

function issuesFor(summary: CompanyStatusBookSetSummary): CompanyStatusIssue[] {
  const issues: CompanyStatusIssue[] = [];
  if (!summary.ledger.isBalanced) issues.push({ severity: "BLOCKED", code: "LEDGER_UNBALANCED", bookSetId: summary.bookSet.bookSetId, amountMinor: Math.abs(summary.ledger.totalDebitMinor - summary.ledger.totalCreditMinor) });
  if (summary.receivables.overdue.count > 0) issues.push({ severity: "HIGH", code: "RECEIVABLES_OVERDUE", bookSetId: summary.bookSet.bookSetId, count: summary.receivables.overdue.count, amountMinor: summary.receivables.overdue.amountMinor });
  if (summary.payables.overdue.count > 0) issues.push({ severity: "HIGH", code: "PAYABLES_OVERDUE", bookSetId: summary.bookSet.bookSetId, count: summary.payables.overdue.count, amountMinor: summary.payables.overdue.amountMinor });
  for (const bank of summary.bankReconciliation.latestByBankAccount) {
    if (!bank.isReconciled) issues.push({ severity: "HIGH", code: "BANK_RECONCILIATION_REVIEW", bookSetId: summary.bookSet.bookSetId, count: bank.unmatchedCount, amountMinor: bank.differenceMinor });
  }
  if (summary.gst.pendingReviewItc.count > 0) issues.push({ severity: "MEDIUM", code: "GST_ITC_PENDING_REVIEW", bookSetId: summary.bookSet.bookSetId, count: summary.gst.pendingReviewItc.count, amountMinor: summary.gst.pendingReviewItc.amountMinor });
  issues.push({ severity: "INFO", code: "CASH_BANK_UNAVAILABLE", bookSetId: summary.bookSet.bookSetId });
  return issues;
}

function issueRank(issue: CompanyStatusIssue): number {
  return { BLOCKED: 0, HIGH: 1, MEDIUM: 2, INFO: 3 }[issue.severity];
}

function drillDown(tenantId: string, bookSetId: string, asOfDate: string): CompanyStatusDrillDown[] {
  return [
    { operationId: "ledger.trial-balance", inputTemplate: { tenantId, bookSetId, asOfDate } },
    { operationId: "ledger.balance-sheet", inputTemplate: { tenantId, bookSetId, asOfDate } },
    { operationId: "ledger.profit-and-loss", inputTemplate: { tenantId, bookSetId, fromDate: "<YYYY-MM-DD>", toDate: asOfDate } },
    { operationId: "invoice.outstanding", inputTemplate: { tenantId, bookSetId } },
    { operationId: "bill.outstanding", inputTemplate: { tenantId, bookSetId } },
    { operationId: "bank-statement.list", inputTemplate: { tenantId, bookSetId } },
    { operationId: "gst.registration.list", inputTemplate: { tenantId, date: asOfDate } },
  ];
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
        drillDown: summaries.flatMap((summary) => drillDown(tenantId, summary.bookSet.bookSetId, asOfDate)),
      };
    });
  }
}
