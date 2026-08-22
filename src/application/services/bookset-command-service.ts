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
      const repo = new SqliteBookSetRepository(session);
      const bookSetId = brandBookSetId(randomUUID());
      const now = new Date().toISOString();

      const bookSet = {
        id: bookSetId,
        tenantId,
        kind: envelope.payload.kind as "COMPANY" | "PERSONAL" | "PROPRIETORSHIP",
        displayName: envelope.payload.displayName,
        lifecycle: "ACTIVE" as const,
        createdAt: now,
        updatedAt: now,
      };

      await repo.create(bookSet);

      return {
        bookSetId,
        kind: envelope.payload.kind,
        displayName: envelope.payload.displayName,
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
