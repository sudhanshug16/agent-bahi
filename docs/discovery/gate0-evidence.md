# Gate0 Evidence

**Run date**: 2026-08-22

**Verdict**: **INCOMPLETE**. The authorized first slice proves the local Bun + SQLite path. STK-002 and STK-004 remain partial because PostgreSQL and MySQL live semantic proofs were not run; those proofs are **BLOCKED / NOT RUN**, not inferred from compilation. Gate0 therefore does not authorize Phase 1, a production database, or any library beyond the evidence below.

## Boundary and runtime record

- This slice was explicitly authorized for local repository proof work only. It does not authorize Phase 1 implementation, production data, external database writes, or owner approval of tentative architecture choices.
- Installed Bun: `1.3.14`.
- `bun --revision`: `1.3.14+0d9b296af`.
- The version was observed locally and pinned in `package.json` (`engines.bun`) and `runtime-versions.json`; this report makes no “latest Bun” claim.
- `bun install` generated `bun.lock`. Direct package pins are `drizzle-orm@0.44.7`, `@types/bun@1.3.14`, and `typescript@5.8.3`. `drizzle-kit` is not installed because migrations are hand-reviewed SQL.
- No credentials, database URLs, or production data are bundled.

## Exact checks

```text
bun install
bun run typecheck
bun run test:gate0
bun run build:gate0
./.gate0-build/agent-bahi-gate0 --help
./.gate0-build/agent-bahi-gate0 --json gate0.proof
./.gate0-build/agent-bahi-gate0 --json no.such.command
git diff --check
```

The executable harness command is `bun run spikes/gate0/proof.ts`. It prints structured proof JSON and exits nonzero while any required spike is `PARTIAL` or `BLOCKED`; that nonzero result is expected for the current incomplete Gate0 verdict.

## Spike status

| Spike | Status | Exact evidence and boundary |
|---|---|---|
| STK-001 Bun runtime, lockfile, targets | PASS | Bun `1.3.14`, revision `1.3.14+0d9b296af`, strict TypeScript project, lockfile, and successful host/macOS arm64/Linux x64/Linux arm64 compile attempts. |
| STK-002 persistence candidates | PARTIAL | Native `bun:sqlite` passed the local proof. `drizzle-orm@0.44.7` imports only from `src/infrastructure/sqlite/drizzle-candidate.ts` and typechecks behind the port boundary. PostgreSQL and MySQL runtime/semantic proofs: **BLOCKED / NOT RUN**; no live-server proof is claimed. |
| STK-003 SQLite behavior | PASS | Temporary local SQLite file proved `foreign_keys=1`, `journal_mode=wal`, busy failure under an explicit writer lock, `BEGIN IMMEDIATE`, local-temp-path guard, composite tenant/BookSet FK, in-transaction balance validation, imbalance rollback, idempotency uniqueness, append-only postings/audit triggers, safe 64-bit BigInt round trip, cross-BookSet posting rejection, same-BookSet balanced posting success, scoped postings queries, posted journal entry immutability, and audit tenant FK rejection. |
| STK-004 migrations and upgrades | PARTIAL | Hand-reviewed `spikes/gate0/schema.sql` applied to SQLite with logical ID `gate0-001-core-sqlite`; checksum `0e9714d8f5e6361e1398464b605bd125406f30f4ed6e83a3972569f642b5567b`; tampered same-ID checksum was refused. PostgreSQL/MySQL migration equivalence and upgrade proofs: **BLOCKED / NOT RUN**. |
| STK-005 parser, validation, exact amounts | PASS | Domain-owned registry plus manual parser provide deterministic help/version/JSON success/JSON error and exit taxonomy. Persisted amounts are integer minor units; the proof uses BigInt with Bun `safeIntegers`. No decimal package was added because this slice has no FX/tax intermediate requiring it. |
| STK-006 embedded single-file builds | PASS | Host and all requested target compile steps succeeded. Foreign binaries were not executed. Artifact details and SHA-256 checksums are below. |

## SQLite proof detail

The executable proof creates a UUID-named SQLite file below the OS temporary root, refuses paths outside that root and common network-like prefixes, enables `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, and uses `safeIntegers: true`. It always closes the database and removes the database plus possible WAL sidecars in `finally`.

The schema is SQL-first. There is no Drizzle push, runtime schema generation, or migration generation. The migration table stores a logical ID and SHA-256 checksum; an existing ID with a changed checksum fails closed. Posting and audit update/delete triggers enforce append-only behavior. The proof uses `BEGIN IMMEDIATE` and checks the second writer's `database is locked` failure rather than silently retrying it.

## Build evidence

Host observed by `uname -srm`: `Darwin 25.5.0 arm64`.

Exact commands:

```text
bun build spikes/gate0/cli-smoke.ts --compile --outfile .gate0-build/agent-bahi-gate0
bun build spikes/gate0/cli-smoke.ts --compile --target=bun-darwin-arm64 --outfile .gate0-build/agent-bahi-gate0-darwin-arm64
bun build spikes/gate0/cli-smoke.ts --compile --target=bun-linux-x64 --outfile .gate0-build/agent-bahi-gate0-linux-x64
bun build spikes/gate0/cli-smoke.ts --compile --target=bun-linux-arm64 --outfile .gate0-build/agent-bahi-gate0-linux-arm64
```

The first sandboxed Linux attempts failed before artifact creation because the target runtime download returned `ConnectionRefused`; retrying with temporary network permission succeeded. The target compile steps were compile-only. `file` identified the outputs as Mach-O arm64, Mach-O arm64, ELF x86-64, and ELF aarch64 respectively. SHA-256:

```text
c73e8b7007b7500a286d646f62de8c97ae241e7b05037b668eef0fbcb51e815e  .gate0-build/agent-bahi-gate0
eec45d71cfc9bbb6947b62f19672e74423b1b0181c82ece520afc986f4137c04  .gate0-build/agent-bahi-gate0-darwin-arm64
f3d026d995058b67311607f57144fab39a2af3c6e882e05366648ed397e24353  .gate0-build/agent-bahi-gate0-linux-x64
a3f7b8b49876313e08062b4e6fb848ee90273df3de6b5a06b9b1ae91effeee13  .gate0-build/agent-bahi-gate0-linux-arm64
```

The compile artifacts are ignored and are not committed; this document records their checksums for the run. The host artifact was executed only for CLI smoke behavior. No Linux or other foreign artifact was executed.

## Remaining blockers

1. Run live PostgreSQL and MySQL semantic/migration proofs, including equivalent constraints, transactions, checksums, and rollback behavior.
2. Re-run the target artifacts on their native platforms and record runtime smoke evidence; compile-only evidence is not runtime proof.
3. Obtain separate physical-schema/architect review and explicit Phase 1 authorization. This Gate0 slice does not grant either.
