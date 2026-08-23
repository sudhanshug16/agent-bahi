import { randomUUID } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { brandAccountId, DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";
import { postJournalInSession, type JournalLinePayload } from "./journal-command-service.ts";
import { prepareGstPosting, persistGstSnapshot, type GstDocumentBlock, type GstLineFact } from "./gst-service.ts";
import { prepareWithholding, persistWithholdingEvent, type WithholdingBlock } from "./tds-tcs-service.ts";
import { convertFxLines, assertNoUnreversedRevaluation, loadRate, type FxAllocationBlock, type FxDocumentBlock } from "./fx-service.ts";
import { convertForeignMinor, proportionalCarryingBase, safeNumber } from "./fx-math.ts";
import { assertPeriodOpen } from "./period-close-service.ts";

export interface BillLinePayload { description: string; expenseAccountId: string; amountMinor: number; foreignAmountMinor?: number; gst?: GstLineFact; }
export interface BillCreatePayload {
  billNumber: string;
  vendorId: string;
  billDate: string;
  dueDate?: string;
  narration?: string;
  lines: BillLinePayload[];
  gst?: GstDocumentBlock;
  fx?: FxDocumentBlock;
}
export interface BillCreateResult { billId: string; billNumber: string; totalMinor: number; status: "DRAFT"; }
export interface BillPostPayload { billId: string; payableAccountId: string; gst?: GstDocumentBlock; withholding?: WithholdingBlock; }
export interface BillPostResult { billId: string; journalId: string; totalMinor: number; status: "POSTED" | "PARTIALLY_PAID" | "PAID"; }
export interface VendorPaymentAllocationPayload { billId: string; amountMinor: number; fx?: FxAllocationBlock; }
export interface VendorPaymentRecordPayload {
  vendorId: string;
  paymentDate: string;
  bankAccountId: string;
  reference?: string;
  allocations: VendorPaymentAllocationPayload[];
}
export interface VendorPaymentRecordResult { paymentId: string; journalId: string; amountMinor: number; status: "POSTED"; }
export type BillStatus = "DRAFT" | "POSTED" | "PARTIALLY_PAID" | "PAID";
export interface BillView {
  billId: string;
  billNumber: string;
  vendorId: string;
  billDate: string;
  dueDate?: string;
  narration?: string;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  status: BillStatus;
  payableAccountId?: string;
  lines: BillLinePayload[];
}

type PurchaseEnvelope<P> = CommandEnvelope<P> & { bookSetId: BookSetId };
interface StoredIdempotency { requestHash: string; resultJson: string; resultHash: string; }

function isoDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date (YYYY-MM-DD)`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date (YYYY-MM-DD)`);
}

function positiveMinor(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new DomainError("INVALID_AMOUNT", `${field} must be a positive safe integer minor amount`);
  return value;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new DomainError("INVALID_AMOUNT", "amount total exceeds safe integer range");
  return result;
}

function billSettlementStatus(totalMinor: number, paidMinor: number, withholdingMinor: number): "POSTED" | "PARTIALLY_PAID" | "PAID" {
  const settledMinor = safeAdd(paidMinor, withholdingMinor);
  if (settledMinor >= totalMinor) return "PAID";
  return settledMinor > 0 ? "PARTIALLY_PAID" : "POSTED";
}

function nonblank(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new DomainError("INVALID_FIELD", `${field} must be nonblank and bounded`);
  return value;
}

function assertEnvelope<P>(envelope: PurchaseEnvelope<P>): void {
  validateCommandEnvelope(envelope);
  if (typeof envelope.bookSetId !== "string" || envelope.bookSetId.length === 0) throw new DomainError("INVALID_BOOK_SET_ID", "bookSetId is required");
}

async function idempotency(session: BusinessSession, tenantId: TenantId, requestId: string): Promise<StoredIdempotency | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  if (!row) return undefined;
  return { requestHash: String(row.request_hash), resultJson: String(row.result_json), resultHash: String(row.result_hash) };
}

async function replayOrUndefined(session: BusinessSession, envelope: PurchaseEnvelope<unknown>, requestHash: string): Promise<CommandResult<never> | undefined> {
  const existing = await idempotency(session, envelope.tenantId, envelope.requestId);
  if (!existing) return undefined;
  if (existing.requestHash !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
  if (computeResultHash(existing.resultJson) !== existing.resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson: existing.resultJson, resultHash: existing.resultHash, replayed: true };
}

async function finishCommand<T>(session: BusinessSession, envelope: PurchaseEnvelope<unknown>, command: string, requestHash: string, result: T, entityType: string, entityId: string, now: string): Promise<CommandResult<T>> {
  const resultJson = canonicalJson(result);
  const resultHash = computeResultHash(resultJson);
  await session.execute(
    `INSERT INTO audit_records
     (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id, canonical_before_hash, canonical_after_hash, change_summary, committed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    [randomUUID(), envelope.tenantId, envelope.bookSetId, command, command, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, resultHash, JSON.stringify({ entityType, entityId }), now, now],
  );
  await session.execute(
    "INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now],
  );
  return { resultJson, resultHash };
}

async function assertBookSet(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId): Promise<void> {
  const row = await session.querySingle("SELECT id, lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?", [bookSetId, tenantId]);
  if (!row) throw new DomainError("BOOK_SET_NOT_FOUND", `BookSet not found: ${bookSetId}`);
  if (String(row.lifecycle) !== "ACTIVE") throw new DomainError("BOOK_SET_INACTIVE", "BookSet must be ACTIVE");
}

async function assertAccount(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, accountId: string, expectedType: string, field: string): Promise<void> {
  const row = await session.querySingle("SELECT id, account_type, archived_at FROM accounts WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [accountId, tenantId, bookSetId]);
  if (!row) throw new DomainError("ACCOUNT_SCOPE_MISMATCH", `${field} does not belong to tenant and BookSet`);
  if (row.archived_at !== null && row.archived_at !== undefined) throw new DomainError("ACCOUNT_ARCHIVED", `${field} is archived`);
  if (String(row.account_type) !== expectedType) throw new DomainError("INVALID_ACCOUNT_CLASS", `${field} must be ${expectedType}`);
}

async function assertBillInputAccount(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, accountId: string, field: string): Promise<void> {
  const row = await session.querySingle("SELECT id, account_type, archived_at FROM accounts WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [accountId, tenantId, bookSetId]);
  if (!row) throw new DomainError("ACCOUNT_SCOPE_MISMATCH", `${field} does not belong to tenant and BookSet`);
  if (row.archived_at !== null && row.archived_at !== undefined) throw new DomainError("ACCOUNT_ARCHIVED", `${field} is archived`);
  if (!['EXPENSE', 'ASSET'].includes(String(row.account_type))) throw new DomainError("INVALID_ACCOUNT_CLASS", `${field} must be EXPENSE or ASSET`);
}

async function assertVendor(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, vendorId: string): Promise<void> {
  const row = await session.querySingle("SELECT id, status, party_role FROM parties WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [vendorId, tenantId, bookSetId]);
  if (!row) throw new DomainError("VENDOR_SCOPE_MISMATCH", "vendor does not belong to tenant and BookSet");
  if (String(row.status) !== "ACTIVE") throw new DomainError("VENDOR_INACTIVE", "vendor must be ACTIVE");
  if (!["VENDOR", "BOTH"].includes(String(row.party_role ?? "CUSTOMER"))) throw new DomainError("PARTY_ROLE_MISMATCH", "party is not a vendor");
}

export async function executeBillCreate(sessionRunner: BusinessSessionRunner, envelope: PurchaseEnvelope<BillCreatePayload>): Promise<CommandResult<BillCreateResult>> {
  assertEnvelope(envelope);
  const billNumber = nonblank(envelope.payload.billNumber, "billNumber");
  const vendorId = nonblank(envelope.payload.vendorId, "vendorId");
  isoDate(envelope.payload.billDate, "billDate");
  if (envelope.payload.dueDate !== undefined) isoDate(envelope.payload.dueDate, "dueDate");
  if (envelope.payload.narration !== undefined) nonblank(envelope.payload.narration, "narration", 4096);
  if (!Array.isArray(envelope.payload.lines) || envelope.payload.lines.length < 1) throw new DomainError("INVALID_BILL_LINES", "bill must contain at least one line");
  let totalMinor = 0;
  for (const [index, line] of envelope.payload.lines.entries()) {
    nonblank(line?.description, `lines[${index}].description`, 2048);
    nonblank(line?.expenseAccountId, `lines[${index}].expenseAccountId`);
    totalMinor = safeAdd(totalMinor, positiveMinor(line?.amountMinor, `lines[${index}].amountMinor`));
  }
  const requestHash = computeCommandHash("bill.create", envelope, envelope.payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const replay = await replayOrUndefined(session, envelope, requestHash);
    if (replay) return replay as CommandResult<BillCreateResult>;
    await assertBookSet(session, envelope.tenantId, envelope.bookSetId);
    await assertPeriodOpen(session, envelope.tenantId, envelope.bookSetId, envelope.payload.billDate);
    await assertVendor(session, envelope.tenantId, envelope.bookSetId, vendorId);
    for (const line of envelope.payload.lines) await assertBillInputAccount(session, envelope.tenantId, envelope.bookSetId, line.expenseAccountId, "expenseAccountId");
    const fxLines = envelope.payload.fx
      ? await convertFxLines(session, envelope.tenantId, envelope.bookSetId, envelope.payload.fx, envelope.payload.lines.map((line) => line.foreignAmountMinor ?? line.amountMinor))
      : undefined;
    if (fxLines) totalMinor = fxLines.totalBaseMinor;
    const billId = randomUUID();
    const now = new Date().toISOString();
    const gstInput = envelope.payload.gst ? { ...envelope.payload.gst, lines: envelope.payload.gst.lines ?? envelope.payload.gst.lineFacts ?? envelope.payload.lines.map((line, index) => line.gst ? { ...line.gst, lineNumber: index + 1 } : undefined).filter(Boolean) as GstLineFact[] } : undefined;
    await session.execute("INSERT INTO vendor_bills (id, tenant_id, book_set_id, bill_number, vendor_id, bill_date, due_date, narration, status, total_minor, paid_minor, gst_input_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 0, ?, ?, ?)", [billId, envelope.tenantId, envelope.bookSetId, billNumber, vendorId, envelope.payload.billDate, envelope.payload.dueDate ?? null, envelope.payload.narration ?? null, totalMinor, gstInput ? JSON.stringify(gstInput) : null, now, now]);
    for (const [index, line] of envelope.payload.lines.entries()) {
      const lineId = randomUUID();
      await session.execute("INSERT INTO vendor_bill_lines (id, tenant_id, book_set_id, bill_id, line_number, description, expense_account_id, amount_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [lineId, envelope.tenantId, envelope.bookSetId, billId, index + 1, line.description, line.expenseAccountId, fxLines?.baseLines[index] ?? line.amountMinor]);
      if (fxLines) await session.execute("INSERT INTO fx_document_line_amounts (id, tenant_id, book_set_id, document_type, document_id, line_id, line_number, foreign_minor, base_minor, created_at) VALUES (?, ?, ?, 'VENDOR_BILL', ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, billId, lineId, index + 1, fxLines.foreignLines[index], fxLines.baseLines[index], now]);
    }
    if (fxLines) await session.execute("INSERT INTO fx_document_facts (id, tenant_id, book_set_id, document_type, document_id, currency_code, exponent, base_exponent, rate_snapshot_id, rounding_policy, total_foreign_minor, total_base_minor, created_at) VALUES (?, ?, ?, 'VENDOR_BILL', ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, billId, fxLines.currencyCode, fxLines.exponent, fxLines.baseExponent, fxLines.rateId, fxLines.roundingPolicy, fxLines.totalForeignMinor, fxLines.totalBaseMinor, now]);
    return finishCommand(session, envelope, "bill.create", requestHash, { billId, billNumber, totalMinor, status: "DRAFT", ...(fxLines ? { currencyCode: fxLines.currencyCode, totalForeignMinor: fxLines.totalForeignMinor } : {}) }, "vendor_bill", billId, now);
  });
}

export async function executeBillPost(sessionRunner: BusinessSessionRunner, envelope: PurchaseEnvelope<BillPostPayload>): Promise<CommandResult<BillPostResult>> {
  assertEnvelope(envelope);
  const billId = nonblank(envelope.payload.billId, "billId");
  const payableAccountId = nonblank(envelope.payload.payableAccountId, "payableAccountId");
  const requestHash = computeCommandHash("bill.post", envelope, envelope.payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const replay = await replayOrUndefined(session, envelope, requestHash);
    if (replay) return replay as CommandResult<BillPostResult>;
    await assertBookSet(session, envelope.tenantId, envelope.bookSetId);
    const bill = await session.querySingle("SELECT id, vendor_id, bill_date, narration, status, total_minor, gst_input_json FROM vendor_bills WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [billId, envelope.tenantId, envelope.bookSetId]);
    if (!bill) throw new DomainError("BILL_SCOPE_MISMATCH", "bill does not belong to tenant and BookSet");
    if (String(bill.status) !== "DRAFT") throw new DomainError("BILL_NOT_DRAFT", "only DRAFT bills can be posted");
    await assertAccount(session, envelope.tenantId, envelope.bookSetId, payableAccountId, "LIABILITY", "payableAccountId");
    const lineRows = await session.query("SELECT id, line_number, description, expense_account_id, amount_minor FROM vendor_bill_lines WHERE bill_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY line_number", [billId, envelope.tenantId, envelope.bookSetId]);
    if (lineRows.rows.length === 0) throw new DomainError("INVALID_BILL_LINES", "bill must contain at least one line");
    const gstBlock = envelope.payload.gst ?? (bill.gst_input_json == null ? undefined : JSON.parse(String(bill.gst_input_json)) as GstDocumentBlock);
    const gstPlan = gstBlock ? await prepareGstPosting(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, partyId: String(bill.vendor_id), documentDate: String(bill.bill_date), documentType: "PURCHASE", block: gstBlock, lines: lineRows.rows.map((row) => ({ id: String(row.id), lineNumber: Number(row.line_number), amountMinor: Number(row.amount_minor), description: String(row.description) })) }) : undefined;
    const lines: JournalLinePayload[] = [];
    for (const row of lineRows.rows) {
      const expenseAccountId = String(row.expense_account_id);
      await assertBillInputAccount(session, envelope.tenantId, envelope.bookSetId, expenseAccountId, "expenseAccountId");
      const lineTax = gstPlan && gstPlan.itcTreatment !== "ELIGIBLE"
        ? gstPlan.components.filter((component) => component.line.lineNumber === Number(row.line_number)).reduce((sum, component) => sum + component.taxMinor, 0)
        : 0;
      const debitMinor = Number(row.amount_minor) + lineTax;
      lines.push({ accountId: brandAccountId(expenseAccountId), description: String(row.description), debitMinor });
    }
    if (gstPlan && gstPlan.itcTreatment === "ELIGIBLE") for (const component of gstPlan.components) {
      await assertAccount(session, envelope.tenantId, envelope.bookSetId, component.accountId!, "ASSET", `${component.component} input account`);
      lines.push({ accountId: brandAccountId(component.accountId!), description: `${component.component} input GST ${component.line.lineNumber}`, debitMinor: component.taxMinor });
    }
    const billGrossMinor = gstPlan?.grossMinor ?? Number(bill.total_minor);
    const withholdingPlan = envelope.payload.withholding ? await prepareWithholding(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, documentType: "PURCHASE", documentId: billId, eventDate: String(bill.bill_date), block: envelope.payload.withholding, documentBaseMinor: lineRows.rows.reduce((sum, row) => sum + Number(row.amount_minor), 0) }) : undefined;
    if (withholdingPlan && withholdingPlan.taxAmountMinor > billGrossMinor) throw new DomainError("TAX_AMOUNT_EXCEEDS_DOCUMENT", "withholding must not exceed the bill gross amount");
    const payableMinor = billGrossMinor - (withholdingPlan?.taxAmountMinor ?? 0);
    if (payableMinor > 0) lines.push({ accountId: brandAccountId(payableAccountId), description: `Bill ${billId}`, creditMinor: payableMinor });
    if (withholdingPlan) lines.push({ accountId: brandAccountId(withholdingPlan.liabilityAccountId), description: `TDS ${billId}`, creditMinor: withholdingPlan.taxAmountMinor });
    const journalId = await postJournalInSession(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, postingDate: String(bill.bill_date), reference: billId, narration: bill.narration === null ? undefined : String(bill.narration), lines });
    const now = new Date().toISOString();
    if (gstPlan) await persistGstSnapshot(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, documentType: "PURCHASE", documentId: billId, plan: gstPlan, now });
    if (withholdingPlan) await persistWithholdingEvent(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, documentType: "PURCHASE", documentId: billId, plan: withholdingPlan, journalId, now });
    const withholdingMinor = withholdingPlan?.taxAmountMinor ?? 0;
    const status = billSettlementStatus(billGrossMinor, 0, withholdingMinor);
    await session.execute("UPDATE vendor_bills SET status = ?, total_minor = ?, withholding_minor = ?, payable_account_id = ?, posted_journal_id = ?, posted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [status, billGrossMinor, withholdingMinor, payableAccountId, journalId, now, now, billId, envelope.tenantId, envelope.bookSetId]);
    const totalMinor = billGrossMinor;
    return finishCommand(session, envelope, "bill.post", requestHash, { billId, journalId, totalMinor, status }, "vendor_bill", billId, now);
  });
}

export async function executeVendorPaymentRecord(sessionRunner: BusinessSessionRunner, envelope: PurchaseEnvelope<VendorPaymentRecordPayload>): Promise<CommandResult<VendorPaymentRecordResult>> {
  assertEnvelope(envelope);
  const vendorId = nonblank(envelope.payload.vendorId, "vendorId");
  isoDate(envelope.payload.paymentDate, "paymentDate");
  const bankAccountId = nonblank(envelope.payload.bankAccountId, "bankAccountId");
  if (envelope.payload.reference !== undefined) nonblank(envelope.payload.reference, "reference", 1024);
  if (!Array.isArray(envelope.payload.allocations) || envelope.payload.allocations.length < 1) throw new DomainError("INVALID_ALLOCATIONS", "vendor payment must contain at least one allocation");
  const seen = new Set<string>();
  let amountMinor = 0;
  for (const [index, allocation] of envelope.payload.allocations.entries()) {
    const billId = nonblank(allocation?.billId, `allocations[${index}].billId`);
    if (seen.has(billId)) throw new DomainError("DUPLICATE_ALLOCATION", "a bill may appear only once per payment");
    seen.add(billId);
    amountMinor = safeAdd(amountMinor, allocation?.fx ? positiveMinor(allocation.fx.actualBankBaseMinor, `allocations[${index}].fx.actualBankBaseMinor`) : positiveMinor(allocation?.amountMinor, `allocations[${index}].amountMinor`));
  }
  const requestHash = computeCommandHash("vendorPayment.record", envelope, envelope.payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const replay = await replayOrUndefined(session, envelope, requestHash);
    if (replay) return replay as CommandResult<VendorPaymentRecordResult>;
    await assertBookSet(session, envelope.tenantId, envelope.bookSetId);
    await assertVendor(session, envelope.tenantId, envelope.bookSetId, vendorId);
    await assertAccount(session, envelope.tenantId, envelope.bookSetId, bankAccountId, "ASSET", "bankAccountId");
    const journalLines: JournalLinePayload[] = [];
    const billUpdates: Array<{ billId: string; paidMinor: number; status: "PARTIALLY_PAID" | "PAID" }> = [];
    const carryingByBill = new Map<string, number>();
    for (const allocation of envelope.payload.allocations) {
      const bill = await session.querySingle("SELECT id, vendor_id, status, total_minor, paid_minor, withholding_minor, payable_account_id FROM vendor_bills WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [allocation.billId, envelope.tenantId, envelope.bookSetId]);
      if (!bill) throw new DomainError("BILL_SCOPE_MISMATCH", "allocated bill does not belong to tenant and BookSet");
      if (String(bill.vendor_id) !== vendorId) throw new DomainError("VENDOR_MISMATCH", "bill vendor does not match payment vendor");
      if (!["POSTED", "PARTIALLY_PAID"].includes(String(bill.status))) throw new DomainError("BILL_NOT_PAYABLE", "only posted unpaid bills can receive allocations");
      const total = Number(bill.total_minor);
      const paid = Number(bill.paid_minor);
      const withheld = Number(bill.withholding_minor ?? 0);
      const allocationMinor = allocation.fx ? positiveMinor(allocation.fx.actualBankBaseMinor, "FX actual bank amount") : positiveMinor(allocation.amountMinor, "allocation amount");
      let carryingRelief = allocationMinor;
      let realizedGainLoss = 0;
      if (allocation.fx) {
        await assertNoUnreversedRevaluation(session, envelope.tenantId, envelope.bookSetId, "VENDOR_BILL", allocation.billId);
        const fact = await session.querySingle("SELECT currency_code, exponent, base_exponent, total_foreign_minor, total_base_minor FROM fx_document_facts WHERE tenant_id = ? AND book_set_id = ? AND document_type = 'VENDOR_BILL' AND document_id = ?", [envelope.tenantId, envelope.bookSetId, allocation.billId]);
        if (!fact) throw new DomainError("FX_DOCUMENT_REQUIRED", "foreign allocation requires a foreign-currency bill");
        const foreignMinor = positiveMinor(allocation.fx.foreignAmountMinor, "foreign allocation amount");
        const priorRows = await session.query("SELECT foreign_minor FROM fx_allocation_facts WHERE tenant_id = ? AND book_set_id = ? AND document_type = 'VENDOR_BILL' AND document_id = ?", [envelope.tenantId, envelope.bookSetId, allocation.billId]);
        const priorForeign = priorRows.rows.reduce((sum, row) => sum + Number(row.foreign_minor), 0);
        const totalForeign = Number(fact.total_foreign_minor);
        if (foreignMinor > totalForeign - priorForeign) throw new DomainError("OVER_ALLOCATION", "foreign allocation exceeds bill outstanding amount");
        const rate = await loadRate(session, envelope.tenantId, envelope.bookSetId, allocation.fx.settlementRateSnapshotId, "SETTLEMENT", String(fact.currency_code));
        if (rate.exponent !== Number(fact.exponent)) throw new DomainError("CURRENCY_EXPONENT_MISMATCH", "settlement rate exponent does not match bill");
        if (rate.baseExponent !== Number(fact.base_exponent)) throw new DomainError("BASE_CURRENCY_DEFINITION_REQUIRED", "settlement rate base exponent does not match bill");
        const calculated = safeNumber(convertForeignMinor(BigInt(foreignMinor), rate.rate, "HALF_UP", rate.baseExponent, rate.exponent), "calculated bank amount");
        if (calculated !== allocation.fx.actualBankBaseMinor) throw new DomainError("FX_BANK_AMOUNT_MISMATCH", "actual bank amount does not equal the supplied settlement rate calculation");
        carryingRelief = safeNumber(proportionalCarryingBase(BigInt(String(fact.total_base_minor)), BigInt(totalForeign), BigInt(priorForeign), BigInt(foreignMinor)), "carrying relief");
        if (carryingRelief > total - paid - withheld) throw new DomainError("OVER_ALLOCATION", "FX carrying allocation exceeds bill outstanding amount");
        realizedGainLoss = carryingRelief - allocation.fx.actualBankBaseMinor;
        await assertAccount(session, envelope.tenantId, envelope.bookSetId, allocation.fx.realizedGainLossAccountId, "EXPENSE", "realizedGainLossAccountId");
      }
      if (carryingRelief > total - paid - withheld) throw new DomainError("OVER_ALLOCATION", "allocation exceeds bill outstanding amount");
      if (bill.payable_account_id === null || bill.payable_account_id === undefined) throw new DomainError("BILL_PAYABLE_MISSING", "posted bill has no payable account");
      const payableAccountId = String(bill.payable_account_id);
      await assertAccount(session, envelope.tenantId, envelope.bookSetId, payableAccountId, "LIABILITY", "bill payable account");
      journalLines.push({ accountId: brandAccountId(payableAccountId), description: `Vendor payment allocation ${allocation.billId}`, debitMinor: carryingRelief });
      if (allocation.fx && realizedGainLoss !== 0) journalLines.push({ accountId: brandAccountId(allocation.fx.realizedGainLossAccountId), description: realizedGainLoss > 0 ? "Realized FX gain" : "Realized FX loss", ...(realizedGainLoss > 0 ? { creditMinor: realizedGainLoss } : { debitMinor: -realizedGainLoss }) });
      const newPaid = paid + carryingRelief;
      carryingByBill.set(allocation.billId, carryingRelief);
      billUpdates.push({ billId: allocation.billId, paidMinor: newPaid, status: billSettlementStatus(total, newPaid, withheld) === "PAID" ? "PAID" : "PARTIALLY_PAID" });
    }
    journalLines.push({ accountId: brandAccountId(bankAccountId), description: envelope.payload.reference, creditMinor: amountMinor });
    const journalId = await postJournalInSession(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, postingDate: envelope.payload.paymentDate, reference: envelope.payload.reference, lines: journalLines });
    const paymentId = randomUUID();
    const now = new Date().toISOString();
    await session.execute("INSERT INTO vendor_payments (id, tenant_id, book_set_id, vendor_id, payment_date, bank_account_id, reference, amount_minor, journal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [paymentId, envelope.tenantId, envelope.bookSetId, vendorId, envelope.payload.paymentDate, bankAccountId, envelope.payload.reference ?? null, amountMinor, journalId, now]);
    for (const allocation of envelope.payload.allocations) {
      const allocationId = randomUUID();
      await session.execute("INSERT INTO vendor_payment_allocations (id, tenant_id, book_set_id, payment_id, bill_id, amount_minor) VALUES (?, ?, ?, ?, ?, ?)", [allocationId, envelope.tenantId, envelope.bookSetId, paymentId, allocation.billId, carryingByBill.get(allocation.billId) ?? allocation.amountMinor]);
      if (allocation.fx) {
        const fact = await session.querySingle("SELECT total_foreign_minor, total_base_minor FROM fx_document_facts WHERE tenant_id = ? AND book_set_id = ? AND document_type = 'VENDOR_BILL' AND document_id = ?", [envelope.tenantId, envelope.bookSetId, allocation.billId]);
        const priorRows = await session.query("SELECT foreign_minor FROM fx_allocation_facts WHERE tenant_id = ? AND book_set_id = ? AND document_type = 'VENDOR_BILL' AND document_id = ?", [envelope.tenantId, envelope.bookSetId, allocation.billId]);
        const priorForeign = priorRows.rows.reduce((sum, row) => sum + Number(row.foreign_minor), 0);
        const carryingBaseMinor = safeNumber(proportionalCarryingBase(BigInt(String(fact!.total_base_minor)), BigInt(String(fact!.total_foreign_minor)), BigInt(priorForeign), BigInt(allocation.fx.foreignAmountMinor)), "carrying relief");
        await session.execute("INSERT INTO fx_allocation_facts (id, tenant_id, book_set_id, allocation_type, allocation_id, document_type, document_id, foreign_minor, carrying_base_minor, actual_bank_base_minor, base_exponent, rate_snapshot_id, realized_gain_loss_minor, gain_loss_account_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, "VENDOR_PAYMENT", allocationId, "VENDOR_BILL", allocation.billId, allocation.fx.foreignAmountMinor, carryingBaseMinor, allocation.fx.actualBankBaseMinor, Number(fact!.base_exponent), allocation.fx.settlementRateSnapshotId, carryingBaseMinor - allocation.fx.actualBankBaseMinor, allocation.fx.realizedGainLossAccountId, now]);
      }
    }
    for (const update of billUpdates) await session.execute("UPDATE vendor_bills SET paid_minor = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [update.paidMinor, update.status, now, update.billId, envelope.tenantId, envelope.bookSetId]);
    return finishCommand(session, envelope, "vendorPayment.record", requestHash, { paymentId, journalId, amountMinor, status: "POSTED" }, "vendor_payment", paymentId, now);
  });
}

async function loadBill(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, billId: string): Promise<BillView> {
  const row = await session.querySingle("SELECT id, bill_number, vendor_id, bill_date, due_date, narration, status, total_minor, paid_minor, withholding_minor, payable_account_id FROM vendor_bills WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [billId, tenantId, bookSetId]);
  if (!row) throw new DomainError("BILL_SCOPE_MISMATCH", "bill does not belong to tenant and BookSet");
  const lineRows = await session.query("SELECT description, expense_account_id, amount_minor FROM vendor_bill_lines WHERE bill_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY line_number", [billId, tenantId, bookSetId]);
  const totalMinor = Number(row.total_minor);
  const paidMinor = Number(row.paid_minor);
  const withheldMinor = Number(row.withholding_minor ?? 0);
  return { billId: String(row.id), billNumber: String(row.bill_number), vendorId: String(row.vendor_id), billDate: String(row.bill_date), ...(row.due_date === null ? {} : { dueDate: String(row.due_date) }), ...(row.narration === null ? {} : { narration: String(row.narration) }), totalMinor, paidMinor, outstandingMinor: totalMinor - paidMinor - withheldMinor, status: String(row.status) as BillStatus, ...(row.payable_account_id === null ? {} : { payableAccountId: String(row.payable_account_id) }), lines: lineRows.rows.map((line) => ({ description: String(line.description), expenseAccountId: String(line.expense_account_id), amountMinor: Number(line.amount_minor) })) };
}

export async function getBill(sessionRunner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, billId: string): Promise<BillView> {
  return sessionRunner.withBusinessSession("read", async (session) => { await assertBookSet(session, tenantId, bookSetId); return loadBill(session, tenantId, bookSetId, billId); });
}

export async function listOutstandingBills(sessionRunner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId): Promise<BillView[]> {
  return sessionRunner.withBusinessSession("read", async (session) => {
    await assertBookSet(session, tenantId, bookSetId);
    const rows = await session.query("SELECT id FROM vendor_bills WHERE tenant_id = ? AND book_set_id = ? AND status <> 'DRAFT' ORDER BY bill_date, bill_number", [tenantId, bookSetId]);
    const result: BillView[] = [];
    for (const row of rows.rows) result.push(await loadBill(session, tenantId, bookSetId, String(row.id)));
    return result.filter((bill) => bill.outstandingMinor > 0);
  });
}
