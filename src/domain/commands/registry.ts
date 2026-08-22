export const CLI_VERSION = "0.0.0-gate0";

export const COMMAND_REGISTRY = [
  {
    id: "gate0.proof",
    summary: "Run the local SQLite Gate0 proof harness",
    mutates: false,
    gstContext: "none",
  },
] as const;

export type RegisteredCommand = (typeof COMMAND_REGISTRY)[number];

export function commandHelp(): string {
  return [
    "agent-bahi — deterministic accounting CLI",
    "",
    "Usage:",
    "  agent-bahi [--json] gate0.proof",
    "  agent-bahi [--json] --help",
    "  agent-bahi --version",
    "",
    "Commands:",
    "  gate0.proof  Run the local SQLite Gate0 proof harness",
  ].join("\n");
}
