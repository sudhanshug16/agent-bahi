import { Database } from "bun:sqlite";

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

export function getOrCreateIdempotencyRecord(
  db: Database,
  tenantId: string,
  requestId: string,
  requestHash: string,
  resultJson: string,
  resultHash: string,
): IdempotencyRecord {
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.query<{ request_hash: string; result_json: string; result_hash: string }, [string, string]>(
      "SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?",
    ).get(tenantId, requestId);

    if (existing) {
      db.exec("COMMIT");
      if (existing.request_hash === requestHash) {
        return {
          result_json: existing.result_json,
          result_hash: existing.result_hash,
        };
      }
      throw new IdempotencyConflictError();
    }

    db.query(
      "INSERT INTO idempotency_records (tenant_id, request_id, request_hash, result_json, result_hash) VALUES (?, ?, ?, ?, ?)",
    ).run(tenantId, requestId, requestHash, resultJson, resultHash);

    db.exec("COMMIT");
    return {
      result_json: resultJson,
      result_hash: resultHash,
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Already rolled back or not in transaction
    }
    throw error;
  }
}
