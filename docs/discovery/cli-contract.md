# CLI Contract: Reports, Reconciliation, and Period Controls

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

## Bank reconciliation match persistence

The scheduler or user invokes the bank-reconciliation skill; the CLI is the
only write boundary for a proposed match. Proposal generation belongs to the
skill and may be non-deterministic. The engine must not make an implicit AI
matching decision.

Before persisting a match, the CLI must validate all of the following:

- The tenant exists and owns the referenced bank account and records.
- The bank account and matched document currencies are valid for the tenant;
  any cross-currency application has an explicit rate.
- The bank amount, document amount applied, and rate are present and satisfy
  the configured precision and balance rules.
- The bank transaction and document are in eligible statuses, and the
  requested transition is allowed.
- An idempotency key is present. Repeating the same request returns the
  original result without a second match; reusing the key for different
  content is rejected.

The successful write persists the match and provenance atomically. Provenance
must include the evidence references, candidate proposal, skill name and
version, actor or scheduler, validation result, and idempotency key. Human and
machine-readable results identify whether the match was persisted, rejected,
or held for review.

## Period locking

The lock contract supports a global lock or a module-specific lock. A lock's
`locked-through` date is inclusive. For a record whose accounting date is on or
before that date, the engine rejects create, edit, delete, and void operations;
the CLI must surface the scope and date that caused the rejection rather than
silently retrying or moving the date.

An unlock request must include the acting principal and a non-empty reason. A
bounded partial unlock must additionally include an explicit date range and
scope. Both operations require an impact preview before applying the change;
the applied operation writes an audit record containing the actor, reason,
scope, prior lock state, requested range, preview, and outcome. A lock change
must never be inferred from a failed transaction write.

When a late document targets a locked period, the CLI exposes the two
skill-guided choices: controlled reopen followed by original-date posting, or
current-period adjustment. It must require an explicit choice and the
associated preview/approval data. It must reject any request that asks the
engine to choose automatically.
