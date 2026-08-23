/** Compatibility exports for the generated catalog upgrade steps. */
export {
  BANK_RECONCILIATION_V8_UPGRADE_PLAN,
  BOOKSET_V3_UPGRADE_PLAN,
  BOOKSET_V4_UPGRADE_PLAN,
  JOURNAL_V5_UPGRADE_PLAN,
  PURCHASE_V7_UPGRADE_PLAN,
  SALES_V6_UPGRADE_PLAN,
  createBookSetV3UpgradePlan,
  createBookSetV4UpgradePlan,
  createJournalV5UpgradePlan,
} from "./migration-catalog.ts";
export type { SqliteSchemaManifest } from "./migration-catalog.ts";
