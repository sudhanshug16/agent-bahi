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

The exact rate source is configurable and remains undecided. The record must
still identify the rate used and its relevant timestamp or effective date so
that a posting can be audited without assuming a particular provider.

### Settlements, realized FX, and fees

A settlement preserves the bank or paid currency and amount, the amount
applied in the document currency, and the rate used for that application. The
engine posts the resulting realized exchange gain or loss separately from bank
fees. These are separate accounting components even when they arrive in one
bank event.

### Period-end revaluation

Open-item revaluation is an auditable adjustment, linked to the open items,
rate, date, actor, reason, and resulting postings. It does not mutate the
invoice, bill, settlement, original amounts, or immutable document-rate
snapshot. A later revaluation therefore remains distinguishable from the
original transaction and from settlement-time realized FX.

### Fixed assets

The asset register, automatic depreciation, and disposal tracking are in scope.
The exact depreciation methods and book-versus-tax schedules remain undecided;
neither is implied by the Zoho currency or locking pages.

### Reconciliation boundary

A scheduler or user invokes a bank-reconciliation skill. The skill gathers
evidence and proposes matches, and proposal generation may be non-deterministic.
The CLI is the explicit write boundary: it validates tenant, account,
currency, amount, status, and idempotency, then persists the match and its
provenance. The engine applies only the explicit validated match and contains
no hidden AI decision.

### Period locking and late documents

agent-bahi uses a global or module-specific inclusive `locked-through` date.
Create, edit, delete, and void within that range are rejected. Unlock or
bounded partial unlock requires a reason, actor, audit record, and impact
preview. A late document is routed through a skill-guided choice between
controlled reopen/original-date posting and a current-period adjustment. The
system never makes that choice automatically.

Intercompany paired posting remains undecided and is not inferred from Zoho's
module-locking or currency behavior.

## Design boundary summary

Zoho is the migration reference for the shape of currency fields, base-currency
reporting, currency adjustment workflows, and transaction locking. agent-bahi
adds immutable source values, deterministic posting, explicit match
provenance, idempotency, inclusive lock semantics, and human-controlled late
document handling as its own canonical design.
