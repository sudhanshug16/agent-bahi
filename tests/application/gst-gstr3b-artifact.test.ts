import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { initializeSqliteDatabase, createSqliteApplication } from "../../src/application/application.ts";

const refs = (["SCHEMA", "INSTRUCTION"] as const).map((kind) => ({ kind, sourceUrl: "https://example.invalid/test-only-gstr3b", sourceTitle: "TEST_ONLY GSTR-3B", officialReleaseIdentifier: "TEST_ONLY", officialReleaseDate: "2026-01-01", sha256: "c".repeat(64) }));
const laneIds = ["OUTWARD_TAXABLE_SUPPLIES", "ZERO_RATED_NIL_EXEMPT_NON_GST", "INWARD_REVERSE_CHARGE", "INTERSTATE_UNREGISTERED_COMPOSITION_UIN", "ELIGIBLE_ITC", "ITC_REVERSALS_INELIGIBLE", "INWARD_EXEMPT_NIL_NON_GST", "INTEREST_LATE_FEE", "CASH_LEDGER_OFFSET", "CREDIT_LEDGER_OFFSET", "TAX_DEPOSITS"];
function envelope<T>(tenantId: string, bookSetId: string, requestId: string, payload: T, actor: "AGENT" | "HUMAN" = "AGENT") { return { schemaVersion: 1 as const, tenantId: tenantId as never, bookSetId: bookSetId as never, requestId, actor: { kind: actor, id: actor.toLowerCase() }, source: "INTERNAL" as const, reason: "TEST_ONLY GSTR-3B", payload }; }

describe("GST GSTR-3B Reconciliation + Return Artifact V1", () => {
  it("keeps packs/facts human-gated and reports complete read-only blockers", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-gstr3b-artifact-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      await initializeSqliteDatabase(dbPath);
      const app = createSqliteApplication(dbPath);
      const tenant = JSON.parse((await app.tenant.create({ schemaVersion: 1, tenantId: "ignored" as never, requestId: "tenant-gstr3b", actor: { kind: "HUMAN", id: "owner" }, source: "INTERNAL", reason: "TEST_ONLY", payload: { kind: "COMPANY", name: "GSTR3B test" } })).resultJson);
      const registration = JSON.parse((await app.gst.registration.create({ schemaVersion: 1, tenantId: tenant.tenantId as never, requestId: "registration-gstr3b", actor: { kind: "HUMAN", id: "owner" }, source: "INTERNAL", reason: "TEST_ONLY", payload: { gstin: "27AAPFU0939F1ZV", state: "27", status: "ACTIVE", effectiveFrom: "2024-01-01" } })).resultJson);
      const lanes = laneIds.map((laneId) => ({ laneId, version: "TEST_ONLY-1", label: laneId, officialField: `TEST_ONLY.${laneId}` }));
      const packResult = await app.gst.gstr3bArtifact.schemaPack.register(envelope(tenant.tenantId, tenant.defaultBookSetId, "pack-gstr3b", { jurisdiction: "IN", returnType: "GSTR3B", filingFrequency: "MONTHLY", applicableFrom: "2024-01-01", readinessContractVersion: "GST_RETURN_READINESS_V1", ruleSnapshotReference: "TEST_ONLY:GST_RULES", artifactReferences: refs, packVersion: "TEST_ONLY-1", laneSpec: lanes, validationSchema: { type: "object", properties: { laneInventory: { type: "array", items: { type: "object", properties: {}, additionalProperties: false } } }, required: ["laneInventory"], additionalProperties: false }, mappingSpec: { type: "object", properties: { laneInventory: { type: "pointer", pointer: "/gstr3b/laneInventory" } } } }));
      const pack = JSON.parse(packResult.resultJson);
      expect(pack.lifecycle).toBe("REGISTERED");
      await expect(app.gst.gstr3bArtifact.schemaPack.verify(envelope(tenant.tenantId, tenant.defaultBookSetId, "pack-gstr3b-agent-verify", { packId: pack.packId, expectedPackHash: pack.canonicalHash, reason: "TEST_ONLY" }))).rejects.toMatchObject({ code: "GSTR3B_SCHEMA_HUMAN_REQUIRED" });
      await app.gst.gstr3bArtifact.schemaPack.verify(envelope(tenant.tenantId, tenant.defaultBookSetId, "pack-gstr3b-human-verify", { packId: pack.packId, expectedPackHash: pack.canonicalHash, reason: "TEST_ONLY" }, "HUMAN"));
      const factResult = await app.gst.gstr3bArtifact.fact.propose(envelope(tenant.tenantId, tenant.defaultBookSetId, "fact-gstr3b", { gstin: "27AAPFU0939F1ZV", taxPeriodFrom: "2024-08-01", taxPeriodTo: "2024-08-31", factType: "PORTAL_GSTR1_LIABILITY", facts: { lanes: [{ laneId: "OUTWARD_TAXABLE_SUPPLIES", component: "CGST", rateBps: "900", amountMinor: "0" }] }, provenance: { source: "TEST_ONLY", sourceHash: "fixture" } }));
      const fact = JSON.parse(factResult.resultJson);
      expect(fact.lifecycle).toBe("PROPOSED");
      await app.gst.gstr3bArtifact.fact.confirm(envelope(tenant.tenantId, tenant.defaultBookSetId, "fact-gstr3b-confirm", { bookSetId: tenant.defaultBookSetId, factId: fact.factId, expectedFactHash: fact.canonicalHash, reason: "TEST_ONLY human confirmation" }, "HUMAN"));
      const listed = await app.gst.gstr3bArtifact.fact.list(tenant.tenantId, tenant.defaultBookSetId);
      expect(listed[0]?.gstin).toBe("27*********F1ZV");
      const preview = await app.gst.gstr3bArtifact.artifact.preview(tenant.tenantId, { bookSetId: tenant.defaultBookSetId, gstin: "27AAPFU0939F1ZV", taxPeriodFrom: "2024-08-01", taxPeriodTo: "2024-08-31", schemaPackId: pack.packId });
      expect(preview.blockerCodes).toContain("GSTR1_ARTIFACT_REQUIRED");
      expect((preview.blockerCodes as string[]).some((code) => code.startsWith("PORTAL_FACT_MISSING:"))).toBe(true);
      expect(JSON.stringify(preview)).not.toContain("27AAPFU0939F1ZV");
      await expect(app.gst.gstr3bArtifact.artifact.prepare(envelope(tenant.tenantId, tenant.defaultBookSetId, "prepare-gstr3b", { bookSetId: tenant.defaultBookSetId, gstin: "27AAPFU0939F1ZV", taxPeriodFrom: "2024-08-01", taxPeriodTo: "2024-08-31", schemaPackId: pack.packId }))).rejects.toMatchObject({ code: "GSTR3B_PREPARE_BLOCKED" });
      expect(registration.registrationId).toBeTruthy();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
