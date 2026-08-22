/**
 * SQLite native error classification for contention vs non-contention errors.
 *
 * Maps SQLite native error codes to typed DomainError contracts:
 * - SQLITE_BUSY (errno 5) and extended SQLITE_BUSY_* → contention (with DomainError code SQLITE_CONTENTION_BUSY)
 * - SQLITE_LOCKED (errno 6) and extended SQLITE_LOCKED_* → contention (with DomainError code SQLITE_CONTENTION_LOCKED)
 * - All other errors (permission, corruption, constraint, closed, fs) → non-contention (DATABASE_QUERY_FAILED)
 *
 * Preserves original error code/operation in safe context without leaking SQL parameters/secrets.
 */

import { DomainError } from "../../core/types.ts";

export interface ClassifiedError {
  isDomainError: boolean;
  isContention: boolean;
  code: string;
  message: string;
  originalError: unknown;
}

/**
 * Classify a SQLite error as contention or non-contention.
 *
 * SQLITE_BUSY (errno 5) and extended errno variants map to contention.
 * SQLITE_LOCKED (errno 6) and extended errno variants map to contention.
 * All other errors are non-contention.
 *
 * When classifying as non-contention, returns a DomainError with code DATABASE_QUERY_FAILED.
 * Contention errors are returned for the caller to decide how to handle (with DomainError code SQLITE_CONTENTION_BUSY/LOCKED).
 */
export function classifySqliteError(error: unknown, operation: string = "database"): ClassifiedError {
  if (!(error instanceof Error)) {
    return {
      isDomainError: false,
      isContention: false,
      code: "UNKNOWN_ERROR",
      message: String(error),
      originalError: error,
    };
  }

  const errorMsg = error.message || "";
  const errorName = error.name || "";

  // SQLite native error classification by code/message and errno
  // Extract errno-style codes: "SQLITE_BUSY", "SQLITE_IOERR_BUSY", etc.
  const sqliteErrorMatch = errorMsg.match(/\b(SQLITE_\w+)\b/i);
  const sqliteErrorCode = sqliteErrorMatch?.[1]?.toUpperCase() || "";

  // Check for SQLITE_BUSY or extended SQLITE_BUSY_* variants (base errno 5)
  if (
    sqliteErrorCode === "SQLITE_BUSY" ||
    sqliteErrorCode.startsWith("SQLITE_BUSY_") ||
    errorMsg.toUpperCase().includes("BUSY") ||
    errorMsg.toUpperCase().includes("DATABASE IS LOCKED")
  ) {
    return {
      isDomainError: false,
      isContention: true,
      code: "SQLITE_CONTENTION_BUSY",
      message: `SQLite BUSY during ${operation}: ${errorMsg}`,
      originalError: error,
    };
  }

  // Check for SQLITE_LOCKED or extended SQLITE_LOCKED_* variants (base errno 6)
  if (
    sqliteErrorCode === "SQLITE_LOCKED" ||
    sqliteErrorCode.startsWith("SQLITE_LOCKED_") ||
    /\bLOCKED\b/.test(errorMsg.toUpperCase())
  ) {
    return {
      isDomainError: false,
      isContention: true,
      code: "SQLITE_CONTENTION_LOCKED",
      message: `SQLite LOCKED during ${operation}: ${errorMsg}`,
      originalError: error,
    };
  }

  // All other errors are non-contention database errors
  // Check for specific error types to provide more context
  if (
    errorMsg.toLowerCase().includes("no such table") &&
    errorMsg.toLowerCase().includes("schema_migrations")
  ) {
    return {
      isDomainError: true,
      isContention: false,
      code: "CONTROL_TABLE_MISSING",
      message: "Migration control table is not initialized",
      originalError: error,
    };
  }

  // Constraint violations are non-contention
  if (
    sqliteErrorCode === "SQLITE_CONSTRAINT" ||
    /constraint|foreign key|unique|check constraint|tenant|book.?set/i.test(errorMsg)
  ) {
    return {
      isDomainError: true,
      isContention: false,
      code: "SQLITE_CONSTRAINT",
      message: `Constraint violation: ${errorMsg}`,
      originalError: error,
    };
  }

  // Generic database error for all other non-contention cases
  return {
    isDomainError: true,
    isContention: false,
    code: "DATABASE_QUERY_FAILED",
    message: `SQLite database ${operation} failed: ${errorMsg}`,
    originalError: error,
  };
}

/**
 * Convert a classified error to a DomainError.
 * If already contention, caller decides whether to retry.
 * For non-contention, always wraps in DomainError.
 */
export function toDomainError(classified: ClassifiedError): DomainError {
  if (classified.code === "CONTROL_TABLE_MISSING") {
    return new DomainError(classified.code, classified.message, {
      dialect: "sqlite",
      cause: String(classified.originalError),
    });
  }

  if (classified.code === "SQLITE_CONSTRAINT") {
    return new DomainError(classified.code, classified.message);
  }

  if (classified.isContention) {
    // Contention errors: let caller decide retry strategy
    return new DomainError(classified.code, classified.message);
  }

  // All other non-contention errors
  return new DomainError(classified.code, classified.message, {
    dialect: "sqlite",
    cause: String(classified.originalError),
  });
}
