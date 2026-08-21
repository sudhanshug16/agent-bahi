# Discovery Roadmap

The current focus is the native core and its first automation baseline: building agent-bahi as a self-contained accounting system without external dependencies or importers in the active phase. Every tenant remains independent; cross-tenant/intercompany paired posting is **DEFERRED and PROHIBITED in V1**. Mistaken inter-entity payments are represented separately in each tenant with explicit due-to/due-from or correction journals only when the user records them.

## Cross-cutting discovery milestone: verified GST baseline (2026-08-20)

The [GST Compliance Matrix — Verified Research Baseline](gst-compliance-matrix.md)
records the researched regular-taxpayer GST baseline, the GSTR-1-specific
output boundary, effective-dated model requirements, silent failure gates, and
open research. This documentation milestone does not approve implementation or
submission transport.

Explicit follow-ups before GST implementation decisions:

- research the composition taxpayer path (CMP-08, GSTR-4, and related rules);
- confirm whether a stable official GSTR-3B artifact comparable to GSTR-1
  exists;
- confirm the FY 2025-26 GSTR-9 exemption notification;
- decide e-invoice transport (direct IRP API versus export/upload/import-
  response); and
- decide e-way-bill transport and research effective-dated state rules and
  exceptions.

## Cross-cutting discovery milestone: verified statutory compliance baseline (2026-08-21)

The [Statutory Workflow Contracts](statutory-workflow-contracts.md) document
defines obligation scope, due-event calculation, validation gates, human/professional review requirements, and portal-filing boundaries for TDS/TCS, annual income-tax returns, and company statutory compliance. Linked verified research baselines include:

- [TDS/TCS Compliance Matrix](tds-tcs-compliance-matrix.md) — Tax Deducted at Source and Tax Collected at Source under Income-tax Act 2025/Rules 2026 (effective 1 April 2026). Rates and thresholds derive from s393/s394 and effective rule snapshots; Forms 141/140 are routing outputs, not rate sources.
- [Annual Income-Tax Compliance Matrix](annual-income-tax-compliance-matrix.md) — Annual return filing, separate tax computation, Form 26 as the s63 audit report only, audit applicability (section 63), and advance-tax obligations under current law. Marks unresolved form selection and computation inputs as OPEN.
- [MCA Companies Act Compliance Matrix](mca-companies-act-compliance-matrix.md) — Current Companies Act statutory compliance under official MCA sources: mandatory audit for every company, corrected auditor/OPC/AGM/signature paths, conditional forms, historical-form preservation, and explicit `source_verified`/`effective_rule_snapshot` gates. OPEN+BLOCK items remain visible; current DPT-3 is deposits/money-not-treated-as-deposits, not director/KMP data.

This documentation milestone does not approve implementation, portal submission, or compliance decision automation; it establishes verified baselines and marks all unverified items OPEN.

All statutory-compliance-decision phases (form selection, tax computation,
posting, deadline generation, compliance filing, advance-tax action, Form 26
audit report, tax-depreciation posting) have a hard predecessor:
`source_verified=true` and a non-stale `effective_rule_snapshot` with
official source, version, effective date, jurisdiction, and applicability
facts. Missing/stale snapshots or **OPEN**/**TENTATIVE** rules for a specific
tax/filing return **REVIEW/BLOCK** for that affected obligation only—form
selection, tax computation/posting, deadline generation, compliance export,
filing, or related statutory outputs.

**Unrelated core bookkeeping, draft entry, validated reconciliation, and
already-researched statutory slices may proceed.** Legal research gates block
only the affected compliance action/filing/obligation, not entire modules. For
example: TDS thresholds may be OPEN while regular GST and GSTR-1 are settled;
a missing advanced-tax rule does not block GSTR-1 export for already-researched
GST items.

Explicit follow-ups before statutory-compliance implementation decisions:

- verify TDS/TCS rates and thresholds from the official s393/s394 sources and effective rule snapshots; use Form 140/Form 141 only for statement routing;
- verify annual-return form code and structure from official Notification 22 and Form Navigator;
- verify company classification and profile-driven MCA applicability from the cited Act/rules/orders; never infer a small-company or OPC audit exemption;
- research payroll-owned Form 130/Form 138 details, including their s393(1) Table 8(iii) specified-senior-citizen use, and keep general non-payroll Forms 131/132/140/141/143/144 separate;
- verify current form/instruction-kit snapshots (AOC-4, AOC-4 CFS, MGT-7, ADT-1, DPT-3, MSME-1) and gate implementation on `source_verified=true` plus an effective rule snapshot.

## Phase 1 Gate: Review and Approval

Before Phase 1 implementation begins:

1. [Pre-Implementation Architecture](../architecture.md) document exists, combining SETTLED constraints and RECOMMENDED defaults.
2. Sudhanshu reviews [Provisional Architecture Decisions](architecture-decisions.md) and [Pre-Implementation Architecture](../architecture.md), confirming, adjusting, or overriding each RECOMMENDED entry.
3. Architecture document passes contradiction review (no statements in conflict with discovery docs or each other).
4. Required proof spikes validate all provisional technology stack choices (STK-001 through STK-006):
   - **Bun runtime and workspaces** (STK-001): Pin exact Bun version; verify `bun install`, workspaces, and lockfile on target platforms (macOS arm64, Linux x64/arm64).
   - **Multi-dialect ORM spike** (STK-002): Test Drizzle (primary) and Kysely (fallback) on bun-sqlite, Bun SQL PostgreSQL, and MySQL; verify schema definition, query generation, and type inference on all three dialects.
   - **SQLite configuration** (STK-003): Verify foreign_keys=ON, WAL mode, SQLITE_BUSY handling, and transaction isolation on target filesystem.
   - **Migration and test execution** (STK-004): Run fresh-install migrations on all three dialects; test every supported upgrade path; verify schema consistency across dialects.
   - **Zod and schema generation** (STK-005): Verify Zod runtime validation, JSON schema generation for CLI commands, and compatibility with Clipanion/skill definitions.
   - **Clipanion CLI adapter** (STK-005): Verify Clipanion command registry can be generated from domain-owned declarations; test parser bindings and help output.
   - **Decimal math** (STK-005): Verify decimal.js precision, rounding rules for INR calculations (paise), currency conversion, and tax calculation; test against golden examples.
   - **Build and distribution** (STK-006): Test ESM TypeScript build on all target platforms; verify compiled output and package/bin fallback; confirm database drivers (MySQL, PostgreSQL optional) work on all platforms.

**This gate must be passed before any Phase 1 implementation code is written.**

## Phase 1: Canonical Data Model and CLI Safety Foundation

**Goal**: Establish the authoritative schema, rules, and explicit safe command surface that all phases depend on.

**Scope**:
- Chart of accounts with account types, hierarchies, and India GL standards
- Tenant-scoped entity and account boundaries with no tenant relationship or intercompany model
- Document types (Invoice, Bill, Payment, Journal Entry, etc.)
- Ledger posting mechanics and invariant constraints
- Explicit CLI commands with deterministic validation and engine-owned permission/gate checks
- Optional tenant-defined reporting dimensions (tags) attached at transaction or line level; allocations use explicit split document lines with one tag per split line and totals that reconcile to the source amount; tags are orthogonal to accounting and do not affect posting, balance, tax, or compliance
- Implement against the [Accounting Contracts](accounting-contracts.md) as the canonical pre-implementation domain contract; unresolved owner choices remain gated there.

**Exit Conditions**:
- Core tables defined with primary/foreign key relationships
- Invariants codified and enforced (debit = credit, account balances, document state validity)
- CLI operations are explicit, deterministic, and reject invalid changes before state mutation
- Schema passes integration tests across all document workflows

## Phase 2: Skill Contracts and Manifests

**Goal**: Define and version the skill contract and initial job-skill catalog without implementing skills or embedding accounting rules.

**Scope**:
- Define versioned skill contract in `skill-architecture.md`: purpose, compatible engine/rule versions, required commands, inputs, evidence, deterministic gates, permitted external calls, approval policy, exception routes, verification, and outputs
- Establish the initial job-skill catalog as contract declarations only (no skill implementation code)
- Specify skill prerequisites, command boundaries, validation rules, and exception routes
- Document how skills observe, validate, and report outcomes through evidence and audit metadata
- Design skill versioning, compatibility ranges, and deprecation policies
- Define the relationship between skills and the deterministic rules engine (skills orchestrate, engine enforces rules)

**Exit Conditions**:
- The initial skill catalog is fully specified by versioned contracts with prerequisites, command boundaries, validation, and exception routes
- Skill-contract schema is defined and validated against the initial catalog
- Engine CLI commands referenced by skills are stable and can support orchestration
- Skill versioning and compatibility policy is documented
- Documentation provides clear guidance for future skill implementation and review

## Phase 3: Deterministic Lifecycle and Posting Engine

**Goal**: Implement the document state machine, deterministic posting pipeline, and agent safety boundaries for all document types.

**Scope**:
- Implement document state machine: Draft → Validated → Posted → Settled, where partial/open is derived while Posted and Settled requires zero signed open balance after allocation plus an approved balanced credit/write-off/refund journal
- Posting pipeline with audit trail, deterministic numbering, and immutable postings
- Reversal and correction patterns with full lineage (original, reversal, replacement, reason)
- Agent safety gates: permission checks, edit boundaries, and automation policy enforcement at each state
- Implement high-consequence commit gates (prepare/preview → validate → commit with plan hashing)
- Reconciliation of posted entries to external evidence and source documents; proposals are non-posting and persistence requires recorded human confirmation bound to the exact plan digest, source line, target, amounts, FX snapshot, versions, tenant, actor, and timestamp

**Exit Conditions**:
- Documents transition deterministically through all states with locked history
- Reversals and corrections produce clean immutable audit trails
- All agent operations validated against permission gates and automation policy
- Posted entries are never mutable except through reversal/replacement lineage
- Reconciliation links postings to evidence and source documents
- Bank reconciliation, period close, and payroll finalization use explicit prepare/commit gates. Reconciliation proposals remain non-posting; persistence requires recorded human confirmation bound to the exact plan digest, source line, target, amounts, FX snapshot, versions, tenant, actor, and timestamp. Agents/skills/workflows cannot approve reconciliation.

## Phase 4: Daily Workflows, Executable Skills, and Zoho Parity

**Goal**: Build executable skills and CLI workflows for routine daily accounting operations, achieving Zoho Books automation parity as the minimum baseline.

**Scope**:
- Implement initial job-skills from Phase 2 contracts (invoice creation, bill recording, payment matching, expense categorization, journal entries)
- Use the [Accounting Contracts](accounting-contracts.md) for the shared `Draft -> Validated -> Posted -> Settled` lifecycle, immutable correction lineage, account-role templates, and explicit allocation/reconciliation boundaries.
- Invoice and bill creation with validation, aging tracking, and automated tax treatment
- Payment matching and clearing with cash-first atomic payment posting, exact paid-currency FX formulas, and exchange-gain/loss calculation
- Expense recording and categorization, including native evidence, employee claims, advances, reimbursements, and corporate-card workflows
- Manual journal entry creation with validation and audit trail
- Skills orchestrate engine commands, validate results, and return evidence/audit metadata
- Automated tests verify Zoho Books parity: same day's transactions produce equivalent ledger state

**Exit Conditions**:
- Initial skill catalog is fully implemented and tested against Phase 2 contracts
- User can book a typical day's transactions end-to-end via CLI or skills
- All daily workflows produce deterministic ledger entries and audit trails
- Zoho Books automation parity is achieved as the minimum initial automation baseline
- Skill failures are routed to explicit exceptions, not silently applied
- No Zoho Books reference needed for daily bookkeeping; agent-bahi is self-contained and deterministic

## Phase 5: Payroll and Employee Compliance

**Goal**: Implement full India payroll as a deterministic, first-class workstream after the core ledger foundations.

**Scope**:
- Employee statutory profiles, salary structures/components/formulas, and effective-dated rules
- Pay schedules, payroll periods, and approved summarized payroll inputs such as payable days, LOP days, and overtime amounts/hours; no attendance, leave, shift, HRMS, or attendance-import domain
- Regular, bonus, arrears, correction, and off-cycle runs with draft, approval, posting, and locking
- Reimbursements, perquisites, loans, advances, payslips, wage/overtime/deduction reports, and requested employee outputs for secure external delivery; no employee self-service portal
- Payroll TDS under s392, declarations/proofs, Form 16/Form 130, and payroll-owned Form 138 quarterly statements (also used for s393(1) Table 8(iii)), PF, ESI, PT, LWF, and statutory filing/remittance references; general non-payroll Forms 131/132/140/141/143/144 remain in the statutory TDS contract
- Deterministic bank-import CSV export using versioned bank presets; no bank transfer initiation or auto-pay
- Full-and-final settlement and auditable reversal/correction lineage

**Exit Conditions**:
- Pay runs are balanced and reproducible from frozen inputs and effective-dated jurisdiction rules
- Every payroll output, payable, remittance, filing, and bank export artifact has an auditable source link
- Bank export, upload, bank acceptance, debit, and reconciliation are distinct states; only export is in scope, and a generated file is not proof of payment
- Unresolved statutory ambiguity blocks or routes to explicit review; no skill invents amounts or silently posts

## Phase 6: Bank Reconciliation, Close, and Financial Reporting

**Goal**: Enable month/quarter/year-end close and basic financial statements.

**Scope**:
- Bank statement import and reconciliation, including evidence of actual salary payment after export
- Period close procedures and freeze
- Trial balance, P&L, and balance sheet generation
- Variance analysis and close checklists

**Exit Conditions**:
- Month-end close is repeatable and documented
- Reconciliation identifies uncleared items
- Financial reports match manual verification

## Phase 7: Effective-Dated India Compliance Calculations, Calendars, Review Gates, and Official-Format Exports

**Goal**: Implement India-specific compliance and statutory reporting with time-aware calculations.

**Scope**:
- Effective-dated calculations for tax, withholding, and filing compliance
- GST/TDS/TCS computation and reconciliation
- Compliance calendars and filing deadlines
- Filing-specific statutory output formats (GST, CMA, income tax, etc.)
- Filing-specific review and submission decisions; no global government-submission policy
- GST-specific predecessor gates, portal evidence, and effective-dated rule
  selection after the research follow-ups above are separately settled

**Exit Conditions**:
- Statutory reports match compliance software output
- Effective-dated rules handle retroactive adjustments
- Filing outputs can be generated and validated; submission is not implied until its filing-specific decision is explicitly settled

## Phase 8: Database Adapters and Tenant Isolation

**Goal**: Support pluggable storage backends while preserving independent tenant operation.

**Scope**:
- PostgreSQL and MySQL adapters (SQLite remains default)
- Tenant-scoped data isolation and audit trails
- Explicit single-tenant command validation across adapters

**Exit Conditions**:
- Each tenant operates independently with correct isolation
- Database adapter tests pass on all supported backends

## Phase 9: Zoho Books Import—Validated Against the Already Documented Private Fixture

**Goal**: Safely migrate historical data from Zoho Books as a final step.

**Scope**:
- Archive validation, checksums, and integrity checks
- CSV parsing with duplicate column handling
- Foreign key ordering and referential validation
- Idempotent upserts and resumability
- Detailed reconciliation and audit reports

**Exit Conditions**:
- All 966 rows from the fixture archive import cleanly
- Reconciliation report confirms no data loss
- Post-import balances match source
- System operates normally with imported data

**Note**: No importer implementation is in the current phase. The native core and skills layer (Phases 1–8) must be complete and tested before any Zoho Books data is loaded. Import validation requirements are pre-specified in `zoho-backup-fixture.md` and will not be modified during development.

## Deferred / Future

### Inventory Accounting (Deferred)

No inventory accounting in v1; products/services and document lines may carry description, quantity, unit, rate, tax treatment, and configured ledger account, but the system will not implement stock movements, warehouses, stock valuation, automated COGS, batches, serial numbers, or manufacturing.

Future inventory support should be enabled by stable item/document-line references and modular extension boundaries, not by speculative placeholder inventory tables now.
