import { BOOKSET_V3_MIGRATION } from "./bookset-v3-migration.ts";
import { BOOKSET_V4_MIGRATION } from "./bookset-v4-migration.ts";
import {
  computeSqliteMigrationChecksum,
  V2_SCHEMA_MANIFEST,
  V3_SCHEMA_MANIFEST,
  CURRENT_SCHEMA_MANIFEST,
  type SqliteSchemaManifest,
} from "./current-manifest.ts";
import type { UpgradePlan } from "../../application/ports/upgrade.ts";

/** Canonical production V2 -> V3 plan used by bootstrap and CLI composition. */
export const BOOKSET_V3_UPGRADE_PLAN: UpgradePlan = Object.freeze({
  sourceManifest: V2_SCHEMA_MANIFEST,
  targetManifest: V3_SCHEMA_MANIFEST,
  migration: Object.freeze({
    id: BOOKSET_V3_MIGRATION.id,
    sql: BOOKSET_V3_MIGRATION.sqlite,
    manifest: BOOKSET_V3_MIGRATION.manifest,
  }),
  preflightProbes: Object.freeze([
    {
      id: "source-book-sets-table",
      sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'book_sets' LIMIT 1",
      expectedRows: [{ table_count: "1" }],
    },
  ]),
  targetVerificationProbes: BOOKSET_V3_MIGRATION.manifest.probes,
});

// Keep the plan definition tied to the immutable migration identity at module
// load time; this also prevents a hand-edited target manifest from looking
// like a valid production plan.
if (BOOKSET_V3_UPGRADE_PLAN.targetManifest.migrations.at(-1)?.checksum !== computeSqliteMigrationChecksum(BOOKSET_V3_MIGRATION.sqlite)) {
  throw new Error("BookSet V3 upgrade plan checksum is not canonical");
}

export function createBookSetV3UpgradePlan(): UpgradePlan {
  return BOOKSET_V3_UPGRADE_PLAN;
}

/** Canonical production V3 -> V4 plan used by bootstrap and CLI composition. */
export const BOOKSET_V4_UPGRADE_PLAN: UpgradePlan = Object.freeze({
  sourceManifest: V3_SCHEMA_MANIFEST,
  targetManifest: CURRENT_SCHEMA_MANIFEST,
  migration: Object.freeze({
    id: BOOKSET_V4_MIGRATION.id,
    sql: BOOKSET_V4_MIGRATION.sqlite,
    manifest: BOOKSET_V4_MIGRATION.manifest,
  }),
  preflightProbes: Object.freeze([
    {
      id: "target-audit-records-table",
      sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'audit_records' LIMIT 1",
      expectedRows: [{ table_count: "1" }],
    },
  ]),
  targetVerificationProbes: BOOKSET_V4_MIGRATION.manifest.probes,
});

if (BOOKSET_V4_UPGRADE_PLAN.targetManifest.migrations.at(-1)?.checksum !== computeSqliteMigrationChecksum(BOOKSET_V4_MIGRATION.sqlite)) {
  throw new Error("BookSet V4 upgrade plan checksum is not canonical");
}

export function createBookSetV4UpgradePlan(): UpgradePlan {
  return BOOKSET_V4_UPGRADE_PLAN;
}

export type { SqliteSchemaManifest };
