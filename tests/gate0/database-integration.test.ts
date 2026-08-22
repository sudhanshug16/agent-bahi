import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  REQUIRED_SEMANTIC_PROOF_IDS,
  blockedDialectResults,
  emitIntegrationSummary,
  rollbackFailureDetail,
  runDatabaseIntegrationTests,
  sanitizeError,
  startMySQLContainer,
  startPostgresContainer,
  type DatabaseConfig,
  type IntegrationTestResult,
} from "../../spikes/gate0/database-integration.ts";

let postgresCompletedResolve!: () => void;
const postgresCompleted = new Promise<void>((resolve) => {
  postgresCompletedResolve = resolve;
});

function validateIntegrationResults(
  dialectName: string,
  prefix: "PG" | "MY",
  results: IntegrationTestResult[],
): void {
  const substrateResults = results.filter((result) => result.id.startsWith(`${prefix}-SUBSTRATE`));
  expect(substrateResults.length).toBeGreaterThan(0);
  const blocked = results.some((result) => result.id === `${prefix}-SUBSTRATE` && result.status === "BLOCKED");
  if (blocked) {
    expect(results.every((result) => result.status === "BLOCKED")).toBe(true);
    return;
  }
  expect(substrateResults.every((result) => result.status === "PASS")).toBe(true);

  const expectedIds = REQUIRED_SEMANTIC_PROOF_IDS.map((id) => `${prefix}-${id}`);
  const resultsById = new Map(results.map((result) => [result.id, result]));
  expect(expectedIds.every((id) => resultsById.has(id))).toBe(true);
  const semanticResults = expectedIds.map((id) => resultsById.get(id)!);

  expect(results.filter((result) => result.status === "FAIL")).toHaveLength(0);
  expect(new Set(results.map((result) => result.id)).size).toBe(results.length);
  const failedSemantics = semanticResults.filter((result) => result.status !== "PASS");
  if (failedSemantics.length > 0) {
    throw new Error(
      `${dialectName} semantic proofs failed: ${failedSemantics
        .map((result) => `${result.id}=${result.status}:${result.error ?? result.evidence.join("|")}`)
        .join("; ")}`,
    );
  }
}

test("rollback failure detail canonicalizes nested BigInt leftovers deterministically", () => {
  const failure = new Error("duplicate DDL");
  const leftovers = [
    {
      nested: {
        function_count: 9007199254740993n,
        table_count: 1n,
      },
      counts: [0n, { trigger_count: 2n }],
    },
  ];

  const detail = rollbackFailureDetail(failure, leftovers);

  expect(detail).toBe(
    'fresh-namespace rollback incomplete: failure=Error: duplicate DDL leftovers=[{"counts":["BIGINT:0",{"trigger_count":"BIGINT:2"}],"nested":{"function_count":"BIGINT:9007199254740993","table_count":"BIGINT:1"}}]',
  );
  expect(rollbackFailureDetail(failure, leftovers)).toBe(detail);
});

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
      emitIntegrationSummary("postgres", "unavailable-before-connection", results);
    }
  }, { timeout: 180000 });

  afterAll(async () => {
    try {
      if (cleanup) await cleanup();
    } finally {
      postgresCompletedResolve();
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
    // Docker startup is serialized so two large database images cannot race
    // the daemon and turn an otherwise available dialect into BLOCKED.
    await postgresCompleted;
    try {
      const started = await startMySQLContainer(`test-${crypto.randomUUID()}`);
      config = started.config;
      cleanup = started.cleanup;
    } catch (error) {
      results = blockedDialectResults("mysql", `Docker/MySQL startup unavailable: ${sanitizeError(error)}`);
      emitIntegrationSummary("mysql", "unavailable-before-connection", results);
    }
  }, { timeout: 180000 });

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
