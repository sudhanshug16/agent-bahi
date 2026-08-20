# CLI Contract: Report Basis

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
