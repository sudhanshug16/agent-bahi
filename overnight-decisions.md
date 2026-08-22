# Overnight Decisions

These entries record reversible working decisions for the first Gate0 slice. A status that says `OWNER REVIEW PENDING` is not owner approval.

## OD-001 — Gate0 authorization boundary

- **Date**: 2026-08-22
- **Decision**: Implement only the first local, reversible Gate0 proof slice: Bun project scaffolding, SQLite proofs, compile-only target attempts, and evidence. Do not implement the accounting engine, use external databases, touch production data, or treat this work as Phase 1 authorization.
- **Alternatives**: Wait for a later implementation authorization; begin Phase 1 alongside the proof; run against a shared/external database.
- **Evidence**: Explicit task authorization; `docs/discovery/implementation-plan.md` defines Gate0 as a hard blocker before Phase 1.
- **Reversibility**: Delete the proof project and evidence, or replace individual adapters after review; no production state is changed.
- **Status**: `OWNER-AUTHORIZED FOR GATE0 ONLY; PHASE 1 NOT AUTHORIZED`.

## OD-002 — Relational SQL over NoSQL

- **Date**: 2026-08-22
- **Decision**: Keep SQL and relational constraints as the persistence direction for accounting facts. Use hand-reviewed SQL migrations and explicit transaction boundaries.
- **Alternatives**: Document/NoSQL primary store; event-only storage; ORM-generated schema as the source of truth.
- **Evidence**: SQLite proof demonstrates composite tenant/BookSet foreign keys, balance checks, uniqueness, append-only guards, WAL, and writer serialization. The architecture contract requires relational current state and an immutable accounting journal.
- **Reversibility**: A future adapter can implement the application ports, but changing the canonical persistence model requires a new reviewed architecture decision and migration plan.
- **Status**: `AGENT-RECOMMENDED / OWNER REVIEW PENDING`.

## OD-003 — Tenant Option A candidate

- **Date**: 2026-08-22
- **Decision**: Recommend two company tenants plus one individual/PAN tenant containing one personal BookSet and one or more proprietorship BookSets. Keep BookSets independently scoped and balanced; do not create cross-tenant paired writes.
- **Alternatives**: Separate personal/proprietorship tenants with a privileged PAN registry; a non-posting personal workspace.
- **Evidence**: `docs/discovery/post-discovery-readiness.md` Option A candidate and the Gate0 contract's composite tenant/BookSet FK proof. This slice does not prove the complete personal-tax schema or authorization model.
- **Reversibility**: Preserve tenant and BookSet IDs behind ports; an architect may choose the registry alternative before Phase 1 physical schema work.
- **Status**: `AGENT-RECOMMENDED / OWNER REVIEW PENDING`.

## OD-004 — Drizzle candidate with Bun-native fallback

- **Date**: 2026-08-22
- **Decision**: Proof-gate `drizzle-orm@0.44.7` only as a typed infrastructure candidate behind application ports. Keep native `bun:sqlite` as the working fallback and use SQL-first migrations. Do not use Drizzle push or runtime auto-generation.
- **Alternatives**: Native Bun SQL only; adopt Drizzle as the domain-facing persistence API; choose Kysely or another ORM before proof.
- **Evidence**: `src/infrastructure/sqlite/drizzle-candidate.ts` is the only Drizzle import surface; `src/application` and `src/domain` have no Drizzle imports. `bun.lock`, typecheck, and native SQLite tests pass; PostgreSQL/MySQL proofs remain blocked.
- **Reversibility**: Replace the candidate adapter without changing domain/application ports. Loss triggers are a Bun compatibility regression, inability to preserve reviewed SQL/checksum behavior, tenant/BookSet constraint gaps, transaction/locking mismatch, or unacceptable bundle/runtime behavior.
- **Status**: `AGENT-RECOMMENDED / OWNER REVIEW PENDING`.

## OD-005 — Schema version and CLI compatibility

- **Date**: 2026-08-22
- **Decision**: Keep a schema logical version/ID and migration checksum distinct from CLI semantic version. Maintain an explicit compatibility matrix for CLI schema versions and refuse checksum mismatches. Do not run schema migrations mid-operation; migrations are an explicit pre-operation step.
- **Alternatives**: Use CLI semver as schema version; auto-migrate during a command; allow mixed schema versions without a compatibility decision.
- **Evidence**: `gate0-001-core-sqlite` stores its logical ID and checksum in `schema_migrations`; a same-ID tamper is refused in the proof. The domain-owned CLI registry reports `0.0.0-gate0` independently.
- **Reversibility**: Add compatibility rows and reviewed migrations; never rewrite applied migration history. A future breaking schema requires a new compatibility entry and explicit cutover/rollback plan.
- **Status**: `AGENT-RECOMMENDED / OWNER REVIEW PENDING`.

### Compatibility matrix (initial)

| CLI semver | Schema logical IDs | Read/write policy |
|---|---|---|
| `0.0.0-gate0` | `gate0-001-core-sqlite` | Proof-only; no production writes; no mid-operation migration |
| future `0.x` | Explicitly recorded migration set | Must be reviewed before use; mismatch fails closed |
| future `1.x` | Explicit compatibility entry required | No implicit downgrade or mixed-version write |

## OD-006 — Imports last, shadow before cutover

- **Date**: 2026-08-22
- **Decision**: Keep Zoho/external imports as the final migration lane. Before any cutover, import into a shadow representation, validate/reconcile against canonical books, preserve source evidence and hashes, and require an explicit cutover decision.
- **Alternatives**: Let imports shape the canonical model now; perform a direct destructive cutover; omit shadow validation.
- **Evidence**: Discovery roadmap and implementation plan defer Zoho import to Phase 9; the architecture contract makes imported data non-authoritative until validated.
- **Reversibility**: Source artifacts and shadow data remain available; failed reconciliation leaves canonical books unchanged.
- **Status**: `AGENT-RECOMMENDED / OWNER REVIEW PENDING`.

## OD-007 — PostgreSQL and MySQL dialect migrations with native Bun SQL

- **Date**: 2026-08-22
- **Decision**: Implement hand-reviewed, separate migrations for PostgreSQL 17.11 and MySQL 8.4 under `spikes/gate0/sql/{postgres,mysql}/` with shared logical IDs and per-dialect SQL syntax. Use Bun native `spawnSync` to execute SQL against containerized databases; do not claim Drizzle PostgreSQL/MySQL support until native adapter proofs pass.
- **Alternatives**: Single unified DDL with #ifdefs per dialect; Drizzle migrations for all three targets; ORM-generated schemas.
- **Evidence**: `spikes/gate0/sql/postgres/001-core.sql` (PL/pgSQL triggers) and `spikes/gate0/sql/mysql/001-core.sql` (MySQL SIGNAL-based triggers) implement the same semantic constraints—tenant/BookSet FK, balance validation on posting, append-only guards, posted immutability—using dialect-native facilities. `docker exec ... psql/mysql` reliably applies migrations to local disposable containers without introducing npm dependencies for database clients. Integration test harness in `spikes/gate0/database-integration.ts` uses `spawnSync` with Docker CLI; no pg/mysql2 imports.
- **Reversibility**: Drop dialect-specific implementations and consolidate to Drizzle if proof coverage expands; or keep native SQL and replace Drizzle entirely. Migration logical IDs remain stable.
- **Status**: `AGENT-IMPLEMENTED; EXECUTION BLOCKED ON CONTAINER STARTUP`.

### Implementation details

- **Logical ID pattern**: `gate0-001-core-postgres` and `gate0-001-core-mysql` stored in `schema_migrations` table; checksum validated at application layer.
- **Docker container strategy**: Unique per-run container/network names (`agent-bahi-postgres-{suffix}`, `agent-bahi-mysql-{suffix}`); generated test-only credentials; dynamic localhost ports (5432+random, 3306+random); health checks (pg_isready, mysqladmin ping); trap-based scoped cleanup via `scripts/gate0-db.sh`.
- **Trigger semantics**: PostgreSQL uses function-based triggers (PL/pgSQL); MySQL uses SIGNAL for error conditions. Both enforce balance validation, append-only guards, and posted immutability before commit.
- **Test harness**: `tests/gate0/database-integration.test.ts` spins up containers in `beforeAll`, runs proof tests (fresh install, FK, append-only, BigInt), and cleans up in `afterAll`. No containers remain after test completion.
- **Image pinning**: `spikes/gate0/db-images.json` records version and digest stubs; digests resolved at execution and recorded in evidence.

## OD-008 — Lifecycle script and integration test organization

- **Date**: 2026-08-22
- **Decision**: Add `scripts/gate0-db.sh` as a scoped lifecycle manager that creates networks and starts containers with health checks, never touching existing localhost services or production data. Separate integration tests into `tests/gate0/database-integration.test.ts` (explicit opt-in) while keeping unit tests (`tests/gate0/gate0.test.ts`) independent of Docker.
- **Alternatives**: Global Docker daemon setup; start containers via npm pretest hook; omit separate integration test file.
- **Evidence**: `scripts/gate0-db.sh` creates unique networks, generates test credentials, validates container health, and cleans up on exit. Test names differ between PostgreSQL (PG-*) and MySQL (MY-*) but test semantics are identical (fresh install, FK constraints, append-only guards, BigInt support).
- **Reversibility**: Containers are local and ephemeral; script can be replaced or removed without affecting production services.
- **Status**: `AGENT-IMPLEMENTED; READY FOR MANUAL LIFECYCLE VERIFICATION`.

### Package.json updates

- `test:gate0`: runs SQLite proofs only (no containers).
- `test:gate0:integration`: runs PostgreSQL/MySQL integration tests (requires containers).
- `test:gate0:all`: runs all Gate0 tests (SQLite + integration).

## OD-009 — PostgreSQL/MySQL proof execution and status tracking

- **Date**: 2026-08-22 (provisional; execution BLOCKED)
- **Decision**: Do not update STK-002, STK-004, STK-006 evidence until live PostgreSQL/MySQL container tests pass. Mark PostgreSQL/MySQL adapter status as `BLOCKED` until integration tests run successfully; preserve SQLite `PASS` and Drizzle `UNPROVEN` status independently.
- **Alternatives**: Mark PostgreSQL/MySQL as `PARTIAL` or `PASS` without proof; claim Drizzle multi-database support before proof.
- **Evidence**: Integration test harness is implemented but blocked on container startup (Docker images not yet pulled, environment may need explicit setup). No evidence will be written until tests fully pass.
- **Reversibility**: Run integration tests after environment setup; update evidence and status mappings upon success.
- **Status**: `AGENT-IMPLEMENTED; EXECUTION BLOCKED / EVIDENCE NOT YET RECORDED`.

---

**Blocking conditions for PostgreSQL/MySQL proofs:**

1. Docker daemon running and accessible.
2. Sufficient disk space for PostgreSQL 17.11 and MySQL 8.4 images.
3. No existing containers named `agent-bahi-postgres-*` or `agent-bahi-mysql-*` (cleanup on exit enforces this).
4. Integration tests pass and produce evidence matching the expected proof IDs and semantics.
5. Container cleanup confirmed (no dangling agent-bahi containers).
