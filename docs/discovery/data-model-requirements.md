# Data Model Requirements

## Canonical Records and Report Basis

Stored invoices, payments, bills, and ledger postings are the canonical accounting records. Cash- and accrual-basis reports are derived views over those records. The data model must not maintain duplicate cash and accrual copies of an invoice, payment, bill, or ledger posting, and changing or selecting a report basis must not rewrite the stored canonical record.

Every tenant must have a default report basis whose value is either `cash` or `accrual`. A basis-aware report uses that tenant default when no explicit basis is supplied. The effective basis and the report date range are report output metadata, so both human-readable and machine-readable results can be interpreted without relying on the caller's request context.

## Multi-Currency and Settlement

Every tenant has one base currency. Documents in the base currency need no
foreign-currency conversion, but every foreign-currency invoice and bill must
preserve:

- The original document currency and all original-currency monetary amounts.
- An immutable exchange-rate snapshot whose direction is document currency to
  tenant base currency.
- The resulting base-currency amounts used for posting and aggregation.

Reports aggregate in the tenant's base currency. A report may drill down to
the original currency and amounts; conversion for display must not replace the
stored document values.

A settlement must preserve the currency and amount that cleared the bank or
cash account, the amount applied to each document in that document's currency,
and the exchange rate used for the application. A settlement may therefore
have different bank/paid-currency and document-currency values without losing
either one. Bank fees and realized exchange gain or loss are separate posting
components, not one undifferentiated settlement adjustment.

Period-end revaluation of open foreign-currency items is represented by an
auditable adjustment linked to the affected open items, rate, date, actor, and
reason. It must not mutate the original document amounts or its immutable rate
snapshot. The exact external rate source is configurable but remains
undecided.

## Fixed Assets

The canonical model must include an asset register and the lifecycle records
needed to support acquisition or capitalization, automatic depreciation, and
disposal tracking. Depreciation runs and disposals must be traceable to the
asset and the resulting ledger postings.

The exact depreciation methods and the relationship between book and tax
schedules are intentionally undecided. They must remain configuration and
policy boundaries rather than assumptions hidden in the register.

## Bank Reconciliation

Bank reconciliation is a bounded workflow across skills, CLI, and engine:

1. A scheduler or user invokes the bank-reconciliation skill.
2. The skill gathers bank evidence and relevant open records, then proposes
   matches. Proposal generation may be non-deterministic.
3. The CLI validates the tenant, bank account, currencies, amounts, eligible
   status and state transition, and idempotency key before persistence.
4. The accepted match and its provenance are persisted together. The engine
   applies only the explicit, validated match; it does not make a hidden AI
   decision.

Provenance must identify the evidence, proposal, skill version, actor or
scheduler, validation outcome, and idempotency key well enough to reproduce why
the match was accepted.

## Period Locking

Lock state supports either a global scope or a module-specific scope. Each lock
has an inclusive `locked-through` date: create, edit, delete, and void
operations for records in that date range are rejected by the authoritative
engine boundary.

Unlocking or bounded partial unlocking requires a reason, acting principal,
audit record, and impact preview before the change is applied. A partial
unlock is bounded to an explicit date range and scope. If a document arrives
for a locked period, a skill may guide the user through either a controlled
reopen followed by original-date posting or a current-period adjustment. The
system never chooses between those treatments automatically.

## Intercompany

Paired intercompany posting is explicitly undecided. The model must not assume
that one side can be posted without a future decision about pairing,
coordination, and failure handling.

## Optional Reporting Tags/Dimensions

### Overview

Tenants can optionally define custom reporting tags (also called dimensions) to organize and filter transactions for reporting purposes. These tags provide flexible grouping and analysis capabilities without affecting core accounting mechanics.

### What Tags Are

Reporting tags are optional, tenant-scoped metadata that can be attached to transactions and document lines. Common examples include:

- **Location**: Physical branch, warehouse, or geographic region
- **Project**: Client project, internal initiative, or cost center
- **Department**: Organizational unit, team, or functional area
- **Cost Center**: Internal cost allocation group
- **Customer Segment**: Market segment, product line, or customer type

### Key Characteristics

1. **Optional**: Tags are entirely optional. Tenants with simple reporting needs require no tag setup or usage.

2. **Tenant-Scoped**: Tag definitions and values are specific to each tenant. One tenant's "Project" tags are isolated from another tenant's "Project" tags.

3. **Attachment Points**: Tags can be attached at:
   - Transaction level (applying to the entire document)
   - Document line level (applying to individual line items)
   - Both levels (tag hierarchies or filtering at multiple levels)

4. **Reporting Applications**: Tags enable:
   - Filtering revenue by location, project, or department
   - Grouping expenses by cost center or customer segment
   - Organizing profit/loss analysis by business unit or product line
   - Drill-down analytics and cross-dimensional queries

### Invariant: No Impact on Core Accounting

Tags **do not** affect:

- Account posting or ledger entries
- Debit/credit balance calculations
- Tax treatment or tax computation
- Compliance calculations (GST, TDS, TCS, withholding, etc.)
- Audit trail or document state

Tags are purely reporting metadata and remain orthogonal to the engine's accounting and compliance functions.

### Undecided Aspects

The following aspects are explicitly **not settled** and remain for future design:

- **Multi-Tag Allocation**: How (or if) to allocate a single transaction across multiple tags simultaneously (e.g., splitting an expense across projects).
- **Mandatory Tag Policies**: Whether (or when) tenants can enforce that certain documents or lines must have a tag attached.

These will be addressed when reporting and allocation workflows are defined.
