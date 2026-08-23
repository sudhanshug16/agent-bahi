import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OperationDispatcher } from "./transport/dispatcher.ts";
import { createMcpServer } from "./transport/mcp-server.ts";

export async function runMcp(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = [...argv];
  const databaseFlag = args.indexOf("--database");
  const databasePath = databaseFlag >= 0 ? args[databaseFlag + 1] : process.env.AGENT_BAHI_DATABASE ?? `${process.cwd()}/agent-bahi.sqlite`;
  if (!databasePath || databasePath.startsWith("--")) throw new Error("--database requires a path");
  const dispatcher = new OperationDispatcher({ databasePath, allowOperatorOperations: false, source: "MCP" });
  const server = createMcpServer(dispatcher);
  await server.connect(new StdioServerTransport());
}

try {
  await runMcp();
} catch (error) {
  process.stderr.write(`agent-bahi MCP: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
