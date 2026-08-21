# Accounting Contracts

**Status:** Canonical pre-implementation contract. This document defines the
bookkeeping boundary that implementation must satisfy. It authorizes no code
or schema work by itself; the Definition of Ready in
[`docs/architecture.md`](../architecture.md#22-definition-of-ready-for-implementation)
still applies.

**As of:** 2026-08-21

**Relationship to other discovery documents:** This is the domain-level
contract assembled from the settled architecture and discovery rules. It does
not replace the [architecture](../architecture.md),
[data-model requirements](data-model-requirements.md),
[CLI contract](cli-contract.md), [skill boundary](skill-architecture.md),
[expense evidence policy](expense-evidence-policy.md),
[GST matrix](gst-compliance-matrix.md),
[payroll matrix](payroll-compliance-matrix.md), or
[roadmap](roadmap.md). If this document describes an unresolved product choice,
the choice is marked **TENTATIVE - NOT OWNER-APPROVED** and points to
[`tentative-decisions.md`](tentative-decisions.md). A reversible implementation
detail that does not change product or statutory behavior may be marked
**INTERNAL_ARCHITECTURE_DECISION**.

## 1. Contract-wide invariants

### 1.1 Scope and command envelope

- One legal entity is one independent tenant. Every accounting command selects
  exactly one tenant; no command creates a cross-tenant relationship or paired
  entry. The effective `tenant_id` is echoed in human and JSON output.
- GST-scoped commands resolve exactly one active, applicable GSTIN. Non-GST
  commands use `gst_context=none`, do not resolve a GSTIN, reject an inapplicable
  `--gstin`, and return `gstin_id: null`.
- Every mutation carries a request ID, tenant context, actor/source, timestamp,
  expected version where applicable, and a content hash. The same request ID
  with the same content returns the original result; the same request ID with
  different content returns `IDEMPOTENCY_CONFLICT`.
- Posted records and ledger postings are immutable. A correction is an
  explicit reversal plus a new replacement version, linked by reason, actor,
  timestamp, and lineage. A posted record is never edited, deleted, or voided
  in place.
- The normal posting lifecycle is exactly:
  `Draft -> Validated -> Posted -> Settled`.
  `Settled` is reached only when the signed open balance is zero after valid
  allocations plus any explicitly approved, balanced credit, write-off, or
  refund journal. Administrative or audited close-out alone never settles an
  AR/AP document. `Partially Allocated`, `Unapplied`, and other open/partial
  states are derived views while the document remains `Posted`; they are never
  a `Settled` shortcut. A document must not skip validation. Pre-post drafts
  may be cancelled/voided; posted records require reversal lineage.
- Every final posting is one atomic balanced journal: total debits equal total
  credits in the relevant currency/base-currency representation. Account
  balances and all report views are derived from the canonical postings.
- A locked period rejects every ledger or settlement mutation whose accounting
  date is on or before the inclusive `locked-through` date: create, edit,
  delete, issue, post, void, reverse, payment creation/posting,
  allocation/deallocation/reallocation, bank match/unmatch/reconciliation,
  credit/debit note, refund, write-off, reclassification, depreciation, FX
  revaluation/realization adjustment, asset disposal, tax/payroll journal,
  opening-balance change, and journal import/posting. Evidence-only attachment
  or import that does not alter books is the sole explicit exception. The
  error names the lock scope and date. Unlock or bounded partial unlock
  requires an authorized, reasoned, audited action, impact preview, and
  explicit confirmation.
- No product rule in this contract invents statutory rates, thresholds, filing
  formats, due dates, or filing behavior. Effective-dated rule packs and the
  applicable GST/payroll matrix supply those facts. Missing, stale, or ambiguous
  rules fail closed for the affected statutory decision while ordinary drafts
  and lawful gross bookkeeping may continue with a visible exception.

### 1.2 Common field and evidence requirements

Every tenant-scoped record has an immutable internal ID, `tenant_id`, created
and updated UTC timestamps, actor/source metadata, and a monotonic version.
Every posted or externally evidenced record also preserves:

- accounting date and tenant fiscal-year/profile version;
- currency, exact amount representation, and base-currency amount where needed;
- source record/document ID, correction lineage, and posting/journal ID;
- request ID and idempotency record;
- evidence IDs, content hashes, validation outcome, and rule-pack versions;
- audit events for state transitions and decisions; and
- optional reporting-tag split lines whose totals reconcile to the source amount.

Evidence is content-addressed and immutable. Missing evidence is retained as a
visible exception, not silently treated as valid. In particular, a missing
receipt never blocks gross expense or asset posting. The bookkeeping-support,
business-purpose, income-tax deductibility, and GST ITC lanes remain separate;
ITC is never inferred from an attachment or portal population alone.

### 1.3 Common CLI and error contract

Command families use the names below as the stable discovery vocabulary. Exact
parser spelling and schema versions are an **INTERNAL_ARCHITECTURE_DECISION**;
the semantic operation and error code are binding.

| Error code | Meaning and required behavior |
| --- | --- |
| `TENANT_REQUIRED` / `TENANT_AMBIGUOUS` | No tenant or more than one active tenant was resolved; do not guess. |
| `GSTIN_REQUIRED` / `GSTIN_AMBIGUOUS` / `GSTIN_NOT_APPLICABLE` | Required GST context is missing, ambiguous, or has no applicable active registration. |
| `NOT_FOUND` / `TENANT_SCOPE_VIOLATION` | The record is absent or belongs to another tenant; never leak another tenant's details. |
| `VALIDATION_FAILED` / `REQUIRED_FIELD_MISSING` | The input or domain invariants are invalid; return field paths and remediation. |
| `INVALID_STATE_TRANSITION` | The requested transition is not allowed from the current state. |
| `POSTED_IMMUTABLE` / `CORRECTION_REQUIRED` | A posted record was targeted for mutation; require reversal plus replacement. |
| `UNBALANCED_POSTING` | The deterministic journal does not balance; commit nothing. |
| `PERIOD_LOCKED` / `LOCK_CONFIRMATION_REQUIRED` | A lock blocks the date or an unlock/reopen lacks preview, reason, or confirmation. |
| `IDEMPOTENCY_CONFLICT` | A request ID was reused for different content; commit nothing. |
| `CONCURRENCY_CONFLICT` / `SERIES_ALLOCATION_CONFLICT` | Expected version or exclusive allocation lock failed; retry only with a newly prepared plan. |
| `MISSING_RULE` / `STALE_RULE` / `AMBIGUOUS_RULE` | A required effective-dated rule is unavailable or not unique; statutory finalization fails closed. |
| `EVIDENCE_EXCEPTION` / `ITC_EVIDENCE_REQUIRED` | Evidence is absent or does not support the requested tax lane; gross bookkeeping may still be allowed. |
| `ALLOCATION_CONFIRMATION_REQUIRED` / `RECONCILIATION_CONFIRMATION_REQUIRED` | No recorded explicit human confirmation is bound to the exact proposal/plan; a skill or workflow cannot self-authorize. |
| `STALE_RECONCILIATION_PLAN` / `RECONCILIATION_PLAN_MISMATCH` | The confirmation is stale or does not deterministically match the exact plan, source line, target, amounts, FX snapshot, expected versions, tenant, actor, or timestamp; commit nothing. |
| `CURRENCY_MISMATCH` / `RATE_REQUIRED` | Currency or explicit rate data is inconsistent or missing. |
| `UNKNOWN_EXTERNAL_OUTCOME` | An external attempt is quarantined; no blind retry or transport switch is allowed. |
| `BASIS_NOT_APPLICABLE` | The caller supplied `--basis` to a fixed-basis report; never ignore it. |
| `UNSUPPORTED_V1_SCOPE` | The request requires inventory, warehouse, COGS, or another deferred product area. |
| `UNLOCK_PREVIEW_REQUIRED` / `PARTIAL_UNLOCK_INVALID` / `UNLOCK_CONFLICT` | Unlock preview is missing/stale, the requested range/scope is invalid, or the lock changed before commit. |
| `REASON_REQUIRED` | A lock, unlock, reversal, void, correction, or other controlled mutation has no non-empty reason. |
| `IMPORT_CONTENT_ALREADY_PRESENT` / `IMPORT_DUPLICATE_LINE_AMBIGUOUS` | The same file was already imported for the tenant/bank account, or identical legitimate rows cannot be distinguished safely; stop for explicit resolution. |

Machine-readable failures contain `error.code`, a plain-language `message`,
`tenant_id` when safely known, `gstin_id` when applicable, field/entity
references, and remediation data. Human output labels the effective tenant,
GSTIN (or `not applicable`), request ID, and exception/warning state.

### 1.4 Shared state, posting, correction, concurrency, and skill boundary

The engine owns state machines, account-role templates, tax calculations,
permissions/gates, period locks, idempotency, and ledger invariants. The CLI
validates input and is the only mutation boundary exposed to people or skills.
Skills gather evidence, propose or sequence work, pause for explicit human
confirmation, call only named CLI commands, and verify the result. An agent
cannot approve its own allocation, reconciliation, tax exception, or period
reopen and cannot import domain services directly.

Routine edits use optimistic version checks. Number allocation, posting,
reconciliation, close/reopen, fixed-asset runs, and other high-consequence
  operations use exclusive serialization plus prepare/preview -> validate ->
  commit with a plan hash. A bank reconciliation/match/allocation proposal is
  non-posting and non-persistent until a recorded human confirmation is
  cryptographically or deterministically bound to the exact plan ID/digest,
  bank source line, target document/payment, amount, currency and FX snapshot,
  expected versions, tenant, actor, and timestamp. Missing, stale, or
  mismatched confirmation returns `RECONCILIATION_CONFIRMATION_REQUIRED`,
  `STALE_RECONCILIATION_PLAN`, or `RECONCILIATION_PLAN_MISMATCH` and commits
  nothing. Deterministic suggestions may be generated but neither an agent,
  skill, scheduler, workflow, nor policy may approve or persist them. A failed
  check rolls back the complete transaction; there is no last-write-wins or
  silent retry.

All templates below name account *roles*, not statutory account names. A tenant
maps roles to its chart of accounts. Tax components are selected by the
effective rule pack; this contract does not state statutory rates.

### 1.5 Number-series invariant

Every invoice, bill, note, receipt, payment, journal, and reserved issuance
number uses a tenant-scoped monotonic series with explicit family, financial
year, and GSTIN scope when applicable. Allocation is serialized; numbers only
move forward and are never reused, even when a draft is cancelled, an external
issuance attempt fails, a transaction rolls back after reservation, or a number
is voided. Every gap is a durable `NumberGap` record containing the number,
series scope, reason (`void`, `reservation_failed`, `external_failure`,
`cancelled`, or another explicit reason), request/operation ID, actor, time,
frozen payload/artifact hash when relevant, and audit evidence. A failed
reservation never releases a number to the allocator.

## 2. Party, contact, address, and tax identity

**Scope and identifiers.** A party is a tenant-scoped customer, supplier,
employee, owner, government authority, or other counterparty. A party has a
stable internal ID and a unique, tenant-scoped human reference. Contact and
address records have their own IDs and effective date/version. Tax identities
are separate typed records, never a free-text replacement for the party: type
(for example GSTIN, PAN, or other configured identity), normalized value,
jurisdiction, status, effective interval, source, and verification result.
There is no cross-tenant party or intercompany identity.

**Required fields and states.** Required fields are party kind, display/legal
name, at least one contact or an explicit `no_contact_provided` exception,
country/jurisdiction, and actor/source. An address requires line/city/region/
postal/country and an effective interval. A tax identity requires type, value,
jurisdiction, effective dates, and verification state. Party states are
`Draft -> Validated -> Active`, with `Suspended` and `Archived`; an identity
may be `Unverified -> Verified` or `Rejected`, and a historical identity is
`Superseded`. Master-data state does not post a journal.

**Validation.** Enforce tenant uniqueness, normalized identity format, no
overlapping active identity/address intervals for the same role, and explicit
GSTIN applicability when a GST document uses the party. Do not infer tax
registration, place of supply, withholding, or legal classification from a
name, address, or email. A party referenced by a posted document is retained;
archive it rather than deleting it.

**Posting template.** None. Party creation, identity verification, address
change, and archive never debit or credit an account. Invoice/bill/posting
commands snapshot the selected party/address/tax identity into their own
immutable document version.

**Corrections, concurrency, and locks.** Correct a referenced identity or
address prospectively by creating a new version; never rewrite a posted
snapshot. Edits use expected version; identity verification and archival use a
tenant-scoped lock. Period locks do not block a non-posting master-data change,
but cannot be used to alter historical document snapshots.

**Evidence and CLI.** Evidence may include registration proof, tax document,
identity verification response, or operator note; each is hashed and linked to
the decision. Command family: `party create|validate|update|archive|show`,
`party address add|supersede`, and `party tax-identity add|verify|supersede`.
Important failures are `REQUIRED_FIELD_MISSING`, `TENANT_SCOPE_VIOLATION`,
`INVALID_STATE_TRANSITION`, `IDEMPOTENCY_CONFLICT`, and `CONCURRENCY_CONFLICT`.

**Skill boundary and reports.** Party/contact skills may normalize supplied
data and request verification, but may not invent identities or select a
GSTIN. The engine returns the verified state. Reports include party master
data, identity verification exceptions, address history, and documents whose
party snapshot no longer matches the current master record.

**Acceptance scenarios.**

1. Two tenants create the same GSTIN value: both may have an isolated record;
   a command in tenant A cannot read or attach tenant B's identity.
2. An agent submits a name with no tax identity for a GST-required invoice:
   the party may remain a draft, but invoice validation returns an explicit
   missing/ambiguous identity error and posts nothing.
3. A supplier changes address after a posted bill: the new address is a new
   effective version and the old bill's address snapshot remains unchanged.

## 3. Chart of accounts and control accounts

**Scope and identifiers.** The chart of accounts (COA) is tenant-scoped. Each
account has a stable internal ID and unique immutable account code within the
tenant, plus a display name. The account record carries account role/type
(asset, liability, equity, revenue, expense, tax, clearing/control), normal
balance, parent, currency policy, reporting classification, active interval,
and control-account metadata. Series are for journal/document families, not
account codes; account codes are never reused.

**Required fields and states.** Required fields are code, name, account type,
reporting classification, normal balance, effective start date, and whether it
is a control account. States are `Draft -> Validated -> Active`, then
`Suspended` or `Archived`; an account with postings cannot be deleted. Control
roles must be configured for at least AR, AP, bank/cash, unapplied receipt,
unapplied payment, tax payable, recoverable ITC, realized FX, unrealized FX,
accumulated depreciation, and any tenant-required clearing role before the
corresponding operation is enabled.

**Validation.** Codes and parent paths are unique and acyclic. Posting to a
group/header account, archived account, incompatible currency, or inactive
account is rejected. The engine derives balances from postings and checks
control-account reconciliation; it never stores a mutable authoritative
balance. A tax or payroll role is usable only when its effective rule/config
binding exists; no account mapping supplies a statutory rate.

**Posting template.** COA maintenance has no posting. All later templates
resolve each role to one active account and fail with `VALIDATION_FAILED` if a
required role is unmapped. Control accounts are the explicit holding places
for unapplied cash, tax pending, ITC, AR/AP, FX, and accumulated depreciation;
they are not hidden suspense balances.

**Corrections, concurrency, and locks.** Rename or reclassify prospectively
with an effective version. A posted account mapping is corrected by a new
mapping and, if needed, a separately approved reclassification journal; never
rewrite old postings. Code allocation and hierarchy edits serialize within a
tenant. A period lock does not block COA master maintenance, but blocks any
reclassification posting into the locked period.

**Evidence and CLI.** Evidence includes owner/configuration approval, mapping
source, and any rule-pack reference. Command family:
`account create|validate|activate|suspend|archive|show`,
`account hierarchy set`, and `account-control map|validate`. Errors include
`ACCOUNT_NOT_POSTABLE`, `ACCOUNT_CODE_REUSED`, `CONTROL_ACCOUNT_UNMAPPED`,
`INVALID_STATE_TRANSITION`, `PERIOD_LOCKED`, and the common idempotency and
concurrency errors.

**Skill boundary and reports.** A COA setup skill can propose mappings and
show unmapped roles; only the engine validates and activates them. Reports
include the COA tree, active/inactive accounts, control-account balances,
unmapped-role exceptions, and trial balance derived from canonical postings.

**Acceptance scenarios.**

1. A user tries to reuse an archived account code: creation fails and the old
   code remains reserved.
2. A journal targets a header account: `ACCOUNT_NOT_POSTABLE` is returned and
   no journal or idempotency side effect is committed.
3. A tenant has two concurrent postings using the same control-account
   mapping: both use the same immutable mapping version or one fails visibly on
   version conflict; neither silently changes the other's account.

## 4. Non-inventory item and service catalog

**Scope and identifiers.** An item/service reference is tenant-scoped with a
stable ID and unique tenant SKU/reference. It stores name/description, unit,
default rate/currency, tax-treatment reference, default income/expense/asset
account roles, active interval, and optional HSN/SAC or other classification
only when supplied and supported by an effective rule. It is descriptive only.
V1 has no stock, warehouse, valuation, COGS, batch, serial, or manufacturing
record; a request requiring those returns `UNSUPPORTED_V1_SCOPE`.

**Required fields and states.** Required fields are type (`item` or `service`),
description/name, unit, default account role, and effective start date. States
are `Draft -> Validated -> Active`, then `Suspended` or `Archived`.

**Validation.** Rates use exact decimal/currency rules and are defaults, not
immutable transaction prices. Tax treatment and classification must be
effective-dated and must not be guessed from a description. A line snapshots
the selected reference, description, quantity, unit, rate, tax treatment, and
account role at validation.

**Posting template.** None for catalog maintenance. A catalog reference only
selects the revenue, expense, or asset role in an invoice/bill template. It
never creates stock or COGS postings.

**Corrections, concurrency, and locks.** Change defaults prospectively by
version; do not rewrite posted line snapshots. SKU allocation and activation
use tenant serialization. Period locks do not block catalog maintenance but
block any attempt to use a changed historical rate/tax snapshot as a rewrite.

**Evidence and CLI.** Preserve supplier/customer price list, classification
source, and tax-rule evidence where supplied. Command family:
`catalog item|service create|validate|activate|archive|show` and
`catalog classify`. Errors include `UNSUPPORTED_V1_SCOPE`,
`ACCOUNT_NOT_POSTABLE`, `MISSING_RULE`, `INVALID_STATE_TRANSITION`, and common
scope/idempotency/concurrency errors.

**Skill boundary and reports.** Catalog skills may normalize descriptions or
propose an account/classification; the engine requires explicit account and
tax treatment before validation. Reports include active catalog, unused or
unmapped references, line snapshot history, and tax-classification exceptions.

**Acceptance scenarios.**

1. A service is used on an invoice: the line snapshots its description and
   account role; no stock quantity or COGS journal exists.
2. A user requests warehouse stock for a catalog item: the command returns
   `UNSUPPORTED_V1_SCOPE` rather than creating placeholder inventory rows.
3. A rate changes after a posted invoice: a new catalog version affects future
   drafts only; the posted line keeps its original rate.

## 5. Estimates and sales orders (non-posting document surface)

**Scope status.** The architecture names SO/PO drafts in the sales and
purchases modules, but a settled owner decision does not separately approve
the estimate/sales-order product surface. The following is therefore
**TENTATIVE - NOT OWNER-APPROVED**, consistent with the scope protocol in
[`tentative-decisions.md`](tentative-decisions.md): if retained in V1, both
estimates and sales orders are non-posting documents. Owner approval may remove
or change this surface without changing the posted ledger contract.

**Scope, identifiers, fields, and states.** Records are tenant-scoped with a
stable ID and separate non-posting series (`EST` and `SO`, or tenant-defined
equivalents) scoped by tenant and financial year. Required fields are party,
document date, expiry/expected date where applicable, currency, line snapshots,
tax-treatment references, totals, and source/evidence metadata. Lifecycle is
`Draft -> Validated -> Sent|Accepted|Rejected|Expired|Cancelled` or
`Converted`; it never enters `Posted` or `Settled` and has no ledger balance.

**Validation.** Validate party, currency, line arithmetic, account-role
references, tax rule availability for a displayed estimate, and duplicate
number/idempotency. Conversion creates a new invoice/bill draft linked to the
source; it does not post the estimate/order and never copies mutable state by
reference.

**Deterministic posting template.** None. Estimates and sales orders never
debit or credit an account, create an AR/AP balance, or enter a ledger report.

**Corrections, concurrency, and locks.** Correction is a new version or
cancellation before conversion; a converted source remains immutable.
Sent/accepted conversion and series allocation use optimistic version checks
plus series serialization. A period lock blocks a transactional accounting
date if conversion would create a posted document; it does not turn the
non-posting source into a journal.

**Evidence and CLI.** Evidence includes quote/order approval,
customer response, and conversion lineage. Command family:
`estimate create|validate|send|accept|cancel|convert` and
`sales-order create|validate|send|accept|cancel|convert`.
Errors include `INVALID_STATE_TRANSITION`, `CONCURRENCY_CONFLICT`,
`SERIES_ALLOCATION_CONFLICT`, `PERIOD_LOCKED`, and common validation errors.

**Skill boundary.** Skills may prepare and present these documents; only
explicit conversion and the invoice/bill CLI can create a posting.

**Reports.** Pipeline counts, open commitments, conversion lineage, and an
explicit note that these documents are excluded from trial balance, P&L,
balance sheet, aging, and cash basis.

**Acceptance scenarios.**

1. An accepted sales order is created: no posting, AR balance, revenue, tax,
   or cash entry is produced.
2. Conversion is requested twice with the same request ID: the same invoice
   draft/result is returned; a different payload with that ID fails closed.
3. An order dated in a locked period is converted: the source remains intact,
   while invoice validation returns `PERIOD_LOCKED` until an explicit reopen or
   current-period choice is approved.

## 6. Customer invoices

**Scope and identifiers.** An invoice is a tenant-scoped business document
with a stable ID and a number allocated only at legal issue/finalization. The
series scope is tenant + applicable GSTIN (if required) + invoice family + FY;
numbers are never reused and gaps receive an explicit reason. A foreign
currency invoice stores the original amounts, immutable rate snapshot, base
amounts, rate source, and rounding metadata.

**Required fields and states.** Required fields are customer party snapshot,
invoice date, due date/payment terms, currency, line snapshots, tax components
or a recorded non-applicability decision, totals, account roles, GSTIN when
`gst_context=required`, and evidence/exception state. State is
`Draft -> Validated -> Posted -> Settled`; settlement is reached only when the
signed AR balance is zero after allocation plus an approved balanced credit,
write-off, or refund journal. Administrative/audited close-out alone never
settles an invoice. Partial/open allocation remains a derived view while the
invoice is `Posted`. An applicable external issuance
gate may insert `Issuance-Pending/Frozen` between Validated and Posted, but ARN
never gates ledger posting.

**Validation.** Validate tenant/GSTIN, party/address/tax identity as required,
line and tax arithmetic, currency/rate, date/period, numbering plan, duplicate
source references, and effective-dated tax rules. If e-invoice applicability
is established by the rule pack, IRN/QR evidence is required before final
issue/post; do not invent applicability or transport. A missing receipt does
not apply to the customer's invoice and must not be silently treated as proof
of payment.

**Deterministic posting template.** On post:

```text
Dr Accounts Receivable (invoice total, base currency)
  Cr Revenue / contra-revenue by line role (net supply amount)
  Cr Output-tax payable by effective tax component (when applicable)
```

Round and allocate components according to the selected effective rule pack.
An invoice with no tax has no output-tax line. The template must balance before
commit.

**Corrections, concurrency, and locks.** A pre-post draft may be cancelled.
After posting, correction is a reversal journal that exactly negates the
original posting plus a new corrected invoice with new version/number lineage;
the original remains reportable. Finalization and number allocation serialize;
draft edits use expected version. A locked accounting date rejects finalization,
void, reversal, or replacement until the controlled reopen or current-period
adjustment choice is explicitly confirmed. If an issuance-pending/frozen
attempt fails, times out, or is abandoned, the frozen candidate and artifact
hash remain immutable; its reserved number is retained as a `NumberGap` with a
void/failure reason and audit evidence. A superseding attempt is a new child
operation and new candidate/number linked to the failed lineage; the reserved
number is never released or reused.

**Evidence and CLI.** Preserve invoice source, customer acceptance where
available, tax calculation/rule version, e-invoice evidence where applicable,
and correction lineage. Command family:
`invoice create|validate|preview|post|show|void|correct` and
`invoice issue-status`. Errors include `GSTIN_AMBIGUOUS`,
`MISSING_RULE`, `UNBALANCED_POSTING`, `POSTED_IMMUTABLE`, `PERIOD_LOCKED`,
`SERIES_ALLOCATION_CONFLICT`, and `UNKNOWN_EXTERNAL_OUTCOME`.

**Skill boundary and reports.** AR skills may gather customer data, prepare a
preview, and verify the posted result; they cannot choose a tax treatment,
skip an issuance gate, or post directly. Reports include invoice register,
AR aging/open balance, tax-output reconciliation, invoice-to-payment lineage,
and correction history. Cash/accrual reports derive from this canonical
invoice/payment data and state the effective basis/date range.

**Acceptance scenarios.**

1. A valid service invoice posts one balanced journal with AR, revenue, and any
   rule-selected output-tax roles; retrying its request ID creates no second
   journal or number.
2. A posted invoice is edited: the command returns `POSTED_IMMUTABLE`; an
   approved correction creates reversal + replacement and both remain visible.
3. Two operators finalize drafts in one series concurrently: numbers are
   unique, gaps are explained, and a failed transaction does not post partial
   entries.

## 7. Vendor bills

**Scope and identifiers.** A bill is a tenant-scoped payable document with a
stable internal ID and a unique supplier reference enforced within the tenant
where the supplier supplies one. The internal bill number uses a tenant + bill
series + FY scope; supplier document identity and GSTIN are separate fields.
Foreign-currency and base-currency data follow the immutable rate contract.

**Required fields and states.** Required fields are supplier snapshot,
supplier document number/date, bill date, due date, currency, line snapshots,
expense/asset roles, tax components or explicit non-applicability,
GSTIN/GST evidence fields when the tax lane applies, totals, and evidence or
exception state. Lifecycle is `Draft -> Validated -> Posted -> Settled`; the
signed AP balance must be zero after allocation plus an approved balanced
credit, write-off, or refund journal. Partial/open settlement is a derived
view while the bill is `Posted`; administrative/audited close-out alone never
settles it.

**Validation.** Validate duplicate supplier document identity, party and tax
identity, line arithmetic, period, currency/rate, account roles, effective tax
rules, and evidence lanes. Missing supplier receipt/bill evidence never blocks
gross bookkeeping posting: post the lawful gross expense/asset with a visible
evidence exception. ITC is independent and remains pending/ineligible until
the prescribed document and other effective conditions are verified; GSTR-2B
alone is not proof. The bill due date affects aging and reminders only; it
never clears AP or makes the bill `Settled`. Only an explicit, validated
payment/credit allocation or an approved balanced write-off/refund journal
that brings signed AP to zero can settle it.

**Deterministic posting template.** Initial gross posting when ITC is not yet
valid:

```text
Dr Expense or asset cost (gross booked amount by line role)
  Cr Accounts Payable (gross amount)
```

When the effective ITC lane is explicitly eligible at validation, the engine
may split the debit into `Expense/asset net` and `Recoverable ITC`; otherwise
the later approved ITC reclassification is:

```text
Dr Recoverable ITC
  Cr Original expense/asset cost (same eligible tax portion)
```

Any tax reversal or ineligible classification is a separate deterministic
adjustment under the effective rule; rates and filing behavior are not stated
here.

**Corrections, concurrency, and locks.** Posted bills require reversal plus a
new corrected bill. Duplicate supplier references and finalization serialize;
draft edits use expected version. Locked periods block bill posting, tax
reclassification, settlement, reversal, and replacement dated in the period.

**Evidence and CLI.** Preserve supplier invoice/debit-note evidence, receipt
of supply where required, GSTR-2B snapshot, validation result, ITC state, and
exception with owner/review date. Command family:
`bill create|validate|preview|post|show|void|correct`,
`bill itc-status`, and `bill itc-reclassify`. Errors include
`EVIDENCE_EXCEPTION`, `ITC_EVIDENCE_REQUIRED`, `DUPLICATE_DOCUMENT`,
`MISSING_RULE`, `POSTED_IMMUTABLE`, `PERIOD_LOCKED`, and
`UNBALANCED_POSTING`.

**Skill boundary and reports.** AP skills may collect bills and propose
categorization or ITC review; the engine decides whether gross posting and
ITC reclassification are valid. Reports include AP aging, bill register,
gross-vs-ITC pending analysis, vendor statement reconciliation, evidence
exceptions, and ITC document/match/claim lanes. Cash/accrual reports remain
derived views.

**Acceptance scenarios.**

1. A bill has no receipt: the gross expense/AP journal posts once with an
   evidence exception; the ITC lane is not marked eligible.
2. A later valid prescribed document and match are explicitly approved: one
   ITC reclassification posts and the original bill remains immutable.
3. A duplicate supplier document is submitted under a new request ID: it is
   rejected before posting and identifies the existing tenant-scoped record.

### 7.1 Deterministic mixed-use and claimant expense templates

These templates implement the settled evidence policy for business/personal
allocation. Let `G` be the validated gross amount, `B` the explicitly approved
business share, and `P = G - B` the personal share. `B` and `P` must be exact
minor-unit amounts that sum to `G`; no universal percentage is inferred. GST
ITC and income-tax treatment remain independent lanes and never follow merely
from the allocation.

**Employee or director pays personally.** Reimburse only the approved business
share. The posting is:

```text
Dr Business expense or asset role                         B
  Cr Employee/director reimbursement payable              B
```

The personal share `P` is not reimbursed or expensed. If a claim contains
`P`, the excess is held as an explicit exception or rejected; it is not
silently paid. When the reimbursement is actually paid, the separate cash
allocation is `Dr Employee/director reimbursement payable B / Cr Bank/Cash B`.

**Company pays the full mixed-use bill.** If the personal share is approved as
a recoverable amount, post:

```text
Dr Business expense or asset role                         B
Dr Named recoverable from employee/director               P
  Cr Accounts Payable or Bank/Cash                        G
```

The recoverable must name the accountable person and source document. A
separately reviewed payroll/perquisite treatment is an alternative explicit
path, not an automatic reclassification; it uses the applicable effective
payroll rule and named payroll/perquisite roles. The personal share is never
silently expensed and allocation approval never grants ITC.

**Sole proprietor pays or the business pays a mixed-use bill.** The business
share is the expense/asset and the personal share is drawings:

```text
Dr Business expense or asset role                         B
Dr Proprietor drawings                                    P
  Cr Bank/Cash or Accounts Payable                        G
```

For a proprietor-paid business expense, use `Dr Business expense/asset B / Cr
Proprietor payable B`, then settle that payable only by an explicit payment or
allocation. Evidence records the premises/vendor/usage facts, allocation
rule version, actor, recorded confirmation where required, and affected tax lanes. A missing receipt does
not block the gross bookkeeping entry, but the relevant tax lanes remain
exception-open or review-required.

**CLI and skill boundary.** Command family:
`expense mixed-use preview|validate|confirm|post`,
`expense claim preview|validate|post`, and
`expense reimbursement preview|post`. `ALLOCATION_CONFIRMATION_REQUIRED`,
`EVIDENCE_EXCEPTION`, `ITC_EVIDENCE_REQUIRED`, and
`RECONCILIATION_CONFIRMATION_REQUIRED` apply. A skill may prepare the split
and evidence bundle; only a recorded explicit human confirmation bound to the
exact `G`, `B`, `P`, source, and rule snapshot permits posting. A workflow,
agent, or skill cannot self-authorize the split. Reports show business,
personal, recoverable, drawings, reimbursement, and tax-lane amounts
separately.

## 8. Credit notes, debit notes, and vendor credits

**Scope and identifiers.** Adjustment documents are tenant-scoped, linked to
the original invoice/bill or a documented standalone reason, and use separate
number series by family, FY, and applicable GSTIN. Their own IDs, source
document IDs, tax-rule snapshots, and correction lineage are immutable.

**Required fields and states.** Required fields are party, note type and
direction, original document reference where required, note date, reason,
currency/rate, affected lines/amount, tax components, and evidence. Normal
lifecycle is `Draft -> Validated -> Posted -> Settled`; `Settled` requires the
signed linked AR/AP balance to be zero after an explicit allocation,
compatible offset, or approved balanced refund/write-off journal. A vendor
credit is a supplier-issued credit against a bill and follows the same state
rule; its credit balance remains open until offset or refund.

**Validation.** Validate that the note does not exceed the eligible source
balance unless an explicit rule/approval permits it, that original references
and tax-period/amendment links are valid, and that the GSTIN/rule context is
correct. A note is not a shortcut around a posted correction. Do not infer tax
rates, legal time limits, or filing transport; store the effective rule and
source.

**Deterministic posting templates.** The engine uses the source document's
account roles and the note's signed direction:

```text
Customer credit note: Dr Revenue/returns and output-tax reversal roles
                     Cr Accounts Receivable
Customer debit note:  Dr Accounts Receivable
                     Cr Revenue and output-tax roles
Vendor credit:        Dr Accounts Payable
                     Cr Expense/asset and input-tax reversal roles
Vendor debit note:    Dr Expense/asset and applicable ITC roles
                     Cr Accounts Payable
```

The effective tax rule controls component eligibility and the exact reversal;
the journal must balance. A note may be a corrective replacement child but
never mutates the source posting.

**Corrections, concurrency, and locks.** A posted note is corrected only with
reversal plus a new note/replacement lineage. Number allocation, source-balance
check, and finalization serialize. Locked periods reject note posting,
reversal, and replacement; an approved current-period adjustment remains
explicitly linked to the original period.

**Evidence and CLI.** Preserve original note, supplier/customer communication,
tax rule, and amendment/portal evidence where applicable. Command family:
`credit-note create|validate|post|void|correct`,
`debit-note create|validate|post|void|correct`, and
`vendor-credit create|validate|post|void|correct`. Errors include
`SOURCE_BALANCE_EXCEEDED`, `INVALID_STATE_TRANSITION`, `MISSING_RULE`,
`PERIOD_LOCKED`, `POSTED_IMMUTABLE`, and `UNBALANCED_POSTING`.

**Skill boundary and reports.** Skills may gather the note and propose its
source link; they cannot silently create a reversal or change the source. AR/AP
reports show notes in aging, source-to-adjustment lineage, tax reconciliation,
and correction history. Compliance exports use their prescribed basis and
reject an inapplicable report-basis flag.

**Acceptance scenarios.**

1. A customer credit note reverses the linked receivable, revenue, and tax
   roles in one balanced journal and reduces the open invoice amount.
2. A vendor credit is posted without a valid ITC document: the payable/cost
   adjustment is recorded, but ITC remains independently pending/ineligible.
3. The same note is retried with its request ID: the original result is
   returned; a different source link under that ID returns
   `IDEMPOTENCY_CONFLICT`.

## 9. Receipts and payments

**Scope and identifiers.** A receipt is money received; a payment is money
paid. Each is a tenant-scoped settlement record with stable ID, document number
from a receipt/payment series scoped by tenant + FY, bank/cash account,
transaction date, external reference if supplied, paid currency/amount, and
evidence. An explicit allocation is a separate child record or atomically
bound plan; receipt/payment creation does not guess its target.

**Required fields and states.** Required fields are direction, bank/cash
account, amount/currency, accounting date, counterparty where known,
external reference where available, and evidence/exception state. Lifecycle is
`Draft -> Validated -> Posted -> Settled`; `Posted` means cash movement booked.
`Settled` is reached only when the signed open balance is zero after valid
allocations plus any explicitly approved, balanced credit, write-off, or
refund journal. `Unapplied`, `Partially Allocated`, `Fully Allocated`,
`Overpaid`, and `Refunded` are derived views, not shortcuts around posting.

**Validation.** Validate bank/cash ownership, currency and rate, duplicate
external reference where reliable, amount precision, period, and evidence. A
bank export or pending instruction is not proof of a payment; actual debit or
credit evidence is required for clearing. Unclear external outcomes are
quarantined and cannot be retried blindly.

**Deterministic posting template.** Initial cash movement uses explicit control
accounts:

```text
Customer receipt: Dr Bank/Cash
                  Cr Unapplied Customer Receipts
Supplier payment: Dr Unapplied Supplier Payments
                  Cr Bank/Cash
```

The payment/receipt must be posted to its bank/cash and unapplied-control
account before any separate allocation can reference it. Alternatively, one
atomic transaction may create the `Posted` cash movement and apply a recorded
human-confirmed allocation in that order; no allocation may reference a
nonexistent or unposted payment. A retry with the same request ID returns the
original result and cannot create a second cash journal or allocation.

**Corrections, concurrency, and locks.** A posted receipt/payment is immutable;
reverse it and create a corrected cash movement. Number allocation, bank
reference uniqueness, and posting serialize; allocation uses row locks on the
cash record and each open item. A locked period blocks cash posting, reversal,
refund, and allocation dated there.

**Evidence and CLI.** Preserve bank statement/receipt, external reference,
source payment advice, and any refund evidence. Command family:
`receipt create|validate|post|show|reverse`,
`payment create|validate|post|show|reverse`, and
`cash-movement evidence attach`. Errors include `CURRENCY_MISMATCH`,
`DUPLICATE_EXTERNAL_REFERENCE`, `UNKNOWN_EXTERNAL_OUTCOME`,
`PAYMENT_NOT_POSTED`, `PERIOD_LOCKED`, `POSTED_IMMUTABLE`, and
`UNBALANCED_POSTING`.

**Skill boundary and reports.** Cash skills may import evidence and prepare an
unapplied movement; only explicit validated CLI commands post it. Skills may
not infer that a bank export equals a debit. Reports include cash/bank ledger,
unapplied receipts/payments, payment register, refund register, and actual
evidence gaps.

**Acceptance scenarios.**

1. A customer receipt arrives with no invoice reference: it posts to the bank
   and unapplied-receipt control account; no invoice is silently selected.
2. A payroll bank file was generated but no debit is observed: no payment
   posting clears net-pay payable; the export remains a separate state.
3. A cash movement retry uses the same request ID: it cannot duplicate the
   bank entry or number.
4. A confirmed allocation names a payment that is still unposted: the command
   fails with `PAYMENT_NOT_POSTED` and writes no allocation.

## 10. Payment allocations, partial/unapplied/overpayment/refund

**Scope and identifiers.** An allocation is tenant-scoped and links one posted
receipt/payment to one or more eligible invoices, bills, notes, or payroll
payables. It has a stable ID, allocation reference, source movement ID, target
ID, applied amount in target currency, paid amount/currency, immutable rate
snapshot, and allocation plan/approval identity. Allocation numbering is
tenant + FY + allocation family; IDs are never reused.

**Required fields and states.** Required fields are source, target (or explicit
unapplied reason), applied amount, currency/rate, date, actor, and evidence.
States are `Proposed -> Human-Confirmed -> Persisted -> Reversed`; a proposal
is non-posting and non-persistent. The document view is `Unapplied`,
`Partially Allocated`, `Fully Allocated`, or `Overpaid`. A refund is a new
confirmed movement linked to the unapplied, overpaid, or signed AR/AP credit
balance and state `Requested -> Human-Confirmed -> Posted -> Settled`.

**Validation and confirmation.** Validate tenant and currency, open balance,
amount precision, eligible state, no duplicate source-target application, and
total allocation not exceeding the source or target unless the excess is
explicitly overpayment/unapplied. Validate signed target balances: a customer
receipt reduces only a positive customer AR/debit open item, not a customer
credit note; a supplier payment reduces only a positive supplier AP/credit open
item, not a vendor credit. A negative signed balance is routed to a compatible
future-document offset or refund workflow. Matching proposals are
non-deterministic; persistence requires a recorded human confirmation bound to
the exact plan ID/digest, bank source line, target document/payment, amount,
currency and FX snapshot, expected versions, tenant, actor, and timestamp.
Agent, skill, scheduler, workflow, or policy approval alone is not human
confirmation and cannot self-authorize. Missing, stale, or mismatched
confirmation returns `RECONCILIATION_CONFIRMATION_REQUIRED`,
`STALE_RECONCILIATION_PLAN`, or `RECONCILIATION_PLAN_MISMATCH`.

| Target balance | Allowed settlement direction | Otherwise |
| --- | --- | --- |
| Customer AR `> 0` (debit/open invoice) | Customer receipt allocation reduces AR | Customer credit balance is not a receipt target. |
| Customer AR `< 0` (credit note/overpayment) | Offset a compatible future document or refund | `TARGET_DIRECTION_INVALID` / `CREDIT_BALANCE_REFUND_REQUIRED`. |
| Supplier AP `> 0` (credit/open bill) | Supplier payment allocation reduces AP | Vendor credit is not a payment target. |
| Supplier AP `< 0` (vendor credit/overpayment) | Offset a compatible future document or supplier refund | `TARGET_DIRECTION_INVALID` / `CREDIT_BALANCE_REFUND_REQUIRED`. |

**Deterministic posting template.** For a customer receipt allocation:

```text
Dr Unapplied Customer Receipts
  Cr Accounts Receivable for the applied invoice/note amount
```

For a supplier payment allocation:

```text
Dr Accounts Payable for the applied bill/note amount
  Cr Unapplied Supplier Payments
```

Cross-currency settlement adds separate bank-fee and realized-FX gain/loss
roles so the applied document amount and bank amount both reconcile. A partial
allocation leaves the residual control balance. An overpayment remains in the
unapplied control account until applied or refunded. The cash movement is
posted first, or is created and posted before the allocation within one atomic
transaction.

**Customer refund** (the tenant pays cash back to a customer). A posted
customer credit note initially credits AR. Refund directly against that signed
AR credit balance:

```text
Dr Customer AR credit balance                                  R
  Cr Bank/Cash                                                  R
```

If a refund control is required, atomically reclassify and pay it:

```text
Dr Customer AR credit balance                                  R
  Cr Customer Refund Payable                                   R
Dr Customer Refund Payable                                     R
  Cr Bank/Cash                                                  R
```

The two legs commit together; never debit revenue a second time. After the
refund, both the AR credit balance and refund control are zero.

**Supplier refund** (a supplier pays cash back to the tenant). A posted vendor
credit initially debits AP. Refund directly against that signed AP debit
balance:

```text
Dr Bank/Cash                                                    R
  Cr Supplier AP debit balance                                  R
```

If a refund control is required, atomically reclassify and receive it:

```text
Dr Supplier Refund Receivable                                  R
  Cr Supplier AP debit balance                                  R
Dr Bank/Cash                                                    R
  Cr Supplier Refund Receivable                                 R
```

The two legs commit together; after the refund, both the AP debit balance and
refund control are zero. A supplier refund never credits bank or uses the
customer control account, and a customer refund never debits bank as if cash
were received. Refunds carry one idempotency identity over all legs; replay
cannot create a second cash movement.

No allocation silently changes revenue, expense, tax, or the original document.

**Corrections, concurrency, and locks.** Reverse an allocation with an explicit
reversal allocation and, if needed, a replacement allocation; never edit its
amount in place. Lock source movement, target open item, and series while
persisting. A locked period blocks allocation/deallocation/reallocation,
reversal, refund, and write-off dated in it.

**Evidence and CLI.** Preserve the candidate proposal, bank evidence, source
and target snapshots, recorded human confirmation, rate, and refund authorization. Command
family: `allocation propose|preview|confirm|persist|reverse|show`,
`allocation refund preview|confirm|post`, and
`allocation unapplied|overpayment`. Errors include
`ALLOCATION_CONFIRMATION_REQUIRED`, `ALLOCATION_EXCEEDS_BALANCE`,
`TARGET_DIRECTION_INVALID`, `CREDIT_BALANCE_REFUND_REQUIRED`,
`PAYMENT_NOT_POSTED`, `CURRENCY_MISMATCH`, `RATE_REQUIRED`,
`CONCURRENCY_CONFLICT`, `PERIOD_LOCKED`,
`RECONCILIATION_CONFIRMATION_REQUIRED`, `STALE_RECONCILIATION_PLAN`, and
`RECONCILIATION_PLAN_MISMATCH`.

**Skill boundary and reports.** The reconciliation skill gathers evidence and
proposes candidates. Only a recorded human confirmation bound to the exact
plan permits CLI persistence; the engine posts deterministically. Reports
include AR/AP aging with partial
balances, unapplied cash, overpayments, refund status, allocation lineage,
FX/fee components, and unmatched candidates.

**Acceptance scenarios.**

1. A ₹100,000 receipt is posted to bank/unapplied cash first, then human-
   confirmed against a ₹60,000 positive AR invoice: the allocation transfers
   ₹60,000, the invoice remains Posted/Partially Allocated, and ₹40,000 remains
   unapplied.
2. Two concurrent users confirm the last ₹60,000 of an invoice: one persists;
   the other receives `CONCURRENCY_CONFLICT` or an eligible-balance error and
   creates no duplicate clearing.
3. A ₹40,000 overpayment is refunded after approval: one refund journal debits
   the control account and credits bank, with refund evidence and no revenue
   reversal.
4. A supplier returns a ₹40,000 overpayment: the refund journal debits bank
   and credits the supplier-payment control/receivable, never credits bank or
   uses the customer refund account.
5. A receipt is proposed against a customer credit note or a supplier payment
   against a vendor credit: the command returns `TARGET_DIRECTION_INVALID`;
   no allocation persists and the balance is routed to offset/refund.

## 11. Journals

**Scope and identifiers.** A journal is a tenant-scoped balanced accounting
document with a stable ID and number from the journal series scoped by tenant +
FY. It may be system-generated from a source document or explicitly created as
a manual adjustment. GSTIN is not applicable unless a journal is explicitly a
GST-scoped tax adjustment; internal journals must reject an irrelevant
`--gstin`.

**Required fields and states.** Required fields are journal date, description/
reason, source type/ID, line account roles/accounts, debit/credit amounts,
currency/base amounts, rule version if a calculated adjustment, actor, and
evidence. Lifecycle is `Draft -> Validated -> Posted -> Settled`; a journal
normally reaches Settled immediately because it has no external open balance.

**Validation.** Validate exactly one tenant, active postable accounts, balanced
debits/credits, currency/rounding, no unsupported tax inference, source
lineage, period, and required approval for high-consequence or control-account
adjustments. A manual journal cannot be used to bypass invoice/bill/payment
state, ITC evidence, payroll rule, or reconciliation gates.

**Deterministic posting template.** A manual journal's template is the explicit
validated list of account roles and amounts:

```text
Dr each supplied debit account role
  Cr each supplied credit account role
```

System journals use the source domain template and retain the source ID. The
engine rejects any imbalance before number allocation/commit.

**Corrections, concurrency, and locks.** Posted journals require reversal plus
replacement journal with reason and linked IDs. Posting-number allocation and
control-account adjustments serialize; drafts use expected version. A period
lock blocks journal posting/reversal/replacement in that period. Reopening is
never inferred from a failed journal.

**Evidence and CLI.** Preserve adjustment memo, support, approval, source
calculation, and rule versions. Command family:
`journal create|validate|preview|post|show|reverse|correct`. Errors include
`UNBALANCED_POSTING`, `ACCOUNT_NOT_POSTABLE`, `POSTED_IMMUTABLE`,
`PERIOD_LOCKED`, `MISSING_RULE`, and `INVALID_STATE_TRANSITION`.

**Skill boundary and reports.** A journal skill may prepare a proposed entry
from evidence and show a plan; only the CLI/engine can validate and post it.
Reports include journal register, account drill-down, adjustment and reversal
lineage, control-account reconciliation, and audit exceptions.

**Acceptance scenarios.**

1. A journal with debits and credits differing by one minor unit returns
   `UNBALANCED_POSTING` and commits no record.
2. A correction to a posted journal creates a balancing reversal and a new
   replacement while preserving the original report trail.
3. A journal command supplied with `--gstin` but declared non-GST fails with an
   explicit inapplicable-context error and does not resolve a GSTIN.

## 12. Bank statement import and reconciliation

**Scope and identifiers.** A bank account and statement batch are tenant
scoped. Each import has a stable batch ID, source filename/reference, raw-file
content hash, bank-account ID, statement period, currency, and import sequence.
The tuple `(tenant_id, bank_account_id, raw_file_content_hash)` is unique:
re-importing the same bytes returns the original batch/result or
`IMPORT_CONTENT_ALREADY_PRESENT` and creates no second batch. The raw content
hash and line fingerprint never include the generated batch ID. Each line has
a stable line ID and a fingerprint from bank account, statement period,
parser/preset version, source line number (or source row ordinal), date, amount,
direction, currency, description, and bank reference. Identical legitimate
rows on different source lines therefore remain distinct.

**Required fields and states.** A batch requires bank account, statement dates,
currency, source evidence/hash, and parser/preset version. A line requires
value date, amount, direction, currency, description, and source reference (or
an explicit missing-field exception). Line state is
`Imported -> Proposed -> Human-Confirmed -> Persisted -> Reconciled`, with
`Unmatched`, `Held`, `Rejected`, and `Exception` outcomes. Proposal is not a
match and never posts.

**Validation and confirmation.** Validate tenant/account ownership, parser
version, content-hash uniqueness, line fingerprints, currency, precision,
opening/closing balance reconciliation where the source supplies it, and
eligible target state. A fingerprint collision from a different file is not
silently deduplicated: retain the complete new line and evidence, mark both
lines `AmbiguousDuplicate`, and require explicit human resolution before any
match. Missing line numbers use the stable source row ordinal; identical rows
in one file are never dropped. A skill may rank candidates; only a recorded
explicit human confirmation bound to the exact plan ID/digest, bank source
line, target document/payment, amount, currency and FX snapshot, expected
versions, tenant, actor, and timestamp is persisted. Missing, stale, or
mismatched confirmation returns `RECONCILIATION_CONFIRMATION_REQUIRED`,
`STALE_RECONCILIATION_PLAN`, or `RECONCILIATION_PLAN_MISMATCH`; no proposal or
match mutates state. Import is atomic per batch unless the contract returns a declared,
non-zero partial result (the default is reject the full invalid batch).

**Deterministic posting template.** Import and proposal have no posting.
Persisting a match has no hidden posting; it links an already posted cash
movement to an invoice/bill/payment. If a bank fee or unrecorded cash event is
explicitly approved, create a separate journal:

```text
Dr Bank-fee or configured expense role
  Cr Bank/Cash
```

Actual salary/payment clearing is posted only after the statement evidence
supports the debit; an export or bank acceptance is not a debit.

**Corrections, concurrency, and locks.** An imported source line is immutable;
correction creates a new observation or reversal of the match, never mutation
of the source evidence. Match persistence locks the bank line and target open
item. A period lock blocks a new posting, fee journal, or correction dated in
the period, but does not delete or hide imported evidence.

**Evidence and CLI.** Preserve original statement bytes/hash, parser preset,
line mapping, candidate proposal, skill version, actor, recorded human confirmation, validation,
and result. Command family:
`bank-account create|show`, `bank-statement import|show|reject`,
`reconciliation propose|review|match|unmatch|show`, and
`reconciliation fee preview|post`. Errors include
`RECONCILIATION_CONFIRMATION_REQUIRED`, `STALE_RECONCILIATION_PLAN`,
`RECONCILIATION_PLAN_MISMATCH`, `DUPLICATE_STATEMENT_LINE`,
`IMPORT_CONTENT_ALREADY_PRESENT`, `IMPORT_DUPLICATE_LINE_AMBIGUOUS`,
`CURRENCY_MISMATCH`, `TENANT_SCOPE_VIOLATION`, `PERIOD_LOCKED`, and
`CONCURRENCY_CONFLICT`.

**Skill boundary and reports.** The bank-reconciliation skill gathers
statement/open-item evidence and proposes candidates. Deterministic suggestions
may be generated, but the skill must stop until a human confirmation is
persisted and bound to the exact plan. The CLI is the sole write boundary;
the engine owns matching eligibility and posting. Reports include statement
coverage, unmatched and ambiguous lines, reconciled balances, bank-to-ledger
variance, fees, payment evidence, and provenance by skill/version.

**Acceptance scenarios.**

1. The same CSV bytes are imported twice for one bank account: the second
   command returns the existing batch or `IMPORT_CONTENT_ALREADY_PRESENT` and
   creates no duplicate batch.
2. A CSV contains repeated legitimate rows: source line number/ordinal keeps
   both fingerprints distinct; no line is silently dropped.
3. A fingerprint collides with a line from another file: both lines remain
   visible as `AmbiguousDuplicate` until explicit human resolution.
4. A skill proposes two invoice matches for one credit: no match is persisted
   until a human confirms one; the rejected candidate remains in provenance.
5. A bank statement shows a salary debit after a generated export: the
   explicit debit can clear net-pay payable once, while the export alone never
   posts or clears it.

## 13. FX realization and period-end revaluation

**Scope status.** Immutable document and settlement rate snapshots, separate
realized FX, and auditable open-item revaluation are settled. The exact FX
provider and fallback chain remain **TENTATIVE - NOT OWNER-APPROVED / OPEN
RESEARCH** under [T-004](tentative-decisions.md#entry-t-004-exchange-rate-provider-and-fx-workflowtentativeopen-pending-source-audit).
No provider, statutory rate, or automatic fallback is invented here.

**Scope and identifiers.** FX data is tenant-scoped with one base currency.
Each foreign-currency document, settlement allocation, rate snapshot, and
revaluation adjustment has a stable ID, source document/open-item IDs, source
and target currencies, exact quote direction, rate, source/timestamp, and
rounding metadata. A settlement also persists document-currency amount and
carrying base value removed, actual paid currency and amount, paid-currency-
to-base rate snapshot, bank base value, allocation amount, and realized FX.
Revaluation runs use a tenant + period + currency/open-item scope and an
immutable run ID.

**Required fields and states.** A foreign document/bill requires original
currency amounts and immutable document-to-base rate snapshot. A settlement
requires document currency/amount and carrying base value for the applied
slice, actual paid currency/amount, paid-currency-to-base rate snapshot, bank
base value, allocation amount, and realized FX. A revaluation requires period,
open-item set, rate snapshot, rule/source, plan hash, actor, and reason.
Settlement follows the common
document lifecycle; rate snapshots are `Captured -> Verified -> Bound`, and a
revaluation run is `Draft -> Validated -> Posted -> Reversed`.

**Validation.** Reject missing/ambiguous rate, reversed quote direction,
floating-point/precision loss, changed bound rate, wrong open-item set, or
cross-tenant source. A selected rate is immutable after posting. Revaluation
must not mutate the original document or settlement rate and must not combine
realized and unrealized gain/loss.

**Deterministic settlement formulas and direction table.** Use the actual
paid amount, never the document quantity, to determine bank cash. For each
explicitly allocated slice, persist:

```text
Q_doc = applied amount in document currency
K = current document carrying base value removed by this allocation
Q_paid = actual paid/received amount in the paid currency
R_paid = immutable paid-currency-to-base rate snapshot
B = round(Q_paid * R_paid)         gross bank base value
F = separately validated bank fee in base currency
FX_AR = B - K                      signed receivable FX result
FX_AP = K - B                      signed payable FX result
```

`Q_doc` and `K` come from the document/open-item allocation; `Q_paid` and `B`
come from the actual bank settlement. `Q_doc * R_paid` is not a bank-value
shortcut. The canonical posting is exactly two cash-settlement legs: first
post actual gross bank cash once to the appropriate unapplied control, then
clear that control against AR/AP in the allocation/reclassification leg. The
table below is the two-leg posting, not an additional aggregate journal; the
allocation leg includes realized FX and never reposts Bank/Cash. `F` is
separate and never changes realized FX. For an incoming receipt, the separate
fee journal `Dr Bank-fee expense F / Cr Bank/Cash F` may reduce the net bank
balance after the one gross cash leg; for an outgoing payment it increases the
net bank decrease by `F`. Rounding occurs once at the declared base-currency
posting stage and any residual rounding unit is an explicit fee/FX rounding
role, never silently dropped.

| Open item | Condition | Cash-first leg (posted once) | Allocation/reclassification leg (no Bank/Cash repost) |
| --- | --- | --- | --- |
| Receivable | `FX_AR >= 0` | `Dr Bank/Cash B`; `Cr Unapplied Customer Receipts B`. | `Dr Unapplied Customer Receipts B`; `Cr Accounts Receivable K`; `Cr Realized FX Gain FX_AR`. |
| Receivable | `FX_AR < 0` | `Dr Bank/Cash B`; `Cr Unapplied Customer Receipts B`. | `Dr Unapplied Customer Receipts B`; `Dr Realized FX Loss -FX_AR`; `Cr Accounts Receivable K`. |
| Payable | `FX_AP >= 0` | `Dr Unapplied Supplier Payments B`; `Cr Bank/Cash B`. | `Dr Accounts Payable K`; `Cr Unapplied Supplier Payments B`; `Cr Realized FX Gain FX_AP`. |
| Payable | `FX_AP < 0` | `Dr Unapplied Supplier Payments B`; `Cr Bank/Cash B`. | `Dr Accounts Payable K`; `Dr Realized FX Loss -FX_AP`; `Cr Unapplied Supplier Payments B`. |

The document-to-base rate and any original rate are retained to explain the
document, but settlement uses current `K` so a prior revaluation is not
double-counted. If the item has a prior
unrealized gain `U`, reclassify it exactly once at settlement with `Dr
Unrealized FX Gain U / Cr Realized FX Gain U`. If it has a prior unrealized
loss `U`, use `Dr Realized FX Loss U / Cr Unrealized FX Loss U`. Then apply the
table above; do not post another copy of `U`.

**Sign examples and partial settlements.** A €100 receivable slice with
`K=₹10,000`, actual receipt `Q_paid=€98`, `R_paid=₹90/€`, gives `B=₹8,820`
and `FX_AR=-₹1,180`: cash-first leg `Dr Bank ₹8,820; Cr Unapplied Customer
Receipts ₹8,820`; allocation leg `Dr Unapplied Customer Receipts ₹8,820; Dr
Realized FX Loss ₹1,180; Cr AR ₹10,000`. A €100 payable slice with
`K=₹10,000`, actual payment `€102` at `₹90/€`, gives `B=₹9,180` and
`FX_AP=₹820`: cash-first leg `Dr Unapplied Supplier Payments ₹9,180; Cr Bank
₹9,180`; allocation leg `Dr AP ₹10,000; Cr Unapplied Supplier Payments ₹9,180;
Cr Realized FX Gain ₹820`. A partial payment stores only its allocated
`Q_doc`, `K`, `Q_paid`, and `B`; the remaining document balance stays open and
the cash-first leg is still posted only once. One payment allocated to multiple
documents requires explicit per-slice paid amounts/rates and leaves any
unallocated cash in the unapplied control. One idempotency key covers both
legs, the allocation/reclassification, FX snapshot, and any partial slice;
retry returns the original result and never creates a second Bank/Cash leg.

**Deterministic revaluation formulas and direction table.** For open foreign
quantity `Q_open`, prior carrying rate `R_prev`, and close rate `R_close`,
compute the base-currency change `D = round(Q_open * (R_close - R_prev))`.

| Open item | Rate movement | Revaluation journal |
| --- | --- | --- |
| Receivable | `D > 0` (rate rises) | `Dr Accounts Receivable D`; `Cr Unrealized FX Gain D`. |
| Receivable | `D < 0` (rate falls) | `Dr Unrealized FX Loss -D`; `Cr Accounts Receivable -D`. |
| Payable | `D > 0` (rate rises) | `Dr Unrealized FX Loss D`; `Cr Accounts Payable D`. |
| Payable | `D < 0` (rate falls) | `Dr Accounts Payable -D`; `Cr Unrealized FX Gain -D`. |

If an item remains open at the next period boundary, reverse the exact prior
revaluation journal with the same base amount and linked run ID before posting
the next close-rate adjustment. If it settles first, do not post that separate
reversal: the settlement reclassifies the active unrealized gain/loss as shown
above and clears the carrying amount `K`; the revaluation run is marked
realized/closed for that slice. Original document and rate snapshots never
change. Any book/tax or statutory treatment uses only an effective rule and
separate adjustment roles.

**Corrections, concurrency, and locks.** Correct a realized settlement or
revaluation with reversal plus replacement and preserve both rate snapshots.
Rate binding, allocation, and revaluation run use exclusive locks over the
affected tenant/open items. A locked period rejects a dated revaluation,
reversal, or replacement; a later-period adjustment must be explicit.

**Evidence and CLI.** Preserve bank advice, source document, rate source,
provider response/manual source, quote direction, precision, and plan hash.
Command family: `fx-rate capture|verify|show`,
`fx settlement preview|post|reverse`, and
`fx revalue preview|validate|post|reverse`. Errors include `RATE_REQUIRED`,
`CURRENCY_MISMATCH`, `AMBIGUOUS_RULE`, `UNKNOWN_EXTERNAL_OUTCOME`,
`PERIOD_LOCKED`, and `UNBALANCED_POSTING`.

**Skill boundary and reports.** FX skills may collect a source rate and prepare
a revaluation preview; they cannot silently select a provider/fallback or
rewrite a bound rate. Reports include foreign open items, rate provenance,
realized FX, unrealized revaluation by period, reversals, bank fees, and base/
original currency drill-down.

**Acceptance scenarios.**

1. A USD bill and INR settlement preserve both original amounts and the
   application rate; the deterministic journal separates AP clearing, bank,
   fee, and realized FX.
2. A period-end rate changes an open receivable: revaluation posts a separate
   unrealized adjustment and the invoice's original rate remains unchanged.
3. A rate provider is unavailable: the command returns `RATE_REQUIRED` or
   requests an explicit documented source; it does not silently use today's
   rate.

## 14. Fixed assets and separate book/tax schedules

**Scope status.** Asset register, acquisition/capitalization, depreciation,
disposal, and traceable journals are settled as a product area. The exact book
method and tax depreciation rule remain **TENTATIVE - NOT OWNER-APPROVED** in
[T-003](tentative-decisions.md#entry-t-003-fixed-asset-depreciation-schedulesbook-vs-tax-with-tentative-slm-default)
and [open research](architecture-decisions.md#open-research--deferred-list).
The tentative SLM default is not a statutory claim and must not be coded until
the owner/research gate is closed.

**Scope and identifiers.** Each asset, asset class, book schedule, tax
schedule, depreciation run, capitalization event, and disposal has a stable
tenant-scoped ID. Asset codes are unique within the tenant and never reused.
An asset stores acquisition source, in-service date, location/custodian,
currency/cost, residual/value basis, book-policy version, tax-rule-pack
version, useful-life/method inputs where approved, and linked evidence.

**Required fields and states.** Acquisition requires supplier/source document,
cost components, date, asset class, capitalization decision, account roles,
and evidence/tax lane. Asset state is `Proposed -> Capitalized -> In Service
-> Fully Depreciated|Disposed`; schedule state is `Draft -> Validated ->
Active -> Superseded`. Depreciation run is `Draft -> Validated -> Posted`.
Book and tax schedules are always separate records, even when their results
coincide.

**Validation.** Validate cost arithmetic, source/document, asset class,
capitalization policy, in-service date, account mappings, rule versions,
period, and duplicate asset identity. An immutable source document and source
line may capitalize at most once, regardless of whether the requested posting
is a bill-line, direct-cash, or other capitalization kind: the engine enforces
a unique `(tenant_id, source_document_id, source_line_id)` and returns
`DUPLICATE_CAPITALIZATION` on any second attempt or second kind. Tax schedule
calculations fail closed without an applicable effective rule. Book schedule
defaults are configuration, not hard-coded law. Do not infer ITC from
capitalization or receipt presence.

**Deterministic posting templates.** The recommended single owner is the bill
line when an AP bill carries asset-capitalization metadata. That source journal
both capitalizes the asset and creates the asset-register record:

```text
Dr Fixed-asset cost role (and eligible recoverable-tax role only when valid)
  Cr Accounts Payable
```

No second capitalization journal may be generated from the same bill line. A
direct cash/manual acquisition has its own one-time source journal instead:

```text
Dr Fixed-asset cost role (and eligible recoverable-tax role only when valid)
  Cr Bank/Cash
```

The asset register links to the source journal and source line. The same
`(tenant_id, source_document_id, source_line_id)` idempotency identity applies
to direct/manual and bill-line acquisition, so a bill-plus-manual attempt (or
any second capitalization kind) is rejected rather than double-posted.

Book depreciation run:

```text
Dr Book depreciation expense by class/department
  Cr Accumulated depreciation for the asset
```

Tax schedule is separately calculated and reported. It does not silently
rewrite book depreciation or post a statutory tax adjustment; any tax-only
ledger adjustment requires an approved effective rule and distinct tax-
adjustment roles.

Book disposal uses explicit base-currency values: `C` = asset cost being
removed, `A` = accumulated book depreciation being removed, `N = C - A` = book
net carrying amount, `P` = cash or receivable proceeds before tax, and `T` =
separately calculated disposal tax under the effective rule. The balancing book
result is `L = P - N`: positive `L` is a gain and negative `L` is a loss.

```text
Dr Cash/Receivable for proceeds plus tax                 P + T
Dr Accumulated depreciation                               A
Dr Disposal loss                                         max(-L, 0)
  Cr Fixed-asset cost                                    C
  Cr Disposal gain                                       max(L, 0)
  Cr Output-tax payable or other separate tax role       T
```

The entry balances because `P + T + A + max(-L, 0) = C + max(L, 0) + T`.
`T` is never folded into gain/loss or asset cost. The tax schedule separately
closes the asset's tax basis using its effective rule-pack version and records
tax proceeds and tax gain/loss as a non-book schedule result; a tax-only ledger
adjustment, if an approved rule requires one, uses separate tax-adjustment
roles and a separate journal. Asset cost and accumulated depreciation remain
immutable history; a correction is reversal plus replacement.

**Corrections, concurrency, and locks.** A posted acquisition/depreciation/
disposal is corrected by reversal plus replacement; schedule history and
already-posted runs remain immutable. Asset activation and depreciation runs
serialize per tenant/asset/period. Locked periods block acquisition/
capitalization, depreciation, disposal, reversal, and schedule-affecting
replacement.

**Evidence and CLI.** Preserve invoice, capitalization approval, asset
identity, in-service evidence, book/tax rule versions, run plan, disposal
evidence, and tax-lane exceptions. Command family:
`asset create|validate|capitalize|show|dispose`,
`asset-schedule book|tax create|validate|supersede`, and
`depreciation preview|validate|post|reverse`. Errors include `MISSING_RULE`,
`STALE_RULE`, `DUPLICATE_ASSET`, `DUPLICATE_CAPITALIZATION`, `PERIOD_LOCKED`, `POSTED_IMMUTABLE`, and
`UNBALANCED_POSTING`.

**Skill boundary and reports.** Fixed-asset skills gather invoices and
physical/in-service evidence, prepare runs, and verify journals. They cannot
choose an unresolved tax method or merge book and tax schedules. Reports
include asset register, additions/disposals, book depreciation, tax schedule,
book-vs-tax variance, accumulated depreciation, and evidence exceptions.

**Acceptance scenarios.**

1. A capital asset is acquired with missing receipt: lawful gross acquisition
   bookkeeping can post with an evidence exception; ITC is not inferred.
2. A book depreciation run posts while its tax schedule remains separate; the
   report shows the variance without rewriting the book journal.
3. A disposal correction is requested in a locked period: it fails visibly;
   after approved reopen/adjustment, reversal and replacement preserve the
   original asset history.

## 15. Close and reopen

**Scope and identifiers.** Close is a tenant-scoped, period-scoped control
record with stable ID, period boundaries, module scope (global or specific),
preparation plan hash, checklist results, actor/approval, and lock ID. Reopen
is a separately identified, bounded control operation. Close/reopen records do
not share a document number series; their IDs and audit records are immutable.

**Required fields and states.** Close requires tenant, period, scope, trial
balance/report snapshots, unresolved exceptions, reconciliation status, open
items, pending statutory/evidence gates where relevant, actor, and explicit
approval. State is `Draft -> Validated -> Approved -> Closed`; a reopen is
`Requested -> Previewed -> Confirmed -> Open`, followed by a new `Closed`
record after work. Close is not complete merely because a lock write succeeds.

**Validation.** The engine checks balanced ledger, required reconciliations,
unresolved exception policy, pending allocations, FX/asset/payroll runs in
scope, and applicable rule/evidence gates. The system never invents a
statutory filing result from a local report. For a late document the user must
choose controlled reopen/original-date posting or current-period adjustment;
the skill cannot select automatically. Administrative close-out never clears
an AR/AP balance. A write-off requires an explicitly approved balanced journal,
source document/open-item linkage, evidence of the reason, an effective
amount/tolerance rule, and a lock check:

```text
Customer receivable write-off: Dr Approved write-off expense/allowance
                                  Cr Accounts Receivable
Supplier payable write-off:    Dr Accounts Payable
                                  Cr Approved write-back/other income
```

The write-off journal must reduce the signed open balance to zero for the
closed slice, or leave the exact residual visible; it cannot exceed the
approved amount/tolerance. A credit note, refund, or write-off is a separate
ledger event linked to the source and cannot be hidden in close status.

**Posting template.** Close/reopen itself has no journal. Required adjustment,
depreciation, FX, or correction journals are separate validated documents. A
current-period adjustment uses the normal journal/document template and links
back to the late source and close decision.

**Corrections, concurrency, and locks.** A close decision is immutable; a
reopen creates a new bounded control record with reason, impact preview, actor,
and approval. Close/reopen uses exclusive tenant/period serialization. While
closed, all in-period mutation commands return `PERIOD_LOCKED`; a failed write
cannot implicitly open the period. Every credit, allocation, refund, or
write-off still requires its own source linkage, approval, evidence, and
balanced posting; close cannot mask an uncleared ledger amount.

**Exact unlock protocol.** Full unlock uses
`period unlock preview --scope <global|module> --through <date> --reason <text>`
followed by `period unlock commit --preview <plan_id> --confirmation <human_confirmation>`.
Partial unlock uses
`period partial-unlock preview --scope <global|module> --from <date> --to <date> --reason <text>`
followed by `period partial-unlock commit --preview <plan_id> --confirmation <human_confirmation>`.
Preview is read-only and records the current lock version, prior lock interval,
requested interval/scope, affected records and expected impact, actor, reason,
and plan hash. Commit requires the same tenant, actor, non-empty reason, exact
plan hash, current lock version, and a recorded explicit human confirmation;
it revalidates impact inside the transaction and writes the unlock audit event
atomically. A stale preview, missing confirmation, invalid range, or changed
lock commits nothing.

**Evidence and CLI.** Preserve checklist, report hashes, reconciliations,
exception list, approval token, lock state, reopen impact, and resulting
adjustments. Command family: `period close preview|validate|approve|commit`,
`period reopen preview|confirm|commit`, `period unlock preview|commit`,
`period partial-unlock preview|commit`, `period lock show`, and
`period late-document preview|choose`. Errors include
`LOCK_CONFIRMATION_REQUIRED`, `UNLOCK_PREVIEW_REQUIRED`,
`PARTIAL_UNLOCK_INVALID`, `UNLOCK_CONFLICT`, `PERIOD_LOCKED`,
`CONCURRENCY_CONFLICT`, `RECONCILIATION_CONFIRMATION_REQUIRED`, and
`INVALID_STATE_TRANSITION`.

**Skill boundary and reports.** Close skills gather checklists, produce
previews, and route exceptions. The engine owns lock semantics and final
approval. Reports include close checklist/status, locked-through dates,
reopen history, late-document decisions, unresolved exceptions, and post-close
adjustment lineage.

**Acceptance scenarios.**

1. A period close preview finds an unreconciled bank line: it cannot commit
   until the exception is resolved and any required human reconciliation
   confirmation is recorded.
2. An invoice dated inside a closed period is attempted: `PERIOD_LOCKED` names
   the period; no date shift or posting occurs automatically.
3. The user approves a bounded reopen, posts the late document, and relocks:
   each action has separate audit records and the final lock is visible.
4. A close request tries to mark an invoice settled while a signed AR balance
   remains: it fails; only a linked approved credit, refund, or write-off
   journal bringing the balance to zero can settle it.

## 16. Reports and derived views

**Scope and identifiers.** Reports are tenant-scoped read operations with a
stable report name/version, request ID, date range or as-of date, filters,
effective basis, rule versions, source snapshot identifiers, and output hash.
They do not allocate numbers or create business-document IDs.

**Required inputs and states.** A report requires exactly one tenant, date
range/as-of date, report type, output format, and any applicable GSTIN. A
basis-aware report accepts exact `--basis cash|accrual`; if omitted it uses
the tenant default and returns the effective basis. A fixed-basis/compliance
report rejects an inapplicable flag with `BASIS_NOT_APPLICABLE`. Report state
is `Requested -> Validated -> Generated` or `Exception`; generation is
read-only.

**Validation.** Validate tenant/GSTIN, dates, filters, report version, source
snapshot consistency, tag split reconciliation, currency conversion metadata,
and fixed-basis semantics. Cash and accrual are derived views over the same
canonical invoices, bills, payments, and postings; the report command never
rewrites or duplicates those records. A compliance export uses its prescribed
recognition rules and does not accept a cosmetic basis override.

**Recognition semantics.** Accrual P&L, trial balance, balance sheet, AR/AP
aging, and tax reports use posted journal dates and as-of ledger balances.
Cash-basis P&L recognizes income or expense pro rata from settled document
components on payment/allocation dates: an invoice with ₹100 revenue and a
₹40 payment recognizes ₹40 cash-basis revenue and leaves ₹60 deferred; a
second ₹60 payment recognizes the remainder. Unapplied cash and overpayments
remain balance-sheet controls until applied. Refunds reverse the linked
component on the refund/linked-allocation date; credit/debit notes follow their
settlement/application date. Taxes follow the jurisdiction-specific
cash/accrual rule and fail closed when that rule is unknown. Realized FX and
fees are recognized on settlement date. Unrealized revaluation and
depreciation remain accrual-only unless an explicit supported cash-basis policy
says otherwise. Trial balance and balance sheet remain ledger/as-of reports;
they never silently switch to payment-date accounting.

**Posting template.** None. Reports never debit, credit, settle, reconcile,
close, or repair a ledger. A report that finds an imbalance or drift returns an
exception and points to source postings; it does not auto-fix them.

**Corrections, concurrency, and locks.** A report output is an immutable
snapshot/hash; regenerate a new version when source state changes. Read-only
reports may run against a locked period and must show its lock state. A
high-consequence filing/close snapshot uses prepare/validate/commit and an
exclusive snapshot lock; an ordinary report does not open a period.

**Evidence and CLI.** Preserve query parameters, effective tenant/GSTIN,
source record/posting IDs, rate/rule versions, output hash, and report schema
version. Command family:
`report trial-balance|profit-loss|balance-sheet|aging|reconciliation|exceptions|tagged-analysis|compliance`
with `report snapshot|show|export`. Errors include `BASIS_NOT_APPLICABLE`,
`TENANT_AMBIGUOUS`, `GSTIN_AMBIGUOUS`, `VALIDATION_FAILED`, and
`MISSING_RULE` for a statutory report.

**Skill boundary and reports.** Reporting skills select a named report,
provide filters, explain exceptions, and verify output metadata. They cannot
change report basis silently, alter postings, or call a mutation to repair a
result. Core outputs are trial balance, P&L, balance sheet, AR/AP aging,
unapplied/overpayment, bank reconciliation, FX, asset book/tax variance,
close status, evidence exceptions, tagged analysis, and filing-specific
working papers. Every output has human labels and JSON fields for basis/date
range, currencies, rule versions, and provenance.

**Acceptance scenarios.**

1. `report profit-loss --basis cash` and `--basis accrual` return different
   derived views of the same canonical records and never create duplicate
   invoices or postings.
2. A fixed-basis compliance report given `--basis cash` returns
   `BASIS_NOT_APPLICABLE` rather than ignoring the flag.
3. A report generated while the period is locked succeeds read-only and shows
   the lock metadata; it cannot mutate the period or ledger.

## 17. Explicit V1 boundaries and deferred work

- No inventory, stock movements, warehouses, valuation, automated COGS, batches,
  serials, or manufacturing. Item/service and line references are the only V1
  seam.
- Payroll remains a first-class roadmap domain governed by the
  [payroll matrix](payroll-compliance-matrix.md) and existing payroll scope;
  this bookkeeping contract does not invent payroll rates, statutory forms,
  attendance, leave, or bank-payment behavior. Payroll journals must still use
  the common lifecycle, immutable correction, evidence, lock, idempotency, and
  explicit-bank-debit rules.
- GSTR-1's prepare/validate/export plus user/CA portal filing and ARN evidence
  is the only settled filing boundary. Other filing transports, e-invoice,
  and e-way-bill behavior remain filing-specific and must follow the GST
  matrix, tentative docket, and effective rule packs.
- Exact FX provider/fallback and fixed-asset depreciation methods are not
  settled. Existing immutable snapshots and separate schedules are the stable
  seams if those choices change.

## 18. Contract acceptance checklist

Implementation is contract-ready only when golden tests and CLI contract tests
demonstrate all of the following:

- tenant and GSTIN isolation, explicit ambiguity errors, and no cross-tenant
  effects;
- exact balanced postings for every template and no posting for non-posting
  documents, catalog, reconciliation proposals, close controls, or reports;
- `Draft -> Validated -> Posted -> Settled`, derived partial/unapplied states,
  and valid external-issuance gates where applicable;
- posted immutability with reversal-plus-replacement lineage;
- deterministic number allocation with preserved explained gaps;
- idempotent replay and conflicting request-ID rejection;
- optimistic conflicts and exclusive locks for posting, allocation,
  reconciliation, asset runs, and close/reopen;
- inclusive period-lock rejection and explicit preview/confirmation for reopen;
- missing receipt does not block gross bookkeeping while ITC/tax lanes remain
  separate and visible;
- explicit human confirmation for allocation and reconciliation;
- exact-plan human confirmation fields (plan digest, source line, target,
  amount, currency/FX snapshot, expected versions, tenant, actor, timestamp),
  with stale/mismatch errors and no proposal persistence;
- payment cash posted to bank/unapplied control before allocation, atomic
  cash-plus-allocation ordering, and duplicate-cash prevention on retry;
- credit-note/vendor-credit signed-balance refunds with no orphan AR/AP or
  refund-control balance;
- paid-currency FX formulas and sign examples using actual bank value, fees,
  rounding, and partial-slice persistence;
- one capitalization owner per source document/line and duplicate-capitalization
  rejection;
- Settled only at zero signed open balance after approved balanced
  credit/write-off/refund, never by administrative close-out;
- period-lock rejection for every listed ledger/settlement mutation, with
  evidence-only attachment/import as the sole exception;
- signed AR/AP allocation direction checks and credit-balance refund/offset
  routing;
- lifecycle-complete cash/accrual report semantics, including partial-payment
  examples and ledger/as-of trial balance/balance sheet behavior;
- prohibited V1 cross-tenant/intercompany paired writes and independently
  recorded user-directed due-to/due-from/correction journals;
- separate realized/unrealized FX and separate book/tax depreciation
  schedules;
- report basis derived from canonical records, effective basis/date metadata,
  and `BASIS_NOT_APPLICABLE` for fixed-basis reports; and
- evidence hashes, rule versions, actor, timestamps, source lineage, and
  machine-readable error codes on every mutation and high-consequence output.

These scenarios are the minimum contract fixture set for the implementation
slices in the [roadmap](roadmap.md). Statutory rates, thresholds, filing
behavior, and unresolved owner choices require separate research/approval and
must not be smuggled into implementation through a default.
