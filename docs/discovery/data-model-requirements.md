# Data Model Requirements

The domain-level source of truth for pre-implementation bookkeeping behavior
is [Accounting Contracts](accounting-contracts.md). This document remains the
entity/invariant requirement set; it does not duplicate the per-domain command,
state, posting, evidence, and acceptance contract.

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

## GST Registration, Return, and Portal Evidence

The [GST Compliance Matrix — Verified Research Baseline](gst-compliance-matrix.md)
defines the current GST discovery boundary for regular Indian GST taxpayers.
The model must represent a legal-entity tenant with one or more GSTIN
registrations without creating cross-tenant relationships. GST amounts,
obligations, evidence, decisions, and portal observations are scoped to the
tenant and selected GSTIN.

Minimum GST requirements are:

- effective-dated GST registration profiles with GSTIN, state, registration
  type, status, scheme, filing frequency, and effective dates;
- PAN-level AATO facts with source period, source rule, effective dates, and a
  GSTIN-level applicability decision for thresholds and exemptions;
- effective-dated e-invoice and e-way-bill applicability, exemptions, state
  rules, and movement facts;
- tax documents and evidence with document identity, dates, content hashes,
  validation outcome, retention reference, and original-document lineage;
- return obligations with period, cadence, due-date rule/version, source,
  predecessor links, and any filing/extension evidence;
- immutable preparation and filing snapshots, with local product states kept
  distinct from portal-observed states;
- reconciliation-line provenance across books, ledger, GSTR-1, GSTR-2B,
  annual-return inputs, and portal observations;
- explicit ITC states and transitions, including eligible, pending evidence,
  pending match, ineligible, claimed, reversed, and re-eligible, each linked to
  the applicable document, rule, and evidence;
- amendments linked to original documents or return lines with period, reason,
  and correction lineage;
- portal artifacts preserving artifact type, hash, GSTIN/period, upload and
  processing timestamps, signer method, filing timestamp, ARN, response/error
  details, and provenance for every portal observation; and
- an audit trail for preparation, validation, upload observation, portal
  processing, summary review, filing observation, ARN recording, amendments,
  exceptions, and decisions.

Amounts and decisions must remain tenant/GSTIN scoped. These are abstraction-
level requirements only; the GST matrix does not authorize a schema, migration,
CLI behavior, or submission transport.

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

The separate book/tax schedule model is **T-003 TENTATIVE - NOT OWNER-APPROVED**
([tentative decision](tentative-decisions.md#entry-t-003-fixed-asset-depreciation-schedulesbook-vs-tax-with-tentative-slm-default)).
The relationship and exact methods remain configuration/policy boundaries, and
the owner may reverse the tentative default without changing the asset-register
or schedule identity seams. No method or rate may be hidden in the register.

## Bank Reconciliation

Bank reconciliation is a bounded workflow across skills, CLI, and engine:

1. A scheduler or user invokes the bank-reconciliation skill.
2. The skill gathers bank evidence and relevant open records, then proposes
   matches. Proposal generation may be non-deterministic.
3. The CLI validates the tenant, bank account, currencies, amounts, eligible
   status and state transition, and idempotency key before persistence.
4. The validated match and its provenance are persisted together. The engine
   applies only the explicit, validated match; it does not make a hidden AI
   decision.

Provenance must identify the evidence, proposal, skill version, explicit human
confirmation, actor or scheduler, validation outcome, and idempotency key well
enough to reproduce why the match was validated. A scheduler, skill, workflow,
or agent cannot self-authorize persistence.

An imported statement batch is uniquely keyed by tenant + bank account + raw
file content hash. A line fingerprint uses canonical source fields and source
line number/row ordinal, never a generated batch ID. Re-importing the same file
returns the original result; a collision from another file retains both lines
and enters an explicit ambiguity state. Identical legitimate rows are never
silently dropped.

## Period Locking

Lock state supports either a global scope or a module-specific scope. Each lock
has an inclusive `locked-through` date: create, edit, delete, and void
operations for records in that date range are rejected by the authoritative
engine boundary.

Unlocking or bounded partial unlocking requires a reason, acting principal,
audit record, and impact preview before the change is applied. Full unlock uses
`period unlock preview|commit`; partial unlock uses
`period partial-unlock preview|commit`. Preview binds the current lock version,
scope/range, affected-record impact, actor, reason, and plan hash. Commit
requires a recorded explicit human confirmation and revalidates that binding
under serialization. Missing/stale preview, invalid range, or changed lock
returns `UNLOCK_PREVIEW_REQUIRED`, `PARTIAL_UNLOCK_INVALID`, or
`UNLOCK_CONFLICT`; missing confirmation returns `LOCK_CONFIRMATION_REQUIRED`.
If a document arrives for a locked period, a skill may guide the user through
either a controlled reopen followed by original-date posting or a current-
period adjustment. The system never chooses between those treatments
automatically.

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

For mixed-use amounts, let `G` be gross, `B` the explicitly approved business
share, and `P = G - B` the personal share. An employee/director-paid claim
posts `Dr business expense/asset B | Cr employee/director reimbursement payable
B`; only `B` may be reimbursed. A company-paid full bill posts `Dr business
expense/asset B + Dr named recoverable from employee/director P | Cr AP or
Bank G`, or follows a separately reviewed payroll/perquisite path under the
applicable rule. A proprietor-paid full bill posts `Dr business expense/asset B
+ Dr proprietor drawings P | Cr AP or Bank G`. The shares must reconcile
exactly; no allocation approval grants ITC or silently expenses the personal
share.

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
- deterministic bank export artifact with preset/version provenance;
- approved summarized payroll inputs, including payable days, loss-of-pay
  (LOP) days, and approved overtime amounts or hours; and
- full-and-final settlement.

The payroll model must not include attendance, leave-balance, shift, HRMS, or
attendance-import entities. A summarized input may arrive manually or through
external CSV/API evidence, but it remains an approved payroll input and does
not make agent-bahi the system of record for attendance or leave. There is no
employee self-service portal; employee outputs are generated for secure
delivery outside agent-bahi, and claims/evidence enter through operator/agent
workflows.

The export artifact must keep export, upload, bank acceptance, debit, and
reconciliation as distinct states or evidence outcomes. Only export is in
product scope at this stage; an export must not clear the net-pay payable or be
treated as proof of payment.

Payroll inputs, rules, rates, thresholds, contribution ceilings, filing forms,
and calculations must be effective-dated and jurisdiction-scoped. A posted
pay run freezes the input snapshot and rule/rate versions used. Its journal
must be balanced, reproducible from those frozen inputs and versions, and
linked to every payroll line, payable, remittance, filing reference, and bank
export artifact it produces. Corrections follow the same explicit reversal plus
new corrected version lineage as other posted documents.

The standard posting shape is explicit and reproducible: gross compensation
debits the configured payroll expense accounts; employee tax, contribution,
and other deductions credit their corresponding statutory or employee
payables; net pay credits the employee payroll payable; employer contributions
debit employer-cost accounts and credit statutory payables. A remittance or
actual salary payment is recorded only from its explicit, validated external
evidence; the bank export itself never debits bank, clears the net-pay payable,
or proves payment. Bank statement matching/reconciliation records actual salary
payment before an explicit clearing entry. Any jurisdiction-specific component
must use the same effective-dated rule and frozen-input links.

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

3. **Attachment Points**: Tags can be attached at transaction level or
   document-line level for reporting. A transaction-level tag does not replace
   the required line-level representation when a source amount is allocated
   across tags.

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

### Allocation invariant

When a source amount is allocated across reporting tags, represent it as
explicit split document lines. For example, ₹60,000 Project A and ₹40,000
Project B are two lines whose totals reconcile to the original ₹100,000 amount.
Each split line has one unambiguous tag assignment. Do not add a percentage
allocation object or multiple additive tags to one line. The split must
reconcile before posting or export.

Whether tenants may require tags on other documents or lines remains a separate
mandatory-tag policy decision.
