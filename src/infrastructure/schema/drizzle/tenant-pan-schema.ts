import { sqliteTable, text, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { tenants } from "./foundation-schema";

/** Tenant PAN V1: deliberately plaintext, with a non-secret lookup hash. */
export const tenantPanProfiles = sqliteTable(
  "tenant_pan_profiles",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    pan: text("pan").notNull(),
    lookupHash: text("lookup_hash").notNull(),
    lastFour: text("last_four").notNull(),
    maskedDisplay: text("masked_display").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    uqTenant: uniqueIndex("uq_tenant_pan_profiles_tenant").on(table.tenantId),
    uqLookupHash: uniqueIndex("uq_tenant_pan_profiles_lookup_hash").on(table.lookupHash),
    uqScopeKey: uniqueIndex("uq_tenant_pan_profiles_scope_key").on(table.id, table.tenantId),
    idxTenant: index("idx_tenant_pan_profiles_tenant").on(table.tenantId),
    chkPan: check("chk_tenant_pan_shape", sql`length(${table.pan}) = 10 AND ${table.pan} GLOB '[A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z]'`),
    chkLookupHash: check("chk_tenant_pan_lookup_hash", sql`length(${table.lookupHash}) = 64 AND ${table.lookupHash} NOT GLOB '*[^0-9a-f]*'`),
    chkLastFour: check("chk_tenant_pan_last_four", sql`${table.lastFour} GLOB '[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]'`),
    chkMaskedDisplay: check("chk_tenant_pan_masked_display", sql`${table.maskedDisplay} = '******' || ${table.lastFour}`),
  }),
);
