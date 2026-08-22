# Overnight Decisions: N87/N81 schema repair

This discovery mirror records the current decision boundary for the legacy
`schema_migrations` upgrade. The implementation is tentative and is not an
owner approval for a wider phase.

## Legacy control-schema upgrade

Only exact, ordered, dialect-aware Gate0, dirty-flag, nullable-status, and
strict-status-plus-lease signatures may upgrade. Current schemas require exact
table kind, column names/order, normalized types, nullability, defaults, the
`id` primary key, and the status `CHECK`. Unknown, partial, hybrid, view,
malformed-current, or null/unknown-status schemas fail closed without mutation.

Gate0 `logical_id`, `checksum`, and `applied_at` values are preserved. Dirty
`1` becomes `DIRTY`; no timestamp, checksum, lease, or manifest provenance is
invented or discarded. Integer values are normalized losslessly across drivers;
unsafe JavaScript numbers are rejected before staging or any schema mutation.
SQLite metadata identifiers are internal allowlisted and quoted. PostgreSQL
and SQLite use pinned-session staged swaps. MySQL uses fixed-version stage and
backup state validation/recovery, one atomic multi-table `RENAME`, retryable
interruption states, and retains the original table as validated history.

Fresh migration success is not legacy-upgrade proof. Required evidence remains
exact before/after snapshots, metadata-error propagation, copy/validate/swap
fault injection, empty tables, malformed schemas, unsafe integers, and live
PostgreSQL/MySQL legacy probes when the environment permits.

## PGlite — TENTATIVE - NOT OWNER-APPROVED

V1 default remains SQLite. PGlite is only a future opt-in conformance spike;
multi-instance same-directory safety, upgrade dump/restore, Bun single-binary
assets, and the MySQL branch remain unresolved. This decision does not cite
PGlite GitHub issue #704 as an advisory-lock bug; that claim is not established.
