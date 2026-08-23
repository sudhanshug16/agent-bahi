# Agent-Bahi skill guides

Each guide is a repository-distributed entrypoint for the typed canonical
registry in `src/transport/skills.ts`. The validator checks the header,
operation markers, ordered step markers, explicit external boundaries, and
required safety guidance. Edit the registry first, then update the matching
`SKILL.md` and run `bun run validate:skills`.

Guides are instructions for deterministic operations, not dynamic execution.

For database changes, use the database operations guidance in docs/cli-mcp.md. Update the CLI
binary first, inspect compatibility and the exact migration preview, then use
the CLI-only backup/restore/upgrade commands with an explicit database path,
HUMAN actor, request ID, and --yes. MCP remains inspection-only; mutation
requests return CLI_REQUIRED. Retained backups and adjacent operation
receipts record hashes and recovery outcomes, including RECOVERY_FAILED.
Agents must inspect status first, provide explicit tenant/BookSet/TaxCase
scope for mutations, preview before irreversible or human-gated actions,
preserve evidence and result hashes, never equate export with government
submission, and surface typed blockers instead of guessing.

Transport choice is explicit: use `agent-bahi-mcp` for local stdio MCP, or
`agent-bahi mcp serve` for bounded-session Streamable HTTP. HTTP is plain HTTP
by design and may be placed behind a TLS reverse proxy or Tailscale. Agents
must not initialize or upgrade databases through MCP; use the CLI-owned
`database.init` or verified `database.upgrade --backup ABS_PATH` workflow.
