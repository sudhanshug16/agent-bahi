# Agent-Bahi CLI and local MCP

The package exposes two Bun entrypoints:

```text
agent-bahi       # CLI operations and explicit database controls
agent-bahi-mcp   # local stdio MCP server
```

Remote MCP is an explicit HTTP server command. It serves MCP Streamable HTTP
at `POST /mcp`, plus process liveness at `GET /healthz` and read-only database
compatibility at `GET /readyz`:

```text
agent-bahi --database /absolute/books.sqlite mcp serve
agent-bahi --database /absolute/books.sqlite mcp serve --host 0.0.0.0 --port 8787 --allow-remote --token-file /run/secrets/agent-bahi-mcp-token --allowed-host books.example.test
```

The default is loopback (`127.0.0.1:8787`) with no token. Any non-loopback
bind requires `--allow-remote` and a bearer token from
`AGENT_BAHI_MCP_TOKEN`, `AGENT_BAHI_MCP_TOKEN_FILE`, or `--token-file`.
Plaintext tokens are never accepted as command-line arguments. The explicit
`--allow-insecure-no-auth` switch is required to run a non-loopback server
without authentication and is reported as `INSECURE_NO_AUTH_ENABLED` in the
JSON startup diagnostic. `--allowed-host` may be repeated; Origin is checked
against the same host allowlist, and proxy headers are ignored.

The HTTP server speaks plain HTTP. Put it behind a TLS reverse proxy or use a
Tailscale HTTPS endpoint when encryption or external exposure is needed; the
Agent-Bahi server does not generate certificates. Sessions are bounded,
stateful in memory (64 sessions maximum, 30-minute idle expiry), with no
multi-user or RBAC semantics. Each dispatched operation creates its own
BusinessSession, so concurrent calls retain the existing SQLite fencing.

Startup diagnostics are JSON on stderr and include the bind URL, auth mode,
redacted database basename, schema compatibility, and session mode. The
server never initializes or upgrades a database. `UPDATE_REQUIRED` and other
compatibility failures are typed remediation responses directing the operator
to run the CLI's explicit `database.upgrade --backup ABS_PATH` command; MCP
cannot perform that update. The stdio entrypoint remains local and unchanged.
V1 uses bounded JSON request/response sessions on POST; optional standalone
SSE GET streams are deliberately not enabled.

Both surfaces use the same explicit operation catalog and dispatcher over the
application public facade. Operation inputs are JSON objects. Commands retain
their versioned envelope, tenant/BookSet scope, actor, reason, and request ID;
the transport does not infer missing scope or rewrite a request.

Normal operations perform a side-effect-free database compatibility check first.
`UNINITIALIZED` and `UPDATE_REQUIRED` are returned without creating schema or
running migrations. Operator actions are explicit:

```text
agent-bahi --database ./books.sqlite database.status --json
agent-bahi --database ./books.sqlite database.init --json
agent-bahi --database ./books.sqlite database.upgrade --backup /absolute/backup/path --json
agent-bahi --database ./books.sqlite operations list --json
agent-bahi --database ./books.sqlite operations run ledger.trial-balance --input input.json --json
```

With `--json`, exactly one JSON envelope is written to stdout. Human results are
written to stdout; diagnostics are written to stderr. Success is:

```json
{"ok":true,"operationId":"...","result":{},"resultHash":"..."}
```

Errors use the stable shape `{"ok":false,"operationId":"...","error":{"code":"...","message":"..."}}`.
Exit codes are 0 success, 2 usage/unknown operation, 3 invalid input, 4
domain or scope rejection, 5 database readiness/compatibility failure, and 6
unexpected internal failure.

The MCP server uses the official `@modelcontextprotocol/sdk@1.30.0` split
server and stdio transport. Every business catalog entry is a tool. Database
CLI-only database mutations are deliberately absent from `tools/list`; read-only
database inspection remains available. Closing stdin is a clean server shutdown.
MCP tool results contain the same typed JSON envelope in
both text content and `structuredContent`, with `isError: true` for failures.

For a container deployment, see `Dockerfile` and `docker-compose.yml`. The
image runs the compiled Bun binary as a non-root user, keeps SQLite and backup
writes under `/data`, supports a read-only root filesystem, and leaves TLS and
secret provisioning to the deployment layer.

V1 database operations use the version and db aliases:

    agent-bahi version --json
    agent-bahi --database /absolute/books.sqlite db status --json
    agent-bahi --database /absolute/books.sqlite db backup list --json
    agent-bahi --database /absolute/books.sqlite db backup create --request-id req-1 --actor-id human-1 --yes --json
    agent-bahi --database /absolute/books.sqlite db upgrade preview --json
    agent-bahi --database /absolute/books.sqlite db upgrade apply --request-id req-2 --actor-id human-1 --yes --json

db backup restore creates and verifies a pre-restore safety backup before
atomic promotion. Upgrade apply reviews ordered migration IDs/checksums,
creates and verifies a backup before migration, and records an adjacent
append-only receipt containing hashes, timing, outcome, and recovery. If
recovery fails, the process must not continue business work. The receipt and
retained backup are not silently deleted.

The binary is updated by the operator first; the explicit CLI upgrade follows.
MCP exposes inspection operations only. Calling a CLI-only mutation through
MCP returns CLI_REQUIRED and never applies a migration or changes a binary.
SQLite data-format/schema versions are independent from CLI semver. V1 makes
no self-updater, download-installer, signing, or notarization claim.
