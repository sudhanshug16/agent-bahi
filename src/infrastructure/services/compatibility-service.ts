import type { Database } from "../../application/ports/persistence.ts";
import type { Dialect } from "../../core/types.ts";
import { IncompatibleDatabaseError } from "../../core/types.ts";

interface CompatibilityEntry {
  cliVersionMin: string;
  cliVersionMax: string;
  schemaLogicalId: string;
  dataFormatVersion: string;
  readPolicy: "read_write" | "read_only" | "incompatible";
}

const INITIAL_COMPATIBILITY_MATRIX: readonly CompatibilityEntry[] = [
  {
    cliVersionMin: "0.0.0-gate0",
    cliVersionMax: "0.0.0-gate0",
    schemaLogicalId: "gate0-001-core-sqlite",
    dataFormatVersion: "1.0.0",
    readPolicy: "read_only",
  },
];

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
);`;

export class CompatibilityService {
  constructor(
    private readonly db: Database,
    private readonly dialect: Dialect,
  ) {}

  /** Explicit admin operation: create the metadata table. Inspection never calls this. */
  async ensureCompatibilityTable(): Promise<void> {
    try {
      await this.db.executeRaw(COMPATIBILITY_SCHEMA_SQLITE);
    } catch (error) {
      throw new IncompatibleDatabaseError("Failed to initialize compatibility metadata", {
        dialect: this.dialect,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async initializeDefaults(): Promise<void> {
    await this.ensureCompatibilityTable();
    for (const entry of INITIAL_COMPATIBILITY_MATRIX) await this.upsertEntry(entry);
  }

  /** Side-effect-free inspection: every statement in this method is SELECT. */
  async checkCompatibility(cliVersion: string): Promise<{
    compatible: boolean;
    cliVersion: string;
    schemaVersion: string;
    dataFormatVersion: string;
    message?: string;
  }> {
    try {
      const schema = await this.db.querySingle(
        "SELECT id, status FROM schema_migrations ORDER BY executed_at DESC LIMIT 1",
      );
      if (!schema || schema.status !== "APPLIED") {
        throw new IncompatibleDatabaseError("Database schema metadata is missing or not fully applied");
      }

      const matches = await this.db.query(
        `SELECT schema_logical_id, data_format_version, read_policy
         FROM compatibility_matrix
         WHERE cli_version_min <= ? AND cli_version_max >= ?`,
        [cliVersion, cliVersion],
      );
      const entry = matches.rows[0];
      if (!entry) {
        throw new IncompatibleDatabaseError(`CLI version ${cliVersion} has no compatible schema entry`);
      }
      if (entry.read_policy === "incompatible") {
        throw new IncompatibleDatabaseError(`CLI version ${cliVersion} is marked incompatible`);
      }
      return {
        compatible: true,
        cliVersion,
        schemaVersion: String(entry.schema_logical_id),
        dataFormatVersion: String(entry.data_format_version),
        message: entry.read_policy === "read_only" ? "Read-only mode: production writes disabled" : undefined,
      };
    } catch (error) {
      if (error instanceof IncompatibleDatabaseError) throw error;
      throw new IncompatibleDatabaseError("Compatibility inspection failed closed", {
        dialect: this.dialect,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async recordCompatibilityEntry(
    cliVersionMin: string,
    cliVersionMax: string,
    schemaLogicalId: string,
    dataFormatVersion: string,
  ): Promise<void> {
    await this.ensureCompatibilityTable();
    await this.upsertEntry({
      cliVersionMin,
      cliVersionMax,
      schemaLogicalId,
      dataFormatVersion,
      readPolicy: "read_write",
    });
  }

  private async upsertEntry(entry: CompatibilityEntry): Promise<void> {
    const values = [
      entry.cliVersionMin,
      entry.cliVersionMax,
      entry.schemaLogicalId,
      entry.dataFormatVersion,
      entry.readPolicy,
      new Date().toISOString(),
    ];
    const columns = "(cli_version_min, cli_version_max, schema_logical_id, data_format_version, read_policy, recorded_at)";
    try {
      await this.db.execute(
        `INSERT OR IGNORE INTO compatibility_matrix ${columns} VALUES (?, ?, ?, ?, ?, ?)`,
        values,
      );
    } catch (error) {
      throw new IncompatibleDatabaseError("Failed to write compatibility metadata", {
        dialect: this.dialect,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
