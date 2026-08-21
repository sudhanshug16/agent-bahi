# Owner Review Docket: Tentative Decisions T-001 through T-011

**✓ STATUS UPDATE: T-001 through T-011 are now OWNER-APPROVED. PT-001 and PT-009 are OWNER-APPROVED; NOT ARCHITECT-REVIEWED. PT-002 through PT-008 and PT-010 through PT-016 remain TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED.**

T-001 through T-011 are owner-approved as settled decision frameworks, while remaining subject to research gates and implementation authorization. Sudhanshu has approved each T-decision as a binding framework, though specific implementation (library choices, statutory artifacts, filing adapters) remains gated by research closure or explicit future approval. TypeScript + Bun is selected per T-011; Gate0 proof spikes (STK-001 through STK-006) are a mandatory prerequisite (NOT authorized by this docs review) to validate platform/database/arithmetic correctness before implementation. This table is a compact index, not a duplicate specification. Follow the link to each entry for full rationale, alternatives, risks, and reversal path.

**T-001 through T-011 are owner-approved.** Gate0 proof spikes (STK-001 through STK-006) are a mandatory prerequisite (not authorized by this docs review) to validate the selected TypeScript + Bun stack on all target platforms. Gate0 must pass before implementation is authorized; if blockers arise, work stops for owner override decision. Implementation readiness additionally requires a reviewed physical-schema RFC and approval of applicable Phase 1 decisions. Later-phase tentative IDs (not yet approved; currently awaiting review) block only their affected phase or action, not all of Phase 1. See [Definition of Ready](../architecture.md#22-definition-of-ready-for-implementation).

---

## Tentative Decisions Approval Matrix

| T-ID | Title | Recommended Option | First Affected Gate/Phase | Link |
|------|-------|-------------------|--------------------------|------|
| T-001 | External Statutory Submissions—Fallback Default | Prepare/Validate/Export + Manual Portal + Evidence Recording (for filings without filing-specific decision) | Phase 7 (Compliance) | [Tentative Decisions § T-001](tentative-decisions.md#t-001) |
| T-002 | Frappe Books Reference Policy + License Recommendation | Reference-only (behavior/concept, no code reuse) + Apache-2.0 license | Phase 1 (Setup) | [Tentative Decisions § T-002](tentative-decisions.md#t-002) |
| T-003 | Fixed-Asset Depreciation—Book vs. Tax | Separate schedules; SLM for book (configurable), statutory rules for tax (reversible method, immutable posted history) | Phase 5 (Assets) | [Tentative Decisions § T-003](tentative-decisions.md#t-003) |
| T-004 | Exchange-Rate Provider and FX Workflow | Immutable document-rate snapshots + configurable default source with fallback chain | Phase 5 (FX/Multi-Currency) | [Tentative Decisions § T-004](tentative-decisions.md#t-004) |
| T-005 | V1 Scope Focus—Business Profile and Tax Regimes | Regular-GST V1: GSTR-1 output plus GSTR-3B reconciliation/manual filing; payroll baseline; e-invoice/e-way bill deferred and research-gated | Phase 1 (Scope Definition) | [Tentative Decisions § T-005](tentative-decisions.md#t-005) |
| T-006 | Batch Partial-Success Exit Code Signal | Distinct nonzero signal for partial completion with per-item outcomes; numeric code remains internal/TBD (implementation contract in architecture-decisions.md CLI-004/CLI-006) | Phase 3 (Posting Engine) | [Tentative Decisions § T-006](tentative-decisions.md#t-006) |
| T-007 | Full Individual Income-Tax Scope | Complete personal income-tax for sole proprietor, accounting-separated from business/GST books; detailed PT decisions remain separately gated | Phase 7 (Compliance) | [Tentative Decisions § T-007](tentative-decisions.md#t-007) |
| T-008 | Controlled User Corrections and Deletions | Allow corrections/deletions after FY/report/audit/filing via preview/reason/unlock; reversal/replacement lineage; affected reports marked STALE/DRIFTED | Phase 5 (Assets) | [Tentative Decisions § T-008](tentative-decisions.md#t-008) |
| T-009 | Form 140/141 Statutory Export | Fail-closed: internal neutral data only; no export adapter until Form 140 official utility/schema/portal flow researched and verified | Phase 7 (TDS Compliance) | [Tentative Decisions § T-009](tentative-decisions.md#t-009) |
| T-010 | Post-Filing Return Case/Evidence/Correction | Preserve case details and correction lineage; no return-amendment or defective-return submission adapter until s263(5)–(7) branches researched | Phase 7 (Income-Tax Compliance) | [Tentative Decisions § T-010](tentative-decisions.md#t-010) |
| T-011 | Initial Language and Runtime | TypeScript + Bun selected; Gate0 proof spikes (STK-001–STK-006) are mandatory prerequisite (not authorized by docs review); no library preapproval; if Gate0 blockers arise, work stops for owner decision | Gate0 prerequisite → Implementation | [Tentative Decisions § T-011](tentative-decisions.md#t-011) |

---

## Personal Tax Decisions PT-001 through PT-016

**Personal Tax status:** PT-001 and PT-009 are **OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. PT-002 through PT-008 and PT-010 through PT-016 retain the exact status **TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED**.

A companion discovery packet, [Personal Tax Discovery Packet](personal-tax-scope.md), documents 16 core decisions for sole-proprietor personal income-tax expansion. Complete individual tax is **in product scope**; PT-001 and PT-009 have the owner-approved status above, while PT-002 through PT-008 and PT-010 through PT-016 retain the tentative status above. The table below is a compact index; full specifications and rationale are in the canonical packet.

| PT-ID | Title | Recommended Option | First Affected Gate/Phase | Link |
|-------|-------|-------------------|--------------------------|------|
| PT-001 | Individual/PAN Tenant Model with Multiple BookSets | One individual/PAN tenant may contain personal + multiple proprietorship BookSets; companies separate | Gate-0/readiness → Phase 1 (Setup) | [Personal Tax Packet § PT-001](personal-tax-scope.md#pt-001) |
| PT-002 | BookSet-Owned Records with Tenant_ID + Book_Set_ID | Every aggregate and posting carries tenant_id + book_set_id; each BookSet independently balanced | Phase 2 (Data Model) | [Personal Tax Packet § PT-002](personal-tax-scope.md#pt-002) |
| PT-003 | Atomic Same-Tenant Inter-BookSet Transfer | Two balanced linked legs; transfer classification does not suppress underlying tax facts | Phase 3 (Posting Engine) | [Personal Tax Packet § PT-003](personal-tax-scope.md#pt-003) |
| PT-004 | Personal Bank, Investment, Property/Rent/Loan Subledgers | Specialized subledgers with provenance/reconciliation per account type | Phase 5 (Reports/Assets/FX) | [Personal Tax Packet § PT-004](personal-tax-scope.md#pt-004) |
| PT-005 | ONE TaxCase/Return per Year Covers ALL BookSets + External Sources | Atomic return per taxpayer/year/filing sequence; never separate or omit applicable BookSet | Phase 7 (Compliance) | [Personal Tax Packet § PT-005](personal-tax-scope.md#pt-005) |
| PT-006 | Form Selection Year-Specific and Fact-Driven | ITR form chosen annually per facts and rules; no universal ITR-3/4 mapping | Phase 7 (Compliance) | [Personal Tax Packet § PT-006](personal-tax-scope.md#pt-006) |
| PT-007 | Bind Governing Act, Period, Trigger, Schema, Rule Snapshot | TaxCase atomically binds all five facts immutably | Phase 7 (Compliance) | [Personal Tax Packet § PT-007](personal-tax-scope.md#pt-007) |
| PT-008 | Preserve Primary Artifacts; AIS Including TIS; 26AS; Reconcile Without Overwrite | External sources stored immutably; reconciliation non-destructive; gaps explicit | Phase 7 (Compliance) | [Personal Tax Packet § PT-008](personal-tax-scope.md#pt-008) |
| PT-009 | Hashed File-First V1; No Credentials/OTP/Automation; AA Future | User downloads files manually; hash + immutable storage; AA integration deferred | Phase 7 (Compliance) | [Personal Tax Packet § PT-009](personal-tax-scope.md#pt-009) |
| PT-010 | Progressive Source Readiness Model (UNKNOWN through STALE) | 9-state progression; no arbitrary thresholds; mandatory gaps block only affected action | Phase 7 (Compliance) | [Personal Tax Packet § PT-010](personal-tax-scope.md#pt-010) |
| PT-011 | GST Output to Business BookSet/GSTIN; Personal Label Alone Does Not Decide | Explicit routing for business-use; personal source label is not determinative | Phase 7 (Compliance) | [Personal Tax Packet § PT-011](personal-tax-scope.md#pt-011) |
| PT-012 | TDS/TCS/Remittance Branches Effective-Dated by Role and Facts | Versioned role/transaction gate; missing mandatory rule or evidence returns REVIEW/BLOCK | Phase 7 (Compliance) | [Personal Tax Packet § PT-012](personal-tax-scope.md#pt-012) |
| PT-013 | ITR-Specific Portal States/Evidence; No Universal ARN | Portal states (SUBMITTED, VERIFIED, PROCESSED, REJECTED, etc.) tracked per ITR form | Phase 7 (Compliance) | [Personal Tax Packet § PT-013](personal-tax-scope.md#pt-013) |
| PT-014 | Status Tenant-Wide Read-Only; BookSet/TaxCase Separate; Mutations Fail Closed | No --book-set flag required for overview; mutations requiring explicit disambiguation fail closed | Phase 2 (CLI) | [Personal Tax Packet § PT-014](personal-tax-scope.md#pt-014) |
| PT-015 | No Product Telemetry; Protected Evidence/Secrets; TLS; No False Compliance Claims | Privacy by default; file permissions; redacted logs; deployment classification; disclaimer disclaimers | Phase 1 (Setup) | [Personal Tax Packet § PT-015](personal-tax-scope.md#pt-015) |
| PT-016 | Immutable Original + Linked Correction/Revised/Updated/Rectification Cases | Separate TaxCases linked to original; mechanism selected by verified rules, not user choice | Phase 7 (Compliance) | [Personal Tax Packet § PT-016](personal-tax-scope.md#pt-016) |

**Owner Review Status**: PT-001 and PT-009 are **OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. PT-002 through PT-008 and PT-010 through PT-016 retain the exact status **TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. Canonical specifications, rationale, alternatives, risks, and reversal paths are in [Personal Tax Discovery Packet § 4](personal-tax-scope.md#4-personal-tax-decisions-pt-001-through-pt-016).

---

## Deferred Configuration Inputs

**Not current architectural decisions; configuration inputs for a later phase.**

- **Entity-to-Zoho Organization Mapping**: Phase 9 (Migration) import configuration. Agent-bahi does not embed mapping logic; import remains final and operator-controlled.

---

## Next Steps

1. **Gate0 proof spikes (STK-001–STK-006) are a mandatory prerequisite** (not authorized by this docs review) to validate TypeScript + Bun on all target platforms (macOS arm64, Linux x64/arm64). If Gate0 reveals blockers, work stops and returns to owner for override decision.
2. **Gate0 must pass before implementation** begins. Passing Gate0 is prerequisite for implementation authorization, not a post-implementation review.
3. **Implementation readiness** additionally requires a reviewed physical-schema RFC and approval of applicable implementation decisions. Later-phase tentative IDs (not yet owner-approved; currently awaiting review) remain scoped to their affected phase/action.

**Reference**: [Definition of Ready for Implementation](../architecture.md#22-definition-of-ready-for-implementation), [Implementation Plan](implementation-plan.md).
