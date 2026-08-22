# Post-Discovery Readiness Packet

**Status**: TENTATIVE — NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED; NO IMPLEMENTATION AUTHORIZATION

This packet synthesizes existing canonical discovery documents and identifies the concrete gates separating Discovery Complete from Architecture Ready and Implementation Authorized. It records the current state, the critical dependency path, unresolved architecture decisions requiring architect review, the evidence docket for Gate0 proof spikes, and the tentative phased slices with acceptance criteria and fail-closed boundaries.

**Canonical References**: This document links existing canonical specs rather than duplicating them. Readers should follow the file:line anchors to the authoritative source for each decision, contract, matrix, and requirement.

---

## 1. Verdict and Definitions

### Discovery Complete ✓

**Definition**: T-001 through T-011 owner approvals finalized; PT-001 through PT-016 (16 personal-tax decisions) owner-approved; verified statutory baseline collected; canonical contracts documented.

**Actual State**:
- [Owner Review Docket](owner-review-docket.md): T-001–T-011 **OWNER-APPROVED** (binding frameworks for external filing, Frappe reference, depreciation, FX, V1 scope, batch codes, full income-tax, corrections, Form 140/141, post-filing cases, TypeScript+Bun)
- [Personal Tax Discovery Packet](personal-tax-scope.md): PT-001–PT-016 **OWNER-APPROVED; NOT ARCHITECT-REVIEWED** (individual/PAN tenant, BookSet independence, inter-BookSet transfers, subledgers, TaxCase lifecycle, form selection, rule immutability, external sources, hashed files, readiness catalog, GST routing, TDS/TCS, portal labels, explicit IDs, privacy/secrets, correction lineage)
- [Verified Baseline § 2](personal-tax-scope.md#2-verified-official-baseline): Taxpayer/period/form boundary, information statements (AIS/TIS/26AS), acquisition authority (file-first, no credentials, AA future), every legal choice loads from immutable effective-dated official rule/schema snapshots
- [Current Product Interplay § 3](personal-tax-scope.md#3-current-product-interplay): One legal entity = one tenant; personal/proprietorship extension is a breaking data-model change; owner approval recorded but architect review and migration gates remain outstanding
- [Accounting Contracts](accounting-contracts.md): Pre-implementation domain contracts (posting templates, CLI errors, evidence, acceptance scenarios) finalized
- [Statutory Workflow Contracts](statutory-workflow-contracts.md) + [GST Matrix](gst-compliance-matrix.md), [TDS/TCS Matrix](tds-tcs-compliance-matrix.md), [Annual Income-Tax Matrix](annual-income-tax-compliance-matrix.md), [MCA Matrix](mca-companies-act-compliance-matrix.md): Verified official compliance baselines and workflows recorded

### Architecture Ready ✗ (Three Distinct Outstanding Gates)

**Definition**: Tenant/PAN/BookSet data model reviewed and approved by architect; personal-tax physical-schema RFC approved; Gate0 proof spikes complete; explicit Phase 1 authorization received.

**Current State**:
1. **Personal-Tax Contract CLEAN Review**: [personal-tax-physical-schema.md](personal-tax-physical-schema.md) records dialect-neutral relational contract (tenants, book_sets, accounts, journal_entries, postings, bookset_transfers, income_periods, rule_snapshots, official_artifacts) with ownership rules, transaction gates, and Gate0 proof obligations. **Status: NOT ARCHITECT-REVIEWED**. Architect must verify the contract satisfies tenant isolation, BookSet-level authorization/mutation scope (exact PT-014 fail-closed gates), personal BookSet uniqueness enforcement (full-history guard; no partial/active-only rules), GSTIN/BookSet mapping invariants, atomic inter-BookSet transfer mechanics (PT-003), and TaxCase composition without ledger merging. Silent failure consequence: BookSet leak, personal data visible cross-tenant or cross-BookSet, duplicate personal tenants, ambiguous transfer legs, omitted proprietorship in TaxCase.

2. **Architect Review—Tenant/PAN/BookSet Model**: Architect must settle exact questions and approve the recommended three-option review candidate:
   - **Recommended candidate (A)**: One individual/PAN tenant contains exactly one personal BookSet (lifetime) + multiple sole-proprietorship BookSets; companies remain separate tenants. Preserves no-cross-tenant product-query/write rule. Personal/business settlement atomic. TaxCase enumerates all BookSets; marks itself STALE when membership changes; blocks omissions. [Apprentice debate record](personal-tax-scope.md#apprentice-debate-record): A vs. B (privileged cross-tenant PAN aggregation) vs. C (non-posting personal workspace). Outcome: **A**. Mandatory safeguards before implementation: BookSet-level actor/resource authorization from day one (CA granted one business BookSet cannot read personal by default); every BookSet-owned row carries `tenant_id` + `book_set_id` (each independently balances); BookSet-scoped mutations fail with `AMBIGUOUS_BOOKSET` when not explicit; TaxCase source/BookSet catalog not empty/`UNKNOWN` (exactly one personal BookSet across tenant lifetime, including archived state; replacement preserves identity); Gate0 scenarios prove personal-paid business expense, drawing/loan transfer, new BookSet mid-year staleness, business-only CA access cannot read personal.
   - **Alternative (B)**: Separate personal and business BookSets in separate tenants aggregated by privileged PAN registry (read-only snapshot authority). Requires privileged cross-tenant exception; harder authorization boundary; separate tenants simplify single-book mutations but require two independent successful postings for same-tenant settlement.
   - **Rejected for PT-001**: Non-posting personal evidence workspace (C). Either creates second accounting engine or collapses into A/B. Personal banks, investments, property, loans require canonical balances and reconciliation.
   - **Exact architect decision questions**: Does the recommended A model, with explicit BookSet authorization threading and fail-closed mutation scope, satisfy the audit/isolation guarantees? Can the personal BookSet identity uniqueness guard be enforced full-history (including archived) at the database relationship level? If Gate0 cannot prove fail-closed BookSet authorization/isolation, or migration would require weakening canonical ledger invariants, does the architect recommend reverting to B with explicit PAN registry?

3. **Gate0 Proof Spikes Not Authorized**: [Implementation Plan § Gate0](implementation-plan.md#gate0-proof-spikes-hard-blocker-before-phase-1) records STK-001–STK-006 mandatory evidence. **Current state: NOT AUTHORIZED**. After Sudhanshu reviews [Owner Review Docket](owner-review-docket.md), his explicit direction/authorization is required. Gate0 supplies mandatory evidence before implementation; it does not authorize Phase 1 or approve libraries. A blocker discovered during/after Gate0 stops affected work and requires new owner decision.

### Implementation Authorized ✗

**Definition**: Gate0 complete with evidence; architect review closed; Phase 1 explicitly authorized by owner; remaining prerequisites met.

**Current State**: Awaiting Gate0 run authorization, architect contract review, and explicit Phase 1 owner decision.

---

## 2. Critical Path and Dependency Graph

### Minimum Path to Implementation

```
CURRENT STATE
  ├─ T-001..T-011 owner-approved ✓
  └─ PT-001..PT-016 owner-approved ✓
      │
      ├─ Personal-tax-physical-schema RFC review (architect) ← BLOCKER #1
      │   └─ Architect decision: A/B/C model, BookSet isolation proof gates
      │
      ├─ Gate0 proof spikes authorization (owner) ← BLOCKER #2
      │   └─ STK-001..STK-006 complete
      │       └─ Bun runtime + platform targets
      │       └─ SQLite/PostgreSQL/MySQL driver proof
      │       └─ Schema migrations on all dialects
      │       └─ Bun build + single-file executables (no Node/Bun subprocess)
      │
      └─ Architect review: personal-tax contract CLEAN (architect) ← BLOCKER #3
          └─ BookSet isolation, mutation scope, uniqueness, transfer mechanics, TaxCase composition
```

### Phase-Scoped Prerequisites

Each phase depends on the prior phase's exit gate **and** its applicable owner-approved T-/PT-decisions:

| Phase | Prerequisites | Exit Gate | Decisions |
|-------|---------------|-----------|-----------|
| Gate0 | Owner authorization | All STK-001..006 spikes pass; Bun version recorded | T-011 (TypeScript+Bun selected; not implementation authorization) |
| Phase 1 | Gate0 complete; physical-schema RFC reviewed; Phase 1 decisions approved; explicit Phase 1 authorization | Tenant/GSTIN isolation contract; command registry; migration strategy proven | T-001..T-011 (gate this phase only where they apply) |
| Phase 2 | Phase 1 complete | Skill contract schema complete; 14-skill catalog declared | Phase 1 skills only; no forward references except marked DEFERRED |
| Phase 3 | Phase 1–2 complete | Document lifecycle complete; posting engine working; postings immutable/balanced | T-006 (batch partial-success), T-008 (corrections/deletions), PT-003 (inter-BookSet transfers) |
| Phase 4 | Phase 1–3 complete | Bank import/reconciliation proposals; evidence linking complete | T-001 (evidence recording in prepare/validate/export pattern) |
| Phase 5 | Phase 1–4 complete | P&L/BS/aging/FX/assets reports; employee-expense workflows | T-003 (depreciation), T-004 (FX), PT-004 (personal subledgers) |
| Phase 6 | Phase 1–5 complete | Payroll finalization; statutory deductions; Form 16 draft | T-007 (full income-tax scope includes payroll) |
| Phase 7 | Phase 1–6 complete | GSTR-1/3B/2B; TDS/TCS; annual income-tax; corrections lineage | T-001 (filing fallback), T-007/T-009/T-010 (income-tax), PT-005..PT-016 (personal-tax compliance including PT-011 GST routing) |
| Phase 8A | Phase 7 complete | PostgreSQL/MySQL proven; schema migrations/upgrades on all dialects; release executables | SQLite default; multi-dialect proof; no Node/Bun subprocess |
| Phase 8B | Phase 8A complete | Bounded skills runtime; skill versioning; deprecation gates | Skills invoke CLI only via registry; no direct domain/persistence import |
| Phase 9 | Phase 8 complete; architect sign-off | Zoho import feature complete; imported books reconciled with live books; migration proof | T-002 (Frappe reference only); no import-driven model changes |

### Witness Dependencies (Not Blocking)

These arc across multiple phases but do not block phase start:

- **Rule snapshot versioning** (architected Phase 1, implemented Phase 7): Every rule pack binds immutable version, effective dates, content hash, governing Act, filing trigger. TaxCase binds exact rule-snapshot tuple. Missing/stale/conflicting rules fail REVIEW/BLOCK at Phase 7 compliance gates.
- **Evidence content-addressing and immutability** (architected Phase 1, implemented Phase 4): Every evidence link preserves hash verification and metadata. Evidence archive-only (append, never overwrite). Corrections use reversal + replacement lineage.
- **Audit trail threading** (architected Phase 1, implemented across all phases): Actor, source, reason, timestamp, versioning bound to every mutation. No silent changes.

---

## 3. Tenant/PAN/BookSet Architecture Review Candidate

### Recommended Option (A): One PAN Tenant with Independent BookSets

**Specification**: One individual/PAN tenant may contain exactly one personal BookSet (immutable identity across tenant lifetime, including archived state) plus multiple independently balanced sole-proprietorship BookSets. Companies remain separate legal-entity tenants. BookSet-owned rows carry `tenant_id` + `book_set_id`; each BookSet independently balances. Cross-BookSet movement is represented by linked entries (PT-003 atomic transfer), never shared balances.

**Invariants** (architect must verify these are enforced at database level; see [personal-tax-physical-schema.md § 2.2](personal-tax-physical-schema.md#22-book_sets)):
- Exactly one personal BookSet per PAN tenant across full history (including archived rows). UNIQUE constraint full-history, never partial/active-only. Personal BookSet identity preserved across replacement/migration. Duplicate personal creation fails.
- GSTIN→BookSet mapping: Canonical data-model requirements allow multiple GSTIN registrations within an entity scope; GSTIN cardinality (one-per-BookSet, many-per-BookSet, or tenant-wide) remains architect-unresolved. Architect must settle the exact GSTIN uniqueness constraint and mapping mechanics during contract review.
- Per-BookSet balance enforced: Every posting belongs to exactly one BookSet; debit=credit verified after rounding within each BookSet independently.
- Explicit mutation scope: BookSet-scoped mutations (create/edit/post/transfer) require explicit `book_set_id` in context; automatic resolution when one candidate exists is never performed. Engine returns `AMBIGUOUS_BOOKSET` if context omitted.
- TaxCase membership: TaxCase enumerates all BookSets inside the PAN tenant. Updates to BookSet membership (new BookSet created mid-year, archived, activated) mark TaxCase `STALE` and require deliberate reconciliation before filing snapshot.
- Atomic personal→proprietorship transfers: PT-003 linked-leg mechanics bind purpose classification, evidence, and both legs in one atomic transaction.
- Companies excluded: Only individual/PAN tenants can have personal BookSets. Company tenants cannot contain personal or proprietorship BookSets. Sole proprietorship implies same individual legal person as the personal BookSet; companies are separate legal entities.
- Future RBAC at BookSet resource: Authorization threads BookSet context (tenant + book_set_id) from CLI through application services. CA granted `read:personal_bookset` cannot see proprietorship or other BookSets without explicit per-BookSet grant. RBAC implementation deferred but schema boundaries and authorization hooks must support this.

**Mandatory Pre-Implementation Safeguards** ([personal-tax-scope.md § Apprentice debate record](personal-tax-scope.md#apprentice-debate-record)):
1. BookSet-level actor/resource authorization from day one; CA granted one business BookSet cannot read personal by default.
2. Every BookSet-owned row carries explicit `tenant_id` + `book_set_id`; each BookSet independently balances.
3. BookSet-scoped mutations fail with `AMBIGUOUS_BOOKSET` when not explicit; tenant-wide status/TaxCase aggregation is read-only and separately authorized.
4. TaxCase source/BookSet catalog cannot be empty/UNKNOWN; exactly one personal BookSet across tenant lifetime (including archived); replacement/migration preserves identity.
5. Gate0 scenarios prove:
   - Personal-paid business expense posted correctly to proprietorship BookSet (not personal).
   - Proprietor drawing/loan transfer atomic with evidence binding.
   - New BookSet created mid-year; TaxCase marked STALE; deliberate reconciliation before filing snapshot required.
   - Business-only CA access cannot read personal data even via TaxCase or aggregation queries.

**Silent Failure Consequences if Safeguards Fail**:
- Personal data leaked to business-scoped CA.
- Proprietorship omitted from TaxCase because it exists in separate tenant/BookSet.
- Duplicate personal BookSets created.
- Transfer legs posted independently without atomic commitment.
- Stale TaxCase silently filed without detecting mid-year BookSet membership change.

**Architect Decision Points**:
1. Does the database schema enforce exactly-one personal BookSet as a full-history uniqueness constraint (not partial/active-only)?
2. Can BookSet authorization scope be threaded from CLI through application layers without requiring privileged cross-BookSet aggregation?
3. Are the PT-003 transfer mechanics (atomic dual-leg commitment, shared purpose, evidence binding) expressible in the candidate ORM/migration framework?
4. Does the candidate physical schema permit TaxCase to query all member BookSets without requiring privileged access or violating the no-cross-tenant rule?

---

### Alternative (B): Separate Personal/Proprietorship Tenants with Privileged PAN Registry

**Specification**: Separate tenants for personal and each proprietorship; one privileged PAN registry aggregates them (read-only snapshot authority). Privileges bypass the no-cross-tenant product-query rule for TaxCase and filing snapshot construction.

**Trade-offs**:
- **Advantage**: Simpler single-book mutations; harder authorization boundary between personal and business; no BookSet lifetime identity management.
- **Disadvantage**: Requires privileged exception to the canonical no-cross-tenant rule; same-tenant atomic transfers (PT-003) now require two independent successful postings; PAN registry becomes a separate service/schema; if aggregate query fails or registry stales, TaxCase may omit a proprietorship.

**Architect Review Trigger**: If option A cannot enforce full-history personal BookSet uniqueness at the database level, or if BookSet authorization proves impractical to thread, architect may recommend B with explicit privileged registry, even though it weakens the canonical isolation guarantee.

---

### Rejected for PT-001: Non-Posting Personal Workspace (Option C)

**Specification**: Non-posting evidence workspace for personal records (no double-entry ledger); separate posting tenants for proprietorships. TaxCase aggregates.

**Why Rejected**: Personal banks, investments, property, loans require canonical balances and reconciliation (PT-004). A non-posting workspace either creates a second accounting engine (breaks the canonical ledger) or collapses into A/B (personal+business same system).

---

## 4. Gate0 and Database Migration Evidence Docket

### STK-001 through STK-006: Proof Spike Purposes and Artifacts

| Spike | Purpose | Evidence Required | Target Platforms |
|-------|---------|------------------|------------------|
| STK-001 | Bun-native runtime, workspaces, lockfile | Exact Bun version, `bun --revision`, artifact checksums, lockfile/CI/release pins. Resolve the authoritative latest stable Bun release at Gate0; do not hard-code guessed current version. | macOS arm64, Linux x64/arm64 |
| STK-002 | Persistence driver candidates (Drizzle, Kysely, better-sqlite3 on bun-sqlite, PostgreSQL, MySQL) | Proof that candidate driver works on Bun; schema equivalence across SQLite/PostgreSQL/MySQL verified. Only if Bun-native first is insufficient. | All dialects |
| STK-003 | SQLite pragmas, WAL, foreign_keys=ON, SQLITE_BUSY handling, network-filesystem rejection | Configuration proof; busy-loop behavior under contention; failure mode on network FS documented. | macOS arm64, Linux x64/arm64 |
| STK-004 | Schema migrations and upgrade paths on all three dialects | Proof that migrations apply consistently; rollback/downgrade behavior recorded; mixed-version client failure modes documented. | SQLite, PostgreSQL, MySQL |
| STK-005 | Bun-native parser, validation, exact decimal APIs first; proof-gate Clipanion, Zod, decimal.js if needed | INR/paise exact-decimal arithmetic verified (e.g., ₹1.23 + ₹4.56 = ₹5.79 exactly, no floating-point drift). FX and tax decimals tested. | All platforms |
| STK-006 | Bun build + one single-file executable per target platform; MySQL/PostgreSQL drivers bundled if needed | Executable must not require or invoke separately installed Node runtime, Node subprocess, Node lifecycle hook, separately installed Bun runtime, Bun subprocess, or Bun lifecycle hook. Proof-gated third-party packages may be bundled. macOS arm64 and Linux x64/arm64 single-file executables produced; checksums recorded. | macOS arm64, Linux x64/arm64 |

### Database Compatibility and Migration Policy (Owner-Stated Concern; Tentative Recommendation)

**Owner-Stated Concern** ([Architecture § Dependency inward](../architecture.md#dependency-inward-architecture)): Local SQLite default, PostgreSQL and MySQL adapters supported; driver, migrations, conformance, and target-platform proofs mandatory before release.

**Tentative Recommended Migration Matrix** (Architect decides final policy):

| Scenario | Pre-Operation | Mid-Operation | Post-Operation | Rollback |
|----------|---------------|---------------|----------------|----------|
| **SQLite local** | Explicit check: database locks, backup, transaction recovery | No mid-migration schema changes; fail-closed on SQLITE_BUSY | Auto-VACUUM, analyze if needed | Restore from backup; no downgrade |
| **PostgreSQL remote** | Explicit check: DB-wide lease acquired; maintenance mode barrier raised; no concurrent clients; backup | No mid-migration; fail-closed on connection loss | Mixed-client versions fail-closed (old client reads new schema safely, new client reads old schema may find UNKNOWN columns; error message guides operator) | Downgrade unresolved (architect decides: reverse migrations or manual rollback script per deployment) |
| **MySQL remote** | Explicit check: DB-wide lease; binary log backups; mixed-version clients identified | No mid-migration | Mixed-client versions behavior TBD (architect decides: compatibility window or error on version mismatch) | Downgrade unresolved |

**Unresolved Questions** (Architect to settle):
1. Is auto-rollback permitted on post-operation failure, or must operator intervene manually?
2. How long is the compatibility window for mixed-client versions (e.g., old CLI + new schema)?
3. What is the exact fail-closed behavior when a downgrade is attempted on PostgreSQL/MySQL (reverse migration scripts, operator manual steps, or explicit prohibition)?

**Gate0 Obligation**: Proof spikes document exact SQLite behavior and draft PostgreSQL/MySQL compatible migration mechanics. No decision until architecture review.

---

## 5. Dependency-Ordered V1 Slices with Acceptance and Fail-Closed Gates

Each slice produces acceptance-testable deliverables and fail-closed invariants. Slices may run sequentially or in dependency-respecting parallel; exact parallelism is Phase plan detail.

### Slice Inventory and Sequence

| Order | Slice | Phase | Deliverables | Fail-Closed Gate |
|-------|-------|-------|--------------|-----------------|
| 1 | Bun/TS CLI/help | Gate0 | Bun runtime stable; single-file executables; help/schema generation | Artifact checksums match; executable runs on all targets; no Node/Bun subprocess |
| 2 | Tenant/BookSet/status | Phase 1 | Tenant CRUD; BookSet CRUD; isolation checks; status queries | Tenant mutation fails when BookSet ambiguous; personal BookSet uniqueness enforced; company tenants reject personal/proprietorship BookSets |
| 3 | SQL/migrations/audit/evidence | Phase 1 | Migration infrastructure; SQLite/PostgreSQL/MySQL proof; audit trail schema; evidence linking schema | Migrations apply consistently; rollback behavior documented; audit rows immutable; evidence hashes verified |
| 4 | Double-entry ledger | Phase 3 | Journal/posting model; debit=credit enforcement; base-currency balance; original-currency storage; FX snapshot | Every posting tagged with tenant/BookSet; balance fails if debit ≠ credit after rounding; original currency preserved; no posting crosses tenant/BookSet |
| 5 | Documents/AR/AP | Phase 3 | Invoice/bill/payment state machines; draft→posted lifecycle; immutable reversal lineage; unapplied-payment mechanics | Draft editable; posted immutable; reversals linked; supplier-payment Dr-unapplied-payments leg posted exactly once; allocation clears control |
| 6 | Bank import/reconciliation | Phase 4 | Bank statement parsing; ephemeral match proposals; evidence-linked reconciliation; explicit human confirmation gate | Proposals non-posting; stale/mismatched/missing confirmation fails closed; no reconciliation or posting without recorded human confirmation binding plan ID/digest, actor, timestamp, exact fields |
| 7 | Reports/FX/Assets | Phase 5 | P&L/BS/aging/FX reports; realized and unrealized FX; fixed-asset register; depreciation (book and tax) | GSTIN scoped; immutable rule snapshots required; missing/stale rules fail REVIEW/BLOCK; asset uniqueness on (tenant_id, source_document_id, source_line_id); depreciation immutable |
| 8 | Payroll | Phase 6 | Payroll periods/inputs/runs/payables; statutory deductions (PF, ESI, PT, LWF); Form 16 draft | No attendance/leave/HRMS; inputs approved before run; payslip outputs for secure delivery; no hidden form logic outside rule snapshot |
| 9 | GST/TDS/TCS/Income-Tax/Compliance | Phase 7 | GSTR-1/3B/2B; TDS/TCS computation/Form 26Q; personal and business income-tax; TaxCase lifecycle; immutable FilingSnapshot | Books remain authoritative; TaxCase aggregates without merging ledgers; correction lineage immutable; filing snapshot binds exact versions/hashes/evidence; missing/stale authority fails REVIEW/BLOCK; GSTIN scoped; immutable rule snapshots required |
| 10 | Agent skills/help | Phase 8B | Skill contract versioning; job-skill catalog; CLI-only skill invocation; no direct domain/persistence imports; help/schema generation | All skills call agent-bahi CLI via registry; forward references marked DEFERRED; skill deprecation policy enforced |
| 11 | Zoho import | Phase 9 | Zoho Books feature parity; entity/account/posting mapping; imported books reconciliation with live books; unsupported row quarantine and count | Books match exactly after import; trial balance matches; AR/AP/bank control reconciliation exact; deterministic replay; every inventory/RBAC/custom-field row explicitly counted/quarantined; no silent drop; no Phase 1–8 model changes driven by import |

### Acceptance Criteria Template (All Slices)

Each slice must satisfy:

1. **Functional**: Contracts from canonical docs verified at integration level; test coverage for golden path + edge cases (e.g., BookSet ambiguity in Phase 1, personal-only CA access in Phase 1, stale rule in Phase 7).
2. **Fail-Closed**: Every silent-failure listed in [Architecture § 2](../architecture.md#2-architecture-drivers-and-silent-failures) is testable and must not pass without explicit error or gate rejection.
3. **Audit**: Every mutation recorded with actor, source, reason, timestamp, version, request ID; immutability preserved for posted/locked records.
4. **Isolation**: Tenant/BookSet/GSTIN scoped correctly; cross-boundary access fails at application and database relationship level.
5. **Idempotency**: Duplicate requests with same ID return same result; no silent replay.
6. **Determinism**: Same input + same rule snapshot + same prior state → same output, every time, on every platform.

---

## 6. TENTATIVE Production Contract

**Status**: TENTATIVE; owner acceptance and CA sign-off pending at Phase 9 cutover.

### Shadow Books and Reconciliation Invariants

After Phase 9 import completes, imported books are placed in shadow mode (separate database or read-only access, never live posting). Agent-bahi shadow books must reconcile exactly with live books before cutover:

1. **Opening balances**: Reconcile opening trial balance from live books. Variance > 0 fails closed; explainable variance must be documented by operator.
2. **Trial balance**: Sum of all account balances matches by period. Debit = credit after rounding. Zero unexplained variance.
3. **AR/AP aging**: Aged receivables and payables match live books detail-for-detail. Invoice/bill/payment sequence and amount match.
4. **Bank control totals**: Bank reconciliation matches live books. Unmatched lines reconcile. Cleared/uncleared status matches.
5. **GST**: GSTR-1/GSTR-3B/GSTR-2B liabilities and ITC recoverable match live books supply/invoice/purchase/expense totals and evidence. All ITC claims backed by GSTR-2B/purchase evidence in agent-bahi.
6. **TDS/TCS**: TDS payable and TCS liable match salary/purchase/service totals. All deductible/collectible amounts backed by effective-dated rule snapshot in agent-bahi.
7. **Payroll**: Gross/net/statutory deductions match live payroll. Form 16 values match tax computation in agent-bahi.
8. **Personal tax** (if applicable): TaxCase income/tax computation matches personal books + all proprietorship BookSets aggregated. All external evidence (AIS, 26AS) reconciled and immutable. Filing snapshot binds exact versions and hashes.

**Failure Condition**: Any variance > 0 fails closed. Finance Owner and CA must investigate and correct before cutover authorization.

### Import, Shadow Books, and Cutover Sequence

**Phase 9 Import Completion**: Zoho Books import feature implementation completes in Phase 9. Imported books must reconcile exactly with live books (trial balance, AR/AP, bank control, GST, TDS/TCS, payroll). Every unsupported row (inventory, RBAC/identity, custom fields, other) is explicitly quarantined, counted, and reported; no silent drop. Feature parity is validated (see [Zoho Books and Frappe Books Feature Parity Matrix](zoho-frappe-parity.md)), but canonical contracts remain independent of vendor behavior. No Phase 1–8 decisions are driven by import behavior.

**Current Books**: Live books remain authoritative and continue posting during shadow period. Imported books are placed in shadow/test mode (separate database or read-only access) until final cutover decision.

**Shadow Period Conditions** (Phase 9 cutover planning):
- **Duration**: TBD by owner at Phase 9.
- **Tolerance**: Zero variance allowed; any mismatch fails closed.
- **Reconciliation gates**: Opening balances, trial balance, AR/AP aging, bank control totals, GST, TDS/TCS, payroll, personal tax all must reconcile exactly.

**Cutover Mechanics** (after import and shadow reconciliation complete):
- **Finance Owner** (operational authority): Verifies reconciliation complete and books match; authorizes cutover; retains rollback authority.
- **CA** (statutory authority): Independently reviews shadow books for accounting/tax correctness; signs statutory review artifacts; verifies evidence and compliance.
- Both roles bind exact artifact hashes (books/rule-snapshots/authority-packs) to their respective sign-off. Signatures and binding are separate and independent.
- Upload/export is not filing. Evidence remains in agent-bahi; export files are working papers only.
- Specimen filing (e.g., GSTR-1 export, ITR form) generated and sent for CA review before any live filing.
- Mixed-version failure tests completed: old client reads new schema safely; new client reads old schema returns error with guidance.
- Restore-in-isolation verified: backup restored and reconciliation re-run in test environment; deterministic replay produces same trial balance.
- Rollback plan documented: If post-cutover failure occurs, exact procedure and data recovery steps pre-agreed with Finance Owner and CA.

### Post-Cutover Monitoring

1. **Automated gates**: Daily trial-balance check; AR/AP reconciliation; bank control totals; GST liability/ITC reconciliation (if applicable).
2. **Human/CA confirmations**: Finance Owner weekly review (bank, payroll, deposits); CA weekly compliance review (TDS/TCS accrual, payroll, filing deadlines); monthly financial review.
3. **Stop conditions**: Trial balance variance > 0; unmatched bank control; unexplained ITC rejection from GST portal; missing rule snapshot at tax computation; audit trail gap.

---

## 7. Open Decision List

### Architect-Tier Decisions (Settled by Architect Review; Sudhanshu Approves Final Call)

1. **Personal-Tax Physical Schema Contract CLEAN Review** (§ 3 above)
   - Is the recommended option (A) model realizable with the candidate ORM/driver?
   - Can full-history personal BookSet uniqueness be enforced at the database relationship level (not application convention)?
   - Does the schema support fail-closed BookSet authorization scope without privileged cross-BookSet queries?

2. **Gate0 Proof Spike Findings and Library Approval** (§ 4 above)
   - STK-001..006 complete; Bun version pinned and recorded.
   - Any blockers from driver/ORM/decimal candidates? If so, alternative recommendations or fallback strategies.
   - Are any additional proof spikes needed before Phase 1 (e.g., rule-snapshot versioning mechanics, evidence content-addressing)?

3. **Database Migration Policy Finalization** (§ 4 above, unresolved questions)
   - Auto-rollback on post-operation failure, or manual operator intervention required?
   - Compatibility window length for mixed-client versions (old CLI + new schema, or vice versa)?
   - Downgrade strategy for PostgreSQL/MySQL (reverse migrations, manual scripts, explicit prohibition)?

4. **Rule Snapshot Versioning and Authority Binding** (deferred to Phase 7, but architecture impacts Phase 1)
   - Exact rule-snapshot tuple structure (period_key, governing_act, filing_trigger, content_hash, version, effective_interval)?
   - How does TaxCase fail-closed when a rule snapshot is missing or stale?
   - Can phase 1 migration infrastructure reserve schema space for rule snapshot versioning?

5. **Evidence Content-Addressing and Immutability** (deferred to Phase 4, but architecture impacts Phase 1)
   - Hash algorithm and format (SHA256, blake3)?
   - Blob storage: local filesystem default; S3 optional adapter?
   - Can phase 1 schema reserve space for evidence linking?

### Sudhanshu-Reserved Decisions (Sudhanshu Only; Architect Consults)

1. **Gate0 Authorization**: After reviewing [Owner Review Docket](owner-review-docket.md), Sudhanshu decides whether to authorize Gate0 proof spikes to run. This is **not** implementation authorization; Gate0 is mandatory evidence-gathering, but Sudhanshu may decide to gather evidence a different way or defer Gate0.

2. **Personal-Tax Option Choice** (§ 3 above)
   - If architect recommends option A is realizable, Sudhanshu approves A (recommended).
   - If architect finds A impractical, Sudhanshu chooses A with additional safeguards, B (alternative), or postpones personal-tax to future phase.

3. **Phase 1 Authorization**: After architect review closes, Sudhanshu explicitly authorizes Phase 1 to begin. This is separate from Gate0 authorization; Phase 1 cannot start without explicit word.

4. **Tenant Option** (related to personal-tax choice; deferred to Phase 1 planning)
   - Current canonical model: one legal entity = one tenant.
   - Personal-tax extension: one PAN individual may contain one personal + multiple proprietorship BookSets (option A). If architect recommends option B, Sudhanshu chooses B or defers personal-tax.
   - Future multi-entity consolidation (e.g., holding-company tenants with consolidated reporting): separate owner decision; not in scope for Phase 1.

5. **Shadow Duration and Cutover Authority** (Phase 9 planning; not now)
   - Sudhanshu, Finance Owner, and CA jointly plan acceptable shadow period duration and cutover date.
   - Finance Owner retains cutover/rollback operational authority and decides go/no-go based on reconciliation completeness.
   - CA independently verifies accounting/tax correctness and signs statutory review artifacts.
   - Sudhanshu reserves right to halt cutover if shadow reconciliation shows unexplained variance or either Finance Owner or CA identifies risk.

6. **Migration Dependency Policy** (architecture detail with business impact; deferred to Phase 1 detailed planning)
   - Can Phase 1 modify data-model contracts if an existing library proof fails, or must library choice wait for alternative proof?
   - Example: If candidate ORM cannot enforce full-history uniqueness for personal BookSet, can the schema weaken the constraint, or must the architecture remain A and a different ORM be proven?

7. **Explicit Filing Adapter Approval** (per-filing, per T-001 fallback)
   - GSTR-1 is settled (prepare/validate/export + manual portal).
   - GSTR-3B, TDS, income-tax, e-invoice, e-way bill, MCA: each requires owner research closure and approval before an adapter is built. T-001 fallback (prepare/validate/export) applies to all until individual approval.

### Not in Scope (Future Authority-Registry Note; No Live Scrape Dependency)

- **Authority registry** (future feature): Sudhanshu requested a separate future project to maintain an up-to-date registry of forms, rules, deadlines, and official sources (Finance Act amendments, ITD releases, portal schemas). Agent-bahi's canonical contracts and rule snapshots will link to this registry, but agent-bahi does NOT scrape or auto-fetch from it. This note is future-only and does not block Phase 1.

---

## Cross-Reference Summary

| Topic | Canonical Reference |
|-------|-------------------|
| T-001..T-011 owner-approved | [Owner Review Docket](owner-review-docket.md) |
| PT-001..PT-016 owner-approved, not architect-reviewed | [Personal Tax Discovery Packet](personal-tax-scope.md) |
| Personal-tax data model (dialect-neutral contract) | [Personal Tax Physical-Schema RFC](personal-tax-physical-schema.md) |
| Accounting domain contracts | [Accounting Contracts](accounting-contracts.md) |
| Statutory compliance baselines | [Statutory Workflow Contracts](statutory-workflow-contracts.md) |
| GST compliance matrix | [GST Compliance Matrix](gst-compliance-matrix.md) |
| TDS/TCS compliance matrix | [TDS/TCS Compliance Matrix](tds-tcs-compliance-matrix.md) |
| Annual income-tax compliance matrix | [Annual Income-Tax Compliance Matrix](annual-income-tax-compliance-matrix.md) |
| MCA Companies Act compliance matrix | [MCA Companies Act Compliance Matrix](mca-companies-act-compliance-matrix.md) |
| Gate0 proof spikes detail | [Implementation Plan § Gate0](implementation-plan.md#gate0-proof-spikes-hard-blocker-before-phase-1) |
| Phase 1–9 sequencing and prerequisites | [Implementation Plan](implementation-plan.md) |
| Pre-implementation architecture | [Architecture](../architecture.md) |
| Architecture-recommendations | [Architecture Decisions](architecture-decisions.md) |
| Settled confirmed decisions | [Confirmed Decisions](decisions.md#confirmed) |

---

**Document Status**: This packet is TENTATIVE. Architect review and owner authorization gates must be satisfied before implementation. No gate may be skipped or presumed complete.
