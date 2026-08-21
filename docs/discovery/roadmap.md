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

---

## Canonical Implementation Plan

**The authoritative implementation sequence is defined in [Implementation Plan](implementation-plan.md)**. This roadmap aligns with that sequence and preserves discovery milestones and research gates. Phases are numbered Gate0, P1–P9 in the implementation plan for clarity.

---

## Gate0: Proof Spikes (Hard Blocker Before Phase 1)

Validates all provisional technology stack choices before implementation begins. See [Implementation Plan: Gate0](implementation-plan.md#gate0-proof-spikes-hard-blocker-before-phase-1).

**Six proof spikes** (STK-001 through STK-006): Bun runtime, ORM cross-dialect, SQLite configuration, migrations/upgrades, schema generation/CLI parsing, build/distribution.

**Gate criterion**: All spikes pass; owner confirms architecture and all [Tentative Decisions](tentative-decisions.md) T-001..T-010.

## Phase 1: Foundation, Tenant Model, and Migrations

**Goal**: Establish conceptual aggregates, tenant/GSTIN isolation, and command registry contracts. See [Implementation Plan: Phase 1](implementation-plan.md#phase-1-foundation-tenant-model-and-migrations).

**Key contract**: Tenant and GSTIN context (auto-select, explicit fail on ambiguity); ledger invariants (debit=credit after rounding); idempotency semantics; migration infrastructure.

**Exit conditions**: Tenant/GSTIN isolation enforced; command registry stable; migration strategy proven in proof spikes. Physical schema RFC required for implementation (does not imply approval).

## Phase 2: Skill Contracts and Catalog (Declarations Only)

**Goal**: Define versioned skill contract and initial 14-job catalog as contract declarations, no implementation code. See [Implementation Plan: Phase 2](implementation-plan.md#phase-2-skill-contracts-and-catalog-schema-declarations-only).

**Exit conditions**: Skill catalog complete; all skills declare only Phase 1 commands; forward references marked DEFERRED; no embedded accounting rules.

## Phase 3: Ledger, Documents, Posting Engine

**Goal**: Implement document state machine and deterministic posting pipeline. See [Implementation Plan: Phase 3](implementation-plan.md#phase-3-ledger-documents-posting-engine).

**Scope**: Draft → Validated → Posted → Settled; posting balance (debit=credit); reversals/corrections immutable lineage; atomic posting.

**Exit conditions**: Postings immutable and balanced; document lifecycle complete. **No approval gates, reconciliation proposals, external operations, or payroll logic** (deferred to P4/P6/P7).

## Phase 4: Evidence, Bank Reconciliation, High-Consequence Gates, External Operations

**Goal**: Bank statement import, ephemeral proposals, high-consequence approval gates (prepare/preview → validate → commit), external operation outbox. See [Implementation Plan: Phase 4](implementation-plan.md#phase-4-evidence-bank-reconciliation-high-consequence-gates-external-operations).

**Key contract**: Reconciliation proposals ephemeral and non-persistent until explicit human confirmation (plan-hash binding required). External operations durable and idempotent. Skills cannot approve high-consequence actions.

**Exit conditions**: Proposals ephemeral until confirmed; gates enforce human confirmation; external operations safe.

## Phase 5: Reporting, FX, Assets, Employee Expenses

**Goal**: P&L/BS/aging reports, realized AND unrealized FX, fixed-asset register, employee-expense workflows. See [Implementation Plan: Phase 5](implementation-plan.md#phase-5-reporting-fx-assets-employee-expenses).

**Key contract**: `--basis` parameter only for P&L. BS, TB, AR/AP aging reject `--basis` (ledger/as-of). FX: realized at settlement; unrealized period-end revaluation. Asset uniqueness exactly on (tenant_id, source_document_id, source_line_id). SLM parameterized; method changes blocked until T-003 approval.

**Exit conditions**: Reporting complete; FX separation verified; assets tracked; basis parameter enforcement correct.

## Phase 6: Payroll Accounting Only (Frozen Bank CSV Export)

**Goal**: Employee profiles, salary structures, pay runs, frozen bank-CSV export. See [Implementation Plan: Phase 6](implementation-plan.md#phase-6-payroll-accounting-only-frozen-bank-csv-export).

**Key contract**: Statutory computation gate: before any PF/ESI/PT/LWF/TDS computation, posting, payment, certificate, or export require `source_verified=true` + non-stale rule snapshot; REVIEW/BLOCK only affected action. Salary TDS under s392 (Form 130/Form 138) remains in payroll lane. Bank debit/reconciliation distinct states; only observed debit clears payable.

**Exit conditions**: Payroll posting complete; bank-file state machine working; statutory gate enforced.

## Phase 7: Independently Gated Compliance Slices (Per-Action Research Gates)

**Goal**: GST, non-payroll TDS/TCS (s393/s394), income-tax, MCA compliance with per-action research gates. See [Implementation Plan: Phase 7](implementation-plan.md#phase-7-independently-gated-compliance-slices-provisional-rules-block-only-affected-actions).

**Key contract**: Each compliance action gated on `source_verified=true` + non-stale rule snapshot. Missing/stale rules REVIEW/BLOCK only affected action; unrelated work proceeds. s393 branch (Forms140/141/144) and s394 branch (Form143) separately gated. T-009 blocks Form140/141 transport pending research.

**Research gates preserved**: GSTR-3B stability, e-invoice/e-way bill transport, composition scheme, TDS/TCS rate verification, MCA form snapshot verification remain open until explicitly settled per T-001..T-010.

**Exit conditions**: GST, income-tax, MCA compliance logic complete; s393/s394 separately gated; T-009 blocks Form140/141; every action requires rule snapshot.

## Phase 8A: Full Multi-Dialect Semantic Conformance (After Phase 7)

**Goal**: Prove semantic equivalence on SQLite/PostgreSQL/MySQL. See [Implementation Plan: Phase 8A](implementation-plan.md#phase-8a-full-multi-dialect-semantic-conformance-after-phase-7-smoke-tests-since-phase-1).

**Key contract**: Normalized semantic snapshots (not binary equality); logical-ID matching on migrations; full-replay test; smoke tests (running since Phase 1).

**Exit conditions**: Semantic conformance verified; normalized final state identical across dialects.

## Phase 8B: Bounded Skill Runtime (Deterministic CLI-Only Invocation)

**Goal**: Skill execution engine with CLI-only invocation, manifest loading, exception routing, gate enforcement. See [Implementation Plan: Phase 8B](implementation-plan.md#phase-8b-bounded-skill-runtime-deterministic-cli-only-invocation).

**Key contract**: Skills invoke CLI commands only; no direct external APIs, secrets, or evidence/confirmation bypass. Cannot approve high-consequence actions (return error if not confirmed).

**Exit conditions**: Skill runtime complete; deterministic CLI invocation; gates enforced.

## Phase 9: Zoho Migration (Final; Exact Fixture Checksum, Quarantine Unsupported Rows)

**Goal**: Fixture-based import with exact checksum, duplicate-header preservation, per-cell provenance, unsupported-row quarantine, cross-dialect reconciliation. See [Implementation Plan: Phase 9](implementation-plan.md#phase-9-zoho-migration-final-exact-fixture-checksum-quarantine-unsupported-rows).

**Key contract**: 44 CSV files, 966 rows, SHA-256 `fda43a99d165dec5766953484cf1377c789ae4eb50abfa3636657d2fc36ce296` (from [zoho-backup-fixture.md](zoho-backup-fixture.md)). Unsupported rows (inventory, RBAC, identity) explicitly quarantined with provenance; never claim all rows mapped.

**Exit conditions**: All supported rows imported with provenance; unsupported rows counted and logged; GL balances match Zoho; duplicate-header ambiguity resolved.

## Deferred / Future

### Inventory Accounting (Deferred)

No inventory accounting in v1; products/services and document lines may carry description, quantity, unit, rate, tax treatment, and configured ledger account, but the system will not implement stock movements, warehouses, stock valuation, automated COGS, batches, serial numbers, or manufacturing.

Future inventory support should be enabled by stable item/document-line references and modular extension boundaries, not by speculative placeholder inventory tables now.
