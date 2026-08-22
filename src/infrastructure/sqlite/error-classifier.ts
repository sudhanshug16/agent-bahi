/**
 * SQLite native error classification for contention vs non-contention errors.
 *
 * Native SQLite errors are deliberately reduced to stable, safe domain
 * contracts.  Native messages are useful only as a narrow compatibility
 * fallback because Bun's SQLite binding exposes code/errno on normal errors.
 */

import { DomainError } from "../../core/types.ts";

export interface ClassifiedError {
  isDomainError: boolean;
  isContention: boolean;
  code: string;
  message: string;
  originalError: unknown;
}

type SqliteErrorFields = {
  code?: unknown;
  errno?: unknown;
  message?: unknown;
};

const BUSY_CODE = "SQLITE_CONTENTION_BUSY";
const LOCKED_CODE = "SQLITE_CONTENTION_LOCKED";

/**
 * Classify a SQLite error without exposing native diagnostics.
 *
 * SQLite result codes are the authority. Extended numeric result codes are
 * reduced to their primary result code (`result & 0xff`). String codes are
 * accepted only for the documented SQLite families. Message matching is
 * intentionally limited to exact native phrases and is used only when code
 * and errno are absent.
 */
export function classifySqliteError(error: unknown, _operation: string = "database"): ClassifiedError {
  if (error instanceof DomainError) {
    return {
      isDomainError: true,
      isContention: error.code === BUSY_CODE || error.code === LOCKED_CODE,
      code: error.code,
      message: error.message,
      originalError: error,
    };
  }

  const fields = getErrorFields(error);
  const structuredFieldsPresent = fields.code !== undefined || fields.errno !== undefined;

  // Bun reports missing tables with the generic SQLITE_ERROR code. This one
  // allowlisted control-table condition remains a stable domain outcome.
  if ((fields.code === "SQLITE_ERROR" || fields.errno === 1) && isMissingMigrationControlTable(fields.message)) {
    return makeClassified({ code: "CONTROL_TABLE_MISSING", message: "Migration control table is not initialized" }, error, true);
  }

  for (const value of [fields.code, fields.errno]) {
    const result = classifyStructuredValue(value);
    if (result) return makeClassified(result, error);
  }

  if (!structuredFieldsPresent && error instanceof Error) {
    const fallback = classifyNativeMessage(fields.message ?? error.message);
    if (fallback) return makeClassified(fallback, error);
  }

  if (!structuredFieldsPresent && error instanceof Error && isMissingMigrationControlTable(fields.message ?? error.message)) {
    return makeClassified({ code: "CONTROL_TABLE_MISSING", message: "Migration control table is not initialized" }, error, true);
  }

  return makeClassified({ code: "DATABASE_QUERY_FAILED", message: "SQLite database operation failed" }, error, true);
}

function getErrorFields(error: unknown): SqliteErrorFields {
  if (typeof error !== "object" || error === null) return {};
  const candidate = error as SqliteErrorFields;
  return {
    code: candidate.code,
    errno: candidate.errno,
    message: candidate.message,
  };
}

function classifyStructuredValue(value: unknown): { code: string; message: string } | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    switch (value & 0xff) {
      case 5:
        return { code: BUSY_CODE, message: "SQLite operation blocked by BUSY contention" };
      case 6:
        return { code: LOCKED_CODE, message: "SQLite operation blocked by LOCKED contention" };
      case 19:
        return { code: "SQLITE_CONSTRAINT", message: "SQLite constraint violation" };
      default:
        return undefined;
    }
  }

  if (typeof value !== "string") return undefined;
  const code = value.toUpperCase();
  if (isSqliteFamily(code, "SQLITE_BUSY")) {
    return { code: BUSY_CODE, message: "SQLite operation blocked by BUSY contention" };
  }
  if (isSqliteFamily(code, "SQLITE_LOCKED")) {
    return { code: LOCKED_CODE, message: "SQLite operation blocked by LOCKED contention" };
  }
  if (isSqliteFamily(code, "SQLITE_CONSTRAINT")) {
    if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return { code: "SQLITE_CONSTRAINT", message: "SQLite foreign key constraint violation" };
    }
    if (code === "SQLITE_CONSTRAINT_TRIGGER") {
      return { code: "SQLITE_CONSTRAINT", message: "SQLite trigger constraint violation" };
    }
    if (code === "SQLITE_CONSTRAINT_UNIQUE") {
      return { code: "SQLITE_CONSTRAINT", message: "SQLite UNIQUE constraint violation" };
    }
    return { code: "SQLITE_CONSTRAINT", message: "SQLite constraint violation" };
  }
  return undefined;
}

function isSqliteFamily(value: string, base: string): boolean {
  return value === base || new RegExp(`^${base}_[A-Z0-9_]+$`).test(value);
}

function classifyNativeMessage(message: unknown): { code: string; message: string } | undefined {
  if (typeof message !== "string") return undefined;
  const normalized = message.trim().toLowerCase();

  // These are SQLite's stable native phrases for the corresponding primary
  // result codes. Do not broaden this to arbitrary identifiers or substrings.
  if (normalized === "database is locked" || normalized === "database is busy") {
    return { code: BUSY_CODE, message: "SQLite operation blocked by BUSY contention" };
  }
  if (normalized === "database table is locked" || normalized === "database schema is locked") {
    return { code: LOCKED_CODE, message: "SQLite operation blocked by LOCKED contention" };
  }
  if (normalized === "foreign key constraint failed") {
    return { code: "SQLITE_CONSTRAINT", message: "SQLite foreign key constraint violation" };
  }
  if (/^(?:constraint failed|not null constraint failed|unique constraint failed|check constraint failed)(?:: .+)?$/.test(normalized)) {
    return { code: "SQLITE_CONSTRAINT", message: "SQLite constraint violation" };
  }
  return undefined;
}

function isMissingMigrationControlTable(message: unknown): boolean {
  return typeof message === "string" && /^no such table:\s*schema_migrations$/i.test(message.trim());
}

function makeClassified(
  result: { code: string; message: string },
  originalError: unknown,
  isDomainError = false,
): ClassifiedError {
  return {
    isDomainError,
    isContention: result.code === BUSY_CODE || result.code === LOCKED_CODE,
    code: result.code,
    message: result.message,
    originalError,
  };
}

/** Convert a classified native error to a safe DomainError. */
export function toDomainError(classified: ClassifiedError): DomainError {
  if (classified.originalError instanceof DomainError) {
    return classified.originalError;
  }

  const context = { dialect: "sqlite" };
  return new DomainError(classified.code, classified.message, context);
}
