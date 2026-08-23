import { createHash, randomUUID } from "node:crypto";
import type { TenantId } from "../../core/types.ts";
import { DomainError, IdempotencyConflictError, IdempotencyCorruptError } from "../../core/types.ts";
import type { BusinessSession, BusinessSessionRunner } from "../ports/persistence.ts";
import type { CommandEnvelope, CommandResult } from "../commands.ts";
import { canonicalJson, computeCommandHash, computeResultHash } from "../commands.ts";

export interface TenantPanSetPayload {
  pan: string;
  expectedCurrentHash?: string;
  reason?: string;
  confirm?: boolean;
}

export type TenantPanChangeKind = "INITIAL_SET" | "REPLACED" | "NO_OP";

export interface TenantPanSetResult {
  panProfileId: string;
  lookupHash: string;
  maskedPan: string;
  changeKind: TenantPanChangeKind;
}

export interface TenantPanProfileView {
  panProfileId: string;
  tenantId: string;
  lookupHash: string;
  lastFour: string;
  maskedPan: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantPanReveal extends TenantPanProfileView {
  pan: string;
}

type PanRow = {
  id: string;
  tenant_id: string;
  pan: string;
  lookup_hash: string;
  last_four: string;
  masked_display: string;
  created_at: string;
  updated_at: string;
};

function normalizePan(value: unknown): string {
  if (typeof value !== "string") throw new DomainError("INVALID_PAN", "pan must be a 10-character Indian PAN");
  const pan = value.trim().toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new DomainError("INVALID_PAN", "pan must be a 10-character Indian PAN");
  return pan;
}

function lookupHash(pan: string): string {
  return createHash("sha256").update(pan).digest("hex");
}

function maskedPan(pan: string): string {
  return `******${pan.slice(-4)}`;
}

function nonblank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("PAN_REPLACEMENT_REASON_REQUIRED", `${field} must be nonblank`);
  return value.trim();
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function redactPan(value: string): string {
  return value.replace(/\b[A-Z]{5}[\s-]*[0-9]{4}[\s-]*[A-Z]\b/gi, "[REDACTED_PAN]");
}

function view(row: PanRow): TenantPanProfileView {
  return {
    panProfileId: String(row.id),
    tenantId: String(row.tenant_id),
    lookupHash: String(row.lookup_hash),
    lastFour: String(row.last_four),
    maskedPan: String(row.masked_display),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function tenantExists(session: BusinessSession, tenantId: TenantId): Promise<void> {
  if (!await session.querySingle("SELECT id FROM tenants WHERE id = ?", [tenantId])) {
    throw new DomainError("TENANT_NOT_FOUND", "Tenant does not exist");
  }
}

async function existingIdempotency(session: BusinessSession, tenantId: TenantId, requestId: string, requestHash: string): Promise<CommandResult<TenantPanSetResult> | undefined> {
  const row = await session.querySingle("SELECT request_hash, result_json, result_hash FROM idempotency_records WHERE tenant_id = ? AND request_id = ?", [tenantId, requestId]);
  if (!row) return undefined;
  if (String(row.request_hash) !== requestHash) throw new IdempotencyConflictError("same request_id with different request hash");
  if (computeResultHash(String(row.result_json)) !== String(row.result_hash)) throw new IdempotencyCorruptError("stored result_json hash mismatch");
  return { resultJson: String(row.result_json), resultHash: String(row.result_hash), replayed: true };
}

async function profileForTenant(session: BusinessSession, tenantId: TenantId): Promise<PanRow | undefined> {
  return await session.querySingle(
    "SELECT id, tenant_id, pan, lookup_hash, last_four, masked_display, created_at, updated_at FROM tenant_pan_profiles WHERE tenant_id = ?",
    [tenantId],
  ) as PanRow | undefined;
}

export async function executeTenantPanSet(
  sessionRunner: BusinessSessionRunner,
  envelope: CommandEnvelope<TenantPanSetPayload>,
): Promise<CommandResult<TenantPanSetResult>> {
  if (envelope.schemaVersion !== 1) throw new DomainError("INVALID_SCHEMA_VERSION", "schemaVersion must be 1");
  if (typeof envelope.reason !== "string" || envelope.reason.trim() === "") throw new DomainError("INVALID_COMMAND_REASON", "reason must be nonblank");
  if (!envelope.payload || typeof envelope.payload !== "object") throw new DomainError("INVALID_PAN", "pan must be a 10-character Indian PAN");
  const pan = normalizePan(envelope.payload?.pan);
  const payload = envelope.payload;
  const requestHash = computeCommandHash("tenant.pan.set", envelope, payload);

  return sessionRunner.withBusinessSession("write", async (session) => {
    await tenantExists(session, envelope.tenantId);
    const prior = await existingIdempotency(session, envelope.tenantId, envelope.requestId, requestHash);
    if (prior) return prior;

    const current = await profileForTenant(session, envelope.tenantId);
    const nextHash = lookupHash(pan);
    const now = new Date().toISOString();
    let profileId: string;
    let changeKind: TenantPanChangeKind;
    let beforeHash: string | null = null;
    let auditReason = envelope.reason.trim();

    if (!current) {
      const owner = await session.querySingle("SELECT tenant_id FROM tenant_pan_profiles WHERE lookup_hash = ?", [nextHash]);
      if (owner) throw new DomainError("PAN_ALREADY_OWNED", "PAN is already assigned to another tenant");
      profileId = randomUUID();
      changeKind = "INITIAL_SET";
      await session.execute(
        "INSERT INTO tenant_pan_profiles (id, tenant_id, pan, lookup_hash, last_four, masked_display, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [profileId, envelope.tenantId, pan, nextHash, pan.slice(-4), maskedPan(pan), now, now],
      );
    } else if (String(current.lookup_hash) === nextHash) {
      profileId = String(current.id);
      changeKind = "NO_OP";
      beforeHash = String(current.lookup_hash);
    } else {
      beforeHash = String(current.lookup_hash);
      if (!validHash(payload.expectedCurrentHash) || payload.expectedCurrentHash !== beforeHash) {
        throw new DomainError("PAN_REPLACEMENT_STALE", "PAN replacement confirmation is stale or missing");
      }
      const replacementReason = nonblank(payload.reason, "reason");
      if (payload.confirm !== true) throw new DomainError("PAN_REPLACEMENT_CONFIRMATION_REQUIRED", "Explicit confirmation is required for PAN replacement");
      const owner = await session.querySingle("SELECT tenant_id FROM tenant_pan_profiles WHERE lookup_hash = ? AND tenant_id <> ?", [nextHash, envelope.tenantId]);
      if (owner) throw new DomainError("PAN_ALREADY_OWNED", "PAN is already assigned to another tenant");
      profileId = String(current.id);
      changeKind = "REPLACED";
      auditReason = replacementReason;
      await session.execute(
        "UPDATE tenant_pan_profiles SET pan = ?, lookup_hash = ?, last_four = ?, masked_display = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND lookup_hash = ?",
        [pan, nextHash, pan.slice(-4), maskedPan(pan), now, profileId, envelope.tenantId, beforeHash],
      );
    }

    auditReason = redactPan(auditReason);
    const result: TenantPanSetResult = { panProfileId: profileId, lookupHash: nextHash, maskedPan: maskedPan(pan), changeKind };
    const resultJson = canonicalJson(result);
    const resultHash = computeResultHash(resultJson);
    await session.execute(
      "INSERT INTO audit_records (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id, canonical_before_hash, canonical_after_hash, change_summary, committed_at, created_at) VALUES (?, ?, NULL, 'tenant.pan.set', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), envelope.tenantId, changeKind, envelope.actor.kind, envelope.actor.id, envelope.source, auditReason, envelope.requestId, beforeHash, nextHash, JSON.stringify({ panProfileId: profileId, lookupHash: nextHash, maskedPan: maskedPan(pan), changeKind }), now, now],
    );
    await session.execute(
      "INSERT INTO idempotency_records (id, tenant_id, request_id, request_hash, result_json, result_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), envelope.tenantId, envelope.requestId, requestHash, resultJson, resultHash, now],
    );
    return { resultJson, resultHash };
  });
}

export async function getTenantPanProfile(sessionRunner: BusinessSessionRunner, tenantId: TenantId): Promise<TenantPanProfileView | null> {
  return sessionRunner.withBusinessSession("read", async (session) => {
    await tenantExists(session, tenantId);
    const row = await profileForTenant(session, tenantId);
    return row ? view(row) : null;
  });
}

export async function revealTenantPan(sessionRunner: BusinessSessionRunner, tenantId: TenantId): Promise<TenantPanReveal> {
  return sessionRunner.withBusinessSession("read", async (session) => {
    await tenantExists(session, tenantId);
    const row = await profileForTenant(session, tenantId);
    if (!row) throw new DomainError("PAN_NOT_SET", "Tenant PAN is not set");
    return { ...view(row), pan: String(row.pan) };
  });
}
