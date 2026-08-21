# CLI Contract: Reports, Reconciliation, and Period Controls

[Accounting Contracts](accounting-contracts.md) is the canonical domain
contract for the command families and machine-readable errors summarized here;
this document retains the detailed basis, reconciliation, and lock rules.

## Basis-aware reports

Reports that support selecting a recognition basis accept the optional exact
flag:

```text
--basis cash|accrual
```

The accepted values are `cash` and `accrual`. If the flag is omitted, the
command uses the invoking tenant's default report basis. The report must
expose the resulting effective basis; callers must not have to infer it from
whether the flag was present.

The complete set of basis-aware reports is not settled by this document. The
following examples illustrate the contract for the profit/loss report:

```text
agent-bahi report profit-loss --basis cash
agent-bahi report profit-loss --basis accrual
```

## Output requirements

Both output modes must state the effective basis and the date range used for
the report.

Human-readable output must label both values, for example:

```text
Basis: cash
Date range: 2026-01-01 to 2026-03-31
```

Machine-readable output must provide the same information as fields, for
example:

```json
{
  "basis": "cash",
  "date_range": {
    "from": "2026-01-01",
    "to": "2026-03-31"
  }
}
```

## Fixed-basis and compliance reports

Not every report is basis-aware. A report whose recognition basis is inherently
fixed, or legally prescribed, must reject an inapplicable `--basis` value. It
must return a clear machine-readable error and must never silently ignore the
flag. For example, the error must identify that the requested basis is not
applicable to the report:

```json
{
  "error": {
    "code": "BASIS_NOT_APPLICABLE",
    "message": "The requested report basis is not applicable to this report.",
    "requested_basis": "cash"
  }
}
```

Compliance exports use their prescribed recognition rules. A report-basis flag
is not a cosmetic override for those rules; an inapplicable flag is rejected
under the same error contract.

Cash-basis P&L recognizes settled document components pro rata on
payment/allocation dates; unapplied cash and overpayments remain balance-sheet
controls until applied. Refunds reverse on refund/linked-allocation dates,
credit/debit notes follow settlement/application dates, taxes fail closed when
the jurisdiction-specific cash/accrual rule is unknown, and realized FX/fees
use settlement dates. Unrealized revaluation and depreciation remain
accrual-only unless an explicit supported cash policy says otherwise. Trial
balance, balance sheet, and AR/AP aging remain ledger/as-of reports and never
silently switch to payment-date accounting.

## Bank reconciliation match persistence

The scheduler or user invokes the bank-reconciliation skill; proposals are
non-posting and non-persistent. Deterministic suggestions may be generated,
but the CLI is the only write boundary and the engine must not make an
implicit AI matching decision. Before any proposed match or allocation can
mutate state, a recorded human confirmation must be cryptographically or
deterministically bound to the exact plan ID/digest, bank source line, target
document/payment, amount, currency and FX snapshot, expected versions, tenant,
actor, and timestamp. Agent, skill, scheduler, workflow, or policy approval
cannot substitute for that confirmation.

Before persisting a match, the CLI must validate all of the following:

- The tenant exists and owns the referenced bank account and records.
- The bank account and matched document currencies are valid for the tenant;
  any cross-currency application has an explicit rate.
- The bank amount, document amount applied, and rate are present and satisfy
  the configured precision and balance rules.
- The bank transaction and document are in eligible statuses, and the
  requested transition is allowed.
- A human confirmation is present and its binding matches the exact plan,
  source line, target, amount, currency/FX snapshot, tenant, actor, timestamp,
  and expected versions.
- An idempotency key is present. Repeating the same request returns the
  original result without a second match; reusing the key for different
  content is rejected.

Missing confirmation returns `RECONCILIATION_CONFIRMATION_REQUIRED`; stale
confirmation returns `STALE_RECONCILIATION_PLAN`; a binding mismatch returns
`RECONCILIATION_PLAN_MISMATCH`. Each fails without state mutation. The
successful write persists the match/allocation and provenance atomically.
Provenance must include the evidence references, candidate proposal, exact
plan digest, skill name/version, human actor and confirmation timestamp,
validation result, and idempotency key. Human and machine-readable results
identify whether the proposal was held, rejected, or persisted.

## Payment and allocation ordering

`receipt post` and `payment post` create the bank/cash journal and unapplied
control balance before a separate allocation can reference the movement. A
single atomic command may create/post the cash movement and apply a confirmed
allocation in that order. A non-posted or nonexistent payment returns
`PAYMENT_NOT_POSTED`; the same request ID cannot create duplicate cash or
allocation. Customer receipts target positive AR debit balances; supplier
payments target positive AP credit balances. Credit balances route to a
compatible future-document offset or refund workflow and return
`TARGET_DIRECTION_INVALID` when used in the opposite direction.

## Period locking

The lock contract supports a global lock or a module-specific lock. A lock's
`locked-through` date is inclusive. For a record whose accounting date is on or
before that date, the engine rejects every ledger or settlement mutation:
create, edit, delete, issue, post, void, reverse, payment creation/posting,
allocation/deallocation/reallocation, bank reconciliation/unreconciliation,
credit/debit note, refund, write-off, reclassification, depreciation, FX
revaluation/realization adjustment, asset disposal, tax/payroll journal,
opening-balance change, and journal import/posting. Evidence-only
attachments/imports that do not alter books are the sole explicit exception.
The CLI must surface the scope and date that caused the rejection rather than
silently retrying or moving the date.

Full unlock uses the exact two-step command family
`period unlock preview --scope <global|module> --through <date> --reason <text>`
then `period unlock commit --preview <plan_id> --confirmation <human_confirmation>`.
A bounded partial unlock uses
`period partial-unlock preview --scope <global|module> --from <date> --to <date> --reason <text>`
then `period partial-unlock commit --preview <plan_id> --confirmation <human_confirmation>`.
Preview is side-effect free and binds tenant, scope, current lock version,
prior lock interval, requested range, affected-record impact, actor, reason,
and plan hash. Commit revalidates all of those values under the lock and
requires recorded explicit human confirmation; a skill or workflow cannot
self-authorize. The applied operation writes an audit record containing the
actor, reason, scope, prior lock state, requested range, preview, plan hash,
confirmation, and outcome. A stale/missing preview returns
`UNLOCK_PREVIEW_REQUIRED`; an invalid range/scope returns
`PARTIAL_UNLOCK_INVALID`; a changed lock/version returns `UNLOCK_CONFLICT`.
A missing reason returns `REASON_REQUIRED`, and missing confirmation returns
`LOCK_CONFIRMATION_REQUIRED`. A lock change must never be inferred from a
failed transaction write.

When a late document targets a locked period, the CLI exposes the two
skill-guided choices: controlled reopen followed by original-date posting, or
current-period adjustment. It must require an explicit choice and the
associated preview/approval data. It must reject any request that asks the
engine to choose automatically.
