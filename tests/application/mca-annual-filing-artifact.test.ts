import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSqliteApplication, initializeSqliteDatabase } from "../../src/application/application.ts";

const refs = ["LAW", "RULES", "SCHEMA", "INSTRUCTION"].map((kind) => ({ kind, sourceUrl: "https://example.invalid/mca-test-only", sourceTitle: "MCA TEST_ONLY", officialReleaseIdentifier: "TEST_ONLY", officialReleaseDate: "2026-04-01", sha256: "a".repeat(64) }));
function envelope(tenantId: string, requestId: string, payload: unknown, actor: "AGENT" | "HUMAN" = "AGENT", bookSetId?: string) { return { schemaVersion: 1 as const, tenantId: tenantId as never, ...(bookSetId ? { bookSetId: bookSetId as never } : {}), requestId, actor: { kind: actor, id: actor.toLowerCase() }, source: "INTERNAL" as const, reason: "TEST_ONLY MCA annual filing", payload } as never; }

describe("MCA private-company annual filing preparation V1", () => {
  it("keeps form packs and facts human-gated and returns tri-state applicability with close blockers", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-mca-artifact-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      await initializeSqliteDatabase(dbPath);
      const app = createSqliteApplication(dbPath);
      const tenant = JSON.parse((await app.tenant.create(envelope("ignored", "mca-tenant", { kind: "COMPANY", name: "MCA Test Company" }))).resultJson);
      await app.tenant.activate(envelope(tenant.tenantId, "mca-activate", { defaultBookSetId: tenant.defaultBookSetId }));
      const identityId = "mca-company-identity";
      const native = new Database(dbPath);
      native.query("INSERT INTO legal_identities (id, identity_type, fingerprint, last_four, redacted_display, created_at, updated_at) VALUES (?, 'COMPANY_CIN', ?, ?, ?, ?, ?)").run(identityId, "test-cin-fingerprint", "1234", "************1234", "2026-04-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
      native.close();

      const registered = JSON.parse((await app.mca.formPack.register(envelope(tenant.tenantId, "mca-pack-register", {
        jurisdiction: "IN", authority: "MCA", formFamily: "MGT-7", filingType: "ANNUAL", financialYear: "2025-26", effectiveFrom: "2026-04-01", releasedAt: "2026-04-01", lawReference: "TEST_ONLY:Companies Act", ruleReference: "TEST_ONLY:rules", instructionReference: "TEST_ONLY:instructions", schemaReference: "TEST_ONLY:schema", artifactReferences: refs, packVersion: "TEST_ONLY-1", requiredFactDeclarations: ["companyClass"], applicabilityRuleAst: { all: [{ op: "EQ", key: "companyClass", value: "PRIVATE" }] }, validationSchema: { type: "object", properties: {}, additionalProperties: false }, mappingSpec: { type: "object", properties: { model: { type: "pointer", pointer: "/mca/model" } } }, testOnly: true,
      }))).resultJson);
      expect(registered.lifecycle).toBe("REGISTERED");
      await expect(app.mca.formPack.verify(envelope(tenant.tenantId, "mca-pack-agent-verify", { packId: registered.packId, expectedPackHash: registered.canonicalHash, reason: "agent cannot verify" }))).rejects.toMatchObject({ code: "MCA_HUMAN_REQUIRED" });
      await app.mca.formPack.verify(envelope(tenant.tenantId, "mca-pack-human-verify", { packId: registered.packId, expectedPackHash: registered.canonicalHash, reason: "human verified TEST_ONLY pack" }, "HUMAN"));

      const fact = JSON.parse((await app.mca.fact.propose(envelope(tenant.tenantId, "mca-fact-propose", { bookSetId: tenant.defaultBookSetId, legalIdentityId: identityId, financialYear: "2025-26", factType: "COMPANY_PROFILE", effectiveFrom: "2025-04-01", facts: { companyClass: "PRIVATE" }, provenance: { source: "TEST_ONLY" }, evidenceIds: ["evidence-company-profile"] }, "AGENT", tenant.defaultBookSetId))).resultJson);
      expect(fact.lifecycle).toBe("PROPOSED");
      await app.mca.fact.confirm(envelope(tenant.tenantId, "mca-fact-confirm", { bookSetId: tenant.defaultBookSetId, factId: fact.factId, expectedFactHash: fact.canonicalHash, reason: "human confirmed TEST_ONLY fact" }, "HUMAN", tenant.defaultBookSetId));

      const preview = await app.mca.annual.preview(tenant.tenantId, { bookSetId: tenant.defaultBookSetId, financialYear: "2025-26", formPackId: registered.packId, legalIdentityId: identityId, periodStart: "2025-04-01", periodEnd: "2026-03-31", closePackManifestId: "missing-close-pack", closePackManifestHash: "b".repeat(64) });
      expect(preview.applicability).toMatchObject({ decision: "APPLICABLE", missing: [] });
      expect(preview.blockerCodes).toEqual(expect.arrayContaining(["CA_CLOSE_PACK_REQUIRED", "BOOKS_OPEN"]));
      expect(JSON.stringify(preview)).not.toContain("test-cin-fingerprint");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
