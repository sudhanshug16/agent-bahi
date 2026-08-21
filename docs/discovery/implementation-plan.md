# Agent-Bahi Implementation Plan

**Status**: Specification-level planning gate document.

**Date**: 2026-08-21

**Scope**: End-to-end phased implementation plan for agent-bahi from proof spikes (Gate0) through Zoho migration (Phase 9). Every phase defines prerequisites, deliverables, deterministic tests, exit gates, non-goals, and exact references to existing canonical discovery/architecture documentation.

**Document Authority**: This plan does not authorize implementation. Sudhanshu must review and confirm the architecture, phasing, and proof-spike dependencies before Phase 1 begins. Tentative decisions (T-ID entries) mark all owner-approval blockers explicitly.

**Canonical References**:
- [Pre-Implementation Architecture](../architecture.md) — settled constraints and provisional technology recommendations.
- [Provisional Architecture Decisions](architecture-decisions.md) — technology choices and research baseline.
- [Discovery Decisions](decisions.md) — confirmed settled decisions (e.g., GSTR-1 output boundary, no intercompany cross-tenant posting in V1).
- [Data Model Requirements](data-model-requirements.md) — canonical account roles, document types, and entity contracts.
- [Accounting Contracts](accounting-contracts.md) — core accounting rules and posting templates.
- [Statutory Workflow Contracts](statutory-workflow-contracts.md) — compliance filing boundaries, due-event calculation, and professional review gates.
- [Tentative Decisions](tentative-decisions.md) — agent-selected defaults awaiting owner review (T-001 through T-006).
- [Skill Architecture](skill-architecture.md) — versioned skill contract, automation gates, and job-skill catalog structure.

---

## 1. Product Scope and Non-Goals (Binding)

### Product Scope
Agent-bahi is a **local-first, agent-first, India-focused, deterministic accounting and compliance modular monolith** with:
- **Default storage**: SQLite, deployable locally without external databases or services.
- **Multi-dialect adapters**: PostgreSQL and MySQL supported with proven semantic conformance.
- **Tenancy model**: One legal entity = one independent tenant. Multi-tenant database deployment supported; every operation tenant-scoped. Single-tenant operational deployments also supported.
- **GST registration**: One tenant may have multiple GSTIN registrations; every GST operation selects exactly one active applicable GSTIN.
- **Technology direction**: TypeScript + Bun (provisional; proof-spikes validate before commit).

### Non-Goals (Explicitly Deferred to V1.x or Later)

1. **Inventory accounting**: Products/services carry description, quantity, unit, rate, tax treatment, and account references. System does NOT track stock, warehouses, valuation, automated COGS, batches, serials, or manufacturing behavior. See [Architecture §1](../architecture.md#non-goals).

2. **Attendance/Leave/HRMS**: Payroll accepts approved summarized inputs (payable days, loss-of-pay days, overtime amounts/hours) but does NOT maintain attendance records, leave balances, shifts, or attendance-import workflows. Agent-bahi is not the system of record for employee time. See [Payroll Scope](payroll-scope.md).

3. **Employee portal**: NO employee self-service. Payslips and employee outputs are generated for secure external delivery only.

4. **RBAC implementation**: Authorization hooks are present and no-ops for V1; RBAC is deferred to V2. Actor, source, and permission context are threaded through every mutation.

5. **Web server/microservices**: CLI is the primary adapter. API and web clients are future options; reusable application services enable this without breaking changes.

6. **Direct government auto-filing**: Each filing (GST, TDS, e-invoice, e-way bill, income tax, MCA, etc.) requires separate research and owner-approved decision. GSTR-1 only has a settled specific boundary (prepare/validate/export + manual portal + evidence recording). See [Decisions](decisions.md#confirmed).

7. **Zoho import until final phase**: Zoho Books is the validated migration source but intentionally deferred to Phase 9. See [Zoho Frappe Parity](zoho-frappe-parity.md).

8. **Intercompany/cross-tenant paired posting**: Mistaken inter-entity payments are represented separately in each tenant with explicit due-to/due-from or correction journals only when the user records them. Never through a cross-tenant atomic write. See [Architecture §5](../architecture.md#tenant-model).

---

## 2. Top-Level Dependencies and Blockers

### Proof-Spike Validation (Hard Blocker for Phase 1)

All proof spikes must be **complete and successful** before Phase 1 implementation code begins.

1. **STK-001: Bun runtime and workspaces** — Pin exact Bun version; verify `bun install`, workspaces, and lockfile on target platforms (macOS arm64, Linux x64/arm64).
2. **STK-002: Multi-dialect ORM spike** — Test Drizzle (primary) and Kysely (fallback) on bun-sqlite, Bun SQL PostgreSQL, and MySQL; verify schema definition, query generation, and type inference on all three dialects.
3. **STK-003: SQLite configuration** — Verify `PRAGMA foreign_keys=ON`, WAL mode, `SQLITE_BUSY` handling, and transaction isolation on target filesystems (explicit rejection of network/sync paths).
4. **STK-004: Migration and test execution** — Run fresh-install migrations on all three dialects; test every supported upgrade path; verify schema consistency across dialects.
5. **STK-005: Schema generation and CLI parsing** — Verify Zod runtime validation, JSON schema generation for CLI commands, Clipanion parser bindings, help output, and decimal.js precision for INR/paise calculations.
6. **STK-006: Build and distribution** — Test ESM TypeScript build on all target platforms; verify compiled output and package/bin fallback; confirm database drivers (MySQL, PostgreSQL optional) work on all platforms.

See [Roadmap: Phase 1 Gate](roadmap.md#phase-1-gate-review-and-approval) for full proof-spike specifications.

### Canonical Document Validation (Hard Blocker for Phase 1)

- [Pre-Implementation Architecture](../architecture.md) passes contradiction review.
- All RECOMMENDED entries reviewed and confirmed by Sudhanshu (or explicitly overridden with new decisions).
- No unresolved OPEN RESEARCH items block core bookkeeping; only compliance/filing decisions require explicit research closure gates. See [Roadmap: Cross-cutting discovery milestone](roadmap.md#cross-cutting-discovery-milestone-verified-statutory-compliance-baseline-2026-08-21).

### Owner Review and Approval Gates

**T-ID Entries**: Every tentative decision (T-001 through T-006) is explicitly marked as **NOT OWNER-APPROVED**. Implementation proceeds only after owner confirmation or explicit override. See [Tentative Decisions](tentative-decisions.md).

Key tentative entries awaiting owner confirmation:
- **T-001**: External statutory submissions fallback default (prepare/validate/export + manual portal for all filings without specific approved boundary).
- **T-002**: Frappe Books as reference only (behavior/concept reference, no code reuse; license decision deferred).
- **T-003**: Fixed-asset depreciation methods (SLM default; reversible; not an implementation authorization).
- **T-004**: ORM selection (Drizzle primary, Kysely fallback; gates Phase 1 proof spikes).
- **T-005**: CLI parser selection (Clipanion primary; gates Phase 1 proof spikes).
- **T-006**: Numeric approval thresholds (e.g., for reconciliation confirmation, period unlock) — DEFERRED; tests must not assume.

---

## 3. Gate0: Proof Spikes and Technology Validation

**Duration**: 2–3 weeks (estimate; proof spikes run concurrently).

**Gate**: All spikes must complete **successfully** before Phase 1 code begins.

### Gate0 Deliverables

1. **STK-001 Spike Report**: Exact Bun version pinned; installation, workspace isolation, and lockfile verified on all target platforms.
2. **STK-002 Spike Report**: ORM working samples on all three dialects (SQLite, PostgreSQL, MySQL) with equivalent schema, query generation, and type safety.
3. **STK-003 Spike Report**: SQLite pragmas verified; foreign-key constraints enforced; WAL mode functional; `SQLITE_BUSY` handling visible and testable; network-filesystem rejection working.
4. **STK-004 Spike Report**: Schema migration tests pass for fresh install and all upgrade paths on all three dialects.
5. **STK-005 Spike Report**: Zod validation working; JSON schema generation verified; Clipanion command parser working; decimal.js precision tests passing (INR/paise, FX conversions, tax calculations).
6. **STK-006 Spike Report**: Build artifact exists; works on all target platforms; database drivers load correctly; package/bin fallback tested.

### Gate0 Tests

- **Infrastructure tests**: Bun runtime, ORM, database drivers, build pipeline each have passing test suite.
- **Cross-dialect conformance**: Same logical schema produces equivalent query results on SQLite, PostgreSQL, MySQL.
- **SQLite safety**: Foreign-key checks enabled; WAL mode functional; explicit-error handling for `SQLITE_BUSY`; network-filesystem detection working.

### Gate0 Exit Criteria

All proof-spike reports complete; owner reviews and confirms technology choices (or overrides with new decision); no unresolved compatibility issues remain.

---

## 4. Phase 1: Canonical Data Model and CLI Safety Foundation

**Duration**: 4–6 weeks (estimate).

**Goal**: Establish the authoritative schema, rules, and explicit safe command surface that all phases depend on.

### Phase 1 Prerequisites

1. **Gate0 proof spikes**: All complete and approved.
2. **Architecture document**: Reviewed and confirmed by Sudhanshu.
3. **Core types defined**: Tenant context, money/currency, date/time models, idempotency keys, audit events.
4. **Accounting Contracts**: Canonical pre-implementation domain contract. See [Accounting Contracts](accounting-contracts.md).

### Phase 1 Scope

#### 1.1 Chart of Accounts and Account Hierarchy
- **Deliverable**: Core tables: `accounts`, `account_hierarchy`, `account_types`.
- **Scope**: Asset, liability, equity, revenue, expense account types. India GL account-number structure and conventions. Parent-child hierarchies with rollup balance derivation.
- **Immutability**: Posted accounts never deleted; draft/superseded accounts may be marked inactive.
- **Tests**:
  - Accounts and types persist correctly.
  - Hierarchies roll up balances correctly (parent balance = sum of posted amounts under all descendants).
  - Account uniqueness per tenant.
  - Invalid account types rejected.
- **Canonical Reference**: [Accounting Contracts](accounting-contracts.md); [Data Model Requirements](data-model-requirements.md).

#### 1.2 Tenant Configuration and Identity
- **Deliverable**: Core tables: `tenants`, `tenant_settings`, `registrations`, `fiscal_periods`.
- **Scope**:
  - Base currency (exactly one per tenant, e.g., INR).
  - Timezone (IANA identifier).
  - Fiscal year settings (start month, end month).
  - Default report basis (cash or accrual).
  - GST registrations with GSTIN, state, type, scheme, effective dates, status.
  - Numbering series definitions (series, allocation rules, locked sequences).
  - Period locks (global or module-specific `locked-through` dates).
- **GSTIN Resolution**: One tenant = multiple possible GSTIN registrations. CLI commands with `gst_context=required` auto-select exactly one active applicable GSTIN; fail on ambiguity. Commands with `gst_context=none` do NOT resolve GSTIN.
- **Tenant Selection**: Auto-select exactly one active tenant; fail explicitly on ambiguity (>1 active tenant). Never silently remember last tenant.
- **Tests**:
  - Tenant uniqueness.
  - GSTIN applicability logic (effective dates, status, state).
  - Ambiguity detection (>1 active tenant, >1 applicable GSTIN).
  - Period-lock storage and query.
  - Fiscal-year settings apply correctly to numbering and postings.
- **Canonical Reference**: [Architecture §5](../architecture.md#tenant-model); [Architecture §5.3](../architecture.md#gstin-selection-gst-scoped-commands).

#### 1.3 Document Types and State Machine
- **Deliverable**: Core tables: `documents`, `document_lines`, `document_state_history`.
- **Scope**:
  - Document types: Invoice, Bill, Payment, JournalEntry, ExpenseClaim, PayrollRun, FixedAssetAcquisition, etc.
  - States: Draft → Validated → Posted → Settled (immutable posted documents).
  - Reversal/correction lineage: original → reversal + replacement with audit binding.
  - Document numbering: unique within series/year/applicable GSTIN; monotonic; no reuse.
  - Number-gap records: reserved, voided, cancelled, or failed numbers with durable audit evidence.
- **Immutability Enforcement**: Draft editable; finalized/issued/posted immutable except through reversal + replacement.
- **Tests**:
  - State transitions are valid (no jumps, no backward moves without reversal).
  - Document numbers are unique per series/year/GSTIN.
  - Number gaps recorded with reason and audit evidence.
  - Posted documents reject direct edits (return error, require reversal pattern).
  - Reversal lineage is immutable and audit-linked.
- **Canonical Reference**: [Architecture §10](../architecture.md#state-machines); [Accounting Contracts](accounting-contracts.md).

#### 1.4 Posting Mechanics and Ledger Invariants
- **Deliverable**: Core tables: `postings`, `journal_entries`, `audit_records`, `idempotency_records`.
- **Scope**:
  - Journal entries: balanced postings (debit=credit).
  - Postings: immutable ledger records (account, amount, debit/credit, tenant, GSTIN if applicable, date, source, actor, timestamp).
  - Account balance derivation: sum of postings for each account (never stored as mutable single value; drift detection on cached balances).
  - Audit trail: every mutation records actor, source, timestamp, change summary, request ID, outcome.
  - Idempotency: request ID deduplication prevents duplicate postings on replay.
- **Debit-Credit Invariant**: Every journal entry must balance exactly (debit total = credit total, in base currency or original currency). Posting operations reject unbalanced attempts.
- **Tests**:
  - Posting debit-credit balance enforced.
  - Account balances match sum of postings (no drift).
  - Idempotency: same request ID returns same result without duplicate postings.
  - Audit records created for every mutation.
  - Tenant isolation: postings visible only within their tenant.
  - GSTIN scoping (where applicable).
  - Currency handling: multi-currency posting with base-currency conversion snapshot.
- **Canonical Reference**: [Architecture §6](../architecture.md#canonical-accounting-model); [Architecture §7.2](../architecture.md#idempotency); [Architecture §8](../architecture.md#command-execution-and-transaction-boundaries).

#### 1.5 CLI Command Registry and Deterministic Validation
- **Deliverable**: Command registry, parser bindings, help generation, JSON schema export.
- **Scope**:
  - Domain-owned command definitions (not CLI framework as source of truth).
  - Commands declared with: noun/verb structure, versioned input/output schemas, gst_context (none or required), idempotency rules, authorization hooks.
  - Generated artifacts: human help text, JSON schemas for agent consumption, skill references.
  - Tenant and GSTIN context resolution (embedded in every command).
  - Exit-code taxonomy (success, validation error, ambiguity, conflict, compliance gate, external error, permission denied, internal error, partial success).
- **Tests**:
  - Help output is human-readable and complete.
  - JSON schema generated correctly and validates agent inputs.
  - Exit codes match taxonomy (0=success, 1=validation, 2=ambiguity, 3=conflict, 4=compliance, 5=external-retryable, 6=external-terminal, 7=permission, 8=internal, TBD=partial-success).
  - Tenant context resolved correctly (auto-select, ambiguity detection).
  - GSTIN context resolved correctly (gst_context=required vs. gst_context=none).
  - Idempotency lookups prevent duplicate operations.
- **Canonical Reference**: [Architecture §13](../architecture.md#cli-contract-for-agents); [Architecture §8.1](../architecture.md#deterministic-command-lifecycle-numbered).

#### 1.6 Contacts and Items
- **Deliverable**: Core tables: `contacts`, `items_or_services`.
- **Scope**:
  - Contacts: Supplier, customer, employee, other party; tenant-scoped.
  - Items/services: Description, quantity unit, rate, tax treatment, default ledger account reference; NO inventory, stock, warehouse, or COGS.
- **Tests**:
  - Contact uniqueness per tenant.
  - Item references do not imply stock tracking.
  - Default accounts resolve correctly.
  - Tenant isolation.

#### 1.7 Currency, Money, and Exchange Rates
- **Deliverable**: Core tables: `currency_rate_snapshots`; money and decimal-math wrappers.
- **Scope**:
  - Posted amounts: currency-aware integer minor units (paise for INR).
  - Intermediates: tax calculations, FX conversions use exact decimal arithmetic (decimal.js).
  - Rate snapshots: immutable exchange rate at document creation (date, document currency, base currency, rate, source, timestamp).
  - Rounding: declared per-rule-pack (stage, scope, tie-breaking, remainder policy, FX quote direction).
- **Tests**:
  - Currency conversions use rate snapshot at document date.
  - Decimal math produces exact results (no float errors).
  - Rounding rules applied correctly; remainder tracked or allocated.
  - Posting amounts are integers (minor units); intermediates are decimal.
  - FX conversions store original currency, base-currency result, rate, rounding rule applied, intermediate decimal values.
- **Canonical Reference**: [Architecture §7](../architecture.md#exact-money-time-numbering-concurrency); [Accounting Contracts](accounting-contracts.md).

#### 1.8 Evidence Storage and Attachment
- **Deliverable**: Core tables: `evidence`, `evidence_attachments`.
- **Scope**:
  - Content-addressed immutable blobs (receipts, statements, e-invoice responses, etc.).
  - Metadata: checksum, storage reference, content type, validation status, rule source, effective dates, exception record.
  - Evidence write protocol: stage → fsync → hash-verify → atomic promotion → SQL commit.
- **Tests**:
  - Evidence hash matches stored hash (integrity).
  - Content-addressed storage prevents duplicates.
  - Evidence accessible for audit and export.
  - Orphaned temp objects cleaned up on failure.

### Phase 1 Exit Gate

**Conditions for Phase 1 completion**:

1. **Schema complete**: All tables defined with primary/foreign keys.
2. **Invariants enforced**: Debit-credit balance, account uniqueness, tenant isolation, GSTIN scoping, document-number uniqueness, idempotency.
3. **CLI stable**: Command registry, help, JSON schema generation working. Tenant/GSTIN resolution correct.
4. **Tests comprehensive**: Unit tests for each domain module; integration tests for document workflows; cross-dialect tests (SQLite, PostgreSQL, MySQL).
5. **Build passing**: Schema migrations pass on all three dialects (fresh install + all upgrade paths).
6. **No architectural contradictions**: Schema design matches [Accounting Contracts](accounting-contracts.md) and [Architecture](../architecture.md).

### Phase 1 Non-Goals

- Tax calculations (deferred to Phase 7).
- Skill runtime (deferred to Phase 3).
- Bank reconciliation (deferred to Phase 6).
- Payroll (deferred to Phase 5).
- Compliance reporting (deferred to Phase 7).

---

## 5. Phase 2: Skill Contracts and Manifests (Schema and Documentation Only)

**Duration**: 2–3 weeks (estimate).

**Goal**: Define and version the skill contract and initial job-skill catalog without implementing skills or embedding accounting rules.

### Phase 2 Prerequisites

1. **Phase 1 complete**: Core schema, CLI, and command registry stable.
2. **Skill Architecture framework**: Versioned skill contract structure. See [Skill Architecture](skill-architecture.md).

### Phase 2 Scope

#### 2.1 Versioned Skill Contract Definition
- **Deliverable**: Skill contract specification (`skill-architecture.md` expanded with schema).
- **Content**:
  - Purpose and job description.
  - Version ID; effective_from/to dates.
  - Engine and rule-pack compatibility ranges.
  - Prerequisites (tenant exists, period not locked, etc.).
  - Inputs (user-supplied, entity references, period, records).
  - Evidence requirements and quality expectations.
  - Allowed commands (explicit list of CLI commands the skill may invoke).
  - Ordered procedure (workflow steps, explicit pause points).
  - Validation checks (verifying intended outcome).
  - Automation gate (conditions for auto-commit vs. human review).
  - Exception routes (named exception types with remediation).
  - Outputs (records, reports, exceptions, audit metadata).
  - Skill versioning and deprecation policy.
- **Tests**:
  - Contract schema validates against all initial skills.
  - Skills declare only commands that exist in Phase 1 registry.
  - No skills embed accounting rules or tax calculations.
  - Exception routes are explicit and named.

#### 2.2 Initial Job-Skill Catalog (Contract Declarations Only)
- **Deliverable**: Skill manifests for each job in versioned declaration format (no implementation code).
- **Initial Skills**:
  1. **Daily bookkeeper**: Routine posting, memo entries.
  2. **Accounts payable**: Bill matching, payment proposals.
  3. **Accounts receivable**: Invoice tracking, payment matching.
  4. **Expense review**: Claim validation, receipt attachment.
  5. **Bank reconciliation**: Statement import, match proposals.
  6. **Fixed assets**: Acquisition, depreciation runs, disposal.
  7. **Payroll accounting**: Run input, finalization, remittance.
  8. **Month-end close**: Period lock, variance review.
  9. **Year-end close**: Annual adjustments, filing prep.
  10. **GST**: Obligation prep, GSTR-1, GSTR-3B review.
  11. **TDS/TCS**: Deduction tracking, statement prep, return filing.
  12. **Compliance calendar**: Obligation reminders, deadline tracking.
  13. **Audit preparation**: Evidence export, control testing.
  14. **Management reporting**: Custom report generation, drill-down.

- **Each skill declares**:
  - Prerequisites (which Phase 1/Phase 3/Phase 5 commands must exist).
  - Inputs and evidence required.
  - Allowed commands (exact Phase 1 commands available, no forward references).
  - Exception routes (ambiguity, missing evidence, failures).
  - Outputs (records, exceptions, audit metadata).
  - Automation gate (policy: auto-commit, requires-review, human-confirmation-required).

- **Tests**:
  - Contract validation passes for all initial skills.
  - Forward references to unimplemented commands are explicitly marked DEFERRED.
  - Skills declare only commands and fields that exist in Phase 1/3/5.
  - Exception routes are explicit and routable.

#### 2.3 Skill Versioning and Compatibility Policy
- **Deliverable**: Documented policy for skill versioning, deprecation, and compatibility.
- **Content**:
  - Version ID structure and compatibility ranges.
  - How skills declare required engine versions and rule-pack versions.
  - Deprecation timeline and migration path.
  - Backward-compatibility guarantees (or lack thereof).

### Phase 2 Exit Gate

**Conditions**:

1. **Skill contract is fully specified** with versioned schema.
2. **Initial job-skill catalog is complete** — all 14 skills documented as contract declarations.
3. **Skills reference only Phase 1 commands** — no forward references to unimplemented features (except where marked DEFERRED).
4. **Exception routes are explicit** — no silent fallbacks; every failure route named.
5. **Skill implementation roadmap clear** — Phase 3 and later phases know what to build.

### Phase 2 Non-Goals

- No skill implementation code (deferred to Phase 3+).
- No embedded accounting rules or tax logic in skill contracts.
- No runtime execution.

---

## 6. Phase 3: Deterministic Lifecycle and Posting Engine

**Duration**: 6–8 weeks (estimate).

**Goal**: Implement the document state machine, deterministic posting pipeline, and agent safety boundaries for all document types.

### Phase 3 Prerequisites

1. **Phase 1 complete**: Core schema and CLI stable.
2. **Phase 2 complete**: Skill contracts defined (for Phase 3 to understand which commands skills expect).

### Phase 3 Scope

#### 3.1 Document State Machine Implementation
- **Deliverable**: Stateful document lifecycle with state transitions, validation, and immutability enforcement.
- **States**:
  - **Draft**: Editable; does not post ledger entries.
  - **Validated**: Syntax/schema valid; may be edited if in Draft.
  - **Posted**: Immutable except through reversal/replacement lineage. Ledger entries created and locked.
  - **Settled**: Zero signed open balance after allocation plus an approved balanced credit/write-off/refund journal.
- **Reversals and Corrections**:
  - Reversal: immutable reverse posting (original → reversal + replacement).
  - Replacement: new document, linked to reversal via immutable lineage.
  - Audit binding: every reversal records reason, actor, timestamp, evidence link.
- **Tests**:
  - State transitions are deterministic and locked (no jumps, no backward moves without reversal).
  - Posted documents reject direct edits (return error with remediation: "perform reversal").
  - Reversal lineage is immutable and audit-linked.
  - Settling a document requires zero signed open balance or approved credit/write-off/refund journal.

#### 3.2 Deterministic Posting Pipeline
- **Deliverable**: Complete posting pipeline for all document types (invoices, bills, payments, journal entries, expense claims, payroll runs, fixed-asset acquisitions).
- **Pipeline**:
  1. Validate document structure (required fields, line items, amounts).
  2. Validate against effective-dated rules (tax treatment, account mappings, compliance gates).
  3. Compute derived amounts (tax, FX, allocations).
  4. Generate journal entries (balanced postings).
  5. Atomic write: postings + audit + idempotency record.
- **Tests**:
  - Posting debit-credit balance enforced.
  - All document types produce correct postings.
  - Tax components posted to correct accounts.
  - Multi-currency posting uses correct rate snapshot and FX calculation.
  - Idempotency: same request ID returns same result without duplicates.
  - Audit records created for every posting.
  - Failed posting rolls back all side effects (no partial posts).

#### 3.3 High-Consequence Approval Gates (Prepare/Preview → Validate → Commit)
- **Deliverable**: Gate implementation for period close, payroll finalization, filing snapshot, bank reconciliation, and explicitly gated operations.
- **Gate Pattern**:
  1. **Prepare**: Compute plan without side effects; return preview and plan hash/ID.
  2. **Validate**: Human reviews preview; hashes must match. Agents/skills may prepare and validate only; neither may approve.
  3. **Commit**: Recompute to verify plan matches preview; acquire locks; post atomically. If plan diverged, abort and re-prepare.
- **Plan/Approval Artifact**:
  - Plan hash (SHA-256 of computed outcome).
  - Plan ID (short reference).
  - Tenant and GSTIN scope.
  - Request payload hash.
  - Entity versions and rule versions.
  - For reconciliation/allocation: explicit human confirmation bound to exact plan ID, source line, target, amounts, FX snapshot, versions, tenant, actor, timestamp.
  - Expiry: configurable TTL (e.g., 24 hours).
- **Tests**:
  - Prepare and commit produce identical plans (plan hash matches).
  - Diverged plans detected and abort with error.
  - Human confirmation binds to exact plan digest; missing/stale/mismatched confirmations return error (not auto-commit).
  - Period-lock changes, payroll finalization, reconciliation all require explicit human confirmation.

#### 3.4 Reconciliation Non-Posting Proposals and Explicit Confirmation
- **Deliverable**: Bank reconciliation, payment allocation, and credit clearing workflows with non-posting proposals and recorded human confirmation.
- **Pattern**:
  1. **Propose** (non-posting): Skill analyzes statement lines and matches candidates.
  2. **Persist proposal**: Durable non-posting candidate records (plan hash, versions, artifacts).
  3. **Human confirmation** (required): Recorded explicit human confirmation bound to exact plan ID, source line, target document/payment, amount, currency, FX snapshot, versions, tenant, actor, timestamp.
  4. **Commit**: Revalidate confirmation matches plan hash; acquire locks; post atomically.
- **Safety Gates**:
  - Skills/agents/workflows cannot approve reconciliation; explicit human confirmation required.
  - Missing confirmation returns `RECONCILIATION_CONFIRMATION_REQUIRED`.
  - Stale/mismatched confirmations return `STALE_RECONCILIATION_PLAN` or `RECONCILIATION_PLAN_MISMATCH`.
  - Failed external/bank confirmation returns `EXTERNAL_RECONCILIATION_CONFLICT`.
- **Tests**:
  - Proposals are non-posting (no side effects).
  - Confirmation bindings are cryptographically/deterministically verifiable.
  - Skill/workflow invocations without human confirmation fail.
  - Stale/mismatched confirmations detected.
  - Reconciliation posts only after confirmed.

#### 3.5 Authorization Hook Framework (No-Op in V1)
- **Deliverable**: Authorization hook layer (interface, invocation, no-op default implementation for V1).
- **Framework**:
  - Every command invokes an authorization hook before mutation.
  - Hook signature: `(actor, permission context, command, scope) -> authorized | denied`.
  - V1 default: no-op (always authorized).
  - V2+: RBAC implementation.
  - Actor, source, and permission context threaded through every mutation.
- **Tests**:
  - Authorization hook invoked before mutation.
  - Hook can be replaced/extended without breaking domain logic.
  - Audit records include actor and source context.

#### 3.6 External Operation and Evidence Recording (Outbox Pattern)
- **Deliverable**: Durable outbox/saga pattern for external API calls, evidence recording, and idempotent retry.
- **Pattern**:
  1. **Prepare**: Create `ExternalOperation` record (prepared state).
  2. **Submit**: CAS to submitted state; external call happens outside transaction.
  3. **Record evidence**: CAS to known_success/known_failure/unknown based on provider response.
  4. **Reconciliation**: Timeout/no-response → reconciliation skill queries provider status; records actual state.
  5. **Finalize**: CAS to business_finalized once evidence recorded (idempotent; re-execution safe).
- **Immutable observation log**: State transitions append immutable observations (timestamp, actor, request/response hash, old state, new state, reason, evidence references).
- **Tests**:
  - Durable outbox prevents blind retries.
  - No external call inside transaction.
  - Provider idempotency/correlation IDs tracked.
  - Unknown outcomes quarantined and require reconciliation.
  - Finalization is idempotent and resume-safe.

### Phase 3 Exit Gate

**Conditions**:

1. **Document state machine is complete** — all states and transitions implemented and tested.
2. **Posting pipeline works** — all document types produce correct postings.
3. **Reversals and corrections** — immutable lineage, audit-linked.
4. **High-consequence gates** — prepare/commit pattern with plan hashing and human confirmation for reconciliation.
5. **External operations safe** — durable outbox, idempotent retry, unknown-outcome reconciliation.
6. **Tests comprehensive**: Unit tests per document type; integration tests for full workflows; cross-phase test coverage.

### Phase 3 Non-Goals

- Tax calculations (deferred to Phase 7).
- Payroll-specific logic (deferred to Phase 5).
- Bank statement import (deferred to Phase 6).
- Compliance reporting (deferred to Phase 7).
- Skill implementation (deferred to Phase 4+).

---

## 7. Phase 4: Daily Workflows, Executable Skills, and Zoho Parity

**Duration**: 6–8 weeks (estimate).

**Goal**: Build executable skills and CLI workflows for routine daily accounting operations, achieving Zoho Books automation parity as the minimum baseline.

### Phase 4 Prerequisites

1. **Phase 1 complete**: Core schema and CLI.
2. **Phase 2 complete**: Skill contracts.
3. **Phase 3 complete**: Document state machine and posting engine.
4. **Zoho parity baseline verified**: [Zoho Frappe Parity](zoho-frappe-parity.md) research complete.

### Phase 4 Scope

#### 4.1 Invoice Creation and Tracking Skill
- **Deliverable**: Executable skill for invoice creation, validation, and tracking.
- **Workflow**:
  1. Input: Customer, items/lines, dates, amounts.
  2. Validate: Required fields, account mappings, tax treatment.
  3. Create draft invoice.
  4. Issue invoice (allocate document number, create postings).
  5. Track open/aging.
- **Tests**:
  - Invoices post correctly (AR debit, revenue credit, tax components).
  - Document numbering is monotonic and unique per GSTIN/year.
  - Aging calculation is correct (overdue, current, etc.).
  - Idempotency: same request ID returns same invoice (no duplicate number allocation).

#### 4.2 Bill Recording and Payment Matching Skill
- **Deliverable**: Executable skill for bill recording, validation, matching, and payment allocation.
- **Workflow**:
  1. Input: Supplier, items/lines, dates, amounts.
  2. Validate and create bill.
  3. Record payment or partial payment.
  4. Match payment to bill (cash-first atomic posting, exact FX calculation, realized/unrealized FX separation).
  5. Track open balance.
- **Settlement Logic**:
  - `B = round(actual_paid_amount * paid_currency_to_base_rate)`.
  - Receivable FX: `B - carrying_base_removed`; Payable FX: `carrying_base_removed - B`.
  - Cash posting: actual bank amount `B` posted exactly once to Bank/Cash against unapplied-cash control.
  - Allocation/reclassification leg: clears unapplied-cash control against AP, with realized FX included.
  - No second Bank/Cash posting for FX.
- **Tests**:
  - Bill posting correct (AP credit, expense debit, tax components).
  - Payment posting atomic (bank debit, unapplied-cash control, AP credit, FX separation).
  - Partial payments tracked (open balance correct).
  - Multi-currency FX calculated correctly (no float errors).
  - Idempotency: same request ID returns same posting.

#### 4.3 Expense Categorization and Receipt Attachment Skill
- **Deliverable**: Executable skill for employee expense claims, advance management, reimbursement, and corporate-card statement matching.
- **Workflow**:
  1. Input: Employee, expense type, amount, receipt/evidence.
  2. Validate expense against rules and evidence.
  3. Categorize (expense account, tax treatment).
  4. Attach evidence (content-addressed, immutable).
  5. Record advance settlement or reimbursement (cash posting).
  6. Track claim status.
- **Tests**:
  - Expense postings correct (expense debit, advance/cash credit).
  - Evidence attached and accessible.
  - Reimbursement settles advance balance correctly.
  - Idempotency: same request ID returns same posting.

#### 4.4 Journal Entry Creation Skill
- **Deliverable**: Executable skill for manual journal entry recording.
- **Workflow**:
  1. Input: Accounts, amounts (debit/credit), date, reason.
  2. Validate balance (debit=credit).
  3. Record and post.
  4. Track reversal for corrections.
- **Tests**:
  - Journal entries balance (debit=credit).
  - Postings are immutable; corrections use reversal pattern.
  - Audit trail captures reason and actor.

#### 4.5 Month-End Close and Period Locking
- **Deliverable**: Executable skill for month-end procedures, variance review, and period locking.
- **Workflow**:
  1. Prepare: Generate trial balance, variance report, close checklist.
  2. Validate: All uncleared items identified.
  3. Lock period: CAS period-lock record; prevent mutations after lock date.
  4. Unlock: Requires explicit reason and human confirmation.
- **Tests**:
  - Period lock prevents postings in locked range (reject with error).
  - Lock/unlock operations are audit-linked with reason.
  - Unlock requires explicit confirmation (not auto-approved by skill).

#### 4.6 Zoho Books Automation Parity Testing
- **Deliverable**: Test suite comparing agent-bahi results to Zoho Books for same-day transactions.
- **Scope**:
  - Invoice, bill, payment, expense, journal entry workflows.
  - Multi-currency transactions with FX calculation.
  - Tax component posting.
  - Aging and open-balance tracking.
- **Tests** (golden examples from Zoho Books):
  - Same transaction data produces equivalent ledger state.
  - Account balances match (GL comparison).
  - Aging reports match (AR/AP comparison).
  - No Zoho reference needed for daily bookkeeping (agent-bahi is self-contained).
- **Canonical Reference**: [Zoho Frappe Parity](zoho-frappe-parity.md).

### Phase 4 Exit Gate

**Conditions**:

1. **All initial skills implemented and tested** (invoice, bill, payment, expense, journal, close).
2. **Zoho parity achieved**: Same-day transactions produce equivalent ledger state.
3. **CLI workflows complete**: User can book a typical day end-to-end via CLI or skills.
4. **Tests comprehensive**: Unit tests, integration tests, Zoho-comparison tests.

### Phase 4 Non-Goals

- Tax calculations specific to GST/TDS (deferred to Phase 7).
- Payroll (deferred to Phase 5).
- Bank statement import (deferred to Phase 6).
- Fixed-asset depreciation (deferred to Phase 5).

---

## 8. Phase 5: Deterministic Multi-Dialect Support (SQLite/PostgreSQL/MySQL Parity)

**Duration**: 4–6 weeks (estimate).

**Goal**: Prove semantic conformance across all three database dialects (SQLite, PostgreSQL, MySQL) with deterministic tests and full-replay validation.

### Phase 5 Prerequisites

1. **Phase 1–4 complete**: Schema, CLI, postings, and skills stable.
2. **Three migration histories**: Separate migration paths for SQLite, PostgreSQL, MySQL.

### Phase 5 Scope

#### 5.1 Cross-Dialect Schema Conformance
- **Deliverable**: Verified schema equivalence on all three dialects.
- **Tests**:
  - Same logical schema on SQLite, PostgreSQL, MySQL.
  - Foreign-key constraints enforced on all three.
  - Transaction isolation levels equivalent (or explicitly noted if different).
  - Concurrency behavior equivalent (SQLITE_BUSY handling, lock semantics).

#### 5.2 Deterministic Query and Posting Behavior
- **Deliverable**: Query results and posting outcomes identical across dialects for same input.
- **Tests**:
  - Account balance queries produce identical sums on all three.
  - Document numbering allocation is deterministic (no race conditions or dialect-specific ordering).
  - Postings generate identical journal entries on all three dialects.
  - Idempotency: same request ID returns same result on all three dialects.
  - Pagination is deterministic (cursor-based, no offset-only).

#### 5.3 Full-Replay Verification (Schema and Data Replay)
- **Deliverable**: Full-replay contract test suite.
- **Test Pattern**:
  1. Create fresh database on dialect A.
  2. Execute full transaction log (all Phase 1–4 operations).
  3. Capture final state (schema, postings, audit records).
  4. Repeat on dialects B and C.
  5. Verify final states are identical (binary equality of key tables: `accounts`, `postings`, `documents`, `audit_records`).
- **Coverage**:
  - Fresh install migrations pass on all three dialects.
  - All upgrade paths (schema migration history) work on all three.
  - Deterministic replay produces identical final state.

#### 5.4 Dialect-Specific Smoke Tests
- **Deliverable**: Runtime smoke tests on each dialect (actual database instances).
- **Scope**:
  - SQLite: WAL mode, foreign_keys pragma, SQLITE_BUSY handling, network-filesystem rejection.
  - PostgreSQL: Connection pooling, prepared statements, transaction semantics.
  - MySQL: Charset/collation handling, transaction isolation, prepared statements.
- **Tests**:
  - Each dialect passes Phase 1–4 test suite without modifications to business logic.

### Phase 5 Exit Gate

**Conditions**:

1. **Schema identical**: All three dialects have equivalent schema with migrations.
2. **Queries deterministic**: Same query produces same results on all three.
3. **Full-replay passes**: Identical final state on all three dialects after full transaction log.
4. **Smoke tests pass**: Phase 1–4 tests pass on actual instances of all three dialects.
5. **Upgrade paths verified**: All schema migration paths work on all three dialects.

### Phase 5 Non-Goals

- Distributed transactions or cross-dialect queries (each instance is independent).
- Performance optimization (correctness first).

---

## 9. Phase 6: Fixed Assets, Payroll Foundations, and Bank Reconciliation

**Duration**: 8–10 weeks (estimate).

**Goal**: Implement fixed-asset register with depreciation, payroll accounting foundation, and bank reconciliation with evidence linking.

### Phase 6 Prerequisites

1. **Phase 1–5 complete**: Core schema, skills, and dialects.
2. **Payroll Scope**: Documented in [Payroll Scope](payroll-scope.md).
3. **Fixed-Asset Architecture**: Documented (tentative: T-003).

### Phase 6 Scope

#### 6.1 Fixed-Asset Register and Depreciation
- **Deliverable**: Asset acquisition, depreciation run, and disposal tracking with separate book/tax schedules.
- **Scope**:
  - Asset register: Acquisition date, cost, location, status (in-use, disposed, fully-depreciated).
  - Capitalization: Sourced from bill posting (automatic) or manual acquisition journal.
  - Depreciation: Method (SLM default; reversible choice, not implementation authorization). See [T-003](tentative-decisions.md#entry-t-003-fixed-asset-depreciation-schedulesbook-vs-tax-with-tentative-slm-default).
  - Separate book and tax schedules with different methods/rates.
  - Disposal tracking with gain/loss calculation.
  - Immutability: Historical depreciation is immutable; superseded by new schedule version on method change.
- **Tests**:
  - Asset acquisition postings (Dr Fixed Asset | Cr AP/Bank).
  - Depreciation runs generate correct journal entries.
  - Book and tax depreciation calculated correctly (SLM; rate/term inputs validated).
  - Disposal calculates gain/loss correctly.
  - Unique source-document-line capitalization (no duplicate capitalization of same acquisition).
  - Immutable depreciation runs; corrections use reversal pattern.

#### 6.2 Payroll Accounting Foundation
- **Deliverable**: Employee profiles, salary structures, and pay-run infrastructure.
- **Scope**:
  - Employee statutory profiles (PAN, AADHAAR, bank, age, marital status, dependent count, jurisdiction).
  - Salary structures: Components/formulas (fixed, variable, conditional), effective-dated rules.
  - Pay runs: Draft, approval, posting, locking.
  - Payables: Salary payable, tax payable, statutory deduction payables (PF, ESI, PT, LWF), advance/loan tracking.
  - Inputs: Approved summarized inputs (payable days, loss-of-pay days, overtime amounts/hours); NO attendance, leave, HRMS, or attendance-import domain.
- **Tests**:
  - Salary structure produces correct gross and net for given inputs.
  - Tax calculations correct (TDS under s392, PF, ESI, PT, LWF).
  - Pay run postings balance (gross debit, payables and deductions credit).
  - Effective-dated rules applied correctly.
  - Idempotency: same pay-run request returns same result.

#### 6.3 Bank Reconciliation with Evidence Linking
- **Deliverable**: Bank statement import, reconciliation matching, and evidence recording.
- **Workflow**:
  1. **Import**: Bank statement lines (date, amount, reference, description).
  2. **Propose**: Skill matches candidates (document numbers, amounts, parties, dates).
  3. **Confirm**: Human confirms exact match (plan hash binding required).
  4. **Persist**: CAS reconciliation record linking posting to statement line.
  5. **Reconciliation report**: Unmatched items, period reconciliation status.
- **Matching Logic**:
  - Amount matching (exact or within tolerance).
  - Date matching (posting date vs. bank date; clearing time).
  - Reference matching (document number, party name).
  - Partial reconciliation (multiple statement lines match one posting or vice versa).
- **Evidence Linking**:
  - Reconciled postings linked to exact statement line via immutable reconciliation record.
  - Bank statement file hash and signature stored.
  - Reconciliation proposals are non-posting; explicit human confirmation required before persistence.
- **Tests**:
  - Reconciliation proposals are non-posting (no side effects).
  - Human confirmation binds to exact plan digest.
  - Reconciled postings correctly linked to statement lines.
  - Unreconciled items correctly identified.
  - Skill cannot approve reconciliation (explicit human confirmation required).
  - Multi-dialect reconciliation produces same matches.

#### 6.4 Period Close and Financial Reporting
- **Deliverable**: Period-close procedures and basic financial statements.
- **Scope**:
  - Trial balance (TB) and posting verification.
  - Profit & Loss (P&L) statement (accrual and cash basis options).
  - Balance Sheet (BS).
  - Aging reports (AR/AP).
  - Close checklist and variance analysis.
- **Tests**:
  - TB matches sum of postings (no drift).
  - P&L and BS balance (BS assets = liabilities + equity; P&L net income flows to equity).
  - Aging correct (current, overdue buckets).
  - Cash vs. accrual basis toggling works.

### Phase 6 Exit Gate

**Conditions**:

1. **Fixed assets**: Register, depreciation runs, disposal tracking implemented and tested.
2. **Payroll accounting**: Employee profiles, salary structures, pay runs, postings implemented and tested.
3. **Bank reconciliation**: Statement import, matching, evidence linking, reconciliation reports working.
4. **Period close**: Trial balance, reports, closing procedures implemented and tested.
5. **Tests comprehensive**: Unit and integration tests; multi-dialect validation.

### Phase 6 Non-Goals

- Attendance/leave/HRMS (deferred).
- Tax filing (deferred to Phase 7).
- Employee portal (deferred).
- Payroll-specific statutory reporting (deferred to Phase 7).

---

## 10. Phase 7: Deterministic India Compliance and Tax Calculations

**Duration**: 10–12 weeks (estimate).

**Goal**: Implement effective-dated India compliance and statutory tax calculations with OPEN legal gates explicitly blocking affected actions only.

### Phase 7 Prerequisites

1. **Phase 1–6 complete**: Core accounting, payroll foundations, and bank reconciliation.
2. **Statutory Workflow Contracts**: Compliance filing boundaries, due-event calculation, professional review gates documented in [Statutory Workflow Contracts](statutory-workflow-contracts.md).
3. **Compliance matrices**: Verified research baselines for [GST](gst-compliance-matrix.md), [TDS/TCS](tds-tcs-compliance-matrix.md), [Annual Income-Tax](annual-income-tax-compliance-matrix.md), [MCA Companies Act](mca-companies-act-compliance-matrix.md).
4. **Effective-dated rule packs**: Declared manifest structure with official sources, versioning, and immutability.

### Phase 7 Scope

#### 7.1 GST Accounting and GSTR-1 Output
- **Deliverable**: GST registration model, tax-component posting, and GSTR-1 export.
- **Scope**:
  - GST registrations: GSTIN, state, type (regular/composition), scheme, effective dates, status.
  - Taxable/exempt/zero-rated supply classification.
  - GST components: SGST, CGST, IGST, Cess (posted separately to tax-payable accounts).
  - Reverse charge (RCM) where applicable.
  - Input tax credit (ITC): Eligibility logic (document, GSTR-2B evidence, rules).
  - GSTR-1: Export JSON, local validation, portal-upload workflow (no auto-filing).
  - Amendments: GSTR-1A (same-period amendments after GSTR-1 filed, before GSTR-3B filed).
- **Immutability and Compliance**:
  - Effective-dated rule snapshot captured at invoice finalization.
  - GST classification does not change retroactively; historical invoices retain original rule-snapshot classification.
  - GSTR-1 amendment history tracked (original → amendment lineage).
- **Tests**:
  - Tax components posted correctly (separate GL accounts per component).
  - ITC eligibility checked against GSTR-2B evidence and rules.
  - GSTR-1 export produces valid portal JSON.
  - Same GSTR-1 export on all three dialects.
  - Amendments tracked and lineage preserved.
- **Canonical Reference**: [GST Compliance Matrix](gst-compliance-matrix.md); [Architecture §11](../architecture.md#compliance-transport-boundaries-settled-and-open).

#### 7.2 TDS/TCS Compliance
- **Deliverable**: Tax Deducted/Collected at Source calculations and compliance tracking.
- **Scope**:
  - TDS under s392: Rates, slabs, thresholds (effective-dated rule snapshots).
  - TCS under s393: Rates, slabs, thresholds.
  - Statutory deductions: Form 140/141 statement routing (statement outputs only; rates from s393/s394 snapshots).
  - TDS deposit and return filing (Form 24, Form 25).
  - Declarations and proofs from suppliers/customers.
- **Immutability**:
  - TDS rate snapshot captured at invoice/payment finalization.
  - Deduction does not retroactively change if rates updated.
- **Stale/Missing Rules Gate**:
  - Missing rule or stale rule snapshot → BLOCK TDS computation with explicit review/block outcome.
  - Deterministic fail-closed behavior (no silent use of newest or previous rule).
- **Tests**:
  - TDS calculated correctly from snapshot rules (no float errors; decimal math verified).
  - Rate thresholds apply correctly.
  - Form 140/141 generated correctly.
  - Deposit reconciliation works.
- **Canonical Reference**: [TDS/TCS Compliance Matrix](tds-tcs-compliance-matrix.md); [Statutory Workflow Contracts](statutory-workflow-contracts.md).

#### 7.3 Annual Income-Tax and Compliance Return Filing
- **Deliverable**: Annual income-tax compliance calculation and filing preparation.
- **Scope**:
  - Tax computation: Gross income, allowances, deductions, loss-set-off.
  - Form 26 (s63 audit report): Preparation and scope gates (audit applicability section 63).
  - Return filing: Form selection (Form 1-1/1-2/1-3/1-4/etc. per entity type and income sources).
  - Advance tax (if applicable).
  - Filing deadline gates and obligation generation.
- **Stale/Missing Rules Gate**:
  - Missing form structure, computation input definitions, or advance-tax rules → BLOCK with explicit review/block outcome.
- **Tests**:
  - Tax computation correct (gross, allowances, deductions, loss-set-off).
  - Form 26 generated for audit-applicable entities.
  - Filing deadline calculated correctly.
- **Canonical Reference**: [Annual Income-Tax Compliance Matrix](annual-income-tax-compliance-matrix.md); [Statutory Workflow Contracts](statutory-workflow-contracts.md).

#### 7.4 MCA Companies Act Compliance
- **Deliverable**: Mandatory audit, director/KMP disclosures, statutory compliance forms.
- **Scope**:
  - Mandatory audit (every company, no exemption).
  - Auditor appointment and rotation (current Act rules).
  - Form AOC-4, AOC-4 CFS, MGT-7, ADT-1, DPT-3, MSME-1 (where applicable).
  - DPT-3: Deposits/money-not-treated-as-deposits, NOT director/KMP data.
  - Historical-form preservation (forms change over time; immutable snapshots).
- **Stale/Missing Rules Gate**:
  - Missing form structure, classification logic, or MCA rule version → BLOCK with explicit review/block outcome.
  - `source_verified=true` and non-stale `effective_rule_snapshot` required for affected obligation.
- **Tests**:
  - Audit applicability determined correctly.
  - Forms generated (or validation gates BLOCK if rules missing).
  - Historical forms preserved (immutable snapshots).
- **Canonical Reference**: [MCA Companies Act Compliance Matrix](mca-companies-act-compliance-matrix.md); [Statutory Workflow Contracts](statutory-workflow-contracts.md).

#### 7.5 Effective-Dated Rules Engine and Rule Packs
- **Deliverable**: Rule pack loading, versioning, and effective-date selection.
- **Scope**:
  - Rule pack manifest: jurisdiction, applicability interval, official source, checksum, signature.
  - Declarative tables: rates, slabs, thresholds, exemptions (not code-embedded).
  - Deterministic calculators: pure functions over tables; testable, auditable.
  - Official fixture tests: public golden examples; reproducible.
  - No prompts as law: Accounting and compliance law never live only in skill prompts or agent logic.
- **Rule Selection at Decision Time**:
  - Freeze selected rule version and effective date at invoice finalization, payment, or filing.
  - Later rule changes do not rewrite history.
- **Stale/Missing Rules Fail Closed**:
  - Missing rule → FAIL CLOSED with explicit review/block outcome.
  - Stale rule (superseded) → FAIL CLOSED.
  - Ambiguous/conflicting rules → FAIL CLOSED.
  - For drafts and unrelated bookkeeping: continue with visible warning.
- **Tests**:
  - Rule pack loading and versioning working.
  - Effective-date selection correct.
  - Calculations match golden fixtures.
  - Fail-closed behavior on missing/stale rules.
- **Canonical Reference**: [Architecture §11](../architecture.md#rules-and-compliance-architecture).

#### 7.6 Obligation Engine and Filing Deadlines
- **Deliverable**: Obligation derivation, filing deadlines, and predecessor gates.
- **Scope**:
  - Obligation derivation: Tenant/GSTIN/employer facts → set of applicable obligations (GSTR-1, GSTR-3B, GSTR-9, TDS, PF, income-tax, MCA, etc.).
  - Filing deadline rules: Per-obligation effective-dated rule snapshots.
  - Predecessor gates: GSTR-1 before GSTR-3B; GSTR-1 + GSTR-3B before GSTR-9; dependencies explicit.
  - Obligation snapshots: Period, cadence, due-date rule/version, source, predecessor links.
  - Amendment history: Linked to originals (original → amendment lineage).
- **Tests**:
  - Obligations correctly derived for given tenant/GSTIN/employee profile.
  - Filing deadlines calculated correctly from rule snapshots.
  - Predecessor gates enforced (no GSTR-3B before GSTR-1).
  - Amendment history tracked.

#### 7.7 Compliance Transport Boundaries and Exports
- **Deliverable**: Prepare, validate, and export for all settled compliance filings.
- **Scope**:
  - **GSTR-1 (SETTLED)**: Prepare JSON → validate → export → user uploads to portal → evidence recorded.
  - **GSTR-1A (Timing VERIFIED, Transport OPEN RESEARCH)**: Same-period amendments; transport decision deferred.
  - **GSTR-3B (RECOMMENDED Default; Manual Portal)**: Prepare locked working paper → validate → user files via portal → evidence recorded.
  - **E-Invoice (RECOMMENDED; IRP API + Fallback)**: Applicable invoice gated until IRN/QR evidence recorded; transport decision deferred to specific implementation.
  - **E-Way Bill (RECOMMENDED; API + State Rules OPEN RESEARCH)**: Blocking gate for movement only when effective rules require EWB; state rules remain open research.
  - **Other filings (TDS, income-tax, MCA, etc.)**: Prepare/validate/export + manual evidence recording (no auto-filing without specific research and owner approval).
- **All Exports**:
  - Deterministic, reproducible working papers.
  - Local validation before export.
  - No embedded portal automation (manual filing for v1).
  - Evidence recording separate from export (user/CA records portal results).
- **Tests**:
  - GSTR-1 export produces valid portal JSON.
  - GSTR-3B working paper matches manual hand-calculation.
  - E-invoice preparation produces valid structure (if applicable).
  - Same export on all three dialects.
- **Canonical Reference**: [Architecture §11.8](../architecture.md#compliance-transport-boundaries-settled-and-open); [Tentative Decision T-001](tentative-decisions.md#entry-t-001-external-statutory-submissions-workflow—fallback-default-when-no-filing-specific-decision-exists).

### Phase 7 Exit Gate

**Conditions**:

1. **GST accounting**: Tax components, ITC logic, GSTR-1 export working.
2. **TDS/TCS**: Deductions calculated, Form 140/141 generated, deposit tracking working.
3. **Annual income-tax**: Tax computation, Form 26, return filing prep working.
4. **MCA compliance**: Audit applicability, forms generation (or BLOCK if rules missing).
5. **Rules engine**: Effective-dated rule packs loading, fail-closed behavior on missing/stale rules.
6. **Obligation engine**: Obligations derived, deadlines calculated, predecessor gates enforced.
7. **Compliance exports**: GSTR-1, GSTR-3B, TDS, income-tax, MCA exports working.
8. **Tests comprehensive**: Unit tests per module, integration tests for workflows, golden fixtures for tax calculations.
9. **OPEN gates documented**: All unresolved rules (e.g., GSTR-1A transport, e-way bill state rules) marked explicitly; BLOCK actions gated on `source_verified=true` and non-stale rule snapshot.

### Phase 7 Non-Goals

- Auto-filing to government portals (except GSTR-1 manual portal upload boundary).
- Composition scheme (CMP) taxation (deferred).
- SEZ, export credits (deferred).
- Employee portal, payroll-specific statutory reporting detail (deferred).

---

## 11. Phase 8: Skills Runtime and Bounded Skill Execution

**Duration**: 6–8 weeks (estimate).

**Goal**: Implement deterministic skill runtime engine with execution gates, preventing skills from bypassing confirmation, evidence, or compliance gates.

### Phase 8 Prerequisites

1. **Phase 1–7 complete**: Core accounting, compliance, rules engine, and skill contracts.
2. **Phase 2 skill contracts**: Fully specified.
3. **Bounded execution model**: Skills orchestrate CLI commands only; never bypass confirmation or gate logic.

### Phase 8 Scope

#### 8.1 Skill Runtime Engine and Execution Isolation
- **Deliverable**: Skill execution container with command invocation, evidence gathering, and gate enforcement.
- **Scope**:
  - Skill manifest loading (allowlist-based, no arbitrary filesystem execution).
  - Command invocation: Skills invoke CLI commands only (subprocess invocation, no direct domain imports).
  - Evidence gathering and attachment (receipt scanning, external API calls, etc.).
  - Idempotent replay: Skill run state with checkpoints and resume capability.
  - Audit trail: Every skill action logged with actor, source, timestamp, outcome.
- **Bounded Execution**:
  - Skills may invoke only explicitly allowed commands (declared in manifest).
  - Skills never call domain services directly or import domain/persistence code.
  - Skills never bypass confirmation gates, authorization hooks, or evidence requirements.
  - High-consequence operations (period lock, reconciliation approval) require explicit human confirmation; agents/skills cannot auto-approve.
- **Tests**:
  - Skill loads correctly from allowlist.
  - Command invocation works (subprocess communication).
  - Evidence attachment stored correctly.
  - Skill run state persists (resumable after restart).
  - Execution isolation: one skill's failure does not affect others.

#### 8.2 Skill Versioning and Compatibility
- **Deliverable**: Skill version contract with engine and rule-pack compatibility ranges.
- **Scope**:
  - Version ID structure and compatibility ranges (e.g., skill-v1.2.3 compatible with engine v1.0+, rule-pack v2.0+).
  - Deprecation timeline and migration path.
  - Backward-compatibility guarantees (or lack thereof).
  - Skill updates: immutable versioning; no in-place modification.
- **Tests**:
  - Compatibility checks prevent incompatible skill/engine combinations.
  - Version requirements enforced.

#### 8.3 Exception Routes and Remediation
- **Deliverable**: Standardized exception taxonomy and remediation workflows.
- **Exception Classes** (from [Architecture §12.3](../architecture.md#exception-taxonomy)):
  - Validation/blocking (bad input, rule not applicable).
  - Missing evidence (source absent, attachment not found).
  - Ambiguity/selection (multiple candidates, user choice required).
  - Review required (high-consequence action).
  - Retryable external (timeout, temp unavailable).
  - Terminal external (invalid credentials, permanent error).
  - Conflict/lock (concurrent mutation, period locked).
  - Permission denied (RBAC v2+).
  - Internal invariant (ledger corruption, bug).
- **Remediation**:
  - Each exception carries remediation context (candidates for selection, retry-after, required review URL, etc.).
  - Skill execution stops at exception; user/operator resolves and optionally retries.
  - No silent fallbacks; every exception is explicit and routable.
- **Tests**:
  - Exception raised correctly for each condition.
  - Remediation context provided.
  - Skill stops cleanly on exception.

#### 8.4 Skill Manifest and Allowlist Management
- **Deliverable**: Skill manifest schema and allowlist loading.
- **Scope**:
  - Manifest fields: purpose, version, engine compatibility, rule-pack compatibility, prerequisites, inputs, evidence, allowed commands, procedure, validation, automation gate, exception routes, outputs.
  - Allowlist: Explicit skill references with versions and hashes.
  - Loading: Only skills in allowlist are loaded; no auto-discovery.
  - Audit: Skill manifest versions and hashes logged.
- **Tests**:
  - Manifest schema validates all initial skills.
  - Allowlist loading works.
  - Off-allowlist skills rejected.
  - Manifest changes trigger re-validation.

#### 8.5 Deterministic Skill Orchestration (No Autonomous Decisions)
- **Deliverable**: Explicit skill orchestration patterns with deterministic checkpoints.
- **Patterns**:
  - **Sequential**: Skill A completes, then Skill B.
  - **Conditional**: If Skill A outcome = X, then Skill B; if outcome = Y, then Skill C.
  - **Batch**: Skill processes multiple items with per-item outcome tracking.
  - **Resumable**: Checkpoints allow safe restart on partial failure.
- **Gate Enforcement**:
  - High-consequence operations (reconciliation, period lock, payroll finalization) stop before execution; explicit human confirmation required.
  - Skill cannot auto-approve or override gates (return error if not confirmed).
  - Audit trail shows what gate was required and what happened.
- **Tests**:
  - Sequential orchestration works.
  - Conditional routing correct.
  - Batch processing resumes correctly.
  - Gate enforcement prevents skill auto-approval.

### Phase 8 Exit Gate

**Conditions**:

1. **Skill runtime working**: Execution, isolation, evidence gathering.
2. **Skill versioning**: Compatibility checks, deprecation policy.
3. **Exception handling**: All exception types routed to remediation.
4. **Deterministic orchestration**: Workflows with conditional logic, batching, resumption.
5. **Gate enforcement**: Skills cannot bypass confirmation, evidence, or compliance gates.
6. **Tests comprehensive**: Unit tests per skill, integration tests for orchestration patterns.

### Phase 8 Non-Goals

- Machine-learning or autonomous decision-making in skills (deferred).
- Direct web APIs or integrations (deferred; CLI only).
- RBAC enforcement (gates in place, no-op in V1; deferred to V2).

---

## 12. Phase 9: Zoho Migration and Data Import

**Duration**: 4–6 weeks (estimate).

**Goal**: Migrate existing Zoho Books data into agent-bahi using existing fixture, hash verification, and CSV import for 44 CSV files and 966 rows (validated test set).

### Phase 9 Prerequisites

1. **Phase 1–8 complete**: All core features, accounting, compliance, and skills working.
2. **Zoho parity verified**: [Zoho Frappe Parity](zoho-frappe-parity.md) documentation complete.
3. **Migration fixtures**: Existing fixture data (44 CSV files, 966 rows) prepared and hashed.
4. **Not shaping canonical model**: Zoho import uses existing canonical model; does not bend agent-bahi design to fit Zoho quirks.

### Phase 9 Scope

#### 9.1 Zoho Data Export and Fixture Preparation
- **Deliverable**: Zoho Books export in standard format (CSV files).
- **Scope**:
  - 44 CSV files extracted from Zoho Books (accounts, invoices, bills, payments, expenses, etc.).
  - 966 test rows (validated representative sample).
  - Hash-verified fixture (content-addressed, immutable).
  - Schema mapping: Zoho fields → agent-bahi fields documented.
- **Tests**:
  - CSV files parse correctly.
  - All 966 rows present.
  - Hash matches (integrity verified).

#### 9.2 Data Transformation and Mapping
- **Deliverable**: Transformation logic from Zoho schema to agent-bahi schema.
- **Scope**:
  - Account mapping: Zoho account → agent-bahi account (chart of accounts alignment).
  - Contact mapping: Zoho customer/supplier → agent-bahi contact.
  - Document mapping: Zoho invoice/bill → agent-bahi invoice/bill (document state, lines, tax, etc.).
  - Amount mapping: Zoho currency, amounts → agent-bahi base currency, exact decimal math.
  - Date mapping: Zoho date format → agent-bahi accounting date (immutable, no timezone reinterpretation).
  - Tax mapping: Zoho tax components → agent-bahi tax components (GST, TDS, etc.).
- **Non-Shaping Principle**:
  - Transformation works with agent-bahi's canonical model; never bends model to match Zoho quirks.
  - Unsupported Zoho features (e.g., inventory, manufacturing, third-party integrations) are skipped or logged.
  - Audit trail: Every transformation logs source Zoho record, target agent-bahi record, transformation decisions.
- **Tests**:
  - All 966 rows transform successfully (or explicitly fail with reason if unsupported).
  - Amounts are exact (no rounding or precision loss).
  - Balances preserved (GL balance in Zoho = GL balance in agent-bahi after import).
  - No Zoho data lost (audit trail complete).

#### 9.3 Migration Validation and Reconciliation
- **Deliverable**: Post-import validation and reconciliation against Zoho.
- **Validation**:
  - Record counts match (invoices, bills, payments, journal entries, etc.).
  - GL balances match (sum of postings in agent-bahi = sum of postings in Zoho).
  - AR/AP aging matches (invoiced amounts, paid amounts, open balances).
  - Cash balance matches (bank account balance).
  - Tax summary matches (GST, TDS calculated correctly).
- **Tests**:
  - All counts reconcile.
  - All balances reconcile (within tolerance for rounding).
  - No orphaned records.

#### 9.4 Fixture-Based Deterministic Test Suite
- **Deliverable**: Test suite using existing Zoho fixture (44 files, 966 rows).
- **Tests**:
  - Import → validate → produce trial balance; compare to Zoho.
  - Multi-run idempotency: Re-import same fixture produces same result (no duplicate postings).
  - Cross-dialect: Same import produces same result on SQLite, PostgreSQL, MySQL.
  - Error handling: Missing required fields, invalid data detected and reported.

### Phase 9 Exit Gate

**Conditions**:

1. **Zoho export**: 44 CSV files, 966 rows, hash-verified.
2. **Transformation**: All fields mapped, unsupported features skipped with audit trail.
3. **Migration validation**: Record counts, GL balances, AR/AP aging, cash, tax all reconciled.
4. **Test suite passing**: Fixture import, validation, cross-dialect tests all pass.
5. **Data integrity**: No loss, no modification of canonical model to fit Zoho quirks.

### Phase 9 Non-Goals

- Ongoing sync with Zoho (one-time migration only).
- Zoho feature parity (only supported agent-bahi features imported).
- Inventory, manufacturing, or third-party features (skipped).

---

## 13. Cross-Cutting Acceptance Criteria (All Phases)

### 13.1 Deterministic Behavior and Idempotency

All operations are deterministic and idempotent:
- Same request ID always produces same result.
- No non-deterministic ordering (pagination deterministic, timestamps immutable).
- No silent retries or best-effort behavior.

**Tests**: Idempotency tests for every command; replay same request 10 times, verify same result.

### 13.2 Tenant and GSTIN Isolation

Every operation scoped to exactly one tenant and (if applicable) one GSTIN:
- Cross-tenant leaks prevented (repositories require TenantContext).
- GSTIN ambiguity detected explicitly (fail on >1 applicable GSTIN).
- No shared data between tenants.

**Tests**: Multi-tenant tests; attempt to query/mutate other tenant's data; verify rejection.

### 13.3 Immutability and Audit Trail

Posted documents and ledger entries never mutable directly; only reversals and corrections allowed:
- Document history preserved (Draft → Posted → Settled).
- Reversal lineage immutable and audit-linked.
- Every mutation logged (actor, source, timestamp, change summary).

**Tests**: Attempt to edit posted document; verify error and reversal instruction. Verify audit records created for every mutation.

### 13.4 Silent Failure Prevention

No silent failures; all material decisions visible and auditable:
- Debit-credit imbalance detected (fail, not silently fix).
- Duplicate retries detected (fail or return cached result, not silently repost).
- Number reuse prevented (gap records maintained).
- Stale rules fail closed (not silently use old rule).
- Ambiguity detected (fail, not silently choose).

**Tests**: Silent failure test suite covering all items in [Architecture §2](../architecture.md#silent-failures-to-prevent-most-damaging-first).

### 13.5 Compliance Gates and Review Blocks

Stale/missing rules block affected actions only; unrelated work proceeds:
- Missing rule → BLOCK affected compliance action with `source_verified=true` and non-stale rule-snapshot gate.
- OPEN/TENTATIVE rules → visible OPEN gate; actions routed to explicit review/block.
- Unrelated bookkeeping proceeds (e.g., draft entry, validated reconciliation).

**Tests**: Missing rule scenario; verify correct action blocked, unrelated actions proceed.

### 13.6 Evidence and Evidence Links

Every material decision has supporting evidence:
- Evidence content-addressed and immutable.
- Audit records link to evidence (hashes, references).
- Evidence attached to documents and postings.

**Tests**: Post document with evidence; verify evidence accessible, hashes correct, audit records linked.

### 13.7 Cash and Accrual Basis Awareness

Reports and exports respect basis parameter:
- Default basis from tenant settings.
- Accept optional `--basis cash|accrual` parameter.
- Output shows effective basis.
- Fixed-basis reports reject inapplicable basis flag.

**Tests**: Generate P&L on cash basis, then accrual basis; verify results differ correctly. Reject invalid basis for fixed-basis report.

### 13.8 Multi-Dialect Conformance

Same operation produces identical result on SQLite, PostgreSQL, MySQL:
- Same logical schema on all three.
- Same query results on all three.
- Full-replay produces identical final state on all three.
- Deterministic pagination and ordering.

**Tests**: Full-replay test suite; execute all Phase 1–9 operations on all three dialects; verify binary equality of key tables.

### 13.9 Exit-Code Taxonomy

Commands return stable exit codes enabling shell automation:
- 0 = success
- 1 = validation error
- 2 = ambiguity
- 3 = conflict
- 4 = compliance gate
- 5 = retryable external
- 6 = terminal external
- 7 = permission denied
- 8 = internal error
- TBD = partial success (non-zero)

**Tests**: Every exception type maps to correct exit code.

### 13.10 No Hardcoded Values, No Implicit Defaults

All compliance, tax, and business rules are:
- Declared in effective-dated rule packs (not code-embedded).
- Versioned and immutable.
- Fail closed if missing/stale.
- Never inferred or assumed.

**Tests**: Verify all tax rates, rule thresholds come from rule packs, not hardcoded constants.

### 13.11 Skill Boundaries and Gate Enforcement

Skills conform to contracts; cannot bypass gates:
- Skills invoke CLI commands only (no direct domain calls).
- Skills cannot auto-approve high-consequence actions.
- Reconciliation requires explicit human confirmation (not agent confidence heuristic).
- Audit trail shows gate status and skill action.

**Tests**: Skill attempts to approve reconciliation without human confirmation; verify rejection.

### 13.12 No Agent Autonomous Decisions

Agents invoke deterministic CLI; never make business decisions:
- Agents orchestrate skills and commands.
- Rules and gates provided by deterministic rules engine, not agent logic.
- High-consequence operations blocked until explicitly confirmed by human.
- Ambiguity routes to human review (not agent best-guess).

**Tests**: Verify agent prompts do not include accounting rules or tax logic; all decisions driven by rules engine.

### 13.13 Backward-Compatibility and Upgrade Path

Schema migrations work forward:
- Fresh install works.
- Every upgrade path tested (v1.0 → v1.1 → v1.2, etc.).
- No data loss or silent schema changes.
- Rollback path documented (if applicable).

**Tests**: Upgrade path tests for all schema versions.

---

## 14. Deferred Work (Explicitly Out of Scope for V1, with Preservation of Extensibility)

### 14.1 Inventory Engine
- **Deferred**: No stock tracking, warehouses, valuation, batches, serials, manufacturing.
- **Preserved**: Document lines carry quantity, unit, rate, tax treatment, account reference; structure permits future inventory integration without schema change.

### 14.2 RBAC Implementation
- **Deferred**: Authorization hooks present and no-op for V1; full RBAC deferred to V2.
- **Preserved**: Actor, source, permission context threaded through every mutation; audit trail ready for RBAC audit.

### 14.3 Direct Government Auto-Filing
- **Deferred**: Each filing (GST, TDS, income-tax, MCA, e-invoice, e-way bill) requires separate research and owner-approved decision.
- **Settled boundary**: GSTR-1 only (prepare/validate/export + manual portal + evidence recording).
- **Preserved**: Export/manual-upload infrastructure ready for future filing-specific adapters.

### 14.4 Employee Portal
- **Deferred**: No employee self-service.
- **Preserved**: Payslips and employee outputs generated for external delivery; structure permits future portal without ledger changes.

### 14.5 Attendance/Leave/HRMS
- **Deferred**: No system of record for employee time.
- **Preserved**: Payroll accepts approved summarized inputs (payable days, LOP, overtime); integration point defined for future HRMS import.

### 14.6 Intercompany and Cross-Tenant Posting
- **Deferred**: No atomic cross-tenant transactions.
- **Preserved**: Mistaken inter-entity payments represented separately in each tenant with explicit due-to/due-from or correction journals only when user records them.

### 14.7 Composition Scheme Taxation
- **Deferred**: CMP-08 and GSTR-4 out of scope.
- **Preserved**: Effective-dated rule engine structure supports future composition-scheme rule pack.

---

## 15. Testing and Validation Strategy

### 15.1 Test Taxonomy

- **Unit tests**: Domain logic, calculators, validation rules (phase per module).
- **Integration tests**: End-to-end workflows (invoice → payment → reconciliation).
- **Multi-dialect tests**: Same test run on SQLite, PostgreSQL, MySQL; verify identical results.
- **Golden fixtures**: Zoho migration fixture (44 files, 966 rows) and hand-calculated tax examples.
- **Silent failure tests**: Verify all [Architecture §2](../architecture.md#silent-failures-to-prevent-most-damaging-first) scenarios detected and blocked.
- **Compliance gates tests**: Verify OPEN rules block affected actions only; unrelated work proceeds.
- **Skill boundary tests**: Verify skills cannot bypass confirmation, evidence, or compliance gates.

### 15.2 Coverage Target

- **Unit test coverage**: ≥80% of domain and application code (by line).
- **Integration test coverage**: Every Phase 1–9 workflow end-to-end.
- **Multi-dialect coverage**: Every integration test runs on all three dialects.
- **Golden fixture coverage**: 100% of Zoho fixture (44 files, 966 rows) reconciles.

### 15.3 Deterministic Test Execution

- **No flaky tests**: All tests deterministic and repeatable (no random data, no time-dependent assertions).
- **No test dependencies**: Each test independent; order-insensitive.
- **Deterministic ordering**: Results sorted before comparison (no ordering assumptions).

---

## 16. Build, Distribution, and Deployment

### 16.1 Build Artifacts

- **Source**: TypeScript source in repository.
- **Build**: `bun:build` to ESM.
- **Artifacts**: Executable binary and package/bin fallback.
- **Platforms**: macOS arm64, Linux x64/arm64 (proof spikes validate).

### 16.2 Distribution

- **npm package**: Installable via `npm install -g agent-bahi` or as dependency.
- **Binary distributions**: Pre-compiled for target platforms (optional; package fallback always available).
- **Versioning**: Semantic versioning (major.minor.patch).

### 16.3 Database Setup

- **SQLite**: Automatic initialization (schema created on first run if database not present).
- **PostgreSQL/MySQL**: User provides connection string; schema created on first run.
- **Migrations**: Automatic schema migration on startup (if schema version mismatch).

### 16.4 Configuration and Secrets

- **Configuration**: Environment variables or `.agent-bahi/config.json` (gitignored).
- **Secrets**: Vault integration (future); environment variables for v1.
- **No credentials in logs or exports**: Redaction layer in place.

---

## 17. Documentation and Knowledge Transfer

### 17.1 User Documentation

- **CLI help**: Auto-generated from command registry (`--help` for every command).
- **User guide**: Workflow tutorials (invoice, bill, payment, expense, payroll, GST, reconciliation, close).
- **Rule packs**: Documentation for every effective-dated rule (rates, thresholds, applicability).
- **Skill manifests**: Published skill contracts with prerequisites, inputs, outputs, exception routes.

### 17.2 Developer Documentation

- **Architecture**: This plan plus [Pre-Implementation Architecture](../architecture.md).
- **Data model**: [Accounting Contracts](accounting-contracts.md) and [Data Model Requirements](data-model-requirements.md).
- **Compliance**: [GST Compliance Matrix](gst-compliance-matrix.md), [TDS/TCS Compliance Matrix](tds-tcs-compliance-matrix.md), [Annual Income-Tax Compliance Matrix](annual-income-tax-compliance-matrix.md), [MCA Companies Act Compliance Matrix](mca-companies-act-compliance-matrix.md).
- **Compliance transport**: [Statutory Workflow Contracts](statutory-workflow-contracts.md).
- **Skill architecture**: [Skill Architecture](skill-architecture.md) (expanded with implementation guide).
- **Setup guide**: Bun, workspace, dependency installation, local development.

### 17.3 Operator and Auditor Documentation

- **Auditor guide**: Evidence export, control testing, audit trails, reconciliation procedures.
- **Operator runbook**: Common tasks, troubleshooting, backup/restore, multi-dialect deployment.
- **CA guide**: Statutory filing procedures, compliance exports, amendment handling.

---

## 18. Tentative Decisions and Owner Review Gates

Every entry in [Tentative Decisions](tentative-decisions.md) is explicitly marked **NOT OWNER-APPROVED**. Implementation proceeds only after owner confirmation or explicit override.

Key entries:

- **T-001**: External statutory submissions fallback (prepare/validate/export + manual portal for all filings without specific boundary).
- **T-002**: Frappe Books reference only (no code reuse; license decision deferred).
- **T-003**: Fixed-asset depreciation methods (SLM default; reversible; not an authorization).
- **T-004**: ORM selection (Drizzle primary, Kysely fallback).
- **T-005**: CLI parser selection (Clipanion primary).
- **T-006**: Numeric approval thresholds (DEFERRED; tests must not assume).

---

## 19. Document Validation and Cross-References

### 19.1 Relative Link Validation

All links in this document reference existing canonical docs:
- ✓ [Pre-Implementation Architecture](../architecture.md)
- ✓ [Provisional Architecture Decisions](architecture-decisions.md)
- ✓ [Discovery Decisions](decisions.md)
- ✓ [Data Model Requirements](data-model-requirements.md)
- ✓ [Accounting Contracts](accounting-contracts.md)
- ✓ [Statutory Workflow Contracts](statutory-workflow-contracts.md)
- ✓ [Tentative Decisions](tentative-decisions.md)
- ✓ [Skill Architecture](skill-architecture.md)
- ✓ [Roadmap](roadmap.md)
- ✓ [GST Compliance Matrix](gst-compliance-matrix.md)
- ✓ [TDS/TCS Compliance Matrix](tds-tcs-compliance-matrix.md)
- ✓ [Annual Income-Tax Compliance Matrix](annual-income-tax-compliance-matrix.md)
- ✓ [MCA Companies Act Compliance Matrix](mca-companies-act-compliance-matrix.md)
- ✓ [Zoho Frappe Parity](zoho-frappe-parity.md)
- ✓ [Payroll Scope](payroll-scope.md)
- ✓ [Zoho Backup Fixture](zoho-backup-fixture.md)

### 19.2 Cross-Reference Consistency

This plan does not contradict any settled decisions in [Discovery Decisions](decisions.md) or core principles in [Pre-Implementation Architecture](../architecture.md).

---

## 20. Summary and Sign-Off Gates

This implementation plan is **specification-level** and does not authorize implementation.

### Sign-Off Checklist (For Sudhanshu)

- [ ] Review and confirm [Pre-Implementation Architecture](../architecture.md) (or override RECOMMENDED entries with new decisions).
- [ ] Review and confirm all [Tentative Decisions](tentative-decisions.md) (or override with new decisions).
- [ ] Confirm proof-spike specifications (STK-001 through STK-006) and timeline.
- [ ] Confirm phasing (Gate0, Phases 1–9) and sequencing.
- [ ] Confirm deferred work list (inventory, RBAC, auto-filing, portal, HRMS, intercompany).
- [ ] Confirm acceptance criteria and test strategy.
- [ ] Authorize Phase 1 implementation start (after proof spikes pass).

### Implementation Readiness Gate

All of the following must be satisfied before Phase 1 code begins:

1. ✓ Gate0 proof spikes complete and successful.
2. ✓ Architecture document reviewed and confirmed.
3. ✓ All tentative decisions reviewed and confirmed (or overridden).
4. ✓ Owner authorization to begin Phase 1 implementation.

---

**Document Version**: 1.0
**Last Updated**: 2026-08-21
**Author**: Agent
**Status**: Awaiting owner review and approval for implementation gate.
