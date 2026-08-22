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

function assertIntegrationCannotPass(
  dialectName: string,
  prefix: "PG" | "MY",
  results: IntegrationTestResult[],
): void {
  const substrateResults = results.filter((result) => result.id.startsWith(`${prefix}-SUBSTRATE`));
  expect(substrateResults.length).toBeGreaterThan(0);
  if (!substrateResults.every((result) => result.status === "PASS")) {
    throw new Error(
      `${dialectName} substrate BLOCKED/FAIL: ${substrateResults
        .filter((result) => result.status !== "PASS")
        .map((result) => `${result.id}=${result.status}:${result.error ?? result.evidence.join("|")}`)
        .join("; ")}`,
    );
  }

  const expectedIds = REQUIRED_SEMANTIC_PROOF_IDS.map((id) => `${prefix}-${id}`);
  const resultsById = new Map(results.map((result) => [result.id, result]));
  expect(expectedIds.every((id) => resultsById.has(id))).toBe(true);
  const semanticResults = expectedIds.map((id) => resultsById.get(id)!);
  expect(semanticResults.every((result) => result.status === "BLOCKED")).toBe(true);
  expect(
    semanticResults.every((result) => result.evidence.some((evidence) => evidence.includes("NOT YET IMPLEMENTED"))),
  ).toBe(true);
  throw new Error(`${dialectName} semantic matrix is NOT YET IMPLEMENTED; integration must remain nonzero`);
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

  test("starts once, runs once, cleans once, and cannot report a partial PASS", async () => {
    if (results.length === 0) {
      if (!config) throw new Error("PostgreSQL startup produced neither config nor structured BLOCKED result");
      results = await runDatabaseIntegrationTests(config);
    }
    assertIntegrationCannotPass("PostgreSQL", "PG", results);
  });
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

  test("starts once, runs once, cleans once, and cannot report a partial PASS", async () => {
    if (results.length === 0) {
      if (!config) throw new Error("MySQL startup produced neither config nor structured BLOCKED result");
      results = await runDatabaseIntegrationTests(config);
    }
    assertIntegrationCannotPass("MySQL", "MY", results);
  });
});
