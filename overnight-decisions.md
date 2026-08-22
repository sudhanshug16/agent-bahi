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
- **Status**: `SUPERSEDED BY OD-010 AND OD-011; HISTORICAL ONLY`.

The earlier `docker exec` and lifecycle references in this decision are historical and are not current execution evidence. The active harness and evidence boundary are defined by OD-010 and OD-011.

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
- **Status**: `SUPERSEDED BY OD-011; HISTORICAL ORGANIZATION NOTE ONLY`.

### Package.json updates

- `test:gate0`: runs SQLite proofs only (no containers).
- `test:gate0:integration`: runs PostgreSQL/MySQL integration tests (requires containers).
- `test:gate0:all`: runs all Gate0 tests (SQLite + integration).

## OD-009 — PostgreSQL/MySQL proof execution and status tracking

- **Date**: 2026-08-22 (superseded by OD-011)
- **Decision**: Keep PostgreSQL/MySQL proof status tied to the machine-readable integration summaries. Preserve SQLite `PASS`; do not promote a dialect to `PASS` from source inspection or a blocked run.
- **Alternatives**: Mark PostgreSQL/MySQL as `PARTIAL` or `PASS` without proof; claim Drizzle multi-database support before proof.
- **Evidence**: The earlier "images not yet pulled" claim is stale. A bounded run connected to PostgreSQL 17.11 and emitted every required proof as PASS; subsequent reruns were blocked before connection by Docker credential-helper error `-50`. MySQL 8.4 startup was independently attempted, but no MySQL semantic PASS is claimed.
- **Reversibility**: Run integration tests after environment setup; update evidence and status mappings upon success.
- **Status**: `SUPERSEDED BY OD-011; DO NOT USE AS CURRENT EVIDENCE`.

## OD-010 — Bun SQL (native) used exclusively; no external database driver npm packages

- **Date**: 2026-08-22 (updated; corrected stale claims about postgres/mysql2 npm packages)
- **Decision**: Use Bun SQL native adapter (` new SQL({adapter: "postgres"/"mysql", ...})`) exclusively for PostgreSQL/MySQL connections. Application logic runs in Bun process; Docker CLI used only for container/network lifecycle (create, run, inspect, rm). All SQL uses parameterized/tagged queries; no DELIMITER client assumptions in migrations.
- **Rationale (supersedes OD-007)**: Bun SQL provides native connection management without external npm dependencies. The approach executes proof logic in the target application runtime (Bun) over TCP, eliminating docker-exec CLI leakage and proving portable database-neutral semantics. Parameterized queries prevent SQL injection and ensure dialect portability.
- **Alternatives**: docker-exec (proof contaminated by CLI tool versions/flags); external npm drivers like postgres/mysql2 (adds dependencies); ORM migrations (loses hand-reviewed constraint/trigger provenance).
- **Evidence CORRECTED**: `spikes/gate0/database-integration.ts` establishes connections via Bun SQL (`new SQL()`) with parameterized queries; migrations in `sql/{postgres,mysql}/` have no DELIMITER/client syntax; NO postgres or mysql2 npm packages in bun.lock (false earlier claims removed).
- **Reversibility**: Switch back to docker-exec (documented in git history); replace drivers later if incompatibilities emerge; migrations are version-independent.
- **Status**: `AGENT-RECOMMENDED / OWNER REVIEW PENDING; CURRENT LIVE STATUS IS IN OD-011`.

## OD-011 — Gate0 proof harness repair and evidence boundary

- **Date**: 2026-08-22
- **Decision**: Keep the Gate0 work limited to reversible proof-harness and migration-contract repair. The required registry includes migration rollback/dirty recovery, DELETE, lock negative, idempotency races, and cleanup proofs. A live PASS is recorded only when that dialect emits every required proof as PASS; pre-connection infrastructure failures remain BLOCKED.
- **Rationale**: The prior handoff claimed completion while the harness could ignore missing proofs, clear dirty markers after failure, use SELECT-first idempotency, and classify blocked integration as PASS. Those claims are retired; no production-readiness or Phase 1 authorization is inferred.
- **Actual checks recorded 2026-08-22**:
  - Bun 1.3.14 typecheck, local Gate0 tests, all Gate0 tests, Gate0 build, and `git diff --check` were run during this repair.
  - A bounded PostgreSQL 17.11 run connected and emitted every required proof as PASS before the final source-only tightening; the final rerun was blocked before connection by Docker credential-helper error `-50`, so no new current live PASS is claimed from that rerun.
  - MySQL 8.4 startup was attempted with digest-pinned pre-pull and `--pull never`; the current bounded run is BLOCKED before connection by the same credential-helper error, and no MySQL semantic PASS is claimed.
  - The exact stale PIDs and UUID-scoped empty networks named in the worker brief were inspected and removed before live attempts; no broad cleanup was used.
  - The final source checks include Bun 1.3.14 typecheck, local tests, integration wrapper, all-tests wrapper, build, summary/lifecycle unit tests, and `git diff --check`.
- **Status**: `AGENT-RECOMMENDED / OWNER REVIEW PENDING; LIVE DIALECT STATUS MUST MATCH THE COMMITTED SUMMARY`.
- **Reversibility**: The harness and dialect migrations remain isolated under `spikes/gate0`; this decision authorizes neither production database changes nor Phase 1 implementation.

## OD-012 — Local-image-first digest-pinned database preflight

- **Date**: 2026-08-22
- **Decision**: Before each Gate0 database container, inspect the exact pinned image reference locally. When present, perform no pull or other registry operation and run with `--pull never`. When absent, make one bounded `docker pull`, then inspect the same exact reference again before `docker run`; any inspection timeout, pull failure, or post-pull absence remains phase-correct `BLOCKED` and cannot claim a semantic `PASS`.
- **Alternatives**: Unconditionally pull before every run; run with `--pull never` without proving the image exists; continue after a failed pull.
- **Evidence**: `spikes/gate0/database-integration.ts` uses local `docker image inspect` before pull, a 120-second bounded pull only after a normal missing-image exit, a second exact-reference inspect, and focused lifecycle tests proving local presence skips pull and pull failure blocks before network/container startup.
- **Reversibility**: Remove the preflight helper and focused tests without changing digest pins, migration SQL, proof IDs, cleanup scope, or database semantics.
- **Status**: `AGENT-RECOMMENDED / OWNER REVIEW PENDING; LIVE DIALECT STATUS MUST MATCH THE COMMITTED SUMMARY`.

## OD-013 — MySQL TLS enablement and authenticated health readiness

- **Date**: 2026-08-22
- **Decision**: Enable TLS (`ssl: true`) in the Bun SQL MySQL client configuration only; PostgreSQL configuration remains unchanged. Replace unauthenticated `mysqladmin ping` Docker health check with an authenticated, database-selecting `SELECT 1` probe via `buildMySqlHealthCommand()`. Health check command: `mysql -h 127.0.0.1 --protocol=TCP -u {user} -p{password} -D testdb -Nse "SELECT 1" --ssl-mode=REQUIRED` (production-representative; caching_sha2_password enforces TLS). Wrong credentials fail TLS authentication and report unhealthy. Configure ephemeral MySQL container with `--log-bin-trust-function-creators=1` to allow trigger creation with binary logging (generated test user requires no privilege escalation). Production MySQL administrators must satisfy this prerequisite; application code does not mutate global server settings.
- **Alternatives**: Use unauthenticated `mysqladmin ping` (allows wrong credentials to report healthy); enable TLS globally for both dialects; defer TLS configuration to later phase; grant SUPER privilege to test user.
- **Evidence**: `buildBunSqlConnectionOptions()` adds `ssl: true` only for MySQL adapter (verified by `tests/gate0/tls-and-auth.test.ts` line 18). `buildMySqlHealthCommand()` returns `mysql ... -Nse "SELECT 1" --ssl-mode=REQUIRED` (verified by tests lines 44–88). `startDatabaseContainer()` line ~430 passes `--log-bin-trust-function-creators=1` to MySQL. Live negative tests in `tests/gate0/mysql-tls-authentication.test.ts` throw on wrong password/username (not skipped); live positive test verifies correct credentials via Bun SQL with TLS enabled.
- **Reversibility**: Remove `ssl: true` conditional and replace health command with any authenticated command (e.g., `mysqladmin status --ssl-mode=REQUIRED` or different SELECT probe) without affecting migrations or dialect semantics. TLS is isolated to connection setup; health check format does not alter application behavior. Reversibility must maintain authentication (not downgrade to unauthenticated probes).
- **Status**: `AGENT-RECOMMENDED / OWNER REVIEW PENDING; LIVE MYSQL SEMANTIC MATRIX WITH TRIGGER SUPPORT REQUIRED BEFORE MERGE`.

---

**Blocking conditions for PostgreSQL/MySQL proofs:**

1. Docker daemon running and accessible.
2. Sufficient disk space for PostgreSQL 17.11 and MySQL 8.4 images.
3. No existing containers named `agent-bahi-postgres-*` or `agent-bahi-mysql-*` (cleanup on exit enforces this).
4. Integration tests pass and produce evidence matching the expected proof IDs and semantics.
5. Container cleanup confirmed (no dangling agent-bahi containers).
