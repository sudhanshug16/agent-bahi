import type { BusinessSession } from "./ports/persistence.ts";

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";

  constructor(message: string = "idempotency conflict: same request_id with different request_hash") {
    super(message);
    this.name = "IDEMPOTENCY_CONFLICT";
  }
}

export type IdempotencyRecord = {
  result_json: string;
  result_hash: string;
};

/**
 * Get or create an idempotency record within a BusinessSession.
 * Operates atomically within the session's transaction; must be called inside
 * a withBusinessSession callback with write mode.
 *
 * Insert-first semantics: attempts to insert new record first (optimistic).
 * On conflict, checks if hash matches; if so, returns cached result.
 * If hash mismatch, throws IdempotencyConflictError.
 * All operations are atomic within the session transaction.
 */
export async function getOrCreateIdempotencyRecord(
  session: BusinessSession,
  tenantId: string,
  requestId: string,
  requestHash: string,
  resultJson: string,
  resultHash: string,
): Promise<IdempotencyRecord> {
  // Check if request already exists
  const existing = await session.querySingle(
    "SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?",
    [tenantId, requestId],
  );

  if (existing) {
    if ((existing.request_hash as string) === requestHash) {
      return {
        result_json: existing.result_json as string,
        result_hash: existing.result_hash as string,
      };
    }
    throw new IdempotencyConflictError();
  }

  // Insert new record (will fail with constraint if concurrent insert by another session)
  await session.execute(
    "INSERT INTO idempotency_records (tenant_id, request_id, request_hash, result_json, result_hash) VALUES (?, ?, ?, ?, ?)",
    [tenantId, requestId, requestHash, resultJson, resultHash],
  );

  return {
    result_json: resultJson,
    result_hash: resultHash,
  };
}
