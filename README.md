# agent-bahi

The goal is an open-source, agent-native accounting and India-compliance CLI. This project is currently in discovery phase.

Default storage is local SQLite, with future PostgreSQL/MySQL adapters.

**Implementation is intentionally not started.** No code exists yet. All work is discovery documentation.

## Design Status

- [Discovery Decisions](docs/discovery/decisions.md): Confirmed and working defaults (product name, system boundary, tenant independence, multi-GSTIN, etc.).
- [Tentative Decisions and Overnight Protocol](docs/discovery/tentative-decisions.md): Planning defaults selected by workers/agents while the owner is unavailable (not owner-approved). Each tentative entry includes explicit reversal path and owner-review status. Examples: statutory filing workflow (prepare/validate/export + manual portal), Frappe Books reference policy (reference only, Apache-2.0 license recommendation), fixed-asset depreciation (separate book/tax schedules), FX rate handling (immutable snapshots + configurable source), V1 scope (regular small-business GST profiles).
- [Provisional Architecture Decisions](docs/discovery/architecture-decisions.md): RECOMMENDED architecture choices for review by Sudhanshu before implementation. Includes SETTLED constraints, RECOMMENDED core/CLI/compliance decisions, OPEN RESEARCH facts, and DEFERRED modules. No RECOMMENDED entry implies implementation authorization.
- [Pre-Implementation Architecture](docs/architecture.md): Working architecture combining SETTLED constraints and RECOMMENDED defaults from discovery documents. Awaiting Sudhanshu review, architect-tier debate resolution, proof spike completion, and official research closure before Phase 1 implementation begins.
- [Discovery Roadmap](docs/discovery/roadmap.md): Phased implementation plan with cross-cutting research milestones and explicit gates before Phase 1. Phase 2 defines skill contracts/manifests only; Phase 3 implements deterministic lifecycle/posting engine; Phase 4 builds executable skills and daily workflows with Zoho parity.
