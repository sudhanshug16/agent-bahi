import type { Database } from "../../application/ports/persistence.ts";
import { IncompatibleDatabaseError } from "../../core/types.ts";

/**
 * Compatibility matrix entry.
 */
interface CompatibilityEntry {
  cliVersionMin: string;
  cliVersionMax: string;
  schemaLogicalId: string;
  dataFormatVersion: string;
  readPolicy: "read_write" | "read_only" | "incompatible";
}

/**
 * Initial compatibility matrix.
 * Defines which CLI versions work with which schema versions.
 */
const INITIAL_COMPATIBILITY_MATRIX: readonly CompatibilityEntry[] = [
  {
    cliVersionMin: "0.0.0-gate0",
    cliVersionMax: "0.0.0-gate0",
    schemaLogicalId: "gate0-001-core-sqlite",
    dataFormatVersion: "1.0.0",
    readPolicy: "read_only", // Gate0 is proof-only, no production writes
  },
];

/**
 * Compatibility tracking table schema (SQLite example).
 */
const COMPATIBILITY_SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS compatibility_matrix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cli_version_min TEXT NOT NULL,
  cli_version_max TEXT NOT NULL,
  schema_logical_id TEXT NOT NULL,
  data_format_version TEXT NOT NULL,
  read_policy TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(cli_version_min, cli_version_max, schema_logical_id)
);
`;

const COMPATIBILITY_SCHEMA_POSTGRES = `
CREATE TABLE IF NOT EXISTS compatibility_matrix (
  id SERIAL PRIMARY KEY,
  cli_version_min TEXT NOT NULL,
  cli_version_max TEXT NOT NULL,
  schema_logical_id TEXT NOT NULL,
  data_format_version TEXT NOT NULL,
  read_policy TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(cli_version_min, cli_version_max, schema_logical_id)
);
`;

const COMPATIBILITY_SCHEMA_MYSQL = `
CREATE TABLE IF NOT EXISTS compatibility_matrix (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cli_version_min VARCHAR(50) NOT NULL,
  cli_version_max VARCHAR(50) NOT NULL,
  schema_logical_id VARCHAR(100) NOT NULL,
  data_format_version VARCHAR(50) NOT NULL,
  read_policy VARCHAR(20) NOT NULL,
  recorded_at VARCHAR(50) NOT NULL,
  UNIQUE KEY uk_compat (cli_version_min, cli_version_max, schema_logical_id)
);
`;

/**
 * Compatibility service: ensures CLI version, schema version, and data format are compatible.
 * Prevents incompatible clients from reading/writing.
 */
export class CompatibilityService {
  constructor(
    private db: Database,
    private dialect: "sqlite" | "postgresql" | "mysql",
  ) {}

  /**
   * Ensure compatibility table exists.
   */
  async ensureCompatibilityTable(): Promise<void> {
    const schema =
      this.dialect === "sqlite"
        ? COMPATIBILITY_SCHEMA_SQLITE
        : this.dialect === "postgresql"
          ? COMPATIBILITY_SCHEMA_POSTGRES
          : COMPATIBILITY_SCHEMA_MYSQL;

    try {
      await this.db.executeRaw(schema);
    } catch (error) {
      throw new IncompatibleDatabaseError(
        `Failed to set up compatibility matrix table: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Initialize default compatibility entries.
   */
  async initializeDefaults(): Promise<void> {
    try {
      await this.ensureCompatibilityTable();

      for (const entry of INITIAL_COMPATIBILITY_MATRIX) {
        const existing = await this.db.querySingle(
          "SELECT id FROM compatibility_matrix WHERE cli_version_min = ? AND cli_version_max = ? AND schema_logical_id = ?",
          [entry.cliVersionMin, entry.cliVersionMax, entry.schemaLogicalId],
        );

        if (!existing) {
          await this.db.execute(
            `INSERT INTO compatibility_matrix (cli_version_min, cli_version_max, schema_logical_id, data_format_version, read_policy, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              entry.cliVersionMin,
              entry.cliVersionMax,
              entry.schemaLogicalId,
              entry.dataFormatVersion,
              entry.readPolicy,
              new Date().toISOString(),
            ],
          );
        }
      }
    } catch (error) {
      throw new IncompatibleDatabaseError(
        `Failed to initialize compatibility matrix: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Check if CLI version is compatible with current database state.
   * Fails closed if incompatible.
   */
  async checkCompatibility(cliVersion: string): Promise<{
    compatible: boolean;
    cliVersion: string;
    schemaVersion: string;
    dataFormatVersion: string;
    message?: string;
  }> {
    try {
      await this.ensureCompatibilityTable();

      // Query compatibility matrix
      const matches = await this.db.query(
        `SELECT schema_logical_id, data_format_version, read_policy
         FROM compatibility_matrix
         WHERE cli_version_min <= ? AND cli_version_max >= ?`,
        [cliVersion, cliVersion],
      );

      if (matches.rows.length === 0) {
        throw new IncompatibleDatabaseError(
          `CLI version ${cliVersion} is not compatible with this database. No matching compatibility entry found.`,
        );
      }

      const entry = matches.rows[0];

      // Check policy
      if (entry.read_policy === "incompatible") {
        throw new IncompatibleDatabaseError(
          `CLI version ${cliVersion} is marked as incompatible with schema version ${entry.schema_logical_id}`,
        );
      }

      return {
        compatible: true,
        cliVersion,
        schemaVersion: entry.schema_logical_id as string,
        dataFormatVersion: entry.data_format_version as string,
        message: entry.read_policy === "read_only" ? "Read-only mode: production writes disabled" : undefined,
      };
    } catch (error) {
      if (error instanceof IncompatibleDatabaseError) throw error;
      throw new IncompatibleDatabaseError(
        `Failed to check compatibility: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Record a new compatibility matrix entry.
   * Used when a new CLI version or schema version is released.
   */
  async recordCompatibilityEntry(
    cliVersionMin: string,
    cliVersionMax: string,
    schemaLogicalId: string,
    dataFormatVersion: string,
  ): Promise<void> {
    try {
      await this.ensureCompatibilityTable();

      await this.db.execute(
        `INSERT OR IGNORE INTO compatibility_matrix
         (cli_version_min, cli_version_max, schema_logical_id, data_format_version, read_policy, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [cliVersionMin, cliVersionMax, schemaLogicalId, dataFormatVersion, "read_write", new Date().toISOString()],
      );
    } catch (error) {
      throw new IncompatibleDatabaseError(
        `Failed to record compatibility entry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
