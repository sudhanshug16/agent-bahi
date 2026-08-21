# Personal Tax Physical-Schema RFC

**Status banner:** TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED.

**Date/As-of**: 2026-08-21.

**Scope**: This RFC specifies the physical-schema requirements for personal-tax support (PT-001 through PT-016 decision set). It is **not implementation authority** and **does not grant Gate0 approval, Phase 1 authorization, or any code authorization**. This RFC is discovery documentation only.

**Settled context**: Only PT-001 (individual/PAN tenant with independent BookSets) and PT-009 (file-first acquisition, future AA only) are OWNER-APPROVED. PT-002–PT-008 and PT-010–PT-016 are TENTATIVE RECOMMENDED DEFAULTS that require separate owner-and-architect approval before implementation.

**Architect review required**: All sections, constraints, indexes, access control, migration proof obligations, and Gate0 closure items.

---

## 1. Conceptual Model: PAN Tenant and BookSets

### Tenant Scope

One **PAN/individual taxpayer tenant** contains one personal BookSet and one or more sole-proprietorship BookSets. This is **PT-001 OWNER-APPROVED**.

- **Tenant identity**: Unique `tenant_id` (e.g., `tenant_person_12345`), with PAN as a required attribute (immutable).
- **Tenant type**: Fixed to `individual_taxpayer` to distinguish from `company_entity` tenants (separate in v1).
- **Tenant configuration**: Base currency, timezone, fiscal-year start/end, list of applicable income-tax jurisdictions, filing rule versions (frozen effective-dated snapshots).

### BookSet Scope

Each BookSet is an independent, balanced ledger within a single PAN tenant.

**Personal BookSet**:
- One per tenant, immutable identifier (e.g., `bookset_personal`).
- Contains bank, investment, property, rent, loan subledgers, and personal-use accounts.
- Does not contain GST or business income accounts.

**Proprietorship BookSet** (one or more per tenant):
- Each identified by a unique `book_set_id` (e.g., `bookset_consulting_biz`, `bookset_retail_biz`).
- Each contains a complete set of GL accounts for a single business entity with its own GSTIN (if applicable).
- Each independently balances; no cross-BookSet debit/credit pairs within a single posting.
- If a proprietorship has multiple GSTINs (uncommon; rare multi-branch setup), each GSTIN uses one BookSet with GSTIN-scoped GST operations.

### Relationship

```
Tenant (PAN)
├── Personal BookSet
│   ├── GL Accounts (bank, investment, property, rent, loan, personal expense, etc.)
│   ├── Postings (tenant_id + book_set_id)
│   └── Subledgers (bank, investment, property/rent, loan)
├── Proprietorship BookSet 1 (e.g., consulting)
│   ├── GL Accounts (revenue, expense, GST output/input, etc.)
│   ├── Postings (tenant_id + book_set_id)
│   ├── GSTIN (optional, if GST-registered)
│   └── Fixed-asset register (if applicable)
├── Proprietorship BookSet 2 (e.g., retail)
│   ├── GL Accounts (revenue, expense, GST output/input, etc.)
│   ├── Postings (tenant_id + book_set_id)
│   └── GSTIN (optional)
├── TaxCase (immutable aggregate of BookSet and source catalog)
│   ├── Period
│   ├── Filing sequence
│   ├── BookSet set (snapshot)
│   ├── External source set (snapshot)
│   └── Effective-dated rule bindings
└── External sources (AIS, 26AS, broker ledgers, bank statements, property/loan agreements)
    └── Each linked to TaxCase and required reconciliation
```

---

## 2. Physical Schema: Tables and Ownership

### Scope Declaration

**Every table owned by BookSets** carries both `tenant_id` and `book_set_id` columns as the composite primary scope. **Tenant-wide tables** carry only `tenant_id`. **Global/system tables** carry neither. **Queries and mutations enforce this scope invariant.**

### Core Tables

#### `tenants` (Tenant-Scoped)

```sql
CREATE TABLE tenants (
  tenant_id TEXT PRIMARY KEY,
  pan TEXT NOT NULL UNIQUE,  -- Individual PAN (immutable)
  tenant_type TEXT NOT NULL, -- 'individual_taxpayer' (or 'company_entity' for v1 backwards compatibility)
  base_currency TEXT NOT NULL DEFAULT 'INR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  fiscal_year_start_month INT NOT NULL DEFAULT 4,  -- April
  fiscal_year_end_month INT NOT NULL DEFAULT 3,    -- March
  default_report_basis TEXT NOT NULL DEFAULT 'cash', -- 'cash' | 'accrual'
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived' | 'suspended'

  -- Future RBAC placeholder
  created_actor_id TEXT,
  created_source TEXT,
  updated_actor_id TEXT,
  updated_source TEXT,

  CONSTRAINT valid_fiscal_year CHECK (fiscal_year_start_month BETWEEN 1 AND 12 AND fiscal_year_end_month BETWEEN 1 AND 12),
  CONSTRAINT valid_report_basis CHECK (default_report_basis IN ('cash', 'accrual')),
  CONSTRAINT valid_status CHECK (status IN ('active', 'archived', 'suspended'))
);

CREATE INDEX idx_tenants_pan ON tenants(pan);
CREATE INDEX idx_tenants_type_status ON tenants(tenant_type, status);
```

#### `book_sets` (Tenant-Owned Aggregate)

```sql
CREATE TABLE book_sets (
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  book_set_type TEXT NOT NULL, -- 'personal' | 'proprietorship'
  business_name TEXT,          -- NULL for personal; e.g., "Consulting LLC" for proprietorship
  gstin TEXT UNIQUE,           -- NULL if not GST-registered; unique within tenant+bookset
  default_account_id TEXT,     -- FK to default suspense/misc account for auto-balancing if needed
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL,

  PRIMARY KEY (tenant_id, book_set_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  CONSTRAINT valid_type CHECK (book_set_type IN ('personal', 'proprietorship')),
  CONSTRAINT valid_status CHECK (status IN ('active', 'archived')),
  CONSTRAINT one_personal_per_tenant CHECK (
    NOT (book_set_type = 'personal' AND
         (SELECT COUNT(*) FROM book_sets bs2
          WHERE bs2.tenant_id = book_sets.tenant_id AND bs2.book_set_type = 'personal') > 1)
  )
);

CREATE INDEX idx_book_sets_tenant_type ON book_sets(tenant_id, book_set_type);
CREATE INDEX idx_book_sets_gstin ON book_sets(gstin);
```

#### `accounts` (BookSet-Owned)

```sql
CREATE TABLE accounts (
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL, -- 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  parent_account_id TEXT,     -- FK to same (tenant_id, book_set_id) for hierarchy
  balance_sheet_class TEXT,   -- 'current_asset' | 'fixed_asset' | 'current_liability' | ... (optional)
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',

  PRIMARY KEY (tenant_id, book_set_id, account_id),
  FOREIGN KEY (tenant_id, book_set_id) REFERENCES book_sets(tenant_id, book_set_id),
  CONSTRAINT valid_account_type CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  CONSTRAINT valid_status CHECK (status IN ('active', 'archived'))
);

CREATE INDEX idx_accounts_type ON accounts(tenant_id, book_set_id, account_type);
```

#### `postings` (Immutable BookSet-Owned Ledger Entries)

```sql
CREATE TABLE postings (
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  posting_id TEXT NOT NULL,  -- Unique within (tenant_id, book_set_id)
  journal_entry_id TEXT NOT NULL,  -- Links to journal_entries table
  account_id TEXT NOT NULL,
  amount_minor_units INTEGER NOT NULL,  -- Currency in minor units (paise for INR)
  debit_credit TEXT NOT NULL,  -- 'debit' | 'credit'
  posting_date DATE NOT NULL,  -- Accounting date (immutable once set)
  source_document_id TEXT,  -- FK to source document (invoice, bill, journal, etc.)
  source_document_line_id TEXT,
  effective_rule_snapshot_id TEXT,  -- FK to rule_snapshots
  correction_lineage_id TEXT,  -- FK to correction_lineages for reversal/replacement
  posted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posted_by TEXT NOT NULL,

  PRIMARY KEY (tenant_id, book_set_id, posting_id),
  FOREIGN KEY (tenant_id, book_set_id) REFERENCES book_sets(tenant_id, book_set_id),
  FOREIGN KEY (tenant_id, book_set_id, account_id) REFERENCES accounts(tenant_id, book_set_id, account_id),
  CONSTRAINT valid_debit_credit CHECK (debit_credit IN ('debit', 'credit')),
  CONSTRAINT non_zero_amount CHECK (amount_minor_units != 0)
);

CREATE INDEX idx_postings_date ON postings(tenant_id, book_set_id, posting_date);
CREATE INDEX idx_postings_account ON postings(tenant_id, book_set_id, account_id);
CREATE INDEX idx_postings_source_doc ON postings(tenant_id, book_set_id, source_document_id);
CREATE INDEX idx_postings_journal_entry ON postings(tenant_id, book_set_id, journal_entry_id);
CREATE UNIQUE INDEX idx_postings_id_per_bookset ON postings(tenant_id, book_set_id, posting_id);
```

#### `journal_entries` (Immutable BookSet-Owned Aggregates)

```sql
CREATE TABLE journal_entries (
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL,
  entry_date DATE NOT NULL,  -- Posting date (immutable)
  description TEXT,
  total_debit_minor_units INTEGER NOT NULL,
  total_credit_minor_units INTEGER NOT NULL,
  source_document_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',  -- 'draft' | 'posted' | 'reversed'
  correction_lineage_id TEXT,

  PRIMARY KEY (tenant_id, book_set_id, journal_entry_id),
  FOREIGN KEY (tenant_id, book_set_id) REFERENCES book_sets(tenant_id, book_set_id),
  CONSTRAINT balanced CHECK (total_debit_minor_units = total_credit_minor_units),
  CONSTRAINT valid_status CHECK (status IN ('draft', 'posted', 'reversed'))
);

CREATE INDEX idx_journal_entries_date ON journal_entries(tenant_id, book_set_id, entry_date);
CREATE INDEX idx_journal_entries_source ON journal_entries(tenant_id, book_set_id, source_document_id);
```

#### `tax_cases` (Immutable Tenant-Scoped Aggregate)

```sql
CREATE TABLE tax_cases (
  tenant_id TEXT NOT NULL,
  tax_case_id TEXT NOT NULL,
  pan TEXT NOT NULL,  -- Denormalized for FK to tenants.pan
  period_key TEXT NOT NULL,  -- e.g., 'FY-2025-26'
  assessment_year TEXT NOT NULL,  -- e.g., 'AY-2026-27'
  filing_sequence INT NOT NULL,  -- 1 = original, 2+ = amended/rectified
  governing_act TEXT NOT NULL,  -- 'Income-Tax-Act-1961' | 'Income-Tax-Act-2025'
  rule_snapshot_id TEXT NOT NULL,  -- FK to rule_snapshots (effective-dated)
  schema_release TEXT NOT NULL,  -- Official ITR schema version (immutable)

  -- BookSet and source membership (immutable snapshot)
  applicable_bookset_ids TEXT NOT NULL,  -- JSON array of book_set_ids at case creation
  external_source_catalog TEXT NOT NULL,  -- JSON array of required sources (AIS, 26AS, broker, etc.)

  -- Status and staleness
  status TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'validated' | 'ready' | 'exported' | 'filed' | 'stale'
  stale_reason TEXT,  -- If status='stale', reason for staleness
  stale_at TIMESTAMP,  -- When marked stale
  stale_due_to_tax_case_id TEXT,  -- If superseded by newer case

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL,

  PRIMARY KEY (tenant_id, tax_case_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),  -- for PAN verification
  CONSTRAINT valid_status CHECK (status IN ('draft', 'validated', 'ready', 'exported', 'filed', 'stale')),
  CONSTRAINT valid_governing_act CHECK (governing_act IN ('Income-Tax-Act-1961', 'Income-Tax-Act-2025'))
);

CREATE UNIQUE INDEX idx_tax_case_unique ON tax_cases(tenant_id, period_key, filing_sequence);
CREATE INDEX idx_tax_case_status ON tax_cases(tenant_id, status);
```

#### `tax_case_bookset_membership` (Snapshot of BookSet Inclusion)

```sql
CREATE TABLE tax_case_bookset_membership (
  tenant_id TEXT NOT NULL,
  tax_case_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  inclusion_reason TEXT,  -- 'personal' | 'proprietorship_business_income' | ...
  included_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (tenant_id, tax_case_id, book_set_id),
  FOREIGN KEY (tenant_id, tax_case_id) REFERENCES tax_cases(tenant_id, tax_case_id),
  FOREIGN KEY (tenant_id, book_set_id) REFERENCES book_sets(tenant_id, book_set_id)
);

CREATE INDEX idx_membership_tax_case ON tax_case_bookset_membership(tenant_id, tax_case_id);
```

#### `external_sources` (Evidence and Reconciliation)

```sql
CREATE TABLE external_sources (
  tenant_id TEXT NOT NULL,
  tax_case_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,  -- 'AIS' | '26AS' | 'broker_ledger' | 'bank_statement' | 'property_agreement' | 'loan_agreement' | 'EPFO' | 'NPS'
  status TEXT NOT NULL DEFAULT 'unknown',  -- State machine: UNKNOWN | EXPECTED | INGESTED | RECONCILED | CONFLICT | INCOMPLETE | READY | STALE

  -- Raw artifact
  artifact_hash TEXT,  -- SHA-256 of raw file
  artifact_content_type TEXT,  -- 'application/json' | 'application/pdf' | 'text/csv' | ...
  artifact_storage_reference TEXT,  -- Path or S3 key
  parser_name TEXT,  -- e.g., 'aportalnew-parser-v2' | 'ais-json-parser-v1'
  parser_version TEXT,

  -- Identity and source period
  source_identity TEXT,  -- PAN | GSTIN | bank account | broker account | property ID | loan ID
  source_period_start DATE,
  source_period_end DATE,

  -- Reconciliation outcome
  reconciliation_outcome TEXT,  -- JSON or text summary
  reconciliation_conflicts TEXT,  -- JSON array of conflicts vs. books
  last_reconciled_at TIMESTAMP,

  -- Applicability and declaration
  declared_not_applicable_reason TEXT,  -- If status = DECLARED_NOT_APPLICABLE
  declared_not_applicable_by TEXT,  -- Actor
  declared_not_applicable_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL,

  PRIMARY KEY (tenant_id, tax_case_id, source_id),
  FOREIGN KEY (tenant_id, tax_case_id) REFERENCES tax_cases(tenant_id, tax_case_id),
  CONSTRAINT valid_status CHECK (status IN ('UNKNOWN', 'EXPECTED', 'INGESTED', 'RECONCILED', 'CONFLICT', 'INCOMPLETE', 'READY', 'STALE', 'DECLARED_NOT_APPLICABLE')),
  CONSTRAINT valid_source_type CHECK (source_type IN ('AIS', '26AS', 'broker_ledger', 'bank_statement', 'property_agreement', 'loan_agreement', 'EPFO', 'NPS'))
);

CREATE INDEX idx_external_sources_tax_case ON external_sources(tenant_id, tax_case_id);
CREATE INDEX idx_external_sources_status ON external_sources(tenant_id, tax_case_id, status);
CREATE INDEX idx_external_sources_type ON external_sources(tenant_id, tax_case_id, source_type);
```

#### `rule_snapshots` (Immutable Effective-Dated Authority Bindings)

```sql
CREATE TABLE rule_snapshots (
  rule_snapshot_id TEXT PRIMARY KEY,
  governing_act TEXT NOT NULL,  -- 'Income-Tax-Act-1961' | 'Income-Tax-Act-2025'
  effective_from DATE NOT NULL,
  effective_to DATE,  -- NULL if current
  rule_pack_version TEXT NOT NULL,  -- e.g., 'ITR-rules-2026-27-v1.2'
  rule_pack_hash TEXT NOT NULL,  -- SHA-256 of canonical rule pack
  rule_pack_signature TEXT,  -- Signed proof (future)
  jurisdiction TEXT NOT NULL,  -- 'India' or other
  source_url TEXT,  -- Canonical source of rules
  retrieved_at TIMESTAMP NOT NULL,
  notes TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_act CHECK (governing_act IN ('Income-Tax-Act-1961', 'Income-Tax-Act-2025'))
);

CREATE INDEX idx_rule_snapshots_act_effective ON rule_snapshots(governing_act, effective_from);
```

#### `correction_lineages` (Immutable Reversal and Replacement Tracking)

```sql
CREATE TABLE correction_lineages (
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  original_journal_entry_id TEXT NOT NULL,
  reversal_journal_entry_id TEXT,  -- FK to journal_entries
  replacement_journal_entry_id TEXT,  -- FK to journal_entries (for replacement after reversal)
  correction_reason TEXT NOT NULL,
  corrected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  corrected_by TEXT NOT NULL,

  PRIMARY KEY (tenant_id, book_set_id, lineage_id),
  FOREIGN KEY (tenant_id, book_set_id) REFERENCES book_sets(tenant_id, book_set_id)
);

CREATE INDEX idx_correction_lineages_original ON correction_lineages(tenant_id, book_set_id, original_journal_entry_id);
```

#### `audit_records` (Immutable BookSet-Owned Audit Trail)

```sql
CREATE TABLE audit_records (
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,  -- 'posting' | 'journal_entry' | 'account' | ...
  entity_id TEXT,
  change_summary TEXT,  -- JSON or text
  actor_id TEXT,
  actor_source TEXT,  -- 'user' | 'agent' | 'skill' | 'api' | ...
  request_id TEXT,  -- Idempotency key
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (tenant_id, book_set_id, audit_id),
  FOREIGN KEY (tenant_id, book_set_id) REFERENCES book_sets(tenant_id, book_set_id)
);

CREATE INDEX idx_audit_records_entity ON audit_records(tenant_id, book_set_id, entity_type, entity_id);
CREATE INDEX idx_audit_records_timestamp ON audit_records(tenant_id, book_set_id, timestamp);
```

---

## 3. Independent BookSet Balance Invariant

### Definition

**Each BookSet must independently balance:** ∑(debits in BookSet) = ∑(credits in BookSet)

### Enforcement

**At posting level**:
- No posting may affect more than one BookSet.
- Within a single BookSet, all debit and credit postings in a journal_entry must sum to zero.

**Constraint in schema**:
```sql
-- journal_entries table enforces: total_debit_minor_units = total_credit_minor_units
-- postings table: every posting references exactly one (tenant_id, book_set_id) pair
-- No FK allows a posting to reference an account in a different BookSet
```

**Transfers between BookSets**:
- A same-tenant transfer between two BookSets requires **two separate, linked journal entries**—one reversing/receiving in each BookSet.
- **Example**: Personal BookSet pays ₹1,000 to Consulting BookSet:
  - Personal Journal Entry: `Dr due-to-consulting ₹1,000 | Cr bank ₹1,000` (personal balances)
  - Consulting Journal Entry: `Dr bank ₹1,000 | Cr due-from-owner ₹1,000` (consulting balances)
  - Both BookSets independently balance; together, ownership transfer is explicit and auditable.

**Verification queries**:
```sql
-- Verify balance for a BookSet
SELECT
  SUM(CASE WHEN debit_credit = 'debit' THEN amount_minor_units ELSE 0 END) AS total_debits,
  SUM(CASE WHEN debit_credit = 'credit' THEN amount_minor_units ELSE 0 END) AS total_credits
FROM postings
WHERE tenant_id = ? AND book_set_id = ?;

-- Constraint: total_debits = total_credits (both should equal zero in balanced state)
```

---

## 4. Atomic Paired Same-Tenant Transfers

### Scope

**PT-003 (TENTATIVE)** specifies atomic same-tenant transfers between BookSets. The physical schema enforces this via:

### Design

**Transfer Document** (optional table for explicit transfer tracking):
```sql
CREATE TABLE bookset_transfers (
  tenant_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL,
  from_book_set_id TEXT NOT NULL,
  to_book_set_id TEXT NOT NULL,
  transfer_date DATE NOT NULL,
  transfer_type TEXT NOT NULL,  -- 'loan' | 'drawing' | 'capital_infusion' | 'expense_reclass' | ...
  purpose_description TEXT,
  total_amount_minor_units INTEGER NOT NULL,

  from_journal_entry_id TEXT NOT NULL,  -- FK to journal_entries in from_book_set
  to_journal_entry_id TEXT NOT NULL,    -- FK to journal_entries in to_book_set
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,

  PRIMARY KEY (tenant_id, transfer_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  -- Note: journal_entry_ids cannot be FK'd across book sets, so audit via manual verification
  CONSTRAINT valid_transfer_type CHECK (transfer_type IN ('loan', 'drawing', 'capital_infusion', 'expense_reclass', 'funding', 'other'))
);

CREATE INDEX idx_bookset_transfers_date ON bookset_transfers(tenant_id, transfer_date);
CREATE INDEX idx_bookset_transfers_journals ON bookset_transfers(from_journal_entry_id, to_journal_entry_id);
```

### Atomicity

- Both journal entries (in different BookSets) are posted in a **single database transaction**.
- The transaction succeeds only if **both journal entries post**; if either fails, both roll back.
- The `bookset_transfers` record is inserted in the same transaction.

### Fail-Closed Behavior

- If transfer scope is ambiguous (e.g., operator says "move ₹5,000" without specifying source/destination BookSet), the command returns `AMBIGUOUS_BOOKSET` and does not proceed.
- If one BookSet is inactive or archived, transfer is rejected.
- If transfer would violate account existence or debit-account setup in either BookSet, transaction rolls back.

---

## 5. TaxCase Immutable BookSet/Source Membership and Staleness

### Immutability

**At creation**:
- TaxCase snapshot records the exact set of applicable BookSets at that moment.
- TaxCase records the required external-source catalog (AIS, 26AS, broker, etc.) deterministically enumerated from taxpayer facts and applicable BookSets.
- Both snapshots are **immutable**: `applicable_bookset_ids` and `external_source_catalog` are never modified on the existing case.

**Tables**:
- `tax_cases.applicable_bookset_ids`: JSON array; inserted at creation; never updated.
- `tax_cases.external_source_catalog`: JSON array; inserted at creation; never updated.
- `tax_case_bookset_membership`: Immutable linking table created at case creation.

### Staleness and Re-Enumeration

**Trigger for staleness**:
1. A new BookSet is created in the tenant.
2. An existing BookSet becomes applicable (e.g., a new proprietorship starts).
3. An external source is added or modified (e.g., AIS/26AS imported for the first time).
4. An existing applicable source is marked as STALE.

**Re-enumeration workflow**:
1. Before `validate`, `export`, `submit`, or `finalize` actions, re-enumerate the current applicable BookSet set and required external-source set.
2. Compare to the immutable snapshot in the TaxCase.
3. **If membership changed**:
   - Mark the existing case as `STALE`.
   - Block the affected action (e.g., export or filing).
   - Propose to create a **new linked successor** case with updated membership.
   - The original case remains immutable, visible with its `STALE` marker and a link to the successor.

**Schema**:
```sql
-- In tax_cases table:
status TEXT NOT NULL DEFAULT 'draft',  -- includes 'stale'
stale_reason TEXT,                      -- Reason for staleness
stale_due_to_tax_case_id TEXT,          -- Link to successor case
```

### Non-Enumerated or Empty Catalog

- **Fail-closed**: A case with zero required sources or an enumeration failure cannot reach `READY` status.
- **Visible**: An operator must see the exact required sources and their status in order to proceed.

---

## 6. Raw Source Preservation and Reconciliation

### File-First Acquisition (PT-009 OWNER-APPROVED)

- V1 is file-first: Users download supported bank, broker, mutual-fund, AIS/26AS, and other artifacts; Agent-Bahi imports them.
- No credentials stored, no portal scraping, no browser automation.
- Every raw artifact is immutable and content-addressed.

### Raw Artifact Storage

```sql
CREATE TABLE evidence_artifacts (
  tenant_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL UNIQUE,  -- SHA-256 of raw bytes
  artifact_content_type TEXT NOT NULL,  -- 'application/json' | 'application/pdf' | 'text/csv'
  artifact_size_bytes INTEGER NOT NULL,
  storage_reference TEXT NOT NULL,  -- Local path or S3 key
  parser_name TEXT,  -- e.g., 'aportalnew-parser-v2'
  parser_version TEXT,
  parser_release_hash TEXT,  -- Hash of parser code for reproducibility
  retrieved_at TIMESTAMP NOT NULL,
  retrieved_by TEXT NOT NULL,

  PRIMARY KEY (tenant_id, artifact_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);

CREATE UNIQUE INDEX idx_evidence_hash ON evidence_artifacts(artifact_hash);
CREATE INDEX idx_evidence_parser ON evidence_artifacts(parser_name, parser_version);
```

### Derived Records

```sql
CREATE TABLE external_source_derived_records (
  tenant_id TEXT NOT NULL,
  tax_case_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  derived_record_id TEXT NOT NULL,
  source_artifact_id TEXT NOT NULL,  -- FK to evidence_artifacts
  derived_data JSONB,  -- Parsed output (AIS categories, 26AS TDS entries, broker transactions, etc.)
  parser_warnings TEXT,  -- Any parser notes (non-blocking)
  derived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (tenant_id, tax_case_id, source_id, derived_record_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (source_artifact_id) REFERENCES evidence_artifacts(tenant_id, artifact_id)
);
```

### No Overwrite; Reconciliation by Linking

- A duplicate artifact re-import creates a new evidence record with a new derived set.
- Original remains linked; operator sees both.
- Reconciliation (books vs. AIS, 26AS, etc.) creates explicit **linked reconciliation records**, never automatic ledger mutation.

---

## 7. Effective-Dated Authority Snapshot Bindings

### Immutable Rule Binding

Every TaxCase binds **five facts atomically and immutably** (PT-007 TENTATIVE):

1. **Governing Act** (e.g., 'Income-Tax-Act-2025' for AY 2026-27)
2. **Period** (e.g., FY 2025-26, AY 2026-27)
3. **Trigger** (original filing, amended filing, rectified filing, etc.)
4. **Official schema or validator release** (frozen version of ITR forms)
5. **Effective-dated rule snapshot** (hash + version of compliance rules)

### Storage

```sql
-- In tax_cases table:
governing_act TEXT NOT NULL,  -- 'Income-Tax-Act-1961' | 'Income-Tax-Act-2025'
rule_snapshot_id TEXT NOT NULL,  -- FK to rule_snapshots
schema_release TEXT NOT NULL,  -- Official ITR schema version

-- In rule_snapshots table:
rule_snapshot_id TEXT PRIMARY KEY,
governing_act TEXT NOT NULL,
effective_from DATE NOT NULL,
effective_to DATE,
rule_pack_version TEXT NOT NULL,
rule_pack_hash TEXT NOT NULL,
```

### Fail-Closed

- Missing, stale, conflicting, or unapproved rule binding → TaxCase marked `REVIEW/BLOCK`.
- Schema validation alone never marks a case legally correct; rule binding is mandatory.

---

## 8. Correction Lineage

### Immutable Reversal and Replacement

Posted documents are corrected through:

1. **Reversal**: A linked journal entry that reverses the original (all debits become credits and vice versa).
2. **Replacement**: A new correct journal entry.
3. Both are linked in an immutable **correction lineage**.

### Schema

```sql
CREATE TABLE correction_lineages (
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  original_journal_entry_id TEXT NOT NULL,
  reversal_journal_entry_id TEXT,
  replacement_journal_entry_id TEXT,
  correction_reason TEXT NOT NULL,
  corrected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  corrected_by TEXT NOT NULL,

  PRIMARY KEY (tenant_id, book_set_id, lineage_id),
  FOREIGN KEY (tenant_id, book_set_id) REFERENCES book_sets(tenant_id, book_set_id)
);
```

### Queries and Audit

- Original posting remains immutable and visible.
- Reversal and replacement form an immutable linked chain.
- Reports/TaxCases linked to the original are marked `STALE` (per T-008) and require regeneration.

---

## 9. Privacy Boundaries

### Scope

PT-015 (TENTATIVE) specifies product telemetry and data protection for personal-tax content.

### Personal-Tax Data Classification

- **Personal-tax content**: Income amounts, asset holdings, loan details, bank accounts, investment accounts, tax-case data, compliance filings, evidence artifacts.
- **Classification**: Sensitive personal financial data.

### Controls

1. **Telemetry**: Disabled by default for personal-tax operations.
   ```sql
   CREATE TABLE telemetry_config (
     tenant_id TEXT PRIMARY KEY,
     telemetry_enabled BOOLEAN DEFAULT FALSE,
     telemetry_classification TEXT,  -- 'high_sensitivity' for personal-tax
     FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
   );
   ```

2. **Audit and security logs**: Required; immutable.
   - Every mutation recorded with actor, timestamp, resource, action, outcome.
   - Logs redact PII and financial amounts in operational output.
   - Audit subsystem retains full detail for compliance.

3. **Evidence storage**: Access-controlled; separate from operational logs.
   - Content-addressed with hash-based retrieval.
   - Immutable; no accidental overwrite.

4. **Remote connections**: TLS required for PostgreSQL and MySQL deployments.

5. **Secrets management**: No credentials in logs, exports, or bundles.
   - API keys, DSCs, bank auth → environment variables or vault.
   - Connection strings redacted in operational logs.

### No Blanket Claims

- No automatic DPDP/CERT-In/RBI compliance claim.
- Data protection is evidence-backed, audit-recorded, and subject to actual deployment assessment.
- DPDP Act and Rules are research sources for specific applicability decisions; not universal waivers.

---

## 10. SQLite, PostgreSQL, MySQL Constraints and Index Concepts

### Multi-Dialect Design

Three parallel migration paths ensure identical logical behavior across dialects:

- `migrations/sqlite/`
- `migrations/postgres/`
- `migrations/mysql/`

### Constraint Equivalence

| Logical Constraint | SQLite | PostgreSQL | MySQL |
|---|---|---|---|
| Primary Key | PRIMARY KEY | PRIMARY KEY | PRIMARY KEY |
| Foreign Key | FOREIGN KEY + PRAGMA foreign_keys=ON | FOREIGN KEY with ON DELETE/UPDATE policies | FOREIGN KEY with ON DELETE/UPDATE policies |
| Unique | UNIQUE | UNIQUE | UNIQUE |
| Check Constraint | CHECK | CHECK | CHECK (MySQL 8.0.16+; ignored in older versions) |
| Not Null | NOT NULL | NOT NULL | NOT NULL |
| Default | DEFAULT | DEFAULT | DEFAULT |
| Composite Keys | PRIMARY KEY (a, b, c) | PRIMARY KEY (a, b, c) | PRIMARY KEY (a, b, c) |
| ON DELETE/UPDATE | CASCADE / RESTRICT / NO ACTION | CASCADE / RESTRICT / NO ACTION / SET NULL | CASCADE / RESTRICT / NO ACTION / SET NULL |

### Index Concepts

**Covering indexes** (queries that retrieve all columns from the index without fetching the table):
```sql
-- SQLite: No explicit INCLUDE syntax; all indexed columns are available.
-- PostgreSQL: INCLUDE clause available (v11+).
-- MySQL: Covered queries require all columns in the index or via clustering key.

-- Recommended for tenant/book_set lookups:
CREATE INDEX idx_postings_date_account ON postings(tenant_id, book_set_id, posting_date) INCLUDE (account_id, amount_minor_units, debit_credit);
```

**Unique indexes** (prevent duplicates):
```sql
CREATE UNIQUE INDEX idx_tax_case_unique ON tax_cases(tenant_id, period_key, filing_sequence);
```

**Partial indexes** (index only matching rows; PostgreSQL & SQLite only):
```sql
-- SQLite & PostgreSQL:
CREATE INDEX idx_active_book_sets ON book_sets(tenant_id) WHERE status = 'active';

-- MySQL: simulate with generated column + index if needed
```

### Optimization Guidance

1. **Query by tenant_id first**: All queries include tenant_id as the first filter.
2. **Then by book_set_id** (if applicable).
3. **Then by specific filters** (date, account, status).
4. **Joins**: Prefer single-tenant/book_set queries; avoid cross-tenant joins.

### Foreign Key Configuration

**SQLite**:
```sql
PRAGMA foreign_keys = ON;  -- Must be set at connection time
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

**PostgreSQL**:
```sql
-- Foreign keys enforced by default; no pragma needed.
-- Use ON DELETE CASCADE or ON DELETE RESTRICT as appropriate.
```

**MySQL**:
```sql
-- Foreign keys enforced in InnoDB; not in MyISAM.
-- Ensure innodb_foreign_key_checks = 1 at session level if needed.
```

---

## 11. Fail-Closed Tenant-Only and Cross-BookSet Access Rules

### Tenant Isolation (Non-Negotiable)

**Every query and mutation must include tenant_id and be scoped to exactly one tenant.**

### Rules

1. **Command-level tenant selection**:
   - If exactly one active tenant → auto-select without `--tenant` flag.
   - If more than one active tenant → require `--tenant <name>`; fail explicitly on ambiguity.
   - Echo effective tenant in all output (human and JSON).

2. **Query-level enforcement**:
   ```sql
   -- ✗ FORBIDDEN: SELECT * FROM postings WHERE ...
   -- ✓ REQUIRED: SELECT * FROM postings WHERE tenant_id = ? AND book_set_id = ? AND ...
   ```

3. **Cross-BookSet reads**:
   - TaxCase aggregations (read-only) are separately authorized.
   - A CA user granted access to one BusinessSet cannot read another without explicit separate authorization (future RBAC; v1 no-op).

4. **Cross-BookSet writes**:
   - **Prohibited in v1**: No atomic write across two BookSets in a single database statement.
   - Transfers use **two separate journal entries** (one per BookSet), posted in a single database transaction.
   - If transaction fails, both roll back; never partial success.

### Access Control Hooks (v1 No-Op, v2 Enforced)

```typescript
// Pseudocode for future RBAC
function authorizeQuery(actor, action, resource) {
  // v1: no-op (return true always)
  // v2: Check actor has permission for action on resource/tenant/book_set
  return true;  // v1
}

// Every command includes actor context
interface CommandContext {
  tenantId: string;
  bookSetId?: string;  // If applicable
  actorId: string;
  actorSource: 'user' | 'agent' | 'skill' | 'api';
}
```

### Blocking Scenarios

1. **Cross-tenant query**: Query without tenant_id → ERROR: "TENANT_CONTEXT_REQUIRED"
2. **Ambiguous BookSet**: Command affecting multiple BookSets without explicit `--book-set` → ERROR: "AMBIGUOUS_BOOKSET"
3. **Unrelated access**: User grants access to BookSet A; they attempt to query BookSet B → ERROR: "UNAUTHORIZED_BOOKSET_ACCESS" (v2)

---

## 12. Migration and Gate0 Proof Obligations

### Gate0 Mandatory Proof Spikes

This RFC is **not implementation** and does not authorize Gate0. The following are mandatory proof obligations before any personal-tax schema code is written:

#### SPK-PT-001: Multi-Dialect Schema Conformance

**Proof Requirement**: Demonstrate that the proposed schema tables, constraints, indexes, and data types work identically across SQLite, PostgreSQL, and MySQL.

**Evidence**:
- Schema DDL files for all three dialects (migrations/sqlite/*.sql, migrations/postgres/*.sql, migrations/mysql/*.sql).
- Proof that a fresh install on each dialect produces the same logical schema.
- Proof that an upgrade path (migration N → N+1) is reproducible on all three dialects.
- Test cases covering:
  - Foreign key cascade/restrict behavior on all three.
  - Check constraints (MySQL 8.0.16+ only; fallback or version gate for older MySQL).
  - Unique indexes and deduplication.
  - Composite primary keys.

#### SPK-PT-002: BookSet Isolation and Balance Verification

**Proof Requirement**: Demonstrate that queries and postings enforce BookSet isolation and that balance invariants are automatically verified.

**Evidence**:
- End-to-end test: Two BookSets in one tenant; post to each independently; verify both balance separately.
- Test that a cross-BookSet posting is rejected (if attempted).
- Test that a same-tenant transfer (two linked journal entries) posts atomically: both succeed or both fail.
- Test that balance verification queries produce correct results across all dialects.
- Performance test: Balance verification on a large BookSet (1M+ postings) completes in acceptable time (< 5s per dialect).

#### SPK-PT-003: TaxCase Membership Immutability and Staleness

**Proof Requirement**: Demonstrate that TaxCase membership snapshots are immutable and that staleness is correctly detected and marked.

**Evidence**:
- End-to-end test: Create a TaxCase with BookSets A, B; then create BookSet C in the same tenant.
- Verify that the original TaxCase is marked STALE.
- Verify that a new linked successor TaxCase can be created with updated membership (A, B, C).
- Verify that both cases remain visible and linked.
- Test re-enumeration logic under various scenarios: new BookSet, BookSet status change, new external source added.

#### SPK-PT-004: Evidence Preservation and No-Overwrite

**Proof Requirement**: Demonstrate that raw artifacts are preserved and never silently overwritten.

**Evidence**:
- End-to-end test: Import AIS JSON twice (same PAN, same period, same content).
- Verify that both artifacts are stored and visible (second is not deduplicated silently; or deduplication is explicit with a link).
- Verify that parser warnings do not cause the derived records to disappear.
- Verify that a re-import with different content creates a new artifact record, not an overwrite.

#### SPK-PT-005: Correction Lineage and Staleness Cascade

**Proof Requirement**: Demonstrate that corrections (reversal + replacement) are immutable and that affected reports/TaxCases are correctly marked STALE.

**Evidence**:
- End-to-end test: Post a personal expense journal entry; export a P&L report; then post a reversal + replacement.
- Verify that the original journal and the correction are both visible and immutably linked.
- Verify that the P&L report generated earlier is atomically marked STALE in the same transaction as the correction.
- Verify that re-generating the P&L after the correction shows the correct updated result.

#### SPK-PT-006: Deterministic TaxCase Enumeration and Rule Binding

**Proof Requirement**: Demonstrate that TaxCase enumeration (applicable BookSets and required sources) is deterministic and that rule snapshots are immutable.

**Evidence**:
- End-to-end test: Create a TaxCase twice with the same tenant, period, and governing act.
- Verify that both enumerations produce identical BookSet and source catalogs.
- Verify that the rule_snapshot_id is identical and bound immutably.
- Test that changing the rule pack version (e.g., 2026-27 rule pack → 2027-28 rule pack) does not mutate existing cases; new cases bind the new snapshot.
- Verify queries that enumerate required sources based on taxpayer facts and applicable BookSets.

### Implementation-Blocking Gates

The following must be resolved before Phase 1 implementation:

1. **Owner review and architect review** of this RFC and all PT decisions.
2. **Completion of all six proof spikes** (SPK-PT-001 through SPK-PT-006).
3. **Approval of multi-dialect migration scripts** and schema versioning strategy.
4. **Approval of rule-pack format and effective-dating model** (PT-007).
5. **Approval of TaxCase preparation and filing workflows** (PT-005, PT-010, PT-013).
6. **Approval of privacy and audit boundaries** (PT-015).
7. **Approval of correction and amendment mechanisms** (PT-016).

---

## 13. Appendix: Data-Model Change Summary

### Breaking Change: One Legal Entity, Multiple BookSets

**Before** (v0): One tenant = one legal entity = one balanced book.

**After** (v1 with PT-001): One tenant = one individual/PAN = multiple independent BookSets (personal + one or more proprietorships).

**Impact**:
- All queries must include `book_set_id` scope.
- Existing `SELECT ... FROM accounts` queries must now include `WHERE book_set_id = ?`.
- Balance verification requires per-BookSet aggregation, not global aggregation.
- Reports must explicitly aggregate across BookSets (with visibility of which BookSets are included).
- Cross-BookSet transfers require explicit two-journal-entry pattern.

### Backward Compatibility

- Company entity tenants (multi-tenant v1) are unchanged: one tenant, one BookSet, one GST registration each.
- Individual taxpayer tenants are new: inherit the multi-BookSet model.
- No existing data migration from prior releases (this is pre-implementation schema).

---

## 14. Review and Approval Gates

This RFC is discovery documentation and **requires**:

- ✓ Owner review and explicit approval of multi-BookSet model and personal-tax scope.
- ✓ Architect review of schema design, constraint enforcement, multi-dialect correctness, access control, and privacy boundaries.
- ✓ All six proof spikes (SPK-PT-001 through SPK-PT-006) passed with evidence.
- ✓ Owner and architect approval of each PT decision (PT-002 through PT-008, PT-010 through PT-016).

**This RFC does NOT authorize**:
- Gate0 or any implementation.
- Phase 1 or any code writing.
- Library approvals or dependency selection.
- Data model deployment until all approvals are recorded.

---

**End of RFC**
