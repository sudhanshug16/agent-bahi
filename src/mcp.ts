import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BUSINESS_OPERATION_CATALOG } from "./transport/catalog.ts";
import { OperationDispatcher } from "./transport/dispatcher.ts";
import type { DispatchEnvelope } from "./transport/types.ts";

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

function toolResult(envelope: DispatchEnvelope): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(jsonSafe(envelope)) }],
    structuredContent: jsonSafe(envelope) as Record<string, unknown>,
    isError: !envelope.ok,
  };
}

export async function runMcp(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = [...argv];
  const databaseFlag = args.indexOf("--database");
  const databasePath = databaseFlag >= 0 ? args[databaseFlag + 1] : process.env.AGENT_BAHI_DATABASE ?? `${process.cwd()}/agent-bahi.sqlite`;
  if (!databasePath || databasePath.startsWith("--")) throw new Error("--database requires a path");
  const dispatcher = new OperationDispatcher({ databasePath, allowOperatorOperations: false, source: "MCP" });
  const server = new Server({ name: "agent-bahi", version: "0.0.0-gate0" }, { capabilities: { tools: {} } });
  const tools = BUSINESS_OPERATION_CATALOG.map((entry) => ({
    name: entry.id,
    description: `${entry.description} Side effect: ${entry.sideEffect}. Scope: ${entry.requiredScope}. Output: ${entry.outputDescription} Remediation: ${entry.remediation}`,
    inputSchema: entry.inputSchema,
  }));
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const input = (request.params.arguments ?? {}) as Record<string, unknown>;
    return toolResult(await dispatcher.dispatch(request.params.name, input));
  });
  await server.connect(new StdioServerTransport());
}

try {
  await runMcp();
} catch (error) {
  process.stderr.write(`agent-bahi MCP: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
