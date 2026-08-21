# Tentative Decisions and Overnight Protocol

This document records overnight planning decisions that establish working defaults while the owner is unavailable. Entries distinguish between truly settled decisions, tentative agent-selected defaults awaiting owner review, open research questions requiring external verification, and internal architectural choices that do not require owner approval.

## Status Semantics

**SETTLED_OWNER_DECISION**: Explicitly approved by Sudhanshu and documented in [decisions.md](decisions.md). These are binding and may only be changed through owner review and explicit new decision.

**TENTATIVE_AGENT_DEFAULT**: A planning default selected by workers/agents to unblock daily development while the owner is unavailable. Not owner-approved. Must include explicit owner-review status, evidence for the choice, product impact, and a reversal path so the owner can change the default without architectural breakage. Every tentative entry includes a clear path for the owner to override.

**OPEN_RESEARCH**: An external fact (law, portal specification, runtime requirement) that cannot be decided by preference. Requires official primary sources or field verification before gate satisfaction. Remains open until explicit research closure.

**INTERNAL_ARCHITECTURE_DECISION**: A reversible technical choice about implementation structure, sequencing, or interface boundaries that does not require owner business approval because it is implementation-internal and does not change settled product or compliance behavior. Examples: Phase 2 defines contracts before Phase 3 implements; discovery doc structure; internal code patterns.

---

## Initial Tentative Entries

### Entry T-001: External Statutory Submissions Workflow

**Status**: TENTATIVE_AGENT_DEFAULT

**Question**: How should external statutory submissions (GST, TDS, income-tax, MCA, etc.) be handled in the absence of filing-specific adapter implementation?

**Recommended Working Default**:

For all external statutory submissions except GSTR-1 (which has a settled specific boundary in [decisions.md](decisions.md#confirmed)):
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
Awaiting owner review. This is a working default to unblock skill architecture documentation and Phase 1 design (e.g., what CLI commands are required for export). Owner may override this default for any specific filing by approving a filed-specific adapter after dedicated research.

---

### Entry T-002: Frappe Books as Behavior/Concept Reference Only

**Status**: TENTATIVE_AGENT_DEFAULT

**Question**: To what extent should agent-bahi reference, adapt, or reuse Frappe Books concepts, code, or documentation?

**Recommended Working Default**:
- Frappe Books is a **behavior and concept reference only**. Agent-bahi does not copy source code, database schemas, UI patterns, prose, or assets from Frappe Books.
- Concepts from Frappe Books (e.g., India accounting principles, GST workflows, fixed-asset patterns) may inform design and research but are documented in agent-bahi's own words with proper attribution.
- No Frappe code or substantial prose is used; all documentation is agent-bahi's own discovery and design.
- **License implication**: Frappe Books is AGPL-3.0. Agent-bahi is recommended for Apache-2.0 to remain permissive for commercial use and agents/integrations.
- **License decision**: Do NOT add, change, or select a LICENSE file in this commit. Owner review and explicit approval are required before any license is finalized, given the AGPL history of Frappe.

**Alternatives**:
- Deep adaptation: Use Frappe Books schema, formulas, and patterns with AGPL-3.0 license (maintains legal compliance but restricts agent-bahi distribution and commercial agent use).
- No reference: Ignore Frappe Books entirely (loses valuable India compliance concepts and leaves design decisions ungrounded).
- Selective code reuse: Copy specific algorithms or rule packs (requires AGPL compliance and explicit license propagation).

**Rationale**:
Frappe Books is a mature India accounting system with documented GST, payroll, and fixed-asset workflows. Referencing its behavior ensures agent-bahi covers similar compliance gaps and reuses proven patterns. However, copying code or prose creates license obligations and makes it harder to evolve independently. Treating it as a reference allows clean, independent design while learning from proven implementations. Apache-2.0 preserves agent-bahi's freedom and enables unrestricted agent/integration ecosystems; AGPL-3.0 would restrict these use cases.

**Product Impact**:
- Design quality: Frappe reference ensures India compliance patterns are not reinvented.
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
- India GST/payroll patterns in Frappe Books are documented and publicly available (e.g., GST return structure, statutory compliance gates).

**Owner Review Status**:
Awaiting owner review. Do not commit any LICENSE file changes. This entry documents the reasoning for Apache-2.0 recommendation so owner can approve/reject the license choice in a separate decision. If owner approves a different license (AGPL-3.0, MIT, other), that becomes a new SETTLED_OWNER_DECISION.

---

### Entry T-003: Fixed-Asset Depreciation Schedules—Book vs. Tax with Tentative SLM Default

**Status**: TENTATIVE_AGENT_DEFAULT

**Question**: How should book and tax depreciation be modeled and calculated in the fixed-asset module?

**Recommended Working Default**:
- Separate book-depreciation and tax-depreciation schedules per asset.
- **Book method**: Configurable per asset or tenant-wide. **Tentative default**: Straight-line (SLM) with user-specified useful life and salvage value.
- **Tax method**: Follows effective statutory rule packs indexed by financial year, jurisdiction, and asset class (e.g., block assets, plant, buildings). User selects applicable tax rule pack (or defaults to current year); depreciation is computed deterministically from the rule pack.
- **Depreciation runs**: Monthly pro-rata SLM for book; deterministic statutory monthly/quarterly accrual for tax based on rule pack.
- **Reconciliation**: Separate book/tax schedules enable period-end variance analysis (book vs. tax differences).
- **Storage**: Asset master records book method (SLM params) and active tax rule-pack reference; monthly depreciation/accrual lines link to both schedules.

**Alternatives**:
- Single depreciation method (book and tax identical): Violates India compliance requirements (book is often SLM; tax is often WDV or block asset rules).
- User-configurable tax method: High operational risk (users may select wrong rule pack) and requires extensive tax research per class/year.
- Separate asset tables (book assets vs. tax assets): Couples data model and adds complexity; reconciliation is harder.

**Rationale**:
India accounting and tax compliance require separate book and tax depreciation (Companies Act vs. Income-tax Act). Book method is typically SLM (simpler, predictable); tax method is statutory (block assets, WDV, or specific asset class rules). Separating schedules allows clean, auditable reconciliation. Tentative SLM default for book is standard practice in Zoho Books and enterprise accounting systems; tax rules are deterministic and must be maintained in a compliance-rules package (separate OPEN_RESEARCH item). Monthly pro-rata SLM is realistic for India reporting cycles (monthly trials, quarterly compliance).

**Product Impact**:
- Compliance readiness: Separate book/tax schedules support India's dual-reporting requirements.
- Audit clarity: Book/tax variance is transparent and reconcilable.
- Operational complexity: Monthly depreciation runs add overhead vs. annual runs. However, monthly pro-rata is more accurate for mid-year additions and disposals.
- Tax research dependency: Exact tax rule packs remain open research; implementation cannot proceed without statutory rates and asset-class rules.

**Reversal Path**:
Owner may change book method (e.g., declining-balance, MACRS for specific assets) by adjusting asset master and depreciation logic. Tax method is not reversible without tax research closure and rule-pack updates. If book method changes, existing asset schedules must be audited for impact on prior-year reporting.

**Dependencies**:
- Fixed-asset module (Phase scope: ARC-012 in architecture-decisions.md).
- Open research: "Fixed-asset depreciation methods" in [architecture-decisions.md](architecture-decisions.md#open-research--deferred-list).
- Effective-dated compliance rules engine (required for tax rule packs per year/class).

**Evidence**:
- India Companies Act (2013) Schedule II: SLM is standard for book depreciation.
- Income-tax Act schedules and old/new regime rates: WDV, block assets, specific class rules (e.g., buildings 40 years SLM, plant 15 years WDV).
- Zoho Books: Separate book/tax schedules with configurable SLM and tax rule selection.

**Owner Review Status**:
Awaiting owner review. Book method (SLM default) may be adjusted per owner preference. Tax rule-pack selection is OPEN_RESEARCH; implementation is gated by research closure. If owner has specific depreciation method requirements (e.g., accelerated depreciation for certain asset classes), document separately.

---

### Entry T-004: Exchange-Rate Provider and FX Workflow—Tentative/Open Pending Source Audit

**Status**: TENTATIVE_AGENT_DEFAULT (with significant OPEN_RESEARCH component)

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
Awaiting owner review and dedicated source audit. No specific rate provider is locked in; the multi-source fallback pattern is tentative and stable. Once research determines authoritative source(s), owner may lock the default. Existing transactions' recorded rates are immutable regardless of future default changes.

---

### Entry T-005: V1 Scope Focus—Regular Small-Business GST/Accounting Profiles

**Status**: TENTATIVE_AGENT_DEFAULT

**Question**: Which business profile and tax regimes should V1 prioritize in its coverage roadmap and testing?

**Recommended Working Default**:
- **V1 Primary Target**: Regular (non-composition) small-business GST taxpayers in India with annual turnover below ₹50 crore (rough guidance; not a strict gate).
  - Regular GST registration (GST/registered supplier).
  - GSTR-1 filing (B2B/B2C, service, goods).
  - GSTR-3B reconciliation and manual portal filing.
  - Invoicing, billing, payment, expense, and basic payroll workflows.
  - No e-invoice (optional/research), no e-way bill (optional/research) mandates in V1.
  - No composition scheme, no simplified scheme.
  - No inter-state supply complexity in V1 focus (but multi-GSTIN model supports it).

- **Out of V1 Scope** (documented as deferred/future research):
  - Composition taxpayers (CMP-08, GSTR-4, deemed ITC rules).
  - Simplified scheme (turnover-based exemption, limited GSTR-1).
  - Unregistered suppliers (nil GSTR, cash accounting).
  - E-invoice mandatory applicability and exemptions (OPEN_RESEARCH, not in V1).
  - E-way bill (OPEN_RESEARCH, not in V1).
  - Multi-state inventory/supply chains (model supports it; workflows may be deferred).
  - Specific industry compliance (finance, insurance, import/export, customs, etc.).

- **Unverified Transports** (gated as explicit deferred/open, not silently assumed):
  - Portal APIs, IRP credentials, e-invoice submission.
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

**Owner Review Status**:
Awaiting owner review. V1 scope is a product/business choice; it determines delivery timeline and initial user feedback profile. Owner may adjust scope based on business priorities. This entry documents the tentative default (regular GST small-business) to unblock Phase 1 planning and architecture, which now has a clear target user profile for design decisions.

---

## Relationship to Settled Decisions

Entries T-001 through T-005 extend and clarify settled decisions from [decisions.md](decisions.md#confirmed) and [architecture-decisions.md](architecture-decisions.md):

- **T-001** extends [GSTR-1-specific output boundary](decisions.md#confirmed) and [Government filing boundary](decisions.md#confirmed) to other statutory filings.
- **T-002** clarifies the open-source/license context not yet formalized in settled decisions.
- **T-003** is the first detailed entry for [Fixed assets](decisions.md#confirmed) (RECOMMENDED in ARC-012).
- **T-004** is the first detailed implementation entry for [Multi-currency](decisions.md#confirmed) and [Exchange-rate source](decisions.md#confirmed) (OPEN RESEARCH).
- **T-005** clarifies V1 scope in support of settled [Engine ownership](decisions.md#confirmed), [Automation policy](decisions.md#confirmed), and [Multi-GSTIN tenant modeling](decisions.md#confirmed).

**None of these entries override settled decisions.** They provide implementation detail and working defaults for decisions that remain open or recommend future owner approval.

---

## Approval and Change Control

- **Tentative entries may not be committed to code or presented as settled without owner review.**
- **Each tentative entry must include a path for owner override or reversal.**
- **Once owner approves an entry (or portion of it), it becomes a new SETTLED_OWNER_DECISION and is documented in [decisions.md](decisions.md#confirmed) or a new decision memo.**
- **Tentative entries are for documentation/discovery purposes only; they do not authorize implementation.**
