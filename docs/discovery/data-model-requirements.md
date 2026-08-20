# Data Model Requirements

## Canonical Records and Report Basis

Stored invoices, payments, bills, and ledger postings are the canonical accounting records. Cash- and accrual-basis reports are derived views over those records. The data model must not maintain duplicate cash and accrual copies of an invoice, payment, bill, or ledger posting, and changing or selecting a report basis must not rewrite the stored canonical record.

Every tenant must have a default report basis whose value is either `cash` or `accrual`. A basis-aware report uses that tenant default when no explicit basis is supplied. The effective basis and the report date range are report output metadata, so both human-readable and machine-readable results can be interpreted without relying on the caller's request context.

## Tenant Isolation and Immutable Corrections

Every tenant is fully independent. There is no tenant relationship or
intercompany table, no common-ownership model, and no cross-tenant transaction
invariant. Every accounting command accepts exactly one tenant context and all
records, accounts, evidence, locks, and postings belong to that tenant. An
external agent may orchestrate separate commands for separate tenants, but the
ledger never creates a hidden cross-tenant effect or paired entry.

A posted document is never edited in place. A correction creates an explicit
reversal posting and a new corrected document version. The original document,
reversal, replacement, reason, actor, timestamp, and resulting postings are
immutably linked in a correction/reversal lineage. Reports and audit views must
be able to follow the full lineage without losing the original posted state.

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

## Evidence and Attachments

An evidence/attachment record belongs to exactly one tenant and can be linked
to the document, claim, advance, reimbursement, card statement, or payroll
record it supports. It must preserve:

- document type, issuer, issuer reference or number, and document date;
- content checksum and immutable storage reference;
- tax eligibility and the tax types or claims it supports;
- validation status, validator, validated-at timestamp, and validation result;
- the rule source, rule version, and rule effective start/end dates used for
  validation; and
- a reasoned exception record, including actor, reason, authority, scope,
  timestamp, and expiry or review date, where the applicable law permits an
  exception.

Evidence retention and tax eligibility are separate from a tenant's workflow
threshold. The model must preserve missing, invalid, superseded, and
exception-approved evidence rather than silently treating it as valid.

## Employee Expenses, Advances, Reimbursements, and Cards

The model must include an employee/claimant, expense claim, employee advance,
reimbursement, corporate card account, card statement, card liability, and
settlement links. Each record is tenant-scoped and links to its supporting
evidence and explicit ledger outcome.

Required deterministic outcomes include:

- An employee-paid expense debits the expense account and credits employee
  reimbursement payable.
- An advance credits the bank or cash account and debits employee advance;
  later expense settlement or repayment clears the employee advance with an
  explicit link to the advance and claim.
- A company-card expense debits the expense account and credits the card
  liability; the statement is reconciled to card transactions, and the card
  liability is later paid through a bank transaction.

GST input tax is a separate posting component and must be blocked unless a
valid statutory document and all applicable eligibility checks are present.

## Payroll Domain

Payroll is a first-class, tenant-scoped domain. The model must include:

- employee statutory profile;
- salary structure, salary component, formula, and effective-dated version;
- payroll period, payroll input, pay run, payroll line, and payslip;
- employee tax and contribution deductions;
- employer contributions;
- payable, remittance, and filing references;
- bank payment batch;
- leave and loss-of-pay (LOP) input; and
- full-and-final settlement.

Payroll inputs, rules, rates, thresholds, contribution ceilings, filing forms,
and calculations must be effective-dated and jurisdiction-scoped. A posted
pay run freezes the input snapshot and rule/rate versions used. Its journal
must be balanced, reproducible from those frozen inputs and versions, and
linked to every payroll line, payable, remittance, filing reference, and bank
payment batch it produces. Corrections follow the same explicit reversal plus
new corrected version lineage as other posted documents.

The standard posting shape is explicit and reproducible: gross compensation
debits the configured payroll expense accounts; employee tax, contribution,
and other deductions credit their corresponding statutory or employee
payables; net pay credits the employee payroll payable; employer contributions
debit employer-cost accounts and credit statutory payables; remittance debits
the applicable payable and credits bank; and a bank payment batch clears the
net-pay payable through the selected bank account. Any jurisdiction-specific
component must use the same effective-dated rule and frozen-input links.

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
