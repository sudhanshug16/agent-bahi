import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
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
      throw new Error(`MySQL startup failed: ${sanitizeError(error)}`);
    }
  }, { timeout: 180000 });

  afterAll(async () => {
    if (cleanup) {
      await cleanup();
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
        throw new Error(`Bun SQL cleanup failed: ${sanitizeError(error)}`);
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
        throw new Error(`wrong-password client cleanup failed: ${sanitizeError(error)}`);
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
        throw new Error(`wrong-user client cleanup failed: ${sanitizeError(error)}`);
      }
    }

    // Connection must fail with wrong username
    expect(connectionFailed).toBe(true);
    // Error should indicate authentication failure
    expect(errorMessage).toMatch(/user|access|auth|denied|invalid/);
  });

  test("production health command succeeds with exact authenticated stdout", async () => {
    if (!config) {
      throw new Error("MySQL container must be available for health check verification");
    }

    const healthCommand = buildMySqlHealthCommand(config.username, config.password);
    const result = spawnSync(
      ["docker", "exec", config.containerName, "sh", "-lc", healthCommand],
      { timeout: 15000 },
    );
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout).trim()).toBe("1");
    expect(new TextDecoder().decode(result.stderr).trim()).toBe("");
  });

  test("production health command rejects wrong password and username", async () => {
    if (!config) {
      throw new Error("MySQL container must be available for health check verification");
    }

    const healthCommand = buildMySqlHealthCommand(config.username, config.password);
    const wrongPassword = spawnSync(
      ["docker", "exec", "-e", `MYSQL_PASSWORD=wrong_${crypto.randomUUID()}`, config.containerName, "sh", "-lc", healthCommand],
      { timeout: 15000 },
    );
    const wrongUser = spawnSync(
      ["docker", "exec", "-e", `MYSQL_USER=missing_${crypto.randomUUID()}`, config.containerName, "sh", "-lc", healthCommand],
      { timeout: 15000 },
    );
    expect(wrongPassword.exitCode).not.toBe(0);
    expect(wrongUser.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(wrongPassword.stdout).trim()).not.toBe("1");
    expect(new TextDecoder().decode(wrongUser.stdout).trim()).not.toBe("1");
  });
});
