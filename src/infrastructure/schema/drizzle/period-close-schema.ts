import { sqliteTable, text, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { bookSets } from "./foundation-schema";

/** Append-only close and reopen events. OPEN is derived when no event exists. */
export const periodCloseEvents = sqliteTable(
  "period_close_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    eventType: text("event_type").notNull(),
    planHash: text("plan_hash").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    source: text("source").notNull(),
    reason: text("reason").notNull(),
    overrideReason: text("override_reason"),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    resultJson: text("result_json").notNull(),
    resultHash: text("result_hash").notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    uqRequest: uniqueIndex("uq_period_close_event_request").on(table.tenantId, table.bookSetId, table.requestId),
    uqScopeKey: uniqueIndex("uq_period_close_event_scope_key").on(table.id, table.tenantId, table.bookSetId),
    idxScopePeriod: index("idx_period_close_events_scope_period").on(table.tenantId, table.bookSetId, table.periodStart, table.periodEnd, table.occurredAt, table.id),
    chkDates: check("chk_period_close_event_dates", sql`length(${table.periodStart}) = 10 AND length(${table.periodEnd}) = 10 AND ${table.periodStart} <= ${table.periodEnd}`),
    chkType: check("chk_period_close_event_type", sql`${table.eventType} IN ('CLOSED', 'REOPENED')`),
    chkActor: check("chk_period_close_event_actor", sql`${table.actorType} IN ('HUMAN', 'AGENT', 'SYSTEM') AND length(trim(${table.actorId})) > 0`),
    chkHashes: check("chk_period_close_event_hashes", sql`length(${table.planHash}) = 64 AND length(${table.requestHash}) = 64 AND length(${table.resultHash}) = 64 AND ${table.planHash} NOT GLOB '*[^0-9a-f]*' AND ${table.requestHash} NOT GLOB '*[^0-9a-f]*' AND ${table.resultHash} NOT GLOB '*[^0-9a-f]*'`),
    chkReason: check("chk_period_close_event_reason", sql`length(trim(${table.reason})) > 0`),
  }),
);
