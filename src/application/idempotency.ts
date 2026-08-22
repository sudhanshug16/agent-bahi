import type { BusinessSession } from "./ports/persistence.ts";
import { randomUUID } from "crypto";
import { createHash } from "node:crypto";
import { DomainError, IdempotencyConflictError } from "../core/types.ts";

export { IdempotencyConflictError } from "../core/types.ts";

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
 *
 * Populates all required production columns: id, request_hash, result_json,
 * result_hash, and created_at.
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
    throw new IdempotencyConflictError("idempotency conflict: same request_id with different request_hash");
  }

  // Insert new record with all required production columns
  const now = new Date().toISOString();
  const id = randomUUID();
  await session.execute(
    "INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, tenantId, requestId, requestHash, resultJson, resultHash, now],
  );

  return {
    result_json: resultJson,
    result_hash: resultHash,
  };
}

export type TenantCreationIdempotencyResult<T> = {
  result: T;
  tenantId: string;
};

/**
 * Reserve, execute, and finalize a tenant-creation idempotency request inside
 * the caller's existing BusinessSession transaction. No session is opened or
 * nested here, and the exact serialized result bytes are retained for replay.
 */
export async function withTenantCreationIdempotency<T>(
  session: BusinessSession,
  requestId: string,
  requestHash: string,
  create: () => Promise<TenantCreationIdempotencyResult<T>>,
): Promise<T> {
  const existing = await session.querySingle(
    "SELECT tenant_id, request_hash, result_json FROM tenant_creation_requests WHERE request_id = ?",
    [requestId],
  );
  if (existing) {
    if ((existing.request_hash as string) !== requestHash) {
      throw new IdempotencyConflictError("idempotency conflict: same request_id with different request_hash");
    }
    if (existing.result_json) return JSON.parse(existing.result_json as string) as T;
    throw new DomainError("IDEMPOTENCY_PARTIAL", "Idempotency request is reserved but not finalized");
  }

  const requestRecordId = randomUUID();
  const now = new Date().toISOString();
  await session.execute(
    `INSERT INTO tenant_creation_requests (id, request_id, request_hash, tenant_id, result_json, result_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [requestRecordId, requestId, requestHash, null, null, null, now],
  );

  const created = await create();
  const resultJson = JSON.stringify(created.result);
  const resultHash = createHash("sha256").update(resultJson).digest("hex");
  await session.execute(
    "UPDATE tenant_creation_requests SET tenant_id = ?, result_json = ?, result_hash = ? WHERE request_id = ?",
    [created.tenantId, resultJson, resultHash, requestId],
  );
  return created.result;
}
