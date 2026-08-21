# Implementation Plan: Gate0 through Phase 9

**Status**: Specification-level sequencing document. Does not authorize implementation. All tentative decisions await owner review.

**Canonical References**: [Architecture](../architecture.md) | [Accounting Contracts](accounting-contracts.md) | [Data Model Requirements](data-model-requirements.md) | [Statutory Workflow Contracts](statutory-workflow-contracts.md) | [GST Matrix](gst-compliance-matrix.md) | [TDS/TCS Matrix](tds-tcs-compliance-matrix.md) | [Income-Tax Matrix](annual-income-tax-compliance-matrix.md) | [MCA Matrix](mca-companies-act-compliance-matrix.md) | [Tentative Decisions](tentative-decisions.md) | [Skill Architecture](skill-architecture.md)

---

## Tentative Decisions (All NOT OWNER-APPROVED; Gate Phase 1 on Owner Confirmation)

- **T-001**: External statutory submissions fallback (prepare/validate/export + manual portal for filings without approved boundary). See [Tentative Decisions](tentative-decisions.md#entry-t-001).
- **T-002**: Frappe Books as reference only (no code reuse; license decision deferred). See [Tentative Decisions](tentative-decisions.md#entry-t-002).
- **T-003**: Fixed-asset depreciation method default (SLM; reversible; not implementation authorization). See [Tentative Decisions](tentative-decisions.md#entry-t-003).
- **T-004**: ORM selection (Drizzle primary, Kysely fallback; gates proof spike STK-002).
- **T-005**: CLI parser selection (Clipanion primary; gates proof spike STK-005).
- **T-006**: Numeric approval thresholds DEFERRED; tests must not assume specific values.
- **T-007**: Effective-dated rule-pack manifest structure and immutability.
- **T-008**: Skill allowlist-based loading and version compatibility enforcement.
- **T-009**: Statutory export and filing transport boundaries per-filing decision (no global auto-submit assumption).
- **T-010**: Multi-dialect schema conformance strategy (logical-ID matching, not binary equality).

---

## Gate0: Proof Spikes (Hard Blocker Before Phase 1)

**Duration**: 2–3 weeks. All must pass before Phase 1 implementation begins.

- **STK-001**: Bun runtime, workspaces, lockfile on target platforms (macOS arm64, Linux x64/arm64).
- **STK-002**: ORM spike (Drizzle/Kysely) on bun-sqlite, PostgreSQL, MySQL; schema equivalence verified.
- **STK-003**: SQLite pragmas, WAL, foreign_keys=ON, SQLITE_BUSY handling, network-filesystem rejection.
- **STK-004**: Schema migrations and upgrade paths on all three dialects.
- **STK-005**: Zod validation, JSON schema generation, Clipanion parser, decimal.js precision (INR/paise, FX, tax).
- **STK-006**: ESM build, platform binaries, database drivers (MySQL/PostgreSQL optional).

**Exit**: All spike reports complete; owner confirms technology choices (or overrides with new decision). Architecture reviewed and confirmed by owner.

---

## Phase 1: Foundation, Tenant Model, and Migrations

**Duration**: 4–6 weeks. Deliverables: schema (core tables), tenant/GSTIN isolation, command registry, idempotency.

**Prerequisites**: Gate0 proof spikes pass; owner approves architecture.

**Scope**:
- Tenant and GSTIN context (auto-select, explicit fail on ambiguity).
- Core aggregates: Account, Document, Posting, Contact, Currency, Evidence, Audit.
- Document state machine skeleton (Draft → Posted); reversal lineage hooks.
- Ledger invariants (debit=credit after rounding in base currency; original currency stored separately).
- Idempotency record schema (request ID deduplication).
- CLI command registry (domain-owned; not ORM-generated).
- Schema migrations (separate for SQLite, PostgreSQL, MySQL; logical IDs + checksums).
- Production migrations explicit/reviewed; local/dev may auto-initialize; mismatch fails closed.

**Tests**: Unit tests per aggregate; schema migration tests (fresh install + all upgrade paths on all dialects); idempotency replay.

**Exit Gate**: Schema stable; tenant/GSTIN isolation enforced; command registry working; migrations pass all three dialects. No posting/accounting logic yet (deferred to Phase 3).

**Non-Goals**: Tax calculations, postings, payroll, bank import, compliance, skills.

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

**Duration**: 6–8 weeks. Deliverables: document state machine, deterministic posting pipeline, reversal/correction lineage, high-consequence approval gates.

**Prerequisites**: Phase 1, Phase 2 complete.

**Scope**:
- Document state machine (Draft → Validated → Posted → Settled; immutability enforcement).
- Posting pipeline: validate structure → apply effective-dated rule snapshot → compute derived amounts → generate balanced journal → atomic write (postings + audit + idempotency).
- Base-currency debit=credit balance enforced after rounding; original-currency amounts and rate snapshots preserved.
- Reversals and corrections: immutable lineage with audit binding.
- High-consequence gates (prepare/preview → validate → commit with plan hashing) for period lock, payroll finalization, filing snapshot, reconciliation.
- Reconciliation proposals: ephemeral non-persistent until explicit human confirmation (plan hash binding required); persist provenance only with confirmed match.
- Supplier payment posting: Dr unapplied-supplier-payments / Cr Bank/Cash exactly once; allocation leg clears control against AP.
- External operation outbox: durable state tracking (prepared → submitted → known_success/known_failure/unknown → evidence_recorded → business_finalized).
- Authorization hooks (no-op in V1; framework in place).

**Tests**: State transitions; posting balance; reversal lineage; idempotency; gate enforcement (reconciliation blocks without human confirmation); external-operation replay safety.

**Exit Gate**: Document lifecycle complete; posting engine working; reconciliation gated on human confirmation; external operations safe; no tax logic yet.

**Non-Goals**: Tax, payroll, bank import, compliance, skills, asset depreciation.

---

## Phase 4: Evidence, Bank Reconciliation, Ephemeral Proposals

**Duration**: 4–6 weeks. Deliverables: bank statement import, ephemeral match proposals, evidence linking, non-posting reconciliation persistence gates.

**Prerequisites**: Phase 1–3 complete.

**Scope**:
- Bank statement import (date, amount, reference, description).
- Ephemeral match proposals (non-posting candidates; zero side effects).
- Explicit human confirmation binding (plan hash, source line, target, amount, FX snapshot, versions, tenant, actor, timestamp).
- Reconciliation persistence: only after confirmed; provenance linked to confirmed match.
- Evidence content-addressed (checksum verification, immutable storage).
- Bank reconciliation report (matched, unmatched items, period status).

**Tests**: Proposals non-posting; human confirmation required; reconciled postings linked to statement lines; evidence hashes correct; idempotency.

**Exit Gate**: Bank import and reconciliation working; evidence linking complete. Proposals remain ephemeral until confirmed; no skill auto-approval.

**Non-Goals**: Bank statement automation/import format standards, FX calculation (deferred to Phase 5).

---

## Phase 5: Reporting, FX, Assets, Employee Expenses

**Duration**: 8–10 weeks. Deliverables: P&L/BS/aging reports, realized AND unrealized FX with explicit period-end revaluation, asset register, employee-expense workflows.

**Prerequisites**: Phase 1–4 complete.

**Scope**:
- Reporting (P&L, balance sheet, aging) with cash/accrual basis parameter.
- Trial balance (no basis parameter; rejects invalid basis).
- Realized FX: at settlement, from allocation posting.
- Unrealized FX: explicit period-end revaluation, reversal, separate accounts, one-time settlement reclassification.
- Cash/accrual tests: pro-rata settlement, unapplied-cash carry, refunds/credit notes, tax fail-closed, FX/bank-fee separation, accrual-only depreciation/revaluation.
- Fixed-asset register: uniqueness exactly on (tenant_id, source_document_id, source_line_id) across capitalization kinds; rejects duplicate attempts; immutable depreciation runs (reversion via new version, never overwrite).
- SLM parameterized; method/rate changes blocked until T-003 owner approval (REVIEW/BLOCK gate).
- Employee-expense workflows (claims, advances, reimbursements, corporate-card matching).

**Tests**: Report balance sheet identity (assets=liabilities+equity); P&L net flows to equity; FX separation (realized vs. unrealized); asset uniqueness; depreciation immutability; basis parameter enforcement.

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
- Approved summarized inputs only (payable days, LOP, overtime amounts); no attendance, leave, HRMS.
- Frozen bank CSV export (versioned preset, deterministic formatting).
- Bank-file state machine: Generated → Uploaded → Accepted/Rejected → Debited → Reconciled (distinct states, separate evidence).
- Only observed debit clears payroll payable once; export ≠ payment.
- Payroll payable locked while run is draft/unposted; unlock only via reversal pattern.

**Tests**: Salary structure gross/net correct; payables balanced; CSV export deterministic; debit observation required before payable clears; idempotency.

**Exit Gate**: Payroll posting complete; bank-file state machine working; exports frozen and verified. Payroll TDS under s392 (Form 130/Form 138) remains in payroll lane; non-payroll TDS/TCS (s393/s394) deferred to Phase 7.

**Non-Goals**: Attendance tracking, employee portal, payroll-specific statutory exports (deferred to Phase 7), composition scheme, SEZ.

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
- GST: Regular taxpayer baseline (AATO, GSTR-1 output JSON, amendments, ITC eligibility, effective-dated classification).
- Non-payroll TDS (s393): Deduction rates/thresholds, Form 140/141 routing outputs only (never invent forms).
- TCS (s394): Collection rates/thresholds.
- Income-tax: Annual return form structure (per official Notification), separate tax computation (not audit report Form 26).
- MCA: Mandatory audit applicability, form structure (per official sources; never infer exemptions).
- Obligation engine: Tenant/GSTIN facts → applicable obligations; filing deadlines from rule snapshots; predecessor gates explicit (no GSTR-3B before GSTR-1).
- All exports (GSTR-1, GSTR-3B, TDS, income-tax, MCA) prepare/validate/export + manual filing (no auto-submit without filing-specific owner approval per T-009).
- Compliance calendar and deadline tracking.

**Tests**: Tax calculation matches golden fixtures; OPEN rules block affected action only; form exports generate correctly; filing deadlines calculated; predecessor gates enforced.

**Exit Gate**: GST, TDS/TCS, income-tax, MCA compliance logic complete. Every action gated on rule snapshot; no silent rule changes; OPEN rules visible and blocking only affected actions.

**Non-Goals**: Auto-filing, GSP/portal APIs, composition scheme, e-invoice/e-way bill transport (deferred to filing-specific decisions), Form 24/25 (payroll TDS filing; deferred to Phase 6 payroll extension).

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
- Command invocation (subprocess execution of CLI only; no direct external APIs, secrets, or evidence/confirmation bypass).
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

**Duration**: 4–6 weeks. Deliverables: fixture-based import with exact checksum/row counts, duplicate-header preservation, unsupported-row quarantine, schema fingerprinting, idempotent/resumable reconciliation.

**Prerequisites**: Phase 1–8B complete.

**Scope**:
- Fixture (44 CSV files, 966 test rows): exact checksum and counts verified.
- Import: transformation to agent-bahi schema (accounts, invoices, bills, payments, expenses, journal entries, etc.).
- Unsupported rows (inventory, RBAC, identity, custom fields): explicitly quarantined with raw provenance and counted; never claim all rows mapped.
- Duplicate-header ordinal preservation (CSV column order preserved in raw records for audit).
- Archive safety: staging atomicity; rollback on validation failure.
- Raw provenance: Zoho source record ID, transformation decision, agent-bahi target record linked for every imported row.
- Schema fingerprints: Zoho schema hash vs. agent-bahi schema hash; mismatch noted.
- Referential validation (FK integrity check post-import).
- Idempotent/resumable: re-import same fixture produces same result; partial imports resumable by source-record ID.
- Reconciliation: GL balance, AR/AP aging, cash balance comparison to Zoho.

**Tests**: Fixture checksum matches; row counts verified; all imported rows reconcile; unsupported rows counted and logged; idempotency (re-import produces same result); cross-dialect reconciliation.

**Exit Gate**: Migration complete. All supported rows imported; unsupported rows explicitly quarantined and counted; GL balances match Zoho. Inventory engine and RBAC remain deferred.

**Non-Goals**: Ongoing sync with Zoho, inventory/manufacturing, unsupported features.

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
- **Exit-code taxonomy**: 0=success, 1=validation, 2=ambiguity, 3=conflict, 4=compliance-gate, 5=external-retryable, 6=external-terminal, 7=permission, 8=internal, TBD=partial-success.
- **No hardcoded rules**: All tax/compliance rules declared in effective-dated rule packs (not code-embedded); fail closed if missing/stale.
- **Skill boundaries**: Skills invoke CLI only; cannot bypass gates or evidence requirements.
- **No autonomous decisions**: Agents orchestrate skills; rules and gates from deterministic engine, not agent logic.

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

**Sign-Off Gate**: Proof spikes pass. Owner confirms architecture and all T-001..T-010. Only then does Phase 1 implementation begin.
