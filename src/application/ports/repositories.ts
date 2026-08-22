/**
 * Repository ports - interfaces for persistence of domain entities.
 * Applications depend on these ports; infrastructure implements them.
 */

import type { TenantId, BookSetId, AccountId } from "../../core/types.ts";

export interface Tenant {
  id: TenantId;
  kind: "COMPANY" | "INDIVIDUAL";
  lifecycle: "CREATING" | "ACTIVE" | "ARCHIVED";
  name: string;
  baseCurrency: string;
  defaultBookSetId?: BookSetId;
  createdAt: string;
  updatedAt: string;
}

export interface BookSet {
  id: BookSetId;
  tenantId: TenantId;
  kind: "COMPANY" | "PERSONAL" | "PROPRIETORSHIP";
  lifecycle: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: AccountId;
  tenantId: TenantId;
  bookSetId: BookSetId;
  code: string;
  name: string;
  accountType: string;
  parentAccountId?: AccountId;
  createdAt: string;
  updatedAt: string;
}

export interface TenantRepository {
  /**
   * Create a new tenant in CREATING state.
   * Must be atomic with the default BookSet creation.
   */
  create(tenant: Tenant, defaultBookSet: BookSet): Promise<void>;

  /**
   * Get tenant by ID. Fails if not found.
   */
  getById(tenantId: TenantId): Promise<Tenant>;

  /**
   * List all active tenants.
   */
  listActive(): Promise<Tenant[]>;

  /**
   * Update tenant (lifecycle, name, etc.).
   * Prevents archiving/deleting if defaultBookSetId is active.
   */
  update(tenant: Tenant): Promise<void>;

  /**
   * Activate tenant (transition from CREATING to ACTIVE).
   * Must update both tenant and idempotency record atomically.
   */
  activate(tenantId: TenantId): Promise<void>;

  /**
   * Archive tenant (cannot if default BookSet is active).
   */
  archive(tenantId: TenantId): Promise<void>;
}

export interface BookSetRepository {
  /**
   * Create a new BookSet.
   */
  create(bookSet: BookSet): Promise<void>;

  /**
   * Get BookSet by ID. Fails if not found or cross-tenant.
   */
  getById(bookSetId: BookSetId, tenantId: TenantId): Promise<BookSet>;

  /**
   * Get default BookSet for tenant.
   */
  getDefault(tenantId: TenantId): Promise<BookSet>;

  /**
   * Get BookSet of specific kind for tenant (used for COMPANY, PERSONAL validation).
   */
  getByKind(tenantId: TenantId, kind: "COMPANY" | "PERSONAL" | "PROPRIETORSHIP"): Promise<BookSet | null>;

  /**
   * List BookSets for tenant.
   */
  listByTenant(tenantId: TenantId): Promise<BookSet[]>;

  /**
   * Archive BookSet (cannot if it's current default).
   */
  archive(bookSetId: BookSetId, tenantId: TenantId): Promise<void>;
}

export interface AccountRepository {
  /**
   * Create account.
   */
  create(account: Account): Promise<void>;

  /**
   * Get account by ID, with cross-tenant/cross-BookSet verification.
   */
  getById(accountId: AccountId, tenantId: TenantId, bookSetId: BookSetId): Promise<Account>;

  /**
   * Get account by code within tenant/BookSet scope.
   * Code is unique per (tenantId, bookSetId).
   */
  getByCode(code: string, tenantId: TenantId, bookSetId: BookSetId): Promise<Account | null>;

  /**
   * List accounts for BookSet.
   */
  listByBookSet(tenantId: TenantId, bookSetId: BookSetId): Promise<Account[]>;

  /**
   * Update account.
   */
  update(account: Account): Promise<void>;
}

export interface LegalIdentity {
  id: string;
  identityType: "INDIVIDUAL_PAN" | "COMPANY_CIN";
  fingerprint: string;
  fingerprintKeyId?: string;
  lastFour?: string;
  redactedDisplay?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LegalIdentityRepository {
  /**
   * Register a new legal identity with PAN/CIN fingerprint.
   * Fingerprint must be unique globally.
   */
  register(identity: LegalIdentity): Promise<void>;

  /**
   * Get legal identity by fingerprint.
   */
  getByFingerprint(fingerprint: string): Promise<LegalIdentity | null>;

  /**
   * Redact a legal identity (mark as redacted).
   */
  redact(id: string): Promise<void>;
}

export interface GstRegistration {
  id: string;
  tenantId: TenantId;
  gstin: string;
  state?: string;
  scheme?: string;
  status: string;
  effectiveFrom: string;
  effectiveTo?: string;
  fingerprint?: string;
  fingerprintKeyId?: string;
  lastFour?: string;
  redactedDisplay?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GstRegistrationRepository {
  /**
   * Register GST registration for tenant.
   * GSTIN is unique per tenant, but multiple registrations may apply at different dates.
   */
  register(registration: GstRegistration): Promise<void>;

  /**
   * Get active, applicable GST registrations for tenant at a given date.
   */
  getActiveByTenantAndDate(tenantId: TenantId, date: string): Promise<GstRegistration[]>;

  /**
   * Get registration by GSTIN within tenant.
   */
  getByGstin(gstin: string, tenantId: TenantId): Promise<GstRegistration | null>;
}

export interface Evidence {
  id: string;
  tenantId: TenantId;
  contentHash: string;
  storageReference?: string;
  metadataJson?: string;
  createdAt: string;
}

export interface EvidenceRepository {
  /**
   * Register evidence with content hash.
   * Hash is globally unique (content-addressed).
   */
  register(evidence: Evidence): Promise<void>;

  /**
   * Get evidence by hash.
   */
  getByHash(hash: string): Promise<Evidence | null>;

  /**
   * List evidence for tenant.
   */
  listByTenant(tenantId: TenantId): Promise<Evidence[]>;
}

export interface AuditRecord {
  id: string;
  tenantId: TenantId;
  action: string;
  actorType: string;
  actorId?: string;
  requestId?: string;
  entityType?: string;
  entityId?: string;
  changeSummary?: string;
  evidenceIds?: string;
  createdAt: string;
}

export interface AuditRepository {
  /**
   * Append audit record (immutable).
   */
  append(record: AuditRecord): Promise<void>;

  /**
   * Get audit records for tenant.
   */
  getByTenant(tenantId: TenantId, limit?: number, offset?: number): Promise<AuditRecord[]>;

  /**
   * Get audit record by request ID.
   */
  getByRequestId(requestId: string): Promise<AuditRecord[]>;
}

export interface IdempotencyRecord {
  id: string;
  tenantId: TenantId;
  requestId: string;
  requestHash: string;
  resultJson: string;
  resultHash: string;
  createdAt: string;
}

export interface IdempotencyRepository {
  /**
   * Get or create idempotency record.
   * If same request ID with same hash, return cached result.
   * If same request ID with different hash, throw conflict error.
   */
  getOrCreate(record: IdempotencyRecord): Promise<{ cached: boolean; result: IdempotencyRecord }>;

  /**
   * Get existing idempotency record by request ID.
   */
  getByRequestId(tenantId: TenantId, requestId: string): Promise<IdempotencyRecord | null>;
}
