# agent-bahi

Agent-Bahi is an MIT-licensed, agent-first India accounting and bookkeeping
system for multiple legal entities and personal tax. V1 provides a shared
typed CLI and MCP transport over a tenant- and BookSet-scoped application
facade. It is implemented and locally distributable; it is not a hosted
service and this repository does not publish packages or release tags.

## V1 capabilities

- Tenant and BookSet setup for companies, proprietorships, and individuals,
  with explicit scope checks and audited mutations.
- Balanced, idempotent double-entry journal posting with immutable audit
  evidence, period close/reopen, and India financial-year rollover snapshots.
- Trial Balance, Profit and Loss, Balance Sheet, Close Pack, fixed-asset,
  foreign-exchange, expense, company-status, and compliance reports.
- Parties, invoices, receipts, vendor bills, payments, bank-statement import,
  and deterministic bank reconciliation.
- GST registrations and source registers; source-backed GSTR-1 preparation,
  local validation, review-pack export, and bounded GSTR-3B reconciliation.
- TDS/TCS and payroll masters, rule-gated pay runs, payslips, export-only bank
  batches, remittances, and locally validated salary-TDS artifacts.
- Personal TaxCase source intake, immutable facts and reconciliation,
  FilingSnapshots, position worksheets, ITR eligibility, bounded computation,
  and local return artifacts.
- Source-linked compliance facts, rules, deadlines, applicability, obligation
  lifecycle, annual MCA workpapers, and versioned agent skill guides.
- Local CLI-only database initialization, compatibility inspection, verified
  backups, restore with a pre-restore safety backup, and reviewed upgrades.

The live operation catalog is the authoritative capability list:

```sh
bun run src/cli.ts operations list
```

## Storage and boundaries

V1 is SQLite-only. SQLite is the supported runtime data store, and all normal
business operations require an explicit tenant and, where applicable, BookSet
or TaxCase scope. PostgreSQL and MySQL references in the discovery material are
research history, not supported V1 product backends.

Compliance and tax artifacts are preparation, validation, reconciliation, and
review evidence. Agent-Bahi does not automatically submit to government or
bank portals, make payments, obtain or use a DSC/EVC, or claim that an export
was filed or accepted. Current-law conclusions require the relevant
source-linked, effective authority pack and human review; missing or unknown
authority fails closed. Zoho Books import is intentionally deferred until the
last product phase.

The optional HTTP MCP server speaks plain HTTP. Keep it on a trusted LAN or
inside a trusted Tailscale deployment, or place it behind a user-managed HTTPS
reverse proxy. The server does not generate certificates, provide multi-user
RBAC, or initialize/upgrade databases. Local stdio MCP remains available.

Release manifests are integrity metadata only. V1 does not claim artifact
signatures, notarization, automatic updates, npm publication, tags, or pushes.

## Quick start

Agent-Bahi uses the pinned Bun runtime from `runtime-versions.json`:

```sh
bun --version                 # 1.3.14
bun install --frozen-lockfile
bun run typecheck
```

Use the source CLI during development:

```sh
bun run src/cli.ts --help
bun run src/cli.ts --database ./books.sqlite database.status --json
bun run src/cli.ts --database ./books.sqlite database.init --json
bun run src/cli.ts --database ./books.sqlite operations list --json
```

Normal operations never initialize or upgrade a database implicitly. Before a
business operation on an older database, inspect compatibility, create or
verify a backup, preview the exact migration plan, and apply the explicit
CLI-owned upgrade. See [CLI and MCP operations](docs/cli-mcp.md) for the full
backup, restore, upgrade, and error contract.

## MCP

Run the local stdio server with the same database:

```sh
bun run src/mcp.ts --database "$PWD/books.sqlite"
```

For a trusted remote deployment, opt in explicitly to a non-loopback HTTP
bind and provide a bearer token from a file or environment variable:

```sh
AGENT_BAHI_MCP_TOKEN_FILE=/run/secrets/agent-bahi-mcp-token \
  bun run src/cli.ts --database "$PWD/books.sqlite" mcp serve \
  --host 0.0.0.0 --port 8787 --allow-remote \
  --token-file /run/secrets/agent-bahi-mcp-token
```

The default bind is loopback at `127.0.0.1:8787`. See
[CLI and MCP operations](docs/cli-mcp.md) for host/origin checks, session
limits, readiness responses, TLS responsibility, and the Docker deployment.

## Local release build

The release build produces a compiled CLI binary for the host and the existing
macOS arm64 target, then writes a SHA-256 file and an unsigned manifest for the
macOS artifact:

```sh
bun run build:release
./dist/agent-bahi --help
cat dist/agent-bahi-darwin-arm64.manifest.json
```

The manifest explicitly says `signing: "not provided in V1"`. The source
package metadata is public and MIT-licensed for local packaging, but no
`npm publish`, tag, push, or other external release action is part of this
repository workflow.

## Development checks

```sh
bun run test:release
bun run validate:skills
bun run typecheck
bun test
```

The repository contains extensive domain, persistence, transport, migration,
backup/restore, tenant-isolation, and statutory-artifact tests. Statutory
outputs remain bounded local artifacts and must not be represented as official
filing or portal acceptance.

## License

Agent-Bahi is released under the [MIT License](LICENSE).
