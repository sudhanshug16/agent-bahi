/**
 * Versioned command types for BookSet and Tenant mutations.
 * Provides stable request/response envelopes with audit traceability.
 */
import { randomUUID } from "crypto";
import { createHash } from "node:crypto";
import type { TenantId, BookSetId } from "../core/types.ts";

export type ActorKind = "HUMAN" | "AGENT" | "SYSTEM";
export type CommandSource = "CLI" | "MCP" | "INTERNAL" | "IMPORT";
export type BookSetCommandAction = "bookset.create" | "bookset.set-default" | "bookset.archive" | "tenant.activate";
export type TenantCommandAction = "tenant.create";
export type TenantPanCommandAction = "tenant.pan.set";

export interface Actor {
  kind: ActorKind;
  id: string;
}

export interface CommandEnvelope<T> {
  schemaVersion: 1;
  tenantId: TenantId;
  requestId: string;
  actor: Actor;
  source: CommandSource;
  reason: string;
  requestedAt?: string;
  payload: T;
}

export interface BookSetCreatePayload {
  kind: "COMPANY" | "PERSONAL" | "PROPRIETORSHIP";
  displayName: string;
}

export interface BookSetSetDefaultPayload {
  bookSetId: BookSetId;
}

export interface BookSetArchivePayload {
  bookSetId: BookSetId;
}

export interface TenantActivatePayload {
  defaultBookSetId: BookSetId;
}

export interface TenantCreatePayload {
  kind: "COMPANY" | "INDIVIDUAL";
  name: string;
  baseCurrency?: string;
}

export interface TenantPanSetPayload {
  pan: string;
  expectedCurrentHash?: string;
  reason?: string;
  confirm?: boolean;
}

export interface CommandResult<T> {
  resultJson: string;
  resultHash: string;
  replayed?: boolean;
}

/**
 * Canonicalizes command data for deterministic hashing.
 * Sorted keys, no whitespace, consistent type representation.
 */
export function canonicalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeValue(entry)])
    );
  }
  return value;
}

export function canonicalJson(obj: unknown): string {
  return JSON.stringify(canonicalizeValue(obj));
}

export function computeCommandHash(command: string, envelope: CommandEnvelope<unknown>, payload: unknown): string {
  const scopedEnvelope = envelope as CommandEnvelope<unknown> & { bookSetId?: string };
  const normalized = {
    schemaVersion: envelope.schemaVersion,
    command,
    tenantId: envelope.tenantId,
    bookSetId: scopedEnvelope.bookSetId,
    requestId: envelope.requestId,
    actor: canonicalizeValue(envelope.actor),
    source: envelope.source,
    reason: envelope.reason,
    requestedAt: envelope.requestedAt,
    payload: canonicalizeValue(payload),
  };
  const json = canonicalJson(normalized);
  return createHash("sha256").update(json).digest("hex");
}

export function computeResultHash(resultJson: string): string {
  return createHash("sha256").update(resultJson).digest("hex");
}
