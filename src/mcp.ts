import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OperationDispatcher } from "./transport/dispatcher.ts";
import { createMcpServer } from "./transport/mcp-server.ts";
import { resolveDatabasePath } from "./infrastructure/config/database.ts";

export async function runMcp(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = [...argv];
  const databaseFlag = args.indexOf("--database");
  const explicitPath = databaseFlag >= 0 ? args[databaseFlag + 1] : undefined;
  if (databaseFlag >= 0 && (!explicitPath || explicitPath.startsWith("--"))) throw new Error("--database requires a non-empty path");
  const resolution = resolveDatabasePath({ explicitPath });
  const dispatcher = new OperationDispatcher({ databasePath: resolution.path, databasePathSource: resolution.source, allowOperatorOperations: false, source: "MCP" });
  const server = createMcpServer(dispatcher);
  await server.connect(new StdioServerTransport());
}

try {
  await runMcp();
} catch (error) {
  process.stderr.write(`agent-bahi MCP: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
