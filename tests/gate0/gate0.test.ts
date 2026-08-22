import { describe, expect, test } from "bun:test";
import { EXIT_CODES, runCli } from "../../spikes/gate0/cli-smoke.ts";
import { runLocalSqliteProof } from "../../spikes/gate0/proof.ts";

describe("Gate0 local SQLite proofs", () => {
  test("all required local SQLite failure and success cases pass", async () => {
    const results = await runLocalSqliteProof();
    expect(results.length).toBeGreaterThanOrEqual(12);
    expect(results.every((result) => result.status === "PASS")).toBe(true);
    expect(results.map((result) => result.name)).toContain("rollback on imbalance");
    expect(results.map((result) => result.name)).toContain("migration mismatch refusal");
  });
});

describe("domain-owned CLI registry smoke", () => {
  test("help, version, JSON success, and structured JSON error are deterministic", () => {
    expect(runCli(["--help"]).output).toContain("agent-bahi — deterministic accounting CLI");
    expect(runCli(["--version"])).toEqual({ output: "0.0.0-gate0", error: "", exitCode: EXIT_CODES.ok });
    expect(runCli(["--json", "gate0.proof"])).toEqual({
      output: JSON.stringify({ ok: true, command: "gate0.proof", status: "available", version: "0.0.0-gate0" }),
      error: "",
      exitCode: EXIT_CODES.ok,
    });
    expect(runCli(["--json", "no.such.command"])).toEqual({
      output: JSON.stringify({ ok: false, error: { code: "UNKNOWN_COMMAND", message: "unknown command", exit_code: EXIT_CODES.usage } }),
      error: "",
      exitCode: EXIT_CODES.usage,
    });
  });
});
