/**
 * BookSet command service with idempotency and audit trail.
 * All commands execute within a single BEGIN IMMEDIATE BusinessSession.
 * Ensures exactly one audit record and one idempotency record per command.
 */
import { randomUUID } from "crypto";
import type { BusinessSessionRunner, BusinessSession } from "../ports/persistence.ts";
import type { TenantId, BookSetId } from "../../core/types.ts";
import {
  DomainError,
  IdempotencyConflictError,
  IdempotencyCorruptError,
  brandBookSetId,
  brandTenantId,
} from "../../core/types.ts";
import type {
  CommandEnvelope,
  BookSetCreatePayload,
  BookSetSetDefaultPayload,
  BookSetArchivePayload,
  TenantActivatePayload,
  BookSetCommandAction,
  CommandResult,
} from "../commands.ts";
import {
  computeCommandHash,
  computeResultHash,
  canonicalJson,
} from "../commands.ts";
import { SqliteBookSetRepository } from "../../infrastructure/repositories/book-set-repository.ts";
import { SqliteTenantRepository } from "../../infrastructure/repositories/tenant-repository.ts";

interface AuditRow {
  id: string;
  tenantId: TenantId;
  bookSetId: BookSetId | null;
  command: BookSetCommandAction;
  action: string;
  actorType: string;
  actorId: string;
  source: string;
  reason: string;
  requestId: string;
  canonicalBeforeHash: string | null;
  canonicalAfterHash: string | null;
  changeSummary: string;
  committedAt: string;
}

interface IdempotencyRow {
  requestHash: string;
  resultJson: string;
  resultHash: string;
}

/**
 * Validate strict envelope and payload requirements before mutation.
 * Ensures schemaVersion=1, nonblank bounded IDs/reason, valid enums, ISO timestamps.
 */
function validateCommandEnvelope(envelope: CommandEnvelope<unknown>): void {
  if (envelope.schemaVersion !== 1) {
    throw new DomainError("INVALID_SCHEMA_VERSION", "schemaVersion must be 1");
  }

  if (!envelope.tenantId || typeof envelope.tenantId !== "string" || envelope.tenantId.length === 0 || envelope.tenantId.length > 128) {
    throw new DomainError("INVALID_TENANT_ID", "tenantId must be nonblank and bounded (1-128 chars)");
  }

  if (!envelope.requestId || typeof envelope.requestId !== "string" || envelope.requestId.length === 0 || envelope.requestId.length > 256) {
    throw new DomainError("INVALID_REQUEST_ID", "requestId must be nonblank and bounded (1-256 chars)");
  }

  if (!envelope.actor || typeof envelope.actor !== "object") {
    throw new DomainError("INVALID_ACTOR", "actor must be an object");
  }

  const validActorKinds = ["HUMAN", "AGENT", "SYSTEM"];
  if (!validActorKinds.includes(envelope.actor.kind)) {
    throw new DomainError("INVALID_ACTOR_KIND", `actor.kind must be one of: ${validActorKinds.join(", ")}`);
  }

  if (!envelope.actor.id || typeof envelope.actor.id !== "string" || envelope.actor.id.length === 0 || envelope.actor.id.length > 256) {
    throw new DomainError("INVALID_ACTOR_ID", "actor.id must be nonblank and bounded (1-256 chars)");
  }

  const validSources = ["CLI", "MCP", "INTERNAL", "IMPORT"];
  if (!validSources.includes(envelope.source)) {
    throw new DomainError("INVALID_SOURCE", `source must be one of: ${validSources.join(", ")}`);
  }

  if (!envelope.reason || typeof envelope.reason !== "string" || envelope.reason.length === 0 || envelope.reason.length > 512) {
    throw new DomainError("INVALID_REASON", "reason must be nonblank and bounded (1-512 chars)");
  }

  if (envelope.requestedAt !== undefined) {
    if (typeof envelope.requestedAt !== "string" || !envelope.requestedAt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/)) {
      throw new DomainError("INVALID_REQUESTED_AT", "requestedAt must be ISO 8601 format if provided");
    }
  }
}

/**
 * Execute a BookSet command with idempotency and audit trail.
 * Returns the command result with exact stored JSON bytes.
 */
export async function executeBookSetCommand<P, R>(
  sessionRunner: BusinessSessionRunner,
  command: BookSetCommandAction,
  envelope: CommandEnvelope<P>,
  payload: P,
  execute: (session: BusinessSession, tenantId: TenantId, bookSetId: BookSetId | null) => Promise<R>,
): Promise<CommandResult<R>> {
  validateCommandEnvelope(envelope);
  const commandHash = computeCommandHash(command, envelope, payload);

  return sessionRunner.withBusinessSession("write", async (session) => {
    const requestHash = commandHash;
    const existingIdempotency = await lookupIdempotency(
      session,
      envelope.tenantId,
      envelope.requestId,
    );

    if (existingIdempotency) {
      const storedHash = existingIdempotency.requestHash;
      if (storedHash !== requestHash) {
        throw new IdempotencyConflictError(
          `same request_id with different request hash: expected ${requestHash}, got ${storedHash}`,
        );
      }

      const expectedResultHash = computeResultHash(existingIdempotency.resultJson);
      if (expectedResultHash !== existingIdempotency.resultHash) {
        throw new IdempotencyCorruptError(
          `stored result_json hash mismatch: expected ${expectedResultHash}, got ${existingIdempotency.resultHash}`,
        );
      }

      return {
        resultJson: existingIdempotency.resultJson,
        resultHash: existingIdempotency.resultHash,
        replayed: true,
      };
    }

    let bookSetId: BookSetId | null = null;
    let result: R;

    try {
      result = await execute(session, envelope.tenantId, bookSetId);
    } catch (error) {
      throw error;
    }

    const resultJson = canonicalJson(result);
    const resultHash = computeResultHash(resultJson);
    const now = new Date().toISOString();

    const auditId = randomUUID();
    await session.execute(
      `INSERT INTO audit_records
       (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id,
        canonical_before_hash, canonical_after_hash, change_summary, committed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        envelope.tenantId,
        bookSetId,
        command,
        command,
        envelope.actor.kind,
        envelope.actor.id,
        envelope.source,
        envelope.reason,
        envelope.requestId,
        null,
        resultHash,
        JSON.stringify({ action: command, status: "success" }),
        now,
        now,
      ],
    );

    const idempotencyId = randomUUID();
    await session.execute(
      `INSERT INTO idempotency_records
       (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        idempotencyId,
        envelope.tenantId,
        envelope.requestId,
        requestHash,
        resultJson,
        resultHash,
        now,
      ],
    );

    return {
      resultJson,
      resultHash,
    };
  });
}

async function lookupIdempotency(
  session: BusinessSession,
  tenantId: TenantId,
  requestId: string,
): Promise<IdempotencyRow | null> {
  const result = await session.querySingle(
    "SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?",
    [tenantId, requestId],
  );

  if (!result) return null;

  return {
    requestHash: result.request_hash as string,
    resultJson: result.result_json as string,
    resultHash: result.result_hash as string,
  };
}

/**
 * Command implementations
 */

export interface BookSetCreateResult {
  bookSetId: BookSetId;
  kind: string;
  displayName: string;
  lifecycle: string;
  createdAt: string;
}

export async function executeBookSetCreate(
  sessionRunner: BusinessSessionRunner,
  envelope: CommandEnvelope<BookSetCreatePayload>,
): Promise<CommandResult<BookSetCreateResult>> {
  return executeBookSetCommand(
    sessionRunner,
    "bookset.create",
    envelope,
    envelope.payload,
    async (session, tenantId) => {
      const payload = envelope.payload;

      // Validate payload
      const validKinds = ["COMPANY", "PERSONAL", "PROPRIETORSHIP"];
      if (!validKinds.includes(payload.kind)) {
        throw new DomainError("INVALID_BOOK_SET_KIND", `kind must be one of: ${validKinds.join(", ")}`);
      }

      if (!payload.displayName || typeof payload.displayName !== "string") {
        throw new DomainError("INVALID_DISPLAY_NAME", "displayName must be a nonblank string");
      }

      const trimmedName = payload.displayName.trim();
      if (trimmedName.length === 0 || trimmedName.length > 256) {
        throw new DomainError("INVALID_DISPLAY_NAME", "displayName must be trimmed and bounded (1-256 chars)");
      }

      const repo = new SqliteBookSetRepository(session);
      const bookSetId = brandBookSetId(randomUUID());
      const now = new Date().toISOString();

      const bookSet = {
        id: bookSetId,
        tenantId,
        kind: payload.kind as "COMPANY" | "PERSONAL" | "PROPRIETORSHIP",
        displayName: trimmedName,
        lifecycle: "ACTIVE" as const,
        createdAt: now,
        updatedAt: now,
      };

      await repo.create(bookSet);

      return {
        bookSetId,
        kind: payload.kind,
        displayName: trimmedName,
        lifecycle: "ACTIVE",
        createdAt: now,
      };
    },
  );
}

export interface BookSetSetDefaultResult {
  bookSetId: BookSetId;
}

export async function executeBookSetSetDefault(
  sessionRunner: BusinessSessionRunner,
  envelope: CommandEnvelope<BookSetSetDefaultPayload>,
): Promise<CommandResult<BookSetSetDefaultResult>> {
  return executeBookSetCommand(
    sessionRunner,
    "bookset.set-default",
    envelope,
    envelope.payload,
    async (session, tenantId, _) => {
      const bookSetId = envelope.payload.bookSetId;
      const repo = new SqliteBookSetRepository(session);

      const bookSet = await repo.getById(bookSetId, tenantId);
      if (bookSet.lifecycle !== "ACTIVE") {
        throw new DomainError(
          "CANNOT_SET_INACTIVE_DEFAULT",
          `BookSet must be ACTIVE to set as default, got ${bookSet.lifecycle}`,
        );
      }

      const now = new Date().toISOString();
      await session.execute(
        "UPDATE tenants SET default_book_set_id = ?, updated_at = ? WHERE id = ?",
        [bookSetId, now, tenantId],
      );

      return { bookSetId };
    },
  );
}

export interface BookSetArchiveResult {
  bookSetId: BookSetId;
}

export async function executeBookSetArchive(
  sessionRunner: BusinessSessionRunner,
  envelope: CommandEnvelope<BookSetArchivePayload>,
): Promise<CommandResult<BookSetArchiveResult>> {
  return executeBookSetCommand(
    sessionRunner,
    "bookset.archive",
    envelope,
    envelope.payload,
    async (session, tenantId) => {
      const bookSetId = envelope.payload.bookSetId;
      const repo = new SqliteBookSetRepository(session);
      await repo.archive(bookSetId, tenantId);
      return { bookSetId };
    },
  );
}

export interface TenantActivateResult {
  tenantId: TenantId;
}

export async function executeTenantActivate(
  sessionRunner: BusinessSessionRunner,
  envelope: CommandEnvelope<TenantActivatePayload>,
): Promise<CommandResult<TenantActivateResult>> {
  return executeBookSetCommand(
    sessionRunner,
    "tenant.activate",
    envelope,
    envelope.payload,
    async (session, tenantId) => {
      const repo = new SqliteTenantRepository(session);
      const assertedBookSetId = envelope.payload.defaultBookSetId;

      const tenant = await repo.getById(tenantId);
      if (tenant.lifecycle !== "CREATING") {
        throw new DomainError(
          "TENANT_NOT_IN_CREATING_STATE",
          `Tenant must be in CREATING state to activate, got ${tenant.lifecycle}`,
        );
      }

      if (tenant.defaultBookSetId !== assertedBookSetId) {
        throw new DomainError(
          "MISMATCHED_DEFAULT_BOOK_SET",
          `Expected default BookSet ${assertedBookSetId}, but tenant has ${tenant.defaultBookSetId}`,
        );
      }

      const now = new Date().toISOString();
      await session.execute(
        "UPDATE tenants SET lifecycle = ?, updated_at = ? WHERE id = ?",
        ["ACTIVE", now, tenantId],
      );

      return { tenantId };
    },
  );
}
