/**
 * Tenant command service with idempotency and audit trail.
 * Implements tenant.create as the sole tenant bootstrap mutation.
 * All operations execute within a single BEGIN IMMEDIATE BusinessSession.
 */
import { randomUUID, createHash } from "crypto";
import type { BusinessSessionRunner, BusinessSession } from "../ports/persistence.ts";
import type { TenantId, BookSetId, AccountId } from "../../core/types.ts";
import {
  DomainError,
  IdempotencyConflictError,
  IdempotencyCorruptError,
  brandTenantId,
  brandBookSetId,
  brandAccountId,
  currentTimestamp,
} from "../../core/types.ts";
import type {
  CommandEnvelope,
  TenantCreatePayload,
  CommandResult,
} from "../commands.ts";
import {
  computeResultHash,
  canonicalJson,
} from "../commands.ts";
import { SqliteTenantRepository } from "../../infrastructure/repositories/tenant-repository.ts";
import { SqliteBookSetRepository } from "../../infrastructure/repositories/book-set-repository.ts";
import { SqliteAccountRepository } from "../../infrastructure/repositories/account-repository.ts";

/**
 * Seed accounts for a newly created BookSet.
 * Creates fundamental chart of accounts hierarchy.
 */
async function seedAccountsForBookSet(
  session: BusinessSession,
  tenantId: TenantId,
  bookSetId: BookSetId,
): Promise<{ assets: AccountId; cash: AccountId; liabilities: AccountId; equity: AccountId; income: AccountId; expenses: AccountId }> {
  const repo = new SqliteAccountRepository(session);
  const now = currentTimestamp();

  const assets = brandAccountId(randomUUID());
  const cash = brandAccountId(randomUUID());
  const liabilities = brandAccountId(randomUUID());
  const equity = brandAccountId(randomUUID());
  const income = brandAccountId(randomUUID());
  const expenses = brandAccountId(randomUUID());

  await repo.create({
    id: assets,
    tenantId,
    bookSetId,
    code: "1000",
    name: "Assets",
    accountType: "ASSET",
    createdAt: now,
    updatedAt: now,
  });

  await repo.create({
    id: cash,
    tenantId,
    bookSetId,
    code: "1100",
    name: "Cash",
    accountType: "ASSET",
    parentAccountId: assets,
    createdAt: now,
    updatedAt: now,
  });

  await repo.create({
    id: liabilities,
    tenantId,
    bookSetId,
    code: "2000",
    name: "Liabilities",
    accountType: "LIABILITY",
    createdAt: now,
    updatedAt: now,
  });

  await repo.create({
    id: equity,
    tenantId,
    bookSetId,
    code: "3000",
    name: "Equity",
    accountType: "EQUITY",
    createdAt: now,
    updatedAt: now,
  });

  await repo.create({
    id: income,
    tenantId,
    bookSetId,
    code: "4000",
    name: "Income",
    accountType: "INCOME",
    createdAt: now,
    updatedAt: now,
  });

  await repo.create({
    id: expenses,
    tenantId,
    bookSetId,
    code: "5000",
    name: "Expenses",
    accountType: "EXPENSE",
    createdAt: now,
    updatedAt: now,
  });

  return { assets, cash, liabilities, equity, income, expenses };
}

export interface TenantCreateResult {
  tenantId: TenantId;
  tenantKind: string;
  tenantName: string;
  tenantLifecycle: string;
  baseCurrency: string;
  defaultBookSetId: BookSetId;
  seedAccountIds: {
    assets: AccountId;
    cash: AccountId;
    liabilities: AccountId;
    equity: AccountId;
    income: AccountId;
    expenses: AccountId;
  };
}

/**
 * Execute tenant.create command with idempotency and audit trail.
 * Returns the command result with exact stored JSON bytes.
 *
 * This is a global command (no tenant context yet), so requestId is not tenant-scoped.
 * The request_hash is computed from (kind, name, baseCurrency).
 */
export async function executeTenantCreate(
  sessionRunner: BusinessSessionRunner,
  envelope: CommandEnvelope<TenantCreatePayload>,
): Promise<CommandResult<TenantCreateResult>> {
  const payload = envelope.payload;

  if (envelope.schemaVersion !== 1) {
    throw new DomainError("INVALID_SCHEMA_VERSION", "schemaVersion must be 1");
  }

  if (!payload.kind || !["COMPANY", "INDIVIDUAL"].includes(payload.kind)) {
    throw new DomainError("INVALID_TENANT_KIND", `kind must be COMPANY or INDIVIDUAL`);
  }

  if (!payload.name || typeof payload.name !== "string" || payload.name.trim().length === 0) {
    throw new DomainError("INVALID_TENANT_NAME", "name must be a nonblank string");
  }

  const baseCurrency = payload.baseCurrency ?? "INR";
  if (!baseCurrency || typeof baseCurrency !== "string" || baseCurrency.length < 3 || baseCurrency.length > 3) {
    throw new DomainError("INVALID_BASE_CURRENCY", "baseCurrency must be a 3-character code (default: INR)");
  }

  const requestHashSource = `${payload.kind}|${payload.name.trim()}|${baseCurrency}`;
  const requestHash = createHash("sha256").update(requestHashSource).digest("hex");

  return sessionRunner.withBusinessSession("write", async (session) => {
    // Check existing idempotency record (global, not tenant-scoped)
    const existingCreationRequest = await session.querySingle(
      "SELECT request_hash, result_json, result_hash FROM tenant_creation_requests WHERE request_id = ?",
      [envelope.requestId],
    );

    if (existingCreationRequest) {
      const storedHash = existingCreationRequest.request_hash as string;
      if (storedHash !== requestHash) {
        throw new IdempotencyConflictError(
          `same request_id with different request hash: expected ${requestHash}, got ${storedHash}`,
        );
      }

      const expectedResultHash = computeResultHash(existingCreationRequest.result_json as string);
      if (expectedResultHash !== (existingCreationRequest.result_hash as string)) {
        throw new IdempotencyCorruptError(
          `stored result_json hash mismatch: expected ${expectedResultHash}, got ${existingCreationRequest.result_hash as string}`,
        );
      }

      return {
        resultJson: existingCreationRequest.result_json as string,
        resultHash: existingCreationRequest.result_hash as string,
        replayed: true,
      };
    }

    // Reserve the request (prevent concurrent race)
    const requestRecordId = randomUUID();
    const now = new Date().toISOString();
    await session.execute(
      `INSERT INTO tenant_creation_requests (id, request_id, request_hash, tenant_id, result_json, result_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [requestRecordId, envelope.requestId, requestHash, null, null, null, now],
    );

    // Create tenant in CREATING state
    const tenantId = brandTenantId(randomUUID());
    const bookSetId = brandBookSetId(randomUUID());
    const bookSetKind = payload.kind === "COMPANY" ? "COMPANY" : "PERSONAL";
    const displayName = bookSetKind === "COMPANY" ? "Company" : "Personal";

    await session.execute(
      `INSERT INTO tenants (id, kind, lifecycle, name, base_currency, default_book_set_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, payload.kind, "CREATING", payload.name.trim(), baseCurrency, null, now, now],
    );

    // Create default BookSet (ACTIVE)
    await session.execute(
      `INSERT INTO book_sets (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [bookSetId, tenantId, bookSetKind, displayName, "ACTIVE", now, now],
    );

    // Update tenant to set default_book_set_id
    await session.execute(
      "UPDATE tenants SET default_book_set_id = ?, updated_at = ? WHERE id = ?",
      [bookSetId, now, tenantId],
    );

    // Seed accounts in the BookSet
    const seedAccounts = await seedAccountsForBookSet(session, tenantId, bookSetId);

    // Build result
    const result: TenantCreateResult = {
      tenantId,
      tenantKind: payload.kind,
      tenantName: payload.name.trim(),
      tenantLifecycle: "CREATING",
      baseCurrency,
      defaultBookSetId: bookSetId,
      seedAccountIds: seedAccounts,
    };

    const resultJson = canonicalJson(result);
    const resultHash = computeResultHash(resultJson);

    // Create audit record
    const auditId = randomUUID();
    await session.execute(
      `INSERT INTO audit_records
       (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id,
        canonical_before_hash, canonical_after_hash, change_summary, committed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        tenantId,
        null,
        "tenant.create",
        "tenant.create",
        envelope.actor.kind,
        envelope.actor.id,
        envelope.source,
        envelope.reason,
        envelope.requestId,
        null,
        resultHash,
        JSON.stringify({ action: "tenant.create", status: "success" }),
        now,
        now,
      ],
    );

    // Finalize idempotency record
    await session.execute(
      "UPDATE tenant_creation_requests SET tenant_id = ?, result_json = ?, result_hash = ? WHERE request_id = ?",
      [tenantId, resultJson, resultHash, envelope.requestId],
    );

    return {
      resultJson,
      resultHash,
    };
  });
}
