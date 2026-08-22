import { spawnSync, SQL } from "bun";

export type DatabaseType = "postgres" | "mysql";

export type DatabaseConfig = {
  type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  rootPassword?: string;
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

/**
 * This is the semantic matrix contract. The substrate below deliberately does
 * not implement these cases yet, so each dialect result remains BLOCKED until
 * a later writer supplies the actual proofs.
 */
export const REQUIRED_SEMANTIC_PROOF_IDS = [
  "MIG-001",
  "MIG-002",
  "MIG-003",
  "MIG-004",
  "SCOPE-001",
  "SCOPE-002",
  "POST-001",
  "POST-002",
  "POST-003",
  "POST-004",
  "IMM-001",
  "IMM-002",
  "IMM-003",
  "CON-001",
  "IDEM-001",
  "IDEM-002",
  "BIGINT-001",
] as const;

export const POSTGRES_IMAGE =
  "docker.io/library/postgres@sha256:e38411452a464af89e5adadb8d223bf53b898d47d6ef918b2d58c08707350449";
export const MYSQL_IMAGE =
  "docker.io/library/mysql@sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb";

export const MIGRATION_CHECKSUM_MISMATCH = "MIGRATION_CHECKSUM_MISMATCH" as const;
export const MIGRATION_DIRTY = "MIGRATION_DIRTY" as const;
export const MIGRATION_FAILED = "MIGRATION_FAILED" as const;

const REQUIRED_TABLES = [
  "schema_migrations",
  "tenants",
  "book_sets",
  "journal_entries",
  "postings",
  "audit_log",
  "idempotency_records",
] as const;
const REQUIRED_INITIAL_DRAFT_TRIGGER = "journal_entries_must_start_as_draft";
const STATEMENT_BREAKPOINT = /^[ \t]*-- statement-breakpoint[ \t]*(?:\r?\n|$)/gm;

export type MigrationDefinition = {
  logicalId: string;
  text: string;
  dialect: DatabaseType;
};

export type MigrationApplyResult = {
  logicalId: string;
  checksum: string;
  status: "APPLIED" | "NOOP";
  structuralVerification: StructuralVerification;
};

export type StructuralVerification = {
  tables: string[];
  triggers: string[];
  tableEngines: Record<string, string | null>;
};

export class MigrationContractError extends Error {
  readonly code: typeof MIGRATION_CHECKSUM_MISMATCH | typeof MIGRATION_DIRTY | typeof MIGRATION_FAILED;

  constructor(
    code: typeof MIGRATION_CHECKSUM_MISMATCH | typeof MIGRATION_DIRTY | typeof MIGRATION_FAILED,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "MigrationContractError";
    this.code = code;
  }
}

function generateTestCredentials(): { username: string; password: string; rootPassword: string } {
  const randomPassword = () =>
    crypto.getRandomValues(new Uint8Array(32)).reduce((value, byte) => value + byte.toString(16).padStart(2, "0"), "");

  return {
    username: `test_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    password: randomPassword(),
    rootPassword: randomPassword(),
  };
}

export function sanitizeError(error: unknown, secrets: readonly string[] = []): string {
  let message = String(error);
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("***");
  }
  return message
    .replace(/(password|passwd|pwd|secret|token)([=:])[\s"']*[^\s,"']+/gi, "$1$2***")
    .replace(/(MYSQL_ROOT_PASSWORD|POSTGRES_PASSWORD|MYSQL_PASSWORD)=\S+/gi, "$1=***");
}

function bytesToString(value: Uint8Array | string | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function docker(args: string[], secrets: readonly string[], action: string) {
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(["docker", ...args]);
  } catch (error) {
    throw new Error(`${action}: ${sanitizeError(error, secrets)}`);
  }
  if (!result.success) {
    const detail = bytesToString(result.stderr) || bytesToString(result.stdout) || "docker command failed";
    throw new Error(`${action}: ${sanitizeError(detail, secrets)}`);
  }
  return result;
}

function cleanupResource(containerName: string, networkName: string, networkCreated: boolean, containerStarted: boolean) {
  return async () => {
    if (containerStarted) {
      try {
        spawnSync(["docker", "rm", "-f", containerName]);
      } catch {
        // Cleanup is scoped to this exact generated container.
      }
    }
    if (networkCreated) {
      try {
        spawnSync(["docker", "network", "rm", networkName]);
      } catch {
        // Cleanup is scoped to this exact generated network.
      }
    }
  };
}

async function startDatabaseContainer(
  type: DatabaseType,
): Promise<{ config: DatabaseConfig; cleanup: () => Promise<void> }> {
  const runId = crypto.randomUUID();
  const containerName = `agent-bahi-${type}-${runId}`;
  const networkName = `agent-bahi-net-${runId}`;
  const creds = generateTestCredentials();
  const secrets = [creds.password, creds.rootPassword];
  const containerPort = type === "postgres" ? 5432 : 3306;
  const image = type === "postgres" ? POSTGRES_IMAGE : MYSQL_IMAGE;
  let networkCreated = false;
  let containerStarted = false;
  let startupSucceeded = false;

  try {
    docker(
      [
        "network",
        "create",
        "--label",
        `agent-bahi-run=${runId}`,
        "--label",
        "agent-bahi-purpose=gate0-integration",
        networkName,
      ],
      secrets,
      `create ${type} test network`,
    );
    networkCreated = true;

    const environment =
      type === "postgres"
        ? [
            `POSTGRES_USER=${creds.username}`,
            `POSTGRES_PASSWORD=${creds.password}`,
            "POSTGRES_DB=testdb",
          ]
        : [
            `MYSQL_USER=${creds.username}`,
            `MYSQL_PASSWORD=${creds.password}`,
            "MYSQL_DATABASE=testdb",
            `MYSQL_ROOT_PASSWORD=${creds.rootPassword}`,
          ];
    const healthCommand =
      type === "postgres"
        ? `pg_isready -U ${creds.username} -d testdb`
        : `mysqladmin ping -h 127.0.0.1 -u ${creds.username} -p${creds.password} --silent`;

    // Exact-name cleanup is safe even if docker creates the container before
    // reporting a startup failure.
    containerStarted = true;
    const runResult = docker(
      [
        "run",
        "--rm",
        "-d",
        "--name",
        containerName,
        "--network",
        networkName,
        "--label",
        `agent-bahi-run=${runId}`,
        "--label",
        "agent-bahi-purpose=gate0-integration",
        ...environment.flatMap((entry) => ["-e", entry]),
        "-p",
        `127.0.0.1::${containerPort}`,
        "--health-cmd",
        healthCommand,
        "--health-interval",
        "2s",
        "--health-timeout",
        "3s",
        "--health-retries",
        "10",
        image,
      ],
      secrets,
      `start ${type} test container`,
    );
    if (!bytesToString(runResult.stdout).trim()) {
      throw new Error(`start ${type} test container: docker returned no container ID`);
    }
    let healthStatus = "";
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const healthResult = docker(
        ["inspect", "--format={{.State.Health.Status}}", containerName],
        secrets,
        `inspect ${type} health`,
      );
      healthStatus = bytesToString(healthResult.stdout).trim();
      if (healthStatus === "healthy") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (healthStatus !== "healthy") {
      throw new Error(`${type} test container did not become healthy (status=${healthStatus || "unknown"})`);
    }

    const inspectResult = docker(
      ["inspect", "--format={{json .NetworkSettings.Ports}}", containerName],
      secrets,
      `inspect ${type} published port`,
    );
    const ports = JSON.parse(bytesToString(inspectResult.stdout)) as Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
    const binding = ports[`${containerPort}/tcp`]?.find((entry) => entry.HostIp === "127.0.0.1" || entry.HostIp === "0.0.0.0");
    const assignedPort = Number(binding?.HostPort);
    if (!Number.isInteger(assignedPort) || assignedPort < 1 || assignedPort > 65535) {
      throw new Error(`inspect ${type} published port: no valid assigned loopback port`);
    }

    const started = {
      config: {
        type,
        host: "127.0.0.1",
        port: assignedPort,
        username: creds.username,
        password: creds.password,
        ...(type === "mysql" ? { rootPassword: creds.rootPassword } : {}),
        database: "testdb",
        containerName,
        containerPort,
      },
      cleanup: cleanupResource(containerName, networkName, true, true),
    };
    startupSucceeded = true;
    return started;
  } catch (error) {
    throw new Error(sanitizeError(error, secrets));
  } finally {
    if (!startupSucceeded) {
      await cleanupResource(containerName, networkName, networkCreated, containerStarted)();
    }
  }
}

export function startPostgresContainer(_uniqueSuffix: string): Promise<{ config: DatabaseConfig; cleanup: () => Promise<void> }> {
  return startDatabaseContainer("postgres");
}

export function startMySQLContainer(_uniqueSuffix: string): Promise<{ config: DatabaseConfig; cleanup: () => Promise<void> }> {
  return startDatabaseContainer("mysql");
}

export function createBunSqlClient(config: DatabaseConfig): SQL {
  return new SQL({
    adapter: config.type,
    hostname: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
    bigint: true,
    connectionTimeout: 10,
  });
}

export function sha256MigrationText(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/** Split only on repository-owned boundaries; semicolons inside bodies are data. */
export function splitMigrationStatements(text: string): string[] {
  if (!STATEMENT_BREAKPOINT.test(text)) {
    throw new Error("migration has no statement-breakpoint boundaries");
  }
  STATEMENT_BREAKPOINT.lastIndex = 0;
  const statements = text
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  if (statements.length === 0 || statements.some((statement) => !statement.endsWith(";"))) {
    throw new Error("migration contains an incomplete statement boundary");
  }
  return statements;
}

async function bootstrapSchemaMigrations(sql: SQL, dialect: DatabaseType): Promise<void> {
  const ddl =
    dialect === "postgres"
      ? "CREATE TABLE IF NOT EXISTS schema_migrations (logical_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);"
      : "CREATE TABLE IF NOT EXISTS schema_migrations (logical_id VARCHAR(255) PRIMARY KEY, checksum VARCHAR(255) NOT NULL, applied_at VARCHAR(255) NOT NULL);";
  await sql.unsafe(ddl);
}

async function verifyRequiredStructure(sql: SQL, dialect: DatabaseType): Promise<StructuralVerification> {
  const tableRows =
    dialect === "postgres"
      ? await sql.unsafe<{ table_name: string; engine?: string | null }[]>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('schema_migrations', 'tenants', 'book_sets', 'journal_entries', 'postings', 'audit_log', 'idempotency_records')",
        )
      : await sql.unsafe<{ table_name: string; engine: string | null }[]>(
          "SELECT table_name, engine FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('schema_migrations', 'tenants', 'book_sets', 'journal_entries', 'postings', 'audit_log', 'idempotency_records')",
        );
  const triggerRows =
    dialect === "postgres"
      ? await sql.unsafe<{ trigger_name: string }[]>(
          "SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = current_schema() AND event_object_table = 'journal_entries' AND trigger_name = 'journal_entries_must_start_as_draft'",
        )
      : await sql.unsafe<{ trigger_name: string }[]>(
          "SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND event_object_table = 'journal_entries' AND trigger_name = 'journal_entries_must_start_as_draft'",
        );
  const tables = [...new Set(tableRows.map((row) => String(row.table_name)))];
  const triggers = [...new Set(triggerRows.map((row) => String(row.trigger_name)))];
  const tableEngines: Record<string, string | null> = {};
  if (dialect === "mysql") {
    for (const row of tableRows) tableEngines[String(row.table_name)] = row.engine ? String(row.engine) : null;
  }
  const missingTables = REQUIRED_TABLES.filter((table) => !tables.includes(table));
  const missingTriggers = triggers.includes(REQUIRED_INITIAL_DRAFT_TRIGGER) ? [] : [REQUIRED_INITIAL_DRAFT_TRIGGER];
  const nonInnoDbTables =
    dialect === "mysql"
      ? REQUIRED_TABLES.filter((table) => tableEngines[table]?.toUpperCase() !== "INNODB")
      : [];
  if (missingTables.length > 0 || missingTriggers.length > 0 || nonInnoDbTables.length > 0) {
    throw new MigrationContractError(
      MIGRATION_DIRTY,
      `required structure invalid; tables=${missingTables.join(",") || "none"}; triggers=${missingTriggers.join(",") || "none"}; non_innodb=${nonInnoDbTables.join(",") || "none"}`,
    );
  }
  return { tables, triggers, tableEngines };
}

export async function verifyMigrationStructure(sql: SQL, dialect: DatabaseType): Promise<StructuralVerification> {
  return verifyRequiredStructure(sql, dialect);
}

export async function applyMigration(sql: SQL, migration: MigrationDefinition): Promise<MigrationApplyResult> {
  const checksum = sha256MigrationText(migration.text);
  try {
    await bootstrapSchemaMigrations(sql, migration.dialect);
    const existing = await sql<{ checksum: string }[]>`SELECT checksum FROM schema_migrations WHERE logical_id = ${migration.logicalId}`;
    if (existing.length > 0) {
      if (String(existing[0].checksum) !== checksum) {
        throw new MigrationContractError(
          MIGRATION_CHECKSUM_MISMATCH,
          `logical_id=${migration.logicalId} has a different checksum`,
        );
      }
      const structuralVerification = await verifyRequiredStructure(sql, migration.dialect);
      return { logicalId: migration.logicalId, checksum, status: "NOOP", structuralVerification };
    }

    for (const statement of splitMigrationStatements(migration.text)) {
      await sql.unsafe(statement);
    }
    const structuralVerification = await verifyRequiredStructure(sql, migration.dialect);
    await sql`
      INSERT INTO schema_migrations (logical_id, checksum, applied_at)
      VALUES (${migration.logicalId}, ${checksum}, ${new Date().toISOString()})
    `;
    return { logicalId: migration.logicalId, checksum, status: "APPLIED", structuralVerification };
  } catch (error) {
    if (error instanceof MigrationContractError) throw error;
    throw new MigrationContractError(MIGRATION_DIRTY, `logical_id=${migration.logicalId}; ${sanitizeError(error)}`);
  }
}

export async function loadMigration(dialect: DatabaseType): Promise<MigrationDefinition> {
  const logicalId = `gate0-001-core-${dialect}`;
  const text = await Bun.file(`${import.meta.dir}/sql/${dialect}/001-core.sql`).text();
  return { logicalId, text, dialect };
}

function blockedSemanticResults(prefix: "PG" | "MY", dialectName: string): IntegrationTestResult[] {
  return REQUIRED_SEMANTIC_PROOF_IDS.map((proofId) => ({
    id: `${prefix}-${proofId}`,
    name: `${dialectName} ${proofId}`,
    status: "BLOCKED" as const,
    evidence: ["NOT YET IMPLEMENTED: semantic matrix is intentionally deferred beyond this substrate commit"],
  }));
}

export function blockedDialectResults(type: DatabaseType, reason: string): IntegrationTestResult[] {
  const prefix = type === "postgres" ? "PG" : "MY";
  const dialectName = type === "postgres" ? "PostgreSQL" : "MySQL";
  return [
    {
      id: `${prefix}-SUBSTRATE`,
      name: `${dialectName} Bun SQL substrate`,
      status: "BLOCKED",
      evidence: [sanitizeError(reason)],
      error: sanitizeError(reason),
    },
    ...blockedSemanticResults(prefix, dialectName),
  ];
}

export async function runDatabaseIntegrationTests(dbConfig: DatabaseConfig): Promise<IntegrationTestResult[]> {
  const prefix = dbConfig.type === "postgres" ? "PG" : "MY";
  const dialectName = dbConfig.type === "postgres" ? "PostgreSQL" : "MySQL";
  const results: IntegrationTestResult[] = [];
  let sql: SQL | null = null;
  try {
    sql = createBunSqlClient(dbConfig);
    await sql.connect();
    results.push({
      id: `${prefix}-SUBSTRATE-CONNECTION`,
      name: `${dialectName} Bun SQL connection`,
      status: "PASS",
      evidence: [`adapter=bun.sql`, `bigint=true`, `endpoint=${dbConfig.host}:${dbConfig.port}`],
    });
    const migration = await loadMigration(dbConfig.type);
    const firstApply = await applyMigration(sql, migration);
    const secondApply = await applyMigration(sql, migration);
    if (firstApply.status !== "APPLIED" || secondApply.status !== "NOOP") {
      throw new MigrationContractError(MIGRATION_FAILED, "fresh apply/no-op contract did not return expected states");
    }
    results.push({
      id: `${prefix}-SUBSTRATE-MIGRATION`,
      name: `${dialectName} Bun SQL migration contract`,
      status: "PASS",
      evidence: [
        `logical_id=${migration.logicalId}`,
        `checksum=${firstApply.checksum}`,
        "fresh=APPLIED",
        "same-id/same-checksum=NOOP",
        `tables=${firstApply.structuralVerification.tables.join(",")}`,
        `trigger=${REQUIRED_INITIAL_DRAFT_TRIGGER}`,
      ],
    });
  } catch (error) {
    const message = sanitizeError(error);
    results.push({
      id: `${prefix}-SUBSTRATE`,
      name: `${dialectName} Bun SQL substrate`,
      status: "BLOCKED",
      evidence: [message],
      error: message,
    });
  } finally {
    if (sql) {
      try {
        await sql.end({ timeout: 1 });
      } catch (error) {
        results.push({
          id: `${prefix}-SUBSTRATE-CLEANUP`,
          name: `${dialectName} Bun SQL cleanup`,
          status: "FAIL",
          evidence: [sanitizeError(error)],
          error: sanitizeError(error),
        });
      }
    }
  }
  results.push(...blockedSemanticResults(prefix, dialectName));
  return results;
}
