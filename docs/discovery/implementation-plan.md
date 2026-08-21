# Implementation Plan: Gate0 through Phase 9

**Status**: Specification-level sequencing document. TypeScript + Bun is owner-selected. This document does not authorize Gate0, Phase 1, or implementation; remaining library choices and phase prerequisites require their own evidence and owner decisions.

**Canonical References**: [Architecture](../architecture.md) | [Accounting Contracts](accounting-contracts.md) | [Data Model Requirements](data-model-requirements.md) | [Statutory Workflow Contracts](statutory-workflow-contracts.md) | [GST Matrix](gst-compliance-matrix.md) | [TDS/TCS Matrix](tds-tcs-compliance-matrix.md) | [Income-Tax Matrix](annual-income-tax-compliance-matrix.md) | [MCA Matrix](mca-companies-act-compliance-matrix.md) | [Tentative Decisions](tentative-decisions.md) | [Skill Architecture](skill-architecture.md)

---

## Owner-Approved and Owner-Selected Decisions (Phase-Scoped Gates)

See [Tentative Decisions](tentative-decisions.md) for the full T-001 through T-010 records. Those entries are owner-approved and binding. TypeScript + Bun is owner-selected. These decisions do not authorize implementation; only the decision applicable to a phase or action gates that work.

- **T-001**: External filing boundary (prepare/validate/export + manual portal for filings without specific-approved transport boundary). See [Tentative Decisions](tentative-decisions.md#t-001).
- **T-002**: Frappe Books reference and licensing boundary (behavior/concept reference only; MIT license; no code reuse). See [Tentative Decisions](tentative-decisions.md#t-002).
- **T-003**: Fixed-asset depreciation policy (separate book/tax schedules; SLM method parameterized and reversible; not implementation authorization).
- **T-004**: FX provider and fallback selection (purpose-specific immutable snapshots; no cross-purpose rate substitution; missing statutory source blocks affected lane only).
- **T-005**: Regular-GST V1 profile baseline (no-registration + regular GST domestic/interstate/export with no universal turnover/AATO ceiling; GSTR-1; GSTR-3B and GST credit reconciliation; e-invoice/e-way-bill upload-file workflows only, with AATO applicability rules inside research-gated e-invoice decisions only; composition/inventory/specialized regimes deferred).
- **T-006**: Batch partial-success distinct nonzero exit code (per-item outcomes; numeric code internal/TBD, not fixed in advance).
- **T-007**: Full individual income-tax scope (sole proprietor, accounting-separated from business/GST; detailed PT implementation gated).
- **T-008**: Controlled user corrections and deletions (allow even after FY/report/audit/filing via explicit unlock preview/reason/confirmation; reversal/replacement lineage; every affected report, filing case, and audit pack marked STALE/DRIFTED with deliberate regeneration/review/re-close required; prior exported/submitted artifacts stay immutable).
- **T-009**: Form 140/141 statutory export (fail-closed pending official current format/utility/schema/portal verification; internal neutral data allowed; no statutory export adapter without verified schema).
- **T-010**: Post-filing return case/evidence/correction (preserve ARN/status/rejection/notices/correction lineage; no unverified automatic revised/amended/defective-return submission).
---

## Gate0: Proof Spikes (Hard Blocker Before Phase 1)

**Current state**: Documentation-only; Gate0 is not authorized. After Sudhanshu reviews the [Owner Review Docket](owner-review-docket.md), his explicit direction/authorization is required to run these reversible proof spikes. TypeScript + Bun is already owner-selected. Gate0 supplies mandatory evidence before implementation; it does not authorize Phase 1 or approve any library. A blocker discovered during or after Gate0 stops the affected work and requires a new owner decision.

**Duration**: 2–3 weeks. All must pass before Phase 1 implementation begins.

- **STK-001**: Bun-native runtime, workspaces, and lockfile on target platforms (macOS arm64, Linux x64/arm64). Resolve the authoritative latest stable Bun release at Gate0; record its exact version, `bun --revision`, artifact checksums, and lockfile/CI/release pins. Do not hard-code a guessed current version today.
- **STK-002**: Bun-native persistence first; if needed, individually proof-gate ORM/driver candidates such as Drizzle, Kysely, or better-sqlite3 on bun-sqlite, PostgreSQL, and MySQL, with schema equivalence verified.
- **STK-003**: SQLite pragmas, WAL, foreign_keys=ON, SQLITE_BUSY handling, network-filesystem rejection.
- **STK-004**: Schema migrations and upgrade paths on all three dialects.
- **STK-005**: Bun-native parser, validation, and exact decimal APIs first; if needed, individually proof-gate Clipanion, Zod, decimal.js, and any other npm-compatible TypeScript package for INR/paise, FX, and tax.
- **STK-006**: Bun build and one Bun-embedded single-file executable per target platform (macOS arm64, Linux x64/arm64), including required MySQL/PostgreSQL drivers and migration assets. The released executable must not require or invoke a separately installed Node runtime, Node subprocess, Node lifecycle hook, separately installed Bun runtime, Bun subprocess, or Bun lifecycle hook; externally bundled npm-compatible packages may be included only after individual Bun proof. This does not prohibit proof-gated third-party packages bundled into the single executable, nor the packaged `agent-bahi` binary being invoked by skills. No source distribution or package/bin fallback is permitted.

**Exit**: All spike reports complete with target-platform evidence and the exact Bun release record. No library or implementation is pre-approved by Gate0. Phase 1 cannot begin until Gate0 evidence, a separately reviewed physical-schema RFC, applicable Phase 1 decisions, and explicit Phase 1 authorization are complete.

---

## Phase 1: Foundation, Tenant Model, and Migrations

**Duration**: 4–6 weeks. Deliverables: conceptual aggregates (tenant/GSTIN context, command registry), migration infrastructure, isolation enforcement.

**Prerequisites**: Gate0 proof spikes pass; the physical-schema RFC is separately reviewed; applicable Phase 1 decisions are approved; and Phase 1 is explicitly authorized. Later-phase tentative IDs block only their affected phase/action, not all of Phase 1. A later blocker stops the affected work and requires a new owner decision.

**Scope**:
- Tenant and GSTIN context (auto-select, explicit fail on ambiguity).
- Conceptual aggregates: Account, Document, Posting, Contact, Currency, Audit (no physical schema authorization; RFC required later).
- Document state machine skeleton (Draft → Posted); reversal lineage hooks (contracts only).
- Ledger invariants contract (debit=credit after rounding in base currency; original currency stored separately).
- Request ID deduplication semantics (no schema; logic-level contract).
- CLI command registry (domain-owned; not ORM-generated).
- Migration infrastructure testing (separate for SQLite, PostgreSQL, MySQL; logical IDs + checksums; proof-spikes validate mechanics).
- Production migrations explicit/reviewed; local/dev may auto-initialize; mismatch fails closed.

**Tests**: Tenant isolation logic; GSTIN resolution; command registry validation; migration test framework (mechanics validated in proof spikes).

**Exit Gate**: Tenant/GSTIN isolation contract defined; command registry stable; migration strategy proven in proof spikes. Physical schema RFC required for implementation; does not imply approval.

**Non-Goals**: Physical schema tables, tax calculations, postings, payroll, bank import, compliance, skills, Evidence aggregate behavior.

---

## Phase 2: Skill Contracts and Catalog (Schema Declarations Only)

**Duration**: 2–3 weeks. Deliverables: skill contract versioning spec, initial job-skill catalog (14 skills) as contract declarations, no implementation code.

**Prerequisites**: Phase 1 complete.

**Scope**:
- Versioned skill-contract schema (purpose, engine/rule compatibility, prerequisites, inputs, evidence, allowed commands, exception routes, automation gate policy).
- Initial job-skill catalog declarations (daily bookkeeper, AP, AR, expense review, bank reconciliation, fixed assets, payroll, month/year close, GST, TDS/TCS, compliance calendar, audit prep, reporting).
- Skill versioning and deprecation policy.
- All skills declare only Phase 1 commands (no forward references except marked DEFERRED).

**Tests**: Contract schema validates; forward references explicit.

**Exit Gate**: Skill catalog complete; no implementation code yet.

**Non-Goals**: Skill runtime, executable logic, embedded accounting rules.

---

## Phase 3: Ledger, Documents, Posting Engine

**Duration**: 6–8 weeks. Deliverables: document state machine, deterministic posting pipeline, reversal/correction lineage, atomic posting.

**Prerequisites**: Phase 1, Phase 2 complete.

**Scope**:
- Document state machine (Draft → Validated → Posted → Settled; immutability enforcement).
- Posting pipeline: validate structure → apply effective-dated rule snapshot → compute derived amounts → generate balanced journal → atomic write (postings + audit).
- Base-currency debit=credit balance enforced after rounding; original-currency amounts and rate snapshots preserved.
- Reversals and corrections: immutable lineage with audit binding.
- Supplier payment posting mechanics: Dr unapplied-supplier-payments / Cr Bank/Cash exactly once; allocation leg clears control against AP.
- Authorization hooks (no-op in V1; framework in place).

**Tests**: State transitions; posting balance; reversal lineage; idempotency; atomic posting; multi-currency FX snapshot.

**Exit Gate**: Document lifecycle complete; posting engine working; postings immutable and balanced. No approval gates, reconciliation proposals, external operations, payroll, or tax logic yet (deferred).

**Non-Goals**: High-consequence approval gates, reconciliation proposals, external operation outbox, payroll finalization, filing snapshots, tax, bank import, compliance, skills, asset depreciation.

---

## Phase 4: Evidence Storage and Linking, Bank Reconciliation Proposals

**Duration**: 4–6 weeks. Deliverables: evidence storage and content-addressing, bank statement import, ephemeral match proposals, evidence-linked reconciliation.

**Prerequisites**: Phase 1–3 complete.

**Scope**:
- Evidence storage: content-addressed immutable blob storage (checksum verification, storage reference, metadata).
- Evidence linking: attachment to documents and postings with hash verification.
- Bank statement import (date, amount, reference, description).
- Ephemeral match proposals (non-posting, zero side effects; candidates only; never persisted without an application-layer commit).
- Reconciliation commit: persistence requires an explicit recorded HUMAN confirmation (`actor_type=human`) bound to the plan ID/digest plus the exact source line, target, amount, FX snapshot, relevant versions, tenant, actor, and timestamp. The CLI/application commit is the sole persistence boundary. Automated workflows and skills cannot confirm or persist a candidate, even when all fields match. Proposals remain ephemeral; stale, mismatched, or missing confirmation fails closed with no reconciliation or posting persistence.
- Bank reconciliation report (matched, unmatched items, period status).
- Exception routing for import validation, ambiguity, missing evidence.

**Tests**: Evidence hashes correct; content-addressing prevents duplicates; proposals non-posting; final CLI/application commit enforces exact-plan confirmation fields; stale, mismatched, or missing confirmation persists nothing; automated workflow/skill confirmation or persistence is rejected even with matching fields; reconciled postings link to statement lines; idempotency.

**Exit Gate**: Bank import and reconciliation proposal logic working; evidence storage and linking complete. Proposals remain ephemeral until confirmed.

**Non-Goals**: Bank statement format/automation standards and FX calculation (deferred to Phase 5).

---

## Phase 5: Reporting, FX, Assets, Employee Expenses

**Duration**: 8–10 weeks. Deliverables: P&L/BS/aging reports, realized AND unrealized FX with explicit period-end revaluation, asset register, employee-expense workflows.

**Prerequisites**: Phase 1–4 complete.

**Scope**:
- P&L reporting with optional --basis cash|accrual parameter (default from tenant setting).
- Balance sheet (ledger/as-of; rejects --basis parameter).
- Trial balance (ledger aggregate; rejects --basis parameter).
- AR/AP aging (ledger balances; rejects --basis parameter).
- Realized FX: at settlement, from allocation posting.
- Unrealized FX: explicit period-end revaluation, reversal, separate accounts, one-time settlement reclassification.
- Cash/accrual tests: pro-rata settlement, unapplied-cash carry, refunds/credit notes, tax fail-closed, FX/bank-fee separation, accrual-only depreciation/revaluation.
- Fixed-asset register: uniqueness exactly on (tenant_id, source_document_id, source_line_id) across capitalization kinds; rejects duplicate attempts; immutable depreciation runs (reversion via new version, never overwrite).
- Separate book and tax depreciation schedules (T-003 owner-approved): each schedule selects its applicable rule-pack method, rate, useful-life, and residual-value independently. No universal SLM or WDV default. Exact statutory method content remains research-gated and evidence-verified per jurisdiction/year/taxpayer profile.
- Employee-expense workflows (claims, advances, reimbursements, corporate-card matching).

**Tests**: P&L basis parameter honored; BS/TB/aging reject --basis; balance sheet identity (assets=liabilities+equity); P&L net flows to equity; FX separation (realized vs. unrealized); asset uniqueness; depreciation immutability.

**Exit Gate**: Reporting complete; FX separation verified; assets tracked; employee expenses working. No payroll yet.

**Non-Goals**: Payroll, GST, TDS, compliance filings, asset methods beyond SLM parameterization.

---

## Phase 6: Payroll Accounting Only (Frozen Bank CSV Export)

**Duration**: 6–8 weeks. Deliverables: employee profiles, salary structures, pay runs, payroll postings, frozen bank-CSV export with explicit debit/reconciliation gates.

**Prerequisites**: Phase 1–5 complete.

**Scope**:
- Employee statutory profiles, salary structures, effective-dated formula evaluation.
- Pay-run draft, approval, posting (balanced entry: Dr payroll expense / Cr payroll payables and deductions).
- Payables (salary, PF, ESI, PT, LWF, TDS, advances/loans).
- **Payroll legal-action gate**: Before any PF/ESI/PT/LWF/TDS applicability or form selection, rate/contribution computation, deadline, statement/certificate, posting, payment/remittance, export, or filing require `source_verified=true` + a non-stale effective rule snapshot + complete facts. Missing/stale/OPEN rules return REVIEW/BLOCK for the affected action only; unaffected salary posting proceeds.
- Salary TDS under s392 owns Forms 130/138 in P6; their applicability, selection, computation, statements/certificates, posting, payment/remittance, export, and filing actions remain independently source-gated here.
- P6 also owns the distinct s393(1) Table 8(iii) specified-bank/senior-citizen cross-lane route for Forms 130/138. Table 8(iii) is non-salary, but uses the payroll-canonical artifact contract; every action remains independently source-gated.
- Legacy salary statement branch: source-gated old-law salary periods use Form 24Q; the new-law effective regime uses Form 138. Effective-period selection, correction, and acknowledgement transition details remain OPEN+BLOCK until period-specific official sources attach.
- Approved summarized inputs only (payable days, LOP, overtime amounts); no attendance, leave, HRMS.
- Frozen bank CSV export (versioned preset, deterministic formatting).
- Bank-file state machine: Generated → Uploaded → Accepted/Rejected → Debited → Reconciled (distinct states, separate evidence).
- Only observed debit clears payroll payable once; export ≠ payment.
- Payroll payable locked while run is draft/unposted; unlock only via reversal pattern.

**Tests**: Salary structure gross/net correct; payables balanced; CSV export deterministic; debit observation required before payable clears; verify the exact legacy/new-law effective boundary at payment/credit through 31 March 2026 versus from 1 April 2026; select Form 24Q versus Form 138 only from a VERIFIED frozen source/effective snapshot; for missing, stale, OPEN, or TENTATIVE source/effective snapshots, statement selection and the correction/acknowledgement transition action each return REVIEW/BLOCK with no artifact or state change; idempotency.

**Exit Gate**: Payroll posting complete; bank-file state machine working; exports frozen and verified. s392 salary Forms 130/138 and the distinct s393(1) Table 8(iii) specified-bank/senior-citizen Forms 130/138 route remain in the P6 payroll-canonical lane; the general s393 branch and s394 TCS are deferred to Phase 7.

**Non-Goals**: Attendance tracking, employee portal, the general s393 Forms 140/141/144 + certificates 131/132 branch and s394 Form143 + certificate133 branch (deferred to Phase 7), composition scheme, SEZ. The s393(1) Table 8(iii) Forms 130/138 cross-lane route is owned here.

---

## Phase 7: Independently Gated Compliance Slices (Provisional Rules Block Only Affected Actions)

**Duration**: 10–12 weeks. Deliverables: GST, non-payroll TDS/TCS, income-tax, MCA compliance with source_verified=true and non-stale rule-snapshot gates.

**Prerequisites**: Phase 1–6 complete. Effective-dated rule packs with official sources.

**Scope**:
- Each compliance action (invoice GST classification, TDS deduction, income-tax computation, MCA filing prep) requires:
  - `source_verified=true` (official source documented)
  - Non-stale `effective_rule_snapshot` (jurisdiction, version, effective dates)
  - Missing/stale rules BLOCK only that action (not all Phase 7)
  - OPEN rules visible; explicitly REVIEW/BLOCK.
- **GST**: Regular taxpayer baseline (no universal turnover/AATO ceiling in base GST model; GSTR-1 output JSON, amendments, ITC eligibility, effective-dated classification; AATO applicability only inside research-gated e-invoice rules).
- **General s393 non-payroll TDS branch** (independent gate; explicitly excludes s393(1) Table 8(iii), which is owned by P6): Form selection, structure, deadline, deduction, posting, payment/remittance, export, filing, and certificates for Forms 140/141/144 + certificates 131/132 each require `source_verified=true`, a non-stale branch snapshot, and complete facts. T-009 blocks only Form140/141 transport/export pending research; it does not block other general s393 actions.
- **s394 TCS branch** (independent gate): Form selection, structure, deadline, collection, posting, payment/remittance, export, filing, and certificate for Form143 + certificate133 each require `source_verified=true`, a non-stale branch snapshot, and complete facts. T-009 does not block Form143 or any TCS action.
- **Income-tax**: Annual return form structure (per official Notification), separate tax computation (not audit report Form 26).
- **MCA**: Mandatory audit applicability, form structure (per official sources; never infer exemptions).
- Obligation engine: Tenant/GSTIN facts → applicable obligations; filing deadlines from rule snapshots; predecessor gates explicit (no GSTR-3B before GSTR-1).
- Compliance calendar and deadline tracking.
- All exports (GSTR-1, GSTR-3B, income-tax, MCA, and any approved statutory TDS/TCS transport) prepare/validate/export + manual filing (no auto-submit without T-001 plus filing-specific research and owner approval). T-009 blocks only Form140/141 transport/export; any approved statutory external transport/outbox is conditional in P7 on those gates.

**Tests**: Tax calculation matches golden fixtures; OPEN rules block affected action only; form exports generate correctly (where not blocked); filing deadlines calculated; predecessor gates enforced; branch separation verified.

**Exit Gate**: GST, income-tax, MCA compliance logic complete. Every action gated on rule snapshot; OPEN rules visible and blocking only affected actions. s393 and s394 branches separately gated; T-009 blocks Form140/141 transport.

**Non-Goals**: Auto-filing, GSP/portal APIs, composition scheme, e-invoice/e-way bill transport (deferred to filing-specific decisions), Form140/141 transport/export pending T-009 research. Form143/TCS and other branches remain independently source-gated; approved statutory external transport/outbox is conditional on T-001 plus filing-specific research and owner approval.

---

## Phase 8A: Full Multi-Dialect Semantic Conformance (After Phase 7; Smoke Tests Since Phase 1)

**Duration**: 4–6 weeks. Deliverables: normalized semantic snapshot comparison, logical migration ID matching, comprehensive smoke tests.

**Prerequisites**: Phase 1–7 complete. Schema/query smoke tests have been running since Phase 1.

**Scope**:
- Normalized semantic snapshots (not binary table equality): same logical schema state on SQLite/PostgreSQL/MySQL.
- Logical-ID matching: migration checksums and logical sequence match across dialects.
- Full-replay test: execute all Phase 1–7 operations; verify final semantic state identical.
- Smoke tests (running since Phase 1): schema migrations, query results, pagination, transaction semantics.
- Dialect-specific safety: SQLite WAL, PostgreSQL prepared statements, MySQL charset/collation.

**Tests**: Full replay; normalized semantic equality; migration checksums match; smoke suite passes all three dialects.

**Exit Gate**: Semantic conformance verified across all three dialects. Schema and query behavior equivalent. Smoke tests comprehensive.

**Non-Goals**: Performance optimization, distributed transactions, dialect-specific extensions.

---

## Phase 8B: Bounded Skill Runtime (Deterministic CLI-Only Invocation)

**Duration**: 6–8 weeks. Deliverables: skill execution engine, manifest loading (allowlist), command invocation, exception routing, gate enforcement (no skill auto-approval).

**Prerequisites**: Phase 2 skill contracts, Phase 8A dialect conformance.

**Scope**:
- Skill manifest loading (allowlist-based; hashes, versions; no arbitrary filesystem execution).
- Command invocation (subprocess execution of the packaged `agent-bahi` executable only; never Node/npm scripts, a separate runtime, direct external APIs, secrets, or evidence/confirmation bypass).
- Evidence gathering (CLI-sourced or user-provided; attached to postings with metadata).
- Idempotent skill-run replay (checkpoints, state persistence, resumable).
- Exception routing (validation/missing evidence/ambiguity/review-required/external-retryable/external-terminal/conflict/permission/internal).
- Gate enforcement: Skills cannot approve reconciliation, unlock periods, or override high-consequence gates (return error if not confirmed).
- Audit trail (every skill action logged: actor, source, timestamp, outcome).

**Tests**: Manifest validates; command invocation works; skill run state resumable; exceptions routed correctly; gate enforcement prevents skill auto-approval; audit complete.

**Exit Gate**: Skill runtime complete. Skills invoke CLI deterministically; cannot bypass gates or evidence requirements.

**Non-Goals**: Direct external APIs, secret storage/transmission, autonomous decision-making, web servers.

---

## Phase 9: Zoho Migration (Final; Exact Fixture Checksum, Quarantine Unsupported Rows)

**Duration**: 4–6 weeks. Deliverables: fixture-based import with exact checksum/row counts, duplicate-header ordinal preservation, per-file fingerprints, per-cell provenance, unsupported-row quarantine, idempotent/resumable reconciliation.

**Prerequisites**: Phase 1–8B complete.

**Scope**:
- **Fixture specification** (from [zoho-backup-fixture.md](zoho-backup-fixture.md)): 44 CSV files, 966 total data rows, SHA-256 `fda43a99d165dec5766953484cf1377c789ae4eb50abfa3636657d2fc36ce296`, uncompressed 279,924 bytes.
- **Archive safety**: Verify no path traversal, symlinks, duplicate paths; staging atomicity; rollback on validation failure.
- **Source checksum verification**: Fail fast on SHA-256 mismatch.
- **Duplicate-header ordinal preservation**: Three files (Credit_Note.csv, Customer_Payment.csv, Deposit.csv) contain duplicate column headers; must preserve ordinal positions (never collapse into single key); disambiguate programmatically.
- **Schema fingerprints per file**: Record ordered column-header list (including duplicates) for each CSV; compare against expected on future imports.
- **Raw provenance per cell/row**: Maintain audit trail of source file, row number, column ordinal for every cell value.
- **Deterministic dependency ordering**: Load files in order respecting FK dependencies (e.g., Invoice → InvoiceLineItem).
- **Referential validation post-import**: Check FK relationships; report unmatched references by file, row, column.
- **Unsupported rows quarantine**: Inventory, RBAC, identity, custom fields explicitly quarantined with raw provenance and counted; never claim all rows mapped.
- **Reconciliation**: GL balance, AR/AP aging, cash balance, row counts comparison to Zoho.
- **Idempotent/resumable**: Track checkpoints; re-import same fixture produces same result; partial imports resumable by source-record ID.

**Tests**: Fixture SHA-256 matches; 44 files + 966 rows verified; duplicate-header ordinals preserved; per-file fingerprints match; raw provenance complete; all imported rows reconcile; unsupported rows counted and logged; idempotency (re-import produces same result); cross-dialect reconciliation.

**Exit Gate**: Migration complete. All supported rows imported with complete provenance; unsupported rows explicitly quarantined and counted; GL balances match Zoho; duplicate-header ambiguity resolved. Inventory engine and RBAC remain deferred.

**Non-Goals**: Ongoing sync with Zoho, inventory/manufacturing, unsupported features, Zoho API enrichment.

---

## Cross-Cutting Acceptance Criteria (All Phases)

- **Deterministic behavior**: Same request ID always produces same result (idempotency tests for every command).
- **Tenant/GSTIN isolation**: No cross-tenant leaks; ambiguity fails explicitly.
- **Immutability and audit**: Posted documents immutable except via reversal; every mutation logged.
- **Silent-failure prevention**: Debit-credit imbalance, duplicate retries, number reuse, stale rules, ambiguity all detected and blocked (see [Architecture §2](../architecture.md#silent-failures-to-prevent-most-damaging-first)).
- **Compliance gates**: Missing/stale rules BLOCK only affected action; OPEN rules visible; unrelated work proceeds.
- **Evidence linking**: Material decisions have supporting evidence (content-addressed, immutable).
- **Cash/accrual awareness**: Reports respect basis parameter; output shows effective basis; fixed-basis reports reject inapplicable basis.
- **Multi-dialect conformance**: Same operation produces normalized-equivalent result on SQLite/PostgreSQL/MySQL.
- **Exit-code taxonomy**: 0=successful computation, 1=validation, 2=ambiguity, 3=conflict, 4=compliance-gate, 5=external-retryable, 6=external-terminal, 7=permission, 8=internal. Partial or failed acquisition has a distinct nonzero shell result; its numeric value is internal/TBD until implementation and must be visible to the shell once implemented.
- **No hardcoded rules**: All tax/compliance rules declared in effective-dated rule packs (not code-embedded); fail closed if missing/stale.
- **Skill boundaries**: Skills invoke CLI only; cannot bypass gates or evidence requirements.
- **No autonomous decisions**: Agents orchestrate skills; rules and gates from deterministic engine, not agent logic.

---

## CLI-008 Acceptance Scenarios: Company Health Status (Owner-Approved Contract)

`agent-bahi status` is a read-only deterministic snapshot command that produces
immutable company health observations. The canonical schema is
[CLI-008](accounting-contracts.md#cli-008); these scenarios use its exact
`health`, `completeness`, per-section `outcome`, and evidence-reference fields.
The owner approval is for the contract only and does not authorize
implementation, Gate0/phase work, or PT-014 behavior. The following scenarios
are mandatory acceptance tests for implementation:

**Tenant Selection and Context**:

1. **Single active tenant, no `--tenant` flag**: Command auto-selects tenant; snapshot includes `tenant_id` and succeeds.
2. **Multiple active tenants, no `--tenant` flag**: Command returns `TENANT_AMBIGUOUS` exit code 2; no snapshot generated.
3. **Explicit `--tenant <name>` with single tenant**: Succeeds; snapshot confirms selected tenant.
4. **Explicit `--tenant` with wrong name**: Returns `TENANT_NOT_FOUND` error; no snapshot.

**Snapshot Immutability and Determinism**:

5. **Identical query run twice at same point in time**: Both snapshots have identical `snapshot_id`, `as_of_date`, `content_hash`.
6. **Query run at different times**: New snapshots have distinct `snapshot_id` and `as_of_date`; `content_hash` differs.
7. **Human and `--json` output from same snapshot**: Identical facts (amounts, dates, counts, drill-down commands); formatting only differs.
8. **Drill-down commands in human and JSON output**: Both use array format `["agent-bahi", "command", "arg1"]` (never shell strings, secrets, or environment variables).

**Health States and Severity Ordering**:

9. **`HEALTHY` state**: All obligations current, no blocks, no overdue items; snapshot succeeds with `health: "HEALTHY"` and `completeness: "COMPLETE"`.
10. **`ACTION_REQUIRED` state**: Upcoming obligation or non-blocking exception within N days (N from tenant config); `health: "ACTION_REQUIRED"` and complete computation exits 0.
11. **`BLOCKED` state**: Overdue obligation, missing approval, or period lock blocking mutations; `health: "BLOCKED"` and complete computation exits 0.
12. **Overdue compliance obligation ranked first**: GSTR-3B due 2026-07-15, invoice aging due 2026-08-20; compliance section lists GSTR-3B first with `severity: "BLOCKED"`.

**Section Completeness and Partial Snapshots**:

13. **All required sections present**: command-failures, blocks-and-partials, unreconciled-bank, overdue-invoices, unpaid-bills, evidence-pending, compliance-obligations, other-exceptions.
14. **Section with zero items**: Count is 0, section `outcome: "COMPLETE"`, section `health: "HEALTHY"`, and no items array (or an empty array).
15. **Section with incomplete data** (e.g., missing rule pack for GSTR deadline): Section `outcome: "DATA_UNAVAILABLE"`, item carries an `UNKNOWN`/`INCOMPLETE` reason and evidence references, snapshot `completeness: "PARTIAL"`, and health is not conclusive.
16. **Unknown applicability or deadline** (e.g., e-invoice AATO threshold uncertain): Section `outcome: "APPLICABILITY_UNKNOWN"`, item shows `due_date: null`, an `UNKNOWN`/`INCOMPLETE` reason, and evidence references; it never assumes healthy.

**Bank Reconciliation and Aging**:

17. **Unreconciled bank lines**: Section includes count, total amount by currency, earliest date, drill-down command to `reconciliation show --status unmatched`.
18. **Bank reconciliation skill proposes 10 matches; user confirms 3**: Snapshot shows 7 unreconciled (confirmed state only, not proposed candidates).
19. **Overdue invoice aging**: AR section includes count of overdue invoices, total due amount, earliest due date, drill-down to `invoice show --status posted --aging overdue`.

**Compliance and Statutory Deadlines**:

20. **GSTR-1 filing deadline passed**: Section shows `status: "overdue"`, `due_date: "2026-07-15"` (FY 2026-07), `severity: "BLOCKED"`, drill-down to `gst filing show --gstin <gstin>`.
21. **TDS payment due 7-Aug; snapshot as-of 2026-08-10**: Shows `status: "overdue"`, drill-down to `payroll payment show --type tds --period-start 2026-04-01`.
22. **Payroll remittance deadline in future (30 days)**: Shows `status: "due"`, `severity: "ACTION_REQUIRED"`, not `"BLOCKED"`.

**Partial Completions and Blocks**:

23. **Bank import in progress (batch partially committed)**: blocks section shows operation, item count, status, and drill-down to resume/retry.
24. **Period locked through 2026-08-15**: blocks section shows lock status, locked-through date, unlock drill-down command.
25. **Reconciliation confirmation required**: Evidence section shows count of pending confirmations, severity `ACTION_REQUIRED`, drill-down to list/confirm pending.

**Output Modes and Determinism**:

26. **Human output**: Readable summary with `health`, `completeness`, section headings, counts, material amounts, earliest dates, evidence IDs/hashes, and brief drill-down hints (not full command arrays).
27. **`--json` output**: Valid JSON; parseable without shell escaping; all fields present (snapshot metadata and sources, tenant_id, health, completeness, sections with outcomes and items/evidence references).
28. **Stdout contains snapshot only**: Stderr contains progress/warnings.
29. **Exit code 0 for complete success**: Even if `health: "BLOCKED"` (snapshot computed successfully; company health is separate from command success).
30. **Exit code with partial or failed snapshot**: Distinct nonzero shell result when section acquisition is partial or failed; snapshot `completeness` is `PARTIAL` or `FAILED`, per-section outcomes are structured, and the numeric value is not hidden from the shell once implemented.

**Queries and Drill-Down Navigation**:

31. **Drill-down command from GSTR-3B obligation**: `agent-bahi gst filing show --gstin <gstin>` is valid and returns filing details.
32. **Drill-down command from unreconciled bank**: `agent-bahi reconciliation show --status unmatched` returns unmatched statement lines.
33. **Drill-down command from overdue AP aging**: `agent-bahi bill show --status posted --aging overdue` returns bill records.
34. **All drill-down commands use valid command registry**: No invented commands, no shell syntax, no environment variable substitution.

**Failure Modes and Edge Cases**:

35. **Database corruption or lock timeout**: Snapshot returns partial or failed result with the affected section marked `DATA_UNAVAILABLE` or `FAILED`, structured evidence references, and no conclusive `health: "HEALTHY"` result.
36. **Multiple simultaneous `status` queries**: Both succeed; both may return snapshots with identical `as_of_date` if taken in same logical transaction time; no blocking or timeout.
37. **Query with future `--as-of` date**: Returns snapshot as if queried at that future date (deterministic from stored data at that point, not predictive).
38. **Empty tenant** (no invoices, bills, obligations): Complete snapshot returns `health: "HEALTHY"`, `completeness: "COMPLETE"`, and zero counts in all sections (not absent sections).
39. **Compliance obligation with research-gated threshold** (e.g., e-invoice applicability unknown): Section outcome is `APPLICABILITY_UNKNOWN`; item shows `applicability: "OPEN_RESEARCH"`, `status: null`, an `UNKNOWN`/`INCOMPLETE` reason, and evidence references.
40. **Evidence traceability**: Snapshot/source metadata, every section, every item, and every summary card carries `source_id`, `evidence_id`, and an immutable hash/equivalent reference sufficient to trace health and unknown claims.

**Read-Only Guarantee**:

41. **`status` command never triggers mutation**: No posting, no reconciliation match, no filing, no bank import, no approval gate.
42. **`status` command idempotent**: Calling twice returns identical snapshots (same `snapshot_id`, `as_of_date`, `content_hash`).
43. **Snapshot as-of date does not advance**: Multiple calls at the same timestamp return same snapshot; advancing timestamp to a later point generates a new snapshot.

---

## Deferred Work (Preserved Extensibility)

- **Inventory**: No stock/warehouse/COGS/batches/serials/manufacturing. Document lines retain structure for future integration.
- **RBAC**: Authorization hooks present and no-op for V1. Actor/source/permission context threaded throughout; audit ready for RBAC.
- **Direct auto-filing**: Each filing requires separate research and owner-approved decision (except GSTR-1 manual portal boundary). T-009 blocks assumption.
- **Employee portal**: No self-service. Payslips and outputs generated for external delivery.
- **Attendance/HRMS**: No system of record for employee time. Payroll accepts approved summarized inputs only.
- **Intercompany posting**: No cross-tenant atomic transactions. Mistaken payments represented separately in each tenant.
- **Composition scheme**: CMP-08 and GSTR-4 out of scope.

---

**Phase Sequence**: Gate0 (proof spikes) → P1 (foundation) → P2 (skill contracts) → P3 (ledger) → P4 (evidence/bank) → P5 (reports/FX/assets/expenses) → P6 (payroll) → P7 (compliance) → P8A (dialects) → P8B (skills runtime) → P9 (Zoho).

**Sign-Off Gate**: After docket review, Sudhanshu explicitly directs the reversible Gate0 proof spikes. Gate0 records mandatory runtime, package, dialect, migration, and target-platform evidence; it does not authorize Phase 1 or approve libraries. Phase 1 begins only after that evidence, a reviewed physical-schema RFC, approval of applicable Phase 1 decisions, and separate Phase 1 authorization. Later-phase tentative IDs remain scoped to their affected phase/action; a later blocker requires a new owner decision.
