// Core immutable value types
export type TenantId = string & { readonly __brand: "TenantId" };
export type BookSetId = string & { readonly __brand: "BookSetId" };
export type AccountId = string & { readonly __brand: "AccountId" };
export type UserId = string & { readonly __brand: "UserId" };

export function brandTenantId(id: string): TenantId {
  return id as TenantId;
}

export function brandBookSetId(id: string): BookSetId {
  return id as BookSetId;
}

export function brandAccountId(id: string): AccountId {
  return id as AccountId;
}

export function brandUserId(id: string): UserId {
  return id as UserId;
}

export type Dialect = "sqlite" | "postgresql" | "mysql";

export type TenantKind = "COMPANY" | "INDIVIDUAL";
export type TenantLifecycle = "CREATING" | "ACTIVE" | "ARCHIVED";
export type BookSetKind = "COMPANY" | "PERSONAL" | "PROPRIETORSHIP";
export type BookSetLifecycle = "ACTIVE" | "ARCHIVED";

// Timestamp stored as ISO string for consistency across dialects
export type Timestamp = string & { readonly __brand: "Timestamp" };

export function currentTimestamp(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

// Currency amount in minor units (e.g., paise for INR)
export type MoneyMinorUnits = bigint;

// Structured errors with tenant/scope context
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = code;
  }
}

export class TenantNotFoundError extends DomainError {
  constructor(tenantId: TenantId) {
    super("TENANT_NOT_FOUND", `Tenant not found: ${tenantId}`, { tenantId });
  }
}

export class IncompatibleDatabaseError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super("INCOMPATIBLE_DATABASE", message, context);
  }
}

export class MigrationLockedError extends DomainError {
  constructor(message: string) {
    super("MIGRATION_LOCKED", message);
  }
}

export class DirtyMigrationError extends DomainError {
  constructor(lastMigrationId: string) {
    super(
      "DIRTY_MIGRATION",
      `Database in dirty state from migration: ${lastMigrationId}. Requires manual recovery or rollback.`,
      { lastMigrationId },
    );
  }
}

export class MigrationChecksumError extends DomainError {
  constructor(migrationId: string, expectedChecksum: string, actualChecksum: string) {
    super(
      "MIGRATION_CHECKSUM_MISMATCH",
      `Migration checksum mismatch for ${migrationId}`,
      { migrationId, expectedChecksum, actualChecksum },
    );
  }
}

export class CrossTenantViolationError extends DomainError {
  constructor(operation: string, expectedTenantId: TenantId, actualTenantId: TenantId) {
    super(
      "CROSS_TENANT_VIOLATION",
      `Cross-tenant violation: ${operation}`,
      { operation, expectedTenantId, actualTenantId },
    );
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(message: string) {
    super("IDEMPOTENCY_CONFLICT", message);
  }
}
