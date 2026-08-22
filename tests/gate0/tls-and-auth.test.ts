import { describe, expect, test } from "bun:test";
import { buildBunSqlConnectionOptions, buildMySqlHealthCommand, type DatabaseConfig } from "../../spikes/gate0/database-integration.ts";

describe("Bun SQL connection options builder", () => {
  test("MySQL connection options include ssl: true only", () => {
    const mysqlConfig: DatabaseConfig = {
      type: "mysql",
      host: "127.0.0.1",
      port: 3306,
      username: "test_user",
      password: "test_pass",
      database: "testdb",
      containerName: "test-mysql",
      containerPort: 3306,
    };

    const options = buildBunSqlConnectionOptions(mysqlConfig);
    expect(options.adapter).toBe("mysql");
    expect(options.ssl).toBe(true);
  });

  test("PostgreSQL connection options do not include ssl", () => {
    const postgresConfig: DatabaseConfig = {
      type: "postgres",
      host: "127.0.0.1",
      port: 5432,
      username: "test_user",
      password: "test_pass",
      database: "testdb",
      containerName: "test-postgres",
      containerPort: 5432,
    };

    const options = buildBunSqlConnectionOptions(postgresConfig);
    expect(options.adapter).toBe("postgres");
    expect(options.ssl).toBeUndefined();
  });
});

describe("MySQL health command builder", () => {
  test("health command uses authenticated mysql client with SELECT 1 and TLS required", () => {
    const username = "testuser";
    const password = "testpass123";
    const healthCommand = buildMySqlHealthCommand(username, password);

    // Must use mysql client (not mysqladmin)
    expect(healthCommand).toMatch(/^mysql\s/);

    // Must execute SELECT 1 (database-selecting proof)
    expect(healthCommand).toContain("SELECT 1");

    // Must require TLS (production-representative for caching_sha2_password)
    expect(healthCommand).toContain("--ssl-mode=REQUIRED");

    // Must use TCP protocol (not socket)
    expect(healthCommand).toContain("--protocol=TCP");

    // Must select testdb database
    expect(healthCommand).toContain("-D testdb");

    // Must use credentials with correct syntax (-p with no space)
    expect(healthCommand).toContain(`-u ${username}`);
    expect(healthCommand).toContain(`-p${password}`);

    // Must use non-interactive output flags (-Nse)
    expect(healthCommand).toContain("-Nse");
  });

  test("health command format is correct for mysql CLI", () => {
    const healthCommand = buildMySqlHealthCommand("user", "pass");

    // Expected format: mysql -h 127.0.0.1 --protocol=TCP -u user -ppass -D testdb -Nse "SELECT 1" --ssl-mode=REQUIRED
    expect(healthCommand).toContain("-h 127.0.0.1");
    expect(healthCommand).toContain("-u user");
    expect(healthCommand).toContain("-ppass");
    expect(healthCommand).toContain("-D testdb");
    expect(healthCommand).toContain("-Nse");
    expect(healthCommand).toContain('"SELECT 1"');
  });

  test("wrong credentials in health command produce different command", () => {
    const correctPassword = "correctpass";
    const wrongPassword = "wrongpass";

    const correctCmd = buildMySqlHealthCommand("user", correctPassword);
    const wrongCmd = buildMySqlHealthCommand("user", wrongPassword);

    // Commands must differ
    expect(correctCmd).not.toBe(wrongCmd);

    // Wrong password must appear in wrong command
    expect(wrongCmd).toContain(wrongPassword);
    expect(wrongCmd).not.toContain(correctPassword);

    // Both must use SELECT 1 with TLS required
    expect(correctCmd).toContain("SELECT 1");
    expect(wrongCmd).toContain("SELECT 1");
    expect(correctCmd).toContain("--ssl-mode=REQUIRED");
    expect(wrongCmd).toContain("--ssl-mode=REQUIRED");
  });
});
