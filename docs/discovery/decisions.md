# Discovery Decisions

## Confirmed

- **Product/repository/package/CLI name**: agent-bahi, selected 2026-08-20
- **System boundary**: agent-bahi is a deterministic accounting and compliance engine plus versioned agent job skills
- **Engine ownership**: Skills orchestrate and verify workflows, while accounting rules, tax calculations, permissions and gates, and ledger invariants remain in the engine
- **Automation policy**: Routine, high-confidence work is automated; ambiguity becomes an explicit exception
- **Migration source**: Zoho Books is the eventual migration source, confirmed by Sudhanshu on 2026-08-20
- **Zoho import phase**: Intentionally deferred to the final phase and must not drive the canonical accounting model; Zoho remains the validated migration source

## Working defaults

- India-first with an extensible accounting core
- TypeScript with Bun
- Local SQLite by default with PostgreSQL/MySQL adapters
- No RBAC implementation in v1 while preserving future actor/ownership boundaries

## Open owner decisions

- Mapping of the three legal entities to Zoho Books organizations
- Allowed level of automated government filing
