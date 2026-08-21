# Owner Review Docket: Tentative Decisions T-001 through T-011

**⚠️ BANNER: Every row in this docket is TENTATIVE — NOT OWNER-APPROVED.**

Defaults were used for planning while Sudhanshu was unavailable. **Owner must review, approve, change, or reject each decision before implementation is authorized.** This table is a compact index, not a duplicate specification. Follow the link to each entry for full rationale, alternatives, risks, and reversal path.

**Sudhanshu's confirmation of this docket is a prerequisite for Gate0 and Phase 1.** See [Definition of Ready](../architecture.md#22-definition-of-ready-for-implementation).

---

## Tentative Decisions Approval Matrix

| T-ID | Title | Recommended Option | First Affected Gate/Phase | Link |
|------|-------|-------------------|--------------------------|------|
| T-001 | External Statutory Submissions—Fallback Default | Prepare/Validate/Export + Manual Portal + Evidence Recording (for filings without filing-specific decision) | Phase 7 (Compliance) | [Tentative Decisions § T-001](tentative-decisions.md#entry-t-001-external-statutory-submissions-workflow%E2%80%94fallback-default-when-no-filing-specific-decision-exists) |
| T-002 | Frappe Books Reference Policy + License Recommendation | Reference-only (behavior/concept, no code reuse) + Apache-2.0 license | Phase 1 (Setup) | [Tentative Decisions § T-002](tentative-decisions.md#entry-t-002-frappe-books-as-behaviorcomcept-reference-only) |
| T-003 | Fixed-Asset Depreciation—Book vs. Tax | Separate schedules; SLM for book (configurable), statutory rules for tax (reversible method, immutable posted history) | Phase 5 (Assets) | [Tentative Decisions § T-003](tentative-decisions.md#entry-t-003-fixed-asset-depreciation-schedules%E2%80%94book-vs-tax-with-tentative-slm-default) |
| T-004 | Exchange-Rate Provider and FX Workflow | Immutable document-rate snapshots + configurable default source with fallback chain | Phase 5 (FX/Multi-Currency) | [Tentative Decisions § T-004](tentative-decisions.md#entry-t-004-exchange-rate-provider-and-fx-workflow%E2%80%94tentativeopen-pending-source-audit) |
| T-005 | V1 Scope Focus—Business Profile and Tax Regimes | Regular (non-composition) small-business GST taxpayers; GSTR-1 only; payroll baseline; e-invoice/e-way bill deferred | Phase 1 (Scope Definition) | [Tentative Decisions § T-005](tentative-decisions.md#entry-t-005-v1-scope-focus%E2%80%94regular-small-business-gstaccounting-profiles) |
| T-006 | Batch Partial-Success Exit Code Signal | Exit code 9 for "some items succeeded, some did not" (numeric proposal only; implementation contract in architecture-decisions.md CLI-004/CLI-006) | Phase 3 (Posting Engine) | [Tentative Decisions § T-006](tentative-decisions.md#entry-t-006-tentative-numeric-proposal-for-batch-exit-code-signal%E2%80%94not-implementation-binding) |
| T-007 | Advance-Tax (s404/s408) Estimated-Amount Input | Manual operator entry with provenance; no auto-projection; no computed tax/liability from input alone | Phase 6 (Payroll) | [Tentative Decisions § T-007](tentative-decisions.md#entry-t-007-advance-tax-estimated-amount-input%E2%80%94manual-entry-or-auto-projection) |
| T-008 | Retroactive Depreciation Recalculation | Block retroactive changes; correction via period reopen and explicit correction journal | Phase 5 (Assets) | [Tentative Decisions § T-008](tentative-decisions.md#entry-t-008-retroactive-depreciation-recalculation%E2%80%94block-or-auto-recalculate) |
| T-009 | Form 140/141 Statutory Export | Fail-closed: internal neutral data only; no export adapter until Form 140 official utility/schema/portal flow researched and verified | Phase 7 (TDS Compliance) | [Tentative Decisions § T-009](tentative-decisions.md#entry-t-009-form-140141-statutory-export%E2%80%94research-gated-fail-closed) |
| T-010 | Post-Filing Return Case/Evidence/Correction | Preserve case details and correction lineage; no return-amendment or defective-return submission adapter until s263(5)–(7) branches researched | Phase 7 (Income-Tax Compliance) | [Tentative Decisions § T-010](tentative-decisions.md#entry-t-010-post-filing-return-caseevidencecorrection%E2%80%94research-gated-submission) |
| T-011 | Initial Language and Runtime | TypeScript + Bun (contingent on Gate0 proof spikes STK-001–STK-006 passing on macOS arm64, Linux x64/arm64); alternatives: Node.js+TypeScript or Rust | Gate0 (Proof Spikes) | [Tentative Decisions § T-011](tentative-decisions.md#entry-t-011-initial-language-and-runtime%E2%80%94typescript--bun-recommended-gate0-proof-spikes-required) |

---

## Deferred Configuration Inputs

**Not current architectural decisions; configuration inputs for a later phase.**

- **Entity-to-Zoho Organization Mapping**: Phase 9 (Migration) import configuration. Agent-bahi does not embed mapping logic; import remains final and operator-controlled.

---

## Next Steps

1. **Sudhanshu reviews this docket** and each T-ID entry.
2. **Owner approves, adjusts, or rejects** each tentative decision.
3. **Gate0 proof spikes run** (STK-001–STK-006), validating T-011 choice and other technical assumptions.
4. **Owner confirms architecture** and all approved T-IDs before Phase 1 begins.

**Reference**: [Definition of Ready for Implementation](../architecture.md#22-definition-of-ready-for-implementation), [Implementation Plan](implementation-plan.md).
