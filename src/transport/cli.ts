import { readFile } from "node:fs/promises";
import { OperationDispatcher } from "./dispatcher.ts";
import type { DispatchEnvelope } from "./types.ts";
import { runRemoteMcp } from "../mcp-http.ts";

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
    "agent-bahi 1.0.0 — agent-first SQLite accounting transport",
    "",
    "Usage:",
    "  agent-bahi [--database PATH] skills list|show <id>|check [id] [--json]",
    "  agent-bahi [--database PATH] operations list|show <operation-id> [--json]",
    "  agent-bahi [--database PATH] operations describe OPERATION [--json]",
    "  agent-bahi [--database PATH] operations run OPERATION [--input FILE|-] [--json]",
    "  agent-bahi version [--json]",
    "  agent-bahi [--database PATH] db status|backup list|backup show|backup verify|upgrade preview|upgrade status",
    "  agent-bahi [--database PATH] db backup create|restore|upgrade apply --request-id ID --actor-id ID --yes",
    "  agent-bahi [--database PATH] database.compatibility|database.upgrade.preview|database.upgrade.status",
    "  agent-bahi [--database PATH] status [--tenant-id ID] [--book-set-id ID] [--as-of-date YYYY-MM-DD] [--json]",
    "  agent-bahi [--database PATH|sqlite:///URL] mcp",
    "  agent-bahi [--database PATH|sqlite:///URL] mcp serve [--host HOST] [--port PORT] [--allow-remote] [--token-file PATH] [--allow-insecure-no-auth] [--allowed-host HOST]",
    "  Local stdio MCP: agent-bahi-mcp (database updates remain CLI-owned).",
    "  Remote MCP: mcp serve speaks HTTP on loopback by default; use a TLS proxy/Tailscale for HTTPS.",
    "",
    "Update the binary first, then run an explicit CLI database upgrade. MCP is inspection-only and never migrates.",
    "Database mutations require an explicit database path, requestId, HUMAN actor, and --yes.",
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
  const explicitDatabase = args.includes("--database");
  const databasePath = takeFlag(args, "--database") ?? process.env.AGENT_BAHI_DATABASE ?? `${process.cwd()}/agent-bahi.sqlite`;
  if (args.includes("--help") || args.includes("-h") || args[0] === "help" || args.length === 0) {
    printHuman(help());
    return EXIT_CODES.SUCCESS;
  }

  if (args[0] === "version") {
    const result = await new OperationDispatcher({ databasePath, allowOperatorOperations: false, source: "CLI" }).dispatch("system.version", {});
    if (json) printJson(result); else printHuman(result.ok ? result.result : result);
    return errorExitCode(result);
  }
  if (args[0] === "mcp") {
    if (args[1] !== "serve") {
      process.stderr.write("Use the agent-bahi-mcp entrypoint for local stdio MCP, or `agent-bahi mcp serve` for remote HTTP MCP.\n");
      return EXIT_CODES.USAGE;
    }
    const host = takeFlag(args, "--host");
    const portValue = takeFlag(args, "--port");
    const tokenFile = takeFlag(args, "--token-file");
    const allowedHosts: string[] = [];
    while (args.includes("--allowed-host")) {
      const allowedHost = takeFlag(args, "--allowed-host");
      if (!allowedHost) {
        process.stderr.write("Error [INVALID_INPUT]: --allowed-host requires a host\n");
        return EXIT_CODES.INPUT;
      }
      allowedHosts.push(allowedHost);
    }
    const port = portValue === undefined ? null : Number(portValue);
    if (port !== null && (!Number.isInteger(port) || port < 0 || port > 65535)) {
      process.stderr.write("Error [INVALID_INPUT]: --port must be an integer from 0 through 65535\n");
      return EXIT_CODES.INPUT;
    }
    try {
      await runRemoteMcp({
        databasePath,
        ...(host ? { host } : {}),
        ...(port === null ? {} : { port }),
        allowRemote: args.includes("--allow-remote"),
        allowInsecureNoAuth: args.includes("--allow-insecure-no-auth"),
        ...(tokenFile ? { tokenFile } : {}),
        allowedHosts,
      });
      return EXIT_CODES.SUCCESS;
    } catch (error) {
      process.stderr.write(`Error [MCP_SERVER_CONFIGURATION]: ${error instanceof Error ? error.message : "server could not start"}\n`);
      return EXIT_CODES.INPUT;
    }
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
  } else if (args[0] === "db") {
    const group = args[1];
    const action = args[2];
    const operationId = group === "status" ? "database.compatibility"
      : group === "backup" && action === "list" ? "database.backup.list"
        : group === "backup" && action === "show" ? "database.backup.show"
          : group === "backup" && action === "verify" ? "database.backup.verify"
            : group === "backup" && action === "create" ? "database.backup.create"
              : group === "backup" && action === "restore" ? "database.backup.restore"
                : group === "upgrade" && action === "preview" ? "database.upgrade.preview"
                  : group === "upgrade" && action === "status" ? "database.upgrade.status"
                  : group === "upgrade" && action === "apply" ? "database.upgrade.apply" : undefined;
    if (!operationId) {
      const error: DispatchEnvelope = { ok: false, error: { code: "UNKNOWN_OPERATION", message: "Expected db status, db backup {create,list,show,verify,restore}, or db upgrade {preview,status,apply}" } };
      if (json) printJson(error); else printHumanError(`Error [${error.error.code}]: ${error.error.message}`);
      return EXIT_CODES.USAGE;
    }
    const mutating = ["database.backup.create", "database.backup.restore", "database.upgrade.apply"].includes(operationId);
    if (mutating && !explicitDatabase) {
      const error: DispatchEnvelope = { ok: false, error: { code: "INVALID_INPUT", message: "Database mutations require an explicit --database path" } };
      if (json) printJson(error); else printHumanError(`Error [${error.error.code}]: ${error.error.message}`);
      return EXIT_CODES.INPUT;
    }
    const requestId = takeFlag(args, "--request-id");
    const actorId = takeFlag(args, "--actor-id");
    const backupDestinationPath = takeFlag(args, "--destination") ?? takeFlag(args, "--backup") ?? takeFlag(args, "--backup-path");
    const backupHash = takeFlag(args, "--backup-hash");
    const targetPath = takeFlag(args, "--target");
    const backupDirectory = takeFlag(args, "--backup-dir");
    const input = {
      ...(requestId ? { requestId } : {}),
      ...(actorId ? { actor: { kind: "HUMAN", id: actorId } } : {}),
      ...(args.includes("--yes") ? { yes: true } : {}),
      ...(backupDestinationPath ? { ...(operationId === "database.backup.restore" || operationId === "database.backup.verify" || operationId === "database.backup.show" ? { backupPath: backupDestinationPath } : { destinationPath: backupDestinationPath, backupDestinationPath }) } : {}),
      ...(backupHash ? { backupHash } : {}),
      ...(targetPath ? { targetPath } : {}),
      ...(backupDirectory ? { backupDirectory } : {}),
    };
    if (args.includes("--yes")) args.splice(args.indexOf("--yes"), 1);
    result = await new OperationDispatcher({ databasePath, allowOperatorOperations: true, source: "CLI" }).dispatch(operationId, input);
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
