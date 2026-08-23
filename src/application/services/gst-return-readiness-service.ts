import { randomUUID, createHash } from "node:crypto";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";

export type DocumentClassification = "GOODS" | "SERVICES";
export type ReturnForm = "GSTR1" | "GSTR2" | "GSTR3B";
export type ReadinessStatus = "READY" | "REVIEW_REQUIRED" | "BLOCKED";
export type ObservationType = "USER_MARKED_PORTAL_UPLOADED" | "PORTAL_ERROR" | "PORTAL_PROCESSED" | "USER_MARKED_SUBMITTED" | "ACKNOWLEDGED" | "REJECTED";

export interface GstOutwardFactsPayload {
  invoiceId: string;
  placeOfSupplyStateCode?: string;
  recipientRegistrationCategory?: "REGISTERED" | "UNREGISTERED" | "CONSUMER" | "COMPOSITION" | "EXEMPT";
  recipientCategorySnapshot?: string;
  reverseChargeApplicable?: boolean;
  ecommerceGstin?: string;
  narration?: string;
  lineItems?: Array<{
    invoiceLineId: string;
    classification?: DocumentClassification;
    hsnSacCode?: string;
    quantityDecimal?: string;
    unitOfMeasureCode?: string;
  }>;
}

export interface GstOutwardFactsView {
  id: string;
  tenantId: string;
  bookSetId: string;
  invoiceId: string;
  createdAt: string;
  placeOfSupplyStateCode?: string;
  recipientRegistrationCategory?: string;
  recipientCategorySnapshot?: string;
  reverseChargeApplicable: boolean;
  ecommerceGstin?: string;
  narration?: string;
  lineItems: Array<{
    id: string;
    invoiceLineId: string;
    lineNumber: number;
    classification?: DocumentClassification;
    hsnSacCode?: string;
    quantityDecimal?: string;
    unitOfMeasureCode?: string;
  }>;
}

export interface GstReturnPreparePayload {
  registrationId: string;
  returnForm: ReturnForm;
  taxPeriodFrom: string;
  taxPeriodTo: string;
}

export interface GstReturnPrepareResult {
  returnId: string;
  snapshotId: string;
  snapshotVersion: number;
  invoiceCount: number;
}

export interface GstReturnValidateResult {
  snapshotId: string;
  readinessStatus: ReadinessStatus;
  issueCount: number;
  issues: Array<{
    code: string;
    invoiceId?: string;
    severity: "ERROR" | "WARNING" | "INFO";
    message: string;
    location?: string;
  }>;
}

export interface GstReturnExportPackPayload {
  validationId: string;
}

export interface GstReturnExportPackResult {
  exportId: string;
  validationId: string;
  manifestHash: string;
  portalJsonStatus: "SCHEMA_UNPINNED" | "NOT_GENERATED";
}

export interface GstReturnObservationPayload {
  returnId: string;
  observationType: ObservationType;
  externalReference?: string;
  evidenceId?: string;
  narration?: string;
}

export type GstEnvelope<P> = CommandEnvelope<P> & { bookSetId?: BookSetId };

function nonblank(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new DomainError("INVALID_FIELD", `${field} must be nonblank and bounded`);
  return value.trim();
}

function isoDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00.000Z`).valueOf()) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new DomainError("INVALID_DATE", `${field} must be a valid ISO date`);
}

function stateCode(value: unknown, field: string): string {
  const normalized = nonblank(value, field, 2);
  if (!/^\d{2}$/.test(normalized)) throw new DomainError("INVALID_STATE_CODE", `${field} must be a two digit GST state code`);
  return normalized;
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function escapeCsv(value: string | number | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function scopeBookSet(session: BusinessSession, tenantId: string, bookSetId: string): Promise<void> {
  const row = await session.querySingle("SELECT id, lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?", [bookSetId, tenantId]);
  if (!row) throw new DomainError("BOOK_SET_NOT_FOUND", "BookSet does not belong to tenant and BookSet scope");
  if (String(row.lifecycle) !== "ACTIVE") throw new DomainError("BOOK_SET_INACTIVE", "BookSet must be ACTIVE");
}

async function loadOutwardFacts(session: BusinessSession, tenantId: string, bookSetId: string, factsId: string): Promise<GstOutwardFactsView | null> {
  const row = await session.querySingle(
    "SELECT id, tenant_id, book_set_id, invoice_id, created_at, place_of_supply_state_code, recipient_registration_category, recipient_category_snapshot, reverse_charge_applicable, ecommerce_gstin, narration FROM gst_outward_facts WHERE id = ? AND tenant_id = ? AND book_set_id = ?",
    [factsId, tenantId, bookSetId]
  );
  if (!row) return null;

  const lines = await session.query(
    "SELECT id, invoice_line_id, line_number, classification, hsn_sac_code, quantity_decimal, unit_of_measure_code FROM gst_outward_line_facts WHERE outward_facts_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY line_number",
    [factsId, tenantId, bookSetId]
  );

  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    bookSetId: String(row.book_set_id),
    invoiceId: String(row.invoice_id),
    createdAt: String(row.created_at),
    placeOfSupplyStateCode: row.place_of_supply_state_code ? String(row.place_of_supply_state_code) : undefined,
    recipientRegistrationCategory: row.recipient_registration_category ? String(row.recipient_registration_category) : undefined,
    recipientCategorySnapshot: row.recipient_category_snapshot ? String(row.recipient_category_snapshot) : undefined,
    reverseChargeApplicable: Number(row.reverse_charge_applicable) === 1,
    ecommerceGstin: row.ecommerce_gstin ? String(row.ecommerce_gstin) : undefined,
    narration: row.narration ? String(row.narration) : undefined,
    lineItems: lines.rows.map(l => ({
      id: String(l.id),
      invoiceLineId: String(l.invoice_line_id),
      lineNumber: Number(l.line_number),
      classification: l.classification ? (String(l.classification) as DocumentClassification) : undefined,
      hsnSacCode: l.hsn_sac_code ? String(l.hsn_sac_code) : undefined,
      quantityDecimal: l.quantity_decimal ? String(l.quantity_decimal) : undefined,
      unitOfMeasureCode: l.unit_of_measure_code ? String(l.unit_of_measure_code) : undefined,
    }))
  };
}

async function replay<T>(session: BusinessSession, tenantId: string, requestId: string, requestHash: string): Promise<CommandResult<T> | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  if (!row) return undefined;
  if (String(row.request_hash) !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
  const resultJson = String(row.result_json); const resultHash = String(row.result_hash);
  if (computeResultHash(resultJson) !== resultHash) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson, resultHash, replayed: true };
}

async function finish<T>(session: BusinessSession, command: string, envelopeValue: GstEnvelope<unknown>, requestHash: string, result: T, entityType: string, entityId: string): Promise<CommandResult<T>> {
  const resultJson = canonicalJson(result); const resultHash = computeResultHash(resultJson); const now = new Date().toISOString();
  await session.execute("INSERT INTO audit_records (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id, canonical_before_hash, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)", [randomUUID(), envelopeValue.tenantId, envelopeValue.bookSetId ?? null, command, command, envelopeValue.actor.kind, envelopeValue.actor.id, envelopeValue.source, envelopeValue.reason, envelopeValue.requestId, resultHash, JSON.stringify({ entityType, entityId, result }), now, now]);
  await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelopeValue.tenantId, envelopeValue.requestId, requestHash, resultJson, resultHash, now]);
  return { resultJson, resultHash };
}

export async function recordOutwardFacts(runner: BusinessSessionRunner, e: GstEnvelope<GstOutwardFactsPayload>): Promise<CommandResult<{ factsId: string; invoiceId: string }>> {
  if (!e.bookSetId) throw new DomainError("INVALID_COMMAND", "bookSetId is required");
  const p = e.payload;
  const hash = computeCommandHash("gst.outward-facts.record", e, p);

  return runner.withBusinessSession("write", async (s) => {
    const prior = await replay(s, e.tenantId, e.requestId, hash);
    if (prior) return prior as CommandResult<{ factsId: string; invoiceId: string }>;

    await scopeBookSet(s, e.tenantId, e.bookSetId);

    const invoiceRow = await s.querySingle("SELECT id, status FROM sales_invoices WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [p.invoiceId, e.tenantId, e.bookSetId]);
    if (!invoiceRow) throw new DomainError("INVOICE_NOT_FOUND", "invoice does not belong to tenant and BookSet");
    if (String(invoiceRow.status) !== "POSTED") throw new DomainError("INVOICE_NOT_POSTED", "only posted invoices can have GST facts");

    const existing = await s.querySingle("SELECT id FROM gst_outward_facts WHERE invoice_id = ? AND tenant_id = ? AND book_set_id = ?", [p.invoiceId, e.tenantId, e.bookSetId]);
    if (existing) throw new DomainError("FACTS_ALREADY_RECORDED", "GST facts already recorded for this invoice");

    if (p.placeOfSupplyStateCode) stateCode(p.placeOfSupplyStateCode, "placeOfSupplyStateCode");
    if (p.ecommerceGstin && p.ecommerceGstin.length !== 15) throw new DomainError("INVALID_GSTIN", "ecommerceGstin must be 15 characters");

    const factsId = randomUUID();
    const now = new Date().toISOString();

    await s.execute(
      "INSERT INTO gst_outward_facts (id, tenant_id, book_set_id, invoice_id, created_at, place_of_supply_state_code, recipient_registration_category, recipient_category_snapshot, reverse_charge_applicable, ecommerce_gstin, narration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [factsId, e.tenantId, e.bookSetId, p.invoiceId, now, p.placeOfSupplyStateCode ?? null, p.recipientRegistrationCategory ?? null, p.recipientCategorySnapshot ?? null, p.reverseChargeApplicable ? 1 : 0, p.ecommerceGstin ?? null, p.narration ?? null]
    );

    if (p.lineItems && p.lineItems.length > 0) {
      for (const item of p.lineItems) {
        const lineRow = await s.querySingle("SELECT id, line_number FROM sales_invoice_lines WHERE id = ? AND invoice_id = ? AND tenant_id = ? AND book_set_id = ?", [item.invoiceLineId, p.invoiceId, e.tenantId, e.bookSetId]);
        if (!lineRow) throw new DomainError("LINE_NOT_FOUND", `invoice line ${item.invoiceLineId} not found`);

        await s.execute(
          "INSERT INTO gst_outward_line_facts (id, tenant_id, book_set_id, outward_facts_id, invoice_line_id, line_number, classification, hsn_sac_code, quantity_decimal, unit_of_measure_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [randomUUID(), e.tenantId, e.bookSetId, factsId, item.invoiceLineId, lineRow.line_number, item.classification ?? null, item.hsnSacCode ?? null, item.quantityDecimal ?? null, item.unitOfMeasureCode ?? null, now]
        );
      }
    }

    return finish(s, "gst.outward-facts.record", e, hash, { factsId, invoiceId: p.invoiceId }, "gst_outward_facts", factsId);
  });
}

export async function getOutwardFacts(runner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, factsId: string): Promise<GstOutwardFactsView> {
  return runner.withBusinessSession("read", async (s) => {
    const facts = await loadOutwardFacts(s, tenantId, bookSetId, factsId);
    if (!facts) throw new DomainError("FACTS_NOT_FOUND", "GST outward facts not found");
    return facts;
  });
}

export async function listOutwardFacts(runner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId): Promise<GstOutwardFactsView[]> {
  return runner.withBusinessSession("read", async (s) => {
    const rows = await s.query("SELECT id FROM gst_outward_facts WHERE tenant_id = ? AND book_set_id = ? ORDER BY created_at, id", [tenantId, bookSetId]);
    const results: GstOutwardFactsView[] = [];
    for (const row of rows.rows) {
      const facts = await loadOutwardFacts(s, tenantId, bookSetId, String(row.id));
      if (facts) results.push(facts);
    }
    return results;
  });
}

export async function prepareReturn(runner: BusinessSessionRunner, e: GstEnvelope<GstReturnPreparePayload>): Promise<CommandResult<GstReturnPrepareResult>> {
  if (!e.bookSetId) throw new DomainError("INVALID_COMMAND", "bookSetId is required");
  const p = e.payload;
  const hash = computeCommandHash("gst.return.prepare", e, p);

  return runner.withBusinessSession("write", async (s) => {
    const prior = await replay(s, e.tenantId, e.requestId, hash);
    if (prior) return prior as CommandResult<GstReturnPrepareResult>;

    await scopeBookSet(s, e.tenantId, e.bookSetId);

    isoDate(p.taxPeriodFrom, "taxPeriodFrom");
    isoDate(p.taxPeriodTo, "taxPeriodTo");
    if (p.taxPeriodFrom > p.taxPeriodTo) throw new DomainError("INVALID_PERIOD", "taxPeriodFrom must be <= taxPeriodTo");

    const regRow = await s.querySingle("SELECT id, gstin, status FROM gst_registrations WHERE id = ? AND tenant_id = ?", [p.registrationId, e.tenantId]);
    if (!regRow) throw new DomainError("REGISTRATION_NOT_FOUND", "GST registration not found");
    if (String(regRow.status) !== "ACTIVE") throw new DomainError("REGISTRATION_INACTIVE", "GST registration must be ACTIVE");

    const gstin = String(regRow.gstin);
    const existing = await s.querySingle(
      "SELECT id FROM gst_returns WHERE registration_id = ? AND return_form = ? AND tax_period_from = ? AND tax_period_to = ? AND tenant_id = ? AND book_set_id = ?",
      [p.registrationId, p.returnForm, p.taxPeriodFrom, p.taxPeriodTo, e.tenantId, e.bookSetId]
    );
    const returnId = existing ? String(existing.id) : randomUUID();

    if (!existing) {
      await s.execute(
        "INSERT INTO gst_returns (id, tenant_id, book_set_id, registration_id, gstin, return_form, tax_period_from, tax_period_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [returnId, e.tenantId, e.bookSetId, p.registrationId, gstin, p.returnForm, p.taxPeriodFrom, p.taxPeriodTo, new Date().toISOString()]
      );
    }

    const invoiceRows = await s.query(
      "SELECT si.id, si.invoice_number, si.issue_date, si.customer_id, si.total_minor, si.posted_at FROM sales_invoices si WHERE si.tenant_id = ? AND si.book_set_id = ? AND si.status = 'POSTED' AND si.issue_date >= ? AND si.issue_date <= ? ORDER BY si.issue_date, si.id",
      [e.tenantId, e.bookSetId, p.taxPeriodFrom, p.taxPeriodTo]
    );

    const sourceIds: string[] = [];
    const sourceHashes: Record<string, string> = {};
    for (const inv of invoiceRows.rows) {
      const invId = String(inv.id);
      sourceIds.push(invId);
      sourceHashes[invId] = sha256(JSON.stringify({ id: invId, number: String(inv.invoice_number), date: String(inv.issue_date), total: Number(inv.total_minor) }));
    }

    const payloadHash = sha256(JSON.stringify({ returnId, registrationId: p.registrationId, taxPeriodFrom: p.taxPeriodFrom, taxPeriodTo: p.taxPeriodTo, invoiceIds: sourceIds }));
    const summaryFacts = { invoiceCount: sourceIds.length, periodFrom: p.taxPeriodFrom, periodTo: p.taxPeriodTo };

    const snapshotVersion = (await s.querySingle("SELECT MAX(snapshot_version) as max_v FROM gst_return_snapshots WHERE return_id = ? AND tenant_id = ? AND book_set_id = ?", [returnId, e.tenantId, e.bookSetId]))?.max_v as number | null;
    const nextVersion = (snapshotVersion ?? 0) + 1;

    const snapshotId = randomUUID();
    const now = new Date().toISOString();

    await s.execute(
      "INSERT INTO gst_return_snapshots (id, return_id, tenant_id, book_set_id, snapshot_version, prepared_at, prepared_by_actor_id, request_hash, payload_hash, source_invoice_ids_json, frozen_source_hashes_json, summary_facts_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [snapshotId, returnId, e.tenantId, e.bookSetId, nextVersion, now, e.actor.id, hash, payloadHash, JSON.stringify(sourceIds), JSON.stringify(sourceHashes), JSON.stringify(summaryFacts)]
    );

    return finish(s, "gst.return.prepare", e, hash, { returnId, snapshotId, snapshotVersion: nextVersion, invoiceCount: sourceIds.length }, "gst_returns", returnId);
  });
}

export async function validateReturn(runner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, snapshotId: string, actorId: string): Promise<GstReturnValidateResult> {
  return runner.withBusinessSession("write", async (s) => {
    const snapshot = await s.querySingle("SELECT id, return_id, source_invoice_ids_json FROM gst_return_snapshots WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [snapshotId, tenantId, bookSetId]);
    if (!snapshot) throw new DomainError("SNAPSHOT_NOT_FOUND", "snapshot not found");

    const returnRow = await s.querySingle("SELECT id, registration_id FROM gst_returns WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [snapshot.return_id, tenantId, bookSetId]);
    if (!returnRow) throw new DomainError("RETURN_NOT_FOUND", "return not found");

    const sourceIds = JSON.parse(String(snapshot.source_invoice_ids_json)) as string[];
    const issues: GstReturnValidateResult["issues"] = [];

    const regRow = await s.querySingle("SELECT status FROM gst_registrations WHERE id = ? AND tenant_id = ?", [returnRow.registration_id, tenantId]);
    if (String(regRow?.status) !== "ACTIVE") {
      issues.push({ code: "REGISTRATION_INACTIVE", severity: "ERROR", message: "GST registration is not active" });
    }

    for (const invId of sourceIds) {
      const inv = await s.querySingle("SELECT id, customer_id, total_minor, posted_journal_id FROM sales_invoices WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [invId, tenantId, bookSetId]);
      if (!inv) {
        issues.push({ code: "INVOICE_NOT_FOUND", invoiceId: invId, severity: "ERROR", message: `invoice ${invId} not found` });
        continue;
      }

      const facts = await s.querySingle("SELECT id FROM gst_outward_facts WHERE invoice_id = ? AND tenant_id = ? AND book_set_id = ?", [invId, tenantId, bookSetId]);
      if (!facts) {
        issues.push({ code: "MISSING_OUTWARD_FACTS", invoiceId: invId, severity: "ERROR", message: `GST outward facts not recorded for invoice ${invId}` });
        continue;
      }

      const lines = await s.query("SELECT id FROM gst_outward_line_facts WHERE outward_facts_id = ? AND tenant_id = ? AND book_set_id = ?", [facts.id, tenantId, bookSetId]);
      const invLines = await s.query("SELECT id FROM sales_invoice_lines WHERE invoice_id = ? AND tenant_id = ? AND book_set_id = ?", [invId, tenantId, bookSetId]);
      if (lines.rows.length === 0 && invLines.rows.length > 0) {
        issues.push({ code: "MISSING_LINE_FACTS", invoiceId: invId, severity: "ERROR", message: `no line facts recorded for invoice ${invId}` });
      }

      const party = await s.querySingle("SELECT id FROM parties WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [inv.customer_id, tenantId, bookSetId]);
      if (!party) {
        issues.push({ code: "PARTY_NOT_FOUND", invoiceId: invId, severity: "ERROR", message: `customer party not found` });
      }

      const gstProfile = await s.querySingle("SELECT id FROM party_gst_profiles WHERE party_id = ? AND tenant_id = ? AND book_set_id = ? AND effective_from <= DATE('now') AND (effective_to IS NULL OR effective_to >= DATE('now'))", [inv.customer_id, tenantId, bookSetId]);
      if (!gstProfile) {
        issues.push({ code: "MISSING_PARTY_GST_PROFILE", invoiceId: invId, severity: "WARNING", message: `no active GST profile for customer` });
      }
    }

    const readinessStatus: ReadinessStatus = issues.some(i => i.severity === "ERROR") ? "BLOCKED" : issues.length > 0 ? "REVIEW_REQUIRED" : "READY";

    const validation = await s.querySingle("SELECT id FROM gst_return_validations WHERE snapshot_id = ? AND tenant_id = ? AND book_set_id = ?", [snapshotId, tenantId, bookSetId]);
    let validationId = validation ? String(validation.id) : randomUUID();

    if (!validation) {
      const now = new Date().toISOString();
      await s.execute(
        "INSERT INTO gst_return_validations (id, snapshot_id, return_id, tenant_id, book_set_id, validated_at, validated_by_actor_id, readiness_status, issues_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [validationId, snapshotId, snapshot.return_id, tenantId, bookSetId, now, actorId, readinessStatus, JSON.stringify(issues)]
      );
    }

    return { snapshotId, readinessStatus, issueCount: issues.length, issues };
  });
}

export async function exportReviewPack(runner: BusinessSessionRunner, e: GstEnvelope<GstReturnExportPackPayload>): Promise<CommandResult<GstReturnExportPackResult>> {
  if (!e.bookSetId) throw new DomainError("INVALID_COMMAND", "bookSetId is required");
  const p = e.payload;
  const hash = computeCommandHash("gst.return.export-review-pack", e, p);

  return runner.withBusinessSession("write", async (s) => {
    const prior = await replay(s, e.tenantId, e.requestId, hash);
    if (prior) return prior as CommandResult<GstReturnExportPackResult>;

    const validation = await s.querySingle("SELECT snapshot_id, return_id, readiness_status FROM gst_return_validations WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [p.validationId, e.tenantId, e.bookSetId]);
    if (!validation) throw new DomainError("VALIDATION_NOT_FOUND", "validation not found");

    const snapshot = await s.querySingle("SELECT id, return_id FROM gst_return_snapshots WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [validation.snapshot_id, e.tenantId, e.bookSetId]);
    if (!snapshot) throw new DomainError("SNAPSHOT_NOT_FOUND", "snapshot not found");

    const csvSummaryLines = [["Period From", "Period To", "Invoice Count", "Readiness Status"]];
    const csvDocumentLines = [["Invoice ID", "Invoice Number", "Issue Date", "Customer", "Total Amount", "HSN/SAC Recorded"]];
    const csvLineDetailsLines = [["Invoice ID", "Line Number", "Description", "Amount", "Classification", "HSN/SAC Code"]];
    const csvTaxComponentLines = [["Invoice ID", "Component", "Amount"]];
    const csvValidationIssuesLines = [["Invoice ID", "Issue Code", "Severity", "Message"]];

    const manifest = { validationId: p.validationId, snapshotId: validation.snapshot_id, format: "NEUTRAL_REVIEW_PACK_V1", exportedAt: new Date().toISOString() };
    const manifestJson = JSON.stringify(manifest);
    const manifestHash = sha256(manifestJson);

    const csvSummaryHash = sha256(csvSummaryLines.map(r => r.map(escapeCsv).join(",")).join("\n"));
    const csvDocumentsHash = sha256(csvDocumentLines.map(r => r.map(escapeCsv).join(",")).join("\n"));
    const csvLineDetailsHash = sha256(csvLineDetailsLines.map(r => r.map(escapeCsv).join(",")).join("\n"));
    const csvTaxComponentHash = sha256(csvTaxComponentLines.map(r => r.map(escapeCsv).join(",")).join("\n"));
    const csvValidationIssuesHash = sha256(csvValidationIssuesLines.map(r => r.map(escapeCsv).join(",")).join("\n"));

    const exportId = randomUUID();
    const now = new Date().toISOString();

    await s.execute(
      "INSERT INTO gst_return_exports (id, validation_id, snapshot_id, return_id, tenant_id, book_set_id, exported_at, exported_by_actor_id, manifest_json, manifest_hash, artifact_format_version, portal_json_status, csv_summary_lines_json, csv_summary_hash, csv_documents_lines_json, csv_documents_hash, csv_line_details_lines_json, csv_line_details_hash, csv_tax_component_lines_json, csv_tax_component_hash, csv_validation_issues_lines_json, csv_validation_issues_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [exportId, p.validationId, validation.snapshot_id, snapshot.return_id, e.tenantId, e.bookSetId, now, e.actor.id, manifestJson, manifestHash, "1.0", "SCHEMA_UNPINNED", JSON.stringify(csvSummaryLines), csvSummaryHash, JSON.stringify(csvDocumentLines), csvDocumentsHash, JSON.stringify(csvLineDetailsLines), csvLineDetailsHash, JSON.stringify(csvTaxComponentLines), csvTaxComponentHash, JSON.stringify(csvValidationIssuesLines), csvValidationIssuesHash]
    );

    return finish(s, "gst.return.export-review-pack", e, hash, { exportId, validationId: p.validationId, manifestHash, portalJsonStatus: "SCHEMA_UNPINNED" as const }, "gst_return_exports", exportId);
  });
}

export async function recordObservation(runner: BusinessSessionRunner, e: GstEnvelope<GstReturnObservationPayload>): Promise<CommandResult<{ observationId: string; returnId: string }>> {
  if (!e.bookSetId) throw new DomainError("INVALID_COMMAND", "bookSetId is required");
  const p = e.payload;
  const hash = computeCommandHash("gst.return.record-portal-observation", e, p);

  return runner.withBusinessSession("write", async (s) => {
    const prior = await replay(s, e.tenantId, e.requestId, hash);
    if (prior) return prior as CommandResult<{ observationId: string; returnId: string }>;

    const returnRow = await s.querySingle("SELECT id FROM gst_returns WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [p.returnId, e.tenantId, e.bookSetId]);
    if (!returnRow) throw new DomainError("RETURN_NOT_FOUND", "return not found");

    if (["USER_MARKED_SUBMITTED", "ACKNOWLEDGED"].includes(p.observationType) && !p.evidenceId) {
      throw new DomainError("EVIDENCE_REQUIRED", `${p.observationType} requires evidence`);
    }

    if (p.evidenceId) {
      const evidence = await s.querySingle("SELECT id FROM evidence WHERE id = ? AND tenant_id = ?", [p.evidenceId, e.tenantId]);
      if (!evidence) throw new DomainError("EVIDENCE_NOT_FOUND", "evidence not found");
    }

    const observationId = randomUUID();
    const now = new Date().toISOString();

    await s.execute(
      "INSERT INTO gst_return_observations (id, return_id, tenant_id, book_set_id, recorded_at, recorded_by_actor_id, observation_type, external_reference, evidence_id, narration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [observationId, p.returnId, e.tenantId, e.bookSetId, now, e.actor.id, p.observationType, p.externalReference ?? null, p.evidenceId ?? null, p.narration ?? null]
    );

    return finish(s, "gst.return.record-portal-observation", e, hash, { observationId, returnId: p.returnId }, "gst_return_observations", observationId);
  });
}

export async function getReturn(runner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId, returnId: string): Promise<Record<string, unknown>> {
  return runner.withBusinessSession("read", async (s) => {
    const row = await s.querySingle("SELECT id, registration_id, gstin, return_form, tax_period_from, tax_period_to, created_at FROM gst_returns WHERE id = ? AND tenant_id = ? AND book_set_id = ?", [returnId, tenantId, bookSetId]);
    if (!row) throw new DomainError("RETURN_NOT_FOUND", "return not found");
    return { returnId: String(row.id), registrationId: String(row.registration_id), gstin: String(row.gstin), returnForm: String(row.return_form), taxPeriodFrom: String(row.tax_period_from), taxPeriodTo: String(row.tax_period_to), createdAt: String(row.created_at) };
  });
}

export async function listReturns(runner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId): Promise<Array<Record<string, unknown>>> {
  return runner.withBusinessSession("read", async (s) => {
    const rows = await s.query("SELECT id FROM gst_returns WHERE tenant_id = ? AND book_set_id = ? ORDER BY tax_period_from, id", [tenantId, bookSetId]);
    const results: Array<Record<string, unknown>> = [];
    for (const row of rows.rows) {
      const ret = await getReturn(runner, tenantId, bookSetId, String(row.id));
      results.push(ret);
    }
    return results;
  });
}

export async function readinessReport(runner: BusinessSessionRunner, tenantId: TenantId, bookSetId: BookSetId): Promise<Array<{ returnId: string; gstin: string; periodFrom: string; periodTo: string; readinessStatus?: ReadinessStatus; lastExportedAt?: string }>> {
  return runner.withBusinessSession("read", async (s) => {
    const returns = await s.query("SELECT id, gstin, tax_period_from, tax_period_to FROM gst_returns WHERE tenant_id = ? AND book_set_id = ? ORDER BY tax_period_from DESC", [tenantId, bookSetId]);
    const results: Array<{ returnId: string; gstin: string; periodFrom: string; periodTo: string; readinessStatus?: ReadinessStatus; lastExportedAt?: string }> = [];

    for (const ret of returns.rows) {
      const latestSnapshot = await s.querySingle("SELECT id FROM gst_return_snapshots WHERE return_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY snapshot_version DESC LIMIT 1", [ret.id, tenantId, bookSetId]);
      let readinessStatus: ReadinessStatus | undefined;
      if (latestSnapshot) {
        const validation = await s.querySingle("SELECT readiness_status FROM gst_return_validations WHERE snapshot_id = ? AND tenant_id = ? AND book_set_id = ?", [latestSnapshot.id, tenantId, bookSetId]);
        if (validation) readinessStatus = String(validation.readiness_status) as ReadinessStatus;
      }

      const latestExport = await s.querySingle("SELECT exported_at FROM gst_return_exports WHERE return_id = ? AND tenant_id = ? AND book_set_id = ? ORDER BY exported_at DESC LIMIT 1", [ret.id, tenantId, bookSetId]);

      results.push({
        returnId: String(ret.id),
        gstin: String(ret.gstin),
        periodFrom: String(ret.tax_period_from),
        periodTo: String(ret.tax_period_to),
        readinessStatus,
        lastExportedAt: latestExport ? String(latestExport.exported_at) : undefined,
      });
    }
    return results;
  });
}
