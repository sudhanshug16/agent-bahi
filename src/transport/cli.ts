import { readFile } from "node:fs/promises";
import { OperationDispatcher } from "./dispatcher.ts";
import type { DispatchEnvelope } from "./types.ts";

export const EXIT_CODES = {
  SUCCESS: 0,
  USAGE: 2,
  INPUT: 3,
  DOMAIN: 4,
  DATABASE: 5,
  INTERNAL: 6,
} as const;

function help(): string {
  return [
    "agent-bahi — agent-first SQLite accounting transport",
    "",
    "Usage:",
    "  agent-bahi [--database PATH] skills list|show <id>|check [id] [--json]",
    "  agent-bahi [--database PATH] operations list|show <operation-id> [--json]",
    "  agent-bahi [--database PATH] operations describe OPERATION [--json]",
    "  agent-bahi [--database PATH] operations run OPERATION [--input FILE|-] [--json]",
    "  agent-bahi [--database PATH] database.status|database.init",
    "  agent-bahi [--database PATH] database.upgrade --backup ABS_PATH",
    "  agent-bahi [--database PATH] status [--tenant-id ID] [--book-set-id ID] [--as-of-date YYYY-MM-DD] [--json]",
    "  agent-bahi [--database PATH] mcp",
    "",
    "Normal business operations never initialize, upgrade, or mutate database schema.",
    "Use --input - (or a file path) for deterministic JSON operation input.",
  ].join("\n");
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(jsonSafe(value))}\n`);
}

function printHuman(value: unknown): void {
  if (typeof value === "string") process.stdout.write(`${value}\n`);
  else process.stdout.write(`${JSON.stringify(jsonSafe(value), null, 2)}\n`);
}

function printHumanError(value: unknown): void {
  if (typeof value === "string") process.stderr.write(`${value}\n`);
  else process.stderr.write(`${JSON.stringify(jsonSafe(value), null, 2)}\n`);
}

function errorExitCode(envelope: DispatchEnvelope): number {
  if (envelope.ok) return EXIT_CODES.SUCCESS;
  if (["UNINITIALIZED", "UPDATE_REQUIRED", "DATABASE_UNAVAILABLE", "INCOMPATIBLE_DATABASE"].includes(envelope.error.code)) return EXIT_CODES.DATABASE;
  if (["INVALID_INPUT", "INVALID_BACKUP_PATH", "UNKNOWN_OPERATION", "UNKNOWN_SKILL", "OPERATOR_OPERATION_FORBIDDEN"].includes(envelope.error.code)) return ["UNKNOWN_OPERATION", "UNKNOWN_SKILL"].includes(envelope.error.code) ? EXIT_CODES.USAGE : EXIT_CODES.INPUT;
  if (envelope.error.code === "INTERNAL_ERROR") return EXIT_CODES.INTERNAL;
  return EXIT_CODES.DOMAIN;
}

function printMetadataHuman(operationId: string, envelope: DispatchEnvelope): void {
  if (!envelope.ok) {
    printHumanError(`Error [${envelope.error.code}]: ${envelope.error.message}${envelope.error.details ? `\n${JSON.stringify(envelope.error.details, null, 2)}` : ""}`);
    return;
  }
  const result = envelope.result as Record<string, unknown>;
  if (operationId === "agent.skill.list") {
    const guides = (result.guides as Array<Record<string, unknown>>) ?? [];
    printHuman(guides.map((guide) => `${guide.id} v${guide.version}\t${guide.requiredScope}\t${guide.title}\t${guide.summary}`).join("\n"));
  } else if (operationId === "agent.skill.check") {
    const reports = (result.reports as Array<Record<string, unknown>>) ?? [];
    printHuman([`Overall: ${result.status}`, ...reports.map((report) => `${report.id} v${report.version}\t${report.status}\tmissing=${(report.missingOperationIds as unknown[]).length}\texternal=${(report.externalStepIds as unknown[]).length}\tnot-implemented=${(report.notImplementedStepIds as unknown[]).length}`)].join("\n"));
  } else if (operationId === "agent.operation.list") {
    const operations = (result.operations as Array<Record<string, unknown>>) ?? [];
    printHuman(operations.map((operation) => `${operation.id}\t${operation.sideEffect}\t${operation.requiredScope}\t${operation.description}`).join("\n"));
  } else {
    printHuman(result.guide ?? result.operation ?? result);
  }
}

async function inputFrom(spec: string | undefined): Promise<unknown> {
  if (!spec || spec === "-") {
    const body = await new Response(Bun.stdin.stream()).text();
    if (body.trim() === "") return {};
    return JSON.parse(body);
  }
  return JSON.parse(await readFile(spec, "utf8"));
}

function takeFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, value && !value.startsWith("--") ? 2 : 1);
  return value && !value.startsWith("--") ? value : undefined;
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = [...argv];
  const json = args.includes("--json");
  if (json) args.splice(args.indexOf("--json"), 1);
  const databasePath = takeFlag(args, "--database") ?? process.env.AGENT_BAHI_DATABASE ?? `${process.cwd()}/agent-bahi.sqlite`;
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printHuman(help());
    return EXIT_CODES.SUCCESS;
  }
  if (args[0] === "mcp") {
    process.stderr.write("Use the agent-bahi-mcp entrypoint for stdio MCP.\n");
    return EXIT_CODES.USAGE;
  }

  const metadataDispatcher = new OperationDispatcher({ databasePath, allowOperatorOperations: true, source: "CLI" });
  if (args[0] === "skills" && ["list", "show", "check"].includes(args[1] ?? "")) {
    const subcommand = args[1];
    const id = args[2];
    const operationId = subcommand === "list" ? "agent.skill.list" : subcommand === "show" ? "agent.skill.show" : "agent.skill.check";
    const input = subcommand === "list" ? {} : id ? { id } : {};
    const metadataResult = await metadataDispatcher.dispatch(operationId, input);
    if (json) printJson(metadataResult); else printMetadataHuman(operationId, metadataResult);
    return errorExitCode(metadataResult);
  }

  let operationId: string | undefined;
  let result: DispatchEnvelope;
  if (args[0] === "operations" && args[1] === "list") {
    const metadataResult = await metadataDispatcher.dispatch("agent.operation.list", {});
    if (json) printJson(metadataResult); else printMetadataHuman("agent.operation.list", metadataResult);
    return errorExitCode(metadataResult);
  }
  if (args[0] === "operations" && (args[1] === "show" || args[1] === "describe")) {
    operationId = args[2];
    const metadataResult = await metadataDispatcher.dispatch("agent.operation.show", operationId ? { operationId } : {});
    if (json) printJson(metadataResult); else printMetadataHuman("agent.operation.show", metadataResult);
    return errorExitCode(metadataResult);
  }
  if (args[0] === "operations" && args[1] === "run") {
    operationId = args[2];
    const inputSpec = takeFlag(args, "--input");
    if (!operationId) {
      const error: DispatchEnvelope = { ok: false, error: { code: "INVALID_INPUT", message: "operations run requires an operation ID" } };
      if (json) printJson(error); else printHumanError(`Error [${error.error.code}]: ${error.error.message}`);
      return EXIT_CODES.USAGE;
    }
    try {
      const input = await inputFrom(inputSpec);
      result = await new OperationDispatcher({ databasePath, allowOperatorOperations: true, source: "CLI" }).dispatch(operationId, input);
    } catch (error) {
      result = { ok: false, operationId, error: { code: "INVALID_INPUT", message: error instanceof Error ? error.message : String(error) } };
    }
  } else if (args[0].startsWith("database.")) {
    operationId = args[0];
    const backup = takeFlag(args, "--backup");
    const input = operationId === "database.upgrade" ? { backupDestinationPath: backup } : {};
    result = await new OperationDispatcher({ databasePath, allowOperatorOperations: true, source: "CLI" }).dispatch(operationId, input);
  } else if (args[0] === "status") {
    operationId = "company.status";
    const tenant = takeFlag(args, "--tenant-id") ?? takeFlag(args, "--tenant");
    const bookSet = takeFlag(args, "--book-set-id") ?? takeFlag(args, "--bookset");
    const asOfDate = takeFlag(args, "--as-of-date") ?? takeFlag(args, "--as-of");
    const input = { ...(tenant ? { tenantId: tenant } : {}), ...(bookSet ? { bookSetId: bookSet } : {}), ...(asOfDate ? { asOfDate } : {}) };
    result = await new OperationDispatcher({ databasePath, allowOperatorOperations: true, source: "CLI" }).dispatch(operationId, input);
  } else {
    const error: DispatchEnvelope = { ok: false, error: { code: "UNKNOWN_OPERATION", message: "Expected operations list, operations describe, operations run, or database.*" } };
    if (json) printJson(error); else printHumanError(`Error [${error.error.code}]: ${error.error.message}`);
    return EXIT_CODES.USAGE;
  }

  if (json) printJson(result);
  else if (result.ok) printHuman(result.result);
  else printHumanError(`Error [${result.error.code}]: ${result.error.message}${result.error.details ? `\n${JSON.stringify(result.error.details, null, 2)}` : ""}`);
  return errorExitCode(result);
}
