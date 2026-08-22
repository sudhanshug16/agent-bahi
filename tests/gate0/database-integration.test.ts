import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  REQUIRED_SEMANTIC_PROOF_IDS,
  blockedDialectResults,
  runDatabaseIntegrationTests,
  sanitizeError,
  startMySQLContainer,
  startPostgresContainer,
  type DatabaseConfig,
  type IntegrationTestResult,
} from "../../spikes/gate0/database-integration.ts";

function validateIntegrationResults(
  dialectName: string,
  prefix: "PG" | "MY",
  results: IntegrationTestResult[],
): void {
  const substrateResults = results.filter((result) => result.id.startsWith(`${prefix}-SUBSTRATE`));
  expect(substrateResults.length).toBeGreaterThan(0);
  expect(substrateResults.every((result) => result.status === "PASS")).toBe(true);

  const expectedIds = REQUIRED_SEMANTIC_PROOF_IDS.map((id) => `${prefix}-${id}`);
  const resultsById = new Map(results.map((result) => [result.id, result]));
  expect(expectedIds.every((id) => resultsById.has(id))).toBe(true);
  const semanticResults = expectedIds.map((id) => resultsById.get(id)!);

  // All semantic proofs should pass
  const failedSemantics = semanticResults.filter((result) => result.status !== "PASS");
  if (failedSemantics.length > 0) {
    throw new Error(
      `${dialectName} semantic proofs failed: ${failedSemantics
        .map((result) => `${result.id}=${result.status}:${result.error ?? result.evidence.join("|")}`)
        .join("; ")}`,
    );
  }
}

describe("Gate0 PostgreSQL integration contract", () => {
  let config: DatabaseConfig | null = null;
  let cleanup: (() => Promise<void>) | null = null;
  let results: IntegrationTestResult[] = [];

  beforeAll(async () => {
    try {
      const started = await startPostgresContainer(`test-${crypto.randomUUID()}`);
      config = started.config;
      cleanup = started.cleanup;
    } catch (error) {
      results = blockedDialectResults("postgres", `Docker/PostgreSQL startup unavailable: ${sanitizeError(error)}`);
    }
  });

  afterAll(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  test("runs the full semantic matrix and all proofs must pass", async () => {
    if (results.length === 0) {
      if (!config) throw new Error("PostgreSQL startup produced neither config nor structured BLOCKED result");
      results = await runDatabaseIntegrationTests(config);
    }
    validateIntegrationResults("PostgreSQL", "PG", results);
  }, { timeout: 120000 }); // 120s timeout for semantic matrix execution
});

describe("Gate0 MySQL integration contract", () => {
  let config: DatabaseConfig | null = null;
  let cleanup: (() => Promise<void>) | null = null;
  let results: IntegrationTestResult[] = [];

  beforeAll(async () => {
    try {
      const started = await startMySQLContainer(`test-${crypto.randomUUID()}`);
      config = started.config;
      cleanup = started.cleanup;
    } catch (error) {
      results = blockedDialectResults("mysql", `Docker/MySQL startup unavailable: ${sanitizeError(error)}`);
    }
  });

  afterAll(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  test("runs the full semantic matrix and all proofs must pass", async () => {
    if (results.length === 0) {
      if (!config) throw new Error("MySQL startup produced neither config nor structured BLOCKED result");
      results = await runDatabaseIntegrationTests(config);
    }
    validateIntegrationResults("MySQL", "MY", results);
  }, { timeout: 120000 }); // 120s timeout for semantic matrix execution
});
