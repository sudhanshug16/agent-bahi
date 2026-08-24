# agent-bahi

Agent-Bahi is an MIT-licensed, agent-first India accounting and bookkeeping
system for multiple legal entities and personal tax. V1 provides a shared
typed CLI and MCP transport over a tenant- and BookSet-scoped application
facade. It is implemented and locally distributable; it is not a hosted
service. The public npm package is `@sudhanshug/agent-bahi` and ships the Bun
source entrypoints.

## V1 capabilities

- Tenant and BookSet setup for companies, proprietorships, and individuals,
  with explicit scope checks and audited mutations.
- Balanced, idempotent double-entry journal posting with immutable audit
  evidence, period close/reopen, and India financial-year rollover snapshots.
- Trial Balance, Profit and Loss, Balance Sheet, Close Pack, fixed-asset,
  foreign-exchange, expense, company-status, and compliance reports.
- Parties, invoices, receipts, vendor bills, payments, bank-statement import,
  and deterministic bank reconciliation.
- Local Source Registry + Bank File Import V1 for the exact Standard Chartered
  and Craze CSV contracts, with SHA-256 provenance, safe operator-root file
  access, preview-only parsing, and no journal creation or automatic
  classification.
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

The database path is resolved in this order: explicit `--database PATH`, a
non-empty `AGENT_BAHI_DATABASE`, then the platform default. On macOS the
default is `~/Library/Application Support/agent-bahi/agent-bahi.sqlite`; on
Linux it is `$XDG_DATA_HOME/agent-bahi/agent-bahi.sqlite` when XDG is absolute,
otherwise `~/.local/share/agent-bahi/agent-bahi.sqlite`; on Windows it is
`%LOCALAPPDATA%\\agent-bahi\\agent-bahi.sqlite` when LOCALAPPDATA is absolute,
otherwise `%USERPROFILE%\\AppData\\Local\\agent-bahi\\agent-bahi.sqlite`.
Other platforms use `~/.local/share/agent-bahi/agent-bahi.sqlite`. Relative or
malformed XDG/LOCALAPPDATA values are ignored. Explicit and environment paths
must have an existing parent; they are never created implicitly.

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

Release manifests are integrity metadata only. The compiled binary boundary is
separate from the npm source package: compiled binaries are unsigned local
artifacts, with no signing or notarization claim. The npm package does not
include `dist/`.

## Quick start

Agent-Bahi uses the pinned Bun runtime from `runtime-versions.json`:

```sh
bun --version                 # 1.3.14
bun install --frozen-lockfile
bun run typecheck
```

Install the public package with Bun (Bun `1.3.14` is required):

```sh
bun add @sudhanshug/agent-bahi
```

The installed commands are `agent-bahi` for CLI operations and
`agent-bahi-mcp` for local stdio MCP. The package is a Bun source package, so
keep Bun `1.3.14` available when invoking either command.

Use the source CLI during development:

```sh
agent-bahi --help
agent-bahi database.init --json
agent-bahi database.status --json
agent-bahi --database "$PWD/books.sqlite" operations list --json
```

For a checkout, the equivalent source commands are `bun run src/cli.ts ...`.

`database.init` is the first-run command. It creates the platform-default
parent recursively with mode 0700 and the SQLite file with mode 0600 on POSIX;
it is idempotent. It does not create parents for `--database` or
`AGENT_BAHI_DATABASE`, and normal operations never initialize or upgrade a
database implicitly. Before a business operation on an older database, inspect
compatibility, create or verify a backup, preview the exact migration plan, and
apply the explicit CLI-owned upgrade. See [CLI and MCP operations](docs/cli-mcp.md)
for the full backup, restore, upgrade, and error contract.

## MCP

Run the local stdio server with the same database:

```sh
agent-bahi-mcp
```

Stdio MCP resolves the same precedence and platform default as the CLI, but it
cannot initialize or upgrade a database. Run `agent-bahi database.init` first;
MCP remains inspection-only. The HTTP MCP server launched by the CLI receives
the already-resolved CLI database path and has the same initialization boundary.

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
macOS artifact. These compiled binaries are outside the npm package and are not
signed or notarized:

```sh
bun run build:release
./dist/agent-bahi --help
cat dist/agent-bahi-darwin-arm64.manifest.json
```

The manifest explicitly says `signing: "not provided in V1"`.

## npm release

The [Publish npm workflow](.github/workflows/publish-npm.yml) runs on pushes to
`main` that change `package.json`, or by manual dispatch. It runs the full
release checks and package smoke test, then publishes a new package version
only when that exact version is not already on npm. Version changes on `main`
are the release trigger; an already-published exact version is a successful
no-op. npm Trusted Publishing supplies GitHub Actions OIDC authentication and
automatic provenance, so this workflow uses no long-lived npm token.

## Development checks

```sh
bun run release:check
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
