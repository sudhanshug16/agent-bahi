import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";

function envelope(tenantId: string, bookSetId: string, requestId: string, payload: unknown, actor: "HUMAN" | "AGENT" = "AGENT"): any {
  return { schemaVersion: 1, tenantId, bookSetId, requestId, actor: { kind: actor, id: `${actor.toLowerCase()}-gstr1-test` }, source: "CLI", reason: "TEST_ONLY GSTR-1 artifact", payload };
}

const references = ["SCHEMA", "INSTRUCTION"].map((kind) => ({ kind, sourceUrl: "https://example.invalid/test-only-gstr1", sourceTitle: "TEST_ONLY GSTR1", officialReleaseIdentifier: "TEST_ONLY", officialReleaseDate: "2024-04-01", sha256: "b".repeat(64) }));

describe("GST GSTR-1 Return Artifact V1", () => {
  test("binds one READY snapshot, maps deterministically, validates, exports, masks, and protects rows", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-gstr1-artifact-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
      const tenant = JSON.parse((await app.tenant.create({ schemaVersion: 1, tenantId: "tenant-gstr1" as never, requestId: "tenant", actor: { kind: "HUMAN", id: "creator" }, source: "CLI", reason: "TEST_ONLY", payload: { kind: "COMPANY", name: "TEST_ONLY GST" } })).resultJson);
      const registration = JSON.parse((await app.gst.registration.create({ schemaVersion: 1, tenantId: tenant.tenantId as never, requestId: "registration", actor: { kind: "HUMAN", id: "creator" }, source: "CLI", reason: "TEST_ONLY", payload: { gstin: "27AAPFU0939F1ZV", state: "27", status: "ACTIVE", effectiveFrom: "2024-01-01" } })).resultJson);
      const party = JSON.parse((await app.party.create(envelope(tenant.tenantId, tenant.defaultBookSetId, "party", { displayName: "TEST_ONLY Customer", partyRole: "CUSTOMER" }, "HUMAN"))).resultJson);
      await app.gst.partyProfile.create(envelope(tenant.tenantId, tenant.defaultBookSetId, "party-profile", { partyId: party.partyId, gstin: "27AAPFU0939F1ZV", treatment: "REGISTERED", stateCode: "27", effectiveFrom: "2024-01-01" }, "HUMAN"));
      const invoice = JSON.parse((await app.invoice.create(envelope(tenant.tenantId, tenant.defaultBookSetId, "invoice", { invoiceNumber: "GSTR1-001", customerId: party.partyId, issueDate: "2024-08-15", lines: [{ description: "TEST_ONLY services", revenueAccountId: tenant.seedAccountIds.income, amountMinor: 100000 }] }, "HUMAN"))).resultJson);
      await app.invoice.post(envelope(tenant.tenantId, tenant.defaultBookSetId, "invoice-post", { invoiceId: invoice.invoiceId, receivableAccountId: tenant.seedAccountIds.assets }, "HUMAN"));
      const nativeBeforeFacts = new Database(dbPath, { safeIntegers: true });
      const invoiceLineId = String((nativeBeforeFacts.query("SELECT id FROM sales_invoice_lines WHERE invoice_id = ? ORDER BY line_number").get(invoice.invoiceId) as { id: string }).id);
      nativeBeforeFacts.close();
      const outward = JSON.parse((await app.gst.returnReadiness.outwardFacts.record(envelope(tenant.tenantId, tenant.defaultBookSetId, "outward", { invoiceId: invoice.invoiceId, placeOfSupplyStateCode: "27", recipientRegistrationCategory: "REGISTERED", lineItems: [{ invoiceLineId, classification: "SERVICES", hsnSacCode: "998314" }] }, "HUMAN"))).resultJson);
      expect(outward.invoiceId).toBe(invoice.invoiceId);
      const readiness = JSON.parse((await app.gst.returnReadiness.return.prepare(envelope(tenant.tenantId, tenant.defaultBookSetId, "readiness-prepare", { registrationId: registration.registrationId, returnForm: "GSTR1", taxPeriodFrom: "2024-08-01", taxPeriodTo: "2024-08-31" }, "HUMAN"))).resultJson);
      const readinessValidation = await app.gst.returnReadiness.return.validate(tenant.tenantId, tenant.defaultBookSetId, readiness.snapshotId, "reviewer");
      expect(readinessValidation.readinessStatus).toBe("READY");
      const schema = { type: "object", properties: { gstin: { type: "string" }, taxableMinor: { type: "integer", integerEncoding: "DECIMAL_STRING" }, sectionInventory: { type: "array", items: { type: "string" } } }, required: ["gstin", "taxableMinor", "sectionInventory"], additionalProperties: false };
      const mapping = { type: "object", properties: { gstin: { type: "pointer", pointer: "/gstr1/gstin" }, taxableMinor: { type: "pointer", pointer: "/gstr1/totals/taxableMinor" }, sectionInventory: { type: "constant", value: ["B2B", "B2CL", "B2CS", "EXPORTS", "CREDIT_DEBIT_NOTES", "ADVANCES_ADJUSTMENTS", "NIL_EXEMPT_NON_GST", "HSN_SUMMARY", "DOCUMENTS_ISSUED", "E_COMMERCE"] } } };
      const pack = JSON.parse((await app.gst.gstr1Artifact.schemaPack.register({ ...envelope(tenant.tenantId, tenant.defaultBookSetId, "pack-register", { jurisdiction: "IN", returnType: "GSTR1", applicableFrom: "2024-04-01", readinessContractVersion: "GST_RETURN_READINESS_V1", artifactReferences: references, packVersion: "TEST_ONLY-1", validationSchema: schema, mappingSpec: mapping }, "AGENT"), bookSetId: undefined })).resultJson);
      expect(pack.lifecycle).toBe("REGISTERED");
      await app.gst.gstr1Artifact.schemaPack.verify({ ...envelope(tenant.tenantId, tenant.defaultBookSetId, "pack-verify", { packId: pack.packId, expectedPackHash: pack.canonicalHash, reason: "TEST_ONLY verification" }, "HUMAN"), bookSetId: undefined });
      const binding = { registrationId: registration.registrationId, taxPeriodFrom: "2024-08-01", taxPeriodTo: "2024-08-31", readinessSnapshotId: readiness.snapshotId, schemaPackId: pack.packId };
      const preview = await app.gst.gstr1Artifact.artifact.preview(tenant.tenantId, tenant.defaultBookSetId, binding);
      expect(preview.content).toEqual({ gstin: "27AAPFU0939F1ZV", sectionInventory: ["B2B", "B2CL", "B2CS", "EXPORTS", "CREDIT_DEBIT_NOTES", "ADVANCES_ADJUSTMENTS", "NIL_EXEMPT_NON_GST", "HSN_SUMMARY", "DOCUMENTS_ISSUED", "E_COMMERCE"], taxableMinor: "100000" });
      const prepared = JSON.parse((await app.gst.gstr1Artifact.artifact.prepare(envelope(tenant.tenantId, tenant.defaultBookSetId, "artifact-prepare", binding))).resultJson);
      const replay = await app.gst.gstr1Artifact.artifact.prepare(envelope(tenant.tenantId, tenant.defaultBookSetId, "artifact-prepare", binding));
      expect(replay.replayed).toBe(true);
      const valid = JSON.parse((await app.gst.gstr1Artifact.artifact.validate(envelope(tenant.tenantId, tenant.defaultBookSetId, "artifact-validate", { artifactId: prepared.artifactId, expectedArtifactHash: prepared.contentHash }))).resultJson);
      expect(valid.status).toBe("LOCAL_VALID");
      const metadata = await app.gst.gstr1Artifact.artifact.content(tenant.tenantId, tenant.defaultBookSetId, prepared.artifactId);
      expect(metadata.revealed).toBe(false);
      expect(JSON.stringify(metadata)).not.toContain("27AAPFU0939F1ZV");
      expect((metadata.bindings as { gstin: string }).gstin).toBe("27*********F1ZV");
      await expect(app.gst.gstr1Artifact.artifact.content(tenant.tenantId, tenant.defaultBookSetId, prepared.artifactId, true, "AGENT")).rejects.toMatchObject({ code: "GSTR1_SENSITIVE_HUMAN_REQUIRED" });
      expect((await app.gst.gstr1Artifact.artifact.content(tenant.tenantId, tenant.defaultBookSetId, prepared.artifactId, true, "HUMAN")).content).toEqual(preview.content);
      const exported = JSON.parse((await app.gst.gstr1Artifact.artifact.export(envelope(tenant.tenantId, tenant.defaultBookSetId, "artifact-export", { artifactId: prepared.artifactId, expectedArtifactHash: prepared.contentHash, expectedValidationHash: valid.validationHash }, "HUMAN"))).resultJson);
      expect(exported).toMatchObject({ status: "EXPORTED", submitted: false, accepted: false });
      const native = new Database(dbPath, { safeIntegers: true });
      expect(() => native.query("UPDATE gst_gstr1_artifacts SET content_json = '{}' WHERE id = ?").run(prepared.artifactId)).toThrow();
      expect(native.query("SELECT COUNT(*) AS count FROM gst_gstr1_export_activities WHERE artifact_id = ?").get(prepared.artifactId)).toEqual({ count: 1n });
      native.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
