import { CLI_VERSION, COMMAND_REGISTRY, commandHelp } from "../../src/domain/commands/registry.ts";

export const EXIT_CODES = {
  ok: 0,
  usage: 2,
  domain: 3,
  internal: 1,
} as const;

type Invocation = {
  json: boolean;
  command: string | null;
  help: boolean;
  version: boolean;
};

export function parseInvocation(args: readonly string[]): Invocation {
  const json = args.includes("--json");
  const filtered = args.filter((arg) => arg !== "--json");
  return {
    json,
    command: filtered.find((arg) => !arg.startsWith("--")) ?? null,
    help: filtered.includes("--help") || filtered.length === 0,
    version: filtered.includes("--version"),
  };
}

export function runCli(args: readonly string[]): { output: string; error: string; exitCode: number } {
  const invocation = parseInvocation(args);
  if (invocation.version) {
    return { output: invocation.json ? JSON.stringify({ ok: true, version: CLI_VERSION }) : CLI_VERSION, error: "", exitCode: EXIT_CODES.ok };
  }
  if (invocation.help) {
    return {
      output: invocation.json ? JSON.stringify({ ok: true, command: "help", version: CLI_VERSION, commands: COMMAND_REGISTRY }) : commandHelp(),
      error: "",
      exitCode: EXIT_CODES.ok,
    };
  }
  if (invocation.command === "gate0.proof") {
    return {
      output: JSON.stringify({ ok: true, command: "gate0.proof", status: "available", version: CLI_VERSION }),
      error: "",
      exitCode: EXIT_CODES.ok,
    };
  }
  const error = { ok: false, error: { code: "UNKNOWN_COMMAND", message: "unknown command", exit_code: EXIT_CODES.usage } };
  return { output: invocation.json ? JSON.stringify(error) : "", error: invocation.json ? "" : "unknown command\n", exitCode: EXIT_CODES.usage };
}

if (import.meta.main) {
  const result = runCli(Bun.argv.slice(2));
  if (result.output) console.log(result.output);
  if (result.error) console.error(result.error);
  process.exitCode = result.exitCode;
}
