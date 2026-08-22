# Zoho Currency and Locking Notes

Reviewed 2026-08-20. This note records the official Zoho Books behavior used
as migration context for agent-bahi. The design decisions below are agent-bahi
policy; they are not claims that Zoho implements the same invariants.

## Verified Zoho Books behavior

| Official source | What the source documents |
| --- | --- |
| [Organization Profile](https://www.zoho.com/in/books/help/settings/organization/organization-profile.html) | An organization has a base currency. For an India organization, the documented base currency is INR. Zoho says transactions and financial reports such as Profit & Loss and Balance Sheet are generated in that currency, and foreign-currency transactions are converted to the base currency for reporting. The page also says the base currency cannot be changed for the listed organization locations. |
| [Invoices API](https://www.zoho.com/books/api/v3/invoices/) | Invoice payloads expose `currency_id`, `currency_code`, and `exchange_rate`. The documented rate converts invoice-currency amounts to the organization base currency, is required when the invoice currency differs from base currency, and defaults to `1.0` when it matches. The API also documents `bcy_rate` for a line item's base-currency rate and `rate` for the invoice-currency unit price. |
| [Customer Payments API](https://www.zoho.com/books/api/v3/customer-payments/) | A payment has an amount and an `invoices` list. Each application includes `invoice_id` and `amount_applied`; the API documents `exchange_rate` as the rate between the invoice and customer's currency and explains that the payment amount is the original amount multiplied by that rate. The API also exposes `bank_charges` for additional bank charges. |
| [Base Currency Adjustments](https://www.zoho.com/in/books/help/accountant/base-currency.html) | Zoho lets a user select a foreign currency, date, and new rate for open transactions; notes are mandatory. The confirmation shows FCY balance, prior and revalued BCY balances, and gain or loss. Zoho reports the result as exchange gain/loss, including in Profit & Loss, and records a Base Currency Adjustment. |
| [Transaction Locking](https://www.zoho.com/in/books/help/accountant/transaction-lock.html) | Zoho can lock individual modules with different lock dates or lock all transactions with one common date. Transactions recorded before the lock date cannot be modified or deleted; the workflow asks for a reason. Zoho also supports full unlock and partial unlock for a selected date range, with a reason, and says create/modify/delete is allowed during the partial-unlock period. |

These pages document fields and workflows, not an immutable event model,
provenance standard, idempotency contract, or a rule for late documents. Those
are intentionally specified below for agent-bahi.

## agent-bahi design decisions

### One base currency and preserved foreign amounts

Every tenant has exactly one base currency. A foreign-currency invoice or bill
keeps every original-currency amount and an immutable snapshot of the rate
used to convert that document currency to base currency. Reports aggregate in
base currency, while drill-down exposes the original currency and amounts.
Changing a later rate cannot rewrite the document or its original posting.

The exact rate source is configurable and remains **T-004 OWNER-APPROVED;
NOT ARCHITECT-REVIEWED / OPEN RESEARCH**. The record must still identify the
rate used and its relevant timestamp or effective date so that a posting can
be audited without assuming a particular provider.

### Settlements, realized FX, and fees

A settlement preserves the document currency/amount and carrying base value
removed, actual paid currency/amount, paid-currency-to-base rate snapshot, bank
base value, allocation amount, and realized FX. Bank cash is always derived
from the actual paid amount times that paid-currency base rate, never from
document quantity. The engine posts realized exchange gain/loss separately
from bank fees. These are separate accounting components even when they arrive
in one bank event; partial settlements persist each slice and leave the
remainder open. Posting remains cash-first: actual Bank/Cash is posted exactly
once to the relevant unapplied-cash control, then the allocation/reclassification
leg clears that control against AR/AP and carries realized FX without reposting
Bank/Cash. Any aggregate display is reporting-only.

### Period-end revaluation

Open-item revaluation is an auditable adjustment, linked to the open items,
rate, date, actor, reason, and resulting postings. It does not mutate the
invoice, bill, settlement, original amounts, or immutable document-rate
snapshot. A later revaluation therefore remains distinguishable from the
original transaction and from settlement-time realized FX.

### Fixed assets

The asset register, automatic depreciation, and disposal tracking are in scope.
Separate book-versus-tax schedules with configurable SLM as the reversible book
default are **T-003 OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. The exact
statutory tax methods and rates remain effective-dated rule-pack research;
there is no universal tax WDV or SLM default. These product decisions are not
implied by the Zoho currency or locking pages.

### Reconciliation boundary

A scheduler or user invokes a bank-reconciliation skill. The skill gathers
evidence and proposes non-posting matches; deterministic suggestions may be
generated, but they cannot persist. Before any match or allocation mutates
state, the CLI requires a recorded human confirmation cryptographically or
deterministically bound to the exact plan ID/digest, bank source line, target
document/payment, amount, currency and FX snapshot, expected versions, tenant,
actor, and timestamp. Missing/stale/mismatched confirmation returns
`RECONCILIATION_CONFIRMATION_REQUIRED`, `STALE_RECONCILIATION_PLAN`, or
`RECONCILIATION_PLAN_MISMATCH`. Agents, skills, schedulers, workflows, and
policies cannot approve. The CLI is the sole write boundary.

### Period locking and late documents

agent-bahi uses a global or module-specific inclusive `locked-through` date.
Create, edit, delete, issue, post, void, reverse, payment creation/posting,
allocation/deallocation/reallocation, bank reconciliation/unreconciliation,
credit/debit note, refund, write-off, reclassification, depreciation, FX
revaluation/realization adjustment, asset disposal, tax/payroll journal,
opening-balance change, and journal import/posting within that range are
rejected. Evidence-only attachments/imports that do not alter books are the
sole exception. Full unlock uses `period unlock preview|commit`; partial unlock
uses `period partial-unlock preview|commit`. Preview binds tenant, scope/range,
current lock version, impact, actor, reason, and plan hash; commit requires
recorded explicit human confirmation. Missing or stale preview, invalid range,
changed lock, or missing confirmation returns `UNLOCK_PREVIEW_REQUIRED`,
`PARTIAL_UNLOCK_INVALID`, `UNLOCK_CONFLICT`, or `LOCK_CONFIRMATION_REQUIRED`.
A late document is routed through
a skill-guided choice between
controlled reopen/original-date posting and a current-period adjustment. The
system never makes that choice automatically.

Cross-tenant/intercompany paired posting is **DEFERRED and PROHIBITED in V1**
and is not inferred from Zoho's module-locking or currency behavior. Each
tenant transaction is independent; a mistaken inter-entity payment is recorded
separately in each tenant with explicit due-to/due-from or correction journals
only when the user records them. No cross-tenant atomic write is allowed.

Settlement direction and reporting follow the canonical contract: a customer
receipt reduces a positive customer AR balance and a supplier payment reduces a
positive supplier AP balance; signed credit balances require a compatible future
offset or refund. `Settled` requires zero signed open balance after allocation
and any explicitly approved balanced credit, write-off, or refund journal.
Accrual reports use posted journal dates and ledger/as-of balances. Cash-basis
P&L recognizes settled components on payment/allocation dates; unapplied cash,
overpayments, trial balance, balance sheet, aging, tax lanes, FX, fees,
revaluation, and depreciation follow the explicit semantics in the
[canonical accounting contract](accounting-contracts.md#16-reports-and-derived-views).

## Design boundary summary

Zoho is the migration reference for the shape of currency fields, base-currency
reporting, currency adjustment workflows, and transaction locking. agent-bahi
adds immutable source values, deterministic posting, explicit match
provenance, idempotency, inclusive lock semantics, and human-controlled late
document handling as its own canonical design.
