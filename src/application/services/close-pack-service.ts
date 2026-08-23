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
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date`);
}

function nonblank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_REQUEST", `${field} must be nonblank`);
  return value.trim();
}

function escapeCSV(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) return `"${str.replace(/"/g, '""')}"`;
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
  return lines.join("\n");
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
  return lines.join("\n");
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
  return lines.join("\n");
}

async function generateARAgingCSV(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, asOfDate: string): Promise<string> {
  const lines: string[] = [];
  lines.push(rowToCSV(["Customer ID", "Party ID", "Invoice ID", "Invoice Date", "Amount Outstanding (Minor Units)", "Days Overdue", "Bucket"]));
  const invoices = await session.query(
    `SELECT i.id, i.party_id, i.issue_date,
            COALESCE(i.invoice_amount_minor - COALESCE(SUM(CASE WHEN a.receipt_date <= ? THEN a.allocated_amount_minor ELSE 0 END), 0), i.invoice_amount_minor) as outstanding
     FROM sales_invoices i
     LEFT JOIN bank_receipt_allocations a ON a.invoice_id = i.id AND a.tenant_id = i.tenant_id AND a.book_set_id = i.book_set_id
     WHERE i.tenant_id = ? AND i.book_set_id = ? AND i.status = 'POSTED'
     GROUP BY i.id, i.party_id, i.issue_date
     HAVING outstanding > 0
     ORDER BY i.issue_date, i.id`,
    [asOfDate, tenantId, bookSetId],
  );

  for (const inv of invoices.rows as Array<Record<string, unknown>>) {
    const issueDate = String(inv.issue_date);
    const daysSinceDue = Math.max(0, Math.floor((new Date(`${asOfDate}T00:00:00Z`).getTime() - new Date(`${issueDate}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24)));
    let bucket = "CURRENT";
    if (daysSinceDue > 91) bucket = "91_PLUS";
    else if (daysSinceDue > 60) bucket = "61_90";
    else if (daysSinceDue > 30) bucket = "31_60";
    else if (daysSinceDue > 0) bucket = "1_30";

    lines.push(rowToCSV([String(inv.id), String(inv.party_id), String(inv.id), issueDate, inv.outstanding, daysSinceDue, bucket]));
  }
  return lines.join("\n");
}

async function generateAPAgingCSV(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, asOfDate: string): Promise<string> {
  const lines: string[] = [];
  lines.push(rowToCSV(["Vendor ID", "Party ID", "Bill ID", "Bill Date", "Amount Outstanding (Minor Units)", "Days Overdue", "Bucket"]));
  const bills = await session.query(
    `SELECT b.id, b.party_id, b.bill_date,
            COALESCE(b.bill_amount_minor - COALESCE(SUM(CASE WHEN p.payment_date <= ? THEN p.allocated_amount_minor ELSE 0 END), 0), b.bill_amount_minor) as outstanding
     FROM vendor_bills b
     LEFT JOIN vendor_payment_allocations p ON p.bill_id = b.id AND p.tenant_id = b.tenant_id AND p.book_set_id = b.book_set_id
     WHERE b.tenant_id = ? AND b.book_set_id = ? AND b.status = 'POSTED'
     GROUP BY b.id, b.party_id, b.bill_date
     HAVING outstanding > 0
     ORDER BY b.bill_date, b.id`,
    [asOfDate, tenantId, bookSetId],
  );

  for (const bill of bills.rows as Array<Record<string, unknown>>) {
    const billDate = String(bill.bill_date);
    const daysSinceDue = Math.max(0, Math.floor((new Date(`${asOfDate}T00:00:00Z`).getTime() - new Date(`${billDate}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24)));
    let bucket = "CURRENT";
    if (daysSinceDue > 91) bucket = "91_PLUS";
    else if (daysSinceDue > 60) bucket = "61_90";
    else if (daysSinceDue > 30) bucket = "31_60";
    else if (daysSinceDue > 0) bucket = "1_30";

    lines.push(rowToCSV([String(bill.id), String(bill.party_id), String(bill.id), billDate, bill.outstanding, daysSinceDue, bucket]));
  }
  return lines.join("\n");
}

async function generateBankReconciliationSummaryCSV(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId): Promise<string> {
  const lines: string[] = [];
  lines.push(rowToCSV(["Bank Account ID", "Account Code", "Total Statements", "Total Transactions", "Matched Transactions", "Unmatched Transactions"]));
  const statements = await session.query("SELECT DISTINCT account_id FROM bank_statements WHERE tenant_id = ? AND book_set_id = ? ORDER BY account_id", [tenantId, bookSetId]);

  for (const stmt of statements.rows as Array<Record<string, unknown>>) {
    const accountId = String(stmt.account_id);
    const acc = await session.querySingle("SELECT code FROM accounts WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [accountId, tenantId, bookSetId]);
    const code = acc ? String(acc.code) : "";

    const stmtCount = await session.querySingle("SELECT COUNT(*) as cnt FROM bank_statements WHERE tenant_id = ? AND book_set_id = ? AND account_id = ?", [tenantId, bookSetId, accountId]);
    const txnCount = await session.querySingle("SELECT COUNT(*) as cnt FROM bank_statement_lines WHERE tenant_id = ? AND book_set_id = ? AND statement_id IN (SELECT id FROM bank_statements WHERE account_id = ?)", [tenantId, bookSetId, accountId]);
    const matchedCount = await session.querySingle("SELECT COUNT(DISTINCT statement_line_id) as cnt FROM bank_matches WHERE tenant_id = ? AND book_set_id = ? AND status = 'ACTIVE' AND statement_line_id IN (SELECT id FROM bank_statement_lines WHERE statement_id IN (SELECT id FROM bank_statements WHERE account_id = ?))", [tenantId, bookSetId, accountId]);

    const total = Number(txnCount?.cnt ?? 0);
    const matched = Number(matchedCount?.cnt ?? 0);
    lines.push(rowToCSV([accountId, code, stmtCount?.cnt ?? 0, total, matched, total - matched]));
  }
  return lines.join("\n");
}

async function generateComplianceReadinessSummaryCSV(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId): Promise<string> {
  const lines: string[] = [];
  lines.push(rowToCSV(["Category", "Total Items", "Resolved", "Unresolved", "Status"]));

  const gstReturns = await session.query("SELECT COUNT(*) as cnt, SUM(CASE WHEN readiness_status = 'READY' THEN 1 ELSE 0 END) as resolved FROM gst_return_validations WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  const gstCount = Number(gstReturns.rows?.[0]?.cnt ?? 0);
  const gstResolved = Number(gstReturns.rows?.[0]?.resolved ?? 0);
  lines.push(rowToCSV(["GST Returns", gstCount, gstResolved, gstCount - gstResolved, gstCount === gstResolved ? "READY" : "PENDING"]));

  const tdsEvents = await session.query("SELECT COUNT(*) as cnt, SUM(CASE WHEN state = 'ACCEPTED' THEN 1 ELSE 0 END) as resolved FROM withholding_compliance_cases WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  const tdsCount = Number(tdsEvents.rows?.[0]?.cnt ?? 0);
  const tdsResolved = Number(tdsEvents.rows?.[0]?.resolved ?? 0);
  lines.push(rowToCSV(["TDS/TCS Compliance", tdsCount, tdsResolved, tdsCount - tdsResolved, tdsCount === tdsResolved ? "READY" : "PENDING"]));

  const obligations = await session.query("SELECT COUNT(*) as cnt FROM compliance_obligations WHERE tenant_id = ? AND book_set_id = ?", [tenantId, bookSetId]);
  const obligationCount = Number(obligations.rows?.[0]?.cnt ?? 0);
  lines.push(rowToCSV(["Compliance Obligations", obligationCount, 0, obligationCount, obligationCount === 0 ? "READY" : "PENDING"]));

  return lines.join("\n");
}

async function generatePeriodCloseChecklistCSV(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<string> {
  const lines: string[] = [];
  lines.push(rowToCSV(["Item", "Status", "Count"]));

  const ledger = await ledgerSnapshotInSession(session, tenantId, bookSetId, periodStart, periodEnd);
  lines.push(rowToCSV(["Trial Balance Balanced", ledger.trialBalance.isBalanced ? "✓" : "✗", ""]));
  lines.push(rowToCSV(["Balance Sheet Balanced", ledger.balanceSheet.isBalanced ? "✓" : "✗", ""]));

  const gst = await session.query("SELECT COUNT(*) as cnt FROM gst_return_validations WHERE tenant_id = ? AND book_set_id = ? AND readiness_status <> 'READY'", [tenantId, bookSetId]);
  lines.push(rowToCSV(["GST Returns Resolved", Number(gst.rows[0].cnt) === 0 ? "✓" : "✗", gst.rows[0].cnt]));

  const tds = await session.query("SELECT COUNT(*) as cnt FROM withholding_compliance_cases WHERE tenant_id = ? AND book_set_id = ? AND state <> 'ACCEPTED'", [tenantId, bookSetId]);
  lines.push(rowToCSV(["TDS/TCS Cases Resolved", Number(tds.rows[0].cnt) === 0 ? "✓" : "✗", tds.rows[0].cnt]));

  return lines.join("\n");
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
    const result = await session.query(`SELECT COUNT(*) as cnt, GROUP_CONCAT(id) as ids FROM ${report.table} ${report.where} ORDER BY id`, report.params);
    const count = Number(result.rows[0]?.cnt ?? 0);
    const ids = String(result.rows[0]?.ids ?? "");
    const hash = count === 0 ? createHash("sha256").update("").digest("hex") : createHash("sha256").update(ids).digest("hex");
    lines.push(rowToCSV([report.name, count, hash]));
  }

  return lines.join("\n");
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
      sections.push({ name: "bank_reconciliation_summary", csv: await generateBankReconciliationSummaryCSV(session, envelope.tenantId, envelope.bookSetId) });
      sections.push({ name: "compliance_readiness_summary", csv: await generateComplianceReadinessSummaryCSV(session, envelope.tenantId, envelope.bookSetId) });
      sections.push({ name: "period_close_checklist", csv: await generatePeriodCloseChecklistCSV(session, envelope.tenantId, envelope.bookSetId, payload.periodStart, payload.periodEnd) });
      sections.push({ name: "audit_index", csv: await generateAuditIndexCSV(session, envelope.tenantId, envelope.bookSetId, payload.periodStart, payload.periodEnd) });

      const sectionMetadata = sections.map((sec) => {
        const lines = sec.csv.split("\n").filter((line) => line.length > 0);
        return { name: sec.name, rowCount: Math.max(0, lines.length - 1), hash: createHash("sha256").update(sec.csv).digest("hex"), size: Buffer.byteLength(sec.csv, "utf8") };
      });

      const manifestBody = { manifestFormat: "NEUTRAL_CA_CLOSE_PACK_V1", schemaVersion: 1, scope: { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId }, dates: { periodStart: payload.periodStart, periodEnd: payload.periodEnd, asOfDate: payload.asOfDate }, basis: "ACCRUAL", status: { periodCloseStateHash, periodCloseLabel: periodStatus }, sections: sectionMetadata, metadata: { governmentCompatible: false, submitted: false } };
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
      const body = await session.querySingle("SELECT csv_body FROM close_pack_bodies WHERE section_id IN (SELECT id FROM close_pack_sections WHERE manifest_id = ? AND section_name = ? AND tenant_id = ? AND book_set_id = ?) LIMIT 1", [manifestId, sectionName, tenantId, bookSetId]);
      return body ? String(body.csv_body) : null;
    });
  }
}
