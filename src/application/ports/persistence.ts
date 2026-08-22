/**
 * Core persistence ports - interfaces that domain/application depend on.
 * Implementations are in infrastructure/adapters.
 */

import type { Dialect } from "../../core/types.ts";

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields?: string[];
}

export interface TransactionConfig {
  isolationLevel?: "read_uncommitted" | "read_committed" | "repeatable_read" | "serializable";
  readOnly?: boolean;
}

/**
 * Transaction: represents an active database transaction.
 * Must explicitly commit or rollback.
 */
export interface Transaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  executeRaw(sql: string): Promise<void>;
  isActive(): boolean;
}

/**
 * Database: the main database connection/pool interface.
 */
export interface Database {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  querySingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  executeRaw(sql: string): Promise<void>;

  // Transaction management
  beginTransaction(config?: TransactionConfig): Promise<Transaction>;

  // UnitOfWork: atomic transaction with automatic rollback on error
  unitOfWork(config?: TransactionConfig): UnitOfWork;

  // withMigrationLease: execute callback within exclusive migration lease.
  // Session is callback-scoped; never escapes. Commit/rollback automatic per dialect.
  // SQLite: BEGIN IMMEDIATE on main connection; rollback on error or callback throw.
  // PostgreSQL: db.begin() with xact-scoped advisory lock; deadline-enforced timeout.
  // MySQL: reserved connection with GET_LOCK/RELEASE_LOCK; DDL auto-commits tracked with APPLYING row.
  withMigrationLease<T>(callback: (session: MigrationSession) => Promise<T>, timeoutMs?: number): Promise<T>;

  // Metadata/health
  isConnected(): Promise<boolean>;
  close(): Promise<void>;

  // Locking (dialect-specific)
  // SQLite: exclusive application lock via PRAGMA locking_mode
  // PostgreSQL: pg_advisory_lock
  // MySQL: GET_LOCK
  acquireAdvisoryLock(lockName: string, timeoutMs?: number): Promise<boolean>;
  releaseAdvisoryLock(lockName: string): Promise<void>;
}

/**
 * UnitOfWork: transaction wrapper with automatic rollback on error.
 * Provides a clean API for business logic without explicit try/catch.
 */
export interface UnitOfWork {
  execute<T>(callback: (tx: Transaction) => Promise<T>, config?: TransactionConfig): Promise<T>;
}

/**
 * Migration: single versioned migration record in the database.
 */
export interface MigrationRecord {
  id: string; // Logical ID like "0001-init" or "gate0-001-core-sqlite"
  dialect: string;
  checksum: string; // SHA256 hex of SQL content
  executedAt: string; // ISO timestamp
  durationMs: number;
}

/**
 * MigrationRecoveryRequest: parameters for recoverDirty.
 * Validates exact expected state (id + dialect + checksum + status + dirty_reason) before recovery.
 * CAS ensures operator-provided parameters match stored state exactly.
 */
export interface MigrationVerificationProbe {
  id: string;
  sql: string;
  expectedRows: readonly Record<string, unknown>[];
}

export interface MigrationVerificationManifest {
  version: number;
  dialect: Dialect;
  probes: readonly MigrationVerificationProbe[];
  retrySafe: boolean;
}

export interface MigrationDefinition {
  id: string;
  sql: string;
  manifest?: MigrationVerificationManifest;
}

export interface MigrationRecoveryRequest {
  migrationId: string;
  expectedDialect: Dialect;
  expectedStatus: "DIRTY" | "APPLYING";
  expectedChecksum: string;
  expectedDirtyReason: string | null; // null means the explicit NONE state
  actor: string; // Operator identity for audit trail
  reason: string; // Operator's reason for recovery (appended to immutable audit)
  definition: MigrationDefinition;
}

/**
 * MigrationService: manages schema versions, compatibility, and DDL execution.
 */
export interface MigrationService {
  /**
   * Get current schema version/compatibility state.
   */
  getStatus(): Promise<{
    hasSchema: boolean;
    lastMigrationId?: string;
    isDirty: boolean; // true if last migration failed partway
    appliedMigrations: MigrationRecord[];
    dialect: string;
  }>;

  /**
   * Apply pending migrations atomically within exclusive lease.
   * All validation, DDL, and audit happen in one transaction per dialect.
   * Never auto-run during business operations.
   * Callback-only; never call acquire/release separately.
   */
  migrate(migrations: readonly MigrationDefinition[], timeoutMs?: number): Promise<MigrationRecord[]>;

  /**
   * Verify checksum of a migration against what's stored in DB.
   * Fails if mismatch (indicates corruption or tampering).
   */
  verifyChecksum(migrationId: string, expectedChecksum: string): Promise<void>;

  /**
   * Recover a DIRTY migration with lease held and owner/checksum validation.
   * Acquires lease internally; validates expected state; appends immutable audit.
   */
  recoverDirty(request: MigrationRecoveryRequest, timeoutMs?: number): Promise<void>;
}

export interface ColumnMetadata {
  name: string;
  type: string;
  nullable: boolean;
  default?: string | null;
  primaryKey: boolean;
}

export interface TableMetadata {
  name: string;
  kind: "TABLE" | "VIEW";
  columns: ColumnMetadata[];
  /** Raw CHECK constraint definitions, in catalog order. */
  checks: string[];
}

/**
 * MigrationSession: passed to withMigrationLease callback; lifetime-bound to callback scope.
 * Never expose outside callback; never call commit/rollback—that's automatic per dialect.
 * Transaction-scoped lease and DDL execution on one pinned connection/session.
 */
export interface MigrationSession {
  // Execute arbitrary SQL within the migration session (no auto-commit)
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  executeSingle(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  executeRaw(sql: string): Promise<void>;

  // Table metadata inspection (pinned session only)
  getTableMetadata(tableName: string): Promise<TableMetadata | null>;

  // Lease metadata
  leaseToken(): string; // Unique token for this session/lease owner
}

/**
 * CompatibilityService: ensures CLI version, schema version, and data format are compatible.
 * Never creates/writes to tables; only inspects existing schema_migrations and version metadata.
 */
export interface CompatibilityService {
  /**
   * Check if current CLI version is compatible with database.
   * Inspects schema_migrations table and explicit schema_version/data_format_version metadata.
   * Fails closed if empty, dirty, applying, or mismatch.
   *
   * Returns compatibility info or throws IncompatibleDatabaseError.
   */
  checkCompatibility(cliVersion: string): Promise<{
    compatible: boolean;
    cliVersion: string;
    schemaVersion: string;
    dataFormatVersion: string;
    message?: string;
  }>;

  /**
   * Record a compatibility matrix entry for future migrations.
   */
  recordCompatibilityEntry(
    cliVersionRange: string,
    schemaLogicalId: string,
    dataFormatVersion: string,
  ): Promise<void>;
}

/**
 * BackupService: creates and verifies SQLite backups with WAL-consistent snapshots.
 * PostgreSQL/MySQL may return UNAVAILABLE with remediation guidance.
 */
export interface BackupResult {
  status: "SUCCESS" | "UNAVAILABLE";
  path?: string; // Local path for SQLite backup
  manifest?: {
    timestamp: string;
    checksum: string; // SHA256 of all files
    files: Array<{ name: string; checksum: string; size: number }>;
  };
  remediation?: string; // Guidance if UNAVAILABLE
}

export interface BackupService {
  /**
   * Create backup with atomic manifest and hash.
   * For SQLite: ensures WAL-consistent snapshot.
   * For PostgreSQL/MySQL: may return UNAVAILABLE with remediation.
   */
  createBackup(destinationPath?: string): Promise<BackupResult>;

  /**
   * Verify backup integrity before restore.
   */
  verifyBackup(backupPath: string): Promise<boolean>;
}
