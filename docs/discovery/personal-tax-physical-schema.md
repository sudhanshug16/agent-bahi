# Personal Tax Physical-Schema RFC

**Status:** NOT ARCHITECT-REVIEWED; owner approval recorded for corresponding PT decisions (PT-001 through PT-016 all OWNER-APPROVED).

**Scope:** This is a documentation-only, dialect-neutral relational contract for the personal-tax data model. It grants no Gate0, implementation, CLI, migration, library, or code authority. All 16 PT decisions (PT-001 through PT-016) have the status **OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. See the canonical [personal-tax decision packet](personal-tax-scope.md), including all anchors PT-001 through PT-016.

This document deliberately contains no executable schema, dialect syntax, migration, or claim of mechanical validation. The contract describes required identities, relationships, immutability, and transaction gates. Gate0 proof obligations remain open.

## 1. Relational scope

- Tenant-owned rows carry `tenant_id`.
- BookSet-owned rows carry both `tenant_id` and `book_set_id`; every relationship to a BookSet-owned row uses that same composite scope.
- TaxCase rows are tenant-scoped and aggregate BookSets without merging their ledgers.
- Cross-tenant joins, postings, derived evidence, transfers, and successor links are prohibited.
- Membership and other authoritative relationships are normalized rows. JSON, text blobs, arbitrary metadata, and snapshots may preserve evidence or evaluated facts, but never replace relational membership, status, ownership, or authority bindings.
- Posted financial rows, membership rows, authority bindings, evidence, status evidence, correction metadata, and audit rows are append-only. Corrections create linked rows; they do not rewrite the original.

## 2. Entity contract

The following is the complete contract for the entities in this RFC. A future implementation may choose names or physical types only after owner and architect review and Gate0 evidence; it must preserve these keys, relationships, and gates.

### 2.1 `tenants`

- **Fields:** `tenant_id`, immutable `pan`, `tenant_type`, `base_currency`, `status`, creation and actor metadata.
- **Primary key:** `tenant_id`.
- **Unique keys:** `UNIQUE(pan)` globally unique across PAN tenants; `UNIQUE(tenant_id, pan)` is the required matching candidate key for TaxCase composite FK. Duplicate tenant creation for an existing PAN fails; this prevents one taxpayer from being split across tenants and returns.
- **Foreign keys:** none.
- **Immutability:** PAN and tenant identity are immutable after creation; lifecycle status changes are audited.
- **Gate:** only a valid individual/PAN tenant can own personal-tax BookSets or TaxCases.

### 2.2 `book_sets`

- **Fields:** `tenant_id`, `book_set_id`, `book_set_type` (`personal` or `proprietorship`), business identity/GSTIN where applicable, `default_account_id`, lifecycle status, creation and actor metadata.
- **Primary key:** `(tenant_id, book_set_id)`.
- **Unique keys:** tenant-local BookSet identity; any GSTIN uniqueness must include the owning tenant and follow the reviewed canonical contract.
- **Foreign keys:** `(tenant_id)` to `tenants`; `(tenant_id, book_set_id, default_account_id)` to `accounts` when a default account is present.
- **Immutability:** tenant ownership and BookSet type are immutable; status changes are audited.
- **Gates:** exactly one personal BookSet exists for a PAN tenant across its lifetime, including when that row is archived. This requires a full-history database uniqueness/guard over personal rows; it cannot be an active-only or partial guard. A replacement or migration preserves the existing personal BookSet identity and cannot create a second one. A default account must belong to the same tenant and BookSet; archived or suspended BookSets cannot receive new postings or transfer legs.

### 2.3 `accounts`

- **Fields:** `tenant_id`, `book_set_id`, `account_id`, immutable `account_code`, name, account type, nullable `parent_account_id`, lifecycle status, creation metadata.
- **Primary key:** `(tenant_id, book_set_id, account_id)`.
- **Unique keys:** immutable `(tenant_id, account_code)` across the full tenant account table, including archived rows, and account identity within its BookSet. This is a full-table uniqueness rule, never a partial or active-only rule; an account code is never reused.
- **Foreign keys:** `(tenant_id, book_set_id)` to `book_sets`; nullable `(tenant_id, book_set_id, parent_account_id)` to `accounts` for the hierarchy.
- **Immutability:** identity, ownership, account code, and parent lineage are immutable once referenced by a posting; archival is append-only/audited and never releases the code.
- **Gates:** parent and default ownership are same-BookSet database relationships; a parent or default from another tenant or BookSet is rejected by the database relationship, not by application convention.

### 2.4 `journal_entries`

- **Fields:** `tenant_id`, `book_set_id`, `journal_entry_id`, entry date, currency, description, source reference, lifecycle (`draft`, `posted`, `reversed`), creation metadata.
- **Primary key:** `(tenant_id, book_set_id, journal_entry_id)`.
- **Unique keys:** journal identity within its BookSet.
- **Foreign keys:** `(tenant_id, book_set_id)` to `book_sets`; correction references use the composite journal key.
- **Immutability:** a posted or reversed journal cannot be edited or deleted.
- **Gates:** a journal becomes `posted` only within the transaction that inserts its postings and passes the actual-postings balance gate; caller-supplied totals are not authority.

### 2.5 `postings`

- **Fields:** NOT NULL: `tenant_id`, `book_set_id`, `posting_id`, `journal_entry_id`, `account_id`, signed side (`debit` or `credit`), non-zero amount, currency, posting date. Nullable: source reference, rule snapshot reference (required only where applicable rule exists).
- **Primary key:** `(tenant_id, book_set_id, posting_id)`.
- **Unique keys:** posting identity within its BookSet.
- **Foreign keys:** `(tenant_id, book_set_id, journal_entry_id)` to `journal_entries`; `(tenant_id, book_set_id, account_id)` to `accounts`; any evidence or rule reference uses a composite tenant-aware database relationship and is tenant-compatible.
- **Immutability:** postings are immutable after insertion; a correction uses reversal and replacement postings.
- **Gates:** every posting carries the same tenant, BookSet, and journal scope; actual debit and credit postings must agree in amount and currency before the journal is posted. No posting can cross a BookSet or tenant.

### 2.6 `bookset_transfers`

- **Fields:** NOT NULL: `tenant_id`, `transfer_id`, `source_book_set_id`, `destination_book_set_id`, amount, currency, purpose, `evidence_artifact_id`, `source_journal_entry_id`, `destination_journal_entry_id`. Nullable: posted status, creation metadata non-identity fields.
- **Primary key:** `(tenant_id, transfer_id)`.
- **Unique keys:** transfer identity within the tenant.
- **Foreign keys:** `(tenant_id, source_book_set_id)` to book_sets; `(tenant_id, destination_book_set_id)` to book_sets; `(tenant_id, source_book_set_id, source_journal_entry_id)` to journal_entries; `(tenant_id, destination_book_set_id, destination_journal_entry_id)` to journal_entries; `(tenant_id, evidence_artifact_id)` to evidence_artifacts where evidence can be non-receipt explanatory evidence but the evidence reference is required NOT NULL.
- **Constraints:** CHECK `source_book_set_id != destination_book_set_id` (source and destination must differ); both source and destination journal legs required NOT NULL.
- **Immutability:** a posted transfer and its leg bindings are immutable.
- **Gates:** source and destination BookSets are in same tenant; composite FKs enforce tenant/BookSet/journal scope for each leg; evidence artifact is tenant-scoped; both legs posted in one atomic transaction; both legs have same amount, currency, purpose, evidence; actual postings agree with transfer; any failure rolls back both legs and transfer row.

### 2.7 `income_periods`

- **Fields:** normalized income-period key, start and end dates, assessment-year identity, governing Act identity.
- **Primary key:** normalized period key.
- **Unique keys:** assessment-year mapping is unique for the applicable period.
- **Foreign keys:** none; it is the period authority used by TaxCases and rule snapshots.
- **Immutability:** period identity and Act mapping are immutable once referenced.
- **Gate:** governing Act selection is derived solely from the normalized income period, never from TaxCase creation date, filing date, or a user label.

### 2.8 `rule_snapshots`

- **Fields:** `rule_snapshot_id`, normalized period key, governing Act, filing trigger, effective interval, version, content hash, source reference, retrieval metadata, compatibility state.
- **Primary key:** `rule_snapshot_id`.
- **Unique keys:** `(period_key, version, content_hash)`.
- **Candidate keys:** `UNIQUE(rule_snapshot_id, governing_act, period_key, filing_trigger)` — exact applicability tuple for composite FK targets.
- **Foreign keys:** period key to `income_periods`.
- **Immutability:** a snapshot, hash, effective interval, and compatibility decision are immutable.
- **Gates:** a TaxCase may bind only a snapshot compatible with its normalized period and Act; missing, stale, conflicting, or unapproved authority yields `REVIEW/BLOCK`.

### 2.9 `official_artifacts`

- **Fields:** `official_artifact_id`, `artifact_kind` (SCHEMA, VALIDATION_RULES, UTILITY_REFERENCE, INSTRUCTIONS), immutable `artifact_hash`, official source reference, release version, effective dates, schema/utility version where applicable, retrieval metadata.
- **Primary key:** `official_artifact_id`.
- **Unique keys:** `UNIQUE(official_artifact_id, artifact_kind, artifact_hash)` — exact identity tuple is globally unique and immutable.
- **Foreign keys:** none (this is a narrow immutable non-tenant catalog).
- **Immutability:** all fields immutable; catalog is append-only. A new official release creates a new row.
- **Scope:** Global non-tenant immutable catalog of official artifacts. No tenant_id column.
- **Gates:** Authority pack components reference this catalog by exact (official_artifact_id, artifact_kind, artifact_hash) tuple. Missing artifact yields REVIEW/BLOCK.

### 2.9a `eligibility_fact_sets`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `pan`, `period_key`, `filing_sequence`, `governing_act`, `filing_trigger`, `fact_set_id`, `fact_schema_version`, `rule_snapshot_id`, `fact_set_hash`, `sealed_at`, `sealed_by`. Nullable: none (all required for sealed fact provenance and exact rule applicability).
- **Primary key:** `(tenant_id, tax_case_id, fact_set_id)`.
- **Candidate keys:** `UNIQUE(tenant_id, tax_case_id, fact_set_id, fact_set_hash, pan, period_key, filing_sequence, governing_act, filing_trigger, rule_snapshot_id)` — exact immutable fact-set identity including its full TaxCase/rule applicability tuple; candidate key for the composite FK from FilingSnapshot.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, pan, period_key, filing_sequence, governing_act, filing_trigger, rule_snapshot_id)` to the TaxCase candidate key `UNIQUE(tenant_id, tax_case_id, pan, period_key, filing_sequence, governing_act, filing_trigger, rule_snapshot_id)`; composite FK `(rule_snapshot_id, governing_act, period_key, filing_trigger)` to the rule_snapshots candidate key `UNIQUE(rule_snapshot_id, governing_act, period_key, filing_trigger)`. These relationships make a fact set's case, period, Act, trigger, and rule snapshot exact and inseparable.
- **Immutability:** fact_set_id, fact_schema_version, TaxCase/rule applicability fields, rule_snapshot_id, canonical fact payload/manifest, fact_set_hash, sealed_at, and sealed_by are all immutable after creation. Fact sets are append-only; facts cannot be recomputed in place.
- **Scope:** Owned by one exact TaxCase/rule snapshot tuple. A TaxCase may identify its current canonical fact set, but every FilingSnapshot MUST carry eligibility_fact_set_id+hash and the same pan, period, sequence, Act, trigger, and rule_snapshot_id, then composite-FK the complete tuple to this sealed fact set.
- **Contents:** Immutable frozen eligibility facts (determined form applicability, taxpayer status, income sources, filing obligations, entity classification) with exact evidence provenance. `fact_set_hash` is computed over the canonical fact payload/manifest, the ordered evidence `(evidence_artifact_id, evidence_artifact_hash)` tuples, `fact_schema_version`, the full applicability tuple `(pan, period_key, filing_sequence, governing_act, filing_trigger, rule_snapshot_id)`, and the rule snapshot. The hash input explicitly excludes `fact_set_hash` itself, `fact_set_id`, `sealed_at`, `sealed_by`, and all mutable metadata; it has no self-reference.
- **Gates:** Facts are sealed atomically at TaxCase creation or explicit eligibility determination. Facts cannot be recomputed retroactively; changes require successor TaxCase (PT-016) with a new fact set. FilingSnapshot must reference its exact applicable fact set via the complete composite FK; a stale or different-rule fact set is structurally impossible.

### 2.10 `authority_packs`

- **Fields:** `authority_pack_id`, governing Act, applicable period, filing trigger, `rule_snapshot_id`, `schema_artifact_id`, `schema_artifact_kind` (fixed='SCHEMA'), `schema_artifact_hash`, `validation_rules_artifact_id`, `validation_rules_artifact_kind` (fixed='VALIDATION_RULES'), `validation_rules_artifact_hash`, `utility_reference_artifact_id`, `utility_reference_artifact_kind` (fixed='UTILITY_REFERENCE'), `utility_reference_artifact_hash`, `instructions_artifact_id`, `instructions_artifact_kind` (fixed='INSTRUCTIONS'), `instructions_artifact_hash`, `pack_content_hash` (computed over ordered four role+ID+kind+hash tuples plus Act/period/trigger/provenance), official source reference, effective dates, compatibility metadata.
- **Primary key:** `authority_pack_id`.
- **Unique keys:** `UNIQUE(authority_pack_id, pack_content_hash)` — exact immutable pack identity.
- **Candidate keys:** `UNIQUE(authority_pack_id, pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id)` — sealed applicability/rule tuple for general lookup. `UNIQUE(authority_pack_id, pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, schema_artifact_id, schema_artifact_hash)` — exact pack applicability/rule/schema tuple for TaxCase and FilingSnapshot composite FK targets. `UNIQUE(governing_act, period_key, filing_trigger, pack_content_hash)` optional secondary candidate key for governance/timing lookup.
- **Foreign keys:** period to `income_periods`; composite FK `(rule_snapshot_id, governing_act, period_key, filing_trigger)` to rule_snapshots exact candidate key ensuring rule compatibility; four composite FKs to `official_artifacts` via exact triple: `(schema_artifact_id, schema_artifact_kind, schema_artifact_hash)`, `(validation_rules_artifact_id, validation_rules_artifact_kind, validation_rules_artifact_hash)`, `(utility_reference_artifact_id, utility_reference_artifact_kind, utility_reference_artifact_hash)`, `(instructions_artifact_id, instructions_artifact_kind, instructions_artifact_hash)`. All four are NOT NULL; each kind enum enforced by CHECK constraint. The schema artifact ID/hash projected into TaxCase and FilingSnapshot is the exact value from this sealed pack, not a caller-selected substitute.
- **Immutability:** pack ID, all four component ID/kind/hash triples, Act, period, trigger, rule_snapshot_id, pack_content_hash, source, and effective interval are immutable after creation. Pack is created atomically only when all four component triples and rule_snapshot are present and valid; no intermediate or incomplete state exists.
- **Atomicity:** All four artifacts and rule_snapshot binding must be bound at creation time in one atomic transaction. Missing any component or rule_snapshot prevents pack creation.
- **Contents:** An AuthorityPack is an immutable sealed bundle containing exactly four independently hashed immutable component bindings (schema, validation rules, utility reference/version, instructions), plus applicable period, filing trigger, governing Act, and immutable rule_snapshot_id.
- **Gate:** every FilingSnapshot and TaxCase must bind exactly one compatible AuthorityPack by exact `(authority_pack_id, pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, schema_artifact_id, schema_artifact_hash)` composite FK. Missing or incompatible pack returns REVIEW/BLOCK. Pack is fully sealed and ready upon creation; no incremental completion states.

### 2.11 `tax_cases`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `pan`, normalized `period_key`, assessment year, ordinal `filing_sequence` (CHECK `filing_sequence > 0`), filing trigger, governing Act, `rule_snapshot_id`, `authority_pack_id`, `authority_pack_content_hash`, exact `schema_artifact_id`, and `schema_artifact_hash` (the sealed pack's fixed `SCHEMA` component). Nullable: selected form (if not frozen at creation), internal filing lifecycle, case readiness state, staleness reason.
- **Primary key:** `(tenant_id, tax_case_id)`.
- **Unique keys:** `(tenant_id, period_key, filing_sequence)`; a TaxCase is one non-posting case per taxpayer, period, and sequence.
- **Candidate keys:** `UNIQUE(tenant_id, pan, period_key, filing_sequence, tax_case_id)` — exact lineage tuple for composite FK targets in tax_case_lineage and correction_metadata. `UNIQUE(tenant_id, pan, period_key, filing_sequence, filing_trigger, tax_case_id)` — exact lineage tuple including route. `UNIQUE(tenant_id, tax_case_id, pan, period_key, filing_sequence, governing_act, filing_trigger, rule_snapshot_id)` — exact TaxCase/rule applicability tuple for eligibility_fact_sets. `UNIQUE(tenant_id, tax_case_id, pan, period_key, filing_sequence, governing_act, filing_trigger, rule_snapshot_id, authority_pack_id, authority_pack_content_hash, schema_artifact_id, schema_artifact_hash)` — exact immutable TaxCase applicability/rule/AuthorityPack/schema candidate key for FilingSnapshot, correction metadata, and deferred successor assertions.
- **Foreign keys:** composite FK `(tenant_id, pan)` to the matching unique candidate key in tenants; period to `income_periods`; composite FK `(rule_snapshot_id, governing_act, period_key, filing_trigger)` to rule_snapshots exact candidate key; composite FK `(authority_pack_id, authority_pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, schema_artifact_id, schema_artifact_hash)` to authority_packs exact candidate key (ensures the TaxCase's pack, rule, and official schema are sealed and compatible).
- **Successor Lineage:** Successor cases are tracked via the separate tax_case_lineage relation (2.27), not via direct pointer.
- **Immutability:** PAN, period, sequence, trigger, Act, rule_snapshot_id, authority pack ID/hash, schema artifact ID/hash, selected form facts, and membership snapshot are immutable. Internal state transitions and staleness are audited; an original case is never edited into a successor.
- **Internal states (PT-013):** preparation/readiness state is separate from external portal status. Internal filing lifecycle is exactly `PREPARED`, `EXPORTED`, or `UNKNOWN`; case readiness remains an internal product state. Validation is recorded only as the ExportRun `validation_outcome`, never as a TaxCase lifecycle value.
- **Portal status:** only these five normalized portal labels are allowed: `SUBMITTED`, `VERIFIED`, `PROCESSED`, `DEFECTIVE`, and `CASE_TRANSFERRED_TO_ASSESSING_OFFICER`, corresponding to the exact raw labels in the current [ITD ITR Status FAQ](https://www.incometax.gov.in/iec/foportal/help/e-filing-know-itr-status-faq). Each non-null portal label requires a bound `portal_status_evidence` row retaining the exact raw label and evidence. An invalid return is a separate derived legal consequence/internal condition only when supported by bound defect or notice evidence; it is never a portal label. Form 16A is never a portal status.
- **Gates:** TaxCase creation binds the matching tenant PAN, period-derived Act, compatible rule snapshot, and compatible AuthorityPack through the exact eight-field tuple `(authority_pack_id, authority_pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, schema_artifact_id, schema_artifact_hash)` to the identically ordered AuthorityPack candidate key. This proves the TaxCase has the sealed pack's exact schema component; an ID/hash-only or six-field binding is insufficient. Creation also seals normalized membership and the non-empty source catalog atomically. The TaxCase `READY` transition is database-guarded and must reference every required `external_sources` row whose readiness FK names its exact `SEALED` evidence set/catalog tuple; a copied source status or summary hash cannot satisfy the case gate. Form eligibility must be evaluated from the frozen facts and official predicates before `READY`, validation, or export. A changed membership/source catalog marks the case stale and blocks the affected action.

### 2.12 `filing_snapshots`

- **Fields:** NOT NULL: `snapshot_id`, `tenant_id`, `tax_case_id`, `pan`, `period_key`, `filing_sequence`, `eligibility_fact_set_id`, `eligibility_fact_set_hash`, `authority_pack_id`, `authority_pack_content_hash`, `schema_artifact_id`, `schema_artifact_hash`, `governing_act`, `filing_trigger`, `rule_snapshot_id`, declared `tax_computation_version`, declared `tax_computation_hash` (expected hash for canonical computation), `integrity_status` (`CURRENT`, `STALE`, or `DRIFTED`), as_of_instant timestamp, snapshot_content_hash (computed over inputs: ordered BookSet entries + artifact hashes + exact frozen fact-set ID/hash + exact TaxCase pack/rule/schema tuple + computation version/hash). Nullable only when `integrity_status = CURRENT`: `invalidation_kind`, `invalidation_reason`, `invalidation_source`, `invalidation_at`, `superseding_tax_case_id`, `replacement_snapshot_id`, and `replacement_snapshot_content_hash`.
- **Primary key:** `snapshot_id`.
- **Unique keys:** `UNIQUE(tenant_id, tax_case_id, snapshot_id)` — tenant-scoped snapshot uniqueness.
- **Candidate keys:** `UNIQUE(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash, authority_pack_id, authority_pack_content_hash, schema_artifact_id, schema_artifact_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, eligibility_fact_set_id, eligibility_fact_set_hash)` — exact immutable snapshot identity and the closed pack/rule/schema/fact tuple for downstream FKs. `UNIQUE(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash)` — exact snapshot ID/hash target for SubmissionBinding.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, pan, period_key, filing_sequence, governing_act, filing_trigger, rule_snapshot_id, authority_pack_id, authority_pack_content_hash, schema_artifact_id, schema_artifact_hash)` to the TaxCase exact candidate key `UNIQUE(tenant_id, tax_case_id, pan, period_key, filing_sequence, governing_act, filing_trigger, rule_snapshot_id, authority_pack_id, authority_pack_content_hash, schema_artifact_id, schema_artifact_hash)`; this is the sole pack binding and prevents an independently supplied FilingSnapshot pack. Composite FK `(tenant_id, tax_case_id, eligibility_fact_set_id, eligibility_fact_set_hash, pan, period_key, filing_sequence, governing_act, filing_trigger, rule_snapshot_id)` to the eligibility_fact_sets candidate key `UNIQUE(tenant_id, tax_case_id, fact_set_id, fact_set_hash, pan, period_key, filing_sequence, governing_act, filing_trigger, rule_snapshot_id)` ensuring the frozen facts match this case, snapshot applicability, and rule snapshot; composite FK `(authority_pack_id, authority_pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, schema_artifact_id, schema_artifact_hash)` to the authority_packs exact candidate key; nullable composite FK `(tenant_id, superseding_tax_case_id)` to TaxCase primary key; nullable composite FK `(tenant_id, superseding_tax_case_id, replacement_snapshot_id, replacement_snapshot_content_hash)` to this table's exact snapshot ID/hash candidate. All invalidation FK components are conditionally NOT NULL when the snapshot is invalidated.
- **Immutability:** snapshot ID, eligibility fact set (ID, hash), authority pack (ID, content_hash, Act, period, trigger, rule), declared computation version/hash, timestamp, and snapshot_content_hash are immutable. A new snapshot is created when books, sources, or facts change before submission. Snapshot content hash explicitly includes exact frozen fact-set ID/hash to prevent fact drift.
- **Integrity status and invalidation:** `integrity_status` has `CHECK (integrity_status IN ('CURRENT', 'STALE', 'DRIFTED'))`. `invalidation_kind` has `CHECK (invalidation_kind IN ('PRE_SUBMISSION_REPLACEMENT', 'POST_SUBMISSION_SUCCESSOR'))`. While `CURRENT`, every invalidation/replacement field is NULL. A `STALE` or `DRIFTED` snapshot must have non-null kind, reason, source, timestamp, superseding case, replacement snapshot ID, and replacement snapshot hash, with exact FKs above. A deferred assertion checks actual `SubmissionAttempt` existence: `PRE_SUBMISSION_REPLACEMENT` requires zero attempts for this TaxCase, `superseding_tax_case_id = tax_case_id`, and a different `CURRENT` replacement snapshot identity; `POST_SUBMISSION_SUCCESSOR` requires at least one actual attempt, a different superseding case, and an exact `tax_case_lineage` successor with sequence +1 and matching PAN, period, and filing trigger. Same-case and self replacement are forbidden for the post-submission kind. The status and invalidation fields are changed only by the atomic invalidation gate in §3; prior snapshot contents remain immutable.
- **No computation FK:** FilingSnapshot does NOT store `tax_computation_id`; this breaks circular dependency. Declared computation version/hash is an input to snapshot content hash and must match the canonical TaxComputation created atomically with this snapshot.
- **BookSet and Artifact Membership:** Explicit via junction tables filing_snapshot_booksets (2.12a) and filing_snapshot_artifacts (2.12b). Membership must be nonempty before snapshot seals/readiness.
- **Gate:** FilingSnapshot must bind exactly one sealed AuthorityPack through the full TaxCase candidate key `(authority_pack_id, authority_pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, schema_artifact_id, schema_artifact_hash)`, bind exactly one sealed eligibility_fact_set via the exact (ID, hash, pan, period, sequence, Act, trigger, rule) tuple to the same case, and enumerate exact BookSet ledger versions via junction (not as-of alone). Every ExportRun is tied to exactly one FilingSnapshot by exact snapshot ID/hash, and only a `CURRENT` snapshot can feed computation, export, selection, or submission. Snapshot and its canonical TaxComputation are created atomically; their version/hash must match or integrity is violated. Child columns and target columns are identical in declared order; a caller cannot substitute another pack, schema, rule, or fact set.

### 2.12a `filing_snapshot_booksets`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `snapshot_id`, `book_set_id`, `ledger_version`, `event_cursor`. Nullable: none (all required for ledger snapshot).
- **Primary key:** `(tenant_id, tax_case_id, snapshot_id, book_set_id)`.
- **Unique keys:** one row per snapshot per BookSet; enforces nonempty membership before seal.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, snapshot_id)` to filing_snapshots; `(tenant_id, book_set_id)` to book_sets; composite FK `(tenant_id, tax_case_id, book_set_id)` to tax_case_bookset_membership exact PK. A snapshot cannot include a BookSet outside case membership.
- **Immutability:** all fields immutable after snapshot seals.
- **Gate:** Before snapshot is sealed, membership is deterministically enumerated and frozen. Readiness gate: membership must be nonempty. ledger_version and event_cursor must be captured at snapshot creation and remain immutable; both NOT NULL ensures exact ledger state is frozen.

### 2.12b `filing_snapshot_artifacts`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `snapshot_id`, `evidence_artifact_id`, `evidence_artifact_hash`, `source_id`, `parser_version` (where parser applies to artifact type).
- **Primary key:** `(tenant_id, tax_case_id, snapshot_id, evidence_artifact_id)`.
- **Unique keys:** one row per snapshot per artifact; prevents cross-source artifact binding via the composite key including source_id and hash.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, snapshot_id)` to filing_snapshots; composite FK `(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)` to external_source_artifacts exact candidate key `UNIQUE(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)` enforcing exact source-artifact-hash binding and preventing source A + artifact B pairing; composite FK `(tenant_id, evidence_artifact_id, evidence_artifact_hash)` to evidence_artifacts candidate key UNIQUE(tenant_id, artifact_id, artifact_hash) for artifact integrity verification.
- **Immutability:** all fields immutable after snapshot seals. evidence_artifact_hash is NOT NULL and forms exact composite FKs; hash cannot be bypassed or null-substituted. source_id is NOT NULL and immutable.
- **Gate:** Artifact membership deterministically enumerated at snapshot creation. Each artifact must be bound to its exact source via the composite FK to external_source_artifacts, preventing weaker pairings. Hash verifies artifact integrity across lifecycle via exact composite FK. Parser_version is required where applicable and immutable. Stronger binding via source-artifact tuple prevents cross-source substitution.

### 2.13 `tax_computations`

- **Fields:** NOT NULL: `computation_id`, `tenant_id`, `tax_case_id`, `snapshot_id`, `snapshot_content_hash`, `authority_pack_id`, `authority_pack_content_hash`, `schema_artifact_id`, `schema_artifact_hash`, `governing_act`, `period_key`, `filing_trigger`, `rule_snapshot_id`, `eligibility_fact_set_id`, `eligibility_fact_set_hash`, version, result_hash (computed over tax computation payload/result). Nullable: tax computation state.
- **Primary key:** `computation_id`.
- **Unique keys:** `UNIQUE(snapshot_id)` — exactly one canonical computation per snapshot.
- **Candidate keys:** `UNIQUE(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash, computation_id, result_hash)` — exact snapshot ID/hash and result identity for composite FK targets in export_runs; ensures canonical computation uniqueness per snapshot.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash, authority_pack_id, authority_pack_content_hash, schema_artifact_id, schema_artifact_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, eligibility_fact_set_id, eligibility_fact_set_hash)` to the FilingSnapshot candidate key with the exact declared tuple `UNIQUE(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash, authority_pack_id, authority_pack_content_hash, schema_artifact_id, schema_artifact_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, eligibility_fact_set_id, eligibility_fact_set_hash)`; no shorter or reordered target tuple is valid, so computation inherits the TaxCase-bound pack/schema.
- **Immutability:** computation ID, snapshot binding, applicability tuple including `eligibility_fact_set_id` and `eligibility_fact_set_hash`, version, and result_hash are immutable. A computation never posts to the books.
- **Atomicity and Match:** Snapshot and TaxComputation are created in one atomic transaction. TaxComputation repeats the `version` field, computes result_hash, and captures the snapshot's exact ID/hash and pack/rule/schema/fact tuple. At creation, snapshot's declared `tax_computation_version` and `tax_computation_hash` must match the computation's version and result_hash, or the transaction rolls back.
- **Gate:** exactly one TaxComputation derives from one FilingSnapshot via UNIQUE(snapshot_id). Multiple ExportRuns may use the same computation if snapshot has not changed. No mutable post-seal update to either entity.

### 2.14 `export_runs`

- **Fields:** NOT NULL: `export_id`, `tenant_id`, `tax_case_id`, `snapshot_id`, `snapshot_content_hash`, `computation_id`, `computation_result_hash`, export format, export timestamp, content_hash, output_schema_version, validation_identity, `validation_outcome` (immutable export validation result: PASSED, FAILED, INCOMPLETE, UNKNOWN, or REVIEW; reflects deterministic schema/computation validation state, not lifecycle), `integrity_status` (`CURRENT`, `STALE`, or `DRIFTED`). Nullable only while `integrity_status = CURRENT`: `invalidation_kind`, `invalidation_reason`, `invalidation_source`, `invalidation_at`, `superseding_tax_case_id`, `replacement_snapshot_id`, `replacement_snapshot_content_hash`, `replacement_export_id`, `replacement_export_content_hash`, and `replacement_export_validation_outcome`; creation metadata non-identity fields.
- **Primary key:** `export_id`.
- **Unique keys:** candidate key `UNIQUE(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash, export_id, content_hash, validation_outcome)` — exact immutable export, snapshot ID/hash, output hash, and validation tuple for SubmissionBinding and replacement binding. `UNIQUE(tenant_id, tax_case_id, export_id, content_hash)` is the exact export ID/hash target. `UNIQUE(tenant_id, tax_case_id, export_id)` remains the case-local export identity. `(snapshot_id, export_format, export_timestamp, content_hash)` optional secondary uniqueness for content tracking.
- **Foreign keys:** `(tenant_id, tax_case_id)` to TaxCase (composite FK); composite FK `(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash, computation_id, computation_result_hash)` to the exact TaxComputation candidate key `UNIQUE(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash, computation_id, result_hash)`, ensuring export binds the canonical computation and exact snapshot ID/hash; nullable composite FK `(tenant_id, superseding_tax_case_id)` to TaxCase primary key; one nullable composite replacement FK `(tenant_id, superseding_tax_case_id, replacement_snapshot_id, replacement_snapshot_content_hash, replacement_export_id, replacement_export_content_hash, replacement_export_validation_outcome)` to the ExportRun candidate key `(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash, export_id, content_hash, validation_outcome)`. The one seven-field FK binds replacement snapshot and replacement export as one exact row, including both hashes and validation status; separate snapshot/export FKs are not permitted because they allow tuple mixing. No pack is re-supplied at export: the computation FK inherits the TaxCase-bound pack/rule/schema chain.
- **Immutability:** export ID, snapshot binding, computation binding (ID and result_hash), content hash, validation_outcome are immutable. A new export is created for a snapshot when format or generation parameters change.
- **Integrity status and invalidation:** `integrity_status` has `CHECK (integrity_status IN ('CURRENT', 'STALE', 'DRIFTED'))`; `invalidation_kind` has `CHECK (invalidation_kind IN ('PRE_SUBMISSION_REPLACEMENT', 'POST_SUBMISSION_SUCCESSOR'))`. Enforce `CHECK ((integrity_status = 'CURRENT' AND invalidation_kind IS NULL AND superseding_tax_case_id IS NULL AND replacement_snapshot_id IS NULL AND replacement_snapshot_content_hash IS NULL AND replacement_export_id IS NULL AND replacement_export_content_hash IS NULL AND replacement_export_validation_outcome IS NULL) OR (integrity_status IN ('STALE', 'DRIFTED') AND invalidation_kind IS NOT NULL AND superseding_tax_case_id IS NOT NULL AND replacement_snapshot_id IS NOT NULL AND replacement_snapshot_content_hash IS NOT NULL AND replacement_export_id IS NOT NULL AND replacement_export_content_hash IS NOT NULL AND replacement_export_validation_outcome IS NOT NULL))`. Add `CHECK (replacement_export_id IS NULL OR replacement_export_id <> export_id)` and `CHECK (replacement_snapshot_id IS NULL OR replacement_snapshot_id <> snapshot_id)` plus the corresponding non-null conditional checks, so self-replacement and a NULL-component bypass are rejected. The one exact seven-field replacement FK plus the deferred attempt/lineage assertion are required. `PRE_SUBMISSION_REPLACEMENT` requires no actual SubmissionAttempt, same-case superseding identity, and a different `CURRENT` replacement ExportRun/snapshot tuple. `POST_SUBMISSION_SUCCESSOR` requires an actual attempt, a different exact sequence+1 lineage successor matching PAN, period, and filing trigger; same-case and self replacement are forbidden. The status and invalidation fields are changed only by the atomic invalidation gate in §3; export identity, output, validation evidence, and replacement rows remain immutable.
- **Validation outcome:** `validation_outcome` is NOT NULL and immutable with `CHECK (validation_outcome IN ('PASSED', 'FAILED', 'INCOMPLETE', 'UNKNOWN', 'REVIEW'))`, recording whether deterministic schema and computation validation passed or identified issues. Structured validation evidence and error details are stored separately in validation_evidence rows, linked by export_id. Only exact `validation_outcome = 'PASSED'` may be selected, bound, or submitted; FAILED, INCOMPLETE, UNKNOWN, REVIEW, STALE, and DRIFTED exports are structurally ineligible. Validation outcome is not a filing lifecycle state (which is exactly PREPARED, EXPORTED, or UNKNOWN).
- **Output integrity:** content_hash and output_schema_version are NOT NULL and immutable, verifying export content integrity across lifecycle.
- **No selection flag:** ExportRun does NOT store a selected-for-submission boolean. Selection is managed through the separate `submission_bindings` entity, which enforces concurrency gates and immutability post-attempt.
- **Gate:** multiple ExportRuns may exist per snapshot. Each export binds exactly one canonical computation from that snapshot (no mismatch possible via composite FK) and therefore inherits the exact TaxCase AuthorityPack/rule/schema tuple. Submission eligibility is the exact conjunction `validation_outcome = 'PASSED' AND integrity_status = 'CURRENT' AND snapshot.integrity_status = 'CURRENT'`; no other outcome or status can be selected, bound, or receive a submission attempt. Selection is recorded separately via immutable `submission_bindings` plus append-only binding-state events; the binding FK carries exact snapshot ID/hash and export ID/hash, while current/invalidation state is never part of the attempt FK.

### 2.14a `submission_bindings`

- **Fields:** NOT NULL: immutable `tenant_id`, `binding_id`, `tax_case_id`, `snapshot_id`, `snapshot_content_hash`, `selected_export_id`, `selected_export_content_hash`, `selected_export_validation_outcome` (must be `PASSED`), `selected_at`, and `selected_by`. No mutable/current invalidation column is stored here.
- **Primary key:** `(tenant_id, binding_id)`.
- **Unique keys:** `UNIQUE(tenant_id, tax_case_id, binding_id, snapshot_id, snapshot_content_hash, selected_export_id, selected_export_content_hash, selected_export_validation_outcome)` — one exact immutable selection candidate and the literal target for SubmissionAttempt. Declare `CHECK (selected_export_validation_outcome = 'PASSED')`; the status is part of the candidate key and the exact SubmissionBinding-to-ExportRun FK, so a non-PASSED export cannot be smuggled into a binding through a hash or NULL. A case may have multiple historical selection rows; at most one may have a current `ACTIVE` state event, enforced by the serialized event protocol.
- **Foreign keys:** `(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash)` to FilingSnapshot exact snapshot ID/hash candidate; `(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash, selected_export_id, selected_export_content_hash, selected_export_validation_outcome)` to ExportRun exact candidate `UNIQUE(tenant_id, tax_case_id, snapshot_id, snapshot_content_hash, export_id, content_hash, validation_outcome)`. The complete immutable selection row binds the TaxCase's exact pack/rule/schema transitively and preserves the literal `PASSED` status through the composite FK; no mutable status is part of either binding target.
- **Immutability:** all selection identity and actor/timestamp fields are append-only. A pre-attempt selection change revokes the old binding by appending a state event and inserts a new immutable binding row; it never updates the old selection tuple.
- **State ownership:** current selection validity is represented only by `submission_binding_state_events`, whose latest event is authoritative. Allowed states are `ACTIVE`, `REVOKED`, `STALE`, and `DRIFTED`; the event table is append-only and no state column is copied into SubmissionAttempt.
- **Gate:** a binding may receive its initial `ACTIVE` event only for a `PASSED` ExportRun whose export and FilingSnapshot are `CURRENT`. The serialized protocol locks the TaxCase's binding/event stream, rejects a second current ACTIVE binding, and verifies no actual SubmissionAttempt exists before replacing a pre-submission selection.

### 2.14b `submission_binding_state_events`

- **Fields:** NOT NULL: `tenant_id`, `binding_id`, `state_event_id`, `state` (`ACTIVE`, `REVOKED`, `STALE`, or `DRIFTED`), actor, reason, and event timestamp. Nullable: none.
- **Primary key:** `(tenant_id, binding_id, state_event_id)`.
- **Candidate keys:** `UNIQUE(tenant_id, binding_id, state_event_id)`; event order is append-only and the latest committed event determines current binding state.
- **Foreign keys:** `(tenant_id, binding_id)` to the SubmissionBinding primary key; the binding's immutable snapshot/export tuple is resolved through that exact row, so an event cannot name a different selection. No FK from SubmissionAttempt includes `state`.
- **Immutability:** events are never updated or deleted. `STALE`/`DRIFTED` invalidation events preserve all historical attempts and selection identity.
- **Gate:** exactly one initial `ACTIVE` event is appended atomically with binding creation; later transitions are append-only and serialized. A current `ACTIVE` event is required immediately before an attempt, but it is not persisted in or FK-bound from the attempt.

### 2.15 `submission_attempts`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `attempt_id` (positive integer, sequence 1, 2, 3, ...), `attempt_number` (CHECK `attempt_number > 0`), immutable `binding_id`, exact `snapshot_id`, `snapshot_content_hash`, `selected_export_id`, `selected_export_content_hash`, `selected_export_validation_outcome` (must remain `PASSED`), `attempted_at` (submission timestamp), `attempted_by` (actor), immutable request/output `hash` (e.g., portal request/response hash), `outcome` (SUBMITTED, RECEIVED, ACCEPTED, REJECTED, UNKNOWN, or similar immutable outcome label). Nullable: `previous_attempt_id`, `previous_attempt_number` (required only for attempt_number > 1). There is no mutable binding status, export integrity status, or locked-at field on an attempt.
- **Primary key:** `(tenant_id, tax_case_id, attempt_id)`.
- **Unique keys:** candidate key `(tenant_id, tax_case_id, attempt_number)` enforces one row per attempt number.
- **Candidate keys:** `UNIQUE(tenant_id, tax_case_id, attempt_id, attempt_number)` — exact retry tuple for composite FK targets in portal_status_evidence; never binds attempt_id alone to attempt_number.
- **Constraints:** CHECK `attempt_id > 0 AND attempt_number > 0`; CHECK `(attempt_number=1 AND previous_attempt_id IS NULL AND previous_attempt_number IS NULL) OR (attempt_number>1 AND previous_attempt_id IS NOT NULL AND previous_attempt_number IS NOT NULL AND previous_attempt_number=attempt_number-1)` enforces contiguity: first attempt has no predecessor, later attempts reference the immediately preceding attempt.
- **Foreign keys:** exactly one selection FK: composite FK `(tenant_id, tax_case_id, binding_id, snapshot_id, snapshot_content_hash, selected_export_id, selected_export_content_hash, selected_export_validation_outcome)` to the SubmissionBinding exact candidate `UNIQUE(tenant_id, tax_case_id, binding_id, snapshot_id, snapshot_content_hash, selected_export_id, selected_export_content_hash, selected_export_validation_outcome)`. This single FK binds the attempt to one immutable binding, exact snapshot ID/hash, and exact export ID/hash; there is no separate ExportRun tuple FK and no FK component for mutable/current binding state. Composite FK `(tenant_id, tax_case_id, previous_attempt_id, previous_attempt_number)` to submission_attempts candidate `(tenant_id, tax_case_id, attempt_id, attempt_number)` (only when both previous fields non-null) creates the self-referential retry chain.
- **Immutability:** tenant_id, tax_case_id, attempt_id, attempt_number, binding_id, exact snapshot/export identity, validation outcome, attempted_at, attempted_by, immutable request/output hash, outcome, and portal receipt/status/response are immutable after insert. Later binding-state events cannot invalidate this FK or rewrite the historical attempt. Retries are separate rows with attempt_number incremented.
- **Submission Fields Contract:** `attempted_at` records the exact timestamp of portal submission attempt. `attempted_by` records the actor/principal that initiated the attempt. `hash` is an immutable computed or preserved hash of the request sent and/or response received (e.g., portal request body hash, ARN/reference hash). `outcome` is an immutable label reflecting the portal's official response (not inferred from elapsed time or absence of evidence). Portal receipt/raw official status is kept in attempt-specific `portal_status_evidence` unless the attempt table explicitly stores them; remove any prose claiming fields absent from this contract.
- **Serialized Protocol:** First attempt uses `attempt_number=1`, no previous fields; all subsequent retries increment attempt_number to 2, 3, etc., with explicit previous_attempt_id/number. Lock the immutable binding/event stream (SELECT FOR UPDATE on Postgres/MySQL or writer transaction on SQLite), verify the latest event is `ACTIVE`, verify the export and snapshot are still `CURRENT`, then insert the attempt. No binding row is updated and no mutable state is copied into the attempt.
  - **First attempt:** requires no prior attempts for this (tenant_id, tax_case_id), requires `attempt_number=1`, `previous_attempt_id=NULL`, and `previous_attempt_number=NULL`; it inserts the attempt with the exact binding candidate tuple. If the latest event is not `ACTIVE`, insertion fails closed.
  - **Retry:** requires the same immutable binding candidate and an existing prior attempt for this (tenant_id, tax_case_id), chooses exactly `MAX(attempt_number)+1`, sets previous_attempt_id/number to the immediately preceding row, and inserts the retry under the same serialized binding/event lock.
- **Contiguity Note:** The CHECK constraint plus candidate keys plus self-referential FK combine to enforce no gaps and no duplicates. The serialized protocol (lock + MAX + increment within one serialized transaction) is the implementation mechanism.
- **Gate:** SubmissionAttempt may be inserted only after the latest binding-state event is `ACTIVE`, the exact bound ExportRun has `validation_outcome = 'PASSED'` and `integrity_status = 'CURRENT'`, and the exact bound FilingSnapshot is `CURRENT`. FAILED, INCOMPLETE, UNKNOWN, REVIEW, STALE, or DRIFTED exports cannot receive an attempt. The attempt's single binding FK binds the complete immutable chain; subsequent `STALE`/`DRIFTED` events preserve it. Before submission, changed books/sources create a new immutable snapshot/export/binding row in the same live TaxCase only when no attempt exists. After an attempt exists, correction work uses a linked successor TaxCase (PT-016) with independent snapshot/export/binding. Required evidence binding for submitted status remains fail-closed; absence of portal_status_evidence does not assume submission succeeded.

### 2.16 `tax_case_bookset_membership`

- **Fields:** `tenant_id`, `tax_case_id`, `book_set_id`, inclusion_reason, inclusion_metadata.
- **Primary key:** `(tenant_id, tax_case_id, book_set_id)`.
- **Unique keys:** `UNIQUE(tenant_id, tax_case_id, book_set_id)` — one row per TaxCase and BookSet pair; enforces single membership per (case, BookSet).
- **Foreign keys:** composite FK `(tenant_id, tax_case_id)` to TaxCase candidate key; composite FK `(tenant_id, book_set_id)` to book_sets candidate key. Both FKs enforce same-tenant scope.
- **Immutability:** one membership snapshot is sealed at TaxCase creation time. After creation, a database write guard rejects every INSERT, UPDATE, or DELETE on the old case's membership rows. Sealing is explicit and enforced by database constraints or equivalent dialect-specific mechanism, not by application convention alone.
- **Gate:** this normalized relation is the sole authoritative source for TaxCase BookSet membership. A membership change marks the old case `STALE` and atomically creates a successor TaxCase with a new complete set in the same transaction workflow. The database write guard (preventing mutations to old case membership) and atomic successor creation must be proven per dialect at Gate0. No duplicate authoritative membership list is stored in JSON or arbitrary text.

### 2.17 `external_sources`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `readiness_status`. Also required: source type, source identity and period. Conditional `READY` fields: `readiness_evidence_set_id`, `readiness_evidence_set_state` (fixed=`SEALED`), `readiness_catalog_snapshot_id`, `readiness_catalog_snapshot_hash`, `readiness_evidence_binding_hash`, `readiness_catalog_hash`, `readiness_evidence_entry_count`, `readiness_actor`, and `readiness_at`. Conditional `DECLARED_NOT_APPLICABLE` fields: exact `readiness_declaration_artifact_id`, `readiness_declaration_artifact_hash`, `readiness_actor`, `readiness_reason`, `readiness_scope`, and `readiness_at`. Nullable: institution/account metadata, reconciliation state, and readiness fields only where permitted by the conditional CHECK below.
- **Primary key:** `(tenant_id, tax_case_id, source_id)`.
- **Unique keys:** source identity within a TaxCase.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id)` to TaxCase; derived evidence via junction external_source_artifacts (composite FK to evidence_artifacts); BookSet membership explicit via external_source_booksets junction (2.19).
- **Immutability:** source identity and imported evidence version are immutable; new imports create new evidence/source versions.
- **Source types:** include `AIS`, `26AS`, `Form16A_TDS`, bank, broker, property, loan, EPFO, and NPS evidence. `Form16A_TDS` is non-salary TDS evidence only.
- **Statuses:** exactly `UNKNOWN`, `DECLARED_NOT_APPLICABLE`, `EXPECTED`, `INGESTED`, `RECONCILED`, `CONFLICT`, `INCOMPLETE`, `READY`, or `STALE`; enforce `CHECK (readiness_status IN ('UNKNOWN', 'DECLARED_NOT_APPLICABLE', 'EXPECTED', 'INGESTED', 'RECONCILED', 'CONFLICT', 'INCOMPLETE', 'READY', 'STALE'))`.
- **Readiness integrity:** `readiness_status` is NOT NULL and every transition must use one of the CHECK values; NULL cannot bypass the readiness state machine or a readiness gate. Enforce the conditional CHECK: `readiness_status = 'READY'` requires all READY fields above, including `readiness_evidence_set_state = 'SEALED'`; `readiness_status = 'DECLARED_NOT_APPLICABLE'` requires all declaration fields above, and every other status requires every readiness field to be NULL. `readiness_evidence_entry_count` is NOT NULL only for READY and must equal the sealed evidence-set entry count. No summary hash can satisfy a missing set or entry.
- **Foreign-key readiness binding:** READY uses composite FK `(tenant_id, tax_case_id, source_id, readiness_evidence_set_id, readiness_catalog_snapshot_id, readiness_catalog_snapshot_hash, readiness_evidence_set_state)` to the `readiness_evidence_sets` exact candidate with the identical final `seal_state` field, and therefore can reference only a `SEALED` set. DECLARED_NOT_APPLICABLE uses `(tenant_id, tax_case_id, source_id, readiness_declaration_artifact_id, readiness_declaration_artifact_hash)` to `external_source_artifacts`. The evidence set exact-FKs every catalog entry and source artifact, so no partial or independently substituted artifact is accepted.
- **Gates:** complete required catalog enumerated before readiness; mandatory unresolved entries block action. Empty catalog cannot become ready. All BookSet membership explicit via external_source_booksets junction; artifact associations explicit via external_source_artifacts junction. A TaxCase `READY` transition is a database-guarded aggregate transition: every required source row must be `READY` and must carry the exact composite FK to a `SEALED` evidence set for its sealed catalog; no copied status, hash, or application-only assertion can make the case READY. DECLARED_NOT_APPLICABLE requires the exact evidenced justification binding and actor/reason/scope.

### 2.17a `source_requirement_catalog_snapshots`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `catalog_snapshot_id`, `catalog_snapshot_hash`, `required_entry_count`, `seal_state` (`OPEN` or `SEALED`). Nullable until `seal_state = 'SEALED'`: `sealed_at`, `sealed_by`. `required_entry_count` must be greater than zero.
- **Primary key:** `(tenant_id, tax_case_id, source_id, catalog_snapshot_id)`.
- **Candidate keys:** `UNIQUE(tenant_id, tax_case_id, source_id, catalog_snapshot_id, catalog_snapshot_hash)` — exact immutable catalog snapshot identity.
- **Foreign keys:** `(tenant_id, tax_case_id, source_id)` to `external_sources`; no catalog can be sealed for another case/source.
- **Immutability:** while `seal_state = 'OPEN'`, entries may be inserted but the snapshot identity/hash/count cannot change. The `OPEN -> SEALED` transition and its seal metadata are one-way; a sealed snapshot and all its entries are immutable. Re-enumeration creates a new snapshot; it never edits the required set.
- **Gate:** the snapshot is sealed only after deterministic enumeration from facts, BookSets, tax heads, the rule snapshot, and official schema, and only when the database seal assertion finds `COUNT(entries) = required_entry_count > 0`. The count is used by the evidence-set exact set assertion; a caller-supplied count or hash cannot seal an incomplete catalog.

### 2.17b `source_requirement_catalog_entries`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `catalog_snapshot_id`, `catalog_snapshot_hash`, `catalog_ordinal` (positive and unique within the snapshot), `requirement_key`, requirement role/metadata.
- **Primary key:** `(tenant_id, tax_case_id, source_id, catalog_snapshot_id, catalog_ordinal, requirement_key)`.
- **Candidate keys:** `UNIQUE(tenant_id, tax_case_id, source_id, catalog_snapshot_id, catalog_snapshot_hash, catalog_ordinal, requirement_key)` — exact catalog entry target for readiness evidence-set entries; `UNIQUE(tenant_id, tax_case_id, source_id, catalog_snapshot_id, catalog_ordinal)` prevents two requirement keys sharing one ordinal.
- **Foreign keys:** `(tenant_id, tax_case_id, source_id, catalog_snapshot_id, catalog_snapshot_hash)` to `source_requirement_catalog_snapshots`; the snapshot/hash and ordinal/requirement_key are immutable and cannot be caller-substituted.
- **Immutability:** entries are append-only and the exact `(catalog_snapshot_id, catalog_ordinal, requirement_key)` identity never changes.
- **Gate:** every required entry is represented exactly once in the sealed catalog. The catalog is nonempty; a partial or internally consistent evidence set cannot be READY.

### 2.17c `readiness_evidence_sets`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `evidence_set_id`, `catalog_snapshot_id`, `catalog_snapshot_hash`, `entry_count`, `evidence_set_hash`, `seal_state` (`OPEN` or `SEALED`). Nullable until `seal_state = 'SEALED'`: `sealed_at`, `sealed_by`. `entry_count` must be greater than zero.
- **Primary key:** `(tenant_id, tax_case_id, source_id, evidence_set_id)`.
- **Candidate keys:** `UNIQUE(tenant_id, tax_case_id, source_id, evidence_set_id, catalog_snapshot_id, catalog_snapshot_hash)` — exact set and catalog binding used by the entry FK; and `UNIQUE(tenant_id, tax_case_id, source_id, evidence_set_id, catalog_snapshot_id, catalog_snapshot_hash, seal_state)` — exact immutable set, catalog, and seal-state binding used by the `external_sources` READY FK, which targets the literal `SEALED` value.
- **Foreign keys:** `(tenant_id, tax_case_id, source_id, catalog_snapshot_id, catalog_snapshot_hash)` to the catalog snapshot candidate; no evidence set can select a different catalog version.
- **Immutability:** while `seal_state = 'OPEN'`, entries may be inserted but set identity, catalog identity, entry count, and hash cannot change. The `OPEN -> SEALED` transition and its seal metadata are one-way; a sealed evidence set and all its entries are immutable. A changed artifact or catalog creates a new evidence set.
- **Gate:** `entry_count` must equal the catalog snapshot's `required_entry_count`, and the database seal assertion must prove exact set equality before `seal_state` can become `SEALED`. `evidence_set_hash` covers the ordered exact catalog and source-artifact tuples, not merely a caller-provided count.

### 2.17d `readiness_evidence_set_entries`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `evidence_set_id`, `catalog_snapshot_id`, `catalog_snapshot_hash`, `catalog_ordinal`, `requirement_key`, `evidence_artifact_id`, `evidence_artifact_hash`, and evidence role metadata.
- **Primary key:** `(tenant_id, tax_case_id, source_id, evidence_set_id, catalog_ordinal, requirement_key)`.
- **Unique keys:** the primary key is the one-to-one coverage key; additionally `UNIQUE(tenant_id, tax_case_id, source_id, evidence_set_id, catalog_snapshot_id, catalog_ordinal, requirement_key)` prevents the same catalog entry from being covered twice under a different set projection.
- **Foreign keys:** exact FK `(tenant_id, tax_case_id, source_id, evidence_set_id, catalog_snapshot_id, catalog_snapshot_hash)` to `readiness_evidence_sets`; exact FK `(tenant_id, tax_case_id, source_id, catalog_snapshot_id, catalog_snapshot_hash, catalog_ordinal, requirement_key)` to `source_requirement_catalog_entries`; and exact FK `(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)` to `external_source_artifacts`. All identity/hash components are NOT NULL. If a requirement legitimately needs multiple evidence roles, normalize those roles in a separate role-multiplicity child keyed by this exact entry; never duplicate a required catalog entry.
- **Immutability:** entries may be inserted only while their parent evidence set is `OPEN`; a database write guard rejects update/delete after the parent is `SEALED`. Replacement evidence creates a new evidence set.
- **Gate:** the exact FK to `source_requirement_catalog_entries` prevents extras, and the entry PK `(tenant_id, tax_case_id, source_id, evidence_set_id, catalog_ordinal, requirement_key)` prevents duplicates. On `OPEN -> SEALED`, a database assertion requires `COUNT(entries) = required_entry_count`, no catalog entry without exactly one evidence entry, and no evidence entry without a catalog entry. Every required entry is therefore covered exactly once with an exact source artifact; an internally consistent partial set cannot make `READY`.

### 2.17e Database-enforced readiness seal protocol

The set contract is enforced by the database, not by an application promise. Both catalog snapshots and evidence sets have a NOT NULL `seal_state` with the only forward transition `OPEN -> SEALED`. Direct SQL writes are covered by database triggers (or equivalent guarded stored routines plus triggers):

- A catalog-seal trigger locks/serializes the snapshot, rejects a non-forward transition, requires `required_entry_count > 0`, and rejects `SEALED` unless the catalog has exactly that many distinct entries. Catalog-entry insert/update/delete triggers reject writes after `SEALED`.
- An evidence-set-seal trigger locks/serializes the set, rejects a non-forward transition, checks the parent catalog is `SEALED`, and rejects `SEALED` unless the two anti-joins are empty: no catalog identity `(catalog_snapshot_id, catalog_ordinal, requirement_key)` lacks exactly one evidence entry, and no evidence entry lacks a catalog identity. The exact entry FK and PK make those anti-joins equivalent to one-to-one coverage; `entry_count` and the ordered hash are checked in the same transition. Evidence-entry insert/update/delete triggers reject writes after `SEALED`.
- The `external_sources` READY transition trigger rejects any row whose exact evidence-set FK does not include `seal_state = 'SEALED'`. The TaxCase READY transition trigger rejects any case with a required source that is not READY with that exact sealed-set binding. Thus a READY status cannot be copied from a source row or supplied with a summary hash.

Dialect realization is required before implementation authority: SQLite uses `BEGIN IMMEDIATE` for the seal transaction plus `BEFORE` triggers with `RAISE(ABORT, ...)`; PostgreSQL uses row-locking seal triggers and `DEFERRABLE INITIALLY DEFERRED` constraint triggers where multi-statement set assembly needs commit-time validation; MySQL/InnoDB uses a stored seal procedure plus `BEFORE` write/state triggers, `SELECT ... FOR UPDATE`, and the same count/anti-join checks in one transaction because MySQL has no deferred constraints. In all three dialects, direct table writes fail closed, sealed rows are immutable, and a concurrent writer cannot add coverage after the assertion. A dialect without these database guards is not conformant.

### 2.18 `external_source_artifacts`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `evidence_artifact_id`, `evidence_artifact_hash`. Nullable: parser_version, parser_role (if applicable to source type).
- **Primary key:** `(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)` — prevents duplicate evidence binding to the same source.
- **Unique keys/Candidate keys:** enforced by PK; one row per distinct artifact per source. Matching candidate key `UNIQUE(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)` for FK targets from derived_source_records.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, source_id)` to external_sources candidate key; composite FK `(tenant_id, evidence_artifact_id, evidence_artifact_hash)` to evidence_artifacts candidate key UNIQUE(tenant_id, artifact_id, artifact_hash). Both FKs enforce tenant_id equality.
- **Immutability:** all fields immutable after insert; junction bindings are append-only.
- **Scope:** Tenant-scoped. Both FKs carry tenant_id to enforce same-tenant source and evidence.
- **Gate:** every artifact linked to an external source must be bound explicitly via this junction; no cross-tenant artifact/source bindings are possible. Derived records carry exact tuple reference to prevent binding artifacts from other sources or cases.

### 2.19 `external_source_booksets`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `book_set_id`.
- **Primary key:** `(tenant_id, tax_case_id, source_id, book_set_id)` — prevents duplicate BookSet binding to the same source within a case.
- **Unique keys:** one row per source-BookSet pair within a TaxCase.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, source_id)` to external_sources exact PK; composite FK `(tenant_id, tax_case_id, book_set_id)` to tax_case_bookset_membership exact PK. Both FKs enforce tenant_id/case/source/BookSet consistency.
- **Immutability:** all fields immutable after insert; junction bindings are append-only.
- **Scope:** Tenant and TaxCase scoped. A source may map to multiple member BookSets; a BookSet may be referenced by multiple sources within the same case.
- **Gate:** every BookSet linked to an external source within a TaxCase must be a member of that TaxCase (via tax_case_bookset_membership); source artifacts remain bound to exact source/case, never drift across cases or BookSets. Reconciliation records reference this exact junction for BookSet/source pairing.

### 2.20 `evidence_artifacts`

- **Fields:** NOT NULL: `tenant_id`, `artifact_id`, `artifact_hash`. Nullable: content type, size, storage reference, parser identity/release, retrieval metadata.
- **Primary key:** `(tenant_id, artifact_id)`.
- **Unique keys:** `UNIQUE(tenant_id, artifact_id, artifact_hash)` — exact identity tuple for composite FK targets; content hash indexed for lookup. Re-imports are visible as separate rows with different artifact_id.
- **Foreign keys:** composite FK `(tenant_id)` to tenants.
- **Immutability:** artifact ID, content hash, storage reference, and parser provenance are immutable after insert; a new file or parser result creates a new row.
- **Gate:** every derived record, filing/portal evidence row, and filing_snapshot_artifacts points to exact artifact via (tenant_id, artifact_id, artifact_hash); no import overwrites another artifact. artifact_hash is NOT NULL on every row, required where evidence is mandatory.

### 2.21 `external_source_derived_records`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `derived_record_id`, `evidence_artifact_id`, `evidence_artifact_hash`. Nullable: parsed facts, parser warnings, and derivation metadata non-identity fields.
- **Primary key:** `(tenant_id, tax_case_id, source_id, derived_record_id)`.
- **Unique keys:** derived-record identity within its source.
- **Foreign keys:** source composite key `(tenant_id, tax_case_id, source_id)` to external_sources candidate key; exact composite FK `(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)` to external_source_artifacts. Enforces: no artifact from another source/case; same tenant across source and evidence.
- **Immutability:** derived records are append-only and retain their raw-artifact pointer via exact tuple.
- **Tenant Enforcement:** No cross-tenant derived evidence is accepted, even when artifact IDs or source IDs collide; the exact composite tenant-aware database relationship enforces evidence ownership.
- **Gate:** Parser warnings never become reconciliation success.

### 2.22 `reconciliation_records`

- **Fields:** NOT NULL: `tenant_id`, `reconciliation_id`, `tax_case_id`, `source_id`, `book_set_id`, `evidence_artifact_id`, `evidence_artifact_hash`, `outcome`, `amount`, `reason`, `actor`, `timestamp`. Nullable: none (all required for integrity).
- **Primary key:** `(tenant_id, reconciliation_id)`.
- **Unique keys:** reconciliation identity within the tenant.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id)` to TaxCase; composite FK `(tenant_id, tax_case_id, source_id, book_set_id)` to external_source_booksets exact PK (ensures source/BookSet pair is valid and both are bound to the same case); composite FK `(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)` to external_source_artifacts exact candidate key `UNIQUE(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)`. All FKs enforce same-tenant scope via tenant_id; no loose BookSet-only FK, artifact-only FK, or null-field bypass can substitute for the source/BookSet junction or exact source-artifact binding.
- **Immutability:** a reconciliation result is append-only; a new comparison creates a new record.
- **Non-integrity metadata:** outcome labels, conflict descriptions, reason explanations, reviewer notes, and timestamp observations are observational metadata, not enforcement constraints.
- **Gate:** reconciliation links books and evidence without replacing either; a required conflict cannot be marked ready by acknowledgement alone. Source/BookSet pairing must exist via external_source_booksets junction in the same case, and the exact source-artifact tuple must exist via external_source_artifacts. All required fields (artifact ID/hash, outcome, amount, reason, actor, timestamp) must be present and NOT NULL; no nullable composite bypass or weaker artifact-only integrity path is allowed.

### 2.23 `correction_metadata`

- **Fields:** NOT NULL: `tenant_id`, `predecessor_tax_case_id`, `predecessor_sequence` (from predecessor TaxCase), `successor_tax_case_id`, `successor_pan`, `successor_sequence` (from successor TaxCase), `successor_governing_act`, `successor_period_key`, `successor_filing_trigger`, `successor_rule_snapshot_id`, `successor_authority_pack_id`, `successor_authority_pack_content_hash`, `successor_schema_artifact_id`, `successor_schema_artifact_hash`, verified_trigger (source of correction requirement), applicable_mechanism_id, `correction_evidence_artifact_id`, `correction_evidence_artifact_hash`, verifier, verification_timestamp. Nullable: deadline_source.
- **Primary key:** `(tenant_id, predecessor_tax_case_id, successor_tax_case_id)`.
- **Unique keys:** one verified metadata record per successor TaxCase.
- **Candidate keys:** `UNIQUE(tenant_id, predecessor_tax_case_id, successor_tax_case_id, applicable_mechanism_id, successor_rule_snapshot_id, successor_authority_pack_id, successor_authority_pack_content_hash, successor_schema_artifact_id, successor_schema_artifact_hash, verified_trigger)` — exact correction metadata tuple for audit and lineage tracing.
- **Foreign keys:** composite FK `(tenant_id, predecessor_tax_case_id, predecessor_sequence, successor_tax_case_id, successor_sequence)` to tax_case_lineage exact candidate key `UNIQUE(tenant_id, predecessor_tax_case_id, predecessor_sequence, successor_tax_case_id, successor_sequence)` (binds both sequences, especially successor_sequence, to the explicit lineage relation); composite FK `(tenant_id, successor_tax_case_id, successor_pan, successor_period_key, successor_sequence, successor_governing_act, successor_filing_trigger, successor_rule_snapshot_id, successor_authority_pack_id, successor_authority_pack_content_hash, successor_schema_artifact_id, successor_schema_artifact_hash)` to the TaxCase exact applicability/rule/pack/schema candidate key (binds correction metadata to the actual successor, not an independently supplied pack); composite FK `(tenant_id, successor_authority_pack_id, successor_authority_pack_content_hash, successor_governing_act, successor_period_key, successor_filing_trigger, successor_rule_snapshot_id, applicable_mechanism_id, verified_trigger)` to authority_pack_correction_routes exact candidate key (pack-A successor cannot use a pack-B route); composite FK `(tenant_id, correction_evidence_artifact_id, correction_evidence_artifact_hash)` to evidence_artifacts candidate key UNIQUE(tenant_id, artifact_id, artifact_hash).
- **Immutability:** verified metadata is append-only; a changed mechanism creates a new successor TaxCase, lineage row, and metadata row. successor_sequence and successor_pack fields are immutable once recorded.
- **Field Names:** Use only the exact `successor_rule_snapshot_id` and route `rule_snapshot_id` identifiers; no alternate rule identifier is permitted.
- **Non-integrity metadata:** verified_trigger label, mechanism description, deadline text, and verifier notes are observational; the actual mechanism enforcement uses TaxCase successor linking, sealed pack/route, and rule bindings.
- **Gates:** `filing_sequence = 1` needs no correction metadata; every sequence greater than one requires complete, verified correction metadata with bound evidence before `ready`, validation, or export. Missing or unverified metadata yields `REVIEW/BLOCK`. Metadata must be bound to the exact lineage relation connecting predecessor to successor, with successor sequence, pack, and correction route all immutably recorded. It is impossible to attach a correction route from another pack or case via the composite FK to authority_pack_correction_routes.

### 2.23a `authority_pack_correction_routes`

- **Fields:** NOT NULL: `tenant_id`, `authority_pack_id`, `pack_content_hash`, `governing_act`, `period_key`, `filing_trigger`, `rule_snapshot_id`, `applicable_mechanism_id`, `verified_trigger`, route metadata (mechanism description, deadline, severity). Nullable: none (all required for sealed correction route).
- **Primary key:** `(tenant_id, authority_pack_id, pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, applicable_mechanism_id, verified_trigger)`.
- **Unique keys:** one route per exact pack applicability/rule tuple per mechanism per rule per trigger; prevents duplicate routes.
- **Foreign keys:** composite FK `(authority_pack_id, pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id)` to authority_packs exact candidate key ensuring the route is bound to a specific sealed AuthorityPack and its exact content/applicability. Composite FK `(rule_snapshot_id, governing_act, period_key, filing_trigger)` to rule_snapshots candidate key `UNIQUE(rule_snapshot_id, governing_act, period_key, filing_trigger)` ensuring the route's exact rule snapshot is valid and sealed.
- **Immutability:** once created, a correction route is immutable; the pack and rule snapshots are immutable, so the route remains exact.
- **Scope:** Authority-pack-scoped correction routes. It is impossible to attach a route/rule/trigger from another pack or case; the composite FK to exact pack content_hash enforces this.
- **Candidate keys:** `UNIQUE(tenant_id, authority_pack_id, pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, applicable_mechanism_id, verified_trigger)` — exact correction-route identity and the literal target tuple for correction_metadata's composite FK.
- **Gate:** Correction metadata for a successor TaxCase must reference this exact route via composite FK, ensuring the correction mechanism is sealed within the applicable AuthorityPack and cannot drift across packs or cases.

### 2.24 `correction_lineages`

- **Fields:** `tenant_id`, `book_set_id`, `lineage_id`, `original_journal_entry_id`, `reversal_journal_entry_id`, `replacement_journal_entry_id`, reason, actor, timestamp.
- **Primary key:** `(tenant_id, book_set_id, lineage_id)`.
- **Unique keys:** one lineage identity within a BookSet.
- **Foreign keys:** composite FK `(tenant_id, book_set_id, original_journal_entry_id)` to journal_entries; composite FK `(tenant_id, book_set_id, reversal_journal_entry_id)` to journal_entries; composite FK `(tenant_id, book_set_id, replacement_journal_entry_id)` to journal_entries. All three FKs enforce same-BookSet scope.
- **Constraints:** CHECK `original_journal_entry_id != reversal_journal_entry_id AND reversal_journal_entry_id != replacement_journal_entry_id AND original_journal_entry_id != replacement_journal_entry_id` — all three journals must be distinct.
- **Immutability:** this is the one canonical correction-lineage definition; lineage rows and linked journals are never rewritten or duplicated under another authoritative definition.
- **Non-integrity metadata:** reason and actor notes are observational; the lineage is the integrity mechanism.
- **Gate:** a posted correction requires the original, reversal, and replacement relationship to be valid and same-BookSet; affected TaxCases become stale and use successor lineage.

### 2.25 `portal_status_evidence`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `submission_attempt_id`, `submission_attempt_number`, `evidence_id`, `evidence_artifact_id`, `evidence_artifact_hash`, normalized_label (one of: SUBMITTED, VERIFIED, PROCESSED, DEFECTIVE, CASE_TRANSFERRED_TO_ASSESSING_OFFICER), `official_label_raw` (exact raw label), capture_time, actor. Nullable: none (all required for integrity).
- **Primary key:** `(tenant_id, tax_case_id, submission_attempt_id, evidence_id)` — multiple evidence rows per submission attempt allowed; PK prevents duplicates.
- **Unique keys:** evidence identity within the submission attempt.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, submission_attempt_id, submission_attempt_number)` to submission_attempts exact candidate key `UNIQUE(tenant_id, tax_case_id, attempt_id, attempt_number)` (ensures evidence is bound to a specific submission attempt with both ID and number, never attempt_id alone); composite FK `(tenant_id, evidence_artifact_id, evidence_artifact_hash)` to evidence_artifacts matching UNIQUE(tenant_id, artifact_id, artifact_hash).
- **Immutability:** evidence, its captured label, attempt binding (ID and number), normalized label, and official_label_raw are append-only; no cross-tenant binding possible (both FKs scoped to tenant_id).
- **Receipt and Status Provenance:** Receipt, status, and label capture are specific to the submission attempt, not to the TaxCase or FilingSnapshot. Retries (different submission_attempts, different attempt_numbers) may have different evidence or status labels.
- **Normalized Label Casing:** normalized_label uses uppercase canonical codes and has `CHECK (normalized_label IN ('SUBMITTED', 'VERIFIED', 'PROCESSED', 'DEFECTIVE', 'CASE_TRANSFERRED_TO_ASSESSING_OFFICER'))`; official_label_raw preserves exact as-received raw text. No NULL or unlisted portal label is valid.
- **Gate:** portal label cannot be stored without bound filing-specific evidence (via submission attempt with exact ID and number), exact raw label, and proof that the evidence was captured during that specific submission attempt. invalid_return condition derived separately only from bound defect/notice evidence. Internal `prepared`, `exported`, or `unknown` state never implies a portal label.

### 2.26 `audit_records`

- **Fields:** `tenant_id` (required), `audit_id`, optional `book_set_id`, entity_type, entity_id_fields (serialized composite key of the mutated entity), action (INSERT, UPDATE, DELETE, SELECT), actor, request_id, outcome, reason/notes, timestamp.
- **Primary key:** `(tenant_id, audit_id)` — core audit candidate key for FKs from other entities.
- **Unique keys:** audit identity within the tenant (primary key enforces).
- **Foreign keys:** composite FK `(tenant_id)` to tenants; optional composite FK `(tenant_id, book_set_id)` to book_sets when BookSet scope applies.
- **Scope:** Tenant-scoped with optional BookSet subscope. No cross-tenant audit record is possible; tenant_id is required on every row.
- **Entity Reference Format:** entity_id_fields is a structured field (JSON, text, or separate columns) that contains the full composite key of the mutated entity (e.g., `(tax_case_id)` for TaxCase mutations, `(tax_case_id, source_id)` for external_sources). Do not store nulls or partial composite keys.
- **Immutability:** append-only; audit rows are never updated or deleted.
- **Non-integrity metadata:** reason notes and outcome descriptions are observational; the primary integrity mechanism is immutability of the audit record itself.
- **Gate:** every mutation of a protected or immutable aggregate records an auditable actor, scope, outcome, and full entity identity without exposing secrets or raw sensitive content in operational output. Audit records must not be nullable on tenant_id or entity_id_fields.

### 2.27 `tax_case_lineage`

- **Fields:** NOT NULL: `tenant_id`, `lineage_id`, `pan`, `period_key`, `filing_trigger`, `predecessor_tax_case_id`, `predecessor_sequence`, `successor_tax_case_id`, `successor_sequence`. Nullable: reason.
- **Primary key:** `(tenant_id, lineage_id)`.
- **Unique keys:** lineage identity within the tenant.
- **Candidate keys:** `UNIQUE(tenant_id, predecessor_tax_case_id, predecessor_sequence, successor_tax_case_id, successor_sequence)` — exact lineage tuple for correction_metadata, including both case IDs and both sequences so successor_sequence is lineage-bound. Also declare `UNIQUE(tenant_id, predecessor_tax_case_id)` and `UNIQUE(tenant_id, successor_tax_case_id)` to enforce one predecessor per successor and one successor per predecessor.
- **Foreign keys:** composite FK `(tenant_id, pan, period_key, predecessor_sequence, filing_trigger, predecessor_tax_case_id)` to TaxCase exact lineage candidate key `UNIQUE(tenant_id, pan, period_key, filing_sequence, filing_trigger, tax_case_id)`; composite FK `(tenant_id, pan, period_key, successor_sequence, filing_trigger, successor_tax_case_id)` to the same exact candidate. Both child tuples now have identical six-column arity and declared order to the TaxCase target `(tenant_id, pan, period_key, filing_sequence, filing_trigger, tax_case_id)`, so a post-submission successor cannot silently change route or sequence.
- **Constraints:** CHECK `successor_sequence = predecessor_sequence + 1 AND predecessor_tax_case_id != successor_tax_case_id` — successor is exactly the next sequence number (not merely greater), and is a different case.
- **Immutability:** lineage rows are immutable after insertion; the predecessor-successor link is permanent.
- **Scope:** Shared tenant_id, shared taxpayer (pan), shared period_key, and shared filing_trigger. Structural sharing via FKs enforces lineage cohesion; structural constraint prevents cross-PAN, cross-period, or cross-route lineage.
- **Gate:** Successor TaxCase creation atomically inserts the lineage row binding predecessor to successor with matching pan, period, and filing trigger, enforcing immediate sequential succession (no gaps). Before export or submission, verify the applicable mechanism per the AuthorityPack; missing or unapproved mechanism returns REVIEW/BLOCK.

## 3. Required transaction gates

These gates are acceptance requirements, not implementation claims.

1. **Identity and scope:** reject a TaxCase whose `(tenant_id, pan)` does not match the tenant key; reject every cross-tenant or cross-BookSet FK; reject a same-tenant mutation when BookSet scope is ambiguous.
2. **Actual-postings balance:** within one transaction, create the journal and postings, verify debit and credit totals from the actual postings, verify tenant/BookSet/journal/account composite FKs, and post only on equality and valid currency. Caller totals, labels, or derived summaries cannot pass this gate.
3. **Transfer atomicity:** create both transfer legs in one transaction; require both journals to be posted and actual postings to agree with the same amount, currency, purpose, and evidence; roll back all rows if either leg fails.
4. **TaxCase membership:** enumerate the complete applicable BookSet set into one sealed normalized snapshot at creation. A database write guard rejects membership insert, update, or delete on the old case afterward; a changed set marks the old case stale and atomically creates a successor with a new complete snapshot before validation/export. This database guard and successor transaction must be proven per dialect at Gate0.
5. **Authority compatibility:** derive Act from normalized period; bind a compatible rule snapshot and four independent hashed/effective-dated official artifacts. Any mismatch or missing binding fails closed.
6. **Form eligibility:** evaluate and freeze official form predicates and taxpayer facts before `ready`, validation, or export. Unknown eligibility is `REVIEW/BLOCK`.
7. **Correction sequence:** require verified `correction_metadata` for every filing sequence greater than one before any ready, validation, or export transition.
8. **Evidence and portal state:** preserve raw artifacts before derivation; require bound evidence for every portal label; never infer status from elapsed time, an export, Form 16A, or an unbound text field.
9. **No overwrite:** source artifacts, postings, membership, authority, reconciliation, status evidence, and correction lineage remain append-only. New facts create linked versions or successor cases.
10. **Readiness set equality:** database-seal a nonempty catalog snapshot and its ordinal/requirement-key entries before creating a readiness evidence set. Insert exactly one evidence-set entry per catalog entry, with exact source-artifact/hash FK; the database `OPEN -> SEALED` transition checks the count and both exact-set anti-joins. A caller-supplied catalog/evidence hash, count, or internally consistent partial set cannot reach `READY`.
11. **Correction invalidation:** classify every invalidation as `PRE_SUBMISSION_REPLACEMENT` or `POST_SUBMISSION_SUCCESSOR`. First serialize the affected TaxCase and binding event stream and query actual `SubmissionAttempt` existence. For pre-submission replacement, require zero attempts, create a different current snapshot/export/binding in the same TaxCase, then mark old artifacts invalid. For post-submission successor, require an actual attempt, create a different TaxCase plus exact sequence+1 lineage matching PAN, period, and filing trigger, then create its independent current snapshot/export/binding. Only after the replacement/successor identities and deferred assertions are satisfiable may the transaction mark old snapshots/exports `STALE` or `DRIFTED` with non-null kind/reason/source/timestamp/superseding case/replacement IDs and append `STALE`/`DRIFTED` binding-state events. Any enumeration, marking, binding-event, deferred assertion, or successor-link failure rolls back the correction; prior snapshots, exports, bindings, and attempts remain immutable.

## 4. Fail-closed acceptance scenarios

- A TaxCase with a mismatched PAN, period-incompatible Act, rule snapshot, or official artifact binding is rejected.
- Creating a second PAN tenant with an existing PAN is rejected; the existing tenant and its `(tenant_id, pan)` TaxCase bindings remain the sole taxpayer identity.
- Creating a second personal BookSet, including after archiving or during replacement/migration, is rejected; replacement preserves the original BookSet identity.
- A TaxCase whose normalized membership omits an applicable BookSet, or whose required source catalog is empty, unknown, or stale, cannot become ready or export.
- A READY source whose evidence set omits a required catalog ordinal/requirement_key, duplicates one, names another catalog snapshot, or binds an artifact from another source is rejected; the database seal transition's count and exact-set anti-joins must pass, and the READY FK must target `SEALED`.
- A membership change cannot mutate the old TaxCase snapshot; the database write guard rejects it, then one atomic successor transaction marks the old case stale and creates the complete new set.
- A derived AIS/26AS/Form16A record pointing to an artifact in another tenant is rejected.
- An account parent or BookSet default account from another BookSet is rejected.
- A journal whose actual postings do not balance, use mixed currencies, or cross tenant/BookSet/journal scope remains unposted.
- A transfer with one unposted leg, unequal actual amounts, different currency/purpose/evidence, or mismatched journal binding rolls back completely.
- A correction sequence greater than one without complete verified metadata remains `REVIEW/BLOCK`.
- A correction or late source cannot leave an affected FilingSnapshot or ExportRun `CURRENT`; missing invalidation reason/source/superseding-case fields, partial marking, or a stale/drifted export selection/attempt is rejected and the correction transaction rolls back.
- A pre-submission invalidation with any actual SubmissionAttempt, a same-case post-submission replacement, a self successor, a non-adjacent or route-mismatched successor, or a replacement that reuses the old snapshot/export identity is rejected by conditional checks/deferred assertions.
- A portal status without a bound filing-specific artifact and exact raw official label remains absent; internal `exported` does not become `submitted`, and invalidity is not a portal status.
- A correction updates no original row and cannot create a second authoritative lineage definition.

## 5. Gate0 proof obligations

No proof is claimed here. These obligations must be directed, run, and evidenced separately under the existing Gate0/readiness process. They do not authorize implementation.

### SQLite

- Demonstrate composite primary/unique/foreign-key enforcement with foreign keys enabled through the selected runtime boundary.
- Prove the full-history database uniqueness/guard for exactly one personal BookSet across the tenant lifetime, including archived rows and replacement/migration identity preservation; prove full-table tenant account-code uniqueness including archived rows, same-BookSet parent/default database relationships, the sealed-membership database write guard plus atomic successor transaction, actual-postings balance gate, and composite tenant-aware transfer/evidence relationships with atomic two-leg validation under SQLite transaction and concurrency semantics.
- Prove that hash-indexed re-imports remain visible and that no cross-tenant derived evidence or portal status without evidence can be persisted.
- Prove date, currency, non-zero amount, append-only, and rollback behavior with the chosen SQLite versions and storage settings.

### PostgreSQL

- Demonstrate equivalent database composite key/FK relationships, global PAN uniqueness, full-history lifetime personal-BookSet uniqueness including archived rows, full-table never-reused tenant account codes including archived rows, same-BookSet hierarchy/default ownership, sealed-membership write guards with atomic successor transactions, and immutable relationship behavior.
- Prove actual-postings balance and paired transfer atomicity under concurrent transactions, including constraint timing and rollback behavior.
- Prove compatibility checks for period, Act, rule snapshot, and all four independently hashed/effective-dated artifact bindings.
- Prove tenant isolation, evidence binding, status-label enforcement, and migration/upgrade behavior on the selected PostgreSQL versions.

### MySQL

- Demonstrate equivalent database semantics on the selected InnoDB and MySQL versions, including composite keys/FKs, global PAN uniqueness, full-history exactly one lifetime personal BookSet including archived rows, full-table never-reused tenant account codes including archived rows, sealed-membership write guards with atomic successor transactions, and supported constraint timing.
- Prove actual-postings balance, paired transfer atomicity, rollback, and concurrency behavior without relying on unsupported or ignored constraints.
- Prove same-BookSet parent/default database relationships, composite tenant-aware evidence ownership, period/Act/artifact compatibility, append-only evidence and corrections, and tenant isolation.
- Prove that version gates are explicit where MySQL behavior differs, and that no fallback silently weakens a required invariant.

### Cross-dialect acceptance

- Produce reviewed logical-schema equivalence evidence for all three dialects, including upgrade and rollback paths, without declaring equivalence in advance.
- Exercise every fail-closed scenario above on every selected dialect.
- Prove on each selected dialect that full-history uniqueness/guards include archived rows, membership writes are rejected after creation, successor creation is atomic, and transfer/evidence ownership is enforced by composite tenant-aware database relationships rather than application convention.
- Record exact versions, constraint behavior, transaction behavior, and unresolved differences. Any unresolved difference blocks implementation authority until owner and architect decide.

## 6. Review and authority boundary

This RFC is not architect-reviewed. All 16 PT decisions (PT-001 through PT-016) are owner-approved; NOT ARCHITECT-REVIEWED. The RFC does not approve Gate0, implementation, schema deployment, a dialect, a migration, a utility, a portal route, or a dependency. Only architect review followed by the existing Gate0 and review gates can change that boundary.

**End of RFC.**
