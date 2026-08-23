import { createHash, randomUUID } from "node:crypto";
import type { BookSetId, TenantId } from "../../core/types.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import { ledgerSnapshotInSession, type BalanceSheetReport, type ProfitAndLossReport, type TrialBalanceReport } from "./ledger-report-service.ts";

export type PeriodEventType = "CLOSED" | "REOPENED";
export type PeriodStatus = "OPEN" | "CLOSED" | "REOPENED";

export interface PeriodChecklistFinding {
  code: string;
  count: number;
  ids: string[];
}

export interface PeriodCloseSnapshot {
  ledger: { trialBalance: TrialBalanceReport; profitAndLoss: ProfitAndLossReport; balanceSheet: BalanceSheetReport };
  checklist: PeriodChecklistFinding[];
}

export interface PeriodPlan {
  operation: "CLOSE" | "REOPEN";
  tenantId: string;
  bookSetId: string;
  periodStart: string;
  periodEnd: string;
  status: PeriodStatus;
  planHash: string;
  snapshot: PeriodCloseSnapshot;
}

export interface PeriodEventResult {
  eventId: string;
  eventType: PeriodEventType;
  periodStart: string;
  periodEnd: string;
  status: PeriodStatus;
  planHash: string;
}

export interface PeriodClosePayload {
  periodStart: string;
  periodEnd: string;
  planHash: string;
  confirm: boolean;
  overrideReason?: string;
}

export interface PeriodReopenPayload {
  periodStart: string;
  periodEnd: string;
  planHash: string;
  confirm: boolean;
  reason: string;
}

export type PeriodEnvelope<P> = CommandEnvelope<P> & { bookSetId: BookSetId };

function isoDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("INVALID_PERIOD_DATE", `${field} must be a valid ISO date`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new DomainError("INVALID_PERIOD_DATE", `${field} must be a valid ISO date`);
}

function assertRange(fromDate: unknown, toDate: unknown): asserts fromDate is string {
  isoDate(fromDate, "periodStart");
  isoDate(toDate, "periodEnd");
  if (fromDate > toDate) throw new DomainError("INVALID_PERIOD_RANGE", "periodStart must not be after periodEnd");
}

function nonblank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_PERIOD_REQUEST", `${field} must be nonblank`);
  return value.trim();
}

function hashJson(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }

type PeriodEventRow = { id: string; periodStart: string; periodEnd: string; eventType: PeriodEventType; occurredAt: string };

async function eventsForScope(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId): Promise<PeriodEventRow[]> {
  const rows = await session.query(
    "SELECT id, period_start, period_end, event_type, occurred_at FROM period_close_events WHERE tenant_id = ? AND book_set_id = ? ORDER BY period_start, period_end, occurred_at, id",
    [tenantId, bookSetId],
  );
  return rows.rows.map((row) => ({ id: String(row.id), periodStart: String(row.period_start), periodEnd: String(row.period_end), eventType: String(row.event_type) as PeriodEventType, occurredAt: String(row.occurred_at) }));
}

function latestEvents(events: PeriodEventRow[]): Map<string, PeriodEventRow> {
  const latest = new Map<string, PeriodEventRow>();
  for (const event of events) latest.set(`${event.periodStart}|${event.periodEnd}`, event);
  return latest;
}

function rangeOverlaps(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

async function assertBookSet(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId): Promise<void> {
  const row = await session.querySingle("SELECT id, lifecycle FROM book_sets WHERE id = ? AND tenant_id = ?", [bookSetId, tenantId]);
  if (!row) throw new DomainError("BOOK_SET_NOT_FOUND", `BookSet not found: ${bookSetId}`);
  if (String(row.lifecycle) !== "ACTIVE") throw new DomainError("BOOK_SET_INACTIVE", "BookSet must be ACTIVE");
}

/** Shared guard for every public dated accounting boundary. */
export async function assertPeriodOpen(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, date: string): Promise<void> {
  isoDate(date, "date");
  const events = latestEvents(await eventsForScope(session, tenantId, bookSetId));
  for (const event of events.values()) {
    if (event.eventType === "CLOSED" && event.periodStart <= date && event.periodEnd >= date) {
      throw new DomainError("PERIOD_CLOSED", "The accounting period is closed for this date", { tenantId, bookSetId, date, periodStart: event.periodStart, periodEnd: event.periodEnd });
    }
  }
}

export async function assertPeriodRangeOpen(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, fromDate: string, toDate: string): Promise<void> {
  assertRange(fromDate, toDate);
  const events = latestEvents(await eventsForScope(session, tenantId, bookSetId));
  for (const event of events.values()) {
    if (event.eventType === "CLOSED" && rangeOverlaps(fromDate, toDate, event.periodStart, event.periodEnd)) {
      throw new DomainError("PERIOD_CLOSED", "The accounting period is closed for part of this range", { tenantId, bookSetId, fromDate, toDate, periodStart: event.periodStart, periodEnd: event.periodEnd });
    }
  }
}

async function checklist(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, fromDate: string, toDate: string): Promise<PeriodChecklistFinding[]> {
  const findings: PeriodChecklistFinding[] = [];
  const add = (code: string, ids: string[]) => { if (ids.length > 0) findings.push({ code, count: ids.length, ids: [...ids].sort() }); };

  const gst = await session.query("SELECT v.id FROM gst_return_validations v JOIN gst_returns r ON r.id = v.return_id AND r.tenant_id = v.tenant_id AND r.book_set_id = v.book_set_id WHERE v.tenant_id = ? AND v.book_set_id = ? AND r.tax_period_from <= ? AND r.tax_period_to >= ? AND v.readiness_status <> 'READY'", [tenantId, bookSetId, toDate, fromDate]);
  add("GST_RETURN_UNRESOLVED", gst.rows.map((row) => String(row.id)));
  const tds = await session.query("SELECT id FROM withholding_compliance_cases WHERE tenant_id = ? AND book_set_id = ? AND period_start <= ? AND period_end >= ? AND state <> 'ACCEPTED'", [tenantId, bookSetId, toDate, fromDate]);
  add("TDS_TCS_UNRESOLVED", tds.rows.map((row) => String(row.id)));
  const payroll = await session.query("SELECT id FROM payroll_pay_runs WHERE tenant_id = ? AND book_set_id = ? AND period_start <= ? AND period_end >= ? AND status <> 'POSTED'", [tenantId, bookSetId, toDate, fromDate]);
  add("PAYROLL_UNRESOLVED", payroll.rows.map((row) => String(row.id)));
  const assets = await session.query("SELECT id FROM asset_depreciation_runs WHERE tenant_id = ? AND book_set_id = ? AND period_start <= ? AND period_end >= ? AND status NOT IN ('POSTED', 'NO_OP')", [tenantId, bookSetId, toDate, fromDate]);
  add("ASSET_DEPRECIATION_UNRESOLVED", assets.rows.map((row) => String(row.id)));
  const fx = await session.query("SELECT id FROM fx_revaluation_runs WHERE tenant_id = ? AND book_set_id = ? AND as_of_date >= ? AND as_of_date <= ? AND status = 'PREVIEW'", [tenantId, bookSetId, fromDate, toDate]);
  add("FX_REVALUATION_UNRESOLVED", fx.rows.map((row) => String(row.id)));

  const statements = await session.query("SELECT id FROM bank_statements WHERE tenant_id = ? AND book_set_id = ? AND period_start <= ? AND period_end >= ? ORDER BY id", [tenantId, bookSetId, toDate, fromDate]);
  const unmatched: string[] = [];
  for (const statement of statements.rows) {
    const lines = await session.query("SELECT l.id FROM bank_statement_lines l LEFT JOIN bank_matches m ON m.statement_line_id = l.id AND m.tenant_id = l.tenant_id AND m.book_set_id = l.book_set_id AND m.status = 'ACTIVE' WHERE l.tenant_id = ? AND l.book_set_id = ? AND l.statement_id = ? AND m.id IS NULL ORDER BY l.id", [tenantId, bookSetId, String(statement.id)]);
    unmatched.push(...lines.rows.map((row) => String(row.id)));
  }
  add("BANK_RECONCILIATION_UNRESOLVED", unmatched);

  const obligations = await session.query("SELECT id, period_start, period_end FROM compliance_obligations WHERE tenant_id = ? AND book_set_id = ? AND period_start <= ? AND period_end >= ? ORDER BY id", [tenantId, bookSetId, toDate, fromDate]);
  const obligationIds = obligations.rows.map((row) => String(row.id));
  const complianceEvents = await session.query("SELECT obligation_id, event_type, occurred_at, id FROM compliance_obligation_events WHERE tenant_id = ? AND book_set_id = ? ORDER BY obligation_id, occurred_at, id", [tenantId, bookSetId]);
  const latestCompliance = new Map<string, string>();
  for (const row of complianceEvents.rows) latestCompliance.set(String(row.obligation_id), String(row.event_type));
  add("COMPLIANCE_UNRESOLVED", obligationIds.filter((id) => !["CLOSED", "WAIVED", "EXEMPT", "ACKNOWLEDGED"].includes(latestCompliance.get(id) ?? "OPEN")));
  return findings;
}

async function buildPlan(session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId, operation: "CLOSE" | "REOPEN", fromDate: string, toDate: string): Promise<PeriodPlan> {
  assertRange(fromDate, toDate);
  await assertBookSet(session, tenantId, bookSetId);
  const current = latestEvents(await eventsForScope(session, tenantId, bookSetId));
  const currentEvent = current.get(`${fromDate}|${toDate}`);
  const status: PeriodStatus = currentEvent?.eventType === "CLOSED" ? "CLOSED" : currentEvent?.eventType === "REOPENED" ? "REOPENED" : "OPEN";
  const ledger = await ledgerSnapshotInSession(session, tenantId, bookSetId, fromDate, toDate);
  if (!ledger.trialBalance.isBalanced || !ledger.balanceSheet.isBalanced) throw new DomainError("LEDGER_INTEGRITY_FAILURE", "Period close requires balanced Trial Balance and Balance Sheet");
  const snapshot: PeriodCloseSnapshot = { ledger, checklist: await checklist(session, tenantId, bookSetId, fromDate, toDate) };
  const planBody = { operation, tenantId, bookSetId, periodStart: fromDate, periodEnd: toDate, status, snapshot };
  return { ...planBody, planHash: hashJson(planBody), snapshot };
}

async function replay(session: BusinessSession, envelope: PeriodEnvelope<unknown>, requestHash: string): Promise<CommandResult<PeriodEventResult> | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [envelope.tenantId, envelope.requestId]);
  if (!row) return undefined;
  if (String(row.request_hash) !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
  if (computeResultHash(String(row.result_json)) !== String(row.result_hash)) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson: String(row.result_json), resultHash: String(row.result_hash), replayed: true };
}

function requireHumanConfirmation(envelope: PeriodEnvelope<unknown>, confirm: boolean): void {
  if (envelope.actor.kind !== "HUMAN" || confirm !== true) throw new DomainError("HUMAN_CONFIRMATION_REQUIRED", "An explicit human confirmation is required");
}

export class PeriodCloseService {
  constructor(private readonly sessionRunner: BusinessSessionRunner) {}

  async preview(tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<PeriodPlan> {
    return this.sessionRunner.withBusinessSession("read", (session) => buildPlan(session, tenantId, bookSetId, "CLOSE", periodStart, periodEnd));
  }

  async reopenPreview(tenantId: TenantId, bookSetId: BookSetId, periodStart: string, periodEnd: string): Promise<PeriodPlan> {
    return this.sessionRunner.withBusinessSession("read", (session) => buildPlan(session, tenantId, bookSetId, "REOPEN", periodStart, periodEnd));
  }

  async status(tenantId: TenantId, bookSetId: BookSetId): Promise<Array<Record<string, unknown>>> {
    return this.sessionRunner.withBusinessSession("read", async (session) => {
      await assertBookSet(session, tenantId, bookSetId);
      const latest = latestEvents(await eventsForScope(session, tenantId, bookSetId));
      return [...latest.values()].map((event) => ({ periodStart: event.periodStart, periodEnd: event.periodEnd, status: event.eventType === "CLOSED" ? "CLOSED" : "REOPENED", eventId: event.id, occurredAt: event.occurredAt })).sort((a, b) => String(a.periodStart).localeCompare(String(b.periodStart)) || String(a.periodEnd).localeCompare(String(b.periodEnd)));
    });
  }

  private async commit(envelope: PeriodEnvelope<PeriodClosePayload | PeriodReopenPayload>, operation: "CLOSE" | "REOPEN"): Promise<CommandResult<PeriodEventResult>> {
    const payload = envelope.payload;
    assertRange(payload.periodStart, payload.periodEnd);
    nonblank(payload.planHash, "planHash");
    const requestHash = computeCommandHash(operation === "CLOSE" ? "period.close" : "period.reopen", envelope, payload);
    return this.sessionRunner.withBusinessSession("write", async (session) => {
      const prior = await replay(session, envelope, requestHash);
      if (prior) return prior;
      requireHumanConfirmation(envelope, payload.confirm);
      const plan = await buildPlan(session, envelope.tenantId, envelope.bookSetId, operation, payload.periodStart, payload.periodEnd);
      if (plan.planHash !== payload.planHash) throw new DomainError("PERIOD_PLAN_STALE", "The close plan is stale; preview the current plan again", { expectedPlanHash: plan.planHash, suppliedPlanHash: payload.planHash });
      const events = latestEvents(await eventsForScope(session, envelope.tenantId, envelope.bookSetId));
      const current = events.get(`${payload.periodStart}|${payload.periodEnd}`);
      if (operation === "CLOSE") {
        if (current?.eventType === "CLOSED") throw new DomainError("PERIOD_ALREADY_CLOSED", "The period is already closed");
        for (const event of events.values()) if (event.eventType === "CLOSED" && rangeOverlaps(payload.periodStart, payload.periodEnd, event.periodStart, event.periodEnd)) throw new DomainError("PERIOD_OVERLAP", "The requested period overlaps a closed period", { periodStart: event.periodStart, periodEnd: event.periodEnd });
        const overrideReason = (payload as PeriodClosePayload).overrideReason;
        if (plan.snapshot.checklist.length > 0 && (typeof overrideReason !== "string" || overrideReason.trim() === "")) throw new DomainError("PERIOD_CLOSE_OVERRIDE_REQUIRED", "Unresolved checklist findings require an explicit override reason", { checklist: plan.snapshot.checklist });
      } else {
        if (current?.eventType !== "CLOSED") throw new DomainError("PERIOD_NOT_CLOSED", "Only a currently closed period can be reopened");
        nonblank((payload as PeriodReopenPayload).reason, "reason");
      }
      const eventType: PeriodEventType = operation === "CLOSE" ? "CLOSED" : "REOPENED";
      const now = new Date().toISOString();
      const resultBase = { eventId: randomUUID(), eventType, periodStart: payload.periodStart, periodEnd: payload.periodEnd, status: eventType === "CLOSED" ? "CLOSED" as const : "REOPENED" as const, planHash: plan.planHash };
      const resultJson = canonicalJson(resultBase);
      const resultHash = computeResultHash(resultJson);
      const reason = operation === "CLOSE" ? envelope.reason : (payload as PeriodReopenPayload).reason.trim();
      await session.execute("INSERT INTO period_close_events (id, tenant_id, book_set_id, period_start, period_end, event_type, plan_hash, snapshot_json, actor_type, actor_id, source, reason, override_reason, request_id, request_hash, result_json, result_hash, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [resultBase.eventId, envelope.tenantId, envelope.bookSetId, payload.periodStart, payload.periodEnd, eventType, plan.planHash, canonicalJson(plan.snapshot), envelope.actor.kind, envelope.actor.id, envelope.source, reason, operation === "CLOSE" ? (payload as PeriodClosePayload).overrideReason?.trim() ?? null : null, envelope.requestId, requestHash, resultJson, resultHash, now]);
      await session.execute("INSERT INTO audit_records (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id, canonical_before_hash, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.bookSetId, operation === "CLOSE" ? "period.close" : "period.reopen", eventType, envelope.actor.kind, envelope.actor.id, envelope.source, reason, envelope.requestId, resultHash, JSON.stringify({ eventId: resultBase.eventId, periodStart: payload.periodStart, periodEnd: payload.periodEnd, eventType }), now, now]);
      await session.execute("INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now]);
      return { resultJson, resultHash };
    });
  }

  close(envelope: PeriodEnvelope<PeriodClosePayload>): Promise<CommandResult<PeriodEventResult>> { return this.commit(envelope, "CLOSE"); }
  reopen(envelope: PeriodEnvelope<PeriodReopenPayload>): Promise<CommandResult<PeriodEventResult>> { return this.commit(envelope, "REOPEN"); }
}
