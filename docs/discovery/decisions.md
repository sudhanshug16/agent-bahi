# Discovery Decisions

## Confirmed

- **Product/repository/package/CLI name**: agent-bahi, selected 2026-08-20
- **System boundary**: agent-bahi is a deterministic accounting and compliance engine plus versioned agent job skills
- **Engine ownership**: Skills orchestrate and verify workflows, while accounting rules, tax calculations, permissions and gates, and ledger invariants remain in the engine
- **Automation policy**: Routine, high-confidence work is automated; ambiguity becomes an explicit exception
- **Migration source**: Zoho Books is the eventual migration source, confirmed by Sudhanshu on 2026-08-20
- **Zoho import phase**: Intentionally deferred to the final phase and must not drive the canonical accounting model; Zoho remains the validated migration source
- **Inventory accounting (v1)**: No inventory accounting in v1; products/services and document lines may carry description, quantity, unit, rate, tax treatment, and configured ledger account, but the system will not implement stock movements, warehouses, stock valuation, automated COGS, batches, serial numbers, or manufacturing
- **Future inventory support**: Future inventory support should be enabled by stable item/document-line references and modular extension boundaries, not by speculative placeholder inventory tables now
- **Optional reporting tags/dimensions**: Tenants can optionally define tenant-scoped reporting dimensions (e.g., location, project, department) and attach them at transaction or line level for filtering and grouping revenue, expenses, and profit/loss in reports; simple tenants require no tag setup; tags do not affect account posting, debit/credit balance, tax treatment, or compliance calculations. Multi-tag allocation and mandatory-tag policies are explicitly undecided.

## Working defaults

- India-first with an extensible accounting core
- TypeScript with Bun
- Local SQLite by default with PostgreSQL/MySQL adapters
- No RBAC implementation in v1 while preserving future actor/ownership boundaries

## Open owner decisions

- Mapping of the three legal entities to Zoho Books organizations
- Allowed level of automated government filing
