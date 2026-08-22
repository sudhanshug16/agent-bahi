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

## Database control metadata authority — TENTATIVE - NOT OWNER-APPROVED (n104 - corrected 0002)

Singleton `database_control` table holds schema versions, compatibility, and database state.
- Schema versions (schema_version, data_format_version) and protocol integers (reader min/max/writer)
  are persisted-format compatibility, NOT CLI semver. Patch-only CLI releases with unchanged
  protocols do not trigger DB version changes.
- Revision (future CAS) and generation (committed snapshot) begin at 1.
- Singleton is enforced via PRIMARY KEY CHECK(id=1). initialize() runs under withMigrationLease,
  validates exact 0002 schema and history, inserts id=1 bound to exact APPLIED migration checksum.
  Idempotent: if exact initialized row already exists, returns it without rewriting audit fields.
  Does not repair or overwrite conflicting/malformed state; fails safe.
- inspect() is metadata-only: never creates, repairs, or executes business queries. Fails closed
  (UNINITIALIZED or UNAVAILABLE) on empty table, wrong schema, malformed data, or unexpected row count.
- requireCompatible() checks AVAILABLE + READY, reader protocol within min/max, writer protocol
  exact match. Uses safe DomainError codes; does not leak SQL, paths, or raw values.
- compatibility_matrix is legacy rules-only; database_control is the new DB authority.
  Real future fence is callback-scoped BusinessSession + SQLite transactions (not part of this slice).
- Pre-barrier Gate0 binaries cannot be retroactively forced; unsupported before production baseline.
  Backup must precede automatic migration.
- No implicit transitions, auto-migration logic, or universal BusinessSession enforcement in this slice.
- **Rejected 2c0e399 experimental baseline**: Databases created with the rejected 0002 migration in commit 2c0e399
  are unsupported and fail closed on checksum mismatch. All new databases must use the corrected 0002
  with the exact checksum exported by the canonical migration source (`DATABASE_CONTROL_CHECKSUM`),
  currently `a52a0e16d47790652a0207d0b2246b5e24f9f7e19749bff24917ed8ef49a6fbd`.
- **Corrected 0002 immutability**: The corrected 0002-database-control migration is now immutable as part
  of the production baseline. All table schema validation includes exact column types, defaults, nullability,
  and named CHECK constraints. Malformed/partial schemas fail UNAVAILABLE; no repair or coercion.

## MCP HTTP binding — OWNER-APPROVED n95

Hosted MCP endpoint supports http:// and https://. Both protocols are valid.
- **http://** and **https://** are equally valid transport options
- Default bind is **loopback only** (127.0.0.1:port)
- **Non-loopback binding** (0.0.0.0, hostnames) is explicit and requires operator override
- **TLS is not a hard gate**: https:// is supported but not mandatory
- **Authentication, Origin validation, and audit controls** are separate concerns, not gated on TLS
- **Warning/status messages** and audit logging are configurable independently
- **MCP is not assumed to exist** in this phase; stdio remains valid for local deployments
- **No MCP implementation claim** is made for non-local scenarios in this slice

## Superseded by OWNER-APPROVED n94/n95

The active boundary is SQLite local-file only with one CLI+MCP shared core:
local deployments use stdio, hosted deployments use Streamable HTTP, HTTP and
HTTPS are both allowed, the default bind is loopback, raw SQL is not exposed,
and each deployment has one owner. Earlier PostgreSQL, MySQL, and PGlite plans
are `SUPERSEDED`.
