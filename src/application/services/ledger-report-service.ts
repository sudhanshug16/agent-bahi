import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError } from "../../core/types.ts";

export interface LedgerReportAccountRow {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
}

export interface TrialBalanceReport {
  asOfDate: string;
  rows: LedgerReportAccountRow[];
  totalDebitMinor: number;
  totalCreditMinor: number;
  isBalanced: boolean;
}

export interface ProfitAndLossReport {
  fromDate: string;
  toDate: string;
  incomeMinor: number;
  expenseMinor: number;
  netProfitLossMinor: number;
  incomeRows: LedgerReportAccountRow[];
  expenseRows: LedgerReportAccountRow[];
}

export interface BalanceSheetReport {
  asOfDate: string;
  assets: LedgerReportAccountRow[];
  liabilities: LedgerReportAccountRow[];
  equity: LedgerReportAccountRow[];
  totalAssetsMinor: number;
  totalLiabilitiesMinor: number;
  totalEquityMinor: number;
  currentPeriodResultMinor: number;
  totalLiabilitiesAndEquityMinor: number;
  isBalanced: boolean;
}

interface AccountAccumulator extends LedgerReportAccountRow {
  accountType: string;
}

function assertIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("INVALID_REPORT_DATE", `${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new DomainError("INVALID_REPORT_DATE", `${field} must be a valid ISO date`);
}

function safeMinor(value: unknown): number {
  const result = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  if (!Number.isSafeInteger(result)) throw new DomainError("REPORT_AMOUNT_UNSAFE", "stored minor amount exceeds safe integer range");
  return result;
}

function addMinor(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new DomainError("REPORT_AMOUNT_UNSAFE", "report total exceeds safe integer range");
  return result;
}

function subtractMinor(left: number, right: number): number {
  const result = left - right;
  if (!Number.isSafeInteger(result)) throw new DomainError("REPORT_AMOUNT_UNSAFE", "report total exceeds safe integer range");
  return result;
}

async function assertBookSet(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId): Promise<void> {
  const row = await session.querySingle(
    "SELECT id, lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?",
    [bookSetId, tenantId],
  );
  if (!row) throw new DomainError("BOOK_SET_NOT_FOUND", `BookSet not found: ${bookSetId}`);
  if (String(row.lifecycle) !== "ACTIVE") throw new DomainError("BOOK_SET_INACTIVE", "BookSet must be ACTIVE for ledger reports");
}

async function loadAccounts(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId): Promise<Map<string, AccountAccumulator>> {
  const rows = await session.query(
    "SELECT id, code, name, account_type FROM accounts WHERE tenant_id = ? AND book_set_id = ? ORDER BY code",
    [tenantId, bookSetId],
  );
  const accounts = new Map<string, AccountAccumulator>();
  for (const row of rows.rows) {
    accounts.set(String(row.id), { accountId: String(row.id), code: String(row.code), name: String(row.name), accountType: String(row.account_type), debitMinor: 0, creditMinor: 0, balanceMinor: 0 });
  }
  return accounts;
}

async function applyLines(
  session: BusinessSession,
  accounts: Map<string, AccountAccumulator>,
  tenantId: TenantId,
  bookSetId: BookSetId,
  fromDate: string | undefined,
  toDate: string,
): Promise<void> {
  const sql = fromDate
    ? `SELECT jl.account_id, jl.debit_minor, jl.credit_minor
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.tenant_id = je.tenant_id AND jl.book_set_id = je.book_set_id
       WHERE je.tenant_id = ? AND je.book_set_id = ? AND je.status = 'POSTED'
         AND je.posting_date <= ? AND je.posting_date >= ?`
    : `SELECT jl.account_id, jl.debit_minor, jl.credit_minor
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.tenant_id = je.tenant_id AND jl.book_set_id = je.book_set_id
       WHERE je.tenant_id = ? AND je.book_set_id = ? AND je.status = 'POSTED'
         AND je.posting_date <= ?`;
  const params = fromDate ? [tenantId, bookSetId, toDate, fromDate] : [tenantId, bookSetId, toDate];
  const rows = await session.query(sql, params);
  for (const row of rows.rows) {
    const account = accounts.get(String(row.account_id));
    if (!account) continue;
    account.debitMinor = addMinor(account.debitMinor, safeMinor(row.debit_minor));
    account.creditMinor = addMinor(account.creditMinor, safeMinor(row.credit_minor));
    account.balanceMinor = subtractMinor(account.debitMinor, account.creditMinor);
  }
}

/** Build all ledger reports on a caller-owned session for atomic snapshots. */
export async function ledgerSnapshotInSession(
  session: BusinessSession,
  tenantId: TenantId,
  bookSetId: BookSetId,
  fromDate: string,
  toDate: string,
): Promise<{ trialBalance: TrialBalanceReport; profitAndLoss: ProfitAndLossReport; balanceSheet: BalanceSheetReport }> {
  await assertBookSet(session, tenantId, bookSetId);
  const trialAccounts = await loadAccounts(session, tenantId, bookSetId);
  await applyLines(session, trialAccounts, tenantId, bookSetId, undefined, toDate);
  const trialRows = [...trialAccounts.values()].map(toReportRow);
  const trialBalance: TrialBalanceReport = {
    asOfDate: toDate,
    rows: trialRows,
    totalDebitMinor: trialRows.reduce((sum, row) => addMinor(sum, row.debitMinor), 0),
    totalCreditMinor: trialRows.reduce((sum, row) => addMinor(sum, row.creditMinor), 0),
    isBalanced: false,
  };
  trialBalance.isBalanced = trialBalance.totalDebitMinor === trialBalance.totalCreditMinor;

  const pnlAccounts = await loadAccounts(session, tenantId, bookSetId);
  await applyLines(session, pnlAccounts, tenantId, bookSetId, fromDate, toDate);
  const incomeRows = [...pnlAccounts.values()].filter((account) => account.accountType === "INCOME").map(toReportRow);
  const expenseRows = [...pnlAccounts.values()].filter((account) => account.accountType === "EXPENSE").map(toReportRow);
  const incomeMinor = incomeRows.reduce((sum, row) => addMinor(sum, row.balanceMinor), 0);
  const expenseMinor = expenseRows.reduce((sum, row) => addMinor(sum, row.balanceMinor), 0);
  const profitAndLoss: ProfitAndLossReport = { fromDate, toDate, incomeMinor, expenseMinor, netProfitLossMinor: subtractMinor(incomeMinor, expenseMinor), incomeRows, expenseRows };

  const bsAccounts = await loadAccounts(session, tenantId, bookSetId);
  await applyLines(session, bsAccounts, tenantId, bookSetId, undefined, toDate);
  const assets = [...bsAccounts.values()].filter((account) => account.accountType === "ASSET").map(toReportRow);
  const liabilities = [...bsAccounts.values()].filter((account) => account.accountType === "LIABILITY").map(toReportRow);
  const equity = [...bsAccounts.values()].filter((account) => account.accountType === "EQUITY").map(toReportRow);
  const income = [...bsAccounts.values()].filter((account) => account.accountType === "INCOME").reduce((sum, account) => addMinor(sum, normalBalance(account)), 0);
  const expense = [...bsAccounts.values()].filter((account) => account.accountType === "EXPENSE").reduce((sum, account) => addMinor(sum, normalBalance(account)), 0);
  const totalAssetsMinor = assets.reduce((sum, row) => addMinor(sum, row.balanceMinor), 0);
  const totalLiabilitiesMinor = liabilities.reduce((sum, row) => addMinor(sum, row.balanceMinor), 0);
  const totalEquityMinor = equity.reduce((sum, row) => addMinor(sum, row.balanceMinor), 0);
  const currentPeriodResultMinor = subtractMinor(income, expense);
  const totalLiabilitiesAndEquityMinor = addMinor(addMinor(totalLiabilitiesMinor, totalEquityMinor), currentPeriodResultMinor);
  const balanceSheet: BalanceSheetReport = { asOfDate: toDate, assets, liabilities, equity, totalAssetsMinor, totalLiabilitiesMinor, totalEquityMinor, currentPeriodResultMinor, totalLiabilitiesAndEquityMinor, isBalanced: totalAssetsMinor === totalLiabilitiesAndEquityMinor };
  return { trialBalance, profitAndLoss, balanceSheet };
}

function normalBalance(account: AccountAccumulator): number {
  return ["LIABILITY", "EQUITY", "INCOME"].includes(account.accountType)
    ? subtractMinor(account.creditMinor, account.debitMinor)
    : subtractMinor(account.debitMinor, account.creditMinor);
}

function toReportRow(account: AccountAccumulator): LedgerReportAccountRow {
  return { ...account, balanceMinor: normalBalance(account) };
}

export class LedgerReportService {
  constructor(private readonly sessionRunner: BusinessSessionRunner) {}

  async trialBalance(tenantId: TenantId, bookSetId: BookSetId, asOfDate: string): Promise<TrialBalanceReport> {
    assertIsoDate(asOfDate, "asOfDate");
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      return (await ledgerSnapshotInSession(session, tenantId, bookSetId, asOfDate, asOfDate)).trialBalance;
    });
  }

  async profitAndLoss(tenantId: TenantId, bookSetId: BookSetId, fromDate: string, toDate: string): Promise<ProfitAndLossReport> {
    assertIsoDate(fromDate, "fromDate");
    assertIsoDate(toDate, "toDate");
    if (fromDate > toDate) throw new DomainError("INVALID_REPORT_DATE_RANGE", "fromDate must not be after toDate");
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      return (await ledgerSnapshotInSession(session, tenantId, bookSetId, fromDate, toDate)).profitAndLoss;
    });
  }

  async balanceSheet(tenantId: TenantId, bookSetId: BookSetId, asOfDate: string): Promise<BalanceSheetReport> {
    assertIsoDate(asOfDate, "asOfDate");
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      return (await ledgerSnapshotInSession(session, tenantId, bookSetId, asOfDate, asOfDate)).balanceSheet;
    });
  }
}
