# Owner Review Docket: Tentative Decisions T-001 through T-011

**⚠️ BANNER: Every row in this docket is TENTATIVE — NOT OWNER-APPROVED.**

Defaults were used for planning while Sudhanshu was unavailable. **The current state is documentation-only and authorizes neither Gate0 nor implementation.** Sudhanshu must first review this docket, then explicitly direct/authorize the reversible Gate0 proof spikes. That direction authorizes only the spikes; it is **not** approval of TypeScript + Bun. Gate0 evaluates T-011, after which Sudhanshu approves, changes, or rejects T-011 before Phase 1. This table is a compact index, not a duplicate specification. Follow the link to each entry for full rationale, alternatives, risks, and reversal path.

**Docket review followed by Sudhanshu's explicit direction is required before Gate0 may run.** Phase 1 additionally requires the post-spike T-011 decision, a reviewed physical-schema RFC, and approval of applicable Phase 1 decisions. Later-phase tentative IDs block only their affected phase or action, not all of Phase 1. See [Definition of Ready](../architecture.md#22-definition-of-ready-for-implementation).

---

## Tentative Decisions Approval Matrix

| T-ID | Title | Recommended Option | First Affected Gate/Phase | Link |
|------|-------|-------------------|--------------------------|------|
| T-001 | External Statutory Submissions—Fallback Default | Prepare/Validate/Export + Manual Portal + Evidence Recording (for filings without filing-specific decision) | Phase 7 (Compliance) | [Tentative Decisions § T-001](tentative-decisions.md#t-001) |
| T-002 | Frappe Books Reference Policy + License Recommendation | Reference-only (behavior/concept, no code reuse) + Apache-2.0 license | Phase 1 (Setup) | [Tentative Decisions § T-002](tentative-decisions.md#t-002) |
| T-003 | Fixed-Asset Depreciation—Book vs. Tax | Separate schedules; SLM for book (configurable), statutory rules for tax (reversible method, immutable posted history) | Phase 5 (Assets) | [Tentative Decisions § T-003](tentative-decisions.md#t-003) |
| T-004 | Exchange-Rate Provider and FX Workflow | Immutable document-rate snapshots + configurable default source with fallback chain | Phase 5 (FX/Multi-Currency) | [Tentative Decisions § T-004](tentative-decisions.md#t-004) |
| T-005 | V1 Scope Focus—Business Profile and Tax Regimes | Regular-GST V1: GSTR-1 output plus GSTR-3B reconciliation/manual filing; payroll baseline; e-invoice/e-way bill deferred and research-gated | Phase 1 (Scope Definition) | [Tentative Decisions § T-005](tentative-decisions.md#t-005) |
| T-006 | Batch Partial-Success Exit Code Signal | Exit code 9 for "some items succeeded, some did not" (numeric proposal only; implementation contract in architecture-decisions.md CLI-004/CLI-006) | Phase 3 (Posting Engine) | [Tentative Decisions § T-006](tentative-decisions.md#t-006) |
| T-007 | Advance-Tax (s404/s408) Estimated-Amount Input | Manual operator entry with provenance; no auto-projection; no computed tax/liability from input alone | Phase 7 (Annual Income-Tax/Compliance) | [Tentative Decisions § T-007](tentative-decisions.md#t-007) |
| T-008 | Retroactive Depreciation Recalculation | Block retroactive changes; correction via period reopen and explicit correction journal | Phase 5 (Assets) | [Tentative Decisions § T-008](tentative-decisions.md#t-008) |
| T-009 | Form 140/141 Statutory Export | Fail-closed: internal neutral data only; no export adapter until Form 140 official utility/schema/portal flow researched and verified | Phase 7 (TDS Compliance) | [Tentative Decisions § T-009](tentative-decisions.md#t-009) |
| T-010 | Post-Filing Return Case/Evidence/Correction | Preserve case details and correction lineage; no return-amendment or defective-return submission adapter until s263(5)–(7) branches researched | Phase 7 (Income-Tax Compliance) | [Tentative Decisions § T-010](tentative-decisions.md#t-010) |
| T-011 | Initial Language and Runtime | TypeScript + Bun is a provisional runtime/language candidate evaluated by reversible Gate0 proof spikes; no library preapproval; alternatives: Node.js+TypeScript or Rust | Gate0 → Phase 1 decision | [Tentative Decisions § T-011](tentative-decisions.md#t-011) |

---

## Personal Tax Decisions PT-001 through PT-016

**⚠️ BANNER: All Personal Tax entries are TENTATIVE — NOT OWNER-APPROVED.**

A companion discovery packet, [Personal Tax Discovery Packet](personal-tax-scope.md), documents 16 core decisions for sole-proprietor personal income-tax expansion. Complete individual tax is **in product scope**; all PT entries are TENTATIVE and include explicit reversal paths and owner-review status. The table below is a compact index; full specifications and rationale are in the canonical packet.

| PT-ID | Title | Recommended Option | First Affected Gate/Phase | Link |
|-------|-------|-------------------|--------------------------|------|
| PT-001 | Individual/PAN Tenant Model with Multiple BookSets | One individual/PAN tenant may contain personal + multiple proprietorship BookSets; companies separate | Phase 1 (Setup) | [Personal Tax Packet § PT-001](personal-tax-scope.md#pt-001) |
| PT-002 | BookSet-Owned Records with Tenant_ID + Book_Set_ID | Every aggregate and posting carries tenant_id + book_set_id; each BookSet independently balanced | Phase 2 (Data Model) | [Personal Tax Packet § PT-002](personal-tax-scope.md#pt-002) |
| PT-003 | Atomic Same-Tenant Inter-BookSet Transfer | Two balanced linked legs; transfer classification does not suppress underlying tax facts | Phase 3 (Posting Engine) | [Personal Tax Packet § PT-003](personal-tax-scope.md#pt-003) |
| PT-004 | Personal Bank, Investment, Property/Rent/Loan Subledgers | Specialized subledgers with provenance/reconciliation per account type | Phase 5 (Reports/Assets/FX) | [Personal Tax Packet § PT-004](personal-tax-scope.md#pt-004) |
| PT-005 | ONE TaxCase/Return per Year Covers ALL BookSets + External Sources | Atomic return per taxpayer/year/filing sequence; never separate or omit applicable BookSet | Phase 7 (Compliance) | [Personal Tax Packet § PT-005](personal-tax-scope.md#pt-005) |
| PT-006 | Form Selection Year-Specific and Fact-Driven | ITR form chosen annually per facts and rules; no universal ITR-3/4 mapping | Phase 7 (Compliance) | [Personal Tax Packet § PT-006](personal-tax-scope.md#pt-006) |
| PT-007 | Bind Governing Act, Period, Trigger, Schema, Rule Snapshot | TaxCase atomically binds all four components immutably | Phase 7 (Compliance) | [Personal Tax Packet § PT-007](personal-tax-scope.md#pt-007) |
| PT-008 | Preserve Primary Artifacts; AIS Including TIS; 26AS; Reconcile Without Overwrite | External sources stored immutably; reconciliation non-destructive; gaps explicit | Phase 7 (Compliance) | [Personal Tax Packet § PT-008](personal-tax-scope.md#pt-008) |
| PT-009 | Hashed File-First V1; No Credentials/OTP/Automation; AA Future | User downloads files manually; hash + immutable storage; AA integration deferred | Phase 7 (Compliance) | [Personal Tax Packet § PT-009](personal-tax-scope.md#pt-009) |
| PT-010 | Progressive Source Readiness Model (UNKNOWN through STALE) | 9-state progression; no arbitrary thresholds; mandatory gaps block only affected action | Phase 7 (Compliance) | [Personal Tax Packet § PT-010](personal-tax-scope.md#pt-010) |
| PT-011 | GST Output to Business BookSet/GSTIN; Personal Label Alone Does Not Decide | Explicit routing for business-use; personal source label is not determinative | Phase 7 (Compliance) | [Personal Tax Packet § PT-011](personal-tax-scope.md#pt-011) |
| PT-012 | TDS/TCS/Remittance Branches Effective-Dated by Role and Facts | No universal TDS rule; annual effective-dated rules apply per s193, s194C, etc. | Phase 7 (Compliance) | [Personal Tax Packet § PT-012](personal-tax-scope.md#pt-012) |
| PT-013 | ITR-Specific Portal States/Evidence; No Universal ARN | Portal states (SUBMITTED, VERIFIED, PROCESSED, REJECTED, etc.) tracked per ITR form | Phase 7 (Compliance) | [Personal Tax Packet § PT-013](personal-tax-scope.md#pt-013) |
| PT-014 | Status Tenant-Wide Read-Only; BookSet/TaxCase Separate; Mutations Fail Closed | No --book-set flag required for overview; mutations requiring explicit disambiguation fail closed | Phase 2 (CLI) | [Personal Tax Packet § PT-014](personal-tax-scope.md#pt-014) |
| PT-015 | No Product Telemetry; Protected Evidence/Secrets; TLS; No False Compliance Claims | Privacy by default; file permissions; redacted logs; deployment classification; disclaimer disclaimers | Phase 1 (Setup) | [Personal Tax Packet § PT-015](personal-tax-scope.md#pt-015) |
| PT-016 | Immutable Original + Linked Correction/Revised/Updated/Rectification Cases | Separate TaxCases linked to original; mechanism selected by verified rules, not user choice | Phase 7 (Compliance) | [Personal Tax Packet § PT-016](personal-tax-scope.md#pt-016) |

**Owner Review Status**: All PT entries await owner review. Canonical specifications, rationale, alternatives, risks, and reversal paths are in [Personal Tax Discovery Packet § 4](personal-tax-scope.md#4-personal-tax-architecture-decisions-pt-001-through-pt-016).

---

## Deferred Configuration Inputs

**Not current architectural decisions; configuration inputs for a later phase.**

- **Entity-to-Zoho Organization Mapping**: Phase 9 (Migration) import configuration. Agent-bahi does not embed mapping logic; import remains final and operator-controlled.

---

## Next Steps

1. **Sudhanshu reviews this docket** and each T-ID entry.
2. **Sudhanshu explicitly directs/authorizes the reversible Gate0 proof spikes** (STK-001–STK-006); this direction is not approval of TypeScript + Bun.
3. **Gate0 proof spikes run**, producing evidence to evaluate T-011 and the other technical assumptions.
4. **Sudhanshu approves, changes, or rejects T-011 after the evidence**, then reviews the physical-schema RFC and applicable Phase 1 decisions before Phase 1 begins. Later-phase tentative IDs remain scoped to their affected phase/action.

**Reference**: [Definition of Ready for Implementation](../architecture.md#22-definition-of-ready-for-implementation), [Implementation Plan](implementation-plan.md).
