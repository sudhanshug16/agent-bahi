import { randomUUID } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError, brandAccountId } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import { validateCommandEnvelope } from "./bookset-command-service.ts";
import { postJournalInSession, type JournalLinePayload } from "./journal-command-service.ts";

export interface PartyCreatePayload { displayName: string; email?: string; phone?: string; }
export interface PartyCreateResult { partyId: string; displayName: string; status: "ACTIVE"; }
export interface InvoiceLinePayload { description: string; revenueAccountId: string; amountMinor: number; }
export interface InvoiceCreatePayload {
  invoiceNumber: string;
  customerId: string;
  issueDate: string;
  dueDate?: string;
  narration?: string;
  lines: InvoiceLinePayload[];
}
export interface InvoiceCreateResult { invoiceId: string; invoiceNumber: string; totalMinor: number; status: "DRAFT"; }
export interface InvoicePostPayload { invoiceId: string; receivableAccountId: string; }
export interface InvoicePostResult { invoiceId: string; journalId: string; totalMinor: number; status: "POSTED"; }
export interface ReceiptAllocationPayload { invoiceId: string; amountMinor: number; }
export interface ReceiptRecordPayload {
  customerId: string;
  receiptDate: string;
  bankAccountId: string;
  reference?: string;
  /** Optional explicit receipt total; when supplied it must equal allocations. */
  amountMinor?: number;
  allocations: ReceiptAllocationPayload[];
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
  const row = await session.querySingle("SELECT id, status FROM parties WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [customerId, tenantId, bookSetId]);
  if (!row) throw new DomainError("CUSTOMER_SCOPE_MISMATCH", "customer does not belong to tenant and BookSet");
  if (String(row.status) !== "ACTIVE") throw new DomainError("CUSTOMER_INACTIVE", "customer must be ACTIVE");
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
    await session.execute("INSERT INTO parties (id, tenant_id, book_set_id, display_name, email, phone, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)", [partyId, envelope.tenantId, envelope.bookSetId, displayName, envelope.payload.email ?? null, envelope.payload.phone ?? null, now, now]);
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
    const invoiceId = randomUUID();
    const now = new Date().toISOString();
    await session.execute("INSERT INTO sales_invoices (id, tenant_id, book_set_id, invoice_number, customer_id, issue_date, due_date, narration, status, total_minor, paid_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 0, ?, ?)", [invoiceId, envelope.tenantId, envelope.bookSetId, invoiceNumber, customerId, envelope.payload.issueDate, envelope.payload.dueDate ?? null, envelope.payload.narration ?? null, totalMinor, now, now]);
    for (const [index, line] of envelope.payload.lines.entries()) await session.execute("INSERT INTO sales_invoice_lines (id, tenant_id, book_set_id, invoice_id, line_number, description, revenue_account_id, amount_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, invoiceId, index + 1, line.description, line.revenueAccountId, line.amountMinor]);
    return finishCommand(session, envelope, "invoice.create", requestHash, { invoiceId, invoiceNumber, totalMinor, status: "DRAFT" }, "sales_invoice", invoiceId, now);
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
    const invoice = await session.querySingle("SELECT id, customer_id, issue_date, narration, status, total_minor FROM sales_invoices WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [invoiceId, envelope.tenantId, envelope.bookSetId]);
    if (!invoice) throw new DomainError("INVOICE_SCOPE_MISMATCH", "invoice does not belong to tenant and BookSet");
    if (String(invoice.status) !== "DRAFT") throw new DomainError("INVOICE_NOT_DRAFT", "only DRAFT invoices can be posted");
    await assertAccount(session, envelope.tenantId, envelope.bookSetId, receivableAccountId, "ASSET", "receivableAccountId");
    const lineRows = await session.query("SELECT description, revenue_account_id, amount_minor FROM sales_invoice_lines WHERE invoice_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY line_number", [invoiceId, envelope.tenantId, envelope.bookSetId]);
    if (lineRows.rows.length === 0) throw new DomainError("INVALID_INVOICE_LINES", "invoice must contain at least one line");
    const lines: JournalLinePayload[] = [{ accountId: brandAccountId(receivableAccountId), description: `Invoice ${invoiceId}`, debitMinor: Number(invoice.total_minor) }];
    for (const row of lineRows.rows) {
      const revenueAccountId = String(row.revenue_account_id);
      await assertAccount(session, envelope.tenantId, envelope.bookSetId, revenueAccountId, "INCOME", "revenueAccountId");
      lines.push({ accountId: brandAccountId(revenueAccountId), description: String(row.description), creditMinor: Number(row.amount_minor) });
    }
    const journalId = await postJournalInSession(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, postingDate: String(invoice.issue_date), reference: invoiceId, narration: invoice.narration === null ? undefined : String(invoice.narration), lines });
    const now = new Date().toISOString();
    await session.execute("UPDATE sales_invoices SET status = 'POSTED', receivable_account_id = ?, posted_journal_id = ?, posted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [receivableAccountId, journalId, now, now, invoiceId, envelope.tenantId, envelope.bookSetId]);
    const totalMinor = Number(invoice.total_minor);
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
    amountMinor = safeAdd(amountMinor, positiveMinor(allocation?.amountMinor, `allocations[${index}].amountMinor`));
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
    for (const allocation of envelope.payload.allocations) {
      const invoice = await session.querySingle("SELECT id, customer_id, status, total_minor, paid_minor, receivable_account_id FROM sales_invoices WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [allocation.invoiceId, envelope.tenantId, envelope.bookSetId]);
      if (!invoice) throw new DomainError("INVOICE_SCOPE_MISMATCH", "allocated invoice does not belong to tenant and BookSet");
      if (String(invoice.customer_id) !== customerId) throw new DomainError("CUSTOMER_MISMATCH", "invoice customer does not match receipt customer");
      if (!["POSTED", "PARTIALLY_PAID"].includes(String(invoice.status))) throw new DomainError("INVOICE_NOT_RECEIVABLE", "only posted unpaid invoices can receive allocations");
      const totalMinor = Number(invoice.total_minor);
      const paidMinor = Number(invoice.paid_minor);
      const allocationMinor = positiveMinor(allocation.amountMinor, "allocation amount");
      if (allocationMinor > totalMinor - paidMinor) throw new DomainError("OVER_ALLOCATION", "allocation exceeds invoice outstanding amount");
      if (invoice.receivable_account_id === null || invoice.receivable_account_id === undefined) throw new DomainError("INVOICE_RECEIVABLE_MISSING", "posted invoice has no receivable account");
      await assertAccount(session, envelope.tenantId, envelope.bookSetId, String(invoice.receivable_account_id), "ASSET", "invoice receivable account");
      journalLines.push({ accountId: brandAccountId(String(invoice.receivable_account_id)), description: `Receipt allocation ${allocation.invoiceId}`, creditMinor: allocationMinor });
      const newPaid = paidMinor + allocationMinor;
      invoiceUpdates.push({ invoiceId: allocation.invoiceId, paidMinor: newPaid, status: newPaid === totalMinor ? "PAID" : "PARTIALLY_PAID" });
    }
    const journalId = await postJournalInSession(session, { tenantId: envelope.tenantId, bookSetId: envelope.bookSetId, postingDate: envelope.payload.receiptDate, reference: envelope.payload.reference, lines: journalLines });
    const receiptId = randomUUID();
    const now = new Date().toISOString();
    await session.execute("INSERT INTO bank_receipts (id, tenant_id, book_set_id, customer_id, receipt_date, bank_account_id, reference, amount_minor, journal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [receiptId, envelope.tenantId, envelope.bookSetId, customerId, envelope.payload.receiptDate, bankAccountId, envelope.payload.reference ?? null, amountMinor, journalId, now]);
    for (const allocation of envelope.payload.allocations) await session.execute("INSERT INTO bank_receipt_allocations (id, tenant_id, book_set_id, receipt_id, invoice_id, amount_minor) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, receiptId, allocation.invoiceId, allocation.amountMinor]);
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
