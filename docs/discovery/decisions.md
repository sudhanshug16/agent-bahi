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
- **Reporting-tag allocation**: Tenants can optionally define tenant-scoped reporting dimensions (e.g., location, project, department) for filtering and grouping revenue, expenses, and profit/loss in reports; simple tenants require no tag setup. When one source amount is allocated across tags, it must be represented by explicit split document lines (for example, ₹60,000 Project A and ₹40,000 Project B), with one unambiguous tag assignment per split line and split totals reconciling to the source amount. Do not use a percentage-allocation object or multiple additive tags on one line. Tags do not affect account posting, debit/credit balance, tax treatment, or compliance calculations.
- **Canonical accounting records and report basis**: Stored invoices, payments, bills, and ledger postings are canonical. Cash- and accrual-basis reporting must derive views from those records; it must not duplicate or rewrite them for one basis or the other.
- **Tenant report basis default**: Every tenant has a default report basis of `cash` or `accrual`. A basis-aware report command uses that default when the caller omits `--basis`.
- **Report basis CLI contract**: Basis-aware report commands accept the optional exact flag `--basis cash|accrual`. Human-readable and machine-readable output must state the effective basis and date range. Reports whose basis is inherently fixed or legally prescribed must reject an inapplicable `--basis` value with a clear machine-readable error rather than ignore it. Compliance exports use their prescribed recognition rules and cannot be changed by a cosmetic report override.
- **Multi-currency**: Every tenant has exactly one base currency. A foreign-currency invoice or bill preserves its original-currency amounts and an immutable exchange-rate snapshot to base currency. Reports aggregate in base currency and provide original-currency drill-down. A settlement preserves the bank/paid currency and amount, the amount applied in document currency, and the rate used. Deterministic posting recognizes realized exchange gain/loss and bank fees separately. Period-end open-item revaluation is an auditable adjustment and never mutates the original document or rate snapshot.
- **Exchange-rate source**: The exact rate source and selection policy remain configurable and undecided; the model must preserve which rate was used without assuming one provider.
- **Fixed assets**: An asset register, automatic depreciation, and disposal tracking are in scope. Exact depreciation methods and book-versus-tax schedules remain undecided.
- **Bank reconciliation boundary**: A scheduler or user invokes a bank-reconciliation skill. The skill gathers evidence and may propose non-deterministic matches. The CLI validates tenant, account, currency, amount, status, and idempotency, then persists the match and its provenance. The engine contains no hidden AI matching decision.
- **Period locking**: A tenant may have a global or module-specific inclusive `locked-through` date. Create, edit, delete, and void operations within the locked range are rejected. Unlock and bounded partial unlock require a reason, actor, audit record, and impact preview. A late document uses a skill-guided choice between controlled reopen/original-date posting and a current-period adjustment; neither path is automatic.
- **Tenant independence**: Every tenant is fully independent. agent-bahi does not model common ownership, intercompany relationships, or cross-tenant paired entries. Every accounting command operates on exactly one tenant. An external agent may orchestrate separate commands, but the ledger never creates hidden cross-tenant effects.
- **Posted-document correction**: A posted document is corrected through an explicit reversal plus a new corrected version. The original, reversal, replacement, and reason remain immutably linked in the correction history.
- **Expense evidence**: Statutory evidence rules always apply first. A tenant-configured amount threshold may add stricter workflow only where law is silent; it can never weaken a document, voucher, retention, or GST ITC requirement.
- **Employee expenses**: Employee expense claims, employee advances, reimbursements, and corporate-card expenses are in scope and must produce deterministic accounting outcomes.
- **India payroll boundary**: Full India payroll computation and accounting outputs are in scope, but agent-bahi does not include attendance tracking, leave management, shifts, an HRMS, or an attendance-import domain. Payroll may accept approved summarized inputs needed for computation, such as payable days, loss-of-pay days, or approved overtime amounts/hours, through manual input or external CSV/API evidence. Those inputs do not create attendance records or leave balances and agent-bahi is not their system of record. No employee self-service portal is in scope; the product remains agent/CLI-oriented. Payslips and requested employee outputs may be generated for secure delivery outside agent-bahi, while expense claims and payroll evidence enter through operator/agent workflows.
- **Salary disbursement export**: Salary disbursement is export-only. agent-bahi generates deterministic bank-import CSV files from versioned bank presets, starting with a small preset set and expanding later. It must not initiate bank transfers or auto-pay. Export, upload, bank acceptance, debit, and reconciliation are separate states; only export is in scope at this stage, and a generated file is not proof of payment. Bank statement matching/reconciliation records actual payment.
- **Government filing boundary**: There is no single global government-submission policy. GST, TDS, income-tax, MCA, and other filings each require a separately researched output/submission decision because formats, signatures, gateways, acknowledgements, corrections, and risks differ. Until a filing-specific decision is accepted, the docs describe preparation and validation only and must not imply automatic government submission.

## Working defaults

- India-first with an extensible accounting core
- TypeScript with Bun
- Local SQLite by default with PostgreSQL/MySQL adapters
- No RBAC implementation in v1 while preserving future actor/ownership boundaries

## Open owner decisions

- Mapping of the three legal entities to Zoho Books organizations
- Filing-specific output/submission decision for each GST, TDS, income-tax, MCA, or other filing
