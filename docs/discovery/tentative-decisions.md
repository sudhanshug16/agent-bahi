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
### Entry T-002: Frappe Books as Behavior/Concept Reference Only

**Status**: OWNER-APPROVED

**Question**: To what extent should agent-bahi reference, adapt, or reuse Frappe Books concepts, code, or documentation?

**Recommended Working Default**:
- Frappe Books is a **behavior and concept reference only**. Agent-bahi does not copy source code, database schemas, UI patterns, prose, or assets from Frappe Books.
- Concepts from Frappe Books (e.g., India accounting principles, GST workflows) may inform design and research but are documented in agent-bahi's own words with proper attribution.
- No Frappe code or substantial prose is used; all documentation is agent-bahi's own discovery and design.
- **License implication**: Frappe Books is AGPL-3.0. Agent-bahi is recommended for Apache-2.0 to remain permissive for commercial use and agents/integrations.
- **License decision**: Do NOT add, change, or select a LICENSE file in this commit. Owner review and explicit approval are required before any license is finalized, given the AGPL history of Frappe.

**Alternatives**:
- Deep adaptation: Use Frappe Books schema, formulas, and patterns with AGPL-3.0 license (maintains legal compliance but restricts agent-bahi distribution and commercial agent use).
- No reference: Ignore Frappe Books entirely (loses valuable India compliance concepts and leaves design decisions ungrounded).
- Selective code reuse: Copy specific algorithms or rule packs (requires AGPL compliance and explicit license propagation).

**Rationale**:
Frappe Books is a mature accounting system with officially documented accounting
and GST behavior. Referencing only those documented Books behaviors helps
agent-bahi cover comparable accounting and GST requirements without treating
unsupported capabilities as vendor evidence. Copying code or prose creates
license obligations and makes it harder to evolve independently. Treating
Frappe Books as a reference for documented accounting and GST behavior allows
clean, independent design while preserving the distinction between vendor
evidence and agent-bahi's product choices. Apache-2.0 preserves agent-bahi's
freedom and enables unrestricted agent/integration ecosystems; AGPL-3.0 would
restrict these use cases.

**Product Impact**:
- Design quality: Documented Frappe Books accounting/GST behavior provides a bounded reference without attributing unsupported capabilities.
- Legal clarity: Reference-only approach + Apache-2.0 avoids GPL compliance obligations and enables commercial agents/integrations.
- Operational simplicity: No license attribution required for code/prose; attribution occurs only for conceptual inspiration.
- Future flexibility: Independent implementation allows divergence from Frappe if Indian compliance rules or agent-bahi requirements change.

**Reversal Path**:
Owner may approve AGPL-3.0 license after explicit business/legal review if compliance with GPL terms is acceptable. This would require:
1. Legal review and formal approval.
2. Update README and LICENSE file.
3. Update contribution guidelines.
4. Audit code and documentation for AGPL-compliant attribution.

Or, owner may request deeper Frappe integration (e.g., schema adoption) after similar review. The reference-only default allows owner to make this choice later without architectural lock-in.

**Dependencies**:
- No dependencies on other settled decisions. This is independent of filing workflows, compliance rules, or architecture.
- Affects only documentation tone and license choice, not functional design.

**Evidence**:
- Frappe Books is AGPL-3.0; verifiable at https://github.com/frappe/books.
- Apache-2.0 is used by other accounting projects (Wave, Invoice Ninja OSS distributions) and enables unrestricted commercial agent use.
- Frappe Books accounting and GST behavior is documented publicly; this entry
  relies only on those documented Books capabilities.
- [Zoho Books and Frappe Books Feature Parity Matrix](zoho-frappe-parity.md) documents Frappe Books AGPL-3.0 license and compares feature parity with Zoho Books, confirming Frappe as concept/behavior reference only.

**Owner Review Status**:
Owner-approved. Frappe Books is reference-only for behavior and concepts; no source code, schema, prose, or assets are copied or adapted from it. Agent-bahi's documentation is independent and cites external references appropriately. Apache-2.0 license recommendation remains subject to explicit approval; this entry establishes the reference-only policy and rationale for Apache-2.0 to enable commercial agent/integration use.

---

<a id="t-003"></a>
### Entry T-003: Fixed-Asset Depreciation Schedules—Book vs. Tax with Tentative SLM Default

**Status**: OWNER-APPROVED

The separate book/tax schedule model is owner-approved. This entry establishes
the separate-schedule architecture with SLM as the default book method and
statutory rule-pack-driven tax method. Specific depreciation rates, method
overrides, and rule-pack contents remain research-gated; this entry does not
lock tax rates or method specifics.

**Question**: How should book and tax depreciation be modeled and calculated in the fixed-asset module?

**Recommended Working Default**:
- Separate book-depreciation and tax-depreciation schedules per asset (a
  reversible product design recommendation, **TENTATIVE - NOT OWNER-APPROVED**).
- **Book method**: Configurable per asset or tenant-wide. **Tentative default**: Straight-line (SLM) with user-specified useful life and salvage value.
- **Tax method**: Follows effective statutory rule packs indexed by financial year, jurisdiction, and asset class (e.g., block assets, plant, buildings). User selects applicable tax rule pack (or defaults to current year); depreciation is computed deterministically from the rule pack.
- **Depreciation runs**: Monthly pro-rata SLM for book; deterministic statutory monthly/quarterly accrual for tax based on rule pack.
- **Reconciliation**: Separate book/tax schedules enable period-end variance analysis (book vs. tax differences).
- **Storage**: Asset master records book method (SLM params) and active tax rule-pack reference; monthly depreciation/accrual lines link to both schedules. This storage/model choice is reversible and does not claim vendor parity.

**Alternatives**:
- Single depreciation method (book and tax identical): Violates India compliance requirements (book is often SLM; tax is often WDV or block asset rules).
- User-configurable tax method: High operational risk (users may select wrong rule pack) and requires extensive tax research per class/year.
- Separate asset tables (book assets vs. tax assets): Couples data model and adds complexity; reconciliation is harder.

**Rationale**:
India accounting and tax compliance require separate book and tax depreciation (Companies Act vs. Income-tax Act). Book method is typically SLM (simpler, predictable); tax method is statutory (block assets, WDV, or specific asset class rules). Separating schedules allows clean, auditable reconciliation. Tentative SLM default for book is a working recommendation (NOT CONFIRMED as Zoho Books feature); tax rules are deterministic and must be maintained in a compliance-rules package (separate OPEN_RESEARCH item). Monthly pro-rata SLM is realistic for India reporting cycles (monthly trials, quarterly compliance). Zoho's separate book/tax depreciation capability is NOT CONFIRMED from official documentation; this remains a product design choice, not vendor evidence.

**Product Impact**:
- Compliance readiness: Separate book/tax schedules support India's dual-reporting requirements.
- Audit clarity: Book/tax variance is transparent and reconcilable.
- Operational complexity: Monthly depreciation runs add overhead vs. annual runs. However, monthly pro-rata is more accurate for mid-year additions and disposals.
- Tax research dependency: Exact tax rule packs remain open research; implementation cannot proceed without statutory rates and asset-class rules.

**Reversal Path**:
The separate book/tax schedule model and its working default are reversible.
Owner may replace a method or rule-pack choice through a new version and
superseding schedule; posted history and prior schedules remain immutable and
linked by correction lineage. Any tax method change still requires tax
research closure and rule-pack updates before use. If a book method changes,
existing asset schedules must be audited for impact on prior-year reporting.

**Dependencies**:
- Fixed-asset module (Phase scope: ARC-012 in architecture-decisions.md).
- Open research: "Fixed-asset depreciation methods" in [architecture-decisions.md](architecture-decisions.md#open-research--deferred-list).
- Effective-dated compliance rules engine (required for tax rule packs per year/class).

**Evidence**:
- India Companies Act (2013) Schedule II: SLM is standard for book depreciation.
- Income-tax Act schedules and old/new regime rates: WDV, block assets, specific class rules (e.g., buildings 40 years SLM, plant 15 years WDV).
- Zoho Books officially documents depreciation methods, but separate book/tax
  schedules and configurable SLM/tax-rule selection are **NOT CONFIRMED**.

**Owner Review Status**:
Owner-approved. Separate book/tax schedules and SLM as the default book method are settled. Tax rule-pack selection remains OPEN_RESEARCH; implementation is gated by research closure and statutory rule snapshot. If owner has specific depreciation method requirements (e.g., accelerated depreciation for certain asset classes), those are documented in tax rule-pack research and applied via effective-dated rules.

---

<a id="t-004"></a>
### Entry T-004: Exchange-Rate Provider and FX Workflow—Tentative/Open Pending Source Audit

**Status**: OWNER-APPROVED (with significant OPEN_RESEARCH component)

**Question**: Which exchange-rate source (RBI, bank rates, market rates, third-party API) should agent-bahi use for multi-currency transactions, and how should rates be selected and recorded?

**Recommended Working Default**:
- **Rate capture**: Every foreign-currency invoice, bill, payment, and FX transaction records an immutable **document-rate snapshot** at transaction time (already settled in [decisions.md](decisions.md#confirmed)).
- **Rate source**: Document-rate snapshot includes `rate_source` (e.g., "RBI EOD 2026-08-20", "Bank Statement", "Manual Override") and `rate_source_timestamp`.
- **Configurable default source**: Tenant configuration specifies a default rate source (e.g., "RBI EOD"). When user does not specify a rate, the default source is queried; if unavailable (e.g., holiday, API outage), an explicit fallback source (e.g., bank rate, manual input) is required.
- **Fallback chain**: Default → secondary source (e.g., bank rate) → manual override. Each fallback step is explicit and recorded.
- **No auto-selection of multiple rates**: Do not silently use today's rate if the document is dated yesterday. Use document date rate or require explicit user/operator selection.
- **Rate lock at posting**: Once a document is posted, the recorded rate is immutable; period-end revaluation creates an explicit adjustment entry (not a rate mutation).
- **Exact rate source/provider remains tentative**: Which specific provider (RBI.org ICP API, RBI bulletin, Bank Statement, third-party aggregator, spot market) is authoritative is **OPEN_RESEARCH** pending a dedicated source audit.

**Alternatives**:
- Single mandatory source (e.g., RBI only): Brittle if source is unavailable; no fallback.
- Automatic rate selection from multiple sources (e.g., "use the lowest of RBI/bank/market"): Introduces arbitrage risk and unclear audit trail.
- Manual-only rates: High operator friction and audit risk (rates must be verified per external document).
- Market-based spot rates (e.g., Reuters): High cost, external dependency, not standard for accounting (books typically use official rates).

**Rationale**:
Immutable document-rate snapshots (settled) prevent rate restatement and enable audit. A configurable default source with explicit fallback provides automation while retaining control. India accounting typically uses RBI EOD rates (official source), but businesses also use bank statement rates (actual settlement rate) or manual rates (for inter-company or non-standard currencies). Separate rate-source audit is required to determine which source(s) are authoritative and how to handle source unavailability. Without this research, a tentative multi-source approach with fallback is safest.

**Product Impact**:
- Audit clarity: Immutable rate snapshots with source provenance are auditable.
- Automation opportunity: Default source auto-selection reduces operator friction if source is stable and available.
- Operational risk: If chosen rate source becomes unavailable (API outage, portal down), explicit fallback is required.
- Compliance risk: Some tax authorities may prescribe specific rate sources (e.g., RBI EOD); this is part of OPEN_RESEARCH.
- FX reporting: Separate realized (posting-time) and unrealized (period-end revaluation) exchange gain/loss is deterministic and auditable.

**Reversal Path**:
Owner may settle a specific rate source (e.g., "RBI EOD only", "Bank Statement only", or "Lowest of RBI and Bank") after dedicated source audit. This changes the default source and fallback chain but does not affect the immutable-snapshot structure. Existing transactions retain their recorded rates; rate-source changes affect new transactions going forward.

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
Owner-approved for the immutable document-rate snapshot architecture and configurable default-source pattern with explicit fallback chain. No specific rate provider is locked; the multi-source fallback pattern is approved and stable. Once research determines authoritative source(s) (OPEN_RESEARCH), owner may refine the default configuration. Existing transactions' recorded rates remain immutable regardless of future default changes.

---

<a id="t-005"></a>
<a id="entry-t-005-v1-scope-focus-regular-small-business-gst-accounting-profiles"></a>
<a id="entry-t-005-v1-scope-focus—regular-small-business-gst-accounting-profiles"></a>
### Entry T-005: V1 Scope Focus—Regular Small-Business GST/Accounting Profiles

**Status**: OWNER-APPROVED

**Question**: Which business profile and tax regimes should V1 prioritize in its coverage roadmap and testing?

**Recommended Working Default**:
- **V1 Primary Target**: Regular (non-composition) small-business GST taxpayers in India with annual turnover below ₹50 crore (rough guidance; not a strict gate).
  - Regular GST registration (GST/registered supplier).
  - GSTR-1 filing (B2B/B2C, service, goods).
  - GSTR-3B reconciliation and manual portal filing.
  - Invoicing, billing, payment, expense, and basic payroll workflows.
  - E-invoice adapters (CMP-006) and e-way-bill adapters (CMP-007): **RESEARCH-GATED and DEFERRED**. Until applicability/transport/state research is complete and Sudhanshu approves, these remain non-V1 and must not be invoked or assumed in V1 operations. See [architecture-decisions.md](architecture-decisions.md#cmp-006-e-invoice-default-irp-via-configured-adapter) and [architecture-decisions.md](architecture-decisions.md#cmp-007-e-way-bill-default-configured-api-with-state-specific-rules-open-research).
  - No composition scheme, no simplified scheme.
  - No inter-state supply complexity in V1 focus (but multi-GSTIN model supports it).

- **Out of V1 Scope** (documented as deferred/future research):
  - Composition taxpayers (CMP-08, GSTR-4, deemed ITC rules).
  - Simplified scheme (turnover-based exemption, limited GSTR-1).
  - Unregistered suppliers (nil GSTR, cash accounting).
  - E-invoice mandatory applicability and exemptions (OPEN_RESEARCH; CMP-006 adapter deferred).
  - E-way bill (OPEN_RESEARCH; CMP-007 adapter deferred).
  - Multi-state inventory/supply chains (model supports it; workflows may be deferred).
  - Specific industry compliance (finance, insurance, import/export, customs, etc.).

- **Unverified Transports** (gated as explicit deferred/open, not silently assumed):
  - Portal APIs (except GSTR-1 manual filing evidence recording, which is settled).
  - IRP credentials and e-invoice submission (CMP-006 research-gated).
  - E-way-bill API and state-specific rules (CMP-007 research-gated).
  - Bank auto-sync or auto-import.
  - Employee self-service portals, leave/attendance, HRMS.
  - Inventory, stock movements, manufacturing.

**Alternatives**:
- Broad scope from day one: Composition, simplified, unregistered, multi-state, e-invoice, e-way bill all in V1 (scope explosion, incomplete research, delayed delivery).
- Narrow scope (micro-businesses only, no multi-GSTIN, no payroll): Misses Sudhanshu's scale and compliance requirements.
- Marketplace/SaaS focus (multi-tenant, API-first): Defers CLI-first determinism and agent integration.

**Rationale**:
Sudhanshu operates three legal entities (two private limited companies, one sole proprietorship), likely in the ₹5-50 crore range (estimate from domain context). Regular GST, GSTR-1, and GSTR-3B are the core compliance obligations; these are well-documented and achieve high business value. Deferring composition, simplified, and unregistered schemes focuses V1 on a cohesive, auditable baseline. Unverified transports (e-invoice, e-way bill, portal APIs) are explicitly gated as open research, so they remain DEFERRED, not silently assumed. This prevents scope creep and ensures V1 delivers a complete, testable accounting system for the primary use case.

**Product Impact**:
- Faster V1 delivery: Focused scope enables earlier production use.
- Clearer testing: Primary business profile is well-defined; golden test scenarios are grounded.
- Completeness: V1 covers invoicing, billing, GST, payroll, and expense workflows end-to-end for the target profile.
- Future extensibility: Multi-GSTIN, effective-dated rules, and modular architecture support composition/simplified/etc. as future phases.
- Research parallelization: E-invoice, e-way bill, composition, and other deferred items can be researched in parallel without blocking V1 delivery.

**Reversal Path**:
Owner may expand V1 scope to composition or simplified schemes by:
1. Closing research items (CMP-08 rules, GSTR-4 requirements).
2. Extending effective-dated rule packs.
3. Testing composition/simplified workflows against golden fixtures.
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
Owner-approved. V1 scope is locked to regular-GST small-business profile (annual turnover below ₹50 crore guidance): regular GST registration, GSTR-1 output, GSTR-3B reconciliation, invoicing, billing, payment, expense, and basic payroll workflows. Composition scheme, simplified scheme, unregistered suppliers, and multi-state complexity are explicitly out of V1 scope. E-invoice and e-way-bill adapters remain **RESEARCH-GATED and DEFERRED** (not V1-approved); see [architecture-decisions.md § CMP-006](architecture-decisions.md#cmp-006-e-invoice-default-irp-via-configured-adapter) and [§ CMP-007](architecture-decisions.md#cmp-007-e-way-bill-default-configured-api-with-state-specific-rules-open-research) for their research gates.

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
Detailed technical decisions for personal-tax implementation (PT-001 through PT-016) remain separately gated and documented in [Personal Tax Discovery Packet](personal-tax-scope.md). PT-001 (tenant model) and PT-009 (file-first data handling) are owner-approved/not-architect-reviewed; PT-002 through PT-008 and PT-010 through PT-016 remain TENTATIVE - NOT OWNER-APPROVED and require separate review.

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
Owner-approved for full individual income-tax scope linked to but accounting-separated from business/GST books. Detailed personal-tax implementation decisions (PT-001 through PT-016) remain separately gated. Advance-tax behavior and other specific method choices are NOT approved by T-007 and remain tentative within personal-tax research.

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
### Entry T-011: Initial Language and Runtime—TypeScript + Bun (Recommended; Gate0 Proof Spikes Required)

**Status**: OWNER-APPROVED

**Question**: What programming language and runtime should agent-bahi use for the initial implementation?

**Exact Meaning and Binding Status**: T-011 establishes TypeScript + Bun as the selected language/runtime for agent-bahi. This is not approval of implementation, any specific library/tool choice, or library preapproval. Gate0 proof spikes (STK-001 through STK-006) are a hard prerequisite for validation of dependency/platform/database/arithmetic correctness and must pass before implementation is authorized. Gate0 remains a mandatory validation gate, not approval of the stack selection; it is not authorized by this docs review. If Gate0 later reveals a blocker, work stops and returns to the owner for override decision.

**Selected Stack and Gate0 Prerequisite**:
- **Selected**: TypeScript + Bun (modern, fast, ESM-native, built-in package/workspace management, native SQLite support via `better-sqlite3` or Bun's own driver). This does not pre-approve those libraries or any other dependency.
- **Proof spikes (Gate0) validate all major dependencies before implementation authorization**:
  - STK-001: Bun runtime, workspaces, lockfile (macOS arm64, Linux x64/arm64).
  - STK-002: ORM (Drizzle/Kysely) on bun-sqlite, PostgreSQL, MySQL; schema equivalence verified.
  - STK-003: SQLite pragmas, WAL, foreign_keys=ON, SQLITE_BUSY handling, network-filesystem rejection.
  - STK-004: Schema migrations and upgrade paths on all three dialects.
  - STK-005: Zod validation, JSON schema generation, Clipanion parser, decimal.js precision (INR/paise, FX, tax).
  - STK-006: ESM build, platform binaries, database drivers (MySQL/PostgreSQL optional).
- **Gate0 is a mandatory prerequisite, not authorized by this docs review**. Gate0 must pass on all platforms (macOS arm64, Linux x64/arm64) before implementation is authorized. If Gate0 reveals blockers, work stops and returns to the owner for override decision.

**Alternatives**:
- Node.js + TypeScript (mature ecosystem; slower cold startup, larger binaries; established JavaScript CI/CD tooling).
- Rust (performance, static typing; steeper learning curve; different module/CLI ecosystem; slower compile times during development).
- Other JVM languages (Java, Kotlin, Scala): Heavy runtime; not recommended for CLI tool distribution.

**Rationale**:
Bun is a modern JavaScript runtime designed for tooling (CLI, scripts, backend services) with native TypeScript support, integrated package management, and optimized SQLite integration. TypeScript provides type safety and reduces runtime errors in domain logic and compliance calculations. Gate0 proof spikes validate whether the candidate ecosystem and dependencies work reliably on all target platforms and with all supported databases (SQLite, PostgreSQL, MySQL). This is a working default for documentation and Phase 1 planning only; it is not a binding technology lock or library preapproval.

**Product Impact**:
- **Development velocity**: Bun's built-in features (TypeScript, package management, testing) reduce toolchain complexity.
- **Deployment simplicity**: ESM build produces portable binaries; single platform-specific executable per OS/arch.
- **Type safety**: TypeScript catches many errors at build time; domain logic is verifiable.
- **Multi-database support**: Proof spikes validate ORM cross-dialect equivalence (SQLite default, PostgreSQL/MySQL optional).

**Reversal Path**:
Owner may select Node.js + TypeScript or Rust after Gate0 results. Node.js selection keeps TypeScript and changes only the runtime (mature ecosystem, larger cold-start footprint). Rust selection requires different language, module system, and CLI design. The owner decision must be made before Phase 1 implementation begins; mid-implementation language switches are prohibitively expensive.

**Proof Spike Gates**:
- STK-001 through STK-006 must all pass on target platforms (macOS arm64, Linux x64/arm64).
- All ORM, validation, CLI, migration, and build tooling must work identically across Bun, SQLite/PostgreSQL/MySQL, and all platforms.
- If any spike reveals a blocker (e.g., Bun ORM incompatibility with PostgreSQL, missing decimal precision library), result is documented and owner makes override decision.

**Gate0 Prerequisite**:
- **Gate0 is mandatory and not authorized by this docs review**: STK-001 through STK-006 must all pass on target platforms (macOS arm64, Linux x64/arm64) to validate dependency/platform/database/arithmetic correctness.
- **Blocking discovery**: If Gate0 reveals any blocker (e.g., Bun ORM incompatibility, missing decimal precision, platform incompatibility), result is documented and work stops for owner override decision. Proceeding without Gate0 passing is not authorized.
- **No implementation authorization**: T-011 selection and Gate0 passage are prerequisites, not approvals. Implementation authorization requires separate approval after Gate0 evidence is available and reviewed.

**Dependencies**:
- Proof spike results (STK-001 through STK-006) are prerequisites, not recommendations.
- Multi-database support requirement (settled in [decisions.md](decisions.md#confirmed)) drives ORM choice.
- CLI determinism (settled in [decisions.md](decisions.md#confirmed)) drives parser/exit-code precision needs.

**Evidence**:
- Bun documentation and ecosystem: https://bun.sh/ (type definitions, SQLite integration, ESM, Clipanion parser support).
- Drizzle ORM: Supports Bun + SQLite/PostgreSQL/MySQL; multi-dialect spike (STK-002) validates before commitment.
- Kysely: Fallback ORM; also supports all three databases.
- TypeScript: Industry standard for type-safe JavaScript; proven in countless CLI and backend projects.

**Owner Review Status**:
Owner-approved. TypeScript + Bun is selected as the language and runtime for agent-bahi. Gate0 proof spikes (STK-001 through STK-006) are a mandatory prerequisite for validating dependency/platform/database/arithmetic correctness; Gate0 is not authorized by this docs review and must pass before implementation. If Gate0 reveals blockers, work stops and returns to owner for override decision. No implementation is authorized until Gate0 passes and implementation readiness conditions are satisfied.

---

## Personal Tax Decisions (PT-001 through PT-016)

**Personal Tax status:** PT-001 and PT-009 are **OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. PT-002 through PT-008 and PT-010 through PT-016 retain the exact status **TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. This index is documentation-only and authorizes no implementation.

All Personal Tax decisions are documented in the canonical discovery packet: [Personal Tax Discovery Packet](personal-tax-scope.md). Cross-link index:

| PT-ID | Title | Link |
|-------|-------|------|
| PT-001 | Individual/PAN Tenant Model with Multiple BookSets | [personal-tax-scope.md § PT-001](personal-tax-scope.md#pt-001) |
| PT-002 | BookSet-Owned Records with Tenant_ID + Book_Set_ID | [personal-tax-scope.md § PT-002](personal-tax-scope.md#pt-002) |
| PT-003 | Atomic Same-Tenant Inter-BookSet Transfer with Balanced Linked Legs | [personal-tax-scope.md § PT-003](personal-tax-scope.md#pt-003) |
| PT-004 | Personal Bank, Investment/Tax-Lot, Property/Rent/Loan Subledgers | [personal-tax-scope.md § PT-004](personal-tax-scope.md#pt-004) |
| PT-005 | ONE TaxCase/Return per Taxpayer/Year Covers ALL Applicable BookSets | [personal-tax-scope.md § PT-005](personal-tax-scope.md#pt-005) |
| PT-006 | Form Selection is Year-Specific and Fact-Driven | [personal-tax-scope.md § PT-006](personal-tax-scope.md#pt-006) |
| PT-007 | Bind Governing Act, Period, Trigger, Schema, and Rule Snapshot | [personal-tax-scope.md § PT-007](personal-tax-scope.md#pt-007) |
| PT-008 | Preserve Primary Artifacts; AIS Including TIS; 26AS; Reconcile Without Overwrite | [personal-tax-scope.md § PT-008](personal-tax-scope.md#pt-008) |
| PT-009 | Hashed File-First V1; No Credential Scraping/OTP/Browser Automation; AA Future | [personal-tax-scope.md § PT-009](personal-tax-scope.md#pt-009) |
| PT-010 | Progressive Source Readiness Model | [personal-tax-scope.md § PT-010](personal-tax-scope.md#pt-010) |
| PT-011 | GST Output Belongs to Business BookSet/GSTIN; Personal Label Alone Does Not Decide | [personal-tax-scope.md § PT-011](personal-tax-scope.md#pt-011) |
| PT-012 | TDS/TCS/Remittance Branches Effective-Dated by Role and Facts | [personal-tax-scope.md § PT-012](personal-tax-scope.md#pt-012) |
| PT-013 | ITR-Specific Portal States/Evidence; No Universal ARN | [personal-tax-scope.md § PT-013](personal-tax-scope.md#pt-013) |
| PT-014 | Status Tenant-Wide Read-Only; BookSet/TaxCase Separate; Mutations Fail Closed | [personal-tax-scope.md § PT-014](personal-tax-scope.md#pt-014) |
| PT-015 | No Product Telemetry; Protected Evidence/Secrets; TLS; Redacted Logs; No False Compliance Claims | [personal-tax-scope.md § PT-015](personal-tax-scope.md#pt-015) |
| PT-016 | Immutable Original + Linked Correction/Revised/Rectification Cases | [personal-tax-scope.md § PT-016](personal-tax-scope.md#pt-016) |

**Status**: PT-001 and PT-009 are **OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. PT-002 through PT-008 and PT-010 through PT-016 retain the exact status **TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. Canonical definitions are in [Personal Tax Discovery Packet](personal-tax-scope.md); no duplicate prose here. See that packet's [§ 4](personal-tax-scope.md#4-personal-tax-decisions-pt-001-through-pt-016) for detailed rationale, alternatives, risks, and reversal paths per decision.

---

## Relationship to Settled Decisions

Entries T-001 through T-011 extend and clarify settled decisions from [decisions.md](decisions.md#confirmed) and [architecture-decisions.md](architecture-decisions.md):

- **T-001** (now clarified): Establishes a fallback default for filing submission only where no filing-specific boundary exists. Does not override GSTR-1 or any filing-specific settled decision. Extends [GSTR-1-specific output boundary](decisions.md#confirmed) and [Government filing boundary](decisions.md#confirmed) as a generic template for undefined filings only.
- **T-002** clarifies the open-source/license context not yet formalized in settled decisions.
- **T-003** is the first detailed entry for [Fixed assets](decisions.md#confirmed) (RECOMMENDED in ARC-012).
- **T-004** is the first detailed implementation entry for [Multi-currency](decisions.md#confirmed) and [Exchange-rate source](decisions.md#confirmed) (OPEN RESEARCH).
- **T-005** clarifies V1 scope in support of settled [Engine ownership](decisions.md#confirmed), [Automation policy](decisions.md#confirmed), and [Multi-GSTIN tenant modeling](decisions.md#confirmed). E-invoice and e-way-bill adapters (CMP-006, CMP-007) are explicitly **RESEARCH-GATED and DEFERRED**, not V1-authorized; see [architecture-decisions.md](architecture-decisions.md#cmp-006-e-invoice-default-irp-via-configured-adapter) and [architecture-decisions.md](architecture-decisions.md#cmp-007-e-way-bill-default-configured-api-with-state-specific-rules-open-research) for research gates.
- **T-006** (new): Partial completion is a distinct nonzero signal with per-item outcomes; numeric code remains internal/TBD (not exit code 9 without separate decision). Implementation contract (atomicity, when to exit 0/non-zero, JSON schema) is canonical in [CLI-004](architecture-decisions.md#cli-004-explicit-exit-code-taxonomy) and [CLI-006](architecture-decisions.md#cli-006-batch-atomicity-declared-per-operation).
- **T-007** (new): Full individual income-tax scope for sole proprietor owner, accounting-separated from business/GST books. Detailed personal-tax decisions (PT-001 through PT-016) remain separately gated. Advance-tax behavior is NOT approved by this scope decision; preserve as tentative personal-tax research detail.
- **T-008** (new): Allow controlled user corrections/deletions after FY/report/audit/filing via preview/reason/confirmation/unlock. Use reversal/replacement, version or tombstone lineage. Prior artifacts remain immutable. Affected derived reports/filing/audit cases marked STALE/DRIFTED. No destructive overwrite or automatic government action. Supports [T-003](tentative-decisions.md#t-003) and fixed-asset module scope.
- **T-009** (migrated from statutory-workflow-contracts.md examples): Always allow text and CSV operator exports of prepared/validated data; do not invent arbitrary JSON as statutory artifact; government upload only after official current format/utility/schema/portal verification. Form 140/141 export is research-gated and deferred. Supports [TDS workflow contract](statutory-workflow-contracts.md#tds-workflow-contract-non-payroll-sections-393394).
- **T-010** (migrated from statutory-workflow-contracts.md examples): Preserve original filing, ARN/status/rejection/notices/evidence and explicit correction lineage; no unverified automatic revised/amended/defective-return submission. Return-amendment adapters are research-gated and deferred. Supports [Annual income-tax return contract](statutory-workflow-contracts.md#annual-income-tax-return-workflow-contract).
- **T-011** (new): TypeScript + Bun selected. Gate0 proof spikes (STK-001 through STK-006) are mandatory prerequisite (not authorized by docs review) to validate platform/database/arithmetic correctness on all target platforms (macOS arm64, Linux x64/arm64). If Gate0 reveals blockers, work stops for owner override decision. No implementation authorized until Gate0 passes.

**None of these entries override settled decisions.** They provide implementation detail and working defaults for decisions that remain open or recommend future owner approval. Filing-specific settled decisions always override T-001.

---

## Approval and Change Control

- **Tentative entries may not be committed to code or presented as settled without owner review.**
- **Each tentative entry must include a path for owner override or reversal.**
- **Once owner approves an entry (or portion of it), it becomes a new SETTLED_OWNER_DECISION and is documented in [decisions.md](decisions.md#confirmed) or a new decision memo.**
- **Tentative entries are for documentation/discovery purposes only; they do not authorize implementation.**
