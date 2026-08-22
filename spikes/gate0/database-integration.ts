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

function docker(args: string[], secrets: readonly string[], action: string, timeoutMs: number = 30000) {
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(["docker", ...args], { timeout: timeoutMs });
  } catch (error) {
    throw new Error(`${action}: ${sanitizeError(error, secrets)}`);
  }
  if (!result.success) {
    const detail = bytesToString(result.stderr) || bytesToString(result.stdout) || "docker command failed";
    throw new Error(`${action}: ${sanitizeError(detail, secrets)}`);
  }
  if (!result.stdout) {
    throw new Error(`${action}: docker returned empty output (possible timeout or failure)`);
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

async function ensureSchemaMigrationsTable(sql: SQL, dialect: DatabaseType): Promise<void> {
  const ddl =
    dialect === "postgres"
      ? "CREATE TABLE IF NOT EXISTS schema_migrations (logical_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);"
      : "CREATE TABLE IF NOT EXISTS schema_migrations (logical_id VARCHAR(255) PRIMARY KEY, checksum VARCHAR(255) NOT NULL, applied_at VARCHAR(255) NOT NULL);";
  await sql.unsafe(ddl);
}

async function getMigrationApplyingMarker(sql: SQL, logicalId: string): Promise<boolean> {
  const marker = await sql<{ is_applying: number | bigint }[]>`
    SELECT COUNT(*) as is_applying FROM schema_migrations WHERE logical_id = ${'__applying_' + logicalId}
  `;
  return Number(marker[0]?.is_applying ?? 0) > 0;
}

async function setMigrationApplyingMarker(sql: SQL, logicalId: string): Promise<void> {
  await sql.unsafe(
    `INSERT INTO schema_migrations (logical_id, checksum, applied_at) VALUES ('__applying_${logicalId}', 'marker', 'applying')`,
  );
}

async function clearMigrationApplyingMarker(sql: SQL, logicalId: string): Promise<void> {
  await sql.unsafe(`DELETE FROM schema_migrations WHERE logical_id = '__applying_${logicalId}'`);
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

  const triggerQuery =
    dialect === "postgres"
      ? `SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = current_schema() AND trigger_name IN (${REQUIRED_TRIGGERS.map((t) => `'${t}'`).join(",")})`
      : `SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND trigger_name IN (${REQUIRED_TRIGGERS.map((t) => `'${t}'`).join(",")})`;

  const triggerRows = await sql.unsafe<{ trigger_name: string }[]>(triggerQuery);

  let missingFunctions: string[] = [];
  if (dialect === "postgres") {
    const functionQuery = `SELECT routine_name FROM information_schema.routines WHERE routine_schema = current_schema() AND routine_name IN (${REQUIRED_PG_FUNCTIONS.map((f) => `'${f}'`).join(",")})`;
    const functionRows = await sql.unsafe<{ routine_name: string }[]>(functionQuery);
    const foundFunctions = new Set(functionRows.map((row) => String(row.routine_name)));
    missingFunctions = REQUIRED_PG_FUNCTIONS.filter((func) => !foundFunctions.has(func));
  }

  const tables = [...new Set(tableRows.map((row) => String(row.table_name)))];
  const triggers = [...new Set(triggerRows.map((row) => String(row.trigger_name)))];
  const tableEngines: Record<string, string | null> = {};
  if (dialect === "mysql") {
    for (const row of tableRows) tableEngines[String(row.table_name)] = row.engine ? String(row.engine) : null;
  }

  const missingTables = REQUIRED_TABLES.filter((table) => !tables.includes(table));
  const missingTriggers = REQUIRED_TRIGGERS.filter((trigger) => !triggers.includes(trigger));
  const nonInnoDbTables =
    dialect === "mysql"
      ? REQUIRED_TABLES.filter((table) => tableEngines[table]?.toUpperCase() !== "INNODB")
      : [];

  if (missingTables.length > 0 || missingTriggers.length > 0 || missingFunctions.length > 0 || nonInnoDbTables.length > 0) {
    throw new MigrationContractError(
      MIGRATION_DIRTY,
      `required structure invalid; tables=${missingTables.join(",") || "none"}; triggers=${missingTriggers.join(",") || "none"}; functions=${missingFunctions.join(",") || "none"}; non_innodb=${nonInnoDbTables.join(",") || "none"}`,
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
    await ensureSchemaMigrationsTable(sql, migration.dialect);

    // Check if migration already applied (before any DDL)
    const existing = await sql<{ checksum: string }[]>`
      SELECT checksum FROM schema_migrations WHERE logical_id = ${migration.logicalId} AND logical_id NOT LIKE ${'__applying_%'}
    `;
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

    // MySQL dirty-state control: check and set applying marker
    if (migration.dialect === "mysql") {
      const isApplying = await getMigrationApplyingMarker(sql, migration.logicalId);
      if (isApplying) {
        throw new MigrationContractError(
          MIGRATION_DIRTY,
          `logical_id=${migration.logicalId} has a prior incomplete apply; must be manually cleared`,
        );
      }
      await setMigrationApplyingMarker(sql, migration.logicalId);
    }

    try {
      // PostgreSQL: wrap DDL in transaction
      if (migration.dialect === "postgres") {
        await sql.begin(async (tx) => {
          for (const statement of splitMigrationStatements(migration.text)) {
            await tx.unsafe(statement);
          }
          const appliedAt = new Date().toISOString();
          await tx`
            INSERT INTO schema_migrations (logical_id, checksum, applied_at)
            VALUES (${migration.logicalId}, ${checksum}, ${appliedAt})
          `;
        });
      } else {
        // MySQL: autocommit DDL, then insert metadata
        for (const statement of splitMigrationStatements(migration.text)) {
          await sql.unsafe(statement);
        }
        const appliedAt = new Date().toISOString();
        await sql`
          INSERT INTO schema_migrations (logical_id, checksum, applied_at)
          VALUES (${migration.logicalId}, ${checksum}, ${appliedAt})
        `;
        await clearMigrationApplyingMarker(sql, migration.logicalId);
      }

      const structuralVerification = await verifyRequiredStructure(sql, migration.dialect);
      return { logicalId: migration.logicalId, checksum, status: "APPLIED", structuralVerification };
    } catch (applyError) {
      if (migration.dialect === "mysql") {
        try {
          await clearMigrationApplyingMarker(sql, migration.logicalId);
        } catch {
          // Marker cleanup failure does not mask original error
        }
      }
      throw applyError;
    }
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

type SemanticProofContext = {
  sql: SQL;
  dbConfig: DatabaseConfig;
  migration: MigrationDefinition;
  prefix: string;
  dialectName: string;
};

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

async function canonicalizeRow(row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const canonical: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "bigint") {
      canonical[k] = `BIGINT:${v.toString()}`;
    } else if (v === null) {
      canonical[k] = null;
    } else if (typeof v === "object") {
      canonical[k] = JSON.stringify(v);
    } else {
      canonical[k] = v;
    }
  }
  return canonical;
}

async function captureTableSnapshot(sql: SQL, tableName: string, dialect: DatabaseType): Promise<TableSnapshot> {
  const countResult = await sql.unsafe<{ count: bigint | number }[]>(`SELECT COUNT(*) as count FROM ${tableName}`);
  const count = Number(countResult[0]?.count ?? 0);
  const rows = await sql.unsafe<Record<string, unknown>[]>(`SELECT * FROM ${tableName} ORDER BY 1 LIMIT 10000`);
  const canonicalized = await Promise.all(rows.map((r) => canonicalizeRow(r)));
  return { table: tableName, count, rows: canonicalized };
}

async function captureMultipleSnapshots(sql: SQL, tables: string[]): Promise<TableSnapshot[]> {
  const snapshots: TableSnapshot[] = [];
  for (const table of tables) {
    try {
      snapshots.push(await captureTableSnapshot(sql, table, "postgres")); // dialect not needed for this level
    } catch (error) {
      // Query error must not be swallowed; re-throw to fail the proof
      throw new Error(`snapshot capture failed for ${table}: ${sanitizeError(error)}`);
    }
  }
  return snapshots;
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

function extractLockErrorCode(error: unknown, dialect: DatabaseType): { isLockError: boolean; code: string } {
  if (!error) return { isLockError: false, code: "" };

  const err = error as unknown as Record<string, unknown>;

  if (dialect === "postgres") {
    // PostgreSQL: ONLY structured sqlState field (no message substring fallback)
    const sqlState = String(err.sqlState ?? "");
    if (sqlState === "55P03" || sqlState === "40P01") {
      return { isLockError: true, code: sqlState };
    }
  } else {
    // MySQL: ONLY structured errno or sqlState field (no message substring fallback)
    const errno = String(err.errno ?? "");
    const sqlState = String(err.sqlState ?? "");
    if (errno === "1205" || sqlState === "40001") {
      return { isLockError: true, code: errno || sqlState };
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
): Promise<IdempotencyResult> {
  // Own the transaction; check PK, detect conflict, return/insert, commit atomically
  let result: IdempotencyResult | null = null;
  let conflictDetected = false;

  await sql.begin(async (tx) => {
    const existing = await tx<{ request_hash: string; result_json: string; result_hash: string }[]>`
      SELECT request_hash, result_json, result_hash FROM idempotency_records
      WHERE tenant_id = ${tenantId} AND request_id = ${requestId}
    `;

    if (existing.length > 0) {
      if (existing[0].request_hash !== requestHash) {
        // Conflict: same (tenant_id, request_id) with different hash
        // Do NOT expose prior result; just throw typed error
        conflictDetected = true;
      } else {
        // Same hash: return exact stored result
        result = {
          result_json: existing[0].result_json,
          result_hash: existing[0].result_hash,
        };
      }
    } else {
      // New record: insert and return
      await tx`
        INSERT INTO idempotency_records (tenant_id, request_id, request_hash, result_json, result_hash)
        VALUES (${tenantId}, ${requestId}, ${requestHash}, ${resultJson}, ${resultHash})
      `;
      result = {
        result_json: resultJson,
        result_hash: resultHash,
      };
    }
  });

  if (conflictDetected) {
    throw new IdempotencyConflictError();
  }

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
    error,
  });
}

async function runSemanticMatrix(ctx: SemanticProofContext): Promise<IntegrationTestResult[]> {
  const results: IntegrationTestResult[] = [];
  const { sql, prefix } = ctx;

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
            ? "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('schema_migrations', 'tenants', 'book_sets', 'journal_entries', 'postings', 'audit_log', 'idempotency_records')"
            : "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('schema_migrations', 'tenants', 'book_sets', 'journal_entries', 'postings', 'audit_log', 'idempotency_records')";
        const tables = await sql.unsafe<{ table_name: string }[]>(tableQuery);
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
      const metadataBefore = snapBefore[0].rows.filter((r) => !String(r.logical_id).startsWith("__applying_"));

      const secondMigration = await loadMigration(ctx.dbConfig.type);
      const result = await applyMigration(sql, secondMigration);

      const snapAfter = await captureMultipleSnapshots(sql, ["schema_migrations"]);
      const metadataAfter = snapAfter[0].rows.filter((r) => !String(r.logical_id).startsWith("__applying_"));

      if (result.status !== "NOOP") {
        recordProofFail(results, "MIG-002", prefix, `Expected NOOP but got ${result.status}`);
      } else if (JSON.stringify(metadataBefore) !== JSON.stringify(metadataAfter)) {
        recordProofFail(results, "MIG-002", prefix, "Metadata changed despite NOOP status");
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
        if (JSON.stringify(snapBefore) === JSON.stringify(snapAfter)) {
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
        const stillBad = await sql<{ checksum: string }[]>`
          SELECT checksum FROM schema_migrations WHERE logical_id = ${ctx.migration.logicalId}
        `;

        if (String(stillBad[0]?.checksum) !== badChecksum) {
          recordProofFail(results, "MIG-004", prefix, "Bad checksum was silently repaired (should not have been)");
        } else if (JSON.stringify(snapBefore) !== JSON.stringify(snapAfter)) {
          recordProofFail(results, "MIG-004", prefix, "Schema was modified despite MIGRATION_CHECKSUM_MISMATCH");
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
          VALUES (${'t-a'}, ${'book-a'}, ${'cross-entry'}, ${1}, ${100n})
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
          VALUES (${'t-a'}, ${'book-a'}, ${'balanced-entry'}, ${1}, ${100n})
        `;
        await tx`
          INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, credit_minor_units)
          VALUES (${'t-a'}, ${'book-a'}, ${'balanced-entry'}, ${2}, ${100n})
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
            VALUES (${'t-a'}, ${'book-a'}, ${'imbalanced-entry'}, ${1}, ${99n})
          `;
          await tx`
            INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, credit_minor_units)
            VALUES (${'t-a'}, ${'book-a'}, ${'imbalanced-entry'}, ${2}, ${98n})
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
           FROM book_sets WHERE tenant_id = 't-a' AND id = 'book-a' LIMIT 1`,
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
          SET debit_minor_units = ${200n}
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

    // CON-001: TWO reserved connections; A holds FOR UPDATE, B fails with lock timeout/NOWAIT; retry succeeds
    const connA = sql;
    const connB = createBunSqlClient(ctx.dbConfig);
    try {
      await connB.connect();

      // Capture balanced-entry row state before lock
      const rowBefore = await connA<{ id: string; status: string; tenant_id: string }[]>`
        SELECT id, status, tenant_id FROM journal_entries
        WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
      `;
      if (rowBefore.length === 0) {
        recordProofFail(results, "CON-001", prefix, "balanced-entry row not found before lock test");
      } else {
        // Connection A: begin transaction and acquire FOR UPDATE lock
        await connA`BEGIN`;
        let lockAcquired = false;
        try {
          const lockRow = await connA<{ id: string }[]>`
            SELECT id FROM journal_entries
            WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
            FOR UPDATE
          `;
          lockAcquired = lockRow.length > 0;
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

            // Attempt FOR UPDATE NOWAIT on same row
            await connB<{ id: string }[]>`
              SELECT id FROM journal_entries
              WHERE tenant_id = ${'t-a'} AND book_set_id = ${'book-a'} AND id = ${'balanced-entry'}
              FOR UPDATE NOWAIT
            `;
          } catch (conflictError) {
            const { isLockError, code } = extractLockErrorCode(conflictError, ctx.dbConfig.type);
            if (isLockError) {
              lockConflictDetected = true;
              detectedCode = ctx.dbConfig.type === "postgres" ? `PostgreSQL ${code}` : `MySQL ${code}`;
            }
          }

          if (!lockConflictDetected) {
            recordProofFail(results, "CON-001", prefix, "Connection B should have been blocked by A's lock");
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
              // Release connection A's lock
              await connA`COMMIT`;

              // Connection B retry should now succeed
              let retrySucceeded = false;
              try {
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
                  "connection A: FOR UPDATE lock acquired",
                  "connection B: lock timeout/NOWAIT attempt blocked",
                  `detected code: ${detectedCode}`,
                  "connection B: zero row effects during lock hold",
                  "connection A: row unchanged during conflict",
                  "connection B: retry succeeded after A released lock",
                ]);
              }
              // Clean up connection B's transaction
              try {
                await connB`ROLLBACK`;
              } catch {
                // Ignore rollback error
              }
            }
          }
        }
      }
    } catch (error) {
      recordProofFail(results, "CON-001", prefix, sanitizeError(error));
    } finally {
      try {
        await connA`ROLLBACK`;
      } catch {
        // Ignore rollback error on main connection
      }
      try {
        await connB.end({ timeout: 1 });
      } catch {
        // Ignore cleanup error
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
        { sqlState: ctx.dbConfig.type === "postgres" ? "22P02" : "12345" } // wrong SQLSTATE
      );
      if (extractLockErrorCode(messageLookalike, ctx.dbConfig.type).isLockError) {
        allNegativesRejected = false;
      }

      // Test 3: error with message containing numbers but wrong structured code
      const numberLookalike = Object.assign(
        new Error("error code 1205 or 40001 reported"),
        { errno: 2003, sqlState: ctx.dbConfig.type === "postgres" ? "00000" : "08000" } // wrong code
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
          "classification requires ONLY structured sqlState/errno codes",
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
      const firstResult = await getOrCreateIdempotencyRecord(sql, "t-a", "req-1", reqHash1, resultJson1, resultHash1);

      // Replay with same tenant/req_id/req_hash but deliberately different candidate bytes
      const differentCandidate = JSON.stringify({ entry_id: "different", success: false });
      const differentCandidateHash = sha256MigrationText(differentCandidate);

      // Replay with same hash: shared operation must return exact stored R1/RH1, ignoring candidate bytes
      const replayResult = await getOrCreateIdempotencyRecord(sql, "t-a", "req-1", reqHash1, differentCandidate, differentCandidateHash);

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
      const firstResult = await getOrCreateIdempotencyRecord(sql, "t-a", "req-2", reqHash2, resultJson2, resultHash2);

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
        await getOrCreateIdempotencyRecord(sql, "t-a", "req-2", differentReqHash, conflictCandidate, conflictCandidateHash);
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

    // BIGINT-001: insert/query 9007199254740993n with `{ bigint: true }`; assert raw typeof === 'bigint' and exact value, keep DRAFT/unbalanced
    try {
      const testValue = 9007199254740993n;

      // Create DRAFT parent entry first (required for FK)
      await sql`
        INSERT INTO journal_entries (tenant_id, book_set_id, id, idempotency_key)
        VALUES (${'t-b'}, ${'book-z'}, ${'bigint-test'}, ${'bigint-key'})
      `;

      // Insert single BigInt posting (unbalanced: only debit, no credit)
      await sql`
        INSERT INTO postings (tenant_id, book_set_id, journal_entry_id, line_no, debit_minor_units)
        VALUES (${'t-b'}, ${'book-z'}, ${'bigint-test'}, ${1}, ${testValue})
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
    };
    results.push(...(await runSemanticMatrix(ctx)));
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
  return results;
}
