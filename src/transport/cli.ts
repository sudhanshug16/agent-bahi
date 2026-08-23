import { readFile } from "node:fs/promises";
import { OPERATION_CATALOG, findOperation } from "./catalog.ts";
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
    "  agent-bahi [--database PATH] operations list [--json]",
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
  if (["INVALID_INPUT", "INVALID_BACKUP_PATH", "UNKNOWN_OPERATION", "OPERATOR_OPERATION_FORBIDDEN"].includes(envelope.error.code)) return envelope.error.code === "UNKNOWN_OPERATION" ? EXIT_CODES.USAGE : EXIT_CODES.INPUT;
  if (envelope.error.code === "INTERNAL_ERROR") return EXIT_CODES.INTERNAL;
  return EXIT_CODES.DOMAIN;
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

  let operationId: string | undefined;
  let result: DispatchEnvelope;
  if (args[0] === "operations" && args[1] === "list") {
    const value = { operations: OPERATION_CATALOG };
    if (json) printJson({ ok: true, operationId: "operations.list", result: value }); else printHuman(OPERATION_CATALOG.map((entry) => `${entry.id}\t${entry.sideEffect}\t${entry.requiredScope}\t${entry.description}`).join("\n"));
    return EXIT_CODES.SUCCESS;
  }
  if (args[0] === "operations" && args[1] === "describe") {
    operationId = args[2];
    const entry = operationId ? findOperation(operationId) : undefined;
    if (!entry) {
      const error: DispatchEnvelope = { ok: false, operationId, error: { code: "UNKNOWN_OPERATION", message: `Unknown operation: ${operationId ?? ""}` } };
      if (json) printJson(error); else printHumanError(`Error [${error.error.code}]: ${error.error.message}`);
      return EXIT_CODES.USAGE;
    }
    if (json) printJson({ ok: true, operationId: "operations.describe", result: entry }); else printHuman(entry);
    return EXIT_CODES.SUCCESS;
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
