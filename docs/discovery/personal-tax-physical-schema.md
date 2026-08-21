# Personal Tax Physical-Schema RFC

**Status:** TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED.

**Scope:** This is a documentation-only, dialect-neutral relational contract for the personal-tax data model. It grants no Gate0, implementation, CLI, migration, library, or code authority. PT-001, PT-002, PT-003, PT-004, and PT-009 retain the status **OWNER-APPROVED; NOT ARCHITECT-REVIEWED**; PT-005 through PT-008 and PT-010 through PT-016 remain **TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. See the canonical [personal-tax decision packet](personal-tax-scope.md), including the existing [PT-004](personal-tax-scope.md#pt-004) anchor.

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
- **Unique keys:** `pan` is globally unique across PAN tenants, and `(tenant_id, pan)` is the required matching key for TaxCase identity. Duplicate tenant creation for an existing PAN fails; this prevents one taxpayer from being split across tenants and returns.
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

- **Fields:** `tenant_id`, `book_set_id`, `posting_id`, `journal_entry_id`, `account_id`, signed side (`debit` or `credit`), non-zero amount, currency, posting date, source reference, rule snapshot reference where required, creation metadata.
- **Primary key:** `(tenant_id, book_set_id, posting_id)`.
- **Unique keys:** posting identity within its BookSet.
- **Foreign keys:** `(tenant_id, book_set_id, journal_entry_id)` to `journal_entries`; `(tenant_id, book_set_id, account_id)` to `accounts`; any evidence or rule reference uses a composite tenant-aware database relationship and is tenant-compatible.
- **Immutability:** postings are immutable after insertion; a correction uses reversal and replacement postings.
- **Gates:** every posting carries the same tenant, BookSet, and journal scope; actual debit and credit postings must agree in amount and currency before the journal is posted. No posting can cross a BookSet or tenant.

### 2.6 `bookset_transfers`

- **Fields:** `tenant_id`, `transfer_id`, source and destination BookSet IDs, amount, currency, purpose, evidence reference, source-leg journal ID, destination-leg journal ID, posted status, creation metadata.
- **Primary key:** `(tenant_id, transfer_id)`.
- **Unique keys:** transfer identity within the tenant.
- **Foreign keys:** both BookSets, both journal legs, and the evidence reference use composite tenant-aware database relationships; evidence ownership is not an application convention.
- **Immutability:** a posted transfer and its leg bindings are immutable.
- **Gates:** source and destination differ but share the same tenant; composite tenant-aware database relationships and atomic validation are mandatory; both legs are posted in one transaction; both legs have the same amount, currency, purpose, and evidence binding; actual postings in each leg agree with the transfer; any failure rolls back both legs and the transfer row. Application convention alone cannot establish transfer or evidence ownership.

### 2.7 `income_periods`

- **Fields:** normalized income-period key, start and end dates, assessment-year identity, governing Act identity.
- **Primary key:** normalized period key.
- **Unique keys:** assessment-year mapping is unique for the applicable period.
- **Foreign keys:** none; it is the period authority used by TaxCases and rule snapshots.
- **Immutability:** period identity and Act mapping are immutable once referenced.
- **Gate:** governing Act selection is derived solely from the normalized income period, never from TaxCase creation date, filing date, or a user label.

### 2.8 `rule_snapshots`

- **Fields:** `rule_snapshot_id`, normalized period key, governing Act, effective interval, version, content hash, source reference, retrieval metadata, compatibility state.
- **Primary key:** `rule_snapshot_id`.
- **Unique keys:** `(period_key, version, content_hash)`.
- **Foreign keys:** period key to `income_periods`.
- **Immutability:** a snapshot, hash, effective interval, and compatibility decision are immutable.
- **Gates:** a TaxCase may bind only a snapshot compatible with its normalized period and Act; missing, stale, conflicting, or unapproved authority yields `REVIEW/BLOCK`.

### 2.9 `official_artifact_bindings`

- **Fields:** `binding_id`, `artifact_kind`, version, content hash, effective interval, governing Act/period compatibility, form scope, official source reference, retrieval metadata.
- **Primary key:** `binding_id`.
- **Unique keys:** `(artifact_kind, version, content_hash)`.
- **Foreign keys:** period/Act compatibility references the normalized period and rule authority where needed.
- **Immutability:** bindings are append-only; a new official release creates a new row.
- **Required artifact kinds:** exactly four independently hashed and effective-dated kinds are supported: `schema`, `validation_rules`, `utility`, and `instructions`. They are separate bindings, even when released together, and none may be substituted for another.
- **Gates:** a TaxCase must bind all four compatible kinds before validation or export; a missing, stale, incompatible, or unapproved binding yields `REVIEW/BLOCK`.

### 2.10 `tax_cases`

- **Fields:** `tenant_id`, `tax_case_id`, `pan`, normalized `period_key`, assessment year, ordinal `filing_sequence`, filing trigger, governing Act, `rule_snapshot_id`, four official artifact binding IDs, selected form, frozen eligibility facts/predicate references, internal filing lifecycle, case readiness state, staleness reason, and successor reference.
- **Primary key:** `(tenant_id, tax_case_id)`.
- **Unique keys:** `(tenant_id, period_key, filing_sequence)`; a TaxCase is one non-posting case per taxpayer, period, and sequence.
- **Foreign keys:** `(tenant_id, pan)` to the matching unique tenant key; period to `income_periods`; rule snapshot and all four artifact bindings; successor `(tenant_id, successor_tax_case_id)` to another TaxCase in the same tenant.
- **Immutability:** PAN, period, sequence, trigger, Act, authority bindings, selected form facts, and membership snapshot are immutable. Internal state transitions and staleness are audited; an original case is never edited into a successor.
- **Internal states:** preparation/readiness state is separate from external portal status. Internal filing lifecycle is exactly `prepared`, `exported`, or `unknown`; case readiness remains an internal product state.
- **Portal status:** only these five normalized portal labels are allowed: `submitted`, `verified`, `processed`, `defective`, and `case_transferred_to_assessing_officer`, corresponding to the exact raw labels in the current [ITD ITR Status FAQ](https://www.incometax.gov.in/iec/foportal/help/e-filing-know-itr-status-faq). Each non-null portal label requires a bound `portal_status_evidence` row retaining the exact raw label and evidence. An invalid return is a separate derived legal consequence/internal condition only when supported by bound defect or notice evidence; it is never a portal label. Form 16A is never a portal status.
- **Gates:** TaxCase creation binds the matching tenant PAN, period-derived Act, compatible rule snapshot, all four artifact kinds, normalized membership, and non-empty source catalog atomically. Form eligibility must be evaluated from the frozen facts and official predicates before `ready`, validation, or export. A changed membership/source catalog marks the case stale and blocks the affected action.

### 2.11 `tax_case_bookset_membership`

- **Fields:** `tenant_id`, `tax_case_id`, `book_set_id`, inclusion reason, inclusion metadata.
- **Primary key:** `(tenant_id, tax_case_id, book_set_id)`.
- **Unique keys:** one row per TaxCase and BookSet.
- **Foreign keys:** TaxCase and BookSet composite keys in the same tenant.
- **Immutability:** one membership snapshot is sealed at TaxCase creation; after creation, a database write guard rejects every insert, update, or delete on the old case's membership rows.
- **Gate:** this normalized relation is the one authoritative source for TaxCase BookSet membership. A membership change marks the old case `STALE` and atomically creates a successor with a new complete set in the same transaction workflow. The database write guard and atomic successor transaction must be proven per dialect at Gate0. No duplicate authoritative list is stored in JSON or arbitrary text.

### 2.12 `external_sources`

- **Fields:** `tenant_id`, `tax_case_id`, `source_id`, source type, readiness status, source identity and period, evidence pointer, reconciliation state, and actor metadata.
- **Primary key:** `(tenant_id, tax_case_id, source_id)`.
- **Unique keys:** source identity within a TaxCase.
- **Foreign keys:** TaxCase composite key; artifact and reconciliation references remain tenant-compatible.
- **Immutability:** source identity and imported evidence version are immutable; new imports create new evidence/source versions.
- **Source types:** include `AIS`, `26AS`, `Form16A_TDS`, bank, broker, property, loan, EPFO, and NPS evidence. `Form16A_TDS` is non-salary TDS evidence only.
- **Statuses:** exactly `UNKNOWN`, `DECLARED_NOT_APPLICABLE`, `EXPECTED`, `INGESTED`, `RECONCILED`, `CONFLICT`, `INCOMPLETE`, `READY`, or `STALE`.
- **Gates:** the complete required catalog is enumerated before readiness; mandatory unresolved, conflicting, incomplete, stale, or unknown entries block the affected action. An empty or unenumerated catalog cannot become ready.

### 2.13 `evidence_artifacts`

- **Fields:** `tenant_id`, `artifact_id`, content hash, content type, size, immutable storage reference, parser identity/release, retrieval metadata.
- **Primary key:** `(tenant_id, artifact_id)`.
- **Unique keys:** artifact identity; content hash is indexed for lookup but is not unique, so re-imports remain visible.
- **Foreign keys:** tenant key.
- **Immutability:** raw content, hash, storage reference, and parser provenance are immutable; a new file or parser result creates a new row.
- **Gate:** every derived record and filing/portal evidence row points to an exact artifact; no import overwrites another artifact.

### 2.14 `external_source_derived_records`

- **Fields:** `tenant_id`, `tax_case_id`, `source_id`, `derived_record_id`, artifact tenant and ID, parsed facts, parser warnings, and derivation metadata.
- **Primary key:** `(tenant_id, tax_case_id, source_id, derived_record_id)`.
- **Unique keys:** derived-record identity within its source.
- **Foreign keys:** source composite key and `(artifact_tenant_id, artifact_id)` to `evidence_artifacts`; both must resolve to the same tenant as the source through database relationships.
- **Immutability:** derived records are append-only and retain their raw-artifact pointer.
- **Gate:** no cross-tenant derived evidence is accepted, even when artifact IDs or source IDs collide; the composite tenant-aware database relationship, not application convention, enforces evidence ownership; parser warnings never become reconciliation success.

### 2.15 `reconciliation_records`

- **Fields:** `tenant_id`, `reconciliation_id`, TaxCase/source reference, optional BookSet reference, compared artifact IDs, outcome, conflicts, reviewer, and timestamp.
- **Primary key:** `(tenant_id, reconciliation_id)`.
- **Unique keys:** reconciliation identity within the tenant.
- **Foreign keys:** TaxCase, source, BookSet, and evidence keys must share tenant scope.
- **Immutability:** a reconciliation result is append-only; a new comparison creates a new record.
- **Gate:** reconciliation links books and evidence without replacing either; a required conflict cannot be marked ready by acknowledgement alone.

### 2.16 `correction_metadata`

- **Fields:** `tenant_id`, `tax_case_id`, filing sequence, verified trigger, applicable mechanism identifier, effective rule reference, deadline/source, correction evidence, verifier, and verification timestamp.
- **Primary key:** `(tenant_id, tax_case_id)`.
- **Unique keys:** one verified metadata record per successor TaxCase.
- **Foreign keys:** TaxCase composite key and all evidence/rule references share tenant and period compatibility.
- **Immutability:** verified metadata is append-only; a changed mechanism creates a new successor TaxCase and metadata row.
- **Gates:** `filing_sequence = 1` needs no correction metadata; every sequence greater than one requires complete, verified correction metadata before `ready`, validation, or export. Missing or unverified metadata yields `REVIEW/BLOCK`.

### 2.17 `correction_lineages`

- **Fields:** `tenant_id`, `book_set_id`, `lineage_id`, original journal ID, reversal journal ID, replacement journal ID, reason, actor, and timestamp.
- **Primary key:** `(tenant_id, book_set_id, lineage_id)`.
- **Unique keys:** one lineage identity within a BookSet.
- **Foreign keys:** all three journal IDs use the same `(tenant_id, book_set_id, journal_entry_id)` key.
- **Immutability:** this is the one canonical correction-lineage definition; lineage rows and linked journals are never rewritten or duplicated under another authoritative definition.
- **Gate:** a posted correction requires the original, reversal, and replacement relationship to be valid and same-BookSet; affected derived cases become stale.

### 2.18 `portal_status_evidence`

- **Fields:** `tenant_id`, `tax_case_id`, `evidence_id`, one of the five normalized ITD labels, `official_label_raw` containing the exact raw label, exact artifact/status reference, capture time, and actor.
- **Primary key:** `(tenant_id, tax_case_id, evidence_id)`.
- **Unique keys:** evidence identity within the TaxCase.
- **Foreign keys:** TaxCase and exact `evidence_artifacts` row in the same tenant.
- **Immutability:** evidence and its captured label are append-only.
- **Gate:** a portal label cannot be stored without bound filing-specific evidence and its exact raw official label; an `invalid_return` condition is derived separately only from bound defect/notice evidence. Internal `prepared`, `exported`, or `unknown` state never implies a portal label.

### 2.19 `audit_records`

- **Fields:** tenant and optional BookSet scope, audit ID, entity identity, action, actor/source, request identity, outcome, and timestamp.
- **Primary key:** `(tenant_id, audit_id)`.
- **Unique keys:** audit identity within the tenant.
- **Foreign keys:** any BookSet or entity reference uses the corresponding tenant-aware key.
- **Immutability:** append-only.
- **Gate:** every mutation of a protected or immutable aggregate records an auditable actor, scope, outcome, and reason without exposing secrets or raw sensitive content in operational output.

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

This RFC remains tentative and is not architect-reviewed. PT-001, PT-002, PT-003, PT-004, and PT-009 remain owner-approved but not architect-reviewed; PT-005 through PT-008 and PT-010 through PT-016 remain tentative and not owner-approved. The RFC does not approve Gate0, implementation, schema deployment, a dialect, a migration, a utility, a portal route, or a dependency. Only explicit owner direction followed by the existing Gate0 and review gates can change that boundary.

**End of RFC.**
