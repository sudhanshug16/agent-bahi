import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { bookSets } from "./foundation-schema";
import { bookSetLedgerRevisions } from "./personal-taxcase-schema";
import { closePackManifests } from "./close-pack-schema";

/** Immutable India FY rollover snapshots. The continuous ledger is never closed by journals. */
export const fiscalYearRollovers = sqliteTable(
  "fiscal_year_rollovers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    financialYear: text("financial_year").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    ledgerRevision: integer("ledger_revision").notNull(),
    closePackManifestId: text("close_pack_manifest_id").notNull(),
    closePackManifestHash: text("close_pack_manifest_hash").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    source: text("source").notNull(),
    reason: text("reason").notNull(),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    resultJson: text("result_json").notNull(),
    resultHash: text("result_hash").notNull(),
    finalizedAt: text("finalized_at").notNull(),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    fkRevision: foreignKey({ columns: [table.tenantId, table.bookSetId], foreignColumns: [bookSetLedgerRevisions.tenantId, bookSetLedgerRevisions.bookSetId] }).onDelete("no action"),
    fkClosePack: foreignKey({ columns: [table.closePackManifestId, table.tenantId, table.bookSetId], foreignColumns: [closePackManifests.id, closePackManifests.tenantId, closePackManifests.bookSetId] }).onDelete("no action"),
    uqFinancialYear: uniqueIndex("uq_fiscal_year_rollover_scope_year").on(table.tenantId, table.bookSetId, table.financialYear),
    uqRequest: uniqueIndex("uq_fiscal_year_rollover_request").on(table.tenantId, table.bookSetId, table.requestId),
    uqScopeKey: uniqueIndex("uq_fiscal_year_rollover_id_scope").on(table.id, table.tenantId, table.bookSetId),
    idxScope: index("idx_fiscal_year_rollovers_scope").on(table.tenantId, table.bookSetId, table.financialYear, table.finalizedAt, table.id),
    chkYear: check("chk_fiscal_year_rollover_year", sql`length(${table.financialYear}) = 9 AND substr(${table.financialYear}, 5, 1) = '-' AND typeof(CAST(substr(${table.financialYear}, 1, 4) AS INTEGER)) = 'integer' AND CAST(substr(${table.financialYear}, 6, 4) AS INTEGER) = CAST(substr(${table.financialYear}, 1, 4) AS INTEGER) + 1`),
    chkDates: check("chk_fiscal_year_rollover_dates", sql`${table.periodStart} = substr(${table.financialYear}, 1, 4) || '-04-01' AND ${table.periodEnd} = substr(${table.financialYear}, 6, 4) || '-03-31'`),
    chkRevision: check("chk_fiscal_year_rollover_revision", sql`typeof(${table.ledgerRevision}) = 'integer' AND ${table.ledgerRevision} >= 0`),
    chkActor: check("chk_fiscal_year_rollover_actor", sql`${table.actorType} = 'HUMAN' AND length(trim(${table.actorId})) > 0`),
    chkHashes: check("chk_fiscal_year_rollover_hashes", sql`length(${table.closePackManifestHash}) = 64 AND ${table.closePackManifestHash} NOT GLOB '*[^0-9a-f]*' AND length(${table.snapshotHash}) = 64 AND ${table.snapshotHash} NOT GLOB '*[^0-9a-f]*' AND length(${table.requestHash}) = 64 AND ${table.requestHash} NOT GLOB '*[^0-9a-f]*' AND length(${table.resultHash}) = 64 AND ${table.resultHash} NOT GLOB '*[^0-9a-f]*'`),
    chkReason: check("chk_fiscal_year_rollover_reason", sql`length(trim(${table.reason})) > 0`),
  }),
);
