# GST V1

Agent-Bahi's GST V1 slice keeps GST facts explicit and tenant/BookSet scoped.
Registrations and party profiles are effective-dated; invoice and bill posting
requires classification, rate, and evidence facts from the caller. The posting
engine resolves the applicable facts as of the document date, derives
intra-state or inter-state geometry, and stores immutable tax snapshots.

Tax is calculated in integer paise with the named policy
`ROUND_HALF_UP_COMPONENT_REMAINDER_V1`. Intra-state tax is CGST plus the
explicitly selected SGST or UTGST component. Inter-state tax is IGST only.
Purchase ITC must be explicitly `ELIGIBLE`, `INELIGIBLE`, or `PENDING_REVIEW`;
the latter two conservatively include tax in expense or asset cost.

The sales and purchase registers return deterministic primitive rows for JSON
or CSV adapters. This slice does not claim government portal GSTR compatibility.
