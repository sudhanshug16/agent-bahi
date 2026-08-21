# agent-bahi

The goal is an open-source, agent-native accounting and India-compliance CLI. This project is currently in discovery phase.

Default storage is local SQLite, with future PostgreSQL/MySQL adapters.

**Implementation is intentionally not started.** No code exists yet. All work is discovery documentation.

## Design Status

**Awaiting Sudhanshu review before implementation authorization.**

- **[Owner Review Docket](docs/discovery/owner-review-docket.md)**: Compact index of all tentative decisions (T-001 through T-011) awaiting owner approval. Each row links to full entry. **BANNER: All entries are TENTATIVE — NOT OWNER-APPROVED.** Sudhanshu's confirmation is a prerequisite for Gate0 and Phase 1.
- [Implementation Plan](docs/discovery/implementation-plan.md): Gate0 proof spikes, Phase 1–9 sequencing, deliverables, and prerequisites. No implementation is authorized by this plan alone.
- [Discovery Decisions](docs/discovery/decisions.md): Confirmed and working defaults (product name, system boundary, tenant independence, multi-GSTIN, etc.).
- [Tentative Decisions and Overnight Protocol](docs/discovery/tentative-decisions.md): Planning defaults selected by workers/agents while the owner is unavailable (not owner-approved). All entries include explicit reversal path and owner-review status. Examples: statutory filing workflow (prepare/validate/export + manual portal), Frappe Books reference policy (reference only, Apache-2.0 recommendation), fixed-asset depreciation (separate book/tax schedules), FX rate handling (immutable snapshots + configurable source), V1 scope (regular small-business GST profiles), initial language/runtime (TypeScript + Bun, proof-spike contingent).
- [Accounting Contracts](docs/discovery/accounting-contracts.md): Canonical pre-implementation contract for bookkeeping domains, posting templates, CLI errors, evidence, and acceptance scenarios.
- [Zoho Books and Frappe Books Feature Parity Matrix](docs/discovery/zoho-frappe-parity.md): Feature-by-feature comparison of Zoho Books (India) and Frappe Books against agent-bahi's design choices. Confirms that agent-bahi aligns with Zoho Books' workflow parity for core accounting while enforcing stricter tenant isolation, immutable reversal lineage, and deterministic CLI behavior. Notes that payroll features (salary computation, payslips, Form 16) are provided by Zoho Payroll (separate product), not Zoho Books. Frappe Books is referenced as concept/behavior source only (AGPL-3.0; no code reuse). Validates coverage of core bookkeeping, GST, tax (TDS/TCS), FX, fixed assets, banking, and compliance domains.
- [Provisional Architecture Decisions](docs/discovery/architecture-decisions.md): RECOMMENDED architecture choices for review by Sudhanshu before implementation. Includes SETTLED constraints, RECOMMENDED core/CLI/compliance decisions, OPEN RESEARCH facts, and DEFERRED modules. No RECOMMENDED entry implies implementation authorization.
- [Pre-Implementation Architecture](docs/architecture.md): Working architecture combining SETTLED constraints and RECOMMENDED defaults from discovery documents. Awaiting Sudhanshu review, architect-tier debate resolution, proof spike completion, and official research closure before Phase 1 implementation begins.
- [Discovery Roadmap](docs/discovery/roadmap.md): Phased implementation plan with cross-cutting research milestones and explicit gates before Phase 1. Phase 2 defines skill contracts/manifests only; Phase 3 implements deterministic lifecycle/posting engine; Phase 4 builds executable skills and daily workflows with Zoho parity. Links to [Owner Review Docket](docs/discovery/owner-review-docket.md) and [Tentative Decisions](docs/discovery/tentative-decisions.md).
- [Statutory Compliance Baseline](docs/discovery/statutory-workflow-contracts.md): TDS/TCS, annual income-tax, and current Companies Act workflows. The [MCA Companies Act matrix](docs/discovery/mca-companies-act-compliance-matrix.md) is the source boundary for mandatory audit, auditor/OPC/AGM paths, forms, official citations, and `source_verified`/`effective_rule_snapshot` fail-closed gates; tax deadlines remain separate.
