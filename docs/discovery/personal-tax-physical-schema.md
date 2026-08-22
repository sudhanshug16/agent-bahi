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

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `fact_set_id`, `fact_schema_version`, `rule_snapshot_id`, `fact_set_hash`, `sealed_at`, `sealed_by`. Nullable: none (all required for sealed fact provenance).
- **Primary key:** `(tenant_id, tax_case_id, fact_set_id)`.
- **Unique keys:** `UNIQUE(tenant_id, tax_case_id, fact_set_id, fact_set_hash)` — exact immutable fact set identity; candidate key for composite FK targets from FilingSnapshot.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id)` to TaxCase ensuring fact sets are bound to the correct case and tenant.
- **Immutability:** fact_set_id, fact_schema_version, rule_snapshot_id, canonical fact payload/manifest, fact_set_hash, sealed_at, and sealed_by are all immutable after creation. Fact sets are append-only; facts cannot be recomputed in place.
- **Scope:** Owned by tenant+TaxCase. A TaxCase may identify its current canonical fact set, but every FilingSnapshot MUST carry eligibility_fact_set_id+hash NOT NULL and composite-FK it to the same case's sealed fact set.
- **Contents:** Immutable frozen eligibility facts (determined form applicability, taxpayer status, income sources, filing obligations, entity classification) with exact evidence provenance. `fact_set_hash` is computed over the canonical fact payload/manifest, the ordered evidence `(evidence_artifact_id, evidence_artifact_hash)` tuples, `fact_schema_version`, and `rule_snapshot_id`. The hash input explicitly excludes `fact_set_hash` itself, `fact_set_id`, `sealed_at`, `sealed_by`, and all mutable metadata; it has no self-reference.
- **Gates:** Facts are sealed atomically at TaxCase creation or explicit eligibility determination. Facts cannot be recomputed retroactively; changes require successor TaxCase (PT-016) with a new fact set. FilingSnapshot must reference its exact applicable fact set via composite FK to prevent fact drift during export or submission.

### 2.10 `authority_packs`

- **Fields:** `authority_pack_id`, governing Act, applicable period, filing trigger, `rule_snapshot_id`, `schema_artifact_id`, `schema_artifact_kind` (fixed='SCHEMA'), `schema_artifact_hash`, `validation_rules_artifact_id`, `validation_rules_artifact_kind` (fixed='VALIDATION_RULES'), `validation_rules_artifact_hash`, `utility_reference_artifact_id`, `utility_reference_artifact_kind` (fixed='UTILITY_REFERENCE'), `utility_reference_artifact_hash`, `instructions_artifact_id`, `instructions_artifact_kind` (fixed='INSTRUCTIONS'), `instructions_artifact_hash`, `pack_content_hash` (computed over ordered four role+ID+kind+hash tuples plus Act/period/trigger/provenance), official source reference, effective dates, compatibility metadata.
- **Primary key:** `authority_pack_id`.
- **Unique keys:** `UNIQUE(authority_pack_id, pack_content_hash)` — exact immutable pack identity.
- **Candidate keys:** `UNIQUE(authority_pack_id, pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id)` — sealed applicability/rule tuple for composite FK targets. `UNIQUE(governing_act, period_key, filing_trigger, pack_content_hash)` optional secondary candidate key for governance/timing lookup.
- **Foreign keys:** period to `income_periods`; composite FK `(rule_snapshot_id, governing_act, period_key, filing_trigger)` to rule_snapshots exact candidate key ensuring rule compatibility; four composite FKs to `official_artifacts` via exact triple: `(schema_artifact_id, schema_artifact_kind, schema_artifact_hash)`, `(validation_rules_artifact_id, validation_rules_artifact_kind, validation_rules_artifact_hash)`, `(utility_reference_artifact_id, utility_reference_artifact_kind, utility_reference_artifact_hash)`, `(instructions_artifact_id, instructions_artifact_kind, instructions_artifact_hash)`. All four are NOT NULL; each kind enum enforced by CHECK constraint.
- **Immutability:** pack ID, all four component ID/kind/hash triples, Act, period, trigger, rule_snapshot_id, pack_content_hash, source, and effective interval are immutable after creation. Pack is created atomically only when all four component triples and rule_snapshot are present and valid; no intermediate or incomplete state exists.
- **Atomicity:** All four artifacts and rule_snapshot binding must be bound at creation time in one atomic transaction. Missing any component or rule_snapshot prevents pack creation.
- **Contents:** An AuthorityPack is an immutable sealed bundle containing exactly four independently hashed immutable component bindings (schema, validation rules, utility reference/version, instructions), plus applicable period, filing trigger, governing Act, and immutable rule_snapshot_id.
- **Gate:** every FilingSnapshot and TaxCase must bind exactly one compatible AuthorityPack by exact (authority_pack_id, pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id) composite FK. Missing or incompatible pack returns REVIEW/BLOCK. Pack is fully sealed and ready upon creation; no incremental completion states.

### 2.11 `tax_cases`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `pan`, normalized `period_key`, assessment year, ordinal `filing_sequence` (CHECK `filing_sequence > 0`), filing trigger, governing Act, `rule_snapshot_id`, `authority_pack_id`, `authority_pack_content_hash`. Nullable: selected form (if not frozen at creation), internal filing lifecycle, case readiness state, staleness reason.
- **Primary key:** `(tenant_id, tax_case_id)`.
- **Unique keys:** `(tenant_id, period_key, filing_sequence)`; a TaxCase is one non-posting case per taxpayer, period, and sequence.
- **Candidate keys:** `UNIQUE(tenant_id, pan, period_key, filing_sequence, tax_case_id)` — exact lineage tuple for composite FK targets in tax_case_lineage and correction_metadata.
- **Foreign keys:** composite FK `(tenant_id, pan)` to the matching unique candidate key in tenants; period to `income_periods`; composite FK `(rule_snapshot_id, governing_act, period_key, filing_trigger)` to rule_snapshots exact candidate key; composite FK `(authority_pack_id, authority_pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id)` to authority_packs exact candidate key (ensures all four components sealed and rule compatible).
- **Successor Lineage:** Successor cases are tracked via the separate tax_case_lineage relation (2.25), not via direct pointer.
- **Immutability:** PAN, period, sequence, trigger, Act, rule_snapshot_id, authority pack ID, selected form facts, and membership snapshot are immutable. Internal state transitions and staleness are audited; an original case is never edited into a successor.
- **Internal states (PT-013):** preparation/readiness state is separate from external portal status. Internal filing lifecycle is exactly `PREPARED`, `EXPORTED`, or `UNKNOWN`; case readiness remains an internal product state. Validation is recorded only as the ExportRun `validation_outcome`, never as a TaxCase lifecycle value.
- **Portal status:** only these five normalized portal labels are allowed: `SUBMITTED`, `VERIFIED`, `PROCESSED`, `DEFECTIVE`, and `CASE_TRANSFERRED_TO_ASSESSING_OFFICER`, corresponding to the exact raw labels in the current [ITD ITR Status FAQ](https://www.incometax.gov.in/iec/foportal/help/e-filing-know-itr-status-faq). Each non-null portal label requires a bound `portal_status_evidence` row retaining the exact raw label and evidence. An invalid return is a separate derived legal consequence/internal condition only when supported by bound defect or notice evidence; it is never a portal label. Form 16A is never a portal status.
- **Gates:** TaxCase creation binds the matching tenant PAN, period-derived Act, compatible rule snapshot, compatible authority pack via exact (ID, content_hash, Act, period, trigger, rule_snapshot) ensuring all four components sealed and rule compatible, normalized membership, and non-empty source catalog atomically. Form eligibility must be evaluated from the frozen facts and official predicates before `ready`, validation, or export. A changed membership/source catalog marks the case stale and blocks the affected action.

### 2.12 `filing_snapshots`

- **Fields:** NOT NULL: `snapshot_id`, `tenant_id`, `tax_case_id`, `pan`, `period_key`, `filing_sequence`, `eligibility_fact_set_id`, `eligibility_fact_set_hash`, `authority_pack_id`, `authority_pack_content_hash`, `governing_act`, `filing_trigger`, `rule_snapshot_id`, declared `tax_computation_version`, declared `tax_computation_hash` (expected hash for canonical computation), as_of_instant timestamp, snapshot_content_hash (computed over inputs: ordered BookSet entries + artifact hashes + exact frozen fact-set ID/hash + computation version/hash). Nullable: none (all required for sealed filing state).
- **Primary key:** `snapshot_id`.
- **Unique keys:** `UNIQUE(tenant_id, tax_case_id, snapshot_id)` — tenant-scoped snapshot uniqueness.
- **Candidate keys:** `UNIQUE(tenant_id, tax_case_id, snapshot_id, authority_pack_id, authority_pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, eligibility_fact_set_id, eligibility_fact_set_hash)` — repeats TaxCase applicability/rule/fact tuple for closed FK chain to tax_computations and export_runs ensuring exact matched facts, pack, and rule.
- **Foreign keys:** composite FK `(tenant_id, pan, period_key, filing_sequence, tax_case_id)` to TaxCase candidate key `UNIQUE(tenant_id, pan, period_key, filing_sequence, tax_case_id)` ensuring exact applicability match including pan, sequence, and period in declared order (child FilingSnapshot tuple must exactly match parent TaxCase candidate key in columns/order); composite FK `(tenant_id, tax_case_id, eligibility_fact_set_id, eligibility_fact_set_hash)` to eligibility_fact_sets exact candidate key ensuring frozen facts match this case; composite FK `(authority_pack_id, authority_pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id)` to authority_packs exact candidate key.
- **Immutability:** snapshot ID, eligibility fact set (ID, hash), authority pack (ID, content_hash, Act, period, trigger, rule), declared computation version/hash, timestamp, and snapshot_content_hash are immutable. A new snapshot is created when books, sources, or facts change before submission. Snapshot content hash explicitly includes exact frozen fact-set ID/hash to prevent fact drift.
- **No computation FK:** FilingSnapshot does NOT store `tax_computation_id`; this breaks circular dependency. Declared computation version/hash is an input to snapshot content hash and must match the canonical TaxComputation created atomically with this snapshot.
- **BookSet and Artifact Membership:** Explicit via junction tables filing_snapshot_booksets (2.12a) and filing_snapshot_artifacts (2.12b). Membership must be nonempty before snapshot seals/readiness.
- **Gate:** FilingSnapshot must bind exactly one sealed AuthorityPack via exact (ID, content_hash, Act, period, trigger, rule), bind exactly one sealed eligibility_fact_set via exact (ID, hash) to the same case, and enumerate exact BookSet ledger versions via junction (not as-of alone). Every ExportRun is tied to exactly one FilingSnapshot via tenant-scoped composite FK. Snapshot and its canonical TaxComputation created atomically; their version/hash must match or integrity violated. Child FilingSnapshot tuple must exactly match TaxCase candidate key in columns/order including pan and sequence.

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

- **Fields:** NOT NULL: `computation_id`, `tenant_id`, `tax_case_id`, `snapshot_id`, `authority_pack_id`, `authority_pack_content_hash`, `governing_act`, `period_key`, `filing_trigger`, `rule_snapshot_id`, `eligibility_fact_set_id`, `eligibility_fact_set_hash`, version, result_hash (computed over tax computation payload/result). Nullable: tax computation state.
- **Primary key:** `computation_id`.
- **Unique keys:** `UNIQUE(snapshot_id)` — exactly one canonical computation per snapshot.
- **Candidate keys:** `UNIQUE(tenant_id, tax_case_id, snapshot_id, computation_id, result_hash)` — repeats snapshot applicability tuple and result hash for composite FK targets in export_runs; ensures canonical computation uniqueness per snapshot.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, snapshot_id, authority_pack_id, authority_pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, eligibility_fact_set_id, eligibility_fact_set_hash)` to the FilingSnapshot candidate key with the exact declared tuple `UNIQUE(tenant_id, tax_case_id, snapshot_id, authority_pack_id, authority_pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, eligibility_fact_set_id, eligibility_fact_set_hash)`; no shorter or reordered target tuple is valid.
- **Immutability:** computation ID, snapshot binding, applicability tuple including `eligibility_fact_set_id` and `eligibility_fact_set_hash`, version, and result_hash are immutable. A computation never posts to the books.
- **Atomicity and Match:** Snapshot and TaxComputation are created in one atomic transaction. TaxComputation repeats the `version` field, computes result_hash, and captures the snapshot's exact applicability tuple including the eligibility fact-set ID/hash. At creation, snapshot's declared `tax_computation_version` and `tax_computation_hash` must match the computation's version and result_hash, or the transaction rolls back.
- **Gate:** exactly one TaxComputation derives from one FilingSnapshot via UNIQUE(snapshot_id). Multiple ExportRuns may use the same computation if snapshot has not changed. No mutable post-seal update to either entity.

### 2.14 `export_runs`

- **Fields:** NOT NULL: `export_id`, `tenant_id`, `tax_case_id`, `snapshot_id`, `computation_id`, `computation_result_hash`, export format, export timestamp, content_hash, output_schema_version, validation_identity, `validation_outcome` (immutable export validation result: PASSED, FAILED, INCOMPLETE, UNKNOWN, or REVIEW; reflects deterministic schema/computation validation state, not lifecycle). Nullable: creation metadata non-identity fields.
- **Primary key:** `export_id`.
- **Unique keys:** candidate key `UNIQUE(tenant_id, tax_case_id, export_id)` (enforces each export belongs to exactly one case). `(snapshot_id, export_format, export_timestamp, content_hash)` optional secondary uniqueness for content tracking.
- **Foreign keys:** `(tenant_id, tax_case_id)` to TaxCase (composite FK); composite FK `(tenant_id, tax_case_id, snapshot_id, computation_id, computation_result_hash)` to the exact TaxComputation candidate key `UNIQUE(tenant_id, tax_case_id, snapshot_id, computation_id, result_hash)`, ensuring export binds the canonical computation and its verified result hash. No additional snapshot identity fields are needed here: the referenced TaxComputation tuple is immutable and itself exact-FK-bound to the complete FilingSnapshot candidate key.
- **Immutability:** export ID, snapshot binding, computation binding (ID and result_hash), content hash, validation_outcome are immutable. A new export is created for a snapshot when format or generation parameters change.
- **Validation outcome:** validation_outcome is NOT NULL and immutable, recording whether deterministic schema and computation validation passed or identified issues (PASSED, FAILED, INCOMPLETE, UNKNOWN, REVIEW). Structured validation evidence and error details are stored separately in validation_evidence rows, linked by export_id. Validation is mandatory before export readiness, but validation_outcome is not a filing lifecycle state (which is exactly PREPARED, EXPORTED, or UNKNOWN).
- **Output integrity:** content_hash and output_schema_version are NOT NULL and immutable, verifying export content integrity across lifecycle.
- **No selection flag:** ExportRun does NOT store a selected-for-submission boolean. Selection is managed through the separate `submission_bindings` entity, which enforces concurrency gates and immutability post-attempt.
- **Gate:** multiple ExportRuns may exist per snapshot. Each export binds exactly one canonical computation from that snapshot (no mismatch possible via composite FK). Validation outcome must be captured before export is ready for submission or filing. Selection is recorded separately via `submission_bindings`. Composite FK `(tenant_id, tax_case_id, selected_export_id)` from submission_bindings ensures selected export belongs to same case.

### 2.14a `submission_bindings`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `selected_export_id`, `selected_at`, `selected_by`. Nullable: `locked_at` (null only before first attempt).
- **Primary key:** `(tenant_id, tax_case_id)` — exactly one binding row per TaxCase for entire lifetime.
- **Unique keys:** same as PK; enforces at most one binding per TaxCase.
- **Candidate keys:** `(tenant_id, tax_case_id, locked_at)` — unique before first attempt to enforce single null-locked_at state; after first attempt locked_at is non-null and row becomes immutable. `(tenant_id, tax_case_id, selected_at, selected_by)` — selection timestamp/actor tuple for audit.
- **Foreign keys:** `(tenant_id, tax_case_id)` to TaxCase; composite FK `(tenant_id, tax_case_id, selected_export_id)` to ExportRun candidate key `UNIQUE(tenant_id, tax_case_id, export_id)` (ensures selected export belongs to same case).
- **Row Creation:** A binding row is created and inserted only when an export is selected for the first time. Before selection, no row exists. The INSERT is atomic: `selected_export_id`, `selected_at` (timestamp), `selected_by` (actor), and `locked_at=NULL` are all set in one transaction. selected_at and selected_by are NOT NULL on insert.
- **Before First Attempt:** `selected_export_id`, `selected_at`, and `selected_by` are mutable via UPDATE with WHERE `locked_at IS NULL`. Each update changes all three atomically. Selection change history recorded in audit_records with tenant_id, tax_case_id, old/new export_id, old/new selected_at/by, actor, timestamp. Use serialized protocol: SELECT FOR UPDATE (Postgres/MySQL) or writer transaction (SQLite) on binding row, recheck `locked_at IS NULL`, then UPDATE with exactly-one-row check.
- **After First Attempt:** First SubmissionAttempt insert atomically sets `locked_at` to non-null timestamp within same serialized transaction. Row becomes immutable; any attempted update to `selected_export_id`, `selected_at`, `selected_by`, or `locked_at` after this flag is non-null fails closed.
- **Concurrency gate:** UNIQUE(tenant_id, tax_case_id) constraint ensures exactly one binding per case. Candidate key `(tenant_id, tax_case_id, locked_at)` enforces single pre-attempt state. Serialized protocol (SELECT FOR UPDATE + recheck) prevents concurrent selection changes or first-attempt races.
- **First Attempt Requirement:** First attempt requires an existing binding row with non-null `selected_export_id`, `selected_at`, and `selected_by`.
- **Gate:** Selection may be changed only via UPDATE before first SubmissionAttempt, updating all three fields atomically. Once first attempt exists and locked_at is non-null, this binding becomes immutable and subsequent corrections use a successor TaxCase (PT-016) with its own new binding row.

### 2.15 `submission_attempts`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `attempt_id` (positive integer, sequence 1, 2, 3, ...), `attempt_number` (CHECK `attempt_number > 0`), `binding_locked_at` (FK link to submission_bindings.locked_at), `attempted_at` (submission timestamp), `attempted_by` (actor), immutable request/output `hash` (e.g., portal request/response hash), `outcome` (SUBMITTED, RECEIVED, ACCEPTED, REJECTED, UNKNOWN, or similar immutable outcome label). Nullable: `previous_attempt_id`, `previous_attempt_number` (required only for attempt_number > 1).
- **Primary key:** `(tenant_id, tax_case_id, attempt_id)`.
- **Unique keys:** candidate key `(tenant_id, tax_case_id, attempt_number)` enforces one row per attempt number.
- **Candidate keys:** `UNIQUE(tenant_id, tax_case_id, attempt_id, attempt_number)` — exact retry tuple for composite FK targets in portal_status_evidence; never binds attempt_id alone to attempt_number.
- **Constraints:** CHECK `attempt_id > 0 AND attempt_number > 0`; CHECK `(attempt_number=1 AND previous_attempt_id IS NULL AND previous_attempt_number IS NULL) OR (attempt_number>1 AND previous_attempt_id IS NOT NULL AND previous_attempt_number IS NOT NULL AND previous_attempt_number=attempt_number-1)` enforces contiguity: first attempt has no predecessor, later attempts reference the immediately preceding attempt.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, binding_locked_at)` to submission_bindings candidate key `(tenant_id, tax_case_id, locked_at)` ensures binding is locked before any attempt; composite FK `(tenant_id, tax_case_id, previous_attempt_id, previous_attempt_number)` to submission_attempts candidate key `(tenant_id, tax_case_id, attempt_id, attempt_number)` (only when both previous fields non-null) creates self-referential chain.
- **Immutability:** tenant_id, tax_case_id, attempt_id, attempt_number, attempted_at, attempted_by, immutable request/output hash, outcome, portal receipt/status/response, binding_locked_at are immutable after insert. Retries are separate rows with attempt_number incremented.
- **Submission Fields Contract:** `attempted_at` records the exact timestamp of portal submission attempt. `attempted_by` records the actor/principal that initiated the attempt. `hash` is an immutable computed or preserved hash of the request sent and/or response received (e.g., portal request body hash, ARN/reference hash). `outcome` is an immutable label reflecting the portal's official response (not inferred from elapsed time or absence of evidence). Portal receipt/raw official status is kept in attempt-specific `portal_status_evidence` unless the attempt table explicitly stores them; remove any prose claiming fields absent from this contract.
- **Serialized Protocol:** First attempt uses `attempt_number=1`, no previous fields; all subsequent retries increment attempt_number to 2, 3, etc., with explicit previous_attempt_id/number. Use the same submission_bindings row lock:
  - **First attempt:** requires no prior attempts for this (tenant_id, tax_case_id), requires `attempt_number=1`, `previous_attempt_id=NULL`, `previous_attempt_number=NULL`, atomically sets submission_bindings `locked_at` to non-null timestamp within same serialized transaction (SELECT FOR UPDATE or writer transaction on the binding row), and inserts the attempt row with that timestamp as `binding_locked_at`, `attempted_at`, `attempted_by`, and captured `hash` and `outcome`. If `locked_at` is already non-null or a prior attempt exists, insertion fails closed.
  - **Retry:** requires `locked_at` non-null (confirmed by binding FK), requires an existing prior attempt for this (tenant_id, tax_case_id), chooses exactly `MAX(attempt_number)+1`, sets `previous_attempt_id` and `previous_attempt_number` to those of the prior row, and captures `attempted_at`, `attempted_by`, `hash`, and `outcome` for this retry attempt under the same binding lock. Insertion of duplicate or out-of-sequence attempt_number fails closed.
- **Contiguity Note:** The CHECK constraint plus candidate keys plus self-referential FK combine to enforce no gaps and no duplicates. The serialized protocol (SELECT FOR UPDATE + MAX + increment within single serialized transaction) is the implementation mechanism.
- **Gate:** SubmissionAttempt records the binding of selected ExportRun/output hash (via submission_bindings lookup) to official portal attempt timing, actor, request/response hash, and immutable outcome. Before submission, changed books/sources trigger a new FilingSnapshot and ExportRun within the same live TaxCase, and the selection binding is updated (if no attempts yet, via UPDATE WHERE locked_at IS NULL). Post-submission (once first attempt exists and locked_at is non-null), correction work uses a linked successor TaxCase (PT-016) with independent FilingSnapshot, ExportRun, and new binding row. Required evidence binding for submitted status remains fail-closed; absence of portal_status_evidence does not assume submission succeeded.

### 2.16 `tax_case_bookset_membership`

- **Fields:** `tenant_id`, `tax_case_id`, `book_set_id`, inclusion_reason, inclusion_metadata.
- **Primary key:** `(tenant_id, tax_case_id, book_set_id)`.
- **Unique keys:** `UNIQUE(tenant_id, tax_case_id, book_set_id)` — one row per TaxCase and BookSet pair; enforces single membership per (case, BookSet).
- **Foreign keys:** composite FK `(tenant_id, tax_case_id)` to TaxCase candidate key; composite FK `(tenant_id, book_set_id)` to book_sets candidate key. Both FKs enforce same-tenant scope.
- **Immutability:** one membership snapshot is sealed at TaxCase creation time. After creation, a database write guard rejects every INSERT, UPDATE, or DELETE on the old case's membership rows. Sealing is explicit and enforced by database constraints or equivalent dialect-specific mechanism, not by application convention alone.
- **Gate:** this normalized relation is the sole authoritative source for TaxCase BookSet membership. A membership change marks the old case `STALE` and atomically creates a successor TaxCase with a new complete set in the same transaction workflow. The database write guard (preventing mutations to old case membership) and atomic successor creation must be proven per dialect at Gate0. No duplicate authoritative membership list is stored in JSON or arbitrary text.

### 2.17 `external_sources`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `readiness_status`. Also required: source type, source identity and period. Nullable: `institution_code`, `account_identifier`, reconciliation state, and actor metadata.
- **Primary key:** `(tenant_id, tax_case_id, source_id)`.
- **Unique keys:** source identity within a TaxCase.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id)` to TaxCase; derived evidence via junction external_source_artifacts (composite FK to evidence_artifacts); BookSet membership explicit via external_source_booksets junction (2.17b).
- **Immutability:** source identity and imported evidence version are immutable; new imports create new evidence/source versions.
- **Source types:** include `AIS`, `26AS`, `Form16A_TDS`, bank, broker, property, loan, EPFO, and NPS evidence. `Form16A_TDS` is non-salary TDS evidence only.
- **Statuses:** exactly `UNKNOWN`, `DECLARED_NOT_APPLICABLE`, `EXPECTED`, `INGESTED`, `RECONCILED`, `CONFLICT`, `INCOMPLETE`, `READY`, or `STALE`; enforce `CHECK (readiness_status IN ('UNKNOWN', 'DECLARED_NOT_APPLICABLE', 'EXPECTED', 'INGESTED', 'RECONCILED', 'CONFLICT', 'INCOMPLETE', 'READY', 'STALE'))`.
- **Readiness integrity:** `readiness_status` is NOT NULL and every transition must use one of the CHECK values; NULL cannot bypass the readiness state machine or a readiness gate.
- **Gates:** complete required catalog enumerated before readiness; mandatory unresolved entries block action. Empty catalog cannot become ready. All BookSet membership explicit via external_source_booksets junction; artifact associations explicit via external_source_artifacts junction.

### 2.17a `external_source_artifacts`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `evidence_artifact_id`, `evidence_artifact_hash`. Nullable: parser_version, parser_role (if applicable to source type).
- **Primary key:** `(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)` — prevents duplicate evidence binding to the same source.
- **Unique keys/Candidate keys:** enforced by PK; one row per distinct artifact per source. Matching candidate key `UNIQUE(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)` for FK targets from derived_source_records.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, source_id)` to external_sources candidate key; composite FK `(tenant_id, evidence_artifact_id, evidence_artifact_hash)` to evidence_artifacts candidate key UNIQUE(tenant_id, artifact_id, artifact_hash). Both FKs enforce tenant_id equality.
- **Immutability:** all fields immutable after insert; junction bindings are append-only.
- **Scope:** Tenant-scoped. Both FKs carry tenant_id to enforce same-tenant source and evidence.
- **Gate:** every artifact linked to an external source must be bound explicitly via this junction; no cross-tenant artifact/source bindings are possible. Derived records carry exact tuple reference to prevent binding artifacts from other sources or cases.

### 2.17b `external_source_booksets`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `book_set_id`.
- **Primary key:** `(tenant_id, tax_case_id, source_id, book_set_id)` — prevents duplicate BookSet binding to the same source within a case.
- **Unique keys:** one row per source-BookSet pair within a TaxCase.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, source_id)` to external_sources exact PK; composite FK `(tenant_id, tax_case_id, book_set_id)` to tax_case_bookset_membership exact PK. Both FKs enforce tenant_id/case/source/BookSet consistency.
- **Immutability:** all fields immutable after insert; junction bindings are append-only.
- **Scope:** Tenant and TaxCase scoped. A source may map to multiple member BookSets; a BookSet may be referenced by multiple sources within the same case.
- **Gate:** every BookSet linked to an external source within a TaxCase must be a member of that TaxCase (via tax_case_bookset_membership); source artifacts remain bound to exact source/case, never drift across cases or BookSets. Reconciliation records reference this exact junction for BookSet/source pairing.

### 2.18 `evidence_artifacts`

- **Fields:** NOT NULL: `tenant_id`, `artifact_id`, `artifact_hash`. Nullable: content type, size, storage reference, parser identity/release, retrieval metadata.
- **Primary key:** `(tenant_id, artifact_id)`.
- **Unique keys:** `UNIQUE(tenant_id, artifact_id, artifact_hash)` — exact identity tuple for composite FK targets; content hash indexed for lookup. Re-imports are visible as separate rows with different artifact_id.
- **Foreign keys:** composite FK `(tenant_id)` to tenants.
- **Immutability:** artifact ID, content hash, storage reference, and parser provenance are immutable after insert; a new file or parser result creates a new row.
- **Gate:** every derived record, filing/portal evidence row, and filing_snapshot_artifacts points to exact artifact via (tenant_id, artifact_id, artifact_hash); no import overwrites another artifact. artifact_hash is NOT NULL on every row, required where evidence is mandatory.

### 2.19 `external_source_derived_records`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `source_id`, `derived_record_id`, `evidence_artifact_id`, `evidence_artifact_hash`. Nullable: parsed facts, parser warnings, and derivation metadata non-identity fields.
- **Primary key:** `(tenant_id, tax_case_id, source_id, derived_record_id)`.
- **Unique keys:** derived-record identity within its source.
- **Foreign keys:** source composite key `(tenant_id, tax_case_id, source_id)` to external_sources candidate key; exact composite FK `(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)` to external_source_artifacts. Enforces: no artifact from another source/case; same tenant across source and evidence.
- **Immutability:** derived records are append-only and retain their raw-artifact pointer via exact tuple.
- **Tenant Enforcement:** No cross-tenant derived evidence is accepted, even when artifact IDs or source IDs collide; the exact composite tenant-aware database relationship enforces evidence ownership.
- **Gate:** Parser warnings never become reconciliation success.

### 2.20 `reconciliation_records`

- **Fields:** NOT NULL: `tenant_id`, `reconciliation_id`, `tax_case_id`, `source_id`, `book_set_id`, `evidence_artifact_id`, `evidence_artifact_hash`, `outcome`, `amount`, `reason`, `actor`, `timestamp`. Nullable: none (all required for integrity).
- **Primary key:** `(tenant_id, reconciliation_id)`.
- **Unique keys:** reconciliation identity within the tenant.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id)` to TaxCase; composite FK `(tenant_id, tax_case_id, source_id, book_set_id)` to external_source_booksets exact PK (ensures source/BookSet pair is valid and both are bound to the same case); composite FK `(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)` to external_source_artifacts exact candidate key `UNIQUE(tenant_id, tax_case_id, source_id, evidence_artifact_id, evidence_artifact_hash)`. All FKs enforce same-tenant scope via tenant_id; no loose BookSet-only FK, artifact-only FK, or null-field bypass can substitute for the source/BookSet junction or exact source-artifact binding.
- **Immutability:** a reconciliation result is append-only; a new comparison creates a new record.
- **Non-integrity metadata:** outcome labels, conflict descriptions, reason explanations, reviewer notes, and timestamp observations are observational metadata, not enforcement constraints.
- **Gate:** reconciliation links books and evidence without replacing either; a required conflict cannot be marked ready by acknowledgement alone. Source/BookSet pairing must exist via external_source_booksets junction in the same case, and the exact source-artifact tuple must exist via external_source_artifacts. All required fields (artifact ID/hash, outcome, amount, reason, actor, timestamp) must be present and NOT NULL; no nullable composite bypass or weaker artifact-only integrity path is allowed.

### 2.21 `correction_metadata`

- **Fields:** NOT NULL: `tenant_id`, `predecessor_tax_case_id`, `predecessor_sequence` (from predecessor TaxCase), `successor_tax_case_id`, `successor_sequence` (from successor TaxCase), `successor_governing_act`, `successor_period_key`, `successor_filing_trigger`, `successor_rule_snapshot_id`, `successor_authority_pack_id`, `successor_authority_pack_content_hash`, verified_trigger (source of correction requirement), applicable_mechanism_id, `rule_reference_id` (immutable reference to rule_snapshots), `correction_evidence_artifact_id`, `correction_evidence_artifact_hash`, verifier, verification_timestamp. Nullable: deadline_source.
- **Primary key:** `(tenant_id, predecessor_tax_case_id, successor_tax_case_id)`.
- **Unique keys:** one verified metadata record per successor TaxCase.
- **Candidate keys:** `UNIQUE(tenant_id, predecessor_tax_case_id, successor_tax_case_id, applicable_mechanism_id, rule_reference_id, verified_trigger)` — exact correction metadata tuple for audit and lineage tracing.
- **Foreign keys:** composite FK `(tenant_id, predecessor_tax_case_id, predecessor_sequence, successor_tax_case_id, successor_sequence)` to tax_case_lineage exact candidate key `UNIQUE(tenant_id, predecessor_tax_case_id, predecessor_sequence, successor_tax_case_id, successor_sequence)` (binds both sequences, especially successor_sequence, to the explicit lineage relation); composite FK `(tenant_id, successor_authority_pack_id, successor_authority_pack_content_hash, successor_governing_act, successor_period_key, successor_filing_trigger, successor_rule_snapshot_id, applicable_mechanism_id, rule_reference_id, verified_trigger)` to authority_pack_correction_routes exact candidate key ensuring the successor pack contains the verified mechanism route with exact applicability/rule tuple match; composite FK `(tenant_id, correction_evidence_artifact_id, correction_evidence_artifact_hash)` to evidence_artifacts candidate key UNIQUE(tenant_id, artifact_id, artifact_hash).
- **Immutability:** verified metadata is append-only; a changed mechanism creates a new successor TaxCase, lineage row, and metadata row. successor_sequence and successor_pack fields are immutable once recorded.
- **Field Names:** Use `rule_reference_id` consistently (not `effective_rule_reference_id`); references immutable rule_snapshots.
- **Non-integrity metadata:** verified_trigger label, mechanism description, deadline text, and verifier notes are observational; the actual mechanism enforcement uses TaxCase successor linking, sealed pack/route, and rule bindings.
- **Gates:** `filing_sequence = 1` needs no correction metadata; every sequence greater than one requires complete, verified correction metadata with bound evidence before `ready`, validation, or export. Missing or unverified metadata yields `REVIEW/BLOCK`. Metadata must be bound to the exact lineage relation connecting predecessor to successor, with successor sequence, pack, and correction route all immutably recorded. It is impossible to attach a correction route from another pack or case via the composite FK to authority_pack_correction_routes.

### 2.21a `authority_pack_correction_routes`

- **Fields:** NOT NULL: `tenant_id`, `authority_pack_id`, `pack_content_hash`, `governing_act`, `period_key`, `filing_trigger`, `rule_snapshot_id`, `applicable_mechanism_id`, `rule_reference_id`, `verified_trigger`, route metadata (mechanism description, deadline, severity). Nullable: none (all required for sealed correction route).
- **Primary key:** `(tenant_id, authority_pack_id, pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, applicable_mechanism_id, rule_reference_id, verified_trigger)`.
- **Unique keys:** one route per exact pack applicability/rule tuple per mechanism per rule per trigger; prevents duplicate routes.
- **Foreign keys:** composite FK `(authority_pack_id, pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id)` to authority_packs exact candidate key ensuring the route is bound to a specific sealed AuthorityPack and its exact content/applicability. Composite FK `(rule_reference_id)` to rule_snapshots ensuring rule reference is valid and sealed.
- **Immutability:** once created, a correction route is immutable; the pack and rule snapshots are immutable, so the route remains exact.
- **Scope:** Authority-pack-scoped correction routes. It is impossible to attach a route/rule/trigger from another pack or case; the composite FK to exact pack content_hash enforces this.
- **Candidate keys:** `UNIQUE(tenant_id, authority_pack_id, pack_content_hash, governing_act, period_key, filing_trigger, rule_snapshot_id, applicable_mechanism_id, rule_reference_id, verified_trigger)` — exact correction-route identity and the literal target tuple for correction_metadata's composite FK.
- **Gate:** Correction metadata for a successor TaxCase must reference this exact route via composite FK, ensuring the correction mechanism is sealed within the applicable AuthorityPack and cannot drift across packs or cases.

### 2.22 `correction_lineages`

- **Fields:** `tenant_id`, `book_set_id`, `lineage_id`, `original_journal_entry_id`, `reversal_journal_entry_id`, `replacement_journal_entry_id`, reason, actor, timestamp.
- **Primary key:** `(tenant_id, book_set_id, lineage_id)`.
- **Unique keys:** one lineage identity within a BookSet.
- **Foreign keys:** composite FK `(tenant_id, book_set_id, original_journal_entry_id)` to journal_entries; composite FK `(tenant_id, book_set_id, reversal_journal_entry_id)` to journal_entries; composite FK `(tenant_id, book_set_id, replacement_journal_entry_id)` to journal_entries. All three FKs enforce same-BookSet scope.
- **Constraints:** CHECK `original_journal_entry_id != reversal_journal_entry_id AND reversal_journal_entry_id != replacement_journal_entry_id AND original_journal_entry_id != replacement_journal_entry_id` — all three journals must be distinct.
- **Immutability:** this is the one canonical correction-lineage definition; lineage rows and linked journals are never rewritten or duplicated under another authoritative definition.
- **Non-integrity metadata:** reason and actor notes are observational; the lineage is the integrity mechanism.
- **Gate:** a posted correction requires the original, reversal, and replacement relationship to be valid and same-BookSet; affected TaxCases become stale and use successor lineage.

### 2.23 `portal_status_evidence`

- **Fields:** NOT NULL: `tenant_id`, `tax_case_id`, `submission_attempt_id`, `submission_attempt_number`, `evidence_id`, `evidence_artifact_id`, `evidence_artifact_hash`, normalized_label (one of: SUBMITTED, VERIFIED, PROCESSED, DEFECTIVE, CASE_TRANSFERRED_TO_ASSESSING_OFFICER), `official_label_raw` (exact raw label), capture_time, actor. Nullable: none (all required for integrity).
- **Primary key:** `(tenant_id, tax_case_id, submission_attempt_id, evidence_id)` — multiple evidence rows per submission attempt allowed; PK prevents duplicates.
- **Unique keys:** evidence identity within the submission attempt.
- **Foreign keys:** composite FK `(tenant_id, tax_case_id, submission_attempt_id, submission_attempt_number)` to submission_attempts exact candidate key `UNIQUE(tenant_id, tax_case_id, attempt_id, attempt_number)` (ensures evidence is bound to a specific submission attempt with both ID and number, never attempt_id alone); composite FK `(tenant_id, evidence_artifact_id, evidence_artifact_hash)` to evidence_artifacts matching UNIQUE(tenant_id, artifact_id, artifact_hash).
- **Immutability:** evidence, its captured label, attempt binding (ID and number), normalized label, and official_label_raw are append-only; no cross-tenant binding possible (both FKs scoped to tenant_id).
- **Receipt and Status Provenance:** Receipt, status, and label capture are specific to the submission attempt, not to the TaxCase or FilingSnapshot. Retries (different submission_attempts, different attempt_numbers) may have different evidence or status labels.
- **Normalized Label Casing:** normalized_label uses uppercase UPPERCASE canonical codes; official_label_raw preserves exact as-received raw text.
- **Gate:** portal label cannot be stored without bound filing-specific evidence (via submission attempt with exact ID and number), exact raw label, and proof that the evidence was captured during that specific submission attempt. invalid_return condition derived separately only from bound defect/notice evidence. Internal `prepared`, `exported`, or `unknown` state never implies a portal label.

### 2.24 `audit_records`

- **Fields:** `tenant_id` (required), `audit_id`, optional `book_set_id`, entity_type, entity_id_fields (serialized composite key of the mutated entity), action (INSERT, UPDATE, DELETE, SELECT), actor, request_id, outcome, reason/notes, timestamp.
- **Primary key:** `(tenant_id, audit_id)` — core audit candidate key for FKs from other entities.
- **Unique keys:** audit identity within the tenant (primary key enforces).
- **Foreign keys:** composite FK `(tenant_id)` to tenants; optional composite FK `(tenant_id, book_set_id)` to book_sets when BookSet scope applies.
- **Scope:** Tenant-scoped with optional BookSet subscope. No cross-tenant audit record is possible; tenant_id is required on every row.
- **Entity Reference Format:** entity_id_fields is a structured field (JSON, text, or separate columns) that contains the full composite key of the mutated entity (e.g., `(tax_case_id)` for TaxCase mutations, `(tax_case_id, source_id)` for external_sources). Do not store nulls or partial composite keys.
- **Immutability:** append-only; audit rows are never updated or deleted.
- **Non-integrity metadata:** reason notes and outcome descriptions are observational; the primary integrity mechanism is immutability of the audit record itself.
- **Gate:** every mutation of a protected or immutable aggregate records an auditable actor, scope, outcome, and full entity identity without exposing secrets or raw sensitive content in operational output. Audit records must not be nullable on tenant_id or entity_id_fields.

### 2.25 `tax_case_lineage`

- **Fields:** NOT NULL: `tenant_id`, `lineage_id`, `pan`, `period_key`, `predecessor_tax_case_id`, `predecessor_sequence`, `successor_tax_case_id`, `successor_sequence`. Nullable: reason.
- **Primary key:** `(tenant_id, lineage_id)`.
- **Unique keys:** lineage identity within the tenant.
- **Candidate keys:** `UNIQUE(tenant_id, predecessor_tax_case_id, predecessor_sequence, successor_tax_case_id, successor_sequence)` — exact lineage tuple for correction_metadata, including both case IDs and both sequences so successor_sequence is lineage-bound. Also declare UNIQUE `(tenant_id, predecessor_tax_case_id)` and UNIQUE `(tenant_id, successor_tax_case_id)` to enforce one predecessor per successor and one successor per predecessor.
- **Foreign keys:** composite FK `(tenant_id, pan, period_key, predecessor_sequence, predecessor_tax_case_id)` to tax_cases exact candidate key `UNIQUE(tenant_id, pan, period_key, filing_sequence, tax_case_id)`; composite FK `(tenant_id, pan, period_key, successor_sequence, successor_tax_case_id)` to tax_cases exact candidate key `UNIQUE(tenant_id, pan, period_key, filing_sequence, tax_case_id)`. Both FKs enforce same tenant, shared taxpayer (pan), shared period, and sequence/case identity with exact matching to TaxCase candidate key in declared order.
- **Constraints:** CHECK `successor_sequence = predecessor_sequence + 1 AND predecessor_tax_case_id != successor_tax_case_id` — successor is exactly the next sequence number (not merely greater), and is a different case.
- **Immutability:** lineage rows are immutable after insertion; the predecessor-successor link is permanent.
- **Scope:** Shared tenant_id, shared taxpayer (pan), shared period_key. Structural sharing via FKs enforces lineage cohesion; structural constraint prevents cross-PAN or cross-period lineage.
- **Gate:** Successor TaxCase creation atomically inserts the lineage row binding predecessor to successor with matching pan and period, enforcing immediate sequential succession (no gaps). Before export or submission, verify the applicable mechanism per the AuthorityPack; missing or unapproved mechanism returns REVIEW/BLOCK.

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

## 4. Fail-closed acceptance scenarios

- A TaxCase with a mismatched PAN, period-incompatible Act, rule snapshot, or official artifact binding is rejected.
- Creating a second PAN tenant with an existing PAN is rejected; the existing tenant and its `(tenant_id, pan)` TaxCase bindings remain the sole taxpayer identity.
- Creating a second personal BookSet, including after archiving or during replacement/migration, is rejected; replacement preserves the original BookSet identity.
- A TaxCase whose normalized membership omits an applicable BookSet, or whose required source catalog is empty, unknown, or stale, cannot become ready or export.
- A membership change cannot mutate the old TaxCase snapshot; the database write guard rejects it, then one atomic successor transaction marks the old case stale and creates the complete new set.
- A derived AIS/26AS/Form16A record pointing to an artifact in another tenant is rejected.
- An account parent or BookSet default account from another BookSet is rejected.
- A journal whose actual postings do not balance, use mixed currencies, or cross tenant/BookSet/journal scope remains unposted.
- A transfer with one unposted leg, unequal actual amounts, different currency/purpose/evidence, or mismatched journal binding rolls back completely.
- A correction sequence greater than one without complete verified metadata remains `REVIEW/BLOCK`.
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
