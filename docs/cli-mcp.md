# Agent-Bahi CLI and local MCP

The package exposes two Bun entrypoints:

```text
agent-bahi       # CLI operations and explicit database controls
agent-bahi-mcp   # local stdio MCP server
```

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
operator actions are deliberately absent from `tools/list`; closing stdin is a
clean server shutdown. MCP tool results contain the same typed JSON envelope in
both text content and `structuredContent`, with `isError: true` for failures.
