import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BUSINESS_OPERATION_CATALOG } from "./catalog.ts";
import { OperationDispatcher } from "./dispatcher.ts";
import type { DispatchEnvelope } from "./types.ts";

export const MCP_SERVER_VERSION = "0.0.0-gate0";

export function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

export function mcpToolResult(envelope: DispatchEnvelope): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(jsonSafe(envelope)) }],
    structuredContent: jsonSafe(envelope) as Record<string, unknown>,
    isError: !envelope.ok,
  };
}

export function mcpTools() {
  return BUSINESS_OPERATION_CATALOG.map((entry) => ({
    name: entry.id,
    description: `${entry.description} Side effect: ${entry.sideEffect}. Scope: ${entry.requiredScope}. Output: ${entry.outputDescription} Remediation: ${entry.remediation}`,
    inputSchema: entry.inputSchema,
  }));
}

/**
 * Construct one MCP protocol server over the caller-owned transport. Both
 * stdio and Streamable HTTP use this factory so the operation catalog,
 * dispatcher, result envelope, and operator boundary cannot drift.
 */
export function createMcpServer(dispatcher: OperationDispatcher): Server {
  const server = new Server({ name: "agent-bahi", version: MCP_SERVER_VERSION }, { capabilities: { tools: {} } });
  const tools = mcpTools();
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const input = (request.params.arguments ?? {}) as Record<string, unknown>;
    return mcpToolResult(await dispatcher.dispatch(request.params.name, input));
  });
  return server;
}
