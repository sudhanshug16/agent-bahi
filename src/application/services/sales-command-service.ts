import { randomUUID } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError, brandAccountId } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";
import { postJournalInSession, type JournalLinePayload } from "./journal-command-service.ts";
import { prepareGstPosting, persistGstSnapshot, type GstDocumentBlock, type GstLineFact } from "./gst-service.ts";
import { prepareWithholding, persistWithholdingEvent, type WithholdingBlock } from "./tds-tcs-service.ts";
import { convertFxLines, assertNoUnreversedRevaluation, loadRate, type FxAllocationBlock, type FxDocumentBlock } from "./fx-service.ts";
import { convertForeignMinor, proportionalCarryingBase, safeNumber } from "./fx-math.ts";

export type PartyRole = "CUSTOMER" | "VENDOR" | "BOTH";
export interface PartyCreatePayload { displayName: string; email?: string; phone?: string; role?: PartyRole; partyType?: PartyRole; }
export interface PartyCreateResult { partyId: string; displayName: string; status: "ACTIVE"; }
export interface InvoiceLinePayload { description: string; revenueAccountId: string; amountMinor: number; foreignAmountMinor?: number; gst?: GstLineFact; }
export interface InvoiceCreatePayload {
  invoiceNumber: string;
  customerId: string;
  issueDate: string;
  dueDate?: string;
  narration?: string;
  lines: InvoiceLinePayload[];
  gst?: GstDocumentBlock;
  fx?: FxDocumentBlock;
}
export interface InvoiceCreateResult { invoiceId: string; invoiceNumber: string; totalMinor: number; status: "DRAFT"; }
export interface InvoicePostPayload { invoiceId: string; receivableAccountId: string; gst?: GstDocumentBlock; withholding?: WithholdingBlock; }
export interface InvoicePostResult { invoiceId: string; journalId: string; totalMinor: number; status: "POSTED"; }
export interface ReceiptAllocationPayload { invoiceId: string; amountMinor: number; }
export interface FxReceiptAllocationPayload extends ReceiptAllocationPayload { fx?: FxAllocationBlock; }
export interface ReceiptRecordPayload {
  customerId: string;
  receiptDate: string;
  bankAccountId: string;
  reference?: string;
  /** Optional explicit receipt total; when supplied it must equal allocations. */
  amountMinor?: number;
  allocations: FxReceiptAllocationPayload[];
}
export interface ReceiptRecordResult { receiptId: string; journalId: string; amountMinor: number; status: "POSTED"; }
export type InvoiceStatus = "DRAFT" | "POSTED" | "PARTIALLY_PAID" | "PAID";
export interface InvoiceView {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  issueDate: string;
  dueDate?: string;
  narration?: string;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  status: InvoiceStatus;
  receivableAccountId?: string;
  lines: InvoiceLinePayload[];
}

type SalesEnvelope<P> = CommandEnvelope<P> & { bookSetId: BookSetId };
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

function nonblank(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new DomainError("INVALID_FIELD", `${field} must be nonblank and bounded`);
  return value;
}

async function idempotency(session: BusinessSession, tenantId: TenantId, requestId: string): Promise<StoredIdempotency | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  if (!row) return undefined;
  return { requestHash: String(row.request_hash), resultJson: String(row.result_json), resultHash: String(row.result_hash) };
}

async function finishCommand<T>(session: BusinessSession, envelope: SalesEnvelope<unknown>, command: string, requestHash: string, result: T, entityType: string, entityId: string, now: string): Promise<CommandResult<T>> {
  const resultJson = canonicalJson(result);
  const resultHash = computeResultHash(resultJson);
  await session.execute(
    `INSERT INTO audit_records
     (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id, canonical_before_hash, canonical_after_hash, change_summary, committed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    [randomUUID(), envelope.tenantId, envelope.bookSetId, command, command, envelope.actor.kind, envelope.actor.id, envelope.source, envelope.reason, envelope.requestId, resultHash, JSON.stringify({ entityType, entityId }), now, now],
  );
  await session.execute(
    `INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
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

async function assertCustomer(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, customerId: string): Promise<void> {
  const row = await session.querySingle("SELECT id, status, party_role FROM parties WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [customerId, tenantId, bookSetId]);
  if (!row) throw new DomainError("CUSTOMER_SCOPE_MISMATCH", "customer does not belong to tenant and BookSet");
  if (String(row.status) !== "ACTIVE") throw new DomainError("CUSTOMER_INACTIVE", "customer must be ACTIVE");
  if (!(["CUSTOMER", "BOTH"] as string[]).includes(String(row.party_role ?? "CUSTOMER"))) throw new DomainError("PARTY_ROLE_MISMATCH", "party is not a customer");
}

function assertEnvelope<P>(envelope: SalesEnvelope<P>, bookSetId: unknown): void {
  validateCommandEnvelope(envelope);
  if (typeof bookSetId !== "string" || bookSetId.length === 0) throw new DomainError("INVALID_BOOK_SET_ID", "bookSetId is required");
}

export async function executePartyCreate(sessionRunner: BusinessSessionRunner, envelope: SalesEnvelope<PartyCreatePayload>): Promise<CommandResult<PartyCreateResult>> {
  assertEnvelope(envelope, envelope.bookSetId);
  const displayName = nonblank(envelope.payload.displayName, "displayName", 512).trim();
  if (envelope.payload.email !== undefined) nonblank(envelope.payload.email, "email", 512);
  if (envelope.payload.phone !== undefined) nonblank(envelope.payload.phone, "phone", 128);
  const role = envelope.payload.role ?? envelope.payload.partyType ?? "CUSTOMER";
  if (!["CUSTOMER", "VENDOR", "BOTH"].includes(role)) throw new DomainError("INVALID_PARTY_ROLE", "role must be CUSTOMER, VENDOR, or BOTH");
  if (envelope.payload.role !== undefined && envelope.payload.partyType !== undefined && envelope.payload.role !== envelope.payload.partyType) throw new DomainError("INVALID_PARTY_ROLE", "role and partyType must match");
  const requestHash = computeCommandHash("party.create", envelope, envelope.payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const existing = await idempotency(session, envelope.tenantId, envelope.requestId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
      if (computeResultHash(existing.resultJson) !== existing.resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
      return { resultJson: existing.resultJson, resultHash: existing.resultHash, replayed: true };
    }
    await assertBookSet(session, envelope.tenantId, envelope.bookSetId);
    const partyId = randomUUID();
    const now = new Date().toISOString();
    await session.execute("INSERT INTO parties (id, tenant_id, book_set_id, display_name, email, phone, party_role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)", [partyId, envelope.tenantId, envelope.bookSetId, displayName, envelope.payload.email ?? null, envelope.payload.phone ?? null, role, now, now]);
    return finishCommand(session, envelope, "party.create", requestHash, { partyId, displayName, status: "ACTIVE" }, "party", partyId, now);
  });
}

export async function executeInvoiceCreate(sessionRunner: BusinessSessionRunner, envelope: SalesEnvelope<InvoiceCreatePayload>): Promise<CommandResult<InvoiceCreateResult>> {
  assertEnvelope(envelope, envelope.bookSetId);
  const invoiceNumber = nonblank(envelope.payload.invoiceNumber, "invoiceNumber");
  const customerId = nonblank(envelope.payload.customerId, "customerId");
  isoDate(envelope.payload.issueDate, "issueDate");
  if (envelope.payload.dueDate !== undefined) isoDate(envelope.payload.dueDate, "dueDate");
  if (envelope.payload.narration !== undefined) nonblank(envelope.payload.narration, "narration", 4096);
  if (!Array.isArray(envelope.payload.lines) || envelope.payload.lines.length < 1) throw new DomainError("INVALID_INVOICE_LINES", "invoice must contain at least one line");
  let totalMinor = 0;
  for (const [index, line] of envelope.payload.lines.entries()) {
    nonblank(line?.description, `lines[${index}].description`, 2048);
    nonblank(line?.revenueAccountId, `lines[${index}].revenueAccountId`);
    totalMinor = safeAdd(totalMinor, positiveMinor(line?.amountMinor, `lines[${index}].amountMinor`));
  }
  const requestHash = computeCommandHash("invoice.create", envelope, envelope.payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const existing = await idempotency(session, envelope.tenantId, envelope.requestId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
      if (computeResultHash(existing.resultJson) !== existing.resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
      return { resultJson: existing.resultJson, resultHash: existing.resultHash, replayed: true };
    }
    await assertBookSet(session, envelope.tenantId, envelope.bookSetId);
    await assertCustomer(session, envelope.tenantId, envelope.bookSetId, customerId);
    for (const line of envelope.payload.lines) await assertAccount(session, envelope.tenantId, envelope.bookSetId, line.revenueAccountId, "INCOME", "revenueAccountId");
    const fxLines = envelope.payload.fx
      ? await convertFxLines(session, envelope.tenantId, envelope.bookSetId, envelope.payload.fx, envelope.payload.lines.map((line) => line.foreignAmountMinor ?? line.amountMinor))
      : undefined;
    if (fxLines) totalMinor = fxLines.totalBaseMinor;
    const invoiceId = randomUUID();
    const now = new Date().toISOString();
    const gstInput = envelope.payload.gst ? { ...envelope.payload.gst, lines: envelope.payload.gst.lines ?? envelope.payload.gst.lineFacts ?? envelope.payload.lines.map((line, index) => line.gst ? { ...line.gst, lineNumber: index + 1 } : undefined).filter(Boolean) as GstLineFact[] } : undefined;
    await session.execute("INSERT INTO sales_invoices (id, tenant_id, book_set_id, invoice_number, customer_id, issue_date, due_date, narration, status, total_minor, paid_minor, gst_input_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 0, ?, ?, ?)", [invoiceId, envelope.tenantId, envelope.bookSetId, invoiceNumber, customerId, envelope.payload.issueDate, envelope.payload.dueDate ?? null, envelope.payload.narration ?? null, totalMinor, gstInput ? JSON.stringify(gstInput) : null, now, now]);
    for (const [index, line] of envelope.payload.lines.entries()) {
      const lineId = randomUUID();
      await session.execute("INSERT INTO sales_invoice_lines (id, tenant_id, book_set_id, invoice_id, line_number, description, revenue_account_id, amount_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [lineId, envelope.tenantId, envelope.bookSetId, invoiceId, index + 1, line.description, line.revenueAccountId, fxLines?.baseLines[index] ?? line.amountMinor]);
      if (fxLines) await session.execute("INSERT INTO fx_document_line_amounts (id, tenant_id, book_set_id, document_type, document_id, line_id, line_number, foreign_minor, base_minor, created_at) VALUES (?, ?, ?, 'SALES_INVOICE', ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, invoiceId, lineId, index + 1, fxLines.foreignLines[index], fxLines.baseLines[index], now]);
    }
    if (fxLines) await session.execute("INSERT INTO fx_document_facts (id, tenant_id, book_set_id, document_type, document_id, currency_code, exponent, base_exponent, rate_snapshot_id, rounding_policy, total_foreign_minor, total_base_minor, created_at) VALUES (?, ?, ?, 'SALES_INVOICE', ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, invoiceId, fxLines.currencyCode, fxLines.exponent, fxLines.baseExponent, fxLines.rateId, fxLines.roundingPolicy, fxLines.totalForeignMinor, fxLines.totalBaseMinor, now]);
    return finishCommand(session, envelope, "invoice.create", requestHash, { invoiceId, invoiceNumber, totalMinor, status: "DRAFT", ...(fxLines ? { currencyCode: fxLines.currencyCode, totalForeignMinor: fxLines.totalForeignMinor } : {}) }, "sales_invoice", invoiceId, now);
  });
}

export async function executeInvoicePost(sessionRunner: BusinessSessionRunner, envelope: SalesEnvelope<InvoicePostPayload>): Promise<CommandResult<InvoicePostResult>> {
  assertEnvelope(envelope, envelope.bookSetId);
  const invoiceId = nonblank(envelope.payload.invoiceId, "invoiceId");
  const receivableAccountId = nonblank(envelope.payload.receivableAccountId, "receivableAccountId");
  const requestHash = computeCommandHash("invoice.post", envelope, envelope.payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const existing = await idempotency(session, envelope.tenantId, envelope.requestId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
      if (computeResultHash(existing.resultJson) !== existing.resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
      return { resultJson: existing.resultJson, resultHash: existing.resultHash, replayed: true };
    }
    await assertBookSet(session, envelope.tenantId, envelope.bookSetId);
    const invoice = await session.querySingle("SELECT id, customer_id, issue_date, narration, status, total_minor, gst_input_json FROM sales_invoices WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [invoiceId, envelope.tenantId, envelope.bookSetId]);
    if (!invoice) throw new DomainError("INVOICE_SCOPE_MISMATCH", "invoice does not belong to tenant and BookSet");
    if (String(invoice.status) !== "DRAFT") throw new DomainError("INVOICE_NOT_DRAFT", "only DRAFT invoices can be posted");
    await assertAccount(session, envelope.tenantId, envelope.bookSetId, receivableAccountId, "ASSET", "receivableAccountId");
    const lineRows = await session.query("SELECT id, line_number, description, revenue_account_id, amount_minor FROM sales_invoice_lines WHERE invoice_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY line_number", [invoiceId, envelope.tenantId, envelope.bookSetId]);
    if (lineRows.rows.length === 0) throw new DomainError("INVALID_INVOICE_LINES", "invoice must contain at least one line");
    const gstBlock = envelope.payload.gst ?? (invoice.gst_input_json == null ? undefined : JSON.parse(String(invoice.gst_input_json)) as GstDocumentBlock);
    const gstPlan = gstBlock ? await prepareGstPosting(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, partyId: String(invoice.customer_id), documentDate: String(invoice.issue_date), documentType: "SALE", block: gstBlock, lines: lineRows.rows.map((row) => ({ id: String(row.id), lineNumber: Number(row.line_number), amountMinor: Number(row.amount_minor), description: String(row.description) })) }) : undefined;
    const invoiceGrossMinor = gstPlan?.grossMinor ?? Number(invoice.total_minor);
    const withholdingPlan = envelope.payload.withholding ? await prepareWithholding(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, documentType: "SALE", documentId: invoiceId, eventDate: String(invoice.issue_date), block: envelope.payload.withholding, documentBaseMinor: lineRows.rows.reduce((sum, row) => sum + Number(row.amount_minor), 0) }) : undefined;
    const invoiceTotalMinor = invoiceGrossMinor + (withholdingPlan?.taxAmountMinor ?? 0);
    const lines: JournalLinePayload[] = [{ accountId: brandAccountId(receivableAccountId), description: `Invoice ${invoiceId}`, debitMinor: invoiceTotalMinor }];
    for (const row of lineRows.rows) {
      const revenueAccountId = String(row.revenue_account_id);
      await assertAccount(session, envelope.tenantId, envelope.bookSetId, revenueAccountId, "INCOME", "revenueAccountId");
      lines.push({ accountId: brandAccountId(revenueAccountId), description: String(row.description), creditMinor: Number(row.amount_minor) });
    }
    if (gstPlan) for (const component of gstPlan.components) {
      await assertAccount(session, envelope.tenantId, envelope.bookSetId, component.accountId!, "LIABILITY", `${component.component} output account`);
      lines.push({ accountId: brandAccountId(component.accountId!), description: `${component.component} GST ${component.line.lineNumber}`, creditMinor: component.taxMinor });
    }
    if (withholdingPlan) lines.push({ accountId: brandAccountId(withholdingPlan.liabilityAccountId), description: `TCS ${invoiceId}`, creditMinor: withholdingPlan.taxAmountMinor });
    const journalId = await postJournalInSession(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, postingDate: String(invoice.issue_date), reference: invoiceId, narration: invoice.narration === null ? undefined : String(invoice.narration), lines });
    const now = new Date().toISOString();
    if (gstPlan) await persistGstSnapshot(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, documentType: "SALE", documentId: invoiceId, plan: gstPlan, now });
    if (withholdingPlan) await persistWithholdingEvent(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, documentType: "SALE", documentId: invoiceId, plan: withholdingPlan, journalId, now });
    await session.execute("UPDATE sales_invoices SET status = 'POSTED', total_minor = ?, receivable_account_id = ?, posted_journal_id = ?, posted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [invoiceTotalMinor, receivableAccountId, journalId, now, now, invoiceId, envelope.tenantId, envelope.bookSetId]);
    const totalMinor = invoiceTotalMinor;
    return finishCommand(session, envelope, "invoice.post", requestHash, { invoiceId, journalId, totalMinor, status: "POSTED" }, "sales_invoice", invoiceId, now);
  });
}

export async function executeReceiptRecord(sessionRunner: BusinessSessionRunner, envelope: SalesEnvelope<ReceiptRecordPayload>): Promise<CommandResult<ReceiptRecordResult>> {
  assertEnvelope(envelope, envelope.bookSetId);
  const customerId = nonblank(envelope.payload.customerId, "customerId");
  isoDate(envelope.payload.receiptDate, "receiptDate");
  const bankAccountId = nonblank(envelope.payload.bankAccountId, "bankAccountId");
  if (envelope.payload.reference !== undefined) nonblank(envelope.payload.reference, "reference", 1024);
  if (!Array.isArray(envelope.payload.allocations) || envelope.payload.allocations.length < 1) throw new DomainError("INVALID_ALLOCATIONS", "receipt must contain at least one allocation");
  const seen = new Set<string>();
  let amountMinor = 0;
  for (const [index, allocation] of envelope.payload.allocations.entries()) {
    const invoiceId = nonblank(allocation?.invoiceId, `allocations[${index}].invoiceId`);
    if (seen.has(invoiceId)) throw new DomainError("DUPLICATE_ALLOCATION", "an invoice may appear only once per receipt");
    seen.add(invoiceId);
    amountMinor = safeAdd(amountMinor, allocation?.fx ? positiveMinor(allocation.fx.actualBankBaseMinor, `allocations[${index}].fx.actualBankBaseMinor`) : positiveMinor(allocation?.amountMinor, `allocations[${index}].amountMinor`));
  }
  if (envelope.payload.amountMinor !== undefined && positiveMinor(envelope.payload.amountMinor, "amountMinor") !== amountMinor) {
    throw new DomainError("RECEIPT_TOTAL_MISMATCH", "receipt amount must equal allocation total");
  }
  const requestHash = computeCommandHash("receipt.record", envelope, envelope.payload);
  return sessionRunner.withBusinessSession("write", async (session) => {
    const existing = await idempotency(session, envelope.tenantId, envelope.requestId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
      if (computeResultHash(existing.resultJson) !== existing.resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
      return { resultJson: existing.resultJson, resultHash: existing.resultHash, replayed: true };
    }
    await assertBookSet(session, envelope.tenantId, envelope.bookSetId);
    await assertCustomer(session, envelope.tenantId, envelope.bookSetId, customerId);
    await assertAccount(session, envelope.tenantId, envelope.bookSetId, bankAccountId, "ASSET", "bankAccountId");
    const journalLines: JournalLinePayload[] = [{ accountId: brandAccountId(bankAccountId), description: envelope.payload.reference, debitMinor: amountMinor }];
    const invoiceUpdates: Array<{ invoiceId: string; paidMinor: number; status: "PARTIALLY_PAID" | "PAID" }> = [];
    const carryingByInvoice = new Map<string, number>();
    for (const allocation of envelope.payload.allocations) {
      const invoice = await session.querySingle("SELECT id, customer_id, status, total_minor, paid_minor, receivable_account_id FROM sales_invoices WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [allocation.invoiceId, envelope.tenantId, envelope.bookSetId]);
      if (!invoice) throw new DomainError("INVOICE_SCOPE_MISMATCH", "allocated invoice does not belong to tenant and BookSet");
      if (String(invoice.customer_id) !== customerId) throw new DomainError("CUSTOMER_MISMATCH", "invoice customer does not match receipt customer");
      if (!["POSTED", "PARTIALLY_PAID"].includes(String(invoice.status))) throw new DomainError("INVOICE_NOT_RECEIVABLE", "only posted unpaid invoices can receive allocations");
      const totalMinor = Number(invoice.total_minor);
      const paidMinor = Number(invoice.paid_minor);
      const allocationMinor = allocation.fx ? positiveMinor(allocation.fx.actualBankBaseMinor, "FX actual bank amount") : positiveMinor(allocation.amountMinor, "allocation amount");
      let carryingRelief = allocationMinor;
      let realizedGainLoss = 0;
      if (allocation.fx) {
        await assertNoUnreversedRevaluation(session, envelope.tenantId, envelope.bookSetId, "SALES_INVOICE", allocation.invoiceId);
        const fact = await session.querySingle("SELECT currency_code, exponent, base_exponent, total_foreign_minor, total_base_minor FROM fx_document_facts WHERE tenant_id = ? AND book_set_id = ? AND document_type = 'SALES_INVOICE' AND document_id = ?", [envelope.tenantId, envelope.bookSetId, allocation.invoiceId]);
        if (!fact) throw new DomainError("FX_DOCUMENT_REQUIRED", "foreign allocation requires a foreign-currency invoice");
        const foreignMinor = positiveMinor(allocation.fx.foreignAmountMinor, "foreign allocation amount");
        const priorRows = await session.query("SELECT foreign_minor, carrying_base_minor FROM fx_allocation_facts WHERE tenant_id = ? AND book_set_id = ? AND document_type = 'SALES_INVOICE' AND document_id = ?", [envelope.tenantId, envelope.bookSetId, allocation.invoiceId]);
        const priorForeign = priorRows.rows.reduce((sum, row) => sum + Number(row.foreign_minor), 0);
        const totalForeign = Number(fact.total_foreign_minor);
        if (foreignMinor > totalForeign - priorForeign) throw new DomainError("OVER_ALLOCATION", "foreign allocation exceeds invoice outstanding amount");
        const rate = await loadRate(session, envelope.tenantId, envelope.bookSetId, allocation.fx.settlementRateSnapshotId, "SETTLEMENT", String(fact.currency_code));
        if (rate.exponent !== Number(fact.exponent)) throw new DomainError("CURRENCY_EXPONENT_MISMATCH", "settlement rate exponent does not match invoice");
        if (rate.baseExponent !== Number(fact.base_exponent)) throw new DomainError("BASE_CURRENCY_DEFINITION_REQUIRED", "settlement rate base exponent does not match invoice");
        const calculated = safeNumber(convertForeignMinor(BigInt(foreignMinor), rate.rate, "HALF_UP", rate.baseExponent, rate.exponent), "calculated bank amount");
        if (calculated !== allocation.fx.actualBankBaseMinor) throw new DomainError("FX_BANK_AMOUNT_MISMATCH", "actual bank amount does not equal the supplied settlement rate calculation");
        carryingRelief = safeNumber(proportionalCarryingBase(BigInt(String(fact.total_base_minor)), BigInt(totalForeign), BigInt(priorForeign), BigInt(foreignMinor)), "carrying relief");
        if (carryingRelief > totalMinor - paidMinor) throw new DomainError("OVER_ALLOCATION", "FX carrying allocation exceeds invoice outstanding amount");
        realizedGainLoss = allocation.fx.actualBankBaseMinor - carryingRelief;
        await assertAccount(session, envelope.tenantId, envelope.bookSetId, allocation.fx.realizedGainLossAccountId, "EXPENSE", "realizedGainLossAccountId");
      }
      if (carryingRelief > totalMinor - paidMinor) throw new DomainError("OVER_ALLOCATION", "allocation exceeds invoice outstanding amount");
      if (invoice.receivable_account_id === null || invoice.receivable_account_id === undefined) throw new DomainError("INVOICE_RECEIVABLE_MISSING", "posted invoice has no receivable account");
      await assertAccount(session, envelope.tenantId, envelope.bookSetId, String(invoice.receivable_account_id), "ASSET", "invoice receivable account");
      journalLines.push({ accountId: brandAccountId(String(invoice.receivable_account_id)), description: `Receipt allocation ${allocation.invoiceId}`, creditMinor: carryingRelief });
      if (allocation.fx && realizedGainLoss !== 0) journalLines.push({ accountId: brandAccountId(allocation.fx.realizedGainLossAccountId), description: realizedGainLoss > 0 ? "Realized FX gain" : "Realized FX loss", ...(realizedGainLoss > 0 ? { creditMinor: realizedGainLoss } : { debitMinor: -realizedGainLoss }) });
      const newPaid = paidMinor + carryingRelief;
      carryingByInvoice.set(allocation.invoiceId, carryingRelief);
      invoiceUpdates.push({ invoiceId: allocation.invoiceId, paidMinor: newPaid, status: newPaid === totalMinor ? "PAID" : "PARTIALLY_PAID" });
    }
    const journalId = await postJournalInSession(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, postingDate: envelope.payload.receiptDate, reference: envelope.payload.reference, lines: journalLines });
    const receiptId = randomUUID();
    const now = new Date().toISOString();
    await session.execute("INSERT INTO bank_receipts (id, tenant_id, book_set_id, customer_id, receipt_date, bank_account_id, reference, amount_minor, journal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [receiptId, envelope.tenantId, envelope.bookSetId, customerId, envelope.payload.receiptDate, bankAccountId, envelope.payload.reference ?? null, amountMinor, journalId, now]);
    for (const allocation of envelope.payload.allocations) {
      const allocationId = randomUUID();
      await session.execute("INSERT INTO bank_receipt_allocations (id, tenant_id, book_set_id, receipt_id, invoice_id, amount_minor) VALUES (?, ?, ?, ?, ?, ?)", [allocationId, envelope.tenantId, envelope.bookSetId, receiptId, allocation.invoiceId, carryingByInvoice.get(allocation.invoiceId) ?? allocation.amountMinor]);
      if (allocation.fx) {
        const carrying = await session.querySingle("SELECT carrying_base_minor, realized_gain_loss_minor FROM fx_allocation_facts WHERE tenant_id = ? AND book_set_id = ? AND allocation_id = ?", [envelope.tenantId, envelope.bookSetId, allocationId]);
        if (!carrying) {
          const fact = await session.querySingle("SELECT total_foreign_minor, total_base_minor, currency_code, base_exponent FROM fx_document_facts WHERE tenant_id = ? AND book_set_id = ? AND document_type = 'SALES_INVOICE' AND document_id = ?", [envelope.tenantId, envelope.bookSetId, allocation.invoiceId]);
          const priorRows = await session.query("SELECT foreign_minor FROM fx_allocation_facts WHERE tenant_id = ? AND book_set_id = ? AND document_type = 'SALES_INVOICE' AND document_id = ?", [envelope.tenantId, envelope.bookSetId, allocation.invoiceId]);
          const priorForeign = priorRows.rows.reduce((sum, row) => sum + Number(row.foreign_minor), 0);
          const carryingBaseMinor = safeNumber(proportionalCarryingBase(BigInt(String(fact!.total_base_minor)), BigInt(String(fact!.total_foreign_minor)), BigInt(priorForeign), BigInt(allocation.fx.foreignAmountMinor)), "carrying relief");
          await session.execute("INSERT INTO fx_allocation_facts (id, tenant_id, book_set_id, allocation_type, allocation_id, document_type, document_id, foreign_minor, carrying_base_minor, actual_bank_base_minor, base_exponent, rate_snapshot_id, realized_gain_loss_minor, gain_loss_account_id, created_at) VALUES (?, ?, ?, 'RECEIPT', ?, 'SALES_INVOICE', ?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, allocationId, allocation.invoiceId, allocation.fx.foreignAmountMinor, carryingBaseMinor, allocation.fx.actualBankBaseMinor, Number(fact!.base_exponent), allocation.fx.settlementRateSnapshotId, allocation.fx.actualBankBaseMinor - carryingBaseMinor, allocation.fx.realizedGainLossAccountId, now]);
        }
      }
    }
    for (const update of invoiceUpdates) await session.execute("UPDATE sales_invoices SET paid_minor = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [update.paidMinor, update.status, now, update.invoiceId, envelope.tenantId, envelope.bookSetId]);
    return finishCommand(session, envelope, "receipt.record", requestHash, { receiptId, journalId, amountMinor, status: "POSTED" }, "bank_receipt", receiptId, now);
  });
}

async function loadInvoice(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, invoiceId: string): Promise<InvoiceView> {
  const row = await session.querySingle("SELECT id, invoice_number, customer_id, issue_date, due_date, narration, status, total_minor, paid_minor, receivable_account_id FROM sales_invoices WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [invoiceId, tenantId, bookSetId]);
  if (!row) throw new DomainError("INVOICE_SCOPE_MISMATCH", "invoice does not belong to tenant and BookSet");
  const lineRows = await session.query("SELECT description, revenue_account_id, amount_minor FROM sales_invoice_lines WHERE invoice_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY line_number", [invoiceId, tenantId, bookSetId]);
  const totalMinor = Number(row.total_minor);
  const paidMinor = Number(row.paid_minor);
  return { invoiceId: String(row.id), invoiceNumber: String(row.invoice_number), customerId: String(row.customer_id), issueDate: String(row.issue_date), ...(row.due_date === null ? {} : { dueDate: String(row.due_date) }), ...(row.narration === null ? {} : { narration: String(row.narration) }), totalMinor, paidMinor, outstandingMinor: totalMinor - paidMinor, status: String(row.status) as InvoiceStatus, ...(row.receivable_account_id === null ? {} : { receivableAccountId: String(row.receivable_account_id) }), lines: lineRows.rows.map((line) => ({ description: String(line.description), revenueAccountId: String(line.revenue_account_id), amountMinor: Number(line.amount_minor) })) };
}

export async function getInvoice(sessionRunner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, invoiceId: string): Promise<InvoiceView> {
  return sessionRunner.withBusinessSession("read", async (session) => { await assertBookSet(session, tenantId, bookSetId); return loadInvoice(session, tenantId, bookSetId, invoiceId); });
}

export async function listOutstandingInvoices(sessionRunner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId): Promise<InvoiceView[]> {
  return sessionRunner.withBusinessSession("read", async (session) => {
    await assertBookSet(session, tenantId, bookSetId);
    const rows = await session.query("SELECT id FROM sales_invoices WHERE tenant_id = ? AND book_set_id = ? AND status = 'POSTED' OR tenant_id = ? AND book_set_id = ? AND status = 'PARTIALLY_PAID' ORDER BY issue_date, invoice_number", [tenantId, bookSetId, tenantId, bookSetId]);
    const result: InvoiceView[] = [];
    for (const row of rows.rows) result.push(await loadInvoice(session, tenantId, bookSetId, String(row.id)));
    return result.filter((invoice) => invoice.outstandingMinor > 0);
  });
}
