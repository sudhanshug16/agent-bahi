import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { initializeSqliteDatabase, createSqliteApplication } from "../../src/application/application.ts";
import { canonicalJson } from "../../src/application/commands.ts";

const refs = [
  { kind: "SCHEMA", sourceUrl: "https://example.test/tds-schema", sourceTitle: "TEST_ONLY schema", officialReleaseIdentifier: "TEST_ONLY", officialReleaseDate: "2026-01-01", sha256: "a".repeat(64) },
  { kind: "INSTRUCTION", sourceUrl: "https://example.test/tds-instructions", sourceTitle: "TEST_ONLY instructions", officialReleaseIdentifier: "TEST_ONLY", officialReleaseDate: "2026-01-01", sha256: "b".repeat(64) },
] as const;

function envelope(tenantId: string, payload: unknown, actor: "AGENT" | "HUMAN" = "AGENT") {
  return { schemaVersion: 1 as const, tenantId: tenantId as never, requestId: crypto.randomUUID(), actor: { kind: actor, id: actor.toLowerCase() }, source: "INTERNAL", reason: "TEST_ONLY withholding statement artifact", payload } as never;
}

describe("withholding statement artifact V1", () => {
  it("keeps packs and supplemental facts human-gated and previews a deterministic nil statement", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-withholding-statement-"));
    const dbPath = join(directory, "books.sqlite");
    try {
      await initializeSqliteDatabase(dbPath);
      const app = createSqliteApplication(dbPath);
      const tenant = await app.tenant.create({ schemaVersion: 1, tenantId: "ignored" as never, requestId: crypto.randomUUID(), actor: { kind: "HUMAN", id: "owner" }, source: "INTERNAL", reason: "create TEST_ONLY tenant", payload: { kind: "COMPANY", name: "TDS statement test" } });
      const tenantId = JSON.parse(tenant.resultJson).tenantId as string;
      const bookSetId = JSON.parse(tenant.resultJson).defaultBookSetId as string;
      const profile = await app.tax.deductorProfile.create(envelope(tenantId, { pan: "ABCDE1234F", tan: "ABCD12345E", verificationStatus: "VERIFIED", evidenceReference: "TEST_ONLY:evidence", effectiveFrom: "2026-04-01" }));
      const profileId = JSON.parse(profile.resultJson).profileId as string;
      const pack = await app.withholdingStatement.schemaPack.register(envelope(tenantId, {
        jurisdiction: "IN", form: "26Q", financialYear: "2026-27", quarter: "Q1", filingType: "ORIGINAL", authorityRuleSnapshotReference: "TEST_ONLY:human-rule-snapshot", artifactReferences: refs,
        packVersion: "test-v1", validationSchema: { type: "object", properties: { form: { type: "string" }, nilStatement: { type: "boolean" } }, required: ["form", "nilStatement"], additionalProperties: false },
        mappingSpec: { type: "object", properties: { form: { type: "pointer", pointer: "/statement/form" }, nilStatement: { type: "pointer", pointer: "/statement/nilStatement" } } },
      }));
      const packId = JSON.parse(pack.resultJson).packId as string;
      const packHash = JSON.parse(pack.resultJson).canonicalHash as string;
      await expect(app.withholdingStatement.schemaPack.verify(envelope(tenantId, { packId, expectedPackHash: packHash, reason: "human verified TEST_ONLY pack" }, "AGENT"))).rejects.toMatchObject({ code: "WITHHOLDING_STATEMENT_SCHEMA_HUMAN_REQUIRED" });
      await app.withholdingStatement.schemaPack.verify(envelope(tenantId, { packId, expectedPackHash: packHash, reason: "human verified TEST_ONLY pack" }, "HUMAN"));
      const fact = await app.withholdingStatement.fact.propose(envelope(tenantId, { bookSetId, deductorProfileId: profileId, financialYear: "2026-27", quarter: "Q1", factType: "NIL_STATEMENT", nilStatementAssertion: true }, "AGENT"));
      const factView = JSON.parse(fact.resultJson);
      await app.withholdingStatement.fact.confirm(envelope(tenantId, { bookSetId, factId: factView.factId, expectedFactHash: factView.canonicalHash, reason: "human confirmed nil assertion" }, "HUMAN"));
      const preview = await app.withholdingStatement.statement.preview(tenantId as never, { bookSetId, deductorProfileId: profileId, form: "26Q", financialYear: "2026-27", quarter: "Q1", filingType: "ORIGINAL", schemaPackId: packId });
      expect(preview.status).toBe("PREVIEW");
      expect(preview.blockerCodes).toEqual([]);
      expect(preview.contentHash).toMatch(/^[0-9a-f]{64}$/);
      const prepared = await app.withholdingStatement.statement.prepare(envelope(tenantId, { bookSetId, deductorProfileId: profileId, form: "26Q", financialYear: "2026-27", quarter: "Q1", filingType: "ORIGINAL", schemaPackId: packId }));
      const artifact = JSON.parse(prepared.resultJson);
      expect(artifact.status).toBe("PREPARED");
      expect(artifact.bindings.tan).toBeUndefined();
      expect(canonicalJson(artifact.bindings)).not.toContain("ABCD12345E");
      expect(preview.content).toBeUndefined();
      const validation = await app.withholdingStatement.statement.validate(envelope(tenantId, { bookSetId, artifactId: artifact.artifactId, expectedArtifactHash: artifact.contentHash }));
      const validationView = JSON.parse(validation.resultJson);
      expect(validationView.status).toBe("LOCAL_VALID");
      await expect(app.withholdingStatement.statement.export(envelope(tenantId, { bookSetId, artifactId: artifact.artifactId, expectedArtifactHash: artifact.contentHash, expectedValidationHash: validationView.validationHash }))).rejects.toMatchObject({ code: "WITHHOLDING_STATEMENT_EXPORT_HUMAN_REQUIRED" });
      const exported = await app.withholdingStatement.statement.export(envelope(tenantId, { bookSetId, artifactId: artifact.artifactId, expectedArtifactHash: artifact.contentHash, expectedValidationHash: validationView.validationHash }, "HUMAN"));
      expect(JSON.parse(exported.resultJson)).toMatchObject({ status: "EXPORTED", submitted: false, accepted: false });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
