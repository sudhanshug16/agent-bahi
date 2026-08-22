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
    expect(healthCommand).toMatch(/^MYSQL_PWD="\$MYSQL_PASSWORD" mysql\s/);

    // Must execute SELECT 1 (database-selecting proof)
    expect(healthCommand).toContain("SELECT 1");

    // Must require TLS (production-representative for caching_sha2_password)
    expect(healthCommand).toContain("--ssl-mode=REQUIRED");

    // Must use TCP protocol (not socket)
    expect(healthCommand).toContain("--protocol=TCP");

    // Credentials must come from the existing container environment, not
    // command-line literals visible to docker inspect.
    expect(healthCommand).toContain('-u "$MYSQL_USER"');
    expect(healthCommand).toContain('MYSQL_PWD="$MYSQL_PASSWORD"');
    expect(healthCommand).toContain('-D "$MYSQL_DATABASE"');
    expect(healthCommand).not.toContain(username);
    expect(healthCommand).not.toContain(password);

    // Must use non-interactive output flags (-Nse)
    expect(healthCommand).toContain("-Nse");
  });

  test("health command format is correct for mysql CLI", () => {
    const healthCommand = buildMySqlHealthCommand("user", "pass");

    // Expected format references the environment already present in the
    // container and remains safe for shell expansion.
    expect(healthCommand).toContain("-h 127.0.0.1");
    expect(healthCommand).toContain('-u "$MYSQL_USER"');
    expect(healthCommand).toContain('MYSQL_PWD="$MYSQL_PASSWORD"');
    expect(healthCommand).toContain('-D "$MYSQL_DATABASE"');
    expect(healthCommand).toContain("-Nse");
    expect(healthCommand).toContain('"SELECT 1"');
  });

  test("health command never embeds generated secrets", () => {
    const command = buildMySqlHealthCommand("generated_user", "generated_secret");
    expect(command).not.toContain("generated_user");
    expect(command).not.toContain("generated_secret");
  });
});
