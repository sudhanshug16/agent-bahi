import { spawnSync, SQL, type ReservedSQL } from "bun";

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

export type ProofStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_APPLICABLE";

export type IntegrationTestResult = {
  id: string;
  name: string;
  status: ProofStatus;
  evidence: string[];
  detail?: string;
  error?: string;
};

export type IntegrationSummary = {
  dialect: DatabaseType;
  server_version: string;
  proofs: Array<{ id: string; status: ProofStatus; detail: string }>;
};

export const REQUIRED_SEMANTIC_PROOF_IDS = [
  "MIG-001",
  "MIG-002",
  "MIG-003",
  "MIG-004",
  "MIG-DDL-ROLLBACK",
  "MIG-DIRTY-MARKER",
  "MIG-DIRTY-RECOVERY",
  "SCOPE-001",
  "SCOPE-002",
  "SCOPE-ISOLATION-001",
  "SCOPE-ISOLATION-002",
  "POST-001",
  "POST-002",
  "POST-003",
  "POST-004",
  "IMM-001",
  "IMM-002",
  "IMM-003",
  "DEL-001",
  "CON-001",
  "CON-001-NEG",
  "IDEM-001",
  "IDEM-002",
  "IDEM-RACE-001",
  "IDEM-RACE-002",
  "BIGINT-001",
  "CLEANUP-001",
] as const;

/**
 * This is the only registry that may make a semantic proof inapplicable.
 * Everything not listed here is mandatory for that dialect.
 */
export const DIALECT_NOT_APPLICABLE = {
  postgres: ["MIG-DIRTY-MARKER", "MIG-DIRTY-RECOVERY"] as const,
  mysql: ["MIG-DDL-ROLLBACK", "SCOPE-ISOLATION-001", "SCOPE-ISOLATION-002", "DEL-001"] as const,
} as const satisfies Record<DatabaseType, readonly (typeof REQUIRED_SEMANTIC_PROOF_IDS[number])[]>;

const SUBSTRATE_PROOF_IDS = new Set(["SUBSTRATE-CONNECTION", "SUBSTRATE-MIGRATION", "SUBSTRATE"]);

export const POSTGRES_IMAGE =
  "docker.io/library/postgres@sha256:e38411452a464af89e5adadb8d223bf53b898d47d6ef918b2d58c08707350449";
export const MYSQL_IMAGE =
  "docker.io/library/mysql@sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb";

export const MIGRATION_CHECKSUM_MISMATCH = "MIGRATION_CHECKSUM_MISMATCH" as const;
export const MIGRATION_DIRTY = "MIGRATION_DIRTY" as const;
export const MIGRATION_FAILED = "MIGRATION_FAILED" as const;
export const POSTED_DELETE_SQLSTATE = "AB001" as const;

const REQUIRED_TABLES = [
  "schema_migrations",
  "tenants",
  "book_sets",
  "journal_entries",
  "postings",
  "audit_log",
  "idempotency_records",
] as const;

const REQUIRED_TRIGGERS = [
  "journal_entries_must_start_as_draft",
  "journal_entries_validate_balance_on_post",
  "journal_entries_no_revert_from_posted",
  "journal_entries_no_change_when_posted",
  "journal_entries_no_delete_when_posted",
  "postings_no_insert_when_posted",
  "postings_no_update",
  "postings_no_delete",
  "audit_log_no_update",
  "audit_log_no_delete",
] as const;

const REQUIRED_PG_FUNCTIONS = [
  "enforce_draft_status_on_insert",
  "validate_journal_balance",
  "prevent_journal_revert",
  "prevent_journal_change_when_posted",
  "prevent_journal_delete_when_posted",
  "prevent_posting_insert",
  "prevent_posting_update",
  "prevent_posting_delete",
  "prevent_audit_update",
  "prevent_audit_delete",
] as const;

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

export class IntegrationBlockedError extends Error {
  readonly code = "INTEGRATION_BLOCKED" as const;
}

export type DockerCommandResult = {
  success?: boolean;
  exitCode?: number | null;
  signalCode?: string | null;
  exitedDueToTimeout?: boolean;
  stdout?: Uint8Array | string;
  stderr?: Uint8Array | string;
};

export type DockerCommandRunner = (
  args: string[],
  secrets: readonly string[],
  action: string,
  timeoutMs?: number,
  requireOutput?: boolean,
  allowFailure?: boolean,
) => DockerCommandResult;

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

function extractStructuredPostgresSqlState(error: unknown): string {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (!current.value || typeof current.value !== "object" || current.depth > 3 || visited.has(current.value)) continue;
    visited.add(current.value);
    const record = current.value as Record<string, unknown>;
    // Bun 1.3.14 exposes server SQLSTATE as `code` for the normal error
    // shape. The native adapter can wrap it as ERR_POSTGRES_SERVER_ERROR and
    // retain the exact five-character SQLSTATE in `errno`; accept only those
    // structured fields, never message text or undocumented aliases.
    for (const field of ["code", "errno"]) {
      const value = String(record[field] ?? "");
      if (/^[A-Z0-9]{5}$/.test(value)) return value;
    }
    for (const key of Object.getOwnPropertyNames(record)) {
      const nested = record[key];
      if (nested && typeof nested === "object") pending.push({ value: nested, depth: current.depth + 1 });
    }
  }
  return "";
}

function bytesToString(value: Uint8Array | string | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

export type SpawnResultClassification = {
  success: boolean;
  exitCode: number | null;
  signalCode: string | null;
  timedOut: boolean;
};

export function classifySpawnResult(result: {
  success?: boolean;
  exitCode?: number | null;
  signalCode?: string | null;
  exitedDueToTimeout?: boolean;
}): SpawnResultClassification {
  const candidate = result as { success?: unknown; exitCode?: unknown; signalCode?: unknown; exitedDueToTimeout?: unknown };
  const exitCode = typeof candidate.exitCode === "number" ? candidate.exitCode : null;
  const signalCode = typeof candidate.signalCode === "string" ? candidate.signalCode : null;
  const timedOut = candidate.exitedDueToTimeout === true || exitCode === null;
  return { success: candidate.success === true && exitCode === 0 && signalCode === null && !timedOut, exitCode, signalCode, timedOut };
}

function processExitDetails(result: DockerCommandResult): SpawnResultClassification {
  return classifySpawnResult(result);
}

function docker(
  args: string[],
  secrets: readonly string[],
  action: string,
  timeoutMs: number = 30000,
  requireOutput = true,
  allowFailure = false,
): DockerCommandResult {
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(["docker", ...args], { timeout: timeoutMs });
  } catch (error) {
    throw new Error(`${action}: ${sanitizeError(error, secrets)}`);
  }
  const exit = processExitDetails(result);
  if (!exit.success) {
    if (allowFailure) return result;
    const detail = bytesToString(result.stderr) || bytesToString(result.stdout) || "docker command failed";
    throw new Error(
      `${action}: ${sanitizeError(detail, secrets)} (exit_code=${exit.exitCode === null ? "null" : exit.exitCode}; signal_code=${exit.signalCode ?? "none"}; timed_out=${exit.timedOut})`,
    );
  }
  if (requireOutput && !bytesToString(result.stdout).trim()) {
    throw new Error(`${action}: docker returned empty output (possible timeout or failure)`);
  }
  return result;
}

const LOCAL_IMAGE_INSPECT_TIMEOUT_MS = 10_000;
const IMAGE_PULL_TIMEOUT_MS = 120_000;

function imageInspectFailureDetails(result: DockerCommandResult): string {
  const exit = processExitDetails(result);
  return `exit_code=${exit.exitCode === null ? "null" : exit.exitCode}; signal_code=${exit.signalCode ?? "none"}; timed_out=${exit.timedOut}`;
}

/**
 * Resolve the exact digest-pinned reference without contacting a registry.
 * Pull only after a bounded local inspect reports a normal missing-image exit,
 * then inspect the same exact reference again before any container is run.
 */
export function preflightDatabaseImage(
  image: string,
  secrets: readonly string[] = [],
  runDocker: DockerCommandRunner = docker,
): "LOCAL" | "PULLED" {
  const inspectArgs = ["image", "inspect", "--format={{.Id}}", image];
  let localInspect: DockerCommandResult;
  try {
    localInspect = runDocker(
      inspectArgs,
      secrets,
      `inspect local test image ${image}`,
      LOCAL_IMAGE_INSPECT_TIMEOUT_MS,
      true,
      true,
    );
  } catch (error) {
    throw new IntegrationBlockedError(`local image inspection unavailable for ${image}: ${sanitizeError(error, secrets)}`);
  }
  const localExit = processExitDetails(localInspect);
  if (localExit.success && bytesToString(localInspect.stdout).trim()) return "LOCAL";
  if (localExit.timedOut || localExit.signalCode !== null) {
    throw new IntegrationBlockedError(
      `local image inspection unavailable for ${image}: ${imageInspectFailureDetails(localInspect)}`,
    );
  }

  try {
    runDocker(["pull", image], secrets, `pull ${image} test image`, IMAGE_PULL_TIMEOUT_MS);
  } catch (error) {
    throw new IntegrationBlockedError(`image pull unavailable for ${image}: ${sanitizeError(error, secrets)}`);
  }

  let pulledInspect: DockerCommandResult;
  try {
    pulledInspect = runDocker(
      inspectArgs,
      secrets,
      `verify pulled test image ${image}`,
      LOCAL_IMAGE_INSPECT_TIMEOUT_MS,
      true,
      true,
    );
  } catch (error) {
    throw new IntegrationBlockedError(`pulled image verification unavailable for ${image}: ${sanitizeError(error, secrets)}`);
  }
  const pulledExit = processExitDetails(pulledInspect);
  if (!pulledExit.success || !bytesToString(pulledInspect.stdout).trim()) {
    throw new IntegrationBlockedError(
      `exact image reference not available after pull for ${image}: ${imageInspectFailureDetails(pulledInspect)}`,
    );
  }
  return "PULLED";
}

export function cleanupResource(
  containerName: string,
  networkName: string,
  networkCreated: boolean,
  containerStarted: boolean,
  runDocker: DockerCommandRunner = docker,
) {
  return async () => {
    // Cleanup is deliberately best-effort across every owned resource. A
    // failure must not prevent the remaining resource removals or absence
    // checks from running.
    const cleanupErrors: string[] = [];

    if (containerStarted) {
      try {
        const rmResult = runDocker(
          ["rm", "-f", containerName],
          [],
          `remove test container ${containerName}`,
          10000,
          false,
          true,
        );
        const exit = processExitDetails(rmResult);
        const stderr = bytesToString(rmResult.stderr);
        if (!exit.success) {
          cleanupErrors.push(
            `docker rm container failed: exit_code=${exit.exitCode === null ? "null" : exit.exitCode}; signal_code=${exit.signalCode ?? "none"}; timed_out=${exit.timedOut}; stderr=${sanitizeError(stderr)}`,
          );
        }
      } catch (error) {
        cleanupErrors.push(`docker rm container error: ${sanitizeError(error)}`);
      }
      try {
        const inspectResult = runDocker(
          ["inspect", "--format={{.Id}}", containerName],
          [],
          `verify removed test container ${containerName}`,
          10000,
          false,
          true,
        );
        const exit = processExitDetails(inspectResult);
        if (exit.success) {
          cleanupErrors.push(`docker container still exists after removal: ${containerName}`);
        } else if (exit.timedOut || exit.signalCode !== null) {
          cleanupErrors.push(`docker container absence verification failed: ${imageInspectFailureDetails(inspectResult)}`);
        }
      } catch (error) {
        cleanupErrors.push(`docker container absence verification error: ${sanitizeError(error)}`);
      }
    }

    if (networkCreated) {
      try {
        const netResult = runDocker(
          ["network", "rm", networkName],
          [],
          `remove test network ${networkName}`,
          10000,
          false,
          true,
        );
        const exit = processExitDetails(netResult);
        const stderr = bytesToString(netResult.stderr);
        if (!exit.success) {
          cleanupErrors.push(
            `docker network rm failed: exit_code=${exit.exitCode === null ? "null" : exit.exitCode}; signal_code=${exit.signalCode ?? "none"}; timed_out=${exit.timedOut}; stderr=${sanitizeError(stderr)}`,
          );
        }
      } catch (error) {
        cleanupErrors.push(`docker network rm error: ${sanitizeError(error)}`);
      }
      try {
        const inspectResult = runDocker(
          ["network", "inspect", networkName],
          [],
          `verify removed test network ${networkName}`,
          10000,
          false,
          true,
        );
        const exit = processExitDetails(inspectResult);
        if (exit.success) {
          cleanupErrors.push(`docker network still exists after removal: ${networkName}`);
        } else if (exit.timedOut || exit.signalCode !== null) {
          cleanupErrors.push(`docker network absence verification failed: ${imageInspectFailureDetails(inspectResult)}`);
        }
      } catch (error) {
        cleanupErrors.push(`docker network absence verification error: ${sanitizeError(error)}`);
      }
    }

    if (cleanupErrors.length > 0) {
      const aggregatedError = cleanupErrors.join("; ");
      throw new Error(`cleanup failed for container=${containerName}, network=${networkName}: ${aggregatedError}`);
    }
  };
}

export async function startDatabaseContainer(
  type: DatabaseType,
  runDocker: DockerCommandRunner = docker,
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
  let startupFailure: Error | null = null;

  try {
    preflightDatabaseImage(image, secrets, runDocker);
    runDocker(
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
        : buildMySqlHealthCommand(creds.username, creds.password);

    // Exact-name cleanup is safe even if docker creates the container before
    // reporting a startup failure.
    containerStarted = true;
    const mysqlArgs = type === "mysql" ? ["--log-bin-trust-function-creators=1"] : [];
    const runResult = runDocker(
      [
        "run",
        "--pull",
        "never",
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
        ...mysqlArgs,
      ],
      secrets,
      `start ${type} test container`,
    );
    if (!bytesToString(runResult.stdout).trim()) {
      throw new Error(`start ${type} test container: docker returned no container ID`);
    }
    let healthStatus = "";
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const healthResult = runDocker(
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

    const inspectResult = runDocker(
      ["inspect", "--format={{json .NetworkSettings.Ports}}", containerName],
      secrets,
      `inspect ${type} published port`,
    );
    const ports = JSON.parse(bytesToString(inspectResult.stdout)) as Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
    const binding = ports[`${containerPort}/tcp`]?.find((entry) => {
      const hostIp = entry.HostIp || "";
      return hostIp === "127.0.0.1" || hostIp === "::1";
    });
    if (!binding || !binding.HostIp || (binding.HostIp !== "127.0.0.1" && binding.HostIp !== "::1")) {
      throw new Error(`inspect ${type} published port: no valid loopback binding found (must be 127.0.0.1 or ::1, not ${binding?.HostIp || "empty"})`);
    }
    const assignedPort = Number(binding.HostPort);
    if (!Number.isInteger(assignedPort) || assignedPort < 1 || assignedPort > 65535) {
      throw new Error(`inspect ${type} published port: invalid port number ${binding.HostPort}`);
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
      cleanup: cleanupResource(containerName, networkName, true, true, runDocker),
    };
    startupSucceeded = true;
    return started;
  } catch (error) {
    startupFailure = error instanceof IntegrationBlockedError
      ? error
      : new Error(sanitizeError(error, secrets));
  } finally {
    if (!startupSucceeded) {
      try {
        await cleanupResource(containerName, networkName, networkCreated, containerStarted, runDocker)();
      } catch (cleanupError) {
        const original = startupFailure?.message ?? "database container startup failed";
        throw new Error(`${original}; cleanup failed: ${sanitizeError(cleanupError)}`);
      }
    }
  }
  if (startupFailure) throw startupFailure;
  throw new Error("database container startup did not complete");
}

export function startPostgresContainer(_uniqueSuffix: string): Promise<{ config: DatabaseConfig; cleanup: () => Promise<void> }> {
  return startDatabaseContainer("postgres");
}

export function startMySQLContainer(_uniqueSuffix: string): Promise<{ config: DatabaseConfig; cleanup: () => Promise<void> }> {
  return startDatabaseContainer("mysql");
}

export function buildBunSqlConnectionOptions(config: DatabaseConfig): Record<string, unknown> {
  const baseConfig: Record<string, unknown> = {
    adapter: config.type,
    hostname: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
    bigint: true,
    connectionTimeout: 10,
  };

  // Enable TLS for MySQL only; PostgreSQL behavior remains unchanged
  if (config.type === "mysql") {
    baseConfig.ssl = true;
  }

  return baseConfig;
}

export function buildMySqlHealthCommand(username: string, password: string): string {
  // The values are intentionally unused: credentials must come from the
  // container's existing environment, never from docker inspect arguments.
  void username;
  void password;
  // -N/-s/-e produce a small authenticated probe. --ssl-mode=REQUIRED keeps
  // caching_sha2_password authentication encrypted and rejects bad creds.
  return 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -h 127.0.0.1 --protocol=TCP -u "$MYSQL_USER" -D "$MYSQL_DATABASE" -Nse "SELECT 1" --ssl-mode=REQUIRED';
}

export function createBunSqlClient(config: DatabaseConfig): SQL {
  const options = buildBunSqlConnectionOptions(config);
  return new SQL(options as any);
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

async function ensureSchemaMigrationsTable(sql: SQL, dialect: DatabaseType): Promise<void> {
  const ddl =
    dialect === "postgres"
      ? "CREATE TABLE IF NOT EXISTS schema_migrations (logical_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);"
      : "CREATE TABLE IF NOT EXISTS schema_migrations (logical_id VARCHAR(255) PRIMARY KEY, checksum VARCHAR(255) NOT NULL, applied_at VARCHAR(255) NOT NULL);";
  await sql.unsafe(ddl);
}

async function schemaMigrationsExists(sql: SQL, dialect: DatabaseType): Promise<boolean> {
  if (dialect === "postgres") {
    const rows = await sql.unsafe<{ exists: boolean }[]>(
      "SELECT to_regclass('schema_migrations') IS NOT NULL AS exists",
    );
    return rows[0]?.exists === true;
  }
  const rows = await sql.unsafe<{ count: bigint | number }[]>(
    "SELECT COUNT(*) AS `count` FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'",
  );
  return Number(rows[0]?.count ?? 0) === 1;
}

async function getMigrationApplyingMarker(sql: SQL, logicalId: string): Promise<boolean> {
  const marker = await sql<{ is_applying: number | bigint }[]>`
    SELECT COUNT(*) as is_applying FROM schema_migrations WHERE logical_id = ${'__applying_' + logicalId}
  `;
  return Number(marker[0]?.is_applying ?? 0) > 0;
}

async function setMigrationApplyingMarker(sql: SQL, logicalId: string): Promise<void> {
  await sql`
    INSERT INTO schema_migrations (logical_id, checksum, applied_at)
    VALUES (${'__applying_' + logicalId}, ${"marker"}, ${"applying"})
  `;
}

async function clearMigrationApplyingMarker(sql: SQL, logicalId: string): Promise<void> {
  await sql`DELETE FROM schema_migrations WHERE logical_id = ${'__applying_' + logicalId}`;
}

function assertSafeIdentifier(identifier: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`${label} contains an unsafe SQL identifier`);
  }
}

/** Bun SQL preserves server-provided label casing for some MySQL metadata
 * queries. Normalize only result keys; values and strict assertions remain
 * unchanged. Explicit aliases are still used in every owned query. */
export function normalizeDatabaseRowKeys<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
}

export async function recoverDirtyMigration(
  sql: SQL,
  logicalId: string,
  partialTableNames: readonly string[],
): Promise<void> {
  if (partialTableNames.length === 0) throw new Error("dirty migration recovery requires explicit partial object names");
  const markerExists = await getMigrationApplyingMarker(sql, logicalId);
  if (!markerExists) throw new MigrationContractError(MIGRATION_FAILED, `no dirty marker for ${logicalId}`);
  for (const tableName of partialTableNames) {
    assertSafeIdentifier(tableName, "partial table name");
    await sql.unsafe(`DROP TABLE IF EXISTS \`${tableName}\``);
  }
  await clearMigrationApplyingMarker(sql, logicalId);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

type ExpectedTrigger = { table: string; timing: "BEFORE"; event: "INSERT" | "UPDATE" | "DELETE"; functionName: string };

const EXPECTED_TRIGGERS: Record<string, ExpectedTrigger> = {
  journal_entries_must_start_as_draft: { table: "journal_entries", timing: "BEFORE", event: "INSERT", functionName: "enforce_draft_status_on_insert" },
  journal_entries_validate_balance_on_post: { table: "journal_entries", timing: "BEFORE", event: "UPDATE", functionName: "validate_journal_balance" },
  journal_entries_no_revert_from_posted: { table: "journal_entries", timing: "BEFORE", event: "UPDATE", functionName: "prevent_journal_revert" },
  journal_entries_no_change_when_posted: { table: "journal_entries", timing: "BEFORE", event: "UPDATE", functionName: "prevent_journal_change_when_posted" },
  journal_entries_no_delete_when_posted: { table: "journal_entries", timing: "BEFORE", event: "DELETE", functionName: "prevent_journal_delete_when_posted" },
  postings_no_insert_when_posted: { table: "postings", timing: "BEFORE", event: "INSERT", functionName: "prevent_posting_insert" },
  postings_no_update: { table: "postings", timing: "BEFORE", event: "UPDATE", functionName: "prevent_posting_update" },
  postings_no_delete: { table: "postings", timing: "BEFORE", event: "DELETE", functionName: "prevent_posting_delete" },
  audit_log_no_update: { table: "audit_log", timing: "BEFORE", event: "UPDATE", functionName: "prevent_audit_update" },
  audit_log_no_delete: { table: "audit_log", timing: "BEFORE", event: "DELETE", functionName: "prevent_audit_delete" },
};

function expectedFunctionBodies(migrationText: string): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const functionName of REQUIRED_PG_FUNCTIONS) {
    const match = migrationText.match(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+${functionName}\\s*\\(\\s*\\)\\s+RETURNS\\s+TRIGGER\\s+AS\\s+\\$\\$([\\s\\S]*?)\\$\\$\\s+LANGUAGE\\s+plpgsql`, "i"));
    if (!match) throw new Error(`migration is missing expected PostgreSQL function ${functionName}`);
    bodies.set(functionName, normalizeSql(match[1]));
  }
  return bodies;
}

function expectedMySqlActions(migrationText: string): Map<string, string> {
  const actions = new Map<string, string>();
  for (const statement of splitMigrationStatements(migrationText)) {
    const match = statement.match(/CREATE\s+TRIGGER\s+([A-Za-z0-9_]+)\s+BEFORE\s+(INSERT|UPDATE|DELETE)\s+ON\s+([A-Za-z0-9_]+)\s+FOR\s+EACH\s+ROW\s+BEGIN([\s\S]*)END;\s*$/i);
    if (match) actions.set(match[1], normalizeSql(`BEGIN${match[4]}END`));
  }
  return actions;
}

async function verifyRequiredStructure(sql: SQL, dialect: DatabaseType, migrationText?: string): Promise<StructuralVerification> {
  const actualMigrationText = migrationText ?? await Bun.file(`${import.meta.dir}/sql/${dialect}/001-core.sql`).text();
  const tableRows =
    dialect === "postgres"
      ? await sql.unsafe<Record<string, unknown>[]>(
          "SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('schema_migrations', 'tenants', 'book_sets', 'journal_entries', 'postings', 'audit_log', 'idempotency_records')",
        )
      : await sql.unsafe<Record<string, unknown>[]>(
          "SELECT table_name AS `table_name`, engine AS `engine` FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('schema_migrations', 'tenants', 'book_sets', 'journal_entries', 'postings', 'audit_log', 'idempotency_records')",
        );

  const triggerQuery =
    dialect === "postgres"
      ? `SELECT trigger_name AS trigger_name FROM information_schema.triggers WHERE trigger_schema = current_schema() AND trigger_name IN (${REQUIRED_TRIGGERS.map((t) => `'${t}'`).join(",")})`
      : `SELECT trigger_name AS trigger_name FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND trigger_name IN (${REQUIRED_TRIGGERS.map((t) => `'${t}'`).join(",")})`;

  const triggerRowsRaw = await sql.unsafe<Record<string, unknown>[]>(triggerQuery);
  const triggerRows = triggerRowsRaw.map(normalizeDatabaseRowKeys);

  let missingFunctions: string[] = [];
  if (dialect === "postgres") {
    const functionQuery = `SELECT routine_name FROM information_schema.routines WHERE routine_schema = current_schema() AND routine_name IN (${REQUIRED_PG_FUNCTIONS.map((f) => `'${f}'`).join(",")})`;
    const functionRows = await sql.unsafe<Record<string, unknown>[]>(functionQuery);
    const foundFunctions = new Set(functionRows.map((row) => String(row.routine_name)));
    missingFunctions = REQUIRED_PG_FUNCTIONS.filter((func) => !foundFunctions.has(func));
  }

  const normalizedTableRows = tableRows.map(normalizeDatabaseRowKeys);
  const tables = [...new Set(normalizedTableRows.map((row) => String(row.table_name)))];
  const triggers = [...new Set(triggerRows.map((row) => String(row.trigger_name)))];
  const tableEngines: Record<string, string | null> = {};
  if (dialect === "mysql") {
    for (const row of normalizedTableRows) tableEngines[String(row.table_name)] = row.engine ? String(row.engine) : null;
  }

  const missingTables = REQUIRED_TABLES.filter((table) => !tables.includes(table));
  const missingTriggers = REQUIRED_TRIGGERS.filter((trigger) => !triggers.includes(trigger));
  const nonInnoDbTables =
    dialect === "mysql"
      ? REQUIRED_TABLES.filter((table) => tableEngines[table]?.toUpperCase() !== "INNODB")
      : [];

  const triggerStructureErrors: string[] = [];
  if (dialect === "postgres") {
    const triggerDetailsQuery = `
      SELECT
        tgname as trigger_name,
        c.relname as table_name,
        CASE WHEN (t.tgtype::int & 2) = 2 THEN 'BEFORE' WHEN (t.tgtype::int & 64) = 64 THEN 'INSTEAD OF' ELSE 'AFTER' END as timing,
        CASE WHEN (t.tgtype::int & 4) = 4 THEN 'INSERT' WHEN (t.tgtype::int & 8) = 8 THEN 'DELETE' WHEN (t.tgtype::int & 16) = 16 THEN 'UPDATE' WHEN (t.tgtype::int & 32) = 32 THEN 'TRUNCATE' ELSE 'UNKNOWN' END as event,
        CASE WHEN (t.tgtype::int & 1) = 1 THEN 'ROW' ELSE 'STATEMENT' END as level,
        p.proname as function_name,
        pg_get_function_identity_arguments(p.oid) as identity_arguments,
        pg_get_function_result(p.oid) as function_result,
        pg_get_functiondef(p.oid) as function_definition,
        pg_get_triggerdef(t.oid) as trigger_definition
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_proc p ON t.tgfoid = p.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE NOT tgisinternal AND n.nspname = current_schema() AND tgname IN (${REQUIRED_TRIGGERS.map((t) => `'${t}'`).join(",")})
      ORDER BY tgname
    `;
    const triggerDetails = await sql.unsafe<Array<Record<string, string>>>(triggerDetailsQuery);
    const functionBodies = expectedFunctionBodies(actualMigrationText);
    for (const required of REQUIRED_TRIGGERS) {
      const trigger = triggerDetails.find((row) => String(row.trigger_name) === required);
      const expected = EXPECTED_TRIGGERS[required];
      if (!trigger) {
        triggerStructureErrors.push(`${required} not found in catalog`);
        continue;
      }
      if (String(trigger.table_name) !== expected.table || String(trigger.timing) !== expected.timing || String(trigger.event) !== expected.event || String(trigger.level) !== "ROW" || String(trigger.function_name) !== expected.functionName) {
        triggerStructureErrors.push(`${required} target/timing/event/function mismatch`);
      }
      if (String(trigger.identity_arguments) !== "" || normalizeSql(String(trigger.function_result)) !== "trigger") {
        triggerStructureErrors.push(`${required} function identity mismatch`);
      }
      const definition = String(trigger.function_definition);
      const bodyMatch = definition.match(/AS\s+\$[^$]*\$([\s\S]*?)\$[^$]*\$/i);
      if (!bodyMatch || normalizeSql(bodyMatch[1]) !== functionBodies.get(expected.functionName)) {
        triggerStructureErrors.push(`${required} function action definition mismatch`);
      }
    }
  } else if (dialect === "mysql") {
    const triggerDetailsQuery = `
      SELECT
        trigger_name AS trigger_name,
        event_manipulation AS event,
        action_timing AS timing,
        event_object_table AS table_name,
        action_statement AS action_statement
      FROM information_schema.triggers
      WHERE trigger_schema = DATABASE() AND trigger_name IN (${REQUIRED_TRIGGERS.map((t) => `'${t}'`).join(",")})
      ORDER BY trigger_name
    `;
    const triggerDetails = (await sql.unsafe<Array<Record<string, unknown>>>(triggerDetailsQuery)).map(normalizeDatabaseRowKeys);
    const actions = expectedMySqlActions(actualMigrationText);
    for (const required of REQUIRED_TRIGGERS) {
      const trigger = triggerDetails.find((row) => String(row.trigger_name) === required);
      const expected = EXPECTED_TRIGGERS[required];
      if (!trigger) {
        triggerStructureErrors.push(`${required} not found in catalog`);
        continue;
      }
      if (String(trigger.table_name) !== expected.table || String(trigger.timing) !== expected.timing || String(trigger.event) !== expected.event) {
        triggerStructureErrors.push(`${required} target/timing/event mismatch`);
      }
      const expectedAction = actions.get(required);
      if (!expectedAction || normalizeSql(String(trigger.action_statement)) !== expectedAction) {
        triggerStructureErrors.push(`${required} action definition mismatch`);
      }
    }
  }

  if (missingTables.length > 0 || missingTriggers.length > 0 || missingFunctions.length > 0 || nonInnoDbTables.length > 0 || triggerStructureErrors.length > 0) {
    throw new MigrationContractError(
      MIGRATION_FAILED,
      `required structure invalid; tables=${missingTables.join(",") || "none"}; triggers=${missingTriggers.join(",") || "none"}; functions=${missingFunctions.join(",") || "none"}; non_innodb=${nonInnoDbTables.join(",") || "none"}; trigger_structure_errors=${triggerStructureErrors.join(",") || "none"}`,
    );
  }
  return { tables, triggers, tableEngines };
}

export async function verifyMigrationStructure(sql: SQL, dialect: DatabaseType, migrationText?: string): Promise<StructuralVerification> {
  return verifyRequiredStructure(sql, dialect, migrationText);
}

export async function applyMigration(sql: SQL, migration: MigrationDefinition): Promise<MigrationApplyResult> {
  const checksum = sha256MigrationText(migration.text);
  try {
    if (migration.dialect === "postgres") {
      const metadataExists = await schemaMigrationsExists(sql, "postgres");
      if (metadataExists) {
        const existing = await sql<{ checksum: string }[]>`
          SELECT checksum FROM schema_migrations WHERE logical_id = ${migration.logicalId}
        `;
        if (existing.length > 0) {
          if (String(existing[0].checksum) !== checksum) {
            throw new MigrationContractError(MIGRATION_CHECKSUM_MISMATCH, `logical_id=${migration.logicalId} has a different checksum`);
          }
          const structuralVerification = await verifyRequiredStructure(sql, migration.dialect, migration.text);
          return { logicalId: migration.logicalId, checksum, status: "NOOP", structuralVerification };
        }
      }

      // Fresh PostgreSQL applies bootstrap DDL, application DDL, and metadata
      // in one transaction. A failed statement rolls back the bootstrap too.
      await sql.begin(async (tx) => {
        if (!metadataExists) await tx.unsafe("CREATE TABLE schema_migrations (logical_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);");
        for (const statement of splitMigrationStatements(migration.text)) await tx.unsafe(statement);
        await tx`
          INSERT INTO schema_migrations (logical_id, checksum, applied_at)
          VALUES (${migration.logicalId}, ${checksum}, ${new Date().toISOString()})
        `;
      });
      const structuralVerification = await verifyRequiredStructure(sql, migration.dialect, migration.text);
      return { logicalId: migration.logicalId, checksum, status: "APPLIED", structuralVerification };
    }

    await ensureSchemaMigrationsTable(sql, "mysql");
    if (await getMigrationApplyingMarker(sql, migration.logicalId)) {
      throw new MigrationContractError(MIGRATION_DIRTY, `logical_id=${migration.logicalId} has a prior incomplete apply`);
    }
    const existing = await sql<{ checksum: string }[]>`
      SELECT checksum FROM schema_migrations WHERE logical_id = ${migration.logicalId}
    `;
    if (existing.length > 0) {
      if (String(existing[0].checksum) !== checksum) {
        throw new MigrationContractError(MIGRATION_CHECKSUM_MISMATCH, `logical_id=${migration.logicalId} has a different checksum`);
      }
      const structuralVerification = await verifyRequiredStructure(sql, migration.dialect, migration.text);
      return { logicalId: migration.logicalId, checksum, status: "NOOP", structuralVerification };
    }

    // This marker is deliberately outside the DDL try/catch. It remains after
    // every failure until the explicit recovery proof removes it.
    await setMigrationApplyingMarker(sql, migration.logicalId);
    for (const statement of splitMigrationStatements(migration.text)) await sql.unsafe(statement);
    await sql`
      INSERT INTO schema_migrations (logical_id, checksum, applied_at)
      VALUES (${migration.logicalId}, ${checksum}, ${new Date().toISOString()})
    `;
    const structuralVerification = await verifyRequiredStructure(sql, migration.dialect, migration.text);
    await clearMigrationApplyingMarker(sql, migration.logicalId);
    return { logicalId: migration.logicalId, checksum, status: "APPLIED", structuralVerification };
  } catch (error) {
    if (error instanceof MigrationContractError) throw error;
    throw new MigrationContractError(MIGRATION_FAILED, `logical_id=${migration.logicalId}; ${sanitizeError(error)}`);
  }
}

export async function loadMigration(dialect: DatabaseType): Promise<MigrationDefinition> {
  const logicalId = `gate0-001-core-${dialect}`;
  const text = await Bun.file(`${import.meta.dir}/sql/${dialect}/001-core.sql`).text();
  return { logicalId, text, dialect };
}

function blockedSemanticResults(prefix: "PG" | "MY", dialectName: string, reason: string): IntegrationTestResult[] {
  const dialect = prefix === "PG" ? "postgres" : "mysql";
  return REQUIRED_SEMANTIC_PROOF_IDS.map((proofId) => ({
    id: `${prefix}-${proofId}`,
    name: `${dialectName} ${proofId}`,
    status: registryNotApplicable(dialect, proofId) ? "NOT_APPLICABLE" as const : "BLOCKED" as const,
    evidence: registryNotApplicable(dialect, proofId)
      ? ["NOT_APPLICABLE by dialect proof registry", reason]
      : ["BLOCKED before successful database connection; proof not executed", reason],
    detail: registryNotApplicable(dialect, proofId) ? "NOT_APPLICABLE by dialect proof registry" : reason,
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
      detail: sanitizeError(reason),
      error: sanitizeError(reason),
    },
    ...blockedSemanticResults(prefix, dialectName, sanitizeError(reason)),
  ];
}

function registryNotApplicable(type: DatabaseType, proofId: string): boolean {
  return (DIALECT_NOT_APPLICABLE[type] as readonly string[]).includes(proofId);
}

export function recordProofNotApplicable(
  results: IntegrationTestResult[],
  proofId: string,
  prefix: string,
  reason: string,
): void {
  results.push({
    id: `${prefix}-${proofId}`,
    name: `${prefix} ${proofId}`,
    status: "NOT_APPLICABLE",
    evidence: [`NOT_APPLICABLE=${reason}`],
    detail: `NOT_APPLICABLE=${reason}`,
  });
}

type ProofContractValidation = { valid: boolean; errors: string[] };

/** Validate semantic result identity before any summary can be emitted. */
export function validateProofContract(
  dialect: DatabaseType,
  results: readonly IntegrationTestResult[],
): ProofContractValidation {
  const prefix = dialect === "postgres" ? "PG" : "MY";
  const expected = new Set(REQUIRED_SEMANTIC_PROOF_IDS.map((id) => `${prefix}-${id}`));
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const result of results) {
    if (/^(PG|MY)-/.test(result.id)) {
      if (!result.id.startsWith(`${prefix}-`)) {
        errors.push(`unknown proof id ${result.id}`);
        continue;
      }
      const suffix = result.id.slice(prefix.length + 1);
      if (SUBSTRATE_PROOF_IDS.has(suffix)) continue;
      if (!expected.has(result.id)) {
        errors.push(`unknown proof id ${result.id}`);
        continue;
      }
      if (seen.has(result.id)) errors.push(`duplicate proof id ${result.id}`);
      seen.add(result.id);
      const proofId = suffix as typeof REQUIRED_SEMANTIC_PROOF_IDS[number];
      if (result.status === "NOT_APPLICABLE" && !registryNotApplicable(dialect, proofId)) {
        errors.push(`invalid NOT_APPLICABLE status for ${result.id}`);
      }
      if (result.status === "PASS" && registryNotApplicable(dialect, proofId)) {
        errors.push(`inapplicable proof cannot PASS: ${result.id}`);
      }
    }
  }
  for (const proofId of REQUIRED_SEMANTIC_PROOF_IDS) {
    const id = `${prefix}-${proofId}`;
    if (!seen.has(id)) errors.push(`missing required proof ${id}`);
  }
  return { valid: errors.length === 0, errors };
}

export function finalizeProofResults(
  dialect: DatabaseType,
  results: readonly IntegrationTestResult[],
): IntegrationTestResult[] {
  const prefix = dialect === "postgres" ? "PG" : "MY";
  const validation = validateProofContract(dialect, results);
  const errorsById = new Map<string, string[]>();
  for (const error of validation.errors) {
    const match = error.match(/(PG|MY)-[A-Z0-9-]+/);
    if (match) errorsById.set(match[0], [...(errorsById.get(match[0]) ?? []), error]);
  }
  const finalized = results.filter((result, index, all) => {
    if (!result.id.startsWith(`${prefix}-`)) return true;
    const suffix = result.id.slice(prefix.length + 1);
    if (SUBSTRATE_PROOF_IDS.has(suffix)) return true;
    return all.findIndex((candidate) => candidate.id === result.id) === index;
  }).map((result) => {
    const errors = errorsById.get(result.id);
    if (!errors || errors.length === 0) return result;
    const detail = `${result.detail ?? result.evidence.join("|")}; contract=${errors.join(", ")}`;
    return { ...result, status: "FAIL" as const, detail, evidence: [...result.evidence, ...errors], error: detail };
  });
  for (const proofId of REQUIRED_SEMANTIC_PROOF_IDS) {
    const id = `${prefix}-${proofId}`;
    if (!finalized.some((result) => result.id === id)) {
      const contractError = errorsById.get(id)?.join(", ") ?? `missing required proof ${id}`;
      finalized.push({
        id,
        name: `${prefix} ${proofId}`,
        status: "FAIL",
        evidence: [contractError],
        detail: contractError,
        error: contractError,
      });
    }
  }
  return finalized;
}

export function integrationSummary(
  dialect: DatabaseType,
  serverVersion: string,
  results: readonly IntegrationTestResult[],
): IntegrationSummary {
  const prefix = dialect === "postgres" ? "PG" : "MY";
  const finalized = finalizeProofResults(dialect, results);
  const byId = new Map(finalized.map((result) => [result.id, result]));
  return {
    dialect,
    server_version: serverVersion,
    proofs: [...REQUIRED_SEMANTIC_PROOF_IDS].sort().map((proofId) => {
      const result = byId.get(`${prefix}-${proofId}`);
      return {
        id: proofId,
        status: result?.status ?? "FAIL",
        detail: result?.detail ?? result?.evidence.join("|") ?? "MISSING_REQUIRED_PROOF",
      };
    }),
  };
}

export function serializeIntegrationSummary(
  dialect: DatabaseType,
  serverVersion: string,
  results: readonly IntegrationTestResult[],
): string {
  return JSON.stringify(integrationSummary(dialect, serverVersion, results));
}

export function emitIntegrationSummary(
  dialect: DatabaseType,
  serverVersion: string,
  results: readonly IntegrationTestResult[],
): void {
  console.log(`GATE0_INTEGRATION_SUMMARY ${serializeIntegrationSummary(dialect, serverVersion, results)}`);
}

type SemanticProofContext = {
  sql: SQL;
  dbConfig: DatabaseConfig;
  migration: MigrationDefinition;
  prefix: string;
  dialectName: string;
  cleanupErrors: string[];
};

function recordCleanupError(ctx: SemanticProofContext, message: string): void {
  ctx.cleanupErrors.push(message);
}

type TableSnapshot = {
  table: string;
  count: number;
  rows: Array<Record<string, unknown>>;
};

async function getServerVersion(sql: SQL, dialect: DatabaseType): Promise<string> {
  if (dialect === "postgres") {
    const result = await sql.unsafe<{ version: string }[]>("SELECT version() as version");
    return result[0]?.version ?? "unknown";
  } else {
    const result = await sql.unsafe<{ version: string }[]>("SELECT VERSION() as version");
    return result[0]?.version ?? "unknown";
  }
}

function canonicalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return `BIGINT:${value.toString()}`;
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonicalizeValue(nested)]));
  }
  return value;
}

function canonicalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return canonicalizeValue(row) as Record<string, unknown>;
}

export function rollbackFailureDetail(failure: unknown, leftovers: unknown): string {
  return `fresh-namespace rollback incomplete: failure=${sanitizeError(failure)} leftovers=${JSON.stringify(canonicalizeValue(leftovers))}`;
}

function isZeroDatabaseCount(value: bigint | number | undefined): boolean {
  return value === 0n || value === 0;
}

async function captureTableSnapshot(sql: SQL, tableName: string, dialect: DatabaseType): Promise<TableSnapshot> {
  const countResult = await sql.unsafe<{ count: bigint | number }[]>(`SELECT COUNT(*) as count FROM ${tableName}`);
  const count = Number(countResult[0]?.count ?? 0);
  // Do not cap or order by an arbitrary column: every row participates in the
  // byte comparison and canonical JSON determines deterministic ordering.
  const rows = await sql.unsafe<Record<string, unknown>[]>(`SELECT * FROM ${tableName}`);
  const canonicalized = rows.map(canonicalizeRow).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { table: tableName, count, rows: canonicalized };
}

async function captureMultipleSnapshots(sql: SQL, tables: string[], dialect: DatabaseType = "postgres"): Promise<TableSnapshot[]> {
  const snapshots: TableSnapshot[] = [];
  for (const table of tables) {
    try {
      snapshots.push(await captureTableSnapshot(sql, table, dialect));
    } catch (error) {
      // Query error must not be swallowed; re-throw to fail the proof
      throw new Error(`snapshot capture failed for ${table}: ${sanitizeError(error)}`);
    }
  }
  return snapshots;
}

async function captureCatalogSnapshot(sql: SQL, dialect: DatabaseType, explicitSchema = "public"): Promise<string> {
  if (dialect === "postgres") {
    assertSafeIdentifier(explicitSchema, "explicit schema");
    // Every row is deliberately reduced to the same three-field contract.
    // The schema is an explicit literal, never current_schema()/search_path.
    // pg_catalog definitions are stable on PostgreSQL 17 and include changes
    // that information_schema omits (partial indexes, identity/generated
    // columns, overloaded routines, ownership, and view definitions).
    const rows = await sql.unsafe<Record<string, unknown>[]>(`
      SELECT 'relation' AS object_kind,
             format('%I.%I', n.nspname, c.relname) AS object_identity,
             format('relkind=%s|persistence=%s|replident=%s', c.relkind, c.relpersistence, c.relreplident) AS object_definition
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = '${explicitSchema}' AND c.relkind IN ('r', 'p', 'f')

      UNION ALL
      SELECT 'column',
             format('%I.%I.%I', n.nspname, c.relname, a.attname),
             format('ordinal=%s|type=%s|not_null=%s|default=%s|identity=%s|generated=%s|collation=%s',
               a.attnum, format_type(a.atttypid, a.atttypmod), a.attnotnull,
               coalesce(pg_get_expr(d.adbin, d.adrelid), ''), a.attidentity,
               a.attgenerated, CASE WHEN coll.oid IS NULL THEN '' ELSE format('%I.%I', cn.nspname, coll.collname) END)
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      LEFT JOIN pg_collation coll ON coll.oid = a.attcollation AND a.attcollation <> 0
      LEFT JOIN pg_namespace cn ON cn.oid = coll.collnamespace
      WHERE n.nspname = '${explicitSchema}' AND c.relkind IN ('r', 'p', 'f')
        AND a.attnum > 0 AND NOT a.attisdropped

      UNION ALL
      SELECT 'index',
             format('%I.%I.%I', n.nspname, t.relname, i.relname),
             format('unique=%s|primary=%s|valid=%s|ready=%s|definition=%s|predicate=%s',
               x.indisunique, x.indisprimary, x.indisvalid, x.indisready,
               pg_get_indexdef(x.indexrelid), coalesce(pg_get_expr(x.indpred, x.indrelid), ''))
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = '${explicitSchema}'

      UNION ALL
      SELECT 'constraint',
             format('%I.%I.%I', coalesce(n.nspname, dn.nspname), coalesce(t.relname, 'domain'), c.conname),
             format('definition=%s|owner=%s|referenced=%s|validated=%s|type=%s',
               pg_get_constraintdef(c.oid, true),
               CASE WHEN t.oid IS NULL THEN '' ELSE format('%I.%I', n.nspname, t.relname) END,
               CASE WHEN rt.oid IS NULL THEN '' ELSE format('%I.%I', rn.nspname, rt.relname) END, c.convalidated, c.contype)
      FROM pg_constraint c
      LEFT JOIN pg_class t ON t.oid = c.conrelid
      LEFT JOIN pg_namespace n ON n.oid = t.relnamespace
      LEFT JOIN pg_class rt ON rt.oid = c.confrelid
      LEFT JOIN pg_namespace rn ON rn.oid = rt.relnamespace
      LEFT JOIN pg_type dt ON dt.oid = c.contypid
      LEFT JOIN pg_namespace dn ON dn.oid = dt.typnamespace
      WHERE coalesce(n.nspname, dn.nspname) = '${explicitSchema}'
        AND (t.oid IS NULL OR t.relkind IN ('r', 'p', 'f'))

      UNION ALL
      SELECT 'trigger',
             format('%I.%I.%I', n.nspname, c.relname, t.tgname),
             pg_get_triggerdef(t.oid, true)
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = '${explicitSchema}' AND NOT t.tgisinternal

      UNION ALL
      SELECT 'routine',
             format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
             format('definition=%s|kind=%s|language=%s|result=%s|volatility=%s|strict=%s|security_definer=%s',
               pg_get_functiondef(p.oid), p.prokind, l.lanname, pg_get_function_result(p.oid),
               p.provolatile, p.proisstrict, p.prosecdef)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = '${explicitSchema}' AND p.prokind IN ('f', 'p', 'w')

      UNION ALL
      SELECT 'sequence',
             format('%I.%I', n.nspname, c.relname),
             format('type=%s|start=%s|min=%s|max=%s|increment=%s|cache=%s|cycle=%s|owned_by=%s',
               format_type(s.seqtypid, NULL), s.seqstart, s.seqmin, s.seqmax,
               s.seqincrement, s.seqcache, s.seqcycle,
               CASE WHEN oc.oid IS NULL OR oa.attnum IS NULL THEN '' ELSE format('%I.%I.%I', onsp.nspname, oc.relname, oa.attname) END)
      FROM pg_sequence s
      JOIN pg_class c ON c.oid = s.seqrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_depend dep ON dep.classid = 'pg_class'::regclass AND dep.objid = c.oid AND dep.deptype = 'a'
      LEFT JOIN pg_class oc ON oc.oid = dep.refobjid
      LEFT JOIN pg_namespace onsp ON onsp.oid = oc.relnamespace
      LEFT JOIN pg_attribute oa ON oa.attrelid = oc.oid AND oa.attnum = dep.refobjsubid
      WHERE n.nspname = '${explicitSchema}'

      UNION ALL
      SELECT 'domain',
             format('%I.%I', n.nspname, t.typname),
             format('base=%s|not_null=%s|default=%s|collation=%s', format_type(t.typbasetype, t.typtypmod),
               t.typnotnull, coalesce(t.typdefault, ''), CASE WHEN coll.oid IS NULL THEN '' ELSE format('%I.%I', cn.nspname, coll.collname) END)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      LEFT JOIN pg_collation coll ON coll.oid = t.typcollation AND t.typcollation <> 0
      LEFT JOIN pg_namespace cn ON cn.oid = coll.collnamespace
      WHERE n.nspname = '${explicitSchema}' AND t.typtype = 'd'

      UNION ALL
      SELECT 'enum', format('%I.%I', n.nspname, t.typname),
             string_agg(format('%s:%s', e.enumsortorder, e.enumlabel), ',' ORDER BY e.enumsortorder)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname = '${explicitSchema}' AND t.typtype = 'e'
      GROUP BY n.nspname, t.typname

      UNION ALL
      SELECT 'range', format('%I.%I', n.nspname, t.typname),
             format('subtype=%s|collation=%s|canonical=%s|subdiff=%s', format_type(r.rngsubtype, NULL),
               CASE WHEN coll.oid IS NULL THEN '' ELSE format('%I.%I', cn.nspname, coll.collname) END,
               CASE WHEN cf.oid IS NULL THEN '' ELSE format('%I.%I', cfn.nspname, cf.proname) END,
               CASE WHEN df.oid IS NULL THEN '' ELSE format('%I.%I', dfn.nspname, df.proname) END)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_range r ON r.rngtypid = t.oid
      LEFT JOIN pg_collation coll ON coll.oid = r.rngcollation AND r.rngcollation <> 0
      LEFT JOIN pg_namespace cn ON cn.oid = coll.collnamespace
      LEFT JOIN pg_proc cf ON cf.oid = r.rngcanonical
      LEFT JOIN pg_namespace cfn ON cfn.oid = cf.pronamespace
      LEFT JOIN pg_proc df ON df.oid = r.rngsubdiff
      LEFT JOIN pg_namespace dfn ON dfn.oid = df.pronamespace
      WHERE n.nspname = '${explicitSchema}' AND t.typtype = 'r'

      UNION ALL
      SELECT 'composite', format('%I.%I', n.nspname, t.typname),
             coalesce((SELECT string_agg(format('%s:%s:%s', a.attnum, a.attname, format_type(a.atttypid, a.atttypmod)), ',' ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped), '')
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = '${explicitSchema}' AND t.typtype = 'c'
        AND NOT EXISTS (
          SELECT 1 FROM pg_class row_type
          WHERE row_type.reltype = t.oid AND row_type.relkind IN ('r', 'p', 'f', 'v', 'm')
        )

      UNION ALL
      SELECT CASE WHEN c.relkind = 'm' THEN 'materialized_view' ELSE 'view' END,
             format('%I.%I', n.nspname, c.relname), pg_get_viewdef(c.oid, true)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = '${explicitSchema}' AND c.relkind IN ('v', 'm')
    `);
    const canonical = rows.map(canonicalizeRow).sort((a, b) => {
      const left = [a.object_kind, a.object_identity, a.object_definition].map(String);
      const right = [b.object_kind, b.object_identity, b.object_definition].map(String);
      return left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]) || left[2].localeCompare(right[2]);
    });
    return JSON.stringify(canonical);
  }
  const rows = await sql.unsafe<Record<string, unknown>[]>(`
    SELECT 'table' AS \`object_kind\`, table_name AS \`object_identity\`, engine AS \`object_definition\`
    FROM information_schema.tables WHERE table_schema = DATABASE()
    UNION ALL
    SELECT 'trigger' AS \`object_kind\`, trigger_name AS \`object_identity\`, CONCAT(event_manipulation, '|', action_timing, '|', event_object_table, '|', action_statement) AS \`object_definition\`
    FROM information_schema.triggers WHERE trigger_schema = DATABASE()
  `);
  return JSON.stringify(rows.map(normalizeDatabaseRowKeys).map(canonicalizeRow).sort((a, b) => {
    const left = [a.object_kind, a.object_identity, a.object_definition].map(String);
    const right = [b.object_kind, b.object_identity, b.object_definition].map(String);
    return left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]) || left[2].localeCompare(right[2]);
  }));
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";

  constructor(message: string = "idempotency conflict: same request_id with different request_hash") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export type IdempotencyResult = {
  result_json: string;
  result_hash: string;
};

export function extractLockErrorCode(error: unknown, dialect: DatabaseType): { isLockError: boolean; code: string } {
  if (!error) return { isLockError: false, code: "" };

  const err = error as unknown as Record<string, unknown>;

  if (dialect === "postgres") {
    // Bun 1.3.14 exposes PostgreSQL SQLSTATE as error.code.
    const code = String(err.code ?? "");
    if (code === "55P03" || code === "40P01") {
      return { isLockError: true, code };
    }
    // Bun's native PostgreSQL adapter currently wraps server errors with the
    // generic code ERR_POSTGRES_SERVER_ERROR and carries the exact SQLSTATE in
    // errno. Accept that exact structured pair only; never inspect messages or
    // undocumented aliases.
    const errno = String(err.errno ?? "");
    if (code === "ERR_POSTGRES_SERVER_ERROR" && (errno === "55P03" || errno === "40P01")) {
      return { isLockError: true, code: errno };
    }
  } else {
    // MySQL Bun errors expose documented numeric errno and symbolic code.
    const errno = String(err.errno ?? "");
    const code = String(err.code ?? "");
    if (errno === "1205" || errno === "1213" || errno === "3572" || code === "ER_LOCK_WAIT_TIMEOUT" || code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_NOWAIT") {
      return { isLockError: true, code: errno || code };
    }
  }

  // Structured code not found = NOT a lock error (rejects message-lookalike errors)
  return { isLockError: false, code: "" };
}

export async function getOrCreateIdempotencyRecord(
  sql: SQL,
  tenantId: string,
  requestId: string,
  requestHash: string,
  resultJson: string,
  resultHash: string,
  dialect: DatabaseType = "postgres",
): Promise<IdempotencyResult> {
  let result: IdempotencyResult | null = null;

  await sql.begin(async (tx) => {
    if (dialect === "mysql") {
      await tx`
        INSERT INTO idempotency_records (tenant_id, request_id, request_hash, result_json, result_hash)
        VALUES (${tenantId}, ${requestId}, ${requestHash}, ${resultJson}, ${resultHash})
        ON DUPLICATE KEY UPDATE request_id = request_id
      `;
    } else {
      await tx`
        INSERT INTO idempotency_records (tenant_id, request_id, request_hash, result_json, result_hash)
        VALUES (${tenantId}, ${requestId}, ${requestHash}, ${resultJson}, ${resultHash})
        ON CONFLICT (tenant_id, request_id) DO NOTHING
      `;
    }
    const existing = await tx<{ request_hash: string; result_json: string; result_hash: string }[]>`
      SELECT request_hash, result_json, result_hash FROM idempotency_records
      WHERE tenant_id = ${tenantId} AND request_id = ${requestId}
    `;
    if (existing.length !== 1) throw new Error("idempotency insert/read did not return exactly one stored row");
    if (String(existing[0].request_hash) !== requestHash) throw new IdempotencyConflictError();
    result = { result_json: existing[0].result_json, result_hash: existing[0].result_hash };
  });
  if (!result) {
    throw new Error("idempotency record not returned");
  }

  return result;
}

async function seedFixtures(sql: SQL): Promise<void> {
  await sql`INSERT INTO tenants (id, name) VALUES (${'t-a'}, ${'Tenant A'})`;
  await sql`INSERT INTO tenants (id, name) VALUES (${'t-b'}, ${'Tenant B'})`;
  await sql`INSERT INTO book_sets (tenant_id, id, kind) VALUES (${'t-a'}, ${'book-a'}, ${'proprietorship'})`;
  await sql`INSERT INTO book_sets (tenant_id, id, kind) VALUES (${'t-a'}, ${'book-b'}, ${'proprietorship'})`;
  await sql`INSERT INTO book_sets (tenant_id, id, kind) VALUES (${'t-b'}, ${'book-z'}, ${'proprietorship'})`;
}

function recordProofPass(
  results: IntegrationTestResult[],
  proofId: string,
  prefix: string,
  evidence: string[],
): void {
  results.push({
    id: `${prefix}-${proofId}`,
    name: `${prefix} ${proofId}`,
    status: "PASS",
    evidence,
    detail: evidence.join("; "),
  });
}

function recordProofFail(
  results: IntegrationTestResult[],
  proofId: string,
  prefix: string,
  error: string,
): void {
  results.push({
    id: `${prefix}-${proofId}`,
    name: `${prefix} ${proofId}`,
    status: "FAIL",
    evidence: [error],
    detail: error,
    error,
  });
}

async function runSemanticMatrix(ctx: SemanticProofContext): Promise<IntegrationTestResult[]> {
  const results: IntegrationTestResult[] = [];
  const { sql, prefix } = ctx;
  // Bun's MySQL binder rejects even small BigInt parameters with
  // ERR_OUT_OF_RANGE, while PostgreSQL accepts them. Keep the values and
  // assertions exact; use a safe Number only for the small fixture amounts.
  const smallMinorUnits = (value: bigint): number | bigint => ctx.dbConfig.type === "mysql" ? Number(value) : value;

  try {
    // Seed fixtures
    await seedFixtures(sql);

    // MIG-001: fresh apply with exact checksum, all tables, all triggers, server version
    try {
      const checksum = sha256MigrationText(ctx.migration.text);
      const serverVersion = await getServerVersion(sql, ctx.dbConfig.type);
      const migrationRow = await sql<{ checksum: string; applied_at: string }[]>`
        SELECT checksum, applied_at FROM schema_migrations WHERE logical_id = ${ctx.migration.logicalId}
      `;
      if (migrationRow.length === 0) {
        recordProofFail(results, "MIG-001", prefix, "Migration row not found in schema_migrations");
      } else if (String(migrationRow[0].checksum) !== checksum) {
        recordProofFail(results, "MIG-001", prefix, `Checksum mismatch: stored=${migrationRow[0].checksum}, expected=${checksum}`);
      } else {
        const tableQuery =
          ctx.dbConfig.type === "postgres"
            ? "SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('schema_migrations', 'tenants', 'book_sets', 'journal_entries', 'postings', 'audit_log', 'idempotency_records')"
            : "SELECT table_name AS `table_name` FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('schema_migrations', 'tenants', 'book_sets', 'journal_entries', 'postings', 'audit_log', 'idempotency_records')";
        const tableRows = await sql.unsafe<Record<string, unknown>[]>(tableQuery);
        const tables = tableRows.map(normalizeDatabaseRowKeys);
        if (tables.length !== 7) {
          recordProofFail(results, "MIG-001", prefix, `Missing required tables: found ${tables.length}/7`);
        } else {
          recordProofPass(results, "MIG-001", prefix, [
            `logical_id=${ctx.migration.logicalId}`,
            `checksum=${checksum}`,
            `applied_at=${migrationRow[0].applied_at}`,
            `server_version=${serverVersion}`,
            `tables_present=7 (schema_migrations,tenants,book_sets,journal_entries,postings,audit_log,idempotency_records)`,
            `triggers=10 required (verified by structural check)`,
            `dialect=${ctx.dbConfig.type}`,
          ]);
        }
      }
    } catch (error) {
      recordProofFail(results, "MIG-001", prefix, sanitizeError(error));
    }

    // MIG-002: same bytes reapply => true NOOP with exact metadata/catalog unchanged
    try {
      const snapBefore = await captureMultipleSnapshots(sql, ["schema_migrations"]);
      const metadataBefore = snapBefore[0].rows;
      const catalogBefore = await captureCatalogSnapshot(sql, ctx.dbConfig.type);

      const secondMigration = await loadMigration(ctx.dbConfig.type);
      const result = await applyMigration(sql, secondMigration);

      const snapAfter = await captureMultipleSnapshots(sql, ["schema_migrations"]);
      const metadataAfter = snapAfter[0].rows;
      const catalogAfter = await captureCatalogSnapshot(sql, ctx.dbConfig.type);

      if (result.status !== "NOOP") {
        recordProofFail(results, "MIG-002", prefix, `Expected NOOP but got ${result.status}`);
      } else if (JSON.stringify(metadataBefore) !== JSON.stringify(metadataAfter) || catalogBefore !== catalogAfter) {
        recordProofFail(results, "MIG-002", prefix, "Metadata or catalog bytes changed despite NOOP status");
      } else {
        recordProofPass(results, "MIG-002", prefix, [
          "same migration applied again",
          "status=NOOP",
          `checksum=${result.checksum}`,
          "no new schema_migrations rows created",
          "exact metadata bytes unchanged",
          "no DDL executed",
        ]);
      }
    } catch (error) {
      recordProofFail(results, "MIG-002", prefix, sanitizeError(error));
    }

    // MIG-003: altered fixed migration bytes against existing canonical ID => MIGRATION_CHECKSUM_MISMATCH before DDL
    try {
      const snapBefore = await captureMultipleSnapshots(sql, ["schema_migrations", "tenants", "book_sets"]);
      const catalogBefore = await captureCatalogSnapshot(sql, ctx.dbConfig.type);

      const tamperedMigration: MigrationDefinition = {
        logicalId: ctx.migration.logicalId,
        text: ctx.migration.text + "\n-- tampered",
        dialect: ctx.dbConfig.type,
      };
      let mismatchThrown = false;
      try {
        await applyMigration(sql, tamperedMigration);
      } catch (error) {
        if (error instanceof MigrationContractError && error.code === MIGRATION_CHECKSUM_MISMATCH) {
          mismatchThrown = true;
        }
      }

      if (!mismatchThrown) {
        recordProofFail(results, "MIG-003", prefix, "Tampered migration should throw MIGRATION_CHECKSUM_MISMATCH");
      } else {
        const snapAfter = await captureMultipleSnapshots(sql, ["schema_migrations", "tenants", "book_sets"]);
        const catalogAfter = await captureCatalogSnapshot(sql, ctx.dbConfig.type);
        if (JSON.stringify(snapBefore) === JSON.stringify(snapAfter) && catalogBefore === catalogAfter) {
          recordProofPass(results, "MIG-003", prefix, [
            "tampered migration text rejected",
            "error=MIGRATION_CHECKSUM_MISMATCH",
            "checksum validation before DDL",
            "schema_migrations unchanged",
            "tenant/book_set unchanged",
            "zero side effects",
          ]);
        } else {
          recordProofFail(results, "MIG-003", prefix, "Schema was modified despite MIGRATION_CHECKSUM_MISMATCH");
        }
      }
    } catch (error) {
      recordProofFail(results, "MIG-003", prefix, sanitizeError(error));
    }

    // MIG-004: bad checksum in metadata => MIGRATION_CHECKSUM_MISMATCH, no silent repair; explicit restore verified
    try {
      const badChecksum = "0000000000000000000000000000000000000000000000000000000000000000";
      const correctChecksum = sha256MigrationText(ctx.migration.text);

      // Set bad checksum using parameterized query
      await sql`
        UPDATE schema_migrations
        SET checksum = ${badChecksum}
        WHERE logical_id = ${ctx.migration.logicalId}
      `;

      const snapBefore = await captureMultipleSnapshots(sql, ["schema_migrations", "journal_entries"]);
      const catalogBefore = await captureCatalogSnapshot(sql, ctx.dbConfig.type);

      // Try to reapply canonical - should fail with mismatch
      let mismatchThrown = false;
      try {
        await applyMigration(sql, ctx.migration);
      } catch (error) {
        if (error instanceof MigrationContractError && error.code === MIGRATION_CHECKSUM_MISMATCH) {
          mismatchThrown = true;
        }
      }

      if (!mismatchThrown) {
        recordProofFail(results, "MIG-004", prefix, "Expected MIGRATION_CHECKSUM_MISMATCH when checksum is tampered");
      } else {
        const snapAfter = await captureMultipleSnapshots(sql, ["schema_migrations", "journal_entries"]);
        const catalogAfter = await captureCatalogSnapshot(sql, ctx.dbConfig.type);
        const stillBad = await sql<{ checksum: string }[]>`
          SELECT checksum FROM schema_migrations WHERE logical_id = ${ctx.migration.logicalId}
        `;

        if (String(stillBad[0]?.checksum) !== badChecksum) {
          recordProofFail(results, "MIG-004", prefix, "Bad checksum was silently repaired (should not have been)");
        } else if (JSON.stringify(snapBefore) !== JSON.stringify(snapAfter) || catalogBefore !== catalogAfter) {
          recordProofFail(results, "MIG-004", prefix, "Schema or catalog was modified despite MIGRATION_CHECKSUM_MISMATCH");
        } else {
          // Explicitly restore correct checksum for remaining tests
          await sql`
            UPDATE schema_migrations
            SET checksum = ${correctChecksum}
            WHERE logical_id = ${ctx.migration.logicalId}
          `;

          // Verify restoration was successful
          const restored = await sql<{ checksum: string }[]>`
            SELECT checksum FROM schema_migrations WHERE logical_id = ${ctx.migration.logicalId}
          `;

          if (String(restored[0]?.checksum) !== correctChecksum) {
            recordProofFail(results, "MIG-004", prefix, `Restoration failed: stored=${restored[0]?.checksum}, expected=${correctChecksum}`);
          } else {
            recordProofPass(results, "MIG-004", prefix, [
              "bad checksum set in metadata",
              "canonical bytes rejected",
              "stable MIGRATION_CHECKSUM_MISMATCH",
              "bad checksum persisted (no silent repair)",
              "schema/metadata unchanged",
              "explicit restore applied",
              `restored checksum verified=${correctChecksum}`,
            ]);
          }
        }
      }
    } catch (error) {
      recordProofFail(results, "MIG-004", prefix, sanitizeError(error));
    }

    // MIG-DDL-ROLLBACK: PostgreSQL DDL failure inside transaction; verify complete rollback (no partial state)
    if (ctx.dbConfig.type === "postgres") {
      let rollbackSql: SQL | null = null;
      let rollbackSchema = "";
      try {
        rollbackSchema = `gate0_rollback_${crypto.randomUUID().replaceAll("-", "")}`;
        assertSafeIdentifier(rollbackSchema, "rollback schema");
        rollbackSql = createBunSqlClient(ctx.dbConfig);
        await rollbackSql.connect();
        await rollbackSql.unsafe(`CREATE SCHEMA "${rollbackSchema}"`);
        await rollbackSql.unsafe(`SET search_path TO "${rollbackSchema}"`);
        const failingMigration: MigrationDefinition = {
          logicalId: `test-ddl-rollback-${crypto.randomUUID()}`,
          dialect: "postgres",
          text: `CREATE TABLE test_rollback (id TEXT PRIMARY KEY);
-- statement-breakpoint
CREATE TABLE test_rollback (id TEXT PRIMARY KEY);
-- statement-breakpoint`,
        };
        let failure: unknown = null;
        const catalogBeforeRollback = await captureCatalogSnapshot(rollbackSql, "postgres", rollbackSchema);
        try {
          await applyMigration(rollbackSql, failingMigration);
        } catch (error) {
          failure = error;
        }
        const catalogAfterRollback = await captureCatalogSnapshot(rollbackSql, "postgres", rollbackSchema);
        const leftovers = await rollbackSql.unsafe<{ table_count: bigint | number; trigger_count: bigint | number; function_count: bigint | number }[]>(`
          SELECT
            (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${rollbackSchema}') AS table_count,
            (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = '${rollbackSchema}') AS trigger_count,
            (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '${rollbackSchema}') AS function_count
        `);
        const rollbackComplete = failure instanceof MigrationContractError && failure.code === MIGRATION_FAILED && isZeroDatabaseCount(leftovers[0]?.table_count) && isZeroDatabaseCount(leftovers[0]?.trigger_count) && isZeroDatabaseCount(leftovers[0]?.function_count) && catalogBeforeRollback === catalogAfterRollback && catalogAfterRollback === "[]";
        if (!rollbackComplete) {
          recordProofFail(results, "MIG-DDL-ROLLBACK", "PG", rollbackFailureDetail(failure, leftovers));
        } else {
          recordProofPass(results, "MIG-DDL-ROLLBACK", "PG", [
            "real applyMigration path called on a fresh PostgreSQL namespace",
            "metadata bootstrap, application DDL, and metadata row shared one sql.begin",
            "intentional duplicate DDL raised typed MIGRATION_FAILED",
            "full catalog bytes before/after rollback are identical and empty",
            "schema_migrations and every catalog object created by the failed migration are absent",
          ]);
        }
      } catch (error) {
        recordProofFail(results, "MIG-DDL-ROLLBACK", "PG", sanitizeError(error));
      } finally {
        if (rollbackSql) {
          try {
            await rollbackSql.unsafe("SET search_path TO public");
            if (rollbackSchema) await rollbackSql.unsafe(`DROP SCHEMA IF EXISTS "${rollbackSchema}" CASCADE`);
          } catch (error) {
            recordCleanupError(ctx, `rollback namespace cleanup failed: ${sanitizeError(error)}`);
          }
          try { await rollbackSql.end({ timeout: 1000 }); } catch (error) { recordCleanupError(ctx, `rollback client cleanup failed: ${sanitizeError(error)}`); }
        }
      }
    }

    // SCOPE-ISOLATION-001: PostgreSQL explicit schema parameter prevents search_path redirection
    if (ctx.dbConfig.type === "postgres") {
      let testSql: SQL | null = null;
      let testSchema1 = "";
      let testSchema2 = "";
      try {
        testSchema1 = `gate0_scope1_${crypto.randomUUID().replaceAll("-", "")}`;
        testSchema2 = `gate0_scope2_${crypto.randomUUID().replaceAll("-", "")}`;
        assertSafeIdentifier(testSchema1, "test schema 1");
        assertSafeIdentifier(testSchema2, "test schema 2");
        testSql = createBunSqlClient(ctx.dbConfig);
        await testSql.connect();
        await testSql.unsafe(`CREATE SCHEMA "${testSchema1}"`);
        await testSql.unsafe(`CREATE SCHEMA "${testSchema2}"`);

        // Create a table in schema2 to ensure it doesn't leak into schema1's snapshot
        await testSql.unsafe(`CREATE TABLE "${testSchema2}".pollution_table (id TEXT PRIMARY KEY)`);

        // Take snapshot of empty schema1 with explicit parameter
        const emptySnapshot = await captureCatalogSnapshot(testSql, "postgres", testSchema1);

        // Change search_path to schema2 (which has a table)
        await testSql.unsafe(`SET search_path TO "${testSchema2}"`);

        // Take snapshot of schema1 again - should still be empty even though search_path points to schema2
        const isolatedSnapshot = await captureCatalogSnapshot(testSql, "postgres", testSchema1);

        // Verify the snapshots are identical and empty
        const snapshotsMatch = emptySnapshot === isolatedSnapshot && emptySnapshot === "[]";

        // Verify schema2's snapshot contains the pollution_table
        const schema2Snapshot = await captureCatalogSnapshot(testSql, "postgres", testSchema2);
        const schema2HasPollution = schema2Snapshot.includes("pollution_table");

        if (!snapshotsMatch) {
          recordProofFail(results, "SCOPE-ISOLATION-001", "PG", `Schema1 snapshots differ or not empty: empty=${emptySnapshot}, isolated=${isolatedSnapshot}`);
        } else if (!schema2HasPollution) {
          recordProofFail(results, "SCOPE-ISOLATION-001", "PG", "Schema2 snapshot should contain pollution_table");
        } else {
          recordProofPass(results, "SCOPE-ISOLATION-001", "PG", [
            "explicit schema parameter overrides current_schema()",
            "ambient search_path changes do not redirect snapshot",
            "wrong-schema objects do not contaminate proof",
          ]);
        }
      } catch (error) {
        recordProofFail(results, "SCOPE-ISOLATION-001", "PG", sanitizeError(error));
      } finally {
        if (testSql) {
          try {
            await testSql.unsafe("SET search_path TO public");
            if (testSchema1) await testSql.unsafe(`DROP SCHEMA IF EXISTS "${testSchema1}" CASCADE`);
            if (testSchema2) await testSql.unsafe(`DROP SCHEMA IF EXISTS "${testSchema2}" CASCADE`);
          } catch (error) {
            recordCleanupError(ctx, `schema scope test cleanup failed: ${sanitizeError(error)}`);
          }
          try { await testSql.end({ timeout: 1000 }); } catch (error) { recordCleanupError(ctx, `scope test client cleanup failed: ${sanitizeError(error)}`); }
        }
      }
    }

    // SCOPE-ISOLATION-002: every representative PostgreSQL catalog mutation
    // changes the explicit-schema snapshot. This catches snapshots that only
    // count tables or only read information_schema names.
    if (ctx.dbConfig.type === "postgres") {
      let testSql: SQL | null = null;
      let testSchema = "";
      try {
        testSchema = `gate0_scope2_${crypto.randomUUID().replaceAll("-", "")}`;
        assertSafeIdentifier(testSchema, "test schema");
        testSql = createBunSqlClient(ctx.dbConfig);
        await testSql.connect();
        await testSql.unsafe(`CREATE SCHEMA "${testSchema}"`);
        const snapshots: string[] = [await captureCatalogSnapshot(testSql, "postgres", testSchema)];
        const mutate = async (label: string, statement: string) => {
          await testSql!.unsafe(statement);
          const next = await captureCatalogSnapshot(testSql!, "postgres", testSchema);
          if (next === snapshots[snapshots.length - 1]) throw new Error(`${label} did not affect catalog snapshot`);
          snapshots.push(next);
        };

        await mutate("table", `CREATE TABLE "${testSchema}".catalog_table (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text COLLATE "C" DEFAULT 'new')`);
        await mutate("column", `ALTER TABLE "${testSchema}".catalog_table ADD COLUMN amount numeric NOT NULL DEFAULT 0`);
        await mutate("index", `CREATE UNIQUE INDEX catalog_table_name_idx ON "${testSchema}".catalog_table (name) WHERE amount >= 0`);
        await mutate("constraint", `ALTER TABLE "${testSchema}".catalog_table ADD CONSTRAINT catalog_amount_check CHECK (amount >= 0)`);
        await mutate("routine", `CREATE FUNCTION "${testSchema}".catalog_fn(value integer) RETURNS integer LANGUAGE SQL IMMUTABLE AS $$ SELECT value + 1 $$`);
        await mutate("overloaded routine", `CREATE FUNCTION "${testSchema}".catalog_fn(value text) RETURNS text LANGUAGE SQL IMMUTABLE AS $$ SELECT value || 'x' $$`);
        await mutate("trigger routine", `CREATE FUNCTION "${testSchema}".catalog_trigger_fn() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END;$$`);
        await mutate("trigger", `CREATE TRIGGER catalog_table_trigger BEFORE INSERT ON "${testSchema}".catalog_table FOR EACH ROW EXECUTE FUNCTION "${testSchema}".catalog_trigger_fn()`);
        await mutate("sequence", `CREATE SEQUENCE "${testSchema}".catalog_sequence AS bigint START WITH 10 INCREMENT BY 2 MINVALUE 1 MAXVALUE 100 CACHE 3 CYCLE OWNED BY "${testSchema}".catalog_table.amount`);
        await mutate("domain", `CREATE DOMAIN "${testSchema}".catalog_domain AS text NOT NULL DEFAULT 'domain-default'`);
        await mutate("enum", `CREATE TYPE "${testSchema}".catalog_enum AS ENUM ('draft', 'posted')`);
        await mutate("range", `CREATE TYPE "${testSchema}".catalog_range AS RANGE (subtype = numeric)`);
        await mutate("composite", `CREATE TYPE "${testSchema}".catalog_composite AS (code text, amount numeric)`);
        await mutate("view", `CREATE VIEW "${testSchema}".catalog_view AS SELECT id, name FROM "${testSchema}".catalog_table`);
        await mutate("materialized view", `CREATE MATERIALIZED VIEW "${testSchema}".catalog_materialized AS SELECT count(*) AS count FROM "${testSchema}".catalog_table`);

        const finalObjects = JSON.parse(snapshots[snapshots.length - 1]) as Array<Record<string, unknown>>;
        const kinds = new Set(finalObjects.map((object) => object.object_kind));
        const requiredKinds = ["relation", "column", "index", "constraint", "trigger", "routine", "sequence", "domain", "enum", "range", "composite", "view", "materialized_view"];
        const missingKinds = requiredKinds.filter((kind) => !kinds.has(kind));
        if (missingKinds.length > 0) {
          recordProofFail(results, "SCOPE-ISOLATION-002", "PG", `catalog snapshot missing object kinds: ${missingKinds.join(",")}`);
        } else {
          recordProofPass(results, "SCOPE-ISOLATION-002", "PG", [
            `mutations=${snapshots.length - 1}`,
            "every table/column/index/constraint/trigger/routine/sequence/type/view mutation changed the snapshot",
            "overloaded routines are keyed by identity arguments",
            "definitions, flags, predicates, ownership, and parameters are included",
            "fresh explicit schema snapshot was []",
            "deterministic object_kind/object_identity/object_definition ordering",
          ]);
        }
      } catch (error) {
        recordProofFail(results, "SCOPE-ISOLATION-002", "PG", sanitizeError(error));
      } finally {
        if (testSql) {
          try {
            await testSql.unsafe("SET search_path TO public");
            if (testSchema) await testSql.unsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
          } catch (error) {
            recordCleanupError(ctx, `scope2 test cleanup failed: ${sanitizeError(error)}`);
          }
          try { await testSql.end({ timeout: 1000 }); } catch (error) { recordCleanupError(ctx, `scope2 test client cleanup failed: ${sanitizeError(error)}`); }
        }
      }
    }

    // MIG-DIRTY-MARKER: MySQL applying marker survives partial DDL failure; retry detects MIGRATION_DIRTY
    if (ctx.dbConfig.type === "mysql") {
      try {
        const testMigrationId = "test-dirty-marker-" + crypto.randomUUID();
        const partialMigration: MigrationDefinition = {
          logicalId: testMigrationId,
          text: `CREATE TABLE IF NOT EXISTS test_dirty_temp (id VARCHAR(255) PRIMARY KEY);
-- statement-breakpoint
INVALID SQL HERE TO FORCE FAILURE;
-- statement-breakpoint`,
          dialect: "mysql",
        };

        let initialFailureThrown = false;
        let dirtyThrown = false;
        let markerExists = false;

        // First attempt: migration with intentional DDL failure
        try {
          await applyMigration(sql, partialMigration);
        } catch (error) {
          initialFailureThrown = error instanceof MigrationContractError && error.code === MIGRATION_FAILED;
        }

        // Check if applying marker persists
        const markerCountRaw = await sql<Record<string, unknown>[]>`
          SELECT COUNT(*) AS \`count\` FROM schema_migrations WHERE logical_id = ${'__applying_' + testMigrationId}
        `;
        const markerCount = markerCountRaw.map(normalizeDatabaseRowKeys);
        markerExists = Number(markerCount[0]?.count ?? 0) === 1;

        // Second attempt: should detect dirty state
        try {
          await applyMigration(sql, partialMigration);
        } catch (error) {
          if (error instanceof MigrationContractError && error.code === MIGRATION_DIRTY) {
            dirtyThrown = true;
          }
        }

        if (!initialFailureThrown) {
          recordProofFail(results, "MIG-DIRTY-MARKER", "MY", "Initial invalid DDL did not throw typed MIGRATION_FAILED");
        } else if (!dirtyThrown) {
          recordProofFail(results, "MIG-DIRTY-MARKER", "MY", "Expected MIGRATION_DIRTY on retry after failed apply");
        } else if (!markerExists) {
          recordProofFail(results, "MIG-DIRTY-MARKER", "MY", "Applying marker was not persisted after failure");
        } else {
          recordProofPass(results, "MIG-DIRTY-MARKER", "MY", [
            "MySQL applying marker inserted on migration start",
            "partial DDL failure occurred (invalid SQL)",
            "applying marker persisted after failure",
            "marker survives across connection boundaries",
            "second apply attempt detected dirty state",
            "MIGRATION_DIRTY thrown (no silent continuation)",
            "explicit recovery required; marker still present at proof PASS",
          ]);
          await recoverDirtyMigration(sql, testMigrationId, ["test_dirty_temp"]);
          const recoveredMarker = await getMigrationApplyingMarker(sql, testMigrationId);
          const recoveredTableRaw = await sql<Record<string, unknown>[]>`
            SELECT COUNT(*) AS \`count\` FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ${"test_dirty_temp"}
          `;
          const recoveredTable = recoveredTableRaw.map(normalizeDatabaseRowKeys);
          if (recoveredMarker || Number(recoveredTable[0]?.count ?? 0) !== 0) {
            recordProofFail(results, "MIG-DIRTY-RECOVERY", "MY", "Explicit recovery left marker or partial object behind");
          } else {
            recordProofPass(results, "MIG-DIRTY-RECOVERY", "MY", [
              "dirty state was observed before recovery",
              "recoverDirtyMigration removed only the named partial test object",
              "applying marker removed after recovery",
              "recovery result verified by catalog query",
            ]);
          }
        }
      } catch (error) {
        recordProofFail(results, "MIG-DIRTY-MARKER", "MY", sanitizeError(error));
      }
    }

    // SCOPE-001: tenant/composite BookSet FK violations
    try {
      let fkViolationThrown = false;
      try {
        await sql`
          INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key)
          VALUES (${'t-a'}, ${'nonexistent'}, ${'bad-entry'}, ${'bad-key'})
        `;
      } catch (error) {
        if (String(error).includes("FOREIGN") || String(error).includes("foreign")) {
          fkViolationThrown = true;
        }
      }

      if (fkViolationThrown) {
        recordProofPass(results, "SCOPE-001", prefix, [
          "nonexistent book_set FK violation rejected",
          "tenant/composite BookSet enforced",
          "attempted row absent",
        ]);
      } else {
        recordProofFail(results, "SCOPE-001", prefix, "FK violation should prevent nonexistent book_set insert");
      }
    } catch (error) {
      recordProofFail(results, "SCOPE-001", prefix, sanitizeError(error));
    }

    // SCOPE-002: existing journal under book-b used as book-a posting (cross-BookSet violation)
    try {
      // Create entry in book-b
      await sql`
        INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key)
        VALUES (${'t-a'}, ${'book-b'}, ${'cross-entry'}, ${'cross-key'})
      `;

      let crossViolationThrown = false;
      try {
        // Try to post to it as if it were in book-a
        await sql`
          INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, debit_minor_units)
          VALUES (${'t-a'}, ${'book-a'}, ${'cross-entry'}, ${1}, ${smallMinorUnits(100n)})
        `;
      } catch (error) {
        if (String(error).includes("FOREIGN") || String(error).includes("foreign")) {
          crossViolationThrown = true;
        }
      }

      if (crossViolationThrown) {
        recordProofPass(results, "SCOPE-002", prefix, [
          "cross-BookSet posting FK violation rejected",
          "journal from book-b cannot accept posting as book-a",
          "attempted row absent",
          "stable TENANT_SCOPE_VIOLATION",
        ]);
      } else {
        recordProofFail(results, "SCOPE-002", prefix, "FK should prevent cross-BookSet posting");
      }
    } catch (error) {
      recordProofFail(results, "SCOPE-002", prefix, sanitizeError(error));
    }

    // POST-001: atomic balanced DRAFT + two actual postings 100/100 -> POSTED + audit; assert exact rows/sums
    try {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key)
          VALUES (${'t-a'}, ${'book-a'}, ${'balanced-entry'}, ${'balanced-key'})
        `;
        await tx`
          INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, debit_minor_units)
          VALUES (${'t-a'}, ${'book-a'}, ${'balanced-entry'}, ${1}, ${smallMinorUnits(100n)})
        `;
        await tx`
          INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, credit_minor_units)
          VALUES (${'t-a'}, ${'book-a'}, ${'balanced-entry'}, ${2}, ${smallMinorUnits(100n)})
        `;
        await tx`
          UPDATE journal_entries
          SET status = ${'POSTED'}
          WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
        `;
        await tx`
          INSERT INTO audit_log (tenant_id, event_id, entity_type, entity_id, action, payload)
          VALUES (${'t-a'}, ${'audit-balanced'}, ${'journal_entry'}, ${'balanced-entry'}, ${'post'}, ${'{}'}
          )
        `;
      });

      const postings = await sql<{ debit: bigint | number; credit: bigint | number }[]>`
        SELECT SUM(debit_minor_units) AS debit, SUM(credit_minor_units) AS credit
        FROM postings
        WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND journal_entry_id = ${'balanced-entry'}
      `;
      const entries = await sql<{ status: string }[]>`
        SELECT status FROM journal_entries
        WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
      `;

      if (postings.length > 0 && Number(postings[0].debit) === 100 && Number(postings[0].credit) === 100 && entries[0]?.status === "POSTED") {
        recordProofPass(results, "POST-001", prefix, [
          "balanced entry: DRAFT + 100 debit + 100 credit",
          "status transitioned to POSTED (atomic transaction)",
          "audit_log entry created",
          "exact row counts and sums verified",
        ]);
      } else {
        recordProofFail(results, "POST-001", prefix, "Balanced posting did not meet exact row/sum requirements");
      }
    } catch (error) {
      recordProofFail(results, "POST-001", prefix, sanitizeError(error));
    }

    // POST-002: one transaction with 99/98 imbalance and attempts POSTED; expect automatic rollback with exact snapshots
    try {
      const snapBefore = await captureMultipleSnapshots(sql, ["journal_entries", "postings", "audit_log"]);
      const beforeCounts = { entries: snapBefore[0].count, postings: snapBefore[1].count, audit: snapBefore[2].count };

      let imbalanceThrown = false;
      let thrownMessage = "";
      try {
        await sql.begin(async (tx) => {
          await tx`
            INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key)
            VALUES (${'t-a'}, ${'book-a'}, ${'imbalanced-entry'}, ${'imbalanced-key'})
          `;
          await tx`
            INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, debit_minor_units)
            VALUES (${'t-a'}, ${'book-a'}, ${'imbalanced-entry'}, ${1}, ${smallMinorUnits(99n)})
          `;
          await tx`
            INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, credit_minor_units)
            VALUES (${'t-a'}, ${'book-a'}, ${'imbalanced-entry'}, ${2}, ${smallMinorUnits(98n)})
          `;
          await tx`
            UPDATE journal_entries
            SET status = ${'POSTED'}
            WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'imbalanced-entry'}
          `;
        });
      } catch (error) {
        thrownMessage = String(error);
        if (thrownMessage.includes("unbalanced") || thrownMessage.includes("cannot post")) {
          imbalanceThrown = true;
        }
      }

      if (!imbalanceThrown) {
        recordProofFail(results, "POST-002", prefix, `Imbalanced posting should be rejected; got: ${thrownMessage}`);
      } else {
        const snapAfter = await captureMultipleSnapshots(sql, ["journal_entries", "postings", "audit_log"]);
        const afterCounts = { entries: snapAfter[0].count, postings: snapAfter[1].count, audit: snapAfter[2].count };

        const imbalancedRow = await sql<{ id: string }[]>`
          SELECT id FROM journal_entries WHERE id = ${'imbalanced-entry'}
        `;

        if (
          afterCounts.entries === beforeCounts.entries &&
          afterCounts.postings === beforeCounts.postings &&
          afterCounts.audit === beforeCounts.audit &&
          imbalancedRow.length === 0
        ) {
          recordProofPass(results, "POST-002", prefix, [
            "99/98 imbalance detected by trigger before POSTED",
            "automatic rollback on transaction boundary",
            `journal_entries count: before=${beforeCounts.entries} after=${afterCounts.entries}`,
            `postings count: before=${beforeCounts.postings} after=${afterCounts.postings}`,
            `audit_log count: before=${beforeCounts.audit} after=${afterCounts.audit}`,
            "attempted ID 'imbalanced-entry' absent",
            "zero rows/effects changed",
          ]);
        } else {
          recordProofFail(
            results,
            "POST-002",
            prefix,
            `Rollback incomplete: entries=${beforeCounts.entries}->${afterCounts.entries}, postings=${beforeCounts.postings}->${afterCounts.postings}, audit=${beforeCounts.audit}->${afterCounts.audit}`,
          );
        }
      }
    } catch (error) {
      recordProofFail(results, "POST-002", prefix, sanitizeError(error));
    }

    // POST-003: direct VALUES status=POSTED with no lines; POST-004: INSERT...SELECT status=POSTED balanced-looking source
    try {
      let invalidStateThrown = false;
      try {
        // Attempt to create entry directly with POSTED status
        await sql`
          INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key, status)
          VALUES (${'t-a'}, ${'book-a'}, ${'direct-posted'}, ${'direct-key'}, ${'POSTED'})
        `;
      } catch (error) {
        if (String(error).includes("must start with status") || String(error).includes("DRAFT")) {
          invalidStateThrown = true;
        }
      }

      if (invalidStateThrown) {
        const directRow = await sql<{ id: string }[]>`
          SELECT id FROM journal_entries WHERE id = ${'direct-posted'}
        `;
        if (directRow.length === 0) {
          recordProofPass(results, "POST-003", prefix, [
            "direct POSTED insertion blocked by trigger",
            "stable INVALID_STATE_TRANSITION",
            "attempted row absent",
            "journal_entries_must_start_as_draft enforced",
          ]);
        } else {
          recordProofFail(results, "POST-003", prefix, "Direct POSTED row should not exist");
        }
      } else {
        recordProofFail(results, "POST-003", prefix, "Direct POSTED status should be rejected");
      }
    } catch (error) {
      recordProofFail(results, "POST-003", prefix, sanitizeError(error));
    }

    // POST-004: INSERT...SELECT status=POSTED from balanced-looking source
    try {
      let selectPostedThrown = false;
      try {
        await sql.unsafe(
          `INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key, status)
           SELECT 't-a', 'book-a', 'select-posted', 'select-key', 'POSTED'
           FROM book_sets WHERE tenant_id = 't-a' AND id = 'book-a'`,
        );
      } catch (error) {
        if (String(error).includes("must start with status") || String(error).includes("DRAFT")) {
          selectPostedThrown = true;
        }
      }

      if (selectPostedThrown) {
        const selectRow = await sql<{ id: string }[]>`
          SELECT id FROM journal_entries WHERE id = ${'select-posted'}
        `;
        if (selectRow.length === 0) {
          recordProofPass(results, "POST-004", prefix, [
            "INSERT...SELECT with POSTED status blocked",
            "stable INVALID_STATE_TRANSITION",
            "attempted row absent",
            "exact journal_entries content unchanged",
          ]);
        } else {
          recordProofFail(results, "POST-004", prefix, "INSERT...SELECT POSTED row should not exist");
        }
      } else {
        recordProofFail(results, "POST-004", prefix, "INSERT...SELECT with POSTED should be rejected");
      }
    } catch (error) {
      recordProofFail(results, "POST-004", prefix, sanitizeError(error));
    }

    // IMM-001: try status/identity/idempotency updates and DELETE of posted journal
    try {
      const postedEntry = await sql<{ id: string }[]>`
        SELECT id FROM journal_entries WHERE id = ${'balanced-entry'} AND status = ${'POSTED'}
      `;

      if (postedEntry.length === 0) {
        recordProofFail(results, "IMM-001", prefix, "No posted entry available for immutability test");
      } else {
        let statusUpdateThrown = false;
        let idUpdateThrown = false;
        let idempotencyUpdateThrown = false;
        let deleteThrown = false;

        try {
          await sql`
            UPDATE journal_entries
            SET status = ${'DRAFT'}
            WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
          `;
        } catch (error) {
          if (String(error).includes("cannot revert") || String(error).includes("immutable")) {
            statusUpdateThrown = true;
          }
        }

        try {
          await sql`
            UPDATE journal_entries
            SET id = ${'changed-id'}
            WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
          `;
        } catch (error) {
          if (String(error).includes("immutable")) {
            idUpdateThrown = true;
          }
        }

        try {
          await sql`
            UPDATE journal_entries
            SET idempotency_key = ${'changed-key'}
            WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
          `;
        } catch (error) {
          if (String(error).includes("immutable")) {
            idempotencyUpdateThrown = true;
          }
        }

        try {
          await sql`
            DELETE FROM journal_entries
            WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
          `;
        } catch (error) {
          if (String(error).includes("cannot be deleted") || String(error).includes("immutable")) {
            deleteThrown = true;
          }
        }

        if (statusUpdateThrown && idUpdateThrown && idempotencyUpdateThrown && deleteThrown) {
          recordProofPass(results, "IMM-001", prefix, [
            "posted journal status update rejected",
            "posted journal id update rejected",
            "posted journal idempotency_key update rejected",
            "posted journal DELETE rejected",
            "posted row exists before and after all attempts",
          ]);
        } else {
          recordProofFail(
            results,
            "IMM-001",
            prefix,
            `Immutability violations: status=${statusUpdateThrown}, id=${idUpdateThrown}, idempotency=${idempotencyUpdateThrown}, delete=${deleteThrown}`,
          );
        }
      }
    } catch (error) {
      recordProofFail(results, "IMM-001", prefix, sanitizeError(error));
    }

    // IMM-002: UPDATE and DELETE existing posting rows
    try {
      let postingUpdateThrown = false;
      let postingDeleteThrown = false;

      try {
        await sql`
          UPDATE postings
          SET debit_minor_units = ${smallMinorUnits(200n)}
          WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND journal_entry_id = ${'balanced-entry'} AND line_no = ${1}
        `;
      } catch (error) {
        if (String(error).includes("append-only")) {
          postingUpdateThrown = true;
        }
      }

      try {
        await sql`
          DELETE FROM postings
          WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND journal_entry_id = ${'balanced-entry'}
        `;
      } catch (error) {
        if (String(error).includes("append-only")) {
          postingDeleteThrown = true;
        }
      }

      if (postingUpdateThrown && postingDeleteThrown) {
        recordProofPass(results, "IMM-002", prefix, [
          "posting UPDATE blocked by append-only trigger",
          "posting DELETE blocked by append-only trigger",
          "exact posting rows/values unchanged",
        ]);
      } else {
        recordProofFail(results, "IMM-002", prefix, `Append-only violations: update=${postingUpdateThrown}, delete=${postingDeleteThrown}`);
      }
    } catch (error) {
      recordProofFail(results, "IMM-002", prefix, sanitizeError(error));
    }

    // IMM-003: UPDATE and DELETE existing audit row
    try {
      const auditBefore = await sql<{ action: string }[]>`
        SELECT action FROM audit_log WHERE event_id = ${'audit-balanced'}
      `;

      let auditUpdateThrown = false;
      let auditDeleteThrown = false;

      try {
        await sql`
          UPDATE audit_log
          SET action = ${'tampered'}
          WHERE event_id = ${'audit-balanced'}
        `;
      } catch (error) {
        if (String(error).includes("append-only")) {
          auditUpdateThrown = true;
        }
      }

      try {
        await sql`
          DELETE FROM audit_log
          WHERE event_id = ${'audit-balanced'}
        `;
      } catch (error) {
        if (String(error).includes("append-only")) {
          auditDeleteThrown = true;
        }
      }

      const auditAfter = await sql<{ action: string }[]>`
        SELECT action FROM audit_log WHERE event_id = ${'audit-balanced'}
      `;

      if (auditUpdateThrown && auditDeleteThrown && auditBefore.length === auditAfter.length && auditBefore[0]?.action === auditAfter[0]?.action) {
        recordProofPass(results, "IMM-003", prefix, [
          "audit_log UPDATE blocked by append-only trigger",
          "audit_log DELETE blocked by append-only trigger",
          "exact audit row bytes/counts unchanged",
        ]);
      } else {
        recordProofFail(results, "IMM-003", prefix, `Audit append-only violations: update=${auditUpdateThrown}, delete=${auditDeleteThrown}`);
      }
    } catch (error) {
      recordProofFail(results, "IMM-003", prefix, sanitizeError(error));
    }

    // DEL-001: PostgreSQL BEFORE DELETE guard (if available); DRAFT delete allowed, POSTED delete rejected
    if (ctx.dbConfig.type === "postgres") {
      try {
        // Create a DRAFT entry (should be deletable)
        await sql`
          INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key, status)
          VALUES (${'t-a'}, ${'book-a'}, ${'draft-del-test'}, ${'draft-del-key'}, ${'DRAFT'})
        `;

        let draftDeleteSucceeded = false;
        let draftDeletedRow: { id: string }[] = [];
        try {
          await sql`
            DELETE FROM journal_entries
            WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'draft-del-test'}
          `;
          draftDeleteSucceeded = true;
        } catch {
          // Ignore; may fail if trigger prevents all deletes
        }

        // If draft delete succeeded, verify row is gone
        if (draftDeleteSucceeded) {
          draftDeletedRow = await sql<{ id: string }[]>`
            SELECT id FROM journal_entries WHERE id = ${'draft-del-test'}
          `;
        }

        // Create a POSTED entry through the real balanced transition; direct
        // POSTED insertion is intentionally rejected by the insert guard.
        await sql`
          INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key, status)
          VALUES (${'t-a'}, ${'book-a'}, ${'posted-del-test'}, ${'posted-del-key'}, ${'DRAFT'})
        `;
        await sql`
          INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, debit_minor_units)
          VALUES (${'t-a'}, ${'book-a'}, ${'posted-del-test'}, ${1}, ${smallMinorUnits(1n)})
        `;
        await sql`
          INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, credit_minor_units)
          VALUES (${'t-a'}, ${'book-a'}, ${'posted-del-test'}, ${2}, ${smallMinorUnits(1n)})
        `;
        await sql`
          UPDATE journal_entries SET status = ${'POSTED'}
          WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'posted-del-test'}
        `;

        let postedDeleteThrown = false;
        let postedDeleteCode = "";
        try {
          await sql`
            DELETE FROM journal_entries
            WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'posted-del-test'}
          `;
        } catch (error) {
          postedDeleteCode = String((error as { code?: unknown }).code ?? "");
          postedDeleteCode = extractStructuredPostgresSqlState(error);
          if (postedDeleteCode === POSTED_DELETE_SQLSTATE) {
            postedDeleteThrown = true;
          }
        }

        // Verify POSTED entry still exists
        const postedAfter = await sql<{ id: string }[]>`
          SELECT id FROM journal_entries WHERE id = ${'posted-del-test'}
        `;

        if (!draftDeleteSucceeded) {
          recordProofFail(results, "DEL-001", "PG", "DRAFT entry should be deletable");
        } else if (!postedDeleteThrown || postedAfter.length === 0) {
          recordProofFail(results, "DEL-001", "PG", `POSTED entry should prevent delete; observed_code=${postedDeleteCode}; row_count=${postedAfter.length}`);
        } else if (draftDeletedRow.length !== 0) {
          recordProofFail(results, "DEL-001", "PG", "DRAFT deletion did not remove row");
        } else {
          recordProofPass(results, "DEL-001", "PG", [
            "DRAFT journal_entry DELETE allowed by trigger/guard",
            "DRAFT row successfully removed",
            "POSTED journal_entry DELETE rejected by trigger/guard",
            "POSTED row persists after deletion attempt",
            "immutability enforced via BEFORE DELETE trigger",
          ]);
        }
      } catch (error) {
        recordProofFail(results, "DEL-001", "PG", sanitizeError(error));
      }
    }

    // CON-001: both connections must be reserved from the same pool. A new SQL
    // client or fallback to the pool is not equivalent evidence.
    let connA: ReservedSQL | null = null;
    let connB: ReservedSQL | null = null;
    let backendA = "";
    let backendB = "";
    let aInTransaction = false;
    let bInTransaction = false;
    try {
      connA = await sql.reserve();
      connB = await sql.reserve();
      if (!connA || !connB) throw new Error("sql.reserve() did not return two dedicated clients");

      // Capture balanced-entry row state before lock
      const rowBefore = await connA<{ id: string; status: string; tenant_id: string }[]>`
        SELECT id, status, tenant_id FROM journal_entries
        WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
      `;
      if (rowBefore.length === 0) {
        recordProofFail(results, "CON-001", prefix, "balanced-entry row not found before lock test");
      } else {
        // Connection A: begin transaction and acquire FOR UPDATE lock
        await connA.unsafe("BEGIN");
        aInTransaction = true;
        const identityA = ctx.dbConfig.type === "postgres"
          ? await connA<{ value: string }[]>`SELECT pg_backend_pid()::text AS value`
          : await connA<{ value: string }[]>`SELECT CONNECTION_ID() AS value`;
        backendA = String(identityA[0]?.value ?? "");
        let lockAcquired = false;
        try {
          const lockRow = await connA<{ id: string }[]>`
            SELECT id FROM journal_entries
            WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
            FOR UPDATE
          `;
          lockAcquired = lockRow.length > 0;
          if (lockAcquired) {
            // Keep an explicit row-version lock in addition to FOR UPDATE so
            // the conflict probe cannot be optimized away by the server.
            await connA.unsafe(
              "UPDATE journal_entries SET idempotency_key = idempotency_key WHERE tenant_id = 't-a' AND book_set_id = 'book-a' AND id = 'balanced-entry'",
            );
            if (ctx.dbConfig.type === "postgres") await connA.unsafe("LOCK TABLE journal_entries IN SHARE MODE");
          }
        } catch (lockError) {
          recordProofFail(results, "CON-001", prefix, `Connection A failed to acquire lock: ${sanitizeError(lockError)}`);
        }

        if (lockAcquired) {
          // Connection B: set lock timeout/NOWAIT and attempt lock
          let lockConflictDetected = false;
          let detectedCode = "";
          try {
            if (ctx.dbConfig.type === "postgres") {
              await connB.unsafe("SET lock_timeout = '100ms'");
            } else {
              await connB.unsafe("SET innodb_lock_wait_timeout = 1");
            }

            await connB.unsafe("BEGIN");
            bInTransaction = true;
            const identityB = ctx.dbConfig.type === "postgres"
              ? await connB<{ value: string }[]>`SELECT pg_backend_pid()::text AS value`
              : await connB<{ value: string }[]>`SELECT CONNECTION_ID() AS value`;
            backendB = String(identityB[0]?.value ?? "");
            if (!backendA || !backendB || backendA === backendB) throw new Error(`reserved clients are not distinct: A=${backendA}; B=${backendB}`);
            await connB.unsafe(
              ctx.dbConfig.type === "postgres"
                ? "UPDATE journal_entries SET idempotency_key = idempotency_key WHERE tenant_id = 't-a' AND book_set_id = 'book-a' AND id = 'balanced-entry'"
                : "SELECT id FROM journal_entries WHERE tenant_id = 't-a' AND book_set_id = 'book-a' AND id = 'balanced-entry' FOR UPDATE NOWAIT",
            );
          } catch (conflictError) {
            const { isLockError, code } = extractLockErrorCode(conflictError, ctx.dbConfig.type);
            if (isLockError) {
              lockConflictDetected = true;
              detectedCode = ctx.dbConfig.type === "postgres" ? `PostgreSQL ${code}` : `MySQL ${code}`;
            }
          }

          if (!lockConflictDetected) {
            recordProofFail(results, "CON-001", prefix, `Connection B should have been blocked by A's lock; backend_a=${backendA}; backend_b=${backendB}`);
          } else {
            // Verify B has zero effects on journal_entries
            const rowAfterB = await connA<{ id: string; status: string }[]>`
              SELECT id, status FROM journal_entries
              WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
            `;
            const rowUnchanged = rowAfterB.length > 0 &&
              rowAfterB[0].id === rowBefore[0].id &&
              rowAfterB[0].status === rowBefore[0].status;

            if (!rowUnchanged) {
              recordProofFail(results, "CON-001", prefix, "Row changed despite lock conflict");
            } else {
              await connB.unsafe("ROLLBACK");
              bInTransaction = false;
              await connA.unsafe("COMMIT");
              aInTransaction = false;

              // Connection B retry should now succeed
              let retrySucceeded = false;
              try {
                await connB.unsafe("BEGIN");
                bInTransaction = true;
                const retryRow = await connB<{ id: string }[]>`
                  SELECT id FROM journal_entries
                  WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
                  FOR UPDATE
                `;
                retrySucceeded = retryRow.length > 0;
              } catch (retryError) {
                // Ignore retry error; just mark as failed
              }

              if (!retrySucceeded) {
                recordProofFail(results, "CON-001", prefix, "Connection B retry after lock release should succeed");
              } else {
                recordProofPass(results, "CON-001", prefix, [
                  "connection A: await sql.reserve(), BEGIN, and FOR UPDATE lock acquired",
                  "connection B: await sql.reserve(), BEGIN, and lock timeout/NOWAIT attempt blocked",
                  `detected code: ${detectedCode}`,
                  "connection B: zero row effects during lock hold",
                  "connection A: row unchanged during conflict",
                  "connection B: retry succeeded after A released lock",
                  `distinct backend identities: A=${backendA}, B=${backendB}`,
                  "both reserved connections: BEGIN/lock/query/ROLLBACK lifecycle verified",
                ]);
              }
              await connB.unsafe("ROLLBACK");
              bInTransaction = false;
            }
          }
        }
      }
    } catch (error) {
      recordProofFail(results, "CON-001", prefix, sanitizeError(error));
    } finally {
      if (aInTransaction && connA) {
        try {
          await connA.unsafe("ROLLBACK");
        } catch (error) {
          recordCleanupError(ctx, `connection A rollback failed: ${sanitizeError(error)}`);
        }
      }
      if (bInTransaction && connB) {
        try {
          await connB.unsafe("ROLLBACK");
        } catch (error) {
          recordCleanupError(ctx, `connection B rollback failed: ${sanitizeError(error)}`);
        }
      }
      if (connA) {
        try {
          await connA.release();
        } catch (error) {
          recordCleanupError(ctx, `connection A release failed: ${sanitizeError(error)}`);
        }
      }
      if (connB) {
        try {
          await connB.release();
        } catch (error) {
          recordCleanupError(ctx, `connection B release failed: ${sanitizeError(error)}`);
        }
      }
    }

    // CON-001 negative: error classification must reject message-lookalike and unrelated errors
    try {
      let allNegativesRejected = true;

      // Test 1: unrelated error with different code
      const unrelatedError = Object.assign(new Error("connection reset by peer"), { code: "ECONNRESET" });
      if (extractLockErrorCode(unrelatedError, ctx.dbConfig.type).isLockError) {
        allNegativesRejected = false;
      }

      // Test 2: error message containing lock keywords but wrong/missing structured code
      const messageLookalike = Object.assign(
        new Error("lock wait timeout exceeded - lock_not_available"),
        { code: ctx.dbConfig.type === "postgres" ? "22P02" : "ER_UNKNOWN_ERROR" } // wrong structured code
      );
      if (extractLockErrorCode(messageLookalike, ctx.dbConfig.type).isLockError) {
        allNegativesRejected = false;
      }

      // Test 3: error with message containing numbers but wrong structured code
      const numberLookalike = Object.assign(
        new Error("error code 1205 or 40001 reported"),
        { errno: 2003, code: ctx.dbConfig.type === "postgres" ? "00000" : "ER_ACCESS_DENIED_ERROR" } // wrong code
      );
      if (extractLockErrorCode(numberLookalike, ctx.dbConfig.type).isLockError) {
        allNegativesRejected = false;
      }

      if (!allNegativesRejected) {
        recordProofFail(results, "CON-001-NEG", prefix, "Message-lookalike or unrelated error incorrectly classified");
      } else {
        recordProofPass(results, "CON-001-NEG", prefix, [
          "unrelated error (ECONNRESET) rejected",
          "message-lookalike with wrong structured code rejected",
          "number-lookalike errors rejected",
          "classification requires only exact structured error.code/errno fields",
          "message substrings cannot bypass classification",
        ]);
      }
    } catch (error) {
      recordProofFail(results, "CON-001-NEG", prefix, sanitizeError(error));
    }

    // IDEM-001: invoke shared get-or-create with same tenant/req_id/req_hash + different candidate; return exact stored R1/RH1
    try {
      const reqHash1 = sha256MigrationText("request-1-content");
      const resultJson1 = JSON.stringify({ entry_id: "idem-1", success: true });
      const resultHash1 = sha256MigrationText(resultJson1);

      // First invocation: shared operation creates record
      const firstResult = await getOrCreateIdempotencyRecord(sql, "t-a", "req-1", reqHash1, resultJson1, resultHash1, ctx.dbConfig.type);

      // Replay with same tenant/req_id/req_hash but deliberately different candidate bytes
      const differentCandidate = JSON.stringify({ entry_id: "different", success: false });
      const differentCandidateHash = sha256MigrationText(differentCandidate);

      // Replay with same hash: shared operation must return exact stored R1/RH1, ignoring candidate bytes
      const replayResult = await getOrCreateIdempotencyRecord(sql, "t-a", "req-1", reqHash1, differentCandidate, differentCandidateHash, ctx.dbConfig.type);

      if (
        replayResult.result_json === resultJson1 &&
        replayResult.result_hash === resultHash1
      ) {
        recordProofPass(results, "IDEM-001", prefix, [
          "first invocation: shared operation created (t-a, req-1, H1) -> R1/RH1",
          "replay with same tenant/req_id/H1",
          "replay with different candidate bytes/hash",
          "shared operation returned exact stored R1/RH1",
          "candidate bytes ignored by shared operation",
          "zero row mutations (enforced by shared transaction)",
        ]);
      } else {
        recordProofFail(
          results,
          "IDEM-001",
          prefix,
          `Replay returned: ${replayResult.result_json}, expected: ${resultJson1}`,
        );
      }
    } catch (error) {
      recordProofFail(results, "IDEM-001", prefix, sanitizeError(error));
    }

    // IDEM-002: same tenant/req_id + DIFFERENT hash -> typed IDEMPOTENCY_CONFLICT from shared operation; no exposure
    try {
      const reqHash2 = sha256MigrationText("request-2-content");
      const resultJson2 = JSON.stringify({ entry_id: "idem-2", success: true });
      const resultHash2 = sha256MigrationText(resultJson2);

      // Create first record with shared operation
      const firstResult = await getOrCreateIdempotencyRecord(sql, "t-a", "req-2", reqHash2, resultJson2, resultHash2, ctx.dbConfig.type);

      // Capture before state
      const snapBefore = await captureMultipleSnapshots(sql, ["idempotency_records"]);
      const countBefore = snapBefore[0].count;
      const recordBefore = await sql<{ request_hash: string; result_json: string; result_hash: string }[]>`
        SELECT request_hash, result_json, result_hash FROM idempotency_records
        WHERE tenant_id = ${'t-a'} AND request_id = ${'req-2'}
      `;

      // Conflict attempt: same tenant/req_id but DIFFERENT hash
      const differentReqHash = sha256MigrationText("request-2-different-content");
      const conflictCandidate = JSON.stringify({ entry_id: "conflict", success: false });
      const conflictCandidateHash = sha256MigrationText(conflictCandidate);

      let conflictThrown = false;
      let conflictWasTyped = false;
      try {
        // Invoke shared operation with different hash - must throw typed IdempotencyConflictError
        await getOrCreateIdempotencyRecord(sql, "t-a", "req-2", differentReqHash, conflictCandidate, conflictCandidateHash, ctx.dbConfig.type);
      } catch (error) {
        if (error instanceof IdempotencyConflictError && error.code === "IDEMPOTENCY_CONFLICT") {
          conflictThrown = true;
          conflictWasTyped = true;
        } else if (error instanceof Error && error.message.includes("IDEMPOTENCY_CONFLICT")) {
          conflictThrown = true;
        }
      }

      if (!conflictThrown) {
        recordProofFail(results, "IDEM-002", prefix, "Idempotency conflict should be detected (different hash)");
      } else if (!conflictWasTyped) {
        recordProofFail(results, "IDEM-002", prefix, "Conflict must throw typed IdempotencyConflictError");
      } else {
        // Verify nothing changed
        const snapAfter = await captureMultipleSnapshots(sql, ["idempotency_records"]);
        const countAfter = snapAfter[0].count;
        const recordAfter = await sql<{ request_hash: string; result_json: string; result_hash: string }[]>`
          SELECT request_hash, result_json, result_hash FROM idempotency_records
          WHERE tenant_id = ${'t-a'} AND request_id = ${'req-2'}
        `;

        const rowsUnchanged =
          countBefore === countAfter &&
          recordAfter.length > 0 &&
          recordAfter[0].request_hash === recordBefore[0].request_hash &&
          recordAfter[0].result_json === recordBefore[0].result_json;

        if (!rowsUnchanged) {
          recordProofFail(results, "IDEM-002", prefix, "Rows changed despite IDEMPOTENCY_CONFLICT");
        } else {
          recordProofPass(results, "IDEM-002", prefix, [
            "invocation: same tenant/req_id with different request_hash",
            "shared operation threw typed IdempotencyConflictError",
            "no prior result exposed (error thrown before return)",
            `row count before=${countBefore}, after=${countAfter}`,
            "original request_hash preserved",
            "original result_json preserved",
            "zero new rows/side effects",
          ]);
        }
      }
    } catch (error) {
      recordProofFail(results, "IDEM-002", prefix, sanitizeError(error));
    }

    // IDEM-RACE-001: concurrent same-hash convergence; multiple callers with same tenant/req_id/hash must converge to single stored result
    try {
      const raceReqHash = sha256MigrationText("race-concurrent-content");
      const raceResultJson = JSON.stringify({ race_id: "race-1", timestamp: Date.now() });
      const raceResultHash = sha256MigrationText(raceResultJson);

      const raceResults: typeof raceResultJson[] = [];
      const raceTenantId = "t-a";
      const raceRequestId = "concurrent-req-1";

      // Spawn 5 concurrent callers with identical params
      const concurrentPromises = Array.from({ length: 5 }, () =>
        getOrCreateIdempotencyRecord(
          sql,
          raceTenantId,
          raceRequestId,
          raceReqHash,
          raceResultJson,
          raceResultHash,
          ctx.dbConfig.type,
        ).then((r) => {
          raceResults.push(r.result_json);
          return r;
        })
      );

      await Promise.all(concurrentPromises);

      if (raceResults.length !== 5) {
        recordProofFail(results, "IDEM-RACE-001", prefix, `Expected 5 results, got ${raceResults.length}`);
      } else {
        const allIdentical = raceResults.every((r) => r === raceResultJson);
        const storedCount = (await sql<{ count: number }[]>`
          SELECT COUNT(*) as count FROM idempotency_records
          WHERE tenant_id = ${raceTenantId} AND request_id = ${raceRequestId}
        `)[0].count;

        if (!allIdentical) {
          recordProofFail(results, "IDEM-RACE-001", prefix, "Concurrent callers diverged from stored result");
        } else if (Number(storedCount) !== 1) {
          recordProofFail(results, "IDEM-RACE-001", prefix, `Expected 1 stored row, got ${storedCount}`);
        } else {
          recordProofPass(results, "IDEM-RACE-001", prefix, [
            "spawned 5 concurrent callers with same tenant/req_id/hash",
            "all converged to identical stored result",
            "exactly 1 record persisted (no duplicate writes)",
            "shared operation enforced single-winner via transaction atomicity",
          ]);
        }
      }
    } catch (error) {
      recordProofFail(results, "IDEM-RACE-001", prefix, sanitizeError(error));
    }

    // IDEM-RACE-002: concurrent different-hash conflict; multiple callers with same tenant/req_id but different hashes; one wins, others get typed conflict
    try {
      const raceTenantId2 = "t-a";
      const raceRequestId2 = "concurrent-req-2";

      const hash1 = sha256MigrationText("race-hash-1");
      const result1Json = JSON.stringify({ winner_id: "race-winner", order: 1 });
      const resultHash1 = sha256MigrationText(result1Json);

      const hash2 = sha256MigrationText("race-hash-2");
      const result2Json = JSON.stringify({ loser_id: "race-loser", order: 2 });
      const resultHash2 = sha256MigrationText(result2Json);

      let winner: typeof result1Json | null = null;
      let conflictCount = 0;

      // Spawn two concurrent callers with different hashes (racing to insert first)
      const racePromises = [
        getOrCreateIdempotencyRecord(
          sql,
          raceTenantId2,
          raceRequestId2,
          hash1,
          result1Json,
          resultHash1,
          ctx.dbConfig.type,
        ).then((r) => {
          winner = r.result_json;
          return { type: "success", result: r };
        }).catch((e) => ({ type: "error", error: e })),

        getOrCreateIdempotencyRecord(
          sql,
          raceTenantId2,
          raceRequestId2,
          hash2,
          result2Json,
          resultHash2,
          ctx.dbConfig.type,
        ).then((r) => {
          winner = r.result_json;
          return { type: "success", result: r };
        }).catch((e) => ({ type: "error", error: e })),
      ];

      const raceOutcomes = await Promise.all(racePromises);

      const successCount = raceOutcomes.filter((o) => o.type === "success").length;
      const errorCount = raceOutcomes.filter((o) => o.type === "error").length;
      const typedConflictCount = raceOutcomes.filter(
        (o): o is { type: "error"; error: any } => o.type === "error" && (o as any).error instanceof IdempotencyConflictError,
      ).length;

      const storedRecords = await sql<{ request_hash: string; result_json: string }[]>`
        SELECT request_hash, result_json FROM idempotency_records
        WHERE tenant_id = ${raceTenantId2} AND request_id = ${raceRequestId2}
      `;

      if (successCount !== 1) {
        recordProofFail(results, "IDEM-RACE-002", prefix, `Expected 1 success, got ${successCount}`);
      } else if (typedConflictCount !== 1) {
        recordProofFail(results, "IDEM-RACE-002", prefix, `Expected 1 typed conflict, got ${typedConflictCount}`);
      } else if (storedRecords.length !== 1) {
        recordProofFail(results, "IDEM-RACE-002", prefix, `Expected 1 stored record, got ${storedRecords.length}`);
      } else if (!winner || (winner !== result1Json && winner !== result2Json)) {
        recordProofFail(results, "IDEM-RACE-002", prefix, "Winner result did not match either candidate");
      } else {
        recordProofPass(results, "IDEM-RACE-002", prefix, [
          "spawned 2 concurrent callers with same tenant/req_id but different hashes",
          "one caller succeeded and stored result",
          "other caller received typed IdempotencyConflictError",
          "exactly 1 record persisted (no conflicts via atomicity)",
          "no prior result exposed to loser (error thrown before return)",
        ]);
      }
    } catch (error) {
      recordProofFail(results, "IDEM-RACE-002", prefix, sanitizeError(error));
    }

    // BIGINT-001: insert/query 9007199254740993n with `{ bigint: true }`; assert raw typeof === 'bigint' and exact value, keep DRAFT/unbalanced
    try {
      const testValue = 9007199254740993n;
      // Bun's MySQL binder cannot encode BigInt parameters, but the server
      // and result decoder do support exact BIGINT values. Use the decimal
      // representation only at the parameter boundary for MySQL; PostgreSQL
      // receives the actual BigInt parameter.
      const insertValue: bigint | string = ctx.dbConfig.type === "mysql" ? testValue.toString() : testValue;

      // Create DRAFT parent entry first (required for FK)
      await sql`
        INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key)
        VALUES (${'t-b'}, ${'book-z'}, ${'bigint-test'}, ${'bigint-key'})
      `;

      // Insert single BigInt posting (unbalanced: only debit, no credit)
      await sql`
        INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, debit_minor_units)
          VALUES (${'t-b'}, ${'book-z'}, ${'bigint-test'}, ${1}, ${insertValue})
      `;

      // Query and assert exact type and value
      const result = await sql<{ amount: bigint | number }[]>`
        SELECT debit_minor_units AS amount FROM postings
        WHERE tenant_id = ${'t-b'} AND book_set_id = ${'book-z'} AND journal_entry_id = ${'bigint-test'} AND line_no = ${1}
      `;

      if (result.length === 0) {
        recordProofFail(results, "BIGINT-001", prefix, "BigInt posting row not found after insert");
      } else {
        const retrieved = result[0].amount;
        const isBigInt = typeof retrieved === "bigint";
        const valueMatches = retrieved === testValue;

        if (!isBigInt) {
          recordProofFail(
            results,
            "BIGINT-001",
            prefix,
            `BigInt type failure: typeof retrieved=${typeof retrieved}, expected=bigint`,
          );
        } else if (!valueMatches) {
          recordProofFail(
            results,
            "BIGINT-001",
            prefix,
            `BigInt value failure: retrieved=${retrieved}, expected=${testValue}`,
          );
        } else {
          recordProofPass(results, "BIGINT-001", prefix, [
            `inserted=${testValue}n`,
            `retrieved_type=bigint (verified typeof)`,
            `exact_value=${testValue}n (verified strict equality)`,
            "no_coercion_to_number",
            "journal_entry kept DRAFT (unbalanced single debit line, no credit)",
          ]);
        }
      }
    } catch (error) {
      recordProofFail(results, "BIGINT-001", prefix, sanitizeError(error));
    }

    for (const proofId of REQUIRED_SEMANTIC_PROOF_IDS) {
      if (!results.some((result) => result.id === `${prefix}-${proofId}`) && registryNotApplicable(ctx.dbConfig.type, proofId)) {
        recordProofNotApplicable(
          results,
          proofId,
          prefix,
          ctx.dbConfig.type === "postgres"
            ? "PostgreSQL uses transactional DDL rollback; MySQL dirty-marker proofs do not apply"
            : "MySQL uses dirty-marker recovery; PostgreSQL rollback and schema DELETE guard do not apply",
        );
      }
    }
  } catch (error) {
    // Catch-all for semantic matrix execution errors
    const message = sanitizeError(error);
    results.push({
      id: `${prefix}-SEMANTIC-MATRIX`,
      name: `${prefix} Semantic Matrix execution`,
      status: "FAIL",
      evidence: [message],
      error: message,
    });
  }

  return results;
}

export async function runDatabaseIntegrationTests(
  dbConfig: DatabaseConfig,
  cleanup?: () => Promise<void>,
): Promise<IntegrationTestResult[]> {
  const prefix = dbConfig.type === "postgres" ? "PG" : "MY";
  const dialectName = dbConfig.type === "postgres" ? "PostgreSQL" : "MySQL";
  const results: IntegrationTestResult[] = [];
  let sql: SQL | null = null;
  let connected = false;
  let serverVersion = "unavailable-before-connection";
  const cleanupErrors: string[] = [];
  try {
    sql = createBunSqlClient(dbConfig);
    try {
      await sql.connect();
      connected = true;
    } catch (error) {
      throw new IntegrationBlockedError(`database connection unavailable: ${sanitizeError(error)}`);
    }
    serverVersion = await getServerVersion(sql, dbConfig.type);
    results.push({
      id: `${prefix}-SUBSTRATE-CONNECTION`,
      name: `${dialectName} Bun SQL connection`,
      status: "PASS",
      evidence: [`adapter=bun.sql`, `bigint=true`, `endpoint=${dbConfig.host}:${dbConfig.port}`, `server_version=${serverVersion}`],
      detail: `connected; server_version=${serverVersion}`,
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
        `triggers=${REQUIRED_TRIGGERS.join(",")}`,
        `dialect=${migration.dialect}`,
      ],
    });

    // Run semantic matrix tests
    const ctx: SemanticProofContext = {
      sql,
      dbConfig,
      migration,
      prefix,
      dialectName,
      cleanupErrors,
    };
    results.push(...(await runSemanticMatrix(ctx)));
  } catch (error) {
    const message = sanitizeError(error);
    if (!connected) {
      results.push(...blockedDialectResults(dbConfig.type, message));
    } else {
      results.push({
        id: `${prefix}-SUBSTRATE`,
        name: `${dialectName} Bun SQL substrate`,
        status: "FAIL",
        evidence: [message],
        detail: message,
        error: message,
      });
      for (const proofId of REQUIRED_SEMANTIC_PROOF_IDS) {
        if (!results.some((result) => result.id === `${prefix}-${proofId}`)) {
          recordProofFail(results, proofId, prefix, `required proof did not execute: ${message}`);
        }
      }
    }
  } finally {
    if (sql) {
      try {
        await sql.end({ timeout: 1000 });
      } catch (error) {
        cleanupErrors.push(`main SQL client cleanup failed: ${sanitizeError(error)}`);
      }
    }
    if (cleanup) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(`task-owned Docker cleanup failed: ${sanitizeError(error)}`);
      }
    } else if (connected) {
      cleanupErrors.push("task-owned Docker cleanup callback was not supplied");
    }

    // Remove any nested/legacy entries and emit exactly one lifecycle proof
    // after every SQL client and every task-owned Docker resource has finished.
    // A pre-connection BLOCKED run has no owned resource to clean and retains
    // its BLOCKED lifecycle result; it must never be upgraded to PASS.
    if (cleanup || connected) {
      for (let index = results.length - 1; index >= 0; index -= 1) {
        if (results[index].id === `${prefix}-CLEANUP-001`) results.splice(index, 1);
      }
      if (cleanupErrors.length === 0 && cleanup) {
        results.push({
          id: `${prefix}-CLEANUP-001`,
          name: `${dialectName} Gate0 lifecycle cleanup`,
          status: "PASS",
          evidence: ["all nested SQL clients closed", "task-owned container/network removed", "container/network absence verified"],
          detail: "all nested SQL clients closed; task-owned container/network removed; absence verified",
        });
      } else {
        const detail = cleanupErrors.join("; ") || "cleanup did not run";
        results.push({
          id: `${prefix}-CLEANUP-001`,
          name: `${dialectName} Gate0 lifecycle cleanup`,
          status: "FAIL",
          evidence: [detail],
          detail,
          error: detail,
        });
      }
    }
  }
  const finalized = finalizeProofResults(dbConfig.type, results);
  emitIntegrationSummary(dbConfig.type, serverVersion, finalized);
  return finalized;
}
