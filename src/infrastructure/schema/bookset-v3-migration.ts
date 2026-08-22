/**
 * BookSet V2→V3 Migration: Add display_name and remove UNIQUE(tenant_id, kind) cardinality.
 *
 * Schema changes:
 * - Add NOT NULL display_name column to book_sets
 * - Remove UNIQUE(tenant_id, kind) constraint
 * - Add partial UNIQUE indexes for single COMPANY and PERSONAL per tenant
 * - Allow unlimited PROPRIETORSHIP BookSets per tenant
 *
 * Data migration:
 * - Backfill display_name: COMPANY→"Company", PERSONAL→"Personal", PROPRIETORSHIP→"Proprietorship"
 * - Trim and validate all existing names
 *
 * Constraints:
 * - No BEGIN/COMMIT in migration SQL (runs within UpgradeCoordinator transaction)
 * - foreign_keys must remain ON throughout
 * - Never rebuild tenants table
 * - Preserve all IDs, balances, timestamps, parent graph
 * - Deterministic target probes validate exact state
 */

export const BOOKSET_V3_MIGRATION_SQLITE = `
-- Rebuild book_sets table: remove UNIQUE(tenant_id, kind), add display_name
-- Step 1: Create staging table with exact target schema
CREATE TABLE book_sets_v3 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('COMPANY', 'PERSONAL', 'PROPRIETORSHIP')),
  display_name TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT fk_book_set_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Step 2: Copy data with deterministic backfill
INSERT INTO book_sets_v3 (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at)
SELECT
  id,
  tenant_id,
  kind,
  CASE kind
    WHEN 'COMPANY' THEN 'Company'
    WHEN 'PERSONAL' THEN 'Personal'
    WHEN 'PROPRIETORSHIP' THEN 'Proprietorship'
  END,
  lifecycle,
  created_at,
  updated_at
FROM book_sets;

-- Step 3: Drop old triggers before dropping old table
DROP TRIGGER IF EXISTS tenants_default_book_set_tenant_match;
DROP TRIGGER IF EXISTS tenants_default_book_set_tenant_match_upd;
DROP TRIGGER IF EXISTS accounts_book_set_tenant_match;
DROP TRIGGER IF EXISTS accounts_book_set_tenant_match_upd;

-- Step 4: Drop old indices
DROP INDEX IF EXISTS idx_book_sets_tenant;

-- Step 5: Drop old table
DROP TABLE book_sets;

-- Step 6: Rename staging table to final
ALTER TABLE book_sets_v3 RENAME TO book_sets;

-- Step 7: Recreate indices
CREATE INDEX idx_book_sets_tenant ON book_sets(tenant_id);

-- Step 8: Recreate partial unique indexes for COMPANY and PERSONAL cardinality
CREATE UNIQUE INDEX uq_book_set_tenant_company ON book_sets(tenant_id, kind)
WHERE kind = 'COMPANY';
CREATE UNIQUE INDEX uq_book_set_tenant_personal ON book_sets(tenant_id, kind)
WHERE kind = 'PERSONAL';

-- Step 9: Recreate tenant default_book_set_id validation triggers
CREATE TRIGGER tenants_default_book_set_tenant_match BEFORE INSERT ON tenants
WHEN NEW.default_book_set_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.default_book_set_id AND tenant_id = NEW.id
    ) THEN RAISE(ABORT, 'default_book_set_id must belong to same tenant')
  END;
END;

CREATE TRIGGER tenants_default_book_set_tenant_match_upd BEFORE UPDATE ON tenants
WHEN NEW.default_book_set_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.default_book_set_id AND tenant_id = NEW.id
    ) THEN RAISE(ABORT, 'default_book_set_id must belong to same tenant')
  END;
END;

-- Step 10: Recreate account book_set_id validation triggers
CREATE TRIGGER accounts_book_set_tenant_match BEFORE INSERT ON accounts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.book_set_id AND tenant_id = NEW.tenant_id
    ) THEN RAISE(ABORT, 'account book_set_id must belong to account tenant_id')
  END;
END;

CREATE TRIGGER accounts_book_set_tenant_match_upd BEFORE UPDATE ON accounts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.book_set_id AND tenant_id = NEW.tenant_id
    ) THEN RAISE(ABORT, 'account book_set_id must belong to account tenant_id')
  END;
END;
`;

export const BOOKSET_V3_MIGRATION = {
  id: "0003-bookset-display-name",
  sqlite: BOOKSET_V3_MIGRATION_SQLITE,
  manifest: {
    version: 1,
    dialect: "sqlite" as const,
    retrySafe: true,
    probes: [
      {
        id: "v3-schema-exists",
        sql: "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='book_sets' AND sql LIKE '%display_name%'",
        expectedRows: [{ count: 1 }],
      },
      {
        id: "v3-index-company-unique",
        sql: "SELECT COUNT(*) as count FROM sqlite_master WHERE type='index' AND name='uq_book_set_tenant_company'",
        expectedRows: [{ count: 1 }],
      },
      {
        id: "v3-index-personal-unique",
        sql: "SELECT COUNT(*) as count FROM sqlite_master WHERE type='index' AND name='uq_book_set_tenant_personal'",
        expectedRows: [{ count: 1 }],
      },
      {
        id: "v3-no-old-unique",
        sql: "SELECT COUNT(*) as count FROM sqlite_master WHERE type='index' AND name='uq_book_set_tenant_kind'",
        expectedRows: [{ count: 0 }],
      },
    ],
  },
};
