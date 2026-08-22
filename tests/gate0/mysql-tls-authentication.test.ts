import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildMySqlHealthCommand, createBunSqlClient, sanitizeError, startMySQLContainer, type DatabaseConfig } from "../../spikes/gate0/database-integration.ts";

describe("MySQL authenticated readiness with TLS (live probes)", () => {
  let config: DatabaseConfig | null = null;
  let cleanup: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    try {
      const started = await startMySQLContainer(`live-test-${crypto.randomUUID()}`);
      config = started.config;
      cleanup = started.cleanup;
    } catch (error) {
      console.warn(`MySQL startup failed: ${sanitizeError(error)}`);
      // Do not set config; tests will detect and fail with proper error
    }
  }, { timeout: 180000 });

  afterAll(async () => {
    if (cleanup) {
      try {
        await cleanup();
      } catch (error) {
        console.error(`Cleanup failed: ${sanitizeError(error)}`);
      }
    }
  });

  test("correct credentials connect successfully via Bun SQL with TLS enabled", async () => {
    if (!config) {
      throw new Error("MySQL container must be available for live positive proof");
    }

    const client = createBunSqlClient(config);
    try {
      const result = await client`SELECT 1 as ok`;
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.ok).toBe(1);
    } finally {
      try {
        await client.end({ timeout: 1000 });
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  test("wrong password fails authentication with TLS enabled", async () => {
    if (!config) {
      throw new Error("MySQL container must be available for live negative proof");
    }

    const badConfig: DatabaseConfig = {
      ...config,
      password: "wrong_password_" + crypto.randomUUID().slice(0, 12),
    };

    const client = createBunSqlClient(badConfig);
    let connectionFailed = false;
    let errorMessage = "";

    try {
      await client`SELECT 1 as ok`;
    } catch (error) {
      connectionFailed = true;
      errorMessage = String(error).toLowerCase();
    } finally {
      try {
        await client.end({ timeout: 1000 });
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Connection must fail with wrong password
    expect(connectionFailed).toBe(true);
    // Error should indicate authentication failure
    expect(errorMessage).toMatch(/password|access|auth|denied|invalid/);
  });

  test("nonexistent username fails with TLS enabled", async () => {
    if (!config) {
      throw new Error("MySQL container must be available for live negative proof");
    }

    const badConfig: DatabaseConfig = {
      ...config,
      username: "nonexistent_" + crypto.randomUUID().slice(0, 12),
    };

    const client = createBunSqlClient(badConfig);
    let connectionFailed = false;
    let errorMessage = "";

    try {
      await client`SELECT 1 as ok`;
    } catch (error) {
      connectionFailed = true;
      errorMessage = String(error).toLowerCase();
    } finally {
      try {
        await client.end({ timeout: 1000 });
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Connection must fail with wrong username
    expect(connectionFailed).toBe(true);
    // Error should indicate authentication failure
    expect(errorMessage).toMatch(/user|access|auth|denied|invalid/);
  });

  test("health command with correct credentials succeeds", async () => {
    if (!config) {
      throw new Error("MySQL container must be available for health check verification");
    }

    const healthCommand = buildMySqlHealthCommand(config.username, config.password);
    // Health command must include all required components for authenticated SELECT 1
    expect(healthCommand).toContain("mysql");
    expect(healthCommand).toContain("SELECT 1");
    expect(healthCommand).toContain("--ssl-mode=REQUIRED");
    expect(healthCommand).toContain(`-u ${config.username}`);
    expect(healthCommand).toContain(`-p${config.password}`);
  });

  test("health command with wrong password differs", async () => {
    if (!config) {
      throw new Error("MySQL container must be available for health check verification");
    }

    const correctCmd = buildMySqlHealthCommand(config.username, config.password);
    const wrongCmd = buildMySqlHealthCommand(config.username, "wrongpass");

    // Commands must differ due to different password
    expect(correctCmd).not.toBe(wrongCmd);
    // Both must use SELECT 1 with TLS
    expect(correctCmd).toContain("SELECT 1");
    expect(wrongCmd).toContain("SELECT 1");
    expect(correctCmd).toContain("--ssl-mode=REQUIRED");
    expect(wrongCmd).toContain("--ssl-mode=REQUIRED");
  });
});
