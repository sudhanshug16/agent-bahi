import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  startPostgresContainer,
  startMySQLContainer,
  runDatabaseIntegrationTests,
  type DatabaseConfig,
  type IntegrationTestResult,
} from "../../spikes/gate0/database-integration.ts";

describe("Gate0 PostgreSQL Live Integration Tests", async () => {
  let pgConfig: DatabaseConfig | null = null;
  let pgCleanup: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    const uniqueSuffix = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    try {
      const { config, cleanup } = await startPostgresContainer(uniqueSuffix);
      pgConfig = config;
      pgCleanup = cleanup;
    } catch (error) {
      console.error("Failed to start PostgreSQL container:", error);
      throw error;
    }
  });

  afterAll(async () => {
    if (pgCleanup) {
      await pgCleanup();
    }
  });

  test("PostgreSQL database is running and accessible", async () => {
    expect(pgConfig).toBeTruthy();
    expect(pgConfig?.type).toBe("postgres");
    expect(pgConfig?.port).toBeGreaterThan(5432);
  });

  test("PostgreSQL fresh schema install with checksum validation", async () => {
    if (!pgConfig) throw new Error("PostgreSQL config not initialized");

    const results = await runDatabaseIntegrationTests(pgConfig);
    const schemaResult = results.find((r) => r.name.includes("fresh install"));

    expect(schemaResult).toBeTruthy();
    expect(schemaResult?.status).toBe("PASS");
    expect(schemaResult?.evidence.length).toBeGreaterThan(0);
  });

  test("PostgreSQL FK constraints enforce composite tenant/BookSet scope", async () => {
    if (!pgConfig) throw new Error("PostgreSQL config not initialized");

    const results = await runDatabaseIntegrationTests(pgConfig);
    const fkResult = results.find((r) => r.name.includes("FK enforcement"));

    expect(fkResult?.status).toBe("PASS");
  });

  test("PostgreSQL append-only guards prevent posting mutations", async () => {
    if (!pgConfig) throw new Error("PostgreSQL config not initialized");

    const results = await runDatabaseIntegrationTests(pgConfig);
    const appendOnlyResult = results.find((r) => r.name.includes("append-only"));

    expect(appendOnlyResult?.status).toBe("PASS");
  });

  test("PostgreSQL supports BigInt minor-unit values", async () => {
    if (!pgConfig) throw new Error("PostgreSQL config not initialized");

    const results = await runDatabaseIntegrationTests(pgConfig);
    const bigintResult = results.find((r) => r.name.includes("BigInt"));

    expect(bigintResult?.status).toBe("PASS");
  });
});

describe("Gate0 MySQL Live Integration Tests", async () => {
  let mysqlConfig: DatabaseConfig | null = null;
  let mysqlCleanup: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    const uniqueSuffix = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    try {
      const { config, cleanup } = await startMySQLContainer(uniqueSuffix);
      mysqlConfig = config;
      mysqlCleanup = cleanup;
    } catch (error) {
      console.error("Failed to start MySQL container:", error);
      throw error;
    }
  });

  afterAll(async () => {
    if (mysqlCleanup) {
      await mysqlCleanup();
    }
  });

  test("MySQL database is running and accessible", async () => {
    expect(mysqlConfig).toBeTruthy();
    expect(mysqlConfig?.type).toBe("mysql");
    expect(mysqlConfig?.port).toBeGreaterThan(3306);
  });

  test("MySQL fresh schema install with checksum validation", async () => {
    if (!mysqlConfig) throw new Error("MySQL config not initialized");

    const results = await runDatabaseIntegrationTests(mysqlConfig);
    const schemaResult = results.find((r) => r.name.includes("fresh install"));

    expect(schemaResult).toBeTruthy();
    expect(schemaResult?.status).toBe("PASS");
    expect(schemaResult?.evidence.length).toBeGreaterThan(0);
  });

  test("MySQL FK constraints enforce composite tenant/BookSet scope", async () => {
    if (!mysqlConfig) throw new Error("MySQL config not initialized");

    const results = await runDatabaseIntegrationTests(mysqlConfig);
    const fkResult = results.find((r) => r.name.includes("FK enforcement"));

    expect(fkResult?.status).toBe("PASS");
  });

  test("MySQL append-only guards prevent posting mutations", async () => {
    if (!mysqlConfig) throw new Error("MySQL config not initialized");

    const results = await runDatabaseIntegrationTests(mysqlConfig);
    const appendOnlyResult = results.find((r) => r.name.includes("append-only"));

    expect(appendOnlyResult?.status).toBe("PASS");
  });

  test("MySQL supports BigInt minor-unit values", async () => {
    if (!mysqlConfig) throw new Error("MySQL config not initialized");

    const results = await runDatabaseIntegrationTests(mysqlConfig);
    const bigintResult = results.find((r) => r.name.includes("BigInt"));

    expect(bigintResult?.status).toBe("PASS");
  });
});
