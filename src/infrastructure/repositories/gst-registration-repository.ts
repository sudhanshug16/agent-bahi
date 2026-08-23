import type { BusinessSessionRunner } from "../../application/ports/persistence.ts";
import type { GstRegistration, GstRegistrationRepository } from "../../application/ports/repositories.ts";
import type { TenantId } from "../../core/types.ts";
import { normalizeGstin } from "../../application/services/gst-service.ts";

/** Tenant-scoped GST registration repository; date selection is inclusive. */
export class SqliteGstRegistrationRepository implements GstRegistrationRepository {
  constructor(private readonly sessions: BusinessSessionRunner) {}

  async register(registration: GstRegistration): Promise<void> {
    const gstin = normalizeGstin(registration.gstin);
    await this.sessions.withBusinessSession("write", async (session) => {
      await session.execute(
        "INSERT INTO gst_registrations (id, tenant_id, gstin, state, scheme, status, effective_from, effective_to, fingerprint, fingerprint_key_id, last_four, redacted_display, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [registration.id, registration.tenantId, gstin, registration.state ?? gstin.slice(0, 2), registration.scheme ?? null, registration.status, registration.effectiveFrom, registration.effectiveTo ?? null, registration.fingerprint ?? null, registration.fingerprintKeyId ?? null, registration.lastFour ?? null, registration.redactedDisplay ?? null, registration.createdAt, registration.updatedAt],
      );
    });
  }

  async getActiveByTenantAndDate(tenantId: TenantId, date: string): Promise<GstRegistration[]> {
    return this.sessions.withBusinessSession("read", async (session) => {
      const result = await session.query("SELECT id, tenant_id, gstin, state, scheme, status, effective_from, effective_to, fingerprint, fingerprint_key_id, last_four, redacted_display, created_at, updated_at FROM gst_registrations WHERE tenant_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND effective_to >= ? OR tenant_id = ? AND status = 'ACTIVE' AND effective_from <= ? AND effective_to IS NULL ORDER BY gstin, effective_from, id", [tenantId, date, date, tenantId, date]);
      return result.rows.map((row) => this.map(row));
    });
  }

  async getByGstin(gstin: string, tenantId: TenantId): Promise<GstRegistration | null> {
    const normalized = normalizeGstin(gstin);
    return this.sessions.withBusinessSession("read", async (session) => {
      const row = await session.querySingle("SELECT id, tenant_id, gstin, state, scheme, status, effective_from, effective_to, fingerprint, fingerprint_key_id, last_four, redacted_display, created_at, updated_at FROM gst_registrations WHERE tenant_id = ? AND gstin = ? ORDER BY effective_from DESC, id DESC LIMIT 1", [tenantId, normalized]);
      return row ? this.map(row) : null;
    });
  }

  private map(row: Record<string, unknown>): GstRegistration {
    return { id: String(row.id), tenantId: String(row.tenant_id) as TenantId, gstin: String(row.gstin), ...(row.state == null ? {} : { state: String(row.state) }), ...(row.scheme == null ? {} : { scheme: String(row.scheme) }), status: String(row.status), effectiveFrom: String(row.effective_from), ...(row.effective_to == null ? {} : { effectiveTo: String(row.effective_to) }), ...(row.fingerprint == null ? {} : { fingerprint: String(row.fingerprint) }), ...(row.fingerprint_key_id == null ? {} : { fingerprintKeyId: String(row.fingerprint_key_id) }), ...(row.last_four == null ? {} : { lastFour: String(row.last_four) }), ...(row.redacted_display == null ? {} : { redactedDisplay: String(row.redacted_display) }), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }
}
