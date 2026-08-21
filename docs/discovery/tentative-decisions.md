# Tentative Decisions and Overnight Protocol

This document records overnight planning decisions that establish working defaults while the owner is unavailable. Entries distinguish between truly settled decisions, tentative agent-selected defaults awaiting owner review, open research questions requiring external verification, and internal architectural choices that do not require owner approval.

## Status Semantics

**SETTLED_OWNER_DECISION**: Explicitly approved by Sudhanshu and documented in [decisions.md](decisions.md). These are binding and may only be changed through owner review and explicit new decision.

**TENTATIVE_AGENT_DEFAULT**: A planning default selected by workers/agents to unblock daily development while the owner is unavailable. Not owner-approved. Must include explicit owner-review status, evidence for the choice, product impact, and a reversal path so the owner can change the default without architectural breakage. Every tentative entry includes a clear path for the owner to override.

**OPEN_RESEARCH**: An external fact (law, portal specification, runtime requirement) that cannot be decided by preference. Requires official primary sources or field verification before gate satisfaction. Remains open until explicit research closure.

**INTERNAL_ARCHITECTURE_DECISION**: A reversible technical choice about implementation structure, sequencing, or interface boundaries that does not require owner business approval because it is implementation-internal and does not change settled product or compliance behavior. Examples: Phase 2 defines contracts before Phase 3 implements; discovery doc structure; internal code patterns.

---

## Initial Tentative Entries

<a id="t-001"></a>
### Entry T-001: External Statutory Submissions Workflow—Fallback Default When No Filing-Specific Decision Exists

**Status**: OWNER-APPROVED

**Scope and Override Rule**:
- **T-001 is the fallback default only** where no filing-specific settled/owner-approved decision exists.
- **Filing-specific settled boundaries override T-001 entirely**. GSTR-1 has a settled specific boundary in [decisions.md](decisions.md#confirmed); GSTR-1 does not use T-001.
- When a filing (GST, TDS, income-tax, MCA, etc.) has its own documented decision boundary, apply that boundary. T-001 is not a template applied to all filings; it is only active where the specific filing boundary is undefined or explicitly deferred.

**Question**: How should external statutory submissions be handled in the absence of a filing-specific adapter implementation or settled boundary?

**Recommended Working Default**:

For all external statutory submissions where no filing-specific decision or research has settled a transport/submission boundary:
1. **Prepare** phase: Agent-bahi generates deterministic working papers, JSON, CSV, or other compliance format from validated ledger data and effective-dated rules.
2. **Validate** phase: Local validation completes before export; deterministic validation results are recorded.
3. **Export** phase: User downloads a machine-readable artifact suitable for portal upload or manual filing.
4. **Portal/Manual Filing**: User or CA uploads and files through the official government portal with DSC/EVC/OTP as required.
5. **Evidence Recording**: Portal acknowledgement (ARN, reference number, filing status, errors) is manually recorded in agent-bahi by user or operator after portal filing confirms success or identifies issues.

**Alternatives**:
- Direct automated government submission through GSP/portal APIs (requires credentials, integration, research, and poses operational risk if integration fails after partial submission).
- No export support; users must manually re-enter data into portals (high friction, error-prone).
- Embedded portal automation via third-party gateway services (adds external dependency and cost).

**Rationale**:
The settled GSTR-1 boundary (prepare/validate/export + manual portal + evidence recording) is the lowest-risk, highest-control workflow with proven success in existing accounting software. Until filing-specific research (GSP format stability, portal API availability, error handling, credentials, amendments) is complete and expressly settled by the owner, the same prepare/validate/export pattern ensures:
- Deterministic, reproducible working papers auditable by owner/CA.
- No hidden submission logic in agent-bahi; all filing risk and decision authority remain with the user/CA.
- Evidence of what was filed comes from the portal (ARN, filing timestamp), not from agent-bahi claims.
- Reversibility: if a filing-specific adapter is researched and approved later, the export interface remains unchanged; the adapter becomes an optional alternative.

**Product Impact**:
- High compliance trust: User/CA retains full control and visibility into filing.
- Moderate operator friction: Portal filing is a separate manual step after export (not automated in v1).
- Risk isolation: No agent-bahi operational outage can block government filing.
- Audit readiness: Portal evidence (ARN, acknowledgement) is the authoritative record; agent-bahi records it but does not generate it.

**Reversal Path**:
Owner may approve filing-specific adapters for individual filings (GSTR-3B, TDS, etc.) after dedicated research closures. Approval adds an optional direct-submission path alongside prepare/validate/export; it does not remove the export workflow. Existing filing workflows remain stable.

**Dependencies**:
- [GSTR-1-specific output boundary](decisions.md#confirmed) (settled) — this entry extends the same pattern to other filings.
- [Government filing boundary](decisions.md#confirmed) (settled) — explicitly states each filing requires separate research and decision.
- Open research items: "Stable official GSTR-3B artifact", "TDS/TCS rules and forms", "Income-tax statutory forms and thresholds" in [architecture-decisions.md](architecture-decisions.md#open-research--deferred-list).

**Evidence**:
- GSTR-1 settled workflow in [decisions.md](decisions.md#confirmed) provides proof-of-concept.
- Zoho Books comparison: Zoho supports prepare/validate/export + manual GSTR filing; this is standard industry practice.
- GST Portal documentation: Portal accepts JSON and manual filing; ARN is the canonical evidence.

**Owner Review Status**:
Owner-approved as the fallback default for external statutory submissions where no filing-specific decision has been settled. This entry establishes the prepare/validate/export pattern and manual portal evidence-recording flow as the canonical approach for filings without specific boundary decisions. Filing-specific decisions (such as GSTR-1) always override this default; T-001 applies only where the specific filing boundary is undefined or explicitly deferred.

---

<a id="t-002"></a>
### Entry T-002: MIT License and Frappe Books Study/Reference Only

**Status**: OWNER-APPROVED

**Question**: To what extent should agent-bahi study Frappe Books concepts and documented behavior?

**Recommended Working Default**:
- Agent-bahi is licensed under **MIT**.
- Frappe Books is a **study and behavior/concept reference only**. Agent-bahi does not copy or adapt Frappe source code, database schemas, UI patterns, prose, or assets.
- Frappe Books concepts may inform independent design and research, but all agent-bahi implementation and documentation is original and written in agent-bahi's own words.

**Alternatives**:
- No reference: Ignore Frappe Books entirely (loses a bounded source of study material for India accounting concepts).
- Independent research only: Use primary statutory and product sources without studying Frappe Books (increases discovery effort).

**Rationale**:
Frappe Books is a useful source of documented accounting and GST behavior for
study, but it is not an implementation source. An independent MIT-licensed
agent-bahi implementation keeps product decisions, source, schema, prose, and
assets separate from the study material and avoids silent dependency on vendor
behavior that is not independently verified.

**Product Impact**:
- Design quality: Documented Frappe Books accounting/GST behavior provides a bounded reference without attributing unsupported capabilities.
- License clarity: Agent-bahi uses MIT; Frappe Books remains study/reference material only.
- Operational simplicity: No Frappe source, schema, prose, or assets enter the repository.
- Future flexibility: Independent implementation allows divergence from Frappe if Indian compliance rules or agent-bahi requirements change.

**Reversal Path**:
Any change to the MIT license or to the Frappe study/reference boundary requires
a new explicit owner decision. It does not authorize copying or adapting Frappe
source, schema, prose, or assets.

**Dependencies**:
- No dependencies on other settled decisions. This is independent of filing workflows, compliance rules, or architecture.
- Affects only the independent implementation's license and study boundary, not functional design.

**Evidence**:
- Frappe Books accounting and GST behavior is documented publicly; this entry
  relies only on those documented Books capabilities.
- [Zoho Books and Frappe Books Feature Parity Matrix](zoho-frappe-parity.md) is
  a study aid and does not authorize reuse of Frappe material.

**Owner Review Status**:
Owner-approved. Agent-bahi is MIT-licensed. Frappe Books is study/reference-only
for behavior and concepts; no Frappe source code, schema, prose, or assets are
copied or adapted. Agent-bahi's implementation and documentation remain
independent.

---

<a id="t-003"></a>
### Entry T-003: Fixed-Asset Depreciation Schedules—Book vs. Tax

**Status**: OWNER-APPROVED

The separate book/tax schedule model is owner-approved. This entry establishes
the separate-schedule architecture with SLM as the default book method and
statutory rule-pack-driven tax method. Specific depreciation rates, method
overrides, and rule-pack contents remain research-gated; this entry does not
lock tax rates or method specifics.

**Question**: How should book and tax depreciation be modeled and calculated in the fixed-asset module?

**Approved Decision**:
- Separate book-depreciation and tax-depreciation schedules per asset.
- **Book method**: Configurable per asset or tenant-wide, with Straight-line (SLM)
  as the default using user-specified useful life and salvage value.
- **Tax method**: Follows effective statutory rule packs indexed by financial
  year, jurisdiction, and asset class (e.g., block assets, plant, buildings).
  Depreciation is computed deterministically from the applicable rule pack.
- **Depreciation runs**: Monthly pro-rata SLM for book; deterministic statutory monthly/quarterly accrual for tax based on rule pack.
- **Reconciliation**: Separate book/tax schedules enable period-end variance analysis (book vs. tax differences).
- **Storage**: Asset master records book method (SLM params) and active tax rule-pack reference; monthly depreciation/accrual lines link to both schedules. This storage/model choice is reversible and does not claim vendor parity.

**Alternatives**:
- Single depreciation method (book and tax identical): Violates India compliance requirements (book is often SLM; tax is often WDV or block asset rules).
- User-configurable tax method: High operational risk (users may select wrong rule pack) and requires extensive tax research per class/year.
- Separate asset tables (book assets vs. tax assets): Couples data model and adds complexity; reconciliation is harder.

**Rationale**:
India accounting and tax compliance require separate book and tax depreciation
(Companies Act vs. Income-tax Act). Book SLM is predictable and configurable;
the tax schedule is statutory and must be maintained in an effective-dated
compliance-rules package. The separate schedules make reconciliation auditable.
Only the exact statutory tax method and rates for each applicable year,
jurisdiction, and asset class remain OPEN_RESEARCH. Monthly pro-rata SLM is
the approved book calculation approach for reporting cycles.

**Product Impact**:
- Compliance readiness: Separate book/tax schedules support India's dual-reporting requirements.
- Audit clarity: Book/tax variance is transparent and reconcilable.
- Operational complexity: Monthly depreciation runs add overhead vs. annual runs. However, monthly pro-rata is more accurate for mid-year additions and disposals.
- Tax research dependency: Exact statutory tax methods and rates remain open
  research; the affected tax depreciation lane cannot run until its rule pack is
  verified.

**Reversal Path**:
The separate book/tax schedule model and SLM book default remain versioned and
reversible. Owner may replace a method or rule-pack choice through a new version
and superseding schedule; posted history and prior schedules remain immutable
and linked by correction lineage. Any statutory tax method or rate change still
requires research closure and a verified rule-pack snapshot before use. If the
book method changes, existing asset schedules must be audited for prior-year
reporting impact.

**Dependencies**:
- Fixed-asset module (Phase scope: ARC-012 in architecture-decisions.md).
- Open research: exact statutory tax methods and rates in [architecture-decisions.md](architecture-decisions.md#open-research--deferred-list).
- Effective-dated compliance rules engine (required for tax rule packs per year/class).

**Evidence**:
- India Companies Act (2013) Schedule II: SLM is standard for book depreciation.
- Income-tax Act schedules and old/new regime rates: WDV, block assets, specific class rules (e.g., buildings 40 years SLM, plant 15 years WDV).
- Zoho Books is not the authority for this product decision; statutory sources
  govern the tax rule-pack contents.

**Owner Review Status**:
Owner-approved. Separate book/tax schedules and SLM as the default book method
are settled. Only exact statutory tax methods and rates remain OPEN_RESEARCH;
the affected tax depreciation lane is gated by research closure and a verified
statutory rule snapshot. Those rules are applied through effective-dated packs.

---

<a id="t-004"></a>
### Entry T-004: Exchange-Rate Provider and Purpose-Specific FX Workflow

**Status**: OWNER-APPROVED (with significant OPEN_RESEARCH component)

**Question**: Which exchange-rate source (RBI, bank rates, market rates, third-party API) should agent-bahi use for multi-currency transactions, and how should rates be selected and recorded?

**Recommended Working Default**:
- **Original currency**: Every foreign-currency document and settlement preserves
  its original currency and amount alongside the tenant base-currency amount.
- **Purpose-specific snapshots**: When applicable, each transaction records a
  separate immutable rate snapshot for **book recognition**, **settlement**,
  **GST**, and **income-tax/TDS**. Each snapshot records its purpose, rate,
  source, effective date, timestamp, and evidence.
- **Purpose-specific source selection**: Tenant configuration may specify a
  default source for each purpose. A fallback is allowed only among sources
  approved for that same purpose, and every fallback step is explicit and
  recorded.
- **No cross-purpose substitution**: A rate selected for book recognition or
  settlement must never be reused as a GST or income-tax/TDS rate, and a tax
  rate must never be reused for book recognition or settlement.
- **Missing statutory source/rate**: Missing statutory source or rate blocks or
  marks **REVIEW** only the affected GST or income-tax/TDS compliance lane. It
  must not block unrelated bookkeeping or settlement when their own valid
  snapshots exist, and no other purpose's rate may substitute for it.
- **No silent date substitution**: Do not silently use today's rate for a
  document dated yesterday; use the applicable date or require explicit
  user/operator selection.
- **Rate lock at posting**: Once a purpose-specific snapshot is recorded, it is
  immutable; period-end revaluation creates an explicit adjustment entry and
  never mutates the original snapshot.
- **Exact statutory sources/providers remain OPEN_RESEARCH**: Which source is
  authoritative for each purpose (RBI bulletin, bank statement, or another
  verified statutory source) requires a dedicated source audit.

**Alternatives**:
- Single mandatory source (e.g., RBI only): Brittle if source is unavailable; no fallback.
- Automatic rate selection from multiple sources (e.g., "use the lowest of RBI/bank/market"): Introduces arbitrage risk and unclear audit trail.
- Manual-only rates: High operator friction and audit risk (rates must be verified per external document).
- Market-based spot rates (e.g., Reuters): High cost, external dependency, not standard for accounting (books typically use official rates).

**Rationale**:
Immutable original-currency amounts and purpose-specific rate snapshots prevent
rate restatement and enable audit. A configurable source per purpose, with
same-purpose fallback only, provides automation while retaining control. A
source audit is required to identify the authoritative statutory source and rate
for GST and income-tax/TDS. If that source or rate is unavailable, only the
affected compliance lane is blocked or marked REVIEW; unrelated book and
settlement work never silently borrows a different purpose's rate.

**Product Impact**:
- Audit clarity: Immutable rate snapshots with source provenance are auditable.
- Automation opportunity: Purpose-specific source selection reduces operator
  friction if each source is stable and available.
- Operational risk: If chosen rate source becomes unavailable (API outage, portal down), explicit fallback is required.
- Compliance risk: Tax authorities may prescribe different sources or rates by
  purpose and period; this is part of OPEN_RESEARCH.
- FX reporting: Separate realized (posting-time) and unrealized (period-end revaluation) exchange gain/loss is deterministic and auditable.

**Reversal Path**:
Owner may settle the source and fallback policy for each purpose after the
dedicated source audit. This changes only future purpose-specific snapshots and
does not affect the immutable snapshot structure. Existing transactions retain
their recorded original amounts and rates. Any stack or policy override based on
a research blocker must be a new explicit owner decision.

**Dependencies**:
- Immutable document-rate snapshots (settled in [decisions.md](decisions.md#confirmed)).
- Multi-currency support (settled in [decisions.md](decisions.md#confirmed)).
- Open research: "Exchange-rate provider selection" in [architecture-decisions.md](architecture-decisions.md#open-research--deferred-list).
- Effective-dated compliance rules (for possible tax-prescribed rate sources per year/jurisdiction).

**Evidence**:
- RBI.org provides daily EOD rates (API and bulletin).
- Bank statements include settlement rates for actual FX transactions.
- Zoho Books: Configurable rate source (RBI, Bank, Manual) with fallback.
- India tax authority (CBDT): May have prescribed rate source per statute/year (research required).

**Owner Review Status**:
Owner-approved for preserving original currency and for immutable,
purpose-specific snapshots covering book recognition, settlement, GST, and
income-tax/TDS. Exact statutory sources and rates remain OPEN_RESEARCH. Missing
statutory evidence blocks or marks REVIEW only the affected compliance lane and
never permits substitution of another purpose's rate. Existing transactions'
recorded amounts and snapshots remain immutable.

---

<a id="t-005"></a>
<a id="entry-t-005-v1-scope-no-registration-and-regular-gst-accounting-profiles"></a>
<a id="entry-t-005-v1-scope—no-registration-and-regular-gst-accounting-profiles"></a>
### Entry T-005: V1 Scope—No-Registration and Regular GST/Accounting Profiles

**Status**: OWNER-APPROVED

**Question**: Which business profile and tax regimes should V1 prioritize in its coverage roadmap and testing?

**Recommended Working Default**:
- **V1 Primary Target**: No-registration and regular (non-composition) GST
  business profiles in India.
  - No-registration workflows and regular GST registration (GST/registered supplier).
  - GSTR-1 filing (B2B/B2C, service, goods).
  - GSTR-3B reconciliation, including GST credit reconciliation, and manual portal filing.
  - Invoicing, billing, payment, expense, and basic payroll workflows.
  - Domestic, interstate, and export supply workflows.
  - E-invoice and e-way-bill **upload-file workflows**. Direct API/portal
    submission, applicability, and state-specific research remain gated; V1
    does not claim automatic submission. See [architecture-decisions.md](architecture-decisions.md#cmp-006-e-invoice-default-irp-via-configured-adapter) and [architecture-decisions.md](architecture-decisions.md#cmp-007-e-way-bill-default-configured-api-with-state-specific-rules-open-research).
  - Composition schemes, specialized regimes/industry compliance, and inventory
    accounting remain deferred.

- **Out of V1 Scope** (documented as deferred/future research):
  - Composition taxpayers (CMP-08, GSTR-4, deemed ITC rules).
  - Composition-adjacent or other specialized tax regimes.
  - Direct e-invoice/e-way-bill API or portal submission and applicability-specific
    adapters (upload-file workflows remain in V1).
  - Inventory accounting, stock movements, warehouses, and supply-chain workflows.
  - Specialized industry compliance (finance, insurance, customs, and similar
    regimes); export upload-file workflows remain in V1.

- **Unverified Transports** (gated as explicit deferred/open, not silently assumed):
  - Portal APIs (except GSTR-1 manual filing evidence recording, which is settled).
  - IRP credentials and direct e-invoice submission (CMP-006 research-gated;
    upload-file workflow remains in V1).
  - E-way-bill API and state-specific rules (CMP-007 research-gated;
    upload-file workflow remains in V1).
  - Bank auto-sync or auto-import.
  - Employee self-service portals, leave/attendance, HRMS.
  - Inventory, stock movements, manufacturing, and other specialized modules.

**Alternatives**:
- Broad scope from day one: Composition, specialized regimes, inventory, direct
  multi-state transports, e-invoice, and e-way bill submission all in V1 (scope
  explosion, incomplete research, delayed delivery).
- Narrow scope (only one registration or only domestic supplies, no payroll):
  Misses the required GST and business profile coverage.
- Marketplace/SaaS focus (multi-tenant, API-first): Defers CLI-first determinism and agent integration.

**Rationale**:
The V1 baseline covers no-registration and regular GST profiles, domestic,
interstate, and export supplies, GSTR-1, GSTR-3B and credit reconciliation, and
the upload-file workflows needed for e-invoice and e-way-bill operations. Direct
portal/API submission and specialized applicability rules remain research-gated.
Composition and other specialized regimes, plus inventory, are deferred so the
baseline remains cohesive and auditable without silently claiming unsupported
coverage.

**Product Impact**:
- Faster V1 delivery: Focused scope enables earlier production use.
- Clearer testing: Primary business profile is well-defined; golden test scenarios are grounded.
- Completeness: V1 covers invoicing, billing, GST, payroll, and expense workflows end-to-end for the target profile.
- Future extensibility: Multi-GSTIN, effective-dated rules, and modular
  architecture support composition, specialized regimes, and inventory as future
  phases.
- Research parallelization: Direct e-invoice/e-way submission, composition,
  specialized regimes, and inventory can be researched in parallel without
  blocking the V1 upload-file and accounting workflows.

**Reversal Path**:
Owner may expand V1 scope to composition, specialized regimes, or inventory by:
1. Closing research items (CMP-08 rules, GSTR-4 requirements).
2. Extending effective-dated rule packs.
3. Testing the expanded workflows against golden fixtures.
This is not a breaking change; the architecture supports multiple tax regimes. Scope expansion extends V1 delivery timeline.

Or, owner may narrow V1 further (e.g., single-entity only, no payroll) to accelerate delivery. This is a tradeoff between coverage and timeline.

**Dependencies**:
- Sudhanshu's three legal entities and their GST registrations (context; informs profile).
- Open research items: "Composition scheme (CMP-08, GSTR-4)", "GSTR-9 exemption for FY 2025-26", "E-invoice applicability", "E-way bill state-specific rules" (all deferred).
- Settled GST/payroll/evidence decisions in [decisions.md](decisions.md#confirmed).

**Evidence**:
- Zoho Books ships with regular-GST workflows as V1 baseline; composition added later.
- GSTR-1 specification is stable and documented by GST Portal; GSTR-3B is well-defined for regular taxpayers.
- Payroll scope in [decisions.md](decisions.md#confirmed) covers regular payroll (no attendance/HRMS); aligns with regular business profile.
- Expense evidence policy (settled) covers regular business expenses; no special industry compliance in V1 focus.

**Dependencies**:
- GSTR-1 and GSTR-3B workflow boundaries (settled in [decisions.md](decisions.md#confirmed)).
- E-invoice applicability research (CMP-006, architecture-decisions.md) — deferred until research completion and owner approval.
- E-way-bill applicability and state-specific rules (CMP-007, architecture-decisions.md) — deferred until research completion and owner approval.
- Composition scheme and simplified scheme research (separate future research).
- Open research: "Composition scheme (CMP-08, GSTR-4)", "E-invoice applicability", "E-way bill state-specific rules" in [architecture-decisions.md](architecture-decisions.md#open-research--deferred-list).

**Owner Review Status**:
Owner-approved. V1 includes no-registration and regular GST profiles; domestic,
interstate, and export supplies; GSTR-1; GSTR-3B and GST credit reconciliation;
invoicing, billing, payment, expense, and basic payroll; and e-invoice/e-way-bill
upload-file workflows. Direct API/portal submission and applicability research
remain gated. Composition, specialized regimes, and inventory remain deferred;
see [architecture-decisions.md § CMP-006](architecture-decisions.md#cmp-006-e-invoice-default-irp-via-configured-adapter) and [§ CMP-007](architecture-decisions.md#cmp-007-e-way-bill-default-configured-api-with-state-specific-rules-open-research) for the direct-transport research gates.

---

<a id="t-006"></a>
### Entry T-006: Tentative Numeric Proposal for Batch Exit-Code Signal—Not Implementation-Binding

**Status**: OWNER-APPROVED

**Note**: Exit-code behavior and batch semantics are defined in [architecture-decisions.md § CLI-004](architecture-decisions.md#cli-004-explicit-exit-code-taxonomy) and [CLI-006](architecture-decisions.md#cli-006-batch-atomicity-declared-per-operation) (canonical for actual implementation). This entry proposes only a numeric code selection and JSON outcome schema, not the binding contract. Implementation must follow the architecture entries' behavior definitions.

**Question**: What numeric exit code should agent-bahi use to signal partial-success batches (some items succeeded, some did not)?

**Recommended Signal Strategy**:

**Exit Code Principle** (behavior; numeric code remains internal):
- **Exit code 0**: Reserved for "all selected items succeeded" (canonical in CLI-004/CLI-006).
- **A distinct nonzero code**: Used when at least one selected item succeeded AND at least one selected item was skipped, blocked, or failed (partial success signal). Exact numeric code is internal and TBD.
- **Other non-zero codes**: Total failure or error conditions (per CLI-004; canonical in architecture-decisions.md).
- **Principle**: Never exit 0 when partial failure occurs. JSON outcomes array must accompany non-zero exits to enable caller to distinguish recoverable (partial success) from terminal failures (no success).

**JSON Outcomes Schema** (structure; implementation contract in CLI-006):
- Per-item outcomes array listing status (success, failure, blocked, skipped) per item.
- Failure/blocked/skipped reasons included per item.
- Success items include posted reference/digest if applicable.

**Rationale**:
Partial batch completion requires a distinct nonzero signal separate from total failure, allowing callers to distinguish recoverable partial success (retry failed items) from terminal failure (no retry). Exact numeric code selection is not determined by this decision and requires separate technical choice or architecture-driven assignment.

**Reversal Path**:
Owner may select a different unused numeric code (10, 11, or other) instead of 9. The principle (non-zero for any partial success, JSON outcomes per item) remains stable. Code choice is cosmetic; behavior definition is in architecture-decisions.md CLI-004/CLI-006.

**Dependencies**:
- [CLI-004: Explicit exit-code taxonomy](architecture-decisions.md#cli-004-explicit-exit-code-taxonomy) (canonical; this entry does not override).
- [CLI-006: Batch atomicity declared per operation](architecture-decisions.md#cli-006-batch-atomicity-declared-per-operation) (canonical; this entry does not override).

**Owner Review Status**:
Owner-approved. Partial batch completion is a distinct nonzero result with per-item outcomes; the exact numeric code remains internal and TBD. Numeric code selection is not settled by this decision and does not promote exit code 9 without a separate technical decision. The implementation contract (when to exit 0, when to exit non-zero, atomicity declaration, JSON schema details) is canonical in [architecture-decisions.md § CLI-004](architecture-decisions.md#cli-004-explicit-exit-code-taxonomy) and [§ CLI-006](architecture-decisions.md#cli-006-batch-atomicity-declared-per-operation); this entry does not override those specifications.

---

<a id="t-007"></a>
### Entry T-007: Full Individual Income-Tax Scope—Sole Proprietor, Accounting-Separated from Business/GST

**Status**: OWNER-APPROVED

**Question**: What is the scope of personal income-tax support for the sole-proprietor owner?

**Approved Scope**:
- **Full individual income-tax scope**: Complete personal income-tax computation and filing for the sole proprietor owner (e.g., ITR-3 for self-employed, ITR-4 for business income).
- **Accounting separation**: Personal income-tax is linked to but accounting-separated from business/GST books. Personal income sources and deductions are tracked and reported independently, with clear boundaries between personal and business financial records.
- **Linked but distinct**: The sole proprietor's personal assets, income, and deductions are modeled separately within the same tenant as business/GST books, enabling consolidated compliance but preserving accounting clarity.

**Detailed Personal-Tax Decisions**:
Detailed technical decisions for personal-tax implementation (PT-001 through PT-016) remain separately gated and documented in [Personal Tax Discovery Packet](personal-tax-scope.md). PT-001 (tenant model), PT-002 (BookSet boundary and record scope), PT-003 (atomic same-tenant inter-BookSet transfer), PT-004 (structured factual subledgers), PT-006 (year-specific form selection), PT-008 (preserve AIS/26AS), PT-009 (file-first data handling), PT-011 (GST output routing), PT-012 (TDS/TCS gate), PT-013 (filing lifecycle), and PT-015 (privacy boundary) are OWNER-APPROVED; NOT ARCHITECT-REVIEWED. PT-005, PT-007, PT-010, PT-014, and PT-016 remain TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED and require separate review.

**Advance-Tax Behavior—Not Owner-Approved by T-007**:
The old advance-tax manual-vs-auto default choice is **NOT** owner-approved by this scope decision. Advance-tax behavior (s404/408 estimated-amount input, auto-projection, deadline tracking) remains a separate personal-tax research item and must be preserved as TENTATIVE detail within the personal-tax scope, not claimed as approved by T-007's scope decision.

**Product Impact**:
- **Compliance scope**: Full individual income-tax return generation and filing workflows are in scope.
- **Accounting clarity**: Personal income/deductions/assets remain distinct from business/GST while staying within the same tenant.
- **Detailed decisions gated**: Specific implementation details (data model, form selection, evidence reconciliation, post-filing corrections) are gated by PT research and separate owner approvals.

**Reversal Path**:
Owner may adjust the scope or boundaries between personal and business accounting through future revisions. Personal income-tax support is a product-scope decision; detailed PT decisions follow their separate gates.

**Dependencies**:
- [Personal Tax Discovery Packet](personal-tax-scope.md) for detailed PT-001 through PT-016 decisions.
- Accounting-separation model (established in [decisions.md](decisions.md#confirmed): tenant independence and multi-entity support).

**Evidence**:
- Sudhanshu operates three legal entities including sole proprietorship; personal income-tax is a business-critical compliance need.
- India income-tax requires comprehensive personal returns even when sole proprietor has business income.

**Owner Review Status**:
Owner-approved for full individual income-tax scope linked to but accounting-separated from business/GST books. Detailed personal-tax implementation decisions: PT-001, PT-002, PT-003, PT-004, PT-006, PT-008, PT-009, PT-011, PT-012, PT-013, and PT-015 are owner-approved; PT-005, PT-007, PT-010, PT-014, and PT-016 remain separately gated. Advance-tax behavior and other specific method choices are NOT approved by T-007 and remain tentative within personal-tax research.

---

<a id="t-008"></a>
### Entry T-008: Controlled User Corrections and Deletions—Immutable Artifacts with Reversal Lineage

**Status**: OWNER-APPROVED

**Question**: How should agent-bahi handle user corrections and deletions after FY/report/audit/filing?

**Approved Correction Model**:
- **Allow controlled user corrections/deletions** even after FY close, report generation, audit, or filing, but **never destructive mutation**.
- **Locked periods require explicit controls**: Locked periods (per-period or global) require:
  1. **Preview** showing impact (what will change, affected reports/filings/audit cases).
  2. **Documented reason** (e.g., "asset cost adjustment per vendor invoice", "expense correction").
  3. **Explicit human confirmation** (actor, timestamp, cryptographic or deterministic binding to preview).
  4. **Period unlock** (full or partial unlock preview/commit).
- **Posted corrections use immutable lineage**: After period unlock:
  1. **Reversal + replacement**: Original entry remains immutable; a reversal + new corrected entry forms a linked pair.
  2. **Version/tombstone lineage**: Prior artifacts (original entry, prior versions, related schedules) remain immutable and linked by correction history.
  3. **No destructive overwrite**: Original data is never deleted; correction lineage traces the full sequence of changes.
- **Affected derived work becomes STALE/DRIFTED**:
  1. Any trial balance, report, filing, audit case, or compliance output generated before the correction is marked **STALE** or **DRIFTED**.
  2. These must be deliberately regenerated, reviewed, and re-closed; no automatic re-filing or amendment submission occurs.
  3. Operator/CA is responsible for determining whether a new filing/amendment is needed.

**Alternatives**:
- Block all corrections after posting (loses audit trail clarity and operationally impractical).
- Auto-recalculate all affected reports/filings (high risk: silent government amendments, audit trail chaos).
- Allow destructive mutations (loses audit lineage).

**Rationale**:
India tax/audit compliance requires immutable transaction history and explicit correction control. Users must be able to fix errors discovered after filing, but changes must never be silent. Marking derived work STALE ensures nothing is auto-amended or auto-filed; the operator/CA explicitly chooses next steps. This aligns with period-lock and correction-lineage principles in [decisions.md](decisions.md#confirmed).

**Product Impact**:
- **Audit trail clarity**: Full correction history is visible; no mutations are hidden.
- **Operator control**: User explicitly unlocks periods and confirms each correction.
- **Compliance safety**: No automatic government amendments; operator decides re-filing need.
- **Artifact immutability**: Original documents and versions remain for audit review.

**Reversal Path**:
Owner may adjust unlock preview requirements or confirmation mechanisms. The core principle (immutable originals, reversal lineage, STALE derived work) remains stable.

**Dependencies**:
- Period-lock and correction-lineage model (settled in [decisions.md](decisions.md#confirmed)).
- Fixed-asset module scope and depreciation (T-003); applies to all posted documents.
- [ARC-006: Optimistic concurrency with explicit locks](architecture-decisions.md#arc-006-optimistic-concurrency-with-explicit-locks-for-high-consequence-mutations).

**Evidence**:
- Accounting standards (ASC 360, Indian CA): Corrections preserve prior versions and document change rationale.
- Tax audit practice: Examiners review correction history and expect explicit linkage/lineage.
- Compliance practice: No automatic amendments to filed returns; CA/operator deliberates each amendment.

**Owner Review Status**:
Owner-approved. Controlled user corrections and deletions are allowed even after FY/report/audit/filing, but never destructive. Locked periods require explicit preview/reason/confirmation/unlock. Posted corrections use reversal/replacement, version or tombstone lineage. Prior artifacts remain immutable. Affected derived reports/filing/audit cases become visibly STALE/DRIFTED and require deliberate regeneration/review/re-close. No automatic government action or amendment submission occurs.

---

<a id="t-009"></a>
### Entry T-009: Form 140/141 Statutory Export—Research-Gated, Fail-Closed

**Status**: OWNER-APPROVED

**Question**: Should agent-bahi generate and export statutory Form 140/141 artifacts, or defer this until official portal/submission flow is researched and settled?

**Recommended Working Default**:
- **Fail-closed**: Internal neutral data (TDS transaction details, payee records, amounts, dates) may be prepared and stored.
- **No statutory export adapter** in V1 until official current utility, schema, validation rules, and portal submission flow are researched and snapshotted.
- Official ITD Form 140 guidance uses RPU (Return Preparation Utility) → FVU (File Validation Utility) → .fvu format, but applicable form/transport and current utility vary by effective regime and may change.
- Deferred until: (1) Current Form 140 guidance and Rule 219 requirements verified from official ITD sources; (2) Applicable form code, field mapping, and export schema snapshotted; (3) Portal flow (upload method, validation, acceptance criteria) researched; (4) Current utility of exported artifact confirmed.

**Alternatives**:
- Export JSON/XML without researching official utility/schema (high risk: export may not match current portal acceptance criteria; silent export failure in reconciliation).
- Export with claim that JSON/XML matches current official utility (premature: current utility changes with regimes and portal updates).
- Manual form preparation by user/CA outside agent-bahi until researched (operationally acceptable; avoids premature export claim).

**Rationale**:
Form 140 export is a statutory artifact. The official utility, schema, and portal flow must be verified before export is claimed to be usable. Official ITD Form 140 guidance and Rule 219 are the canonical sources; agent-bahi export must match those sources, not guess or assume precedent from other forms. Research gates prevent silent export failures or incorrect portal submissions.

**Product Impact**:
- **Safety**: No premature export claims; users/CAs handle Form 140 until research confirms utility.
- **Audit clarity**: No exported artifact without verified schema and portal flow.
- **Future flexibility**: Once research closes (current Form 140 utility verified), export adapter can be implemented with confidence.

**Reversal Path**:
After Form 140/141 field structure, RPU/FVU/portal utility, and current official guidance are researched and snapshotted, owner may approve export adapter. Export schema and portal flow must be documented per research findings, not assumed from V1 precedents.

**Dependencies**:
- [TDS Workflow Contract](statutory-workflow-contracts.md#tds-workflow-contract-non-payroll-sections-393394).
- Form 140/141 current official guidance (ITD Form 140 FAQ, Rule 219) research (OPEN).
- Portal flow (RPU/FVU/acceptance) verification (OPEN).

**Evidence**:
- Official ITD Form 140 guidance (ITD website, Form Navigator) states RPU→FVU→.fvu workflow; research required to verify current utility and portal acceptance.
- Rule 219 specifies Form 140 due dates but does not prescribe export format; portal utility must be verified separately.

**Owner Review Status**:
Owner-approved for the policy: always allow text and CSV operator exports of prepared/validated data; do not invent or default to arbitrary JSON as statutory artifact; government upload artifact only after official current format/utility/schema/portal verification and then exactly in mandated format. Form 140/141 export adapter is research-gated and deferred until official utility/schema/portal flow is verified. Internal neutral data may be prepared and stored; no statutory export adapter exists until research closure and owner approval of the specific form/transport.

---

<a id="t-010"></a>
### Entry T-010: Post-Filing Return Case/Evidence/Correction—Research-Gated Submission

**Status**: OWNER-APPROVED

**Question**: How should agent-bahi handle post-filing return corrections, rejections, or disputes? What submission mechanisms are needed beyond the initial return filing?

**Recommended Working Default**:
- **Case/evidence preservation**: Agent-bahi retains case details (filing ARN, rejection reason, filing timestamp, taxpayer branch per s263(5)-(7)), supporting evidence (correspondence, notices, documentation), and correction lineage (original return → cause of correction → remedial action taken).
- **Correction journals**: Post-filing ledger corrections (e.g., discovery of unposted expense) are recorded as explicit correction journals with documented reason, amount, prior-year impact, and correction date. This is separate from return submission.
- **No return-amendment or defective-return submission adapter** in V1 until official regime, form existence, applicability branches (s263(5)-(7)), and portal submission flow are researched and settled.
- Applicable branches per s263(5)-(7) are case-specific; no universal amendment/revised-return workflow applies to all return types/profiles.

**Alternatives**:
- Auto-submit revised/amended return based on detected differences (premature: requires verified form, applicable branch, and portal flow).
- Manual re-filing of entire original return with amendments marked (operational burden; unclear portal acceptance).
- No post-filing correction support (leaves audit trail incomplete).

**Rationale**:
Post-filing correction mechanisms (s263(5)-(7)) are fact-dependent and regime-dependent. No single mechanism applies to all taxpayers or return profiles. Official form names, applicable branches, deadlines, and portal flows must be verified per specific case facts and applicable s263 branch before agent-bahi claims to support any submission. Case/evidence preservation and correction lineage are universally needed; submission adapters are regime-specific and must be researched separately.

**Product Impact**:
- **Audit safety**: Case details and corrections remain traceable.
- **Future flexibility**: Once research determines applicable branches and submission flows, adapters can be implemented per branch/case type.
- **No premature claims**: No "amendment" or "revised return" submission until official mechanism verified.

**Reversal Path**:
After official s263(5)-(7) branches are researched and applicable regime/form/deadline per branch is documented, owner may approve branch-specific submission adapters. Case/evidence preservation and correction lineage remain stable regardless of submission mechanism added.

**Dependencies**:
- [Annual Income-Tax Return Workflow Contract](statutory-workflow-contracts.md#annual-income-tax-return-workflow-contract).
- s263(5)-(7) applicable branches and official procedures (OPEN_RESEARCH).
- Correction journal model (settled in [decisions.md](decisions.md#confirmed)).

**Evidence**:
- s263(5)-(7) define applicable branches for post-filing return procedures; exact applicability and form/deadline per branch require verified research.
- Current ITD Form Navigator and official guidance are required to confirm any submission mechanism.

**Owner Review Status**:
Owner-approved for the policy: preserve original filing, ARN/status/rejection/notices/evidence, and explicit ledger/correction/remedial lineage; no unverified automatic revised/amended/defective-return submission. Case details (filing ARN, rejection reason, filing timestamp, taxpayer branch) and correction lineage are immutably stored. Return-amendment or defective-return submission adapters are research-gated and deferred until s263(5)-(7) branches and official procedures are verified. Correction journals document post-filing ledger adjustments separately from submission mechanisms.

---

<a id="t-011"></a>
### Entry T-011: Initial Language and Runtime—TypeScript + Bun (Gate0 Required)

**Status**: OWNER-APPROVED

**Question**: What programming language and runtime should agent-bahi use for the initial implementation?

**Exact Meaning and Binding Status**: T-011 establishes TypeScript + Bun as the
selected language/runtime for agent-bahi. Bun-native APIs are used first. The
released executable must not require or invoke a separately installed Node runtime,
Node subprocess, Node lifecycle hook, separately installed Bun runtime, Bun
subprocess, or Bun lifecycle hook. This does not prohibit proof-gated third-party
packages bundled into the single executable, nor the packaged `agent-bahi` binary
being invoked by skills. This is not approval of implementation or any specific
library/tool choice; every third-party package remains individually gated. Gate0
proof spikes (STK-001 through STK-006) are a hard prerequisite for validation and
must pass before implementation is authorized. Gate0 remains mandatory but is not
authorized by this docs review. If Gate0 reveals a blocker, work stops; any stack
override after that blocker is a new explicit owner decision.

**Selected Stack and Gate0 Prerequisite**:
- **Selected**: TypeScript + Bun, with Bun-native runtime, package, test, and
  SQLite APIs used first. No third-party package is pre-approved.
- **Gate0 records exact runtime and dependency evidence before implementation authorization**:
  At execution time, Gate0 must resolve the authoritative latest stable Bun
  release and record its exact version, `bun --revision`, official Bun artifact
  checksum(s), every exact approved dependency version, dependency
  artifact/package integrity and checksum evidence, the lockfile, and the
  version/checksum pins in CI and release metadata.
  Third-party packages are individually approved; an unrecorded or unverified
  package is not approved.
- **Proof spikes (Gate0) validate the selected stack before implementation authorization**:
  - STK-001: Bun runtime, workspaces, lockfile (macOS arm64, Linux x64/arm64).
  - STK-002: Bun-native SQLite first, plus any individually approved ORM or
    adapter on PostgreSQL/MySQL; schema equivalence verified.
  - STK-003: SQLite pragmas, WAL, foreign_keys=ON, SQLITE_BUSY handling, network-filesystem rejection.
  - STK-004: Schema migrations and upgrade paths on all three dialects.
  - STK-005: Zod validation, JSON schema generation, Clipanion parser, decimal.js precision (INR/paise, FX, tax).
  - STK-006: ESM build, platform binaries, and required PostgreSQL/MySQL database drivers for the supported dialects.
- **Gate0 is a mandatory prerequisite, not authorized by this docs review**.
  Gate0 must pass on all platforms (macOS arm64, Linux x64/arm64) and its exact
  runtime/dependency/version/revision/checksum/integrity/lockfile/CI/release
  record must be complete before implementation is authorized. If Gate0 reveals
  blockers, work stops; any stack override is a new owner decision.

**Alternatives**:
- No ordinary alternative is selected. A different language or runtime is
  considered only through a new explicit owner decision after a documented
  Gate0 blocker.

**Rationale**:
Bun provides the selected runtime and Bun-native APIs for the CLI, scripts, and
backend services, while TypeScript provides type safety for domain and
compliance calculations. Gate0 validates the selected stack on all target
platforms and records the exact Bun version, `bun --revision`, official Bun
artifact checksum(s), individually approved dependency versions, dependency
artifact/package integrity and checksum evidence, lockfile, and CI/release
pins. The selected stack is binding;
Gate0 and implementation authorization are separate decisions.

**Product Impact**:
- **Development velocity**: Bun's built-in features (TypeScript, package management, testing) reduce toolchain complexity.
- **Deployment simplicity**: ESM build produces portable binaries; single platform-specific executable per OS/arch.
- **Type safety**: TypeScript catches many errors at build time; domain logic is verifiable.
- **Multi-database support**: Proof spikes validate ORM cross-dialect equivalence across SQLite, PostgreSQL, and MySQL. Remote database configuration is optional for a user; the PostgreSQL/MySQL drivers and their release proofs are mandatory for the supported dialects.

**Reversal Path**:
If Gate0 reveals a blocker, work stops and the blocker is recorded. Any stack
override after that blocker requires a new explicit owner decision; no alternate
runtime or language is authorized by this entry.

**Proof Spike Gates**:
- STK-001 through STK-006 must all pass on target platforms (macOS arm64, Linux x64/arm64).
- Bun-native runtime and database APIs must work on all target platforms, including the required PostgreSQL/MySQL drivers for the supported dialects.
- Every third-party ORM, validation, CLI, migration, build, or arithmetic package
  must have an exact approved version, dependency artifact/package integrity and
  checksum evidence, and a lockfile entry.
- If any spike reveals a blocker (e.g., Bun database incompatibility or missing
  decimal precision), the result is documented and any stack override is a new
  owner decision.

**Gate0 Prerequisite**:
- **Gate0 is mandatory and not authorized by this docs review**: STK-001
  through STK-006 must pass on target platforms (macOS arm64, Linux x64/arm64).
  At execution time, Gate0 must resolve the authoritative latest stable Bun
  release and record its exact version, `bun --revision`, official Bun artifact
  checksum(s), exact approved dependency versions, dependency artifact/package
  integrity and checksum evidence, lockfile, and version/checksum pins in CI and
  release metadata.
- **Blocking discovery**: If Gate0 reveals any blocker, the result is documented
  and work stops for a new owner decision. Proceeding without Gate0 passing and
  without the complete exact-version record is not authorized.
- **No implementation authorization**: T-011 selection and Gate0 passage are
  prerequisites, not approvals. Implementation authorization requires separate
  approval after Gate0 evidence is available and reviewed.

**Dependencies**:
- Proof spike results (STK-001 through STK-006) are prerequisites, not recommendations.
- Multi-database support requirement (settled in [decisions.md](decisions.md#confirmed)) drives ORM choice.
- CLI determinism (settled in [decisions.md](decisions.md#confirmed)) drives parser/exit-code precision needs.

**Evidence**:
- Bun documentation and ecosystem: https://bun.sh/ (type definitions, SQLite integration, ESM, Clipanion parser support).
- TypeScript: Industry standard for type-safe JavaScript; proven in countless CLI and backend projects.

**Owner Review Status**:
Owner-approved. TypeScript + Bun is selected as the language and runtime, with
Bun-native APIs first. The released executable must not require or invoke a
separately installed Node runtime, Node subprocess, Node lifecycle hook, separately
installed Bun runtime, Bun subprocess, or Bun lifecycle hook. This does not prohibit
proof-gated third-party packages bundled into the single executable, nor the packaged
`agent-bahi` binary being invoked by skills. Gate0 remains mandatory but is not
authorized by this docs review; it must pass with the exact Bun version, `bun --revision`,
official Bun artifact checksum(s), exact individually approved dependency versions,
dependency artifact/package integrity and checksum evidence, lockfile, and
CI/release pins recorded. Gate0 does not authorize implementation. If Gate0 reveals
a blocker, work stops and any stack override is a new explicit owner decision. No
implementation is authorized until Gate0 and the separate implementation approval
are complete.

---

## Personal Tax Decisions (PT-001 through PT-016)

**Personal Tax status:** PT-001, PT-002, PT-003, PT-004, PT-006, PT-008, PT-009, PT-011, PT-012, PT-013, and PT-015 are **OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. PT-005, PT-007, PT-010, PT-014, and PT-016 retain the exact status **TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. This index is documentation-only and authorizes no implementation.

All Personal Tax decisions are documented in the canonical discovery packet: [Personal Tax Discovery Packet](personal-tax-scope.md). Cross-link index:

| PT-ID | Title | Link |
|-------|-------|------|
| PT-001 | Individual/PAN Tenant Model with Multiple BookSets | [personal-tax-scope.md § PT-001](personal-tax-scope.md#pt-001) |
| PT-002 | BookSet-Owned Records with Tenant_ID + Book_Set_ID | [personal-tax-scope.md § PT-002](personal-tax-scope.md#pt-002) |
| PT-003 | Atomic Same-Tenant Inter-BookSet Transfer with Balanced Linked Legs | OWNER-APPROVED; NOT ARCHITECT-REVIEWED | [personal-tax-scope.md § PT-003](personal-tax-scope.md#pt-003) |
| PT-004 | Personal Bank, Investment/Tax-Lot, Property/Rent/Loan Subledgers | OWNER-APPROVED; NOT ARCHITECT-REVIEWED | [personal-tax-scope.md § PT-004](personal-tax-scope.md#pt-004) |
| PT-005 | ONE TaxCase/Return per Taxpayer/Year Covers ALL Applicable BookSets | [personal-tax-scope.md § PT-005](personal-tax-scope.md#pt-005) |
| PT-006 | Form Selection is Year-Specific and Fact-Driven | [personal-tax-scope.md § PT-006](personal-tax-scope.md#pt-006) |
| PT-007 | Bind Governing Act, Period, Trigger, and Four Official Bindings | [personal-tax-scope.md § PT-007](personal-tax-scope.md#pt-007) |
| PT-008 | Preserve Primary Artifacts; AIS Including TIS; 26AS; Reconcile Without Overwrite | [personal-tax-scope.md § PT-008](personal-tax-scope.md#pt-008) |
| PT-009 | Hashed File-First V1; No Credential Scraping/OTP/Browser Automation; AA Future | [personal-tax-scope.md § PT-009](personal-tax-scope.md#pt-009) |
| PT-010 | Progressive Source Readiness Model | [personal-tax-scope.md § PT-010](personal-tax-scope.md#pt-010) |
| PT-011 | GST Output Belongs to Business BookSet/GSTIN; Personal Label Alone Does Not Decide | [personal-tax-scope.md § PT-011](personal-tax-scope.md#pt-011) |
| PT-012 | TDS/TCS/Remittance Branches Effective-Dated by Role and Facts | [personal-tax-scope.md § PT-012](personal-tax-scope.md#pt-012) |
| PT-013 | ITR-Specific Portal States/Evidence; No Universal ARN | [personal-tax-scope.md § PT-013](personal-tax-scope.md#pt-013) |
| PT-014 | Status Tenant-Wide Read-Only; BookSet/TaxCase Separate; Mutations Fail Closed | [personal-tax-scope.md § PT-014](personal-tax-scope.md#pt-014) |
| PT-015 | No Product Telemetry; Protected Evidence/Secrets; TLS; Redacted Logs; No False Compliance Claims | [personal-tax-scope.md § PT-015](personal-tax-scope.md#pt-015) |
| PT-016 | Immutable Original + Linked Correction/Revised/Rectification Cases | [personal-tax-scope.md § PT-016](personal-tax-scope.md#pt-016) |

**Status**: PT-001, PT-002, PT-003, PT-004, PT-006, PT-008, PT-009, PT-011, PT-012, PT-013, and PT-015 are **OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. PT-005, PT-007, PT-010, PT-014, and PT-016 retain the exact status **TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. Canonical definitions are in [Personal Tax Discovery Packet](personal-tax-scope.md); no duplicate prose here. See that packet's [§ 4](personal-tax-scope.md#4-personal-tax-decisions-pt-001-through-pt-016) for detailed rationale, alternatives, risks, and reversal paths per decision.

---

## Relationship to Settled Decisions

Entries T-001 through T-011 extend and clarify settled decisions from [decisions.md](decisions.md#confirmed) and [architecture-decisions.md](architecture-decisions.md):

- **T-001** (now clarified): Establishes a fallback default for filing submission only where no filing-specific boundary exists. Does not override GSTR-1 or any filing-specific settled decision. Extends [GSTR-1-specific output boundary](decisions.md#confirmed) and [Government filing boundary](decisions.md#confirmed) as a generic template for undefined filings only.
- **T-002** settles MIT licensing and the Frappe Books study/reference-only boundary; no Frappe source, schema, prose, or assets are copied or adapted.
- **T-003** establishes the approved separate book/tax schedules and SLM book default for [Fixed assets](decisions.md#confirmed); only exact statutory tax methods and rates remain OPEN_RESEARCH.
- **T-004** extends [Multi-currency](decisions.md#confirmed) and [Exchange-rate source](decisions.md#confirmed) with original currency and immutable purpose-specific snapshots; missing statutory evidence affects only its compliance lane.
- **T-005** defines V1 no-registration and regular GST coverage, domestic/interstate/export, GST credit reconciliation, and e-invoice/e-way upload files. Direct transports remain research-gated; composition, specialized regimes, and inventory remain deferred.
- **T-006** (new): Partial completion is a distinct nonzero signal with per-item outcomes; numeric code remains internal/TBD (not exit code 9 without separate decision). Implementation contract (atomicity, when to exit 0/non-zero, JSON schema) is canonical in [CLI-004](architecture-decisions.md#cli-004-explicit-exit-code-taxonomy) and [CLI-006](architecture-decisions.md#cli-006-batch-atomicity-declared-per-operation).
- **T-007** (new): Full individual income-tax scope for sole proprietor owner, accounting-separated from business/GST books. Detailed personal-tax decisions (PT-001 through PT-016 with PT-004 now owner-approved) remain separately gated. Advance-tax behavior is NOT approved by this scope decision; preserve as tentative personal-tax research detail.
- **T-008** (new): Allow controlled user corrections/deletions after FY/report/audit/filing via preview/reason/confirmation/unlock. Use reversal/replacement, version or tombstone lineage. Prior artifacts remain immutable. Affected derived reports/filing/audit cases marked STALE/DRIFTED. No destructive overwrite or automatic government action. Supports [T-003](tentative-decisions.md#t-003) and fixed-asset module scope.
- **T-009** (migrated from statutory-workflow-contracts.md examples): Always allow text and CSV operator exports of prepared/validated data; do not invent arbitrary JSON as statutory artifact; government upload only after official current format/utility/schema/portal verification. Form 140/141 export is research-gated and deferred. Supports [TDS workflow contract](statutory-workflow-contracts.md#tds-workflow-contract-non-payroll-sections-393394).
- **T-010** (migrated from statutory-workflow-contracts.md examples): Preserve original filing, ARN/status/rejection/notices/evidence and explicit correction lineage; no unverified automatic revised/amended/defective-return submission. Return-amendment adapters are research-gated and deferred. Supports [Annual income-tax return contract](statutory-workflow-contracts.md#annual-income-tax-return-workflow-contract).
- **T-011** (new): TypeScript + Bun selected with Bun-native APIs first. Released executable must not require or invoke separately installed Node runtime, Node subprocess, Node lifecycle hook, separately installed Bun runtime, Bun subprocess, or Bun lifecycle hook. Does not prohibit proof-gated third-party packages bundled into single executable or packaged `agent-bahi` binary invoked by skills. Gate0 is mandatory but not authorized; at execution time it must resolve the authoritative latest stable Bun release and record the exact version, `bun --revision`, official Bun artifact checksum(s), exact individually approved dependency versions, dependency artifact/package integrity and checksum evidence, lockfile, and version/checksum pins in CI and release metadata. Any post-blocker stack override is a new owner decision, and no implementation is authorized until separate approval.

**None of these entries override settled decisions.** They provide implementation detail and working defaults for decisions that remain open or recommend future owner approval. Filing-specific settled decisions always override T-001.

---

## Approval and Change Control

- **Tentative entries may not be committed to code or presented as settled without owner review.**
- **Each tentative entry must include a path for owner override or reversal.**
- **Once owner approves an entry (or portion of it), it becomes a new SETTLED_OWNER_DECISION and is documented in [decisions.md](decisions.md#confirmed) or a new decision memo.**
- **Tentative entries are for documentation/discovery purposes only; they do not authorize implementation.**
