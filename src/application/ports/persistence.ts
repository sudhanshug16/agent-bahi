/**
 * Core persistence ports - interfaces that domain/application depend on.
 * Implementations are in infrastructure/adapters.
 */

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
   */
  migrate(migrations: readonly { id: string; sql: string }[], timeoutMs?: number): Promise<MigrationRecord[]>;

  /**
   * Acquire exclusive migration lock. Fails if lock held by another process.
   * Returns lock token; must be released by caller.
   *
   * SQLite: PRAGMA locking_mode = EXCLUSIVE
   * PostgreSQL: pg_advisory_lock on known ID
   * MySQL: GET_LOCK with timeout
   */
  acquireMigrationLock(timeoutMs?: number): Promise<string>;

  /**
   * Release exclusive migration lock.
   */
  releaseMigrationLock(lockToken: string): Promise<void>;

  /**
   * Verify checksum of a migration against what's stored in DB.
   * Fails if mismatch (indicates corruption or tampering).
   */
  verifyChecksum(migrationId: string, expectedChecksum: string): Promise<void>;

  /**
   * Mark migration as dirty on failure; requires manual recovery.
   */
  markDirty(migrationId: string, reason: string): Promise<void>;

  /**
   * Clear dirty marker (manual recovery completion).
   */
  clearDirty(): Promise<void>;
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
