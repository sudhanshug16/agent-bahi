import { Database } from "bun:sqlite";

export class IdempotencyConflictError extends Error {
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
  const existing = db.query<{ request_hash: string; result_json: string; result_hash: string }, [string, string]>(
    "SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?",
  ).get(tenantId, requestId);

  if (existing) {
    if (existing.request_hash === requestHash) {
      return {
        result_json: existing.result_json,
        result_hash: existing.result_hash,
      };
    }
    throw new IdempotencyConflictError();
  }

  try {
    db.query(
      "INSERT INTO idempotency_records (tenant_id, request_id, request_hash, result_json, result_hash) VALUES (?, ?, ?, ?, ?)",
    ).run(tenantId, requestId, requestHash, resultJson, resultHash);
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      const retry = db.query<{ request_hash: string; result_json: string; result_hash: string }, [string, string]>(
        "SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?",
      ).get(tenantId, requestId);

      if (retry) {
        if (retry.request_hash === requestHash) {
          return {
            result_json: retry.result_json,
            result_hash: retry.result_hash,
          };
        }
        throw new IdempotencyConflictError();
      }
    }
    throw error;
  }

  return {
    result_json: resultJson,
    result_hash: resultHash,
  };
}
