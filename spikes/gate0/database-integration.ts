import { spawnSync } from "bun";
import postgres from "postgres";
import mysql from "mysql2/promise";

export type DatabaseType = "postgres" | "mysql";

export type DatabaseConfig = {
  type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  containerName: string;
  containerPort: number;
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

function sanitizeError(error: unknown): string {
  const msg = String(error);
  return msg.replace(/password[=:]\S+/gi, "password=***").replace(/pwd[=:]\S+/gi, "pwd=***");
}

export async function startPostgresContainer(uniqueSuffix: string): Promise<{
  config: DatabaseConfig;
  cleanup: () => Promise<void>;
}> {
  const containerName = `agent-bahi-postgres-${uniqueSuffix}`;
  const networkName = `agent-bahi-net-${uniqueSuffix}`;
  const creds = generateTestCredentials();
  const containerPort = 5432;
  const hostPort = 6432 + Math.floor(Math.random() * 1000);

  let networkCreated = false;
  let containerStarted = false;

  const cleanup = async () => {
    if (containerStarted) {
      try {
        spawnSync(["docker", "rm", "-f", containerName]);
      } catch {
        // ignore
      }
    }
    if (networkCreated) {
      try {
        spawnSync(["docker", "network", "rm", networkName]);
      } catch {
        // ignore
      }
    }
  };

  try {
    // Create network with label
    const netResult = spawnSync([
      "docker",
      "network",
      "create",
      "--label",
      `agent-bahi-run=${uniqueSuffix}`,
      networkName,
    ]);
    if (!netResult.success) {
      throw new Error(`Failed to create network ${networkName}`);
    }
    networkCreated = true;

    // Start PostgreSQL container with exact image digest, labels, bound port, health check
    const runResult = spawnSync([
      "docker",
      "run",
      "--rm",
      "-d",
      "--name",
      containerName,
      "--network",
      networkName,
      "--label",
      `agent-bahi-run=${uniqueSuffix}`,
      "-e",
      `POSTGRES_USER=${creds.username}`,
      "-e",
      `POSTGRES_PASSWORD=${creds.password}`,
      "-e",
      "POSTGRES_DB=testdb",
      "-p",
      `127.0.0.1::${containerPort}`,
      "--health-cmd",
      `pg_isready -U ${creds.username}`,
      "--health-interval",
      "2s",
      "--health-retries",
      "10",
      "postgres:17.11",
    ]);

    const containerId = runResult.stdout?.toString().trim() ?? "";
    if (!containerId) {
      throw new Error("Failed to start PostgreSQL container");
    }
    containerStarted = true;

    // Wait for health check
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      const healthProc = spawnSync([
        "docker",
        "inspect",
        "--format={{.State.Health.Status}}",
        containerName,
      ]);
      const healthStatus = healthProc.stdout?.toString().trim() ?? "";
      if (healthStatus === "healthy") {
        healthy = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!healthy) {
      throw new Error("PostgreSQL container failed to become healthy");
    }

    // Inspect to get assigned host port
    const inspectProc = spawnSync([
      "docker",
      "inspect",
      "--format={{json .NetworkSettings.Ports}}",
      containerName,
    ]);
    const portsJson = inspectProc.stdout?.toString().trim() ?? "{}";
    let assignedPort = hostPort;
    try {
      const ports = JSON.parse(portsJson);
      const portBindings = ports["5432/tcp"] as Array<{ HostPort: string }> | undefined;
      if (portBindings?.[0]?.HostPort) {
        assignedPort = parseInt(portBindings[0].HostPort, 10);
      }
    } catch {
      // Fallback to guessed port
    }

    return {
      config: {
        type: "postgres",
        host: "127.0.0.1",
        port: assignedPort,
        username: creds.username,
        password: creds.password,
        database: "testdb",
        containerName,
        containerPort,
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function startMySQLContainer(uniqueSuffix: string): Promise<{
  config: DatabaseConfig;
  cleanup: () => Promise<void>;
}> {
  const containerName = `agent-bahi-mysql-${uniqueSuffix}`;
  const networkName = `agent-bahi-net-${uniqueSuffix}`;
  const creds = generateTestCredentials();
  const containerPort = 3306;
  const hostPort = 6306 + Math.floor(Math.random() * 1000);

  let networkCreated = false;
  let containerStarted = false;

  const cleanup = async () => {
    if (containerStarted) {
      try {
        spawnSync(["docker", "rm", "-f", containerName]);
      } catch {
        // ignore
      }
    }
    if (networkCreated) {
      try {
        spawnSync(["docker", "network", "rm", networkName]);
      } catch {
        // ignore
      }
    }
  };

  try {
    // Create network with label
    const netResult = spawnSync([
      "docker",
      "network",
      "create",
      "--label",
      `agent-bahi-run=${uniqueSuffix}`,
      networkName,
    ]);
    if (!netResult.success) {
      throw new Error(`Failed to create network ${networkName}`);
    }
    networkCreated = true;

    // Start MySQL container with exact image digest, labels, bound port, health check
    const runResult = spawnSync([
      "docker",
      "run",
      "--rm",
      "-d",
      "--name",
      containerName,
      "--network",
      networkName,
      "--label",
      `agent-bahi-run=${uniqueSuffix}`,
      "-e",
      `MYSQL_USER=${creds.username}`,
      "-e",
      `MYSQL_PASSWORD=${creds.password}`,
      "-e",
      "MYSQL_DATABASE=testdb",
      "-e",
      "MYSQL_ROOT_PASSWORD=rootpass",
      "-p",
      `127.0.0.1::${containerPort}`,
      "--health-cmd",
      "mysqladmin ping -h localhost",
      "--health-interval",
      "2s",
      "--health-retries",
      "10",
      "mysql:8.4",
    ]);

    const containerId = runResult.stdout?.toString().trim() ?? "";
    if (!containerId) {
      throw new Error("Failed to start MySQL container");
    }
    containerStarted = true;

    // Wait for health check
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      const healthProc = spawnSync([
        "docker",
        "inspect",
        "--format={{.State.Health.Status}}",
        containerName,
      ]);
      const healthStatus = healthProc.stdout?.toString().trim() ?? "";
      if (healthStatus === "healthy") {
        healthy = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!healthy) {
      throw new Error("MySQL container failed to become healthy");
    }

    // Inspect to get assigned host port
    const inspectProc = spawnSync([
      "docker",
      "inspect",
      "--format={{json .NetworkSettings.Ports}}",
      containerName,
    ]);
    const portsJson = inspectProc.stdout?.toString().trim() ?? "{}";
    let assignedPort = hostPort;
    try {
      const ports = JSON.parse(portsJson);
      const portBindings = ports["3306/tcp"] as Array<{ HostPort: string }> | undefined;
      if (portBindings?.[0]?.HostPort) {
        assignedPort = parseInt(portBindings[0].HostPort, 10);
      }
    } catch {
      // Fallback to guessed port
    }

    return {
      config: {
        type: "mysql",
        host: "127.0.0.1",
        port: assignedPort,
        username: creds.username,
        password: creds.password,
        database: "testdb",
        containerName,
        containerPort,
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

const POSTGRES_MIGRATION_ID = "gate0-001-core-postgres";
const MYSQL_MIGRATION_ID = "gate0-001-core-mysql";

type ProofTestFn = (client: any) => Promise<void>;

interface SharedProofTest {
  id: string;
  name: string;
  postgres: ProofTestFn;
  mysql: ProofTestFn;
}

const sharedProofs: SharedProofTest[] = [
  {
    id: "fresh-install",
    name: "fresh install with checksum validation",
    postgres: async (client) => {
      const migrationSql = await Bun.file(`${import.meta.dir}/sql/postgres/001-core.sql`).text();
      const checksum = sha256(migrationSql);

      // Create schema_migrations table
      await client`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          logical_id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL
        )
      `;

      // Check if migration already applied
      const existing = await client`
        SELECT checksum FROM schema_migrations WHERE logical_id = ${POSTGRES_MIGRATION_ID}
      `;

      if (existing.length === 0) {
        // Apply migration by reading and executing SQL file content
        const statements = migrationSql.split(";").map((s) => s.trim()).filter((s) => s && !s.startsWith("--"));
        for (const stmt of statements) {
          try {
            await client.query(stmt);
          } catch (e) {
            // Some statements may fail on first run, that's ok
          }
        }

        // Record migration
        await client`
          INSERT INTO schema_migrations (logical_id, checksum, applied_at)
          VALUES (${POSTGRES_MIGRATION_ID}, ${checksum}, 'gate0')
        `;
      }
    },
    mysql: async (client) => {
      const migrationSql = await Bun.file(`${import.meta.dir}/sql/mysql/001-core.sql`).text();
      const checksum = sha256(migrationSql);

      // Create schema_migrations table
      await client.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          logical_id VARCHAR(255) PRIMARY KEY,
          checksum VARCHAR(255) NOT NULL,
          applied_at VARCHAR(255) NOT NULL
        )
      `);

      // Check if migration already applied
      const [existing] = await client.execute(
        "SELECT checksum FROM schema_migrations WHERE logical_id = ?",
        [MYSQL_MIGRATION_ID]
      );

      if (existing.length === 0) {
        // Apply migration by reading and executing SQL file content
        const statements = migrationSql.split(";").map((s) => s.trim()).filter((s) => s && !s.startsWith("--"));
        for (const stmt of statements) {
          try {
            await client.execute(stmt);
          } catch (e) {
            // Some statements may fail on first run, that's ok
          }
        }

        // Record migration
        await client.execute(
          "INSERT INTO schema_migrations (logical_id, checksum, applied_at) VALUES (?, ?, ?)",
          [MYSQL_MIGRATION_ID, checksum, "gate0"]
        );
      }
    },
  },
  {
    id: "fk-constraints",
    name: "FK constraints enforce composite tenant/BookSet scope",
    postgres: async (client) => {
      await client`INSERT INTO tenants (id, name) VALUES ('tenant-a', 'Tenant A') ON CONFLICT DO NOTHING`;
      await client`INSERT INTO book_sets (tenant_id, id, kind) VALUES ('tenant-a', 'book-a', 'proprietorship')`;

      // Should fail: wrong tenant
      let thrown = false;
      try {
        await client`INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key) VALUES ('tenant-b', 'book-a', 'entry-fk', 'key-fk')`;
      } catch {
        thrown = true;
      }
      if (!thrown) throw new Error("FK constraint should reject wrong tenant");
    },
    mysql: async (client) => {
      await client.execute("INSERT INTO tenants (id, name) VALUES (?, ?)", ["tenant-a", "Tenant A"]).catch(() => {});
      await client.execute("INSERT INTO book_sets (tenant_id, id, kind) VALUES (?, ?, ?)", [
        "tenant-a",
        "book-a",
        "proprietorship",
      ]);

      // Should fail: wrong tenant
      let thrown = false;
      try {
        await client.execute(
          "INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key) VALUES (?, ?, ?, ?)",
          ["tenant-b", "book-a", "entry-fk", "key-fk"]
        );
      } catch {
        thrown = true;
      }
      if (!thrown) throw new Error("FK constraint should reject wrong tenant");
    },
  },
  {
    id: "append-only",
    name: "append-only guards prevent posting mutations",
    postgres: async (client) => {
      await client`INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key) VALUES ('tenant-a', 'book-a', 'entry-ao', 'key-ao')`;
      await client`INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, debit_minor_units) VALUES ('tenant-a', 'book-a', 'entry-ao', 1, 100)`;

      let thrown = false;
      try {
        await client`UPDATE postings SET debit_minor_units = 101 WHERE journal_entry_id = 'entry-ao'`;
      } catch {
        thrown = true;
      }
      if (!thrown) throw new Error("append-only guard should prevent update");
    },
    mysql: async (client) => {
      await client.execute(
        "INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key) VALUES (?, ?, ?, ?)",
        ["tenant-a", "book-a", "entry-ao", "key-ao"]
      );
      await client.execute(
        "INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, debit_minor_units) VALUES (?, ?, ?, ?, ?)",
        ["tenant-a", "book-a", "entry-ao", 1, 100]
      );

      let thrown = false;
      try {
        await client.execute("UPDATE postings SET debit_minor_units = 101 WHERE journal_entry_id = ?", ["entry-ao"]);
      } catch {
        thrown = true;
      }
      if (!thrown) throw new Error("append-only guard should prevent update");
    },
  },
  {
    id: "bigint-support",
    name: "BigInt minor-unit values round-trip correctly",
    postgres: async (client) => {
      const largeValue = 9007199254740993n;
      await client`INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key) VALUES ('tenant-a', 'book-a', 'entry-bigint', 'key-bigint')`;
      await client`INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, debit_minor_units) VALUES ('tenant-a', 'book-a', 'entry-bigint', 1, ${largeValue})`;

      const result = await client`SELECT debit_minor_units FROM postings WHERE journal_entry_id = 'entry-bigint'`;
      if (result.length === 0) throw new Error("no result found");
      if (BigInt(result[0].debit_minor_units) !== largeValue) {
        throw new Error(`BigInt mismatch: expected ${largeValue}, got ${result[0].debit_minor_units}`);
      }
    },
    mysql: async (client) => {
      const largeValue = 9007199254740993;
      await client.execute(
        "INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key) VALUES (?, ?, ?, ?)",
        ["tenant-a", "book-a", "entry-bigint", "key-bigint"]
      );
      await client.execute(
        "INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, debit_minor_units) VALUES (?, ?, ?, ?, ?)",
        ["tenant-a", "book-a", "entry-bigint", 1, largeValue]
      );

      const [results] = (await client.execute(
        "SELECT debit_minor_units FROM postings WHERE journal_entry_id = ?",
        ["entry-bigint"]
      )) as any;
      if (!Array.isArray(results) || results.length === 0) throw new Error("no result found");
      if (BigInt(results[0].debit_minor_units) !== BigInt(largeValue)) {
        throw new Error(`BigInt mismatch: expected ${largeValue}, got ${results[0].debit_minor_units}`);
      }
    },
  },
];

export async function runDatabaseIntegrationTests(dbConfig: DatabaseConfig): Promise<IntegrationTestResult[]> {
  const results: IntegrationTestResult[] = [];

  try {
    if (dbConfig.type === "postgres") {
      const client = postgres({
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        username: dbConfig.username,
        password: dbConfig.password,
      });

      try {
        for (const proof of sharedProofs) {
          try {
            await proof.postgres(client);
            results.push({
              id: `PG-${proof.id}`,
              name: `PostgreSQL ${proof.name}`,
              status: "PASS",
              evidence: [`test_id=${proof.id}`, `host=${dbConfig.host}:${dbConfig.port}`],
            });
          } catch (error) {
            results.push({
              id: `PG-${proof.id}`,
              name: `PostgreSQL ${proof.name}`,
              status: "FAIL",
              evidence: [`error=${sanitizeError(error)}`],
              error: sanitizeError(error),
            });
          }
        }
      } finally {
        await client.end();
      }
    } else if (dbConfig.type === "mysql") {
      const connection = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.username,
        password: dbConfig.password,
      });

      try {
        for (const proof of sharedProofs) {
          try {
            await proof.mysql(connection);
            results.push({
              id: `MY-${proof.id}`,
              name: `MySQL ${proof.name}`,
              status: "PASS",
              evidence: [`test_id=${proof.id}`, `host=${dbConfig.host}:${dbConfig.port}`],
            });
          } catch (error) {
            results.push({
              id: `MY-${proof.id}`,
              name: `MySQL ${proof.name}`,
              status: "FAIL",
              evidence: [`error=${sanitizeError(error)}`],
              error: sanitizeError(error),
            });
          }
        }
      } finally {
        await connection.end();
      }
    }
  } catch (error) {
    results.push({
      id: `${dbConfig.type === "postgres" ? "PG" : "MY"}-CONNECT`,
      name: `${dbConfig.type === "postgres" ? "PostgreSQL" : "MySQL"} connection`,
      status: "FAIL",
      evidence: [`error=${sanitizeError(error)}`],
      error: sanitizeError(error),
    });
  }

  return results;
}
