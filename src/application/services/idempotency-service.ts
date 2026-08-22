import type { BusinessSessionRunner } from "../ports/persistence.ts";
import { getOrCreateIdempotencyRecord, type IdempotencyRecord } from "../idempotency.ts";

/** Public idempotency facade; callers never receive a session or native handle. */
export class IdempotencyService {
  constructor(private readonly sessionRunner: BusinessSessionRunner) {}

  async getOrCreate(
    tenantId: string,
    requestId: string,
    requestHash: string,
    resultJson: string,
    resultHash: string,
  ): Promise<IdempotencyRecord> {
    return this.sessionRunner.withBusinessSession("write", async (session) =>
      getOrCreateIdempotencyRecord(session, tenantId, requestId, requestHash, resultJson, resultHash),
    );
  }
}
