import { createHash } from "node:crypto";
import { CORE_MIGRATIONS } from "./core-schema.ts";
import { DATABASE_CONTROL_CHECKSUM, DATABASE_CONTROL_MIGRATIONS } from "./database-control-schema.ts";

export type CurrentSqliteMigration = {
  readonly id: string;
  readonly checksum: string;
};

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/** Immutable production migration manifest used by the business compatibility fence. */
export const CURRENT_SQLITE_MIGRATIONS: readonly CurrentSqliteMigration[] = Object.freeze([
  { id: CORE_MIGRATIONS.id, checksum: checksum(CORE_MIGRATIONS.sqlite) },
  { id: DATABASE_CONTROL_MIGRATIONS.id, checksum: DATABASE_CONTROL_CHECKSUM },
]);

export const CURRENT_SCHEMA_VERSION = 2;
export const CURRENT_DATA_FORMAT_VERSION = 1;
export const CURRENT_DATABASE_GENERATION = 1;
export const CURRENT_DATABASE_REVISION = 1;
export const CURRENT_READER_PROTOCOL_MIN = 1;
export const CURRENT_READER_PROTOCOL_MAX = 1;
export const CURRENT_WRITER_PROTOCOL = 1;
