import { describe, it, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { initializeAndUpgradeSqliteApplication } from "../src/application/application.ts";
import { Database as BunDatabase } from "bun:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

type TenantData = {
  tenantId: string;
  defaultBookSetId: string;
  seedAccountIds: { assets: string; cash: string; liabilities: string; equity: string; income: string; expenses: string };
};

function command(tenantId: string, bookSetId: string, requestId: string, actorId: string, payload: any) {
  return { schemaVersion: 1 as const, tenantId: tenantId as never, bookSetId: bookSetId as never, requestId, actor: { kind: "HUMAN" as const, id: actorId }, source: "CLI" as const, reason: "gst test", payload };
}

async function fixture() {
  const dbPath = join(tmpdir(), `gst-return-readiness-${randomUUID()}.sqlite`);
  const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(tmpdir(), `gst-backup-${randomUUID()}.sqlite`), cliVersion: "test", buildId: "gst-test" });
  const created = await app.tenant.create({ schemaVersion: 1, tenantId: `gst-${randomUUID()}` as never, requestId: "tenant", actor: { kind: "HUMAN", id: "creator" }, source: "CLI", reason: "gst test", payload: { kind: "COMPANY", name: "GST test" } });
  const tenant = JSON.parse(created.resultJson) as TenantData;

  // Create GST registration
  const gstRegResult = await app.gst.registration.create({ schemaVersion: 1, tenantId: tenant.tenantId as never, requestId: "gst-reg", actor: { kind: "HUMAN", id: "creator" }, source: "CLI", reason: "gst test", payload: { gstin: "27AAPFU0939F1ZV", state: "27", status: "ACTIVE", effectiveFrom: "2024-01-01" } });
  const gstReg = JSON.parse(gstRegResult.resultJson) as { registrationId: string };

  return { app, dbPath, tenant, gstReg, env: (requestId: string, actorId: string, payload: unknown) => command(tenant.tenantId, tenant.defaultBookSetId, requestId, actorId, payload) };
}

describe("GST Return Readiness V1", () => {
  it("records outward facts for posted sales invoice", async () => {
    const f = await fixture();
    try {
      // Create a party (customer)
      const party = await f.app.party.create(f.env("party", "creator", { displayName: "Customer A", partyRole: "CUSTOMER" }));
      const partyId = JSON.parse(party.resultJson).partyId as string;

      // Create a sales invoice
      const invoice = await f.app.invoice.create(f.env("invoice", "creator", { invoiceNumber: "INV-001", customerId: partyId, issueDate: "2024-08-15", lines: [{ description: "Services", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 100_000 }] }));
      const invoiceId = JSON.parse(invoice.resultJson).invoiceId as string;

      // Post the invoice
      await f.app.invoice.post(f.env("post-invoice", "creator", { invoiceId, receivableAccountId: f.tenant.seedAccountIds.assets }));

      // Record outward facts
      const facts = await f.app.gst.returnReadiness.outwardFacts.record(f.env("facts", "creator", { invoiceId, placeOfSupplyStateCode: "27", recipientRegistrationCategory: "REGISTERED", reverseChargeApplicable: false }));
      expect(facts.resultJson).toBeDefined();
      const parsed = JSON.parse(facts.resultJson);
      expect(parsed.factsId).toBeDefined();
      expect(parsed.invoiceId).toBe(invoiceId);
    } finally {
      new BunDatabase(f.dbPath).close();
    }
  });

  it("rejects outward facts for draft invoices", async () => {
    const f = await fixture();
    try {
      // Create a party
      const party = await f.app.party.create(f.env("party", "creator", { displayName: "Customer B", partyRole: "CUSTOMER" }));
      const partyId = JSON.parse(party.resultJson).partyId as string;

      // Create a draft sales invoice
      const invoice = await f.app.invoice.create(f.env("invoice", "creator", { invoiceNumber: "INV-002", customerId: partyId, issueDate: "2024-08-15", lines: [{ description: "Services", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 100_000 }] }));
      const invoiceId = JSON.parse(invoice.resultJson).invoiceId as string;

      // Try to record outward facts without posting
      try {
        await f.app.gst.returnReadiness.outwardFacts.record(f.env("facts", "creator", { invoiceId, placeOfSupplyStateCode: "27" }));
        expect(true).toBe(false); // Should throw
      } catch (e) {
        expect((e as any).code).toBe("INVOICE_NOT_POSTED");
      }
    } finally {
      new BunDatabase(f.dbPath).close();
    }
  });

  it("prevents duplicate outward facts recording", async () => {
    const f = await fixture();
    try {
      // Create a party and invoice
      const party = await f.app.party.create(f.env("party", "creator", { displayName: "Customer C", partyRole: "CUSTOMER" }));
      const partyId = JSON.parse(party.resultJson).partyId as string;

      const invoice = await f.app.invoice.create(f.env("invoice", "creator", { invoiceNumber: "INV-003", customerId: partyId, issueDate: "2024-08-15", lines: [{ description: "Services", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 100_000 }] }));
      const invoiceId = JSON.parse(invoice.resultJson).invoiceId as string;

      // Post the invoice
      await f.app.invoice.post(f.env("post-invoice", "creator", { invoiceId, receivableAccountId: f.tenant.seedAccountIds.assets }));

      // Record outward facts first time
      await f.app.gst.returnReadiness.outwardFacts.record(f.env("facts", "creator", { invoiceId, placeOfSupplyStateCode: "27" }));

      // Try to record again with different requestId
      try {
        await f.app.gst.returnReadiness.outwardFacts.record(f.env("facts2", "creator", { invoiceId, placeOfSupplyStateCode: "27" }));
        expect(true).toBe(false); // Should throw
      } catch (e) {
        expect((e as any).code).toBe("FACTS_ALREADY_RECORDED");
      }
    } finally {
      new BunDatabase(f.dbPath).close();
    }
  });

  it("prepares return snapshot for period", async () => {
    const f = await fixture();
    try {
      // Create a party and invoice
      const party = await f.app.party.create(f.env("party", "creator", { displayName: "Customer D", partyRole: "CUSTOMER" }));
      const partyId = JSON.parse(party.resultJson).partyId as string;

      const invoice = await f.app.invoice.create(f.env("invoice", "creator", { invoiceNumber: "INV-004", customerId: partyId, issueDate: "2024-08-15", lines: [{ description: "Services", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 100_000 }] }));
      const invoiceId = JSON.parse(invoice.resultJson).invoiceId as string;

      // Post the invoice
      await f.app.invoice.post(f.env("post-invoice", "creator", { invoiceId, receivableAccountId: f.tenant.seedAccountIds.assets }));

      // Prepare return
      const ret = await f.app.gst.returnReadiness.return.prepare(f.env("prepare", "creator", { registrationId: f.gstReg.registrationId, returnForm: "GSTR1", taxPeriodFrom: "2024-08-01", taxPeriodTo: "2024-08-31" }));
      expect(ret.resultJson).toBeDefined();
      const parsed = JSON.parse(ret.resultJson);
      expect(parsed.returnId).toBeDefined();
      expect(parsed.snapshotId).toBeDefined();
    } finally {
      new BunDatabase(f.dbPath).close();
    }
  });

  it("validates return and reports readiness status", async () => {
    const f = await fixture();
    try {
      // Create a party and invoice
      const party = await f.app.party.create(f.env("party", "creator", { displayName: "Customer E", partyRole: "CUSTOMER" }));
      const partyId = JSON.parse(party.resultJson).partyId as string;

      const invoice = await f.app.invoice.create(f.env("invoice", "creator", { invoiceNumber: "INV-005", customerId: partyId, issueDate: "2024-08-15", lines: [{ description: "Services", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 100_000 }] }));
      const invoiceId = JSON.parse(invoice.resultJson).invoiceId as string;

      // Post the invoice
      await f.app.invoice.post(f.env("post-invoice", "creator", { invoiceId, receivableAccountId: f.tenant.seedAccountIds.assets }));

      // Prepare return
      const ret = await f.app.gst.returnReadiness.return.prepare(f.env("prepare", "creator", { registrationId: f.gstReg.registrationId, returnForm: "GSTR1", taxPeriodFrom: "2024-08-01", taxPeriodTo: "2024-08-31" }));
      const snapshotId = JSON.parse(ret.resultJson).snapshotId as string;

      // Validate return
      const validation = await f.app.gst.returnReadiness.return.validate(f.tenant.tenantId as never, f.tenant.defaultBookSetId as never, snapshotId, "user-1");
      expect(validation.snapshotId).toBe(snapshotId);
      expect(["READY", "REVIEW_REQUIRED", "BLOCKED"]).toContain(validation.readinessStatus);
      expect(Array.isArray(validation.issues)).toBe(true);
    } finally {
      new BunDatabase(f.dbPath).close();
    }
  });

  it("returns readiness report per GSTIN", async () => {
    const f = await fixture();
    try {
      // Create a party and invoice
      const party = await f.app.party.create(f.env("party", "creator", { displayName: "Customer F", partyRole: "CUSTOMER" }));
      const partyId = JSON.parse(party.resultJson).partyId as string;

      const invoice = await f.app.invoice.create(f.env("invoice", "creator", { invoiceNumber: "INV-006", customerId: partyId, issueDate: "2024-08-15", lines: [{ description: "Services", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 100_000 }] }));
      const invoiceId = JSON.parse(invoice.resultJson).invoiceId as string;

      // Post the invoice
      await f.app.invoice.post(f.env("post-invoice", "creator", { invoiceId, receivableAccountId: f.tenant.seedAccountIds.assets }));

      // Prepare return
      await f.app.gst.returnReadiness.return.prepare(f.env("prepare", "creator", { registrationId: f.gstReg.registrationId, returnForm: "GSTR1", taxPeriodFrom: "2024-08-01", taxPeriodTo: "2024-08-31" }));

      // Get readiness report
      const report = await f.app.gst.returnReadiness.return.readinessReport(f.tenant.tenantId as never, f.tenant.defaultBookSetId as never);
      expect(Array.isArray(report)).toBe(true);
      const gstinEntry = report.find(r => r.gstin === "27AAPFU0939F1ZV");
      if (gstinEntry) {
        expect(gstinEntry.periodFrom).toBeDefined();
        expect(gstinEntry.periodTo).toBeDefined();
      }
    } finally {
      new BunDatabase(f.dbPath).close();
    }
  });

  it("records append-only observations", async () => {
    const f = await fixture();
    try {
      // Create a party and invoice
      const party = await f.app.party.create(f.env("party", "creator", { displayName: "Customer G", partyRole: "CUSTOMER" }));
      const partyId = JSON.parse(party.resultJson).partyId as string;

      const invoice = await f.app.invoice.create(f.env("invoice", "creator", { invoiceNumber: "INV-007", customerId: partyId, issueDate: "2024-08-15", lines: [{ description: "Services", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 100_000 }] }));
      const invoiceId = JSON.parse(invoice.resultJson).invoiceId as string;

      // Post the invoice
      await f.app.invoice.post(f.env("post-invoice", "creator", { invoiceId, receivableAccountId: f.tenant.seedAccountIds.assets }));

      // Prepare return
      const ret = await f.app.gst.returnReadiness.return.prepare(f.env("prepare", "creator", { registrationId: f.gstReg.registrationId, returnForm: "GSTR1", taxPeriodFrom: "2024-08-01", taxPeriodTo: "2024-08-31" }));
      const returnId = JSON.parse(ret.resultJson).returnId as string;

      // Record observation
      const obs = await f.app.gst.returnReadiness.return.recordObservation(f.env("obs", "creator", { returnId, observationType: "USER_MARKED_PORTAL_UPLOADED", narration: "Uploaded to portal" }));
      expect(obs.resultJson).toBeDefined();
      const parsed = JSON.parse(obs.resultJson);
      expect(parsed.observationId).toBeDefined();
      expect(parsed.returnId).toBe(returnId);
    } finally {
      new BunDatabase(f.dbPath).close();
    }
  });

  it("enforces tenant isolation", async () => {
    const f = await fixture();
    try {
      // Create second tenant
      const created2 = await f.app.tenant.create({ schemaVersion: 1, tenantId: `gst2-${randomUUID()}` as never, requestId: "tenant2", actor: { kind: "HUMAN", id: "creator" }, source: "CLI", reason: "gst test", payload: { kind: "COMPANY", name: "GST test 2" } });
      const tenant2 = JSON.parse(created2.resultJson) as { tenantId: string; defaultBookSetId: string };

      // Create and post invoice in first tenant
      const party = await f.app.party.create(f.env("party", "creator", { displayName: "Customer H", partyRole: "CUSTOMER" }));
      const partyId = JSON.parse(party.resultJson).partyId as string;

      const invoice = await f.app.invoice.create(f.env("invoice", "creator", { invoiceNumber: "INV-008", customerId: partyId, issueDate: "2024-08-15", lines: [{ description: "Services", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 100_000 }] }));
      const invoiceId = JSON.parse(invoice.resultJson).invoiceId as string;
      await f.app.invoice.post(f.env("post-invoice", "creator", { invoiceId, receivableAccountId: f.tenant.seedAccountIds.assets }));

      // Record facts in first tenant
      const facts = await f.app.gst.returnReadiness.outwardFacts.record(f.env("facts", "creator", { invoiceId, placeOfSupplyStateCode: "27" }));
      const factsId = JSON.parse(facts.resultJson).factsId as string;

      // Try to access from second tenant - should fail
      try {
        await f.app.gst.returnReadiness.outwardFacts.get(tenant2.tenantId as never, tenant2.defaultBookSetId as never, factsId);
        expect(true).toBe(false); // Should throw
      } catch (e) {
        expect((e as any).code).toBe("FACTS_NOT_FOUND");
      }
    } finally {
      new BunDatabase(f.dbPath).close();
    }
  });

  it("exports deterministic review-pack facts, tax components, and validation issues without portal JSON", async () => {
    const f = await fixture();
    try {
      const party = await f.app.party.create(f.env("export-party", "creator", { displayName: "Customer Export", partyRole: "CUSTOMER" }));
      const partyId = JSON.parse(party.resultJson).partyId as string;
      const profile = await f.app.gst.partyProfile.create(f.env("export-profile", "creator", { partyId, gstin: "27AAPFU0939F1ZV", treatment: "REGISTERED", stateCode: "27", effectiveFrom: "2024-01-01" }));
      const profileId = JSON.parse(profile.resultJson).profileId as string;
      const invoice = await f.app.invoice.create(f.env("export-invoice", "creator", {
        invoiceNumber: "INV-EXPORT",
        customerId: partyId,
        issueDate: "2024-08-15",
        lines: [{ description: "Taxed Service", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 100_000 }],
        gst: { sellerRegistrationId: f.gstReg.registrationId, buyerProfileId: profileId, localComponent: "SGST", cgstAccountId: f.tenant.seedAccountIds.liabilities, sgstAccountId: f.tenant.seedAccountIds.liabilities, lines: [{ lineNumber: 1, classification: "9983", rateBps: 1800, evidenceIds: ["evidence-1"] }] },
      }));
      const invoiceId = JSON.parse(invoice.resultJson).invoiceId as string;
      await f.app.invoice.post(f.env("export-post", "creator", { invoiceId, receivableAccountId: f.tenant.seedAccountIds.assets }));

      // Leave supplemental line facts absent so the frozen validation produces an issue row while source line and tax facts remain exportable.
      await f.app.gst.returnReadiness.outwardFacts.record(f.env("export-facts", "creator", { invoiceId, placeOfSupplyStateCode: "27", recipientRegistrationCategory: "REGISTERED" }));
      const prepared = await f.app.gst.returnReadiness.return.prepare(f.env("export-prepare", "creator", { registrationId: f.gstReg.registrationId, returnForm: "GSTR1", taxPeriodFrom: "2024-08-01", taxPeriodTo: "2024-08-31" }));
      const snapshotId = JSON.parse(prepared.resultJson).snapshotId as string;
      const validation = await f.app.gst.returnReadiness.return.validate(f.tenant.tenantId as never, f.tenant.defaultBookSetId as never, snapshotId, "export-reviewer");
      const exportEnvelope = f.env("export-pack", "export-reviewer", { validationId: "pending" });
      // The public export API takes the validation identity; obtain it from the immutable validation row without changing source facts.
      const db = new BunDatabase(f.dbPath, { readonly: true });
      const validationId = String((db.query("SELECT id FROM gst_return_validations WHERE snapshot_id = ? AND tenant_id = ? AND book_set_id = ?").get(snapshotId, f.tenant.tenantId, f.tenant.defaultBookSetId) as { id: string }).id);
      db.close();
      exportEnvelope.payload = { validationId };
      const first = await f.app.gst.returnReadiness.return.exportReviewPack(exportEnvelope);
      const second = await f.app.gst.returnReadiness.return.exportReviewPack(exportEnvelope);
      expect(first.resultHash).toBe(second.resultHash);

      const artifacts = new BunDatabase(f.dbPath, { readonly: true });
      const row = artifacts.query("SELECT portal_json_status, csv_documents_lines_json, csv_line_details_lines_json, csv_tax_component_lines_json, csv_validation_issues_lines_json, csv_documents_hash, csv_line_details_hash, csv_tax_component_hash, csv_validation_issues_hash FROM gst_return_exports WHERE validation_id = ?").get(validationId) as Record<string, string>;
      expect(row.portal_json_status).toBe("SCHEMA_UNPINNED");
      expect(JSON.stringify(row.csv_documents_lines_json)).toContain("INV-EXPORT");
      expect(JSON.stringify(row.csv_line_details_lines_json)).toContain("Taxed Service");
      expect(JSON.stringify(row.csv_tax_component_lines_json)).toMatch(/CGST|SGST/);
      expect(row.csv_validation_issues_lines_json).toContain("MISSING_LINE_FACTS");
      expect(row.csv_documents_hash).toHaveLength(64);
      expect(row.csv_line_details_hash).toHaveLength(64);
      expect(row.csv_tax_component_hash).toHaveLength(64);
      expect(row.csv_validation_issues_hash).toHaveLength(64);
      expect(validation.issueCount).toBeGreaterThan(0);
      artifacts.close();
    } finally {
      new BunDatabase(f.dbPath).close();
    }
  });

  it("enforces idempotency on duplicate requestId", async () => {
    const f = await fixture();
    try {
      const requestId = randomUUID();

      // Create and post invoice
      const party = await f.app.party.create(f.env("party", "creator", { displayName: "Customer I", partyRole: "CUSTOMER" }));
      const partyId = JSON.parse(party.resultJson).partyId as string;

      const invoice = await f.app.invoice.create(f.env("invoice", "creator", { invoiceNumber: "INV-009", customerId: partyId, issueDate: "2024-08-15", lines: [{ description: "Services", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 100_000 }] }));
      const invoiceId = JSON.parse(invoice.resultJson).invoiceId as string;
      await f.app.invoice.post(f.env("post-invoice", "creator", { invoiceId, receivableAccountId: f.tenant.seedAccountIds.assets }));

      // First record with specific requestId
      const result1 = await f.app.gst.returnReadiness.outwardFacts.record(command(f.tenant.tenantId, f.tenant.defaultBookSetId, requestId, "creator", { invoiceId, placeOfSupplyStateCode: "27" }));

      // Second record with same requestId should return same result
      const result2 = await f.app.gst.returnReadiness.outwardFacts.record(command(f.tenant.tenantId, f.tenant.defaultBookSetId, requestId, "creator", { invoiceId, placeOfSupplyStateCode: "27" }));

      expect(result1.resultHash).toBe(result2.resultHash);
    } finally {
      new BunDatabase(f.dbPath).close();
    }
  });

  it("rejects conflicting requestId with different payload", async () => {
    const f = await fixture();
    try {
      const requestId = randomUUID();

      // Create and post two invoices
      const party = await f.app.party.create(f.env("party", "creator", { displayName: "Customer J", partyRole: "CUSTOMER" }));
      const partyId = JSON.parse(party.resultJson).partyId as string;

      const invoice1 = await f.app.invoice.create(f.env("invoice1", "creator", { invoiceNumber: "INV-010", customerId: partyId, issueDate: "2024-08-15", lines: [{ description: "Services", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 100_000 }] }));
      const invoiceId1 = JSON.parse(invoice1.resultJson).invoiceId as string;
      await f.app.invoice.post(f.env("post-invoice1", "creator", { invoiceId: invoiceId1, receivableAccountId: f.tenant.seedAccountIds.assets }));

      const invoice2 = await f.app.invoice.create(f.env("invoice2", "creator", { invoiceNumber: "INV-011", customerId: partyId, issueDate: "2024-08-15", lines: [{ description: "Services", revenueAccountId: f.tenant.seedAccountIds.income, amountMinor: 200_000 }] }));
      const invoiceId2 = JSON.parse(invoice2.resultJson).invoiceId as string;
      await f.app.invoice.post(f.env("post-invoice2", "creator", { invoiceId: invoiceId2, receivableAccountId: f.tenant.seedAccountIds.assets }));

      // First record with requestId
      await f.app.gst.returnReadiness.outwardFacts.record(command(f.tenant.tenantId, f.tenant.defaultBookSetId, requestId, "creator", { invoiceId: invoiceId1, placeOfSupplyStateCode: "27" }));

      // Second record with same requestId but different payload should fail
      try {
        await f.app.gst.returnReadiness.outwardFacts.record(command(f.tenant.tenantId, f.tenant.defaultBookSetId, requestId, "creator", { invoiceId: invoiceId2, placeOfSupplyStateCode: "28" }));
        expect(true).toBe(false); // Should throw
      } catch (e) {
        expect((e as any).code).toBe("IDEMPOTENCY_CONFLICT");
      }
    } finally {
      new BunDatabase(f.dbPath).close();
    }
  });
});
