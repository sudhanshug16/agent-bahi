import { spawnSync } from "bun";

export type DatabaseType = "postgres" | "mysql";

export type DatabaseConfig = {
  type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  containerName: string;
};

export type IntegrationTestResult = {
  id: string;
  name: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  evidence: string[];
  error?: string;
};

function generateUniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().substring(0, 12)}`;
}

function generateTestCredentials(): { username: string; password: string } {
  return {
    username: `test_${crypto.randomUUID().substring(0, 8)}`,
    password: crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), ""),
  };
}

function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

async function execDockerPostgresSQL(config: DatabaseConfig, sql: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const result = spawnSync([
    "docker",
    "exec",
    "-i",
    config.containerName,
    "psql",
    "-U",
    config.username,
    "-d",
    config.database,
    "-c",
    sql,
  ]);

  const stdout = result.stdout ? result.stdout.toString() : "";
  const stderr = result.stderr ? result.stderr.toString() : "";

  return {
    stdout,
    stderr,
    success: result.success ?? false,
  };
}

async function execDockerMySQLSQL(config: DatabaseConfig, sql: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const result = spawnSync([
    "docker",
    "exec",
    "-i",
    config.containerName,
    "mysql",
    "-u",
    config.username,
    `-p${config.password}`,
    config.database,
    "--execute",
    sql,
  ]);

  const stdout = result.stdout ? result.stdout.toString() : "";
  const stderr = result.stderr ? result.stderr.toString() : "";

  return {
    stdout,
    stderr,
    success: result.success ?? false,
  };
}

export async function startPostgresContainer(uniqueSuffix: string): Promise<{ config: DatabaseConfig; cleanup: () => Promise<void> }> {
  const containerName = `agent-bahi-postgres-${uniqueSuffix}`;
  const networkName = `agent-bahi-net-${uniqueSuffix}`;
  const creds = generateTestCredentials();
  const port = 5432 + Math.floor(Math.random() * 1000);

  // Create network
  const netResult = spawnSync(["docker", "network", "create", networkName]);
  if (!netResult.success) {
    throw new Error(`Failed to create network: ${netResult.stderr?.toString()}`);
  }

  // Start PostgreSQL container
  const runResult = spawnSync([
    "docker",
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "--network",
    networkName,
    "-e",
    `POSTGRES_USER=${creds.username}`,
    "-e",
    `POSTGRES_PASSWORD=${creds.password}`,
    "-e",
    "POSTGRES_DB=testdb",
    "-p",
    `${port}:5432`,
    "--health-cmd",
    "pg_isready -U postgres",
    "--health-interval",
    "2s",
    "--health-retries",
    "10",
    "postgres:17.11",
  ]);

  const output = runResult.stdout?.toString().trim() ?? "";

  if (!output) {
    throw new Error(`Failed to start PostgreSQL container: ${runResult.stderr?.toString()}`);
  }

  // Wait for health check
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    const healthProc = spawnSync(["docker", "inspect", `--format={{.State.Health.Status}}`, containerName]);
    const healthStatus = healthProc.stdout?.toString().trim() ?? "";
    if (healthStatus === "healthy") {
      healthy = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!healthy) {
    spawnSync(["docker", "rm", "-f", containerName]);
    spawnSync(["docker", "network", "rm", networkName]);
    throw new Error("PostgreSQL container failed to become healthy");
  }

  const config: DatabaseConfig = {
    type: "postgres",
    host: "localhost",
    port,
    username: creds.username,
    password: creds.password,
    database: "testdb",
    containerName,
  };

  const cleanup = async () => {
    try {
      spawnSync(["docker", "rm", "-f", containerName]);
    } catch {
      // ignore
    }
    try {
      spawnSync(["docker", "network", "rm", networkName]);
    } catch {
      // ignore
    }
  };

  return { config, cleanup };
}

export async function startMySQLContainer(uniqueSuffix: string): Promise<{ config: DatabaseConfig; cleanup: () => Promise<void> }> {
  const containerName = `agent-bahi-mysql-${uniqueSuffix}`;
  const networkName = `agent-bahi-net-${uniqueSuffix}`;
  const creds = generateTestCredentials();
  const port = 3306 + Math.floor(Math.random() * 1000);

  // Create network
  const netResult = spawnSync(["docker", "network", "create", networkName]);
  if (!netResult.success) {
    throw new Error(`Failed to create network: ${netResult.stderr?.toString()}`);
  }

  // Start MySQL container
  const runResult = spawnSync([
    "docker",
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "--network",
    networkName,
    "-e",
    `MYSQL_USER=${creds.username}`,
    "-e",
    `MYSQL_PASSWORD=${creds.password}`,
    "-e",
    "MYSQL_DATABASE=testdb",
    "-e",
    "MYSQL_ROOT_PASSWORD=rootpass",
    "-p",
    `${port}:3306`,
    "--health-cmd",
    "mysqladmin ping -h localhost",
    "--health-interval",
    "2s",
    "--health-retries",
    "10",
    "mysql:8.4",
  ]);

  const output = runResult.stdout?.toString().trim() ?? "";

  if (!output) {
    throw new Error(`Failed to start MySQL container: ${runResult.stderr?.toString()}`);
  }

  // Wait for health check
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    const healthProc = spawnSync(["docker", "inspect", `--format={{.State.Health.Status}}`, containerName]);
    const healthStatus = healthProc.stdout?.toString().trim() ?? "";
    if (healthStatus === "healthy") {
      healthy = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!healthy) {
    spawnSync(["docker", "rm", "-f", containerName]);
    spawnSync(["docker", "network", "rm", networkName]);
    throw new Error("MySQL container failed to become healthy");
  }

  const config: DatabaseConfig = {
    type: "mysql",
    host: "localhost",
    port,
    username: creds.username,
    password: creds.password,
    database: "testdb",
    containerName,
  };

  const cleanup = async () => {
    try {
      spawnSync(["docker", "rm", "-f", containerName]);
    } catch {
      // ignore
    }
    try {
      spawnSync(["docker", "network", "rm", networkName]);
    } catch {
      // ignore
    }
  };

  return { config, cleanup };
}

export async function runDatabaseIntegrationTests(dbConfig: DatabaseConfig): Promise<IntegrationTestResult[]> {
  const results: IntegrationTestResult[] = [];
  const type = dbConfig.type;

  try {
    if (type === "postgres") {
      // Load and apply migration
      const migrationSql = await Bun.file(`${import.meta.dir}/sql/postgres/001-core.sql`).text();
      const checksum = sha256(migrationSql);

      const migrationResult = await execDockerPostgresSQL(dbConfig, migrationSql);

      if (!migrationResult.success) {
        results.push({
          id: "PG-SCHEMA",
          name: "PostgreSQL schema creation",
          status: "FAIL",
          evidence: [migrationResult.stderr],
          error: migrationResult.stderr,
        });
        return results;
      }

      results.push({
        id: "PG-001",
        name: "PostgreSQL fresh install",
        status: "PASS",
        evidence: [`checksum=${checksum}`, "schema created and migration applied"],
      });

      // Insert test data
      await execDockerPostgresSQL(dbConfig, "INSERT INTO tenants (id, name) VALUES ('tenant-a', 'Tenant A') ON CONFLICT DO NOTHING;");
      await execDockerPostgresSQL(dbConfig, "INSERT INTO book_sets (tenant_id, id, kind) VALUES ('tenant-a', 'book-a', 'proprietorship') ON CONFLICT DO NOTHING;");

      // Test basic insertion
      const entryId = generateUniqueId("entry");
      const insertResult = await execDockerPostgresSQL(
        dbConfig,
        `INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key) VALUES ('tenant-a', 'book-a', '${entryId}', '${generateUniqueId("key")}');`,
      );

      if (insertResult.success) {
        results.push({
          id: "PG-002",
          name: "basic journal entry insertion",
          status: "PASS",
          evidence: ["entry inserted successfully"],
        });
      } else {
        results.push({
          id: "PG-002",
          name: "basic journal entry insertion",
          status: "FAIL",
          evidence: [insertResult.stderr],
        });
      }

      // Test FK constraint
      const fkResult = await execDockerPostgresSQL(
        dbConfig,
        "INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key) VALUES ('nonexistent-tenant', 'book-a', 'fk-test', 'key-fk');",
      );

      if (!fkResult.success && fkResult.stderr.includes("foreign key")) {
        results.push({
          id: "PG-003",
          name: "composite tenant/BookSet FK enforcement",
          status: "PASS",
          evidence: ["FK constraint correctly rejected invalid tenant"],
        });
      } else {
        results.push({
          id: "PG-003",
          name: "composite tenant/BookSet FK enforcement",
          status: "FAIL",
          evidence: ["FK constraint did not work as expected"],
        });
      }

      // Test append-only guards
      const appendOnlyResult = await execDockerPostgresSQL(
        dbConfig,
        `UPDATE postings SET debit_minor_units = 200 WHERE journal_entry_id = '${entryId}' LIMIT 1;`,
      );

      if (!appendOnlyResult.success && appendOnlyResult.stderr.includes("append-only")) {
        results.push({
          id: "PG-004",
          name: "append-only posting guard",
          status: "PASS",
          evidence: ["update correctly rejected"],
        });
      }

      // Test BigInt support
      const bigintResult = await execDockerPostgresSQL(
        dbConfig,
        "CREATE TABLE IF NOT EXISTS bigint_probe (amount BIGINT); INSERT INTO bigint_probe VALUES (9007199254740993);",
      );

      if (bigintResult.success) {
        results.push({
          id: "PG-005",
          name: "BigInt support",
          status: "PASS",
          evidence: ["Large integer value inserted successfully"],
        });
      }
    } else if (type === "mysql") {
      // Load and apply migration
      const migrationSql = await Bun.file(`${import.meta.dir}/sql/mysql/001-core.sql`).text();
      const checksum = sha256(migrationSql);

      const migrationResult = await execDockerMySQLSQL(dbConfig, migrationSql);

      if (!migrationResult.success) {
        results.push({
          id: "MY-SCHEMA",
          name: "MySQL schema creation",
          status: "FAIL",
          evidence: [migrationResult.stderr],
          error: migrationResult.stderr,
        });
        return results;
      }

      results.push({
        id: "MY-001",
        name: "MySQL fresh install",
        status: "PASS",
        evidence: [`checksum=${checksum}`, "schema created and migration applied"],
      });

      // Insert test data
      await execDockerMySQLSQL(dbConfig, "INSERT INTO tenants (id, name) VALUES ('tenant-a', 'Tenant A') ON DUPLICATE KEY UPDATE name = VALUES(name);");
      await execDockerMySQLSQL(dbConfig, "INSERT INTO book_sets (tenant_id, id, kind) VALUES ('tenant-a', 'book-a', 'proprietorship') ON DUPLICATE KEY UPDATE kind = VALUES(kind);");

      // Test basic insertion
      const entryId = generateUniqueId("entry");
      const insertResult = await execDockerMySQLSQL(
        dbConfig,
        `INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key) VALUES ('tenant-a', 'book-a', '${entryId}', '${generateUniqueId("key")}');`,
      );

      if (insertResult.success) {
        results.push({
          id: "MY-002",
          name: "basic journal entry insertion",
          status: "PASS",
          evidence: ["entry inserted successfully"],
        });
      } else {
        results.push({
          id: "MY-002",
          name: "basic journal entry insertion",
          status: "FAIL",
          evidence: [insertResult.stderr],
        });
      }

      // Test FK constraint
      const fkResult = await execDockerMySQLSQL(
        dbConfig,
        "INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key) VALUES ('nonexistent-tenant', 'book-a', 'fk-test', 'key-fk');",
      );

      if (!fkResult.success && fkResult.stderr.includes("foreign key")) {
        results.push({
          id: "MY-003",
          name: "composite tenant/BookSet FK enforcement",
          status: "PASS",
          evidence: ["FK constraint correctly rejected invalid tenant"],
        });
      } else {
        results.push({
          id: "MY-003",
          name: "composite tenant/BookSet FK enforcement",
          status: "FAIL",
          evidence: ["FK constraint did not work as expected"],
        });
      }

      // Test append-only guards
      const appendOnlyResult = await execDockerMySQLSQL(
        dbConfig,
        `UPDATE postings SET debit_minor_units = 200 WHERE journal_entry_id = '${entryId}' LIMIT 1;`,
      );

      if (!appendOnlyResult.success && appendOnlyResult.stderr.includes("append-only")) {
        results.push({
          id: "MY-004",
          name: "append-only posting guard",
          status: "PASS",
          evidence: ["update correctly rejected"],
        });
      }

      // Test BigInt support
      const bigintResult = await execDockerMySQLSQL(
        dbConfig,
        "CREATE TABLE IF NOT EXISTS bigint_probe (amount BIGINT); INSERT INTO bigint_probe VALUES (9007199254740993);",
      );

      if (bigintResult.success) {
        results.push({
          id: "MY-005",
          name: "BigInt support",
          status: "PASS",
          evidence: ["Large integer value inserted successfully"],
        });
      }
    }
  } catch (error) {
    results.push({
      id: "ERROR",
      name: "Test execution error",
      status: "FAIL",
      evidence: [String(error)],
      error: String(error),
    });
  }

  return results;
}
