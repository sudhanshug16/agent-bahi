# Tentative Decisions and Overnight Protocol

This document records overnight planning decisions that establish working defaults while the owner is unavailable. Entries distinguish between truly settled decisions, tentative agent-selected defaults awaiting owner review, open research questions requiring external verification, and internal architectural choices that do not require owner approval.

## Status Semantics

**SETTLED_OWNER_DECISION**: Explicitly approved by Sudhanshu and documented in [decisions.md](decisions.md). These are binding and may only be changed through owner review and explicit new decision.

**TENTATIVE_AGENT_DEFAULT**: A planning default selected by workers/agents to unblock daily development while the owner is unavailable. Not owner-approved. Must include explicit owner-review status, evidence for the choice, product impact, and a reversal path so the owner can change the default without architectural breakage. Every tentative entry includes a clear path for the owner to override.

**OPEN_RESEARCH**: An external fact (law, portal specification, runtime requirement) that cannot be decided by preference. Requires official primary sources or field verification before gate satisfaction. Remains open until explicit research closure.

**INTERNAL_ARCHITECTURE_DECISION**: A reversible technical choice about implementation structure, sequencing, or interface boundaries that does not require owner business approval because it is implementation-internal and does not change settled product or compliance behavior. Examples: Phase 2 defines contracts before Phase 3 implements; discovery doc structure; internal code patterns.

---

## Initial Tentative Entries

### Entry T-001: External Statutory Submissions Workflow—Fallback Default When No Filing-Specific Decision Exists

**Status**: TENTATIVE_AGENT_DEFAULT

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
Awaiting owner review. This is a working default to unblock skill architecture documentation and Phase 1 design (e.g., what CLI commands are required for export). Owner may override this default for any specific filing by approving a filed-specific adapter after dedicated research.

---

### Entry T-002: Frappe Books as Behavior/Concept Reference Only

**Status**: TENTATIVE_AGENT_DEFAULT

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
Awaiting owner review. Do not commit any LICENSE file changes. This entry documents the reasoning for Apache-2.0 recommendation so owner can approve/reject the license choice in a separate decision. If owner approves a different license (AGPL-3.0, MIT, other), that becomes a new SETTLED_OWNER_DECISION.

---

### Entry T-003: Fixed-Asset Depreciation Schedules—Book vs. Tax with Tentative SLM Default

**Status**: TENTATIVE_AGENT_DEFAULT

The separate book/tax schedule model remains **T-003 TENTATIVE - NOT
OWNER-APPROVED**. This entry records a reversible working default only; it does
not approve a depreciation method, tax rate, or filing behavior.

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
Awaiting owner review. V1 scope is a product/business choice; it determines delivery timeline and initial user feedback profile. Owner may adjust scope based on business priorities. This entry documents the tentative default (regular GST small-business) to unblock Phase 1 planning and architecture, which now has a clear target user profile for design decisions. E-invoice and e-way-bill adapters remain **TENTATIVE - NOT OWNER-APPROVED** and are explicitly deferred until their research gate is satisfied.

---

### Entry T-006: Deterministic Batch Partial-Success Exit Codes and JSON Outcomes

**Status**: TENTATIVE_AGENT_DEFAULT — **NOT OWNER-APPROVED**

**Question**: How should batch operations report success, failure, and partial success to callers (CLI, agents, scripts) deterministically?

**Recommended Working Default**:

**Exit Code Taxonomy**:
- **Exit code 0**: All selected items succeeded. No item was skipped, failed, or returned an error. If a batch offers selection, all selected items completed successfully.
- **Exit code 9** (recommended for unused terminal code): Partial success. Some selected items succeeded; others failed. Returned when `> 0` items succeeded AND `> 0` items failed/blocked.
- **Non-zero (1, 2, 3, etc.)**: Total failure. Zero items succeeded; all selected items failed or the batch operation itself failed before any item was processed.
- **Never exit 0 for partial success**. A batch that processes 100 items and succeeds on 99 must exit non-zero (recommend 9) with outcomes in JSON.

**JSON Response Envelope** (when `--json` flag is used):
```json
{
  "batch_id": "request_id_or_digest",
  "operation": "operation_name",
  "started_at": "ISO8601_UTC",
  "completed_at": "ISO8601_UTC",
  "total_selected": 100,
  "succeeded": 99,
  "failed": 1,
  "skipped": 0,
  "exit_code": 9,
  "per_item_outcomes": [
    {
      "item_id": "item_1",
      "index": 0,
      "status": "success",
      "amount": 1000,
      "posted_reference": "JE-2026-08-21-001"
    },
    {
      "item_id": "item_2",
      "index": 1,
      "status": "failure",
      "reason": "VALIDATION_BLOCKED",
      "detail": "Invoice amount exceeds authorization limit"
    },
    {
      "item_id": "item_100",
      "index": 99,
      "status": "success",
      "amount": 1000,
      "posted_reference": "JE-2026-08-21-100"
    }
  ],
  "summary": "99 of 100 items succeeded. Review the per_item_outcomes for details."
}
```

**Key Behaviors**:
- **Per-item outcomes**: JSON always includes an outcomes array listing every item's result (success, failure reason, blocked reason, skipped reason, posted reference if applicable).
- **Shell status (exit code)**: Never silently report success (exit 0) when partial failure occurs. Exit code 9 (or alternative non-zero) indicates "some succeeded, some failed; check outcomes."
- **Atomicity declaration**: Batch commands declare their atomicity policy upfront: "atomic per file" (entire file succeeds or rolls back), "per-item best-effort" (partial success allowed), "all-or-nothing" (one failure aborts all). V1 default: per-item best-effort with explicit outcomes.
- **No hidden success**: Callers must not guess from output; the combination of exit code + JSON outcomes must be sufficient to determine exactly what succeeded, what failed, and why.

**Alternatives**:
- Exit 0 for partial success, parse JSON to determine actual outcomes (high risk of silent failures if JSON parsing fails or is skipped).
- All-or-nothing atomicity (one failure aborts entire batch; no partial success). Operationally safer but less flexible for large batches.
- No JSON outcomes, only human-readable summary. Not suitable for agent orchestration.

**Rationale**:
Batch operations (import, reconciliation, posting) are common in accounting. Agents, scripts, and users need deterministic signals: exit 0 means "everything worked"; non-zero means "something failed." JSON outcomes enable agents to retry just failed items, and callers to report precise failures to users. Exit code 9 (recommended) is a reserved, documentation-testable code that clearly indicates "partial success; check outcomes." Silently reporting success (exit 0) for a batch where 1% fails risks silent data corruption and unnoticed reconciliation gaps.

**Product Impact**:
- **Agent reliability**: Agents can distinguish recoverable (retry failed items) from terminal failures (no retry).
- **Operator clarity**: Users see exactly what succeeded and what failed in one command.
- **Auditability**: Posted references and timestamps are retained per item.
- **Script safety**: Scripts can check exit codes reliably without parsing variable-format output.

**Reversal Path**:
Owner may change the designated exit code (9, or another unused non-zero) or alter the JSON schema (e.g., add more detail to per-item outcomes). The principle (non-zero exit on partial success, JSON outcomes per item) is stable regardless of code choice. Existing callers must be updated when the exit-code or JSON schema version changes.

**Dependencies**:
- [CLI-004: Explicit exit-code taxonomy](architecture-decisions.md#cli-004-explicit-exit-code-taxonomy) (partially settled).
- [CLI-006: Batch atomicity declared per operation](architecture-decisions.md#cli-006-batch-atomicity-declared-per-operation) (RECOMMENDED in architecture-decisions.md).
- Linked to [Skill exception handling](architecture-decisions.md#skl-004-standard-exception-classes-with-remediation-context) and [durable checkpoints](architecture-decisions.md#skl-005-resumable-skill-runs-with-durable-checkpoints).

**Evidence**:
- Industry standards: GNU tools (grep, find) return exit 0 for matches, 1 for no matches, 2 for errors. rsync returns 23 for partial transfer. Exit-code disambiguation is standard practice.
- Batch import tools (Postgres COPY, kubectl apply) use exit codes + per-item error reporting.
- Agent orchestration frameworks (Apache Airflow, Temporal) require deterministic exit codes to route retry/escalation logic.

**Owner Review Status**:
Awaiting owner review. This entry documents the recommended default (exit 9 for partial success, JSON with per-item outcomes, never silent 0 on failure) to unblock Phase 3 implementation and skill error routing. Owner may select a different exit code or adjust JSON schema. The principle (deterministic, non-silent exit codes + granular JSON outcomes) is binding for accounting batch operations.

---

### Entry T-007: Advance-Tax Estimated-Amount Input—Manual Entry or Auto-Projection

**Status**: TENTATIVE_AGENT_DEFAULT — **NOT OWNER-APPROVED**

**Question**: How should agent-bahi handle advance-tax (s404/408) estimated-amount input? Should it auto-calculate from FY income projection, or require manual operator entry?

**Recommended Working Default**:
- Advance-tax deadlines (15 Jun, 15 Sep, 15 Dec, 15 Mar per s408) are calculated deterministically from effective tax rules.
- Advance-tax **estimated amount** requires explicit operator/agent input or is read from a configured annual estimate.
- **No auto-projection** from partial-year actuals or assumed growth; estimation is owner/operator responsibility.
- System stores the declared estimate, computed tax, installment due, payment made, and reconciliation against final-year tax for annual return.

**Alternatives**:
- Auto-calculate from YTD actuals and project to FY end (high risk: early-year assumptions drift; reconciliation gaps compound).
- Mandatory estimate every quarter (high friction; same estimate used repeatedly).
- No advance-tax tracking (loses early warning of tax liability overage and underpayment penalty risk).

**Rationale**:
Advance-tax liability is owner/tenant responsibility; operator experience/judgment; and effective tax planning. Automatic projection invites reconciliation gaps (projection assumption vs. actual FY outcome). Operator entry keeps intent explicit and auditable. Stored estimate enables period-end reconciliation between paid installments and actual tax.

**Product Impact**:
- **Operator control**: Tenant decides estimate based on known contracts, business plan, and tax strategy.
- **Clear reconciliation**: Stored estimate vs. actual tax is transparent for annual return.
- **Safe defaults**: No mismatched auto-projection surprises.

**Reversal Path**:
Owner may add optional auto-projection as an operator convenience (not a requirement). Once introduced, projection assumptions must be versioned and audit-trailed. Early override paths must be clear.

**Dependencies**:
- Annual return contract (s408 deadlines).
- [Advance tax s404/408 OPEN RESEARCH](architecture-decisions.md#open-research--deferred-list).

**Evidence**:
- Zoho Books: Advance tax requires manual operator entry of estimated amount.
- Accounting practice: Estimates are owner/tenant responsibility, not auto-derived.

**Owner Review Status**:
Awaiting owner review. This entry documents the tentative default (manual entry, no auto-projection) to unblock statutory-workflow design. Owner may request optional auto-projection as a future convenience feature.

---

### Entry T-008: Retroactive Depreciation Recalculation—Block or Auto-Recalculate

**Status**: TENTATIVE_AGENT_DEFAULT — **NOT OWNER-APPROVED**

**Question**: If an asset's acquisition date, cost, or depreciation rate changes retroactively (after prior-year depreciation has been calculated and posted), should agent-bahi auto-recalculate prior-year depreciation or block the change?

**Recommended Working Default**:
- **Block retroactive changes to posted depreciation**. Once a depreciation run is finalized and posted, the asset's acquisition date, cost, and applicable rate are frozen for that period.
- **Correction path**: Reopen/unlock the affected period, post a correction journal with documented reason (e.g., "asset cost adjustment per vendor invoice"), and re-run depreciation for the corrected period forward.
- **No silent auto-recalculation** of prior-year depreciation; the audit trail must show the correction.

**Alternatives**:
- Auto-recalculate all affected prior years (high risk: silent depreciation adjustments; unclear what was actually filed; audit complexity).
- Allow unrestricted mutation (loses immutability and correction lineage).
- Depreciation is read-only forever; no corrections allowed (operationally impractical).

**Rationale**:
India tax/audit compliance requires immutable depreciation schedules linked to filed returns. Silent auto-recalculation risks hidden tax errors and breaks audit trails. Explicit correction journals document the reason, amount, and timeline of changes, enabling CA and tax authority review. This aligns with [ARC-006: Optimistic concurrency with explicit locks for high-consequence mutations](architecture-decisions.md#arc-006-optimistic-concurrency-with-explicit-locks-for-high-consequence-mutations) for posted documents.

**Product Impact**:
- **Audit safety**: Depreciation history remains traceable; no hidden recalculations.
- **Correction clarity**: Operator intent and timing are explicit.
- **Compliance readiness**: Depreciation schedule matches filed return without manual reconciliation.

**Reversal Path**:
Owner may add a post-correction reporting feature (e.g., "show depreciation impact if we had known the correct cost earlier"). This is a reporting feature, not a mutation feature, and would not alter posted entries.

**Dependencies**:
- [T-003: Fixed-Asset Depreciation](tentative-decisions.md#entry-t-003-fixed-asset-depreciation-schedules%E2%80%94book-vs-tax-with-tentative-slm-default).
- Period-lock and correction-lineage model (settled in [decisions.md](decisions.md#confirmed)).
- Fixed-asset module scope (Phase scope: ARC-012).

**Evidence**:
- Accounting standard (ASC 360, Indian accounting): Depreciation is an accrual once the asset is in service; retroactive rate changes are corrections, not adjustments.
- Tax audit practice: Examiners scrutinize depreciation-schedule changes and require documented support.

**Owner Review Status**:
Awaiting owner review. This entry documents the tentative default (block with correction path) to unblock depreciation module design. Owner may adjust the correction workflow or add after-the-fact reporting features.

---

### Entry T-009: Form 140/141 Export Format—JSON, XML, or Both

**Status**: TENTATIVE_AGENT_DEFAULT — **NOT OWNER-APPROVED**

**Question**: For non-payroll TDS quarterly statements (Form 140 general, Form 141 special month-end), what export format(s) should agent-bahi support? JSON only, XML only, or both?

**Recommended Working Default**:
- **JSON primary format**. Form 140/141 exports are JSON by default, matching the GSTR-1 precedent and enabling agent/skill integration.
- **XML fallback support** only if official GST Portal / ITD portal demonstrates official XML schema or accepts XML upload.
- **No CSV export** for Form 140/141; TDS forms are structured data, not flat records.

**Alternatives**:
- XML primary (closer to some government submissions, but less agent-native).
- CSV export (loses hierarchical structure and makes validation harder).
- Excel/XLSX (proprietary; harder for agents).
- Multiple formats from day one (maintenance burden; risk of format divergence).

**Rationale**:
JSON is native to TypeScript/Bun stack, enables agent orchestration, and matches GSTR-1 precedent (settled in [decisions.md](decisions.md#confirmed)). Official ITD portal acceptance of JSON remains OPEN_RESEARCH; XML support can be added if discovered. Simplicity in V1 is better than premature multi-format support.

**Product Impact**:
- **Agent compatibility**: Skills can parse and re-submit JSON natively.
- **Consistency**: Matches GSTR-1 JSON export, reducing operator confusion.
- **Future flexibility**: XML can be added as a generation alternative without breaking JSON consumers.

**Reversal Path**:
Owner may request XML or other format after discovering official portal acceptance or CA preference. JSON remains primary; alternative formats are additive.

**Dependencies**:
- [GSTR-1-specific output boundary](decisions.md#confirmed) (JSON export settled for GSTR-1).
- Form 140/141 field structure research (OPEN in [statutory-workflow-contracts.md](statutory-workflow-contracts.md#open-items-blocking-implementation)).

**Evidence**:
- GSTR-1 settled: JSON export is standard.
- Industry: TDS portals (TRACES, etc.) accept JSON uploads alongside legacy XML.

**Owner Review Status**:
Awaiting owner review. This entry documents the tentative default (JSON primary, XML if discovered as official, no CSV) to unblock Form 140/141 export module. Owner may prioritize XML or request other formats.

---

### Entry T-010: Amendment/Revised Return Workflow—ITR-X or Re-filing

**Status**: TENTATIVE_AGENT_DEFAULT — **NOT OWNER-APPROVED**

**Question**: If an annual income-tax return is rejected or the taxpayer wants to amend after filing, should agent-bahi support revised/amended return (e.g., ITR-X under s163) or only allow complete re-filing of the original return?

**Recommended Working Default**:
- **Re-filing of the original return form only**, with full reconciliation against the prior-year filing (ARN, filing date, rejection reason if rejected).
- **Amendment/ITR-X workflow remains OPEN_RESEARCH**. No tentative implementation; treat as a future feature pending:
  1. Verification that ITR-X form exists and is official for the applicable return year (open: form code, structure, applicability timeline).
  2. Confirmation of amendment deadline and procedure per s163/Rules.
  3. Decision on whether to auto-generate ITR-X from changes or require manual entry.
- **Correction journals**: For post-filing ledger corrections (e.g., discovery of an unposted expense), operator records a correction journal separately; return amendment is owner's choice and outside agent-bahi.

**Alternatives**:
- Auto-generate ITR-X if differences detected from prior year (complex, requires verified form/rules).
- Support both ITR-X and re-filing (supportable after research).
- No amendment support; annual returns are final (operationally limiting).

**Rationale**:
ITR-X form, amendment eligibility, and deadline rules are OPEN_RESEARCH. Re-filing is always an option and is safer than guessing amendment procedure. Correction journals keep ledger changes explicit and separate from return-filing workflow. Owner may enable ITR-X after research closure and explicit approval. This aligns with [tentative-decisions.md](tentative-decisions.md) principle: no unapproved product defaults.

**Product Impact**:
- **Safety**: No premature ITR-X logic; operator/CA decides amendment strategy.
- **Future flexibility**: Once ITR-X is researched, can be added as an automated or manual option.
- **Auditability**: Correction journals and return filings remain separately linked.

**Reversal Path**:
After ITR-X form, eligibility, and procedure are researched and settled, owner may approve auto-generation or manual ITR-X filing. Re-filing remains always available as a fallback.

**Dependencies**:
- Annual return workflow (s263 due dates, form selection per Rule 164).
- [Amended/revised return workflow OPEN RESEARCH](statutory-workflow-contracts.md#open-items-blocking-implementation) (item 15).
- Correction journal model (settled in [decisions.md](decisions.md#confirmed)).

**Evidence**:
- ITR-X form existence, official name, structure, and applicability year remain unverified at knowledge cutoff.
- Amendment deadline and procedure (s163) require official source confirmation.

**Owner Review Status**:
Awaiting owner review and dedicated amendment/ITR-X research. This entry documents the tentative default (re-filing only, amendment deferred) to unblock annual-return module without guessing amendment procedure. Owner may fund research and approve ITR-X support after closure.

---

## Relationship to Settled Decisions

Entries T-001 through T-010 extend and clarify settled decisions from [decisions.md](decisions.md#confirmed) and [architecture-decisions.md](architecture-decisions.md):

- **T-001** (now clarified): Establishes a fallback default for filing submission only where no filing-specific boundary exists. Does not override GSTR-1 or any filing-specific settled decision. Extends [GSTR-1-specific output boundary](decisions.md#confirmed) and [Government filing boundary](decisions.md#confirmed) as a generic template for undefined filings only.
- **T-002** clarifies the open-source/license context not yet formalized in settled decisions.
- **T-003** is the first detailed entry for [Fixed assets](decisions.md#confirmed) (RECOMMENDED in ARC-012).
- **T-004** is the first detailed implementation entry for [Multi-currency](decisions.md#confirmed) and [Exchange-rate source](decisions.md#confirmed) (OPEN RESEARCH).
- **T-005** clarifies V1 scope in support of settled [Engine ownership](decisions.md#confirmed), [Automation policy](decisions.md#confirmed), and [Multi-GSTIN tenant modeling](decisions.md#confirmed). E-invoice and e-way-bill adapters (CMP-006, CMP-007) are explicitly **RESEARCH-GATED and DEFERRED**, not V1-authorized; see [architecture-decisions.md](architecture-decisions.md#cmp-006-e-invoice-default-irp-via-configured-adapter) and [architecture-decisions.md](architecture-decisions.md#cmp-007-e-way-bill-default-configured-api-with-state-specific-rules-open-research) for research gates.
- **T-006** (new): Specifies deterministic batch partial-success exit codes and JSON outcomes to support [CLI-004: Explicit exit-code taxonomy](architecture-decisions.md#cli-004-explicit-exit-code-taxonomy) and [CLI-006: Batch atomicity declared per operation](architecture-decisions.md#cli-006-batch-atomicity-declared-per-operation). Recommends exit code 9 (if unused) for partial success; exit 0 only when all selected items succeed; JSON outcomes per item.
- **T-007** (migrated from statutory-workflow-contracts.md examples): Advance-tax estimated-amount input—manual entry or auto-projection. Tentative default: manual operator entry, no auto-projection. Supports [Annual income-tax return contract](statutory-workflow-contracts.md#annual-income-tax-return-workflow-contract).
- **T-008** (migrated from statutory-workflow-contracts.md examples): Retroactive depreciation recalculation—block or auto-recalculate. Tentative default: block retroactive changes; correction path via period reopen and correction journal. Supports [T-003](tentative-decisions.md#entry-t-003-fixed-asset-depreciation-schedules%E2%80%94book-vs-tax-with-tentative-slm-default) and fixed-asset module scope.
- **T-009** (migrated from statutory-workflow-contracts.md examples): Form 140/141 export format—JSON, XML, or both. Tentative default: JSON primary (matching GSTR-1 precedent), XML if official acceptance discovered. Supports [TDS workflow contract](statutory-workflow-contracts.md#tds-workflow-contract-non-payroll-sections-393%E2%80%93394).
- **T-010** (migrated from statutory-workflow-contracts.md examples): Amendment/revised return workflow—ITR-X or re-filing. Tentative default: re-filing only; amendment (ITR-X) deferred until form/procedure research is closed and owner-approved. Supports [Annual income-tax return contract](statutory-workflow-contracts.md#annual-income-tax-return-workflow-contract).

**None of these entries override settled decisions.** They provide implementation detail and working defaults for decisions that remain open or recommend future owner approval. Filing-specific settled decisions always override T-001.

---

## Approval and Change Control

- **Tentative entries may not be committed to code or presented as settled without owner review.**
- **Each tentative entry must include a path for owner override or reversal.**
- **Once owner approves an entry (or portion of it), it becomes a new SETTLED_OWNER_DECISION and is documented in [decisions.md](decisions.md#confirmed) or a new decision memo.**
- **Tentative entries are for documentation/discovery purposes only; they do not authorize implementation.**
