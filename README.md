# agent-bahi

The goal is an open-source, agent-native accounting and India-compliance CLI. This project is currently in discovery phase.

Default storage is local SQLite, with future PostgreSQL/MySQL adapters.

**Implementation is intentionally not started.** No code exists yet. All work is discovery documentation.

## Design Status

- [Discovery Decisions](docs/discovery/decisions.md): Confirmed and working defaults (product name, system boundary, tenant independence, multi-GSTIN, etc.).
- [Provisional Architecture Decisions](docs/discovery/architecture-decisions.md): RECOMMENDED architecture choices for review by Sudhanshu before implementation. Includes SETTLED constraints, RECOMMENDED core/CLI/compliance decisions, OPEN RESEARCH facts, and DEFERRED modules. No RECOMMENDED entry implies implementation authorization.
- [Pre-Implementation Architecture](docs/architecture.md): Working architecture combining SETTLED constraints and RECOMMENDED defaults from discovery documents. Awaiting Sudhanshu review, architect-tier debate resolution, proof spike completion, and official research closure before Phase 1 implementation begins.
- [Discovery Roadmap](docs/discovery/roadmap.md): Phased implementation plan with cross-cutting research milestones and explicit gates before Phase 1.
