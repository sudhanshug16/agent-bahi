import { describe, expect, test } from "bun:test";
import { EXIT_CODES, runCli } from "../../spikes/gate0/cli-smoke.ts";
import { runLocalSqliteProof } from "../../spikes/gate0/proof.ts";

describe("Gate0 local SQLite proofs", () => {
  test("all required local SQLite failure and success cases pass", async () => {
    const results = await runLocalSqliteProof();
    expect(results.length).toBeGreaterThanOrEqual(17);
    expect(results.every((result) => result.status === "PASS")).toBe(true);
    expect(results.map((result) => result.name)).toContain("rollback on imbalance");
    expect(results.map((result) => result.name)).toContain("migration mismatch refusal");
    expect(results.map((result) => result.name)).toContain("cross-BookSet posting rejection");
    expect(results.map((result) => result.name)).toContain("same-BookSet balanced posting success");
    expect(results.map((result) => result.name)).toContain("audit_log tenant FK rejection");
    expect(results.map((result) => result.name)).toContain("idempotency replay");
    expect(results.map((result) => result.name)).toContain("idempotency conflict detection");
  });
});

describe("domain-owned CLI registry smoke", () => {
  test("help, version, JSON success, and structured JSON error are deterministic", async () => {
    expect((await runCli(["--help"])).output).toContain("agent-bahi — deterministic accounting CLI");
    expect(await runCli(["--version"])).toEqual({ output: "0.0.0-gate0", error: "", exitCode: EXIT_CODES.ok });
    const proofResult = await runCli(["--json", "gate0.proof"]);
    expect(proofResult.error).toBe("");
    expect(proofResult.exitCode).toBe(EXIT_CODES.domain);
    const parsed = JSON.parse(proofResult.output);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("gate0.proof");
    expect(parsed.version).toBe("0.0.0-gate0");
    expect(parsed.results).toBeDefined();
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.some((r: any) => r.status === "PARTIAL")).toBe(true);
    expect(await runCli(["--json", "no.such.command"])).toEqual({
      output: JSON.stringify({ ok: false, error: { code: "UNKNOWN_COMMAND", message: "unknown command", exit_code: EXIT_CODES.usage } }),
      error: "",
      exitCode: EXIT_CODES.usage,
    });
  });
});
