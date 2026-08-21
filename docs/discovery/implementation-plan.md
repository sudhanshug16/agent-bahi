# Implementation Plan: Gate0 through Phase 9

**Status**: Specification-level sequencing document. Does not authorize implementation. All tentative decisions await owner review.

**Canonical References**: [Architecture](../architecture.md) | [Accounting Contracts](accounting-contracts.md) | [Data Model Requirements](data-model-requirements.md) | [Statutory Workflow Contracts](statutory-workflow-contracts.md) | [GST Matrix](gst-compliance-matrix.md) | [TDS/TCS Matrix](tds-tcs-compliance-matrix.md) | [Income-Tax Matrix](annual-income-tax-compliance-matrix.md) | [MCA Matrix](mca-companies-act-compliance-matrix.md) | [Tentative Decisions](tentative-decisions.md) | [Skill Architecture](skill-architecture.md)

---

## Tentative Decisions (All NOT OWNER-APPROVED; Gate Phase 1 on Owner Confirmation)

See [Tentative Decisions](tentative-decisions.md) for full details. All entries below await owner review and confirmation.

- **T-001**: External filing boundary (prepare/validate/export + manual portal for filings without specific-approved transport boundary). See [Tentative Decisions](tentative-decisions.md#entry-t-001).
- **T-002**: Frappe Books reference and licensing boundary (behavior/concept reference only; Apache-2.0 recommended; no code reuse). See [Tentative Decisions](tentative-decisions.md#entry-t-002).
- **T-003**: Fixed-asset depreciation policy (separate book/tax schedules; SLM method parameterized and reversible; not implementation authorization).
- **T-004**: FX provider and fallback selection (provisional; gates Phase 5 spike).
- **T-005**: Regular-GST V1 profile baseline (AATO applicability, effective-dated rules, GSTR-1 output; composition scheme deferred).
- **T-006**: Batch partial-success numeric proposal (exit code for partially-committed multi-item operations; tests must not assume specific numeric value).
- **T-007**: Provenance-only operator-entered advance-tax estimate under s404/s408; no auto-projection, computed tax/liability, installment calculation, sufficiency validation, or payment advice. Any derived amount is REVIEW/BLOCK pending verified rules and full computation inputs.
- **T-008**: Retroactive depreciation correction policy (immutability and reversal pattern).
- **T-009**: Form140/141 statutory export research only (non-payroll TDS s393 routing forms; not s392 salary withholding and not Form143/TCS). Form140/141 export/transport remains blocked pending research.
- **T-010**: Post-filing correction and revised-return boundary (amended returns, form corrections after filing).

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

**Duration**: 4–6 weeks. Deliverables: conceptual aggregates (tenant/GSTIN context, command registry), migration infrastructure, isolation enforcement.

**Prerequisites**: Gate0 proof spikes pass; owner approves architecture.

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
- SLM parameterized; method/rate changes blocked until T-003 owner approval (REVIEW/BLOCK gate).
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

**Tests**: Salary structure gross/net correct; payables balanced; CSV export deterministic; debit observation required before payable clears; select Form 24Q versus Form 138 from the frozen effective snapshot; unknown, stale, or missing source blocks statement selection; idempotency.

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
- **GST**: Regular taxpayer baseline (AATO, GSTR-1 output JSON, amendments, ITC eligibility, effective-dated classification).
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
