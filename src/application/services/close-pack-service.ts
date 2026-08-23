import { createHash, randomUUID } from "node:crypto";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import { ledgerSnapshotInSession, type TrialBalanceReport, type ProfitAndLossReport, type BalanceSheetReport } from "./ledger-report-service.ts";

export interface ClosePackManifest {
  id: string;
  manifestFormat: string;
  schemaVersion: number;
  scope: { tenantId: string; bookSetId: string };
  dates: { periodStart: string; periodEnd: string; asOfDate: string };
  basis: string;
  status: { periodCloseStateHash: string; periodCloseLabel: "OPEN" | "CLOSED" | "REOPENED" };
  metadata: { manifestHash: string; governmentCompatible: boolean; submitted: boolean };
  sections: Array<{ name: string; rowCount: number; hash: string }>;
}

export interface ClosePackExportPayload {
  tenantId: TenantId;
  bookSetId: BookSetId;
  periodStart: string;
  periodEnd: string;
  asOfDate: string;
  basis: "ACCRUAL";
}

export interface ClosePackExportResult {
  manifestId: string;
  manifestFormat: string;
  manifestHash: string;
  periodCloseLabel: "OPEN" | "CLOSED" | "REOPENED";
  sectionNames: string[];
}

type ClosePackEnvelope<P> = CommandEnvelope<P> & { bookSetId: BookSetId };

function isoDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^(\d{4})-(\d{2})-(\d{2})$/.test(value)) {
    throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date`);
  }
  const [, yearText, monthText, dayText] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)!;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date`);
  }
}

function nonblank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_REQUEST", `${field} must be nonblank`);
  return value.trim();
}

function escapeCSV(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\r") || str.includes("\n")) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function rowToCSV(values: unknown[]): string {
  return values.map(escapeCSV).join(",");
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

type PeriodStatus = "OPEN" | "CLOSED" | "REOPENED";

async function getPeriodStatus(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<PeriodStatus> {
  const events = await session.query("SELECT event_type FROM period_close_events WHERE tenant_id = ? AND book_set_id = ? AND period_start = ? AND period_end = ? ORDER BY occurred_at DESC, id DESC LIMIT 1", [tenantId, bookSetId, periodStart, periodEnd]);
  if (events.rows.length === 0) return "OPEN";
  const eventType = String(events.rows[0].event_type);
  return eventType === "CLOSED" ? "CLOSED" : eventType === "REOPENED" ? "REOPENED" : "OPEN";
}

async function getPeriodCloseStateHash(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<string> {
  const event = await session.querySingle("SELECT plan_hash FROM period_close_events WHERE tenant_id = ? AND book_set_id = ? AND period_start = ? AND period_end = ? ORDER BY occurred_at DESC, id DESC LIMIT 1", [tenantId, bookSetId, periodStart, periodEnd]);
  if (!event) return createHash("sha256").update("OPEN").digest("hex");
  return String(event.plan_hash);
}

function generateTrialBalanceCSV(report: TrialBalanceReport): string {
  const lines: string[] = [];
  lines.push(rowToCSV(["Account ID", "Code", "Name", "Type", "Debit (Minor Units)", "Credit (Minor Units)", "Balance (Minor Units)"]));
  for (const row of report.rows) {
    lines.push(rowToCSV([row.accountId, row.code, row.name, row.accountType, row.debitMinor, row.creditMinor, row.balanceMinor]));
  }
  lines.push("");
  lines.push(rowToCSV(["TOTALS", "", "", "", report.totalDebitMinor, report.totalCreditMinor, ""]));
  lines.push(rowToCSV(["Is Balanced", "", "", "", report.isBalanced ? "Yes" : "No", "", ""]));
  return lines.join("\r\n");
}

function generateProfitAndLossCSV(report: ProfitAndLossReport): string {
  const lines: string[] = [];
  lines.push(rowToCSV(["Section", "Account ID", "Code", "Name", "Balance (Minor Units)"]));
  lines.push(rowToCSV(["INCOME", "", "", "", ""]));
  for (const row of report.incomeRows) {
    lines.push(rowToCSV(["", row.accountId, row.code, row.name, row.balanceMinor]));
  }
  lines.push(rowToCSV(["INCOME TOTAL", "", "", "", report.incomeMinor]));
  lines.push(rowToCSV(["EXPENSE", "", "", "", ""]));
  for (const row of report.expenseRows) {
    lines.push(rowToCSV(["", row.accountId, row.code, row.name, row.balanceMinor]));
  }
  lines.push(rowToCSV(["EXPENSE TOTAL", "", "", "", report.expenseMinor]));
  lines.push("");
  lines.push(rowToCSV(["NET PROFIT/LOSS", "", "", "", report.netProfitLossMinor]));
  return lines.join("\r\n");
}

function generateBalanceSheetCSV(report: BalanceSheetReport): string {
  const lines: string[] = [];
  lines.push(rowToCSV(["Section", "Account ID", "Code", "Name", "Balance (Minor Units)"]));
  lines.push(rowToCSV(["ASSETS", "", "", "", ""]));
  for (const row of report.assets) {
    lines.push(rowToCSV(["", row.accountId, row.code, row.name, row.balanceMinor]));
  }
  lines.push(rowToCSV(["TOTAL ASSETS", "", "", "", report.totalAssetsMinor]));
  lines.push("");
  lines.push(rowToCSV(["LIABILITIES", "", "", "", ""]));
  for (const row of report.liabilities) {
    lines.push(rowToCSV(["", row.accountId, row.code, row.name, row.balanceMinor]));
  }
  lines.push(rowToCSV(["TOTAL LIABILITIES", "", "", "", report.totalLiabilitiesMinor]));
  lines.push("");
  lines.push(rowToCSV(["EQUITY", "", "", "", ""]));
  for (const row of report.equity) {
    lines.push(rowToCSV(["", row.accountId, row.code, row.name, row.balanceMinor]));
  }
  lines.push(rowToCSV(["TOTAL EQUITY", "", "", "", report.totalEquityMinor]));
  lines.push(rowToCSV(["Current Period Result", "", "", "", report.currentPeriodResultMinor]));
  lines.push(rowToCSV(["TOTAL LIABILITIES AND EQUITY", "", "", "", report.totalLiabilitiesAndEquityMinor]));
  lines.push("");
  lines.push(rowToCSV(["Is Balanced", "", "", "", report.isBalanced ? "Yes" : "No"]));
  return lines.join("\r\n");
}

async function generateARAgingCSV(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, asOfDate: string): Promise<string> {
  const lines: string[] = [];
  lines.push(rowToCSV(["Customer ID", "Invoice ID", "Invoice Date", "Due Date", "Amount Outstanding (Minor Units)", "Aging Bucket"]));
  const invoices = await session.query(
    `SELECT i.id, i.customer_id, i.issue_date, i.due_date,
            i.total_minor - COALESCE(SUM(CASE WHEN br.receipt_date <= ? THEN a.amount_minor ELSE 0 END), 0) as outstanding
     FROM sales_invoices i
     LEFT JOIN bank_receipt_allocations a ON a.invoice_id = i.id AND a.tenant_id = i.tenant_id AND a.book_set_id = i.book_set_id
     LEFT JOIN bank_receipts br ON a.receipt_id = br.id AND br.tenant_id = i.tenant_id AND br.book_set_id = i.book_set_id
     WHERE i.tenant_id = ? AND i.book_set_id = ? AND i.issue_date <= ? AND i.status != 'DRAFT'
     GROUP BY i.id, i.customer_id, i.issue_date, i.due_date
     HAVING outstanding > 0
     ORDER BY i.issue_date, i.id`,
    [asOfDate, tenantId, bookSetId, asOfDate],
  );

  for (const inv of invoices.rows as Array<Record<string, unknown>>) {
    const issueDate = String(inv.issue_date);
    const dueDate = inv.due_date ? String(inv.due_date) : issueDate;
    const ageFromDate = inv.due_date ? dueDate : issueDate;
    const daysSinceDue = Math.floor((new Date(`${asOfDate}T00:00:00Z`).getTime() - new Date(`${ageFromDate}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24));
    let bucket = "CURRENT";
    if (daysSinceDue >= 91) bucket = "91_PLUS";
    else if (daysSinceDue >= 61) bucket = "61_90";
    else if (daysSinceDue >= 31) bucket = "31_60";
    else if (daysSinceDue >= 1) bucket = "1_30";

    lines.push(rowToCSV([String(inv.customer_id), String(inv.id), issueDate, dueDate, inv.outstanding, bucket]));
  }
  return lines.join("\r\n");
}

async function generateAPAgingCSV(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, asOfDate: string): Promise<string> {
  const lines: string[] = [];
  lines.push(rowToCSV(["Vendor ID", "Bill ID", "Bill Date", "Due Date", "Amount Outstanding (Minor Units)", "Aging Bucket"]));
  const bills = await session.query(
    `SELECT b.id, b.vendor_id, b.bill_date, b.due_date,
            b.total_minor
              - COALESCE((SELECT SUM(a.amount_minor)
                          FROM vendor_payment_allocations a
                          JOIN vendor_payments vp ON vp.id = a.payment_id
                            AND vp.tenant_id = a.tenant_id AND vp.book_set_id = a.book_set_id
                          WHERE a.bill_id = b.id AND a.tenant_id = b.tenant_id AND a.book_set_id = b.book_set_id
                            AND vp.payment_date <= ?), 0)
              - CASE WHEN EXISTS (
                  SELECT 1 FROM withholding_events we
                  WHERE we.document_type = 'PURCHASE' AND we.document_id = b.id
                    AND we.tenant_id = b.tenant_id AND we.book_set_id = b.book_set_id
                    AND we.tax_kind = 'TDS' AND we.status = 'POSTED' AND we.event_date <= ?
                ) THEN b.withholding_minor ELSE 0 END as outstanding
     FROM vendor_bills b
     WHERE b.tenant_id = ? AND b.book_set_id = ? AND b.bill_date <= ? AND b.status != 'DRAFT'
     GROUP BY b.id, b.vendor_id, b.bill_date, b.due_date, b.total_minor, b.withholding_minor
     HAVING outstanding > 0
     ORDER BY b.bill_date, b.id`,
    [asOfDate, asOfDate, tenantId, bookSetId, asOfDate],
  );

  for (const bill of bills.rows as Array<Record<string, unknown>>) {
    const billDate = String(bill.bill_date);
    const dueDate = bill.due_date ? String(bill.due_date) : billDate;
    const ageFromDate = bill.due_date ? dueDate : billDate;
    const daysSinceDue = Math.floor((new Date(`${asOfDate}T00:00:00Z`).getTime() - new Date(`${ageFromDate}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24));
    let bucket = "CURRENT";
    if (daysSinceDue >= 91) bucket = "91_PLUS";
    else if (daysSinceDue >= 61) bucket = "61_90";
    else if (daysSinceDue >= 31) bucket = "31_60";
    else if (daysSinceDue >= 1) bucket = "1_30";

    lines.push(rowToCSV([String(bill.vendor_id), String(bill.id), billDate, dueDate, bill.outstanding, bucket]));
  }
  return lines.join("\r\n");
}

async function generateBankReconciliationSummaryCSV(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<string> {
  const lines: string[] = [];
  lines.push(rowToCSV(["Bank Account ID", "Account Code", "Matched Amount (Minor Units)", "Unmatched Amount (Minor Units)", "Matched Count", "Unmatched Count"]));
  const accounts = await session.query("SELECT DISTINCT bank_account_id FROM bank_statements WHERE tenant_id = ? AND book_set_id = ? ORDER BY bank_account_id", [tenantId, bookSetId]);

  for (const acct of accounts.rows as Array<Record<string, unknown>>) {
    const accountId = String(acct.bank_account_id);
    const acc = await session.querySingle("SELECT code FROM accounts WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [accountId, tenantId, bookSetId]);
    const code = acc ? String(acc.code) : "";

    const stmt = await session.query(
      `SELECT bs.id
       FROM bank_statements bs
       WHERE bs.tenant_id = ? AND bs.book_set_id = ? AND bs.bank_account_id = ?
       ORDER BY bs.id`,
      [tenantId, bookSetId, accountId],
    );
    const statementIds = stmt.rows.map((s: Record<string, unknown>) => String(s.id));

    if (statementIds.length === 0) continue;

    const summary = await session.querySingle(
      `SELECT
         COALESCE(SUM(CASE WHEN bm.id IS NOT NULL THEN bsl.signed_amount_minor ELSE 0 END), 0) as matched_amount,
         COALESCE(SUM(CASE WHEN bm.id IS NULL THEN bsl.signed_amount_minor ELSE 0 END), 0) as unmatched_amount,
         COUNT(CASE WHEN bm.id IS NOT NULL THEN 1 END) as matched_count,
         COUNT(CASE WHEN bm.id IS NULL THEN 1 END) as unmatched_count
       FROM bank_statement_lines bsl
       LEFT JOIN bank_matches bm ON bm.statement_line_id = bsl.id AND bm.tenant_id = bsl.tenant_id AND bm.book_set_id = bsl.book_set_id AND bm.status = 'ACTIVE'
       WHERE bsl.tenant_id = ? AND bsl.book_set_id = ? AND bsl.statement_id IN (${statementIds.map(() => "?").join(",")}) AND bsl.transaction_date >= ? AND bsl.transaction_date <= ?`,
      [tenantId, bookSetId, ...statementIds, periodStart, periodEnd],
    );

    const matchedAmt = Number(summary?.matched_amount ?? 0);
    const unmatchedAmt = Number(summary?.unmatched_amount ?? 0);
    const matchedCnt = Number(summary?.matched_count ?? 0);
    const unmatchedCnt = Number(summary?.unmatched_count ?? 0);
    lines.push(rowToCSV([accountId, code, matchedAmt, unmatchedAmt, matchedCnt, unmatchedCnt]));
  }
  return lines.join("\r\n");
}

async function generateComplianceReadinessSummaryCSV(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<string> {
  const lines: string[] = [];
  lines.push(rowToCSV(["Category", "Total Items", "Ready", "Unresolved", "Status"]));

  const gstReturns = await session.query(
    `SELECT COUNT(*) as cnt, SUM(CASE WHEN grv.readiness_status = 'READY' THEN 1 ELSE 0 END) as resolved
     FROM gst_return_validations grv
     JOIN gst_returns gr ON gr.id = grv.return_id AND gr.tenant_id = grv.tenant_id AND gr.book_set_id = grv.book_set_id
     WHERE grv.tenant_id = ? AND grv.book_set_id = ? AND gr.tax_period_from <= ? AND gr.tax_period_to >= ?`,
    [tenantId, bookSetId, periodEnd, periodStart],
  );
  const gstCount = Number(gstReturns.rows?.[0]?.cnt ?? 0);
  const gstResolved = Number(gstReturns.rows?.[0]?.resolved ?? 0);
  const gstStatus = gstCount === 0 ? "NOT_AVAILABLE" : gstCount === gstResolved ? "READY" : "REVIEW_REQUIRED";
  lines.push(rowToCSV(["GST Returns", gstCount, gstResolved, gstCount - gstResolved, gstStatus]));

  const tdsEvents = await session.query(
    `SELECT COUNT(*) as cnt, SUM(CASE WHEN wcc.state = 'ACCEPTED' THEN 1 ELSE 0 END) as resolved
     FROM withholding_compliance_cases wcc
     WHERE wcc.tenant_id = ? AND wcc.book_set_id = ? AND wcc.period_start <= ? AND wcc.period_end >= ?`,
    [tenantId, bookSetId, periodEnd, periodStart],
  );
  const tdsCount = Number(tdsEvents.rows?.[0]?.cnt ?? 0);
  const tdsResolved = Number(tdsEvents.rows?.[0]?.resolved ?? 0);
  const tdsStatus = tdsCount === 0 ? "NOT_AVAILABLE" : tdsCount === tdsResolved ? "READY" : "REVIEW_REQUIRED";
  lines.push(rowToCSV(["TDS/TCS Compliance", tdsCount, tdsResolved, tdsCount - tdsResolved, tdsStatus]));

  const obligations = await session.query(
    `SELECT COUNT(*) as cnt FROM compliance_obligations
     WHERE tenant_id = ? AND book_set_id = ? AND period_start <= ? AND period_end >= ?`,
    [tenantId, bookSetId, periodEnd, periodStart],
  );
  const obligationCount = Number(obligations.rows?.[0]?.cnt ?? 0);
  const obligStatus = obligationCount === 0 ? "NOT_AVAILABLE" : "REVIEW_REQUIRED";
  lines.push(rowToCSV(["Compliance Obligations", obligationCount, 0, obligationCount, obligStatus]));

  return lines.join("\r\n");
}

async function generatePeriodCloseChecklistCSV(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<string> {
  const lines: string[] = [];
  lines.push(rowToCSV(["Item", "Status", "Count"]));

  const ledger = await ledgerSnapshotInSession(session, tenantId, bookSetId, periodStart, periodEnd);
  lines.push(rowToCSV(["Trial Balance Balanced", ledger.trialBalance.isBalanced ? "✓" : "✗", ""]));
  lines.push(rowToCSV(["Balance Sheet Balanced", ledger.balanceSheet.isBalanced ? "✓" : "✗", ""]));

  const gst = await session.query(
    `SELECT COUNT(*) as cnt
     FROM gst_return_validations grv
     JOIN gst_returns gr ON gr.id = grv.return_id AND gr.tenant_id = grv.tenant_id AND gr.book_set_id = grv.book_set_id
     WHERE grv.tenant_id = ? AND grv.book_set_id = ? AND gr.tax_period_from <= ? AND gr.tax_period_to >= ? AND grv.readiness_status <> 'READY'`,
    [tenantId, bookSetId, periodEnd, periodStart],
  );
  lines.push(rowToCSV(["GST Returns Resolved", Number(gst.rows[0].cnt) === 0 ? "✓" : "✗", gst.rows[0].cnt]));

  const tds = await session.query(
    "SELECT COUNT(*) as cnt FROM withholding_compliance_cases WHERE tenant_id = ? AND book_set_id = ? AND period_start <= ? AND period_end >= ? AND state <> 'ACCEPTED'",
    [tenantId, bookSetId, periodEnd, periodStart],
  );
  lines.push(rowToCSV(["TDS/TCS Cases Resolved", Number(tds.rows[0].cnt) === 0 ? "✓" : "✗", tds.rows[0].cnt]));

  return lines.join("\r\n");
}

async function generateAuditIndexCSV(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<string> {
  const lines: string[] = [];
  lines.push(rowToCSV(["Report", "Row Count", "Hash"]));

  const reports: { name: string; table: string; where: string; params: unknown[] }[] = [
    { name: "Journal Entries", table: "journal_entries", where: "WHERE tenant_id = ? AND book_set_id = ? AND status = 'POSTED' AND posting_date >= ? AND posting_date <= ?", params: [tenantId, bookSetId, periodStart, periodEnd] },
    { name: "Sales Invoices", table: "sales_invoices", where: "WHERE tenant_id = ? AND book_set_id = ? AND issue_date >= ? AND issue_date <= ?", params: [tenantId, bookSetId, periodStart, periodEnd] },
    { name: "Vendor Bills", table: "vendor_bills", where: "WHERE tenant_id = ? AND book_set_id = ? AND bill_date >= ? AND bill_date <= ?", params: [tenantId, bookSetId, periodStart, periodEnd] },
  ];

  for (const report of reports) {
    const result = await session.query(`SELECT id FROM ${report.table} ${report.where} ORDER BY id`, report.params);
    const idList = result.rows.map((r: Record<string, unknown>) => String(r.id)).sort();
    const count = idList.length;
    const hash = count === 0 ? createHash("sha256").update("").digest("hex") : createHash("sha256").update(idList.join(",")).digest("hex");
    lines.push(rowToCSV([report.name, count, hash]));
  }

  return lines.join("\r\n");
}

async function replay(session: BusinessSession, envelope: ClosePackEnvelope<unknown>, requestHash: string): Promise<CommandResult<ClosePackExportResult> | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [envelope.tenantId, envelope.requestId]);
  if (!row) return undefined;
  if (String(row.request_hash) !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
  if (computeResultHash(String(row.result_json)) !== String(row.result_hash)) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson: String(row.result_json), resultHash: String(row.result_hash), replayed: true };
}

export class ClosePackService {
  constructor(private readonly sessionRunner: BusinessSessionRunner) {}

  async export(envelope: ClosePackEnvelope<ClosePackExportPayload>): Promise<CommandResult<ClosePackExportResult>> {
    const payload = envelope.payload;
    isoDate(payload.periodStart, "periodStart");
    isoDate(payload.periodEnd, "periodEnd");
    isoDate(payload.asOfDate, "asOfDate");
    if (payload.periodStart > payload.periodEnd) throw new DomainError("INVALID_PERIOD_RANGE", "periodStart must not be after periodEnd");
    if (payload.asOfDate < payload.periodEnd) throw new DomainError("INVALID_AS_OF_DATE", "asOfDate must be on or after periodEnd");
    if (payload.basis !== "ACCRUAL") throw new DomainError("INVALID_BASIS", "basis must be ACCRUAL");

    const requestHash = computeCommandHash("report.close-pack.export", envelope, payload);
    return this.sessionRunner.withBusinessSession("write", async (session) => {
      const prior = await replay(session, envelope, requestHash);
      if (prior) return prior;

      const bookSetRow = await session.querySingle("SELECT id, lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?", [envelope.bookSetId, envelope.tenantId]);
      if (!bookSetRow) throw new DomainError("BOOK_SET_NOT_FOUND", `BookSet not found: ${envelope.bookSetId}`);
      if (String(bookSetRow.lifecycle) !== "ACTIVE") throw new DomainError("BOOK_SET_INACTIVE", "BookSet must be ACTIVE");

      const manifestId = randomUUID();
      const periodStatus = await getPeriodStatus(session, envelope.tenantId, envelope.bookSetId, payload.periodStart, payload.periodEnd);
      const periodCloseStateHash = await getPeriodCloseStateHash(session, envelope.tenantId, envelope.bookSetId, payload.periodStart, payload.periodEnd);

      const ledger = await ledgerSnapshotInSession(session, envelope.tenantId, envelope.bookSetId, payload.periodStart, payload.periodEnd);
      const sections: Array<{ name: string; csv: string }> = [];
      sections.push({ name: "trial_balance", csv: generateTrialBalanceCSV(ledger.trialBalance) });
      sections.push({ name: "profit_and_loss", csv: generateProfitAndLossCSV(ledger.profitAndLoss) });
      sections.push({ name: "balance_sheet", csv: generateBalanceSheetCSV(ledger.balanceSheet) });
      sections.push({ name: "ar_aging", csv: await generateARAgingCSV(session, envelope.tenantId, envelope.bookSetId, payload.asOfDate) });
      sections.push({ name: "ap_aging", csv: await generateAPAgingCSV(session, envelope.tenantId, envelope.bookSetId, payload.asOfDate) });
      sections.push({ name: "bank_reconciliation_summary", csv: await generateBankReconciliationSummaryCSV(session, envelope.tenantId, envelope.bookSetId, payload.periodStart, payload.periodEnd) });
      sections.push({ name: "compliance_readiness_summary", csv: await generateComplianceReadinessSummaryCSV(session, envelope.tenantId, envelope.bookSetId, payload.periodStart, payload.periodEnd) });
      sections.push({ name: "period_close_checklist", csv: await generatePeriodCloseChecklistCSV(session, envelope.tenantId, envelope.bookSetId, payload.periodStart, payload.periodEnd) });
      sections.push({ name: "audit_index", csv: await generateAuditIndexCSV(session, envelope.tenantId, envelope.bookSetId, payload.periodStart, payload.periodEnd) });

      const sectionMetadata = sections.map((sec) => {
        const lines = sec.csv.split("\r\n").filter((line) => line.length > 0);
        return { name: sec.name, rowCount: Math.max(0, lines.length - 1), hash: createHash("sha256").update(sec.csv).digest("hex"), size: Buffer.byteLength(sec.csv, "utf8") };
      });

      const sortedSectionMetadata = [...sectionMetadata].sort((a, b) => a.name.localeCompare(b.name));
      const manifestBody = { manifestFormat: "NEUTRAL_CA_CLOSE_PACK_V1", schemaVersion: 1, scope: { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId }, dates: { periodStart: payload.periodStart, periodEnd: payload.periodEnd, asOfDate: payload.asOfDate }, basis: "ACCRUAL", status: { periodCloseStateHash, periodCloseLabel: periodStatus }, sections: sortedSectionMetadata, metadata: { governmentCompatible: false, submitted: false } };
      const manifestHash = hashJson(manifestBody);

      const now = new Date().toISOString();
      const resultBase: ClosePackExportResult = { manifestId, manifestFormat: "NEUTRAL_CA_CLOSE_PACK_V1", manifestHash, periodCloseLabel: periodStatus, sectionNames: sections.map((s) => s.name) };
      const resultJson = canonicalJson(resultBase);
      const resultHash = computeResultHash(resultJson);

      await session.execute("INSERT INTO close_pack_manifests (id, tenant_id, book_set_id, period_start, period_end, as_of_date, basis, manifest_format, schema_version, period_close_state_hash, period_close_label, manifest_hash, government_compatible, submitted, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        manifestId, envelope.tenantId, envelope.bookSetId, payload.periodStart, payload.periodEnd, payload.asOfDate, "ACCRUAL", "NEUTRAL_CA_CLOSE_PACK_V1", 1, periodCloseStateHash, periodStatus, manifestHash, 0, 0, envelope.requestId, requestHash, resultJson, resultHash, now,
      ]);

      for (let i = 0; i < sections.length; i++) {
        const sectionId = randomUUID();
        const meta = sectionMetadata[i]!;
        await session.execute("INSERT INTO close_pack_sections (id, manifest_id, tenant_id, book_set_id, section_name, row_count, body_hash, body_size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [sectionId, manifestId, envelope.tenantId, envelope.bookSetId, meta.name, meta.rowCount, meta.hash, meta.size, now]);

        const bodyId = randomUUID();
        await session.execute("INSERT INTO close_pack_bodies (id, section_id, manifest_id, tenant_id, book_set_id, csv_body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [bodyId, sectionId, manifestId, envelope.tenantId, envelope.bookSetId, sections[i]!.csv, now]);
      }

      await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]);

      await session.execute(
        "INSERT INTO audit_records (id, tenant_id, book_set_id, occurred_at, action, actor_type, actor_id, request_id, entity_type, entity_id, source, reason, command, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [randomUUID(), envelope.tenantId, envelope.bookSetId, now, "CLOSE_PACK_EXPORT", envelope.actor.kind, envelope.actor.id, envelope.requestId, "CLOSE_PACK", manifestId, envelope.source, envelope.reason, "report.close-pack.export", now],
      );

      return { resultJson, resultHash };
    });
  }

  async getManifest(tenantId: TenantId, bookSetId: BookSetId, manifestId: string): Promise<ClosePackManifest | null> {
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const manifest = await session.querySingle("SELECT id, manifest_format, schema_version, period_start, period_end, as_of_date, basis, period_close_state_hash, period_close_label, manifest_hash, government_compatible, submitted FROM close_pack_manifests WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [manifestId, tenantId, bookSetId]);
      if (!manifest) return null;

      const sections = await session.query("SELECT section_name, row_count, body_hash FROM close_pack_sections WHERE manifest_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY section_name", [manifestId, tenantId, bookSetId]);

      return {
        id: String(manifest.id),
        manifestFormat: String(manifest.manifest_format),
        schemaVersion: Number(manifest.schema_version),
        scope: { tenantId, bookSetId },
        dates: { periodStart: String(manifest.period_start), periodEnd: String(manifest.period_end), asOfDate: String(manifest.as_of_date) },
        basis: String(manifest.basis),
        status: { periodCloseStateHash: String(manifest.period_close_state_hash), periodCloseLabel: String(manifest.period_close_label) as PeriodStatus },
        metadata: { manifestHash: String(manifest.manifest_hash), governmentCompatible: manifest.government_compatible === 1, submitted: manifest.submitted === 1 },
        sections: sections.rows.map((row) => ({ name: String(row.section_name), rowCount: Number(row.row_count), hash: String(row.body_hash) })),
      };
    });
  }

  async getSection(tenantId: TenantId, bookSetId: BookSetId, manifestId: string, sectionName: string): Promise<string | null> {
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      const section = await session.querySingle("SELECT id FROM close_pack_sections WHERE manifest_id = ? AND section_name = ? AND tenant_id = ? AND book_set_id = ?", [manifestId, sectionName, tenantId, bookSetId]);
      if (!section) return null;
      const body = await session.querySingle("SELECT csv_body FROM close_pack_bodies WHERE section_id = ? AND tenant_id = ? AND book_set_id = ?", [section.id, tenantId, bookSetId]);
      return body ? String(body.csv_body) : null;
    });
  }
}
