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

## SQLite upgrade foundation — TENTATIVE - NOT OWNER-APPROVED (n116/n117)

The generic SQLite `UpgradeCoordinator` foundation is an implementation slice,
not an owner approval for product schema expansion. It keeps the production
manifest at v2 and permits only a strict one-migration manifest extension under
the existing `BEGIN IMMEDIATE` lease. The coordinator performs deterministic
read-only preflight, creates and verifies a no-replace `VACUUM INTO` backup while
the lease remains held, and commits migration history plus `database_control`
atomically. Commit/connection uncertainty remains explicitly recoverable and
never reports false success.

Identity/bookset migrations remain blocked behind this foundation and a later
owner decision. No identity or bookset DDL is included here; the v2 production
schema and existing `MigrationService.migrate()` DIRTY contract remain
unchanged. The owner may approve, revise, or reject n116/n117 without requiring
the v2 reader/default composition boundary to change.

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

## BookSet V2→V3 Migration — TENTATIVE - NOT OWNER-APPROVED (n122)

The first serialized schema upgrade (0003-bookset-display-name) is an UpgradeCoordinator
implementation slice following n116/n117. This migration adds required `display_name` to
BookSets and removes UNIQUE(tenant_id, kind) cardinality in favor of partial UNIQUE indexes.

**Schema and data changes:**
- Add NOT NULL `display_name` column to `book_sets` table
- Remove UNIQUE(tenant_id, kind) constraint by rebuilding table
- Add partial UNIQUE indexes: `uq_book_set_tenant_company` and `uq_book_set_tenant_personal`
- Allow unlimited PROPRIETORSHIP BookSets per tenant (no uniqueness constraint)
- Backfill display_name deterministically: COMPANY→"Company", PERSONAL→"Personal", PROPRIETORSHIP→"Proprietorship"
- Validate all names are non-null, non-blank, trimmed (stored trim(name)=name, COLLATE NOCASE for tenant-scoped case-insensitive uniqueness)

**Constraints and implementation:**
- Migration SQL contains no BEGIN/COMMIT (runs within UpgradeCoordinator transaction)
- foreign_keys remain ON throughout
- Tenants table never rebuilt; all BookSet/account IDs, parents, balances, timestamps preserved
- Deterministic target probes validate exact v3 state (schema, indices, old constraints absent)
- Default BookSet must exist, belong to same tenant, and be ACTIVE
- Archiving current default or activating tenant with no ACTIVE default rejected by application layer
- Repository enforces display_name trimming validation on inserts/updates
- Auto-resolution scope resolver (single ACTIVE per tenant returns typed FOUND; zero/multiple return typed NOT_FOUND/AMBIGUOUS)

**Implementation scope:**
- TypeScript BookSet model, repository mappings, inserts updated
- Minimal repository/service validation for non-null display_name
- Bootstrap tenant creation updated with explicit display_name
- Current manifest/version (schemaVersion→3, revision→2) reflects v3 as honest schema
- Backup/verification tests include v3 path verification
- CLI/MCP, identity/evidence ledger, and broader audit/idempotency orchestration NOT in this slice
- Migration idempotency, old-reader rejection, current-reader acceptance, replay behavior tested

**Test coverage:**
1. Exact v2→v3 upgrade with non-null tenant default, all row equality and IDs
2. Migration failure injection rolls back schema/data/control atomically
3. Fresh initialization converges via 0001+0002→0003 to identical catalog/version as upgrade path
4. Multiple PROPRIETORSHIP rows succeed; duplicate COMPANY/PERSONAL fail
5. Duplicate/blank/untrimmed/case-only duplicate names rejected; cross-tenant isolation maintained
6. Default validation: archived/inactive rejection, activation validation, cannot archive current default
7. One-active auto-resolution typed success; zero/multiple return correct error types
8. Backup catalog includes v3 verification; foreign_key_check empty after upgrade
9. Idempotency and replay behavior correct; changed checksum rejected
