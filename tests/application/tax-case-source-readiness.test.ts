import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSqliteApplication, initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

function envelope(tenantId: string, requestId: string, payload: unknown, actor: "HUMAN" | "AGENT" = "HUMAN", source: "CLI" | "MCP" = "CLI") {
  return { schemaVersion: 1 as const, tenantId, requestId, actor: { kind: actor, id: `${actor.toLowerCase()}-readiness` }, source, reason: "source readiness test", payload } as never;
}

async function scope(app: ReturnType<typeof createSqliteApplication>, suffix: string) {
  const tenant = JSON.parse((await app.tenant.create(envelope(`tenant-${suffix}`, randomUUID(), { kind: "INDIVIDUAL", name: `Individual ${suffix}` }))).resultJson);
  await app.tenant.activate(envelope(tenant.tenantId, randomUUID(), { defaultBookSetId: tenant.defaultBookSetId }));
  await app.tenant.pan.set(envelope(tenant.tenantId, randomUUID(), { pan: `ABCDE${suffix.padStart(4, "0").slice(-4)}F` }));
  const taxCaseId = `case-${suffix}`;
  await app.taxCase.create(envelope(tenant.tenantId, randomUUID(), { taxCaseId, financialYear: "2025-26", taxPeriod: "2025-26", filingTrigger: "ANNUAL", bookSetIds: [tenant.defaultBookSetId] }));
  const source = JSON.parse((await app.taxCase.source.import(envelope(tenant.tenantId, randomUUID(), { taxCaseId, sourceKind: "AIS", sourcePeriod: "2025-26", mediaType: "text/plain", originalFilename: "ais.txt", contentBase64: Buffer.from(`AIS ${suffix}`).toString("base64") }))).resultJson);
  return { tenantId: tenant.tenantId, taxCaseId, sourceId: source.sourceId, artifactId: source.artifact.artifactId, contentHash: source.artifact.contentHash };
}

function factPayload(s: Awaited<ReturnType<typeof scope>>, key = "row-1") {
  return { taxCaseId: s.taxCaseId, sourceId: s.sourceId, artifactId: s.artifactId, sourceRecordKey: key, kind: "TDS_CREDIT", rawSourceLabel: "TDS", rawSourceLocator: "page=1,row=1", eventDate: "2025-06-30", originalCurrency: "INR", grossAmountMinor: 100, parserIdentity: "test", parserVersion: "1", normalizedPayload: { key } };
}

function assessmentPayload(s: Awaited<ReturnType<typeof scope>>, factIds: string[], outcomeCandidate: "FACTS_PRESENT" | "EMPTY" = "FACTS_PRESENT") {
  return { taxCaseId: s.taxCaseId, sourceId: s.sourceId, artifactId: s.artifactId, contentHash: s.contentHash, parserIdentity: "ais-reader", parserVersion: "1.2", modelDescriptor: "model:test-v1", extractionMode: "AGENT_ASSISTED", sourceKind: "AIS", sourcePeriod: "2025-26", factIds, recordCount: factIds.length, coverage: { recordCount: factIds.length, pageCount: 1 }, issues: [], warnings: [], outcomeCandidate };
}

describe("Personal Tax source readiness V1", () => {
  test("confirms FACTS_PRESENT only through HUMAN CAS and derives READY", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-readiness-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "readiness" }); const s = await scope(app, "3001");
      const fact = JSON.parse((await app.taxCase.fact.propose(envelope(s.tenantId, "fact-3001", factPayload(s), "AGENT"))).resultJson);
      await app.taxCase.fact.confirm(envelope(s.tenantId, "fact-confirm-3001", { taxCaseId: s.taxCaseId, factId: fact.factId, reason: "reviewed" }));
      const prepared = JSON.parse((await app.taxCase.source.assessment.prepare(envelope(s.tenantId, "assessment-prepare-3001", assessmentPayload(s, [fact.factId]), "AGENT"))).resultJson);
      expect(prepared.lifecycle).toBe("PREPARED"); expect(prepared.assessmentHash).toMatch(/^[0-9a-f]{64}$/); expect(JSON.stringify(prepared)).not.toContain("AIS 3001");
      await expect(app.taxCase.source.assessment.confirm(envelope(s.tenantId, "assessment-agent-confirm", { taxCaseId: s.taxCaseId, sourceId: s.sourceId, assessmentId: prepared.assessmentId, expectedAssessmentHash: prepared.assessmentHash, reason: "agent" }, "AGENT"))).rejects.toMatchObject({ code: "SOURCE_ASSESSMENT_HUMAN_REQUIRED" });
      const confirmed = JSON.parse((await app.taxCase.source.assessment.confirm(envelope(s.tenantId, "assessment-confirm-3001", { taxCaseId: s.taxCaseId, sourceId: s.sourceId, assessmentId: prepared.assessmentId, expectedAssessmentHash: prepared.assessmentHash, reason: "human reviewed" }))).resultJson);
      expect(confirmed.lifecycle).toBe("CONFIRMED"); expect((await app.taxCase.source.status(s.tenantId, s.taxCaseId, s.sourceId))).toMatchObject({ readinessStatus: "READY", status: "READY" });
      const replay = await app.taxCase.source.assessment.confirm(envelope(s.tenantId, "assessment-confirm-3001", { taxCaseId: s.taxCaseId, sourceId: s.sourceId, assessmentId: prepared.assessmentId, expectedAssessmentHash: prepared.assessmentHash, reason: "human reviewed" })); expect(replay.replayed).toBe(true);
      await expect(app.taxCase.source.assessment.confirm(envelope(s.tenantId, "assessment-cas-3001", { taxCaseId: s.taxCaseId, sourceId: s.sourceId, assessmentId: prepared.assessmentId, expectedAssessmentHash: "0".repeat(64), reason: "wrong" }))).rejects.toMatchObject({ code: "SOURCE_ASSESSMENT_CAS_FAILED" });
      const native = new Database(dbPath, { readonly: true, safeIntegers: true }); expect(native.query("SELECT COUNT(*) AS count FROM tax_case_source_assessment_events WHERE tenant_id = ?").get(s.tenantId)).toEqual({ count: 2n }); native.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("supports human-confirmed EMPTY and blocks stale fact bindings", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-empty-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "empty" }); const s = await scope(app, "3002");
      const prepared = JSON.parse((await app.taxCase.source.assessment.prepare(envelope(s.tenantId, "empty-prepare", { ...assessmentPayload(s, [], "EMPTY"), recordCount: 0, coverage: { recordCount: 0, pageCount: 1 }, issues: ["no records"], warnings: [] }, "AGENT"))).resultJson);
      await app.taxCase.source.assessment.confirm(envelope(s.tenantId, "empty-confirm", { taxCaseId: s.taxCaseId, sourceId: s.sourceId, assessmentId: prepared.assessmentId, expectedAssessmentHash: prepared.assessmentHash, reason: "human verified no reportable rows" }));
      expect((await app.taxCase.source.status(s.tenantId, s.taxCaseId, s.sourceId)).readinessStatus).toBe("READY");
      const fact = JSON.parse((await app.taxCase.fact.propose(envelope(s.tenantId, "fact-after-empty", factPayload(s), "AGENT"))).resultJson);
      expect((await app.taxCase.source.status(s.tenantId, s.taxCaseId, s.sourceId)).readinessStatus).toBe("STALE");
      await app.taxCase.fact.reject(envelope(s.tenantId, "reject-after-empty", { taxCaseId: s.taxCaseId, factId: fact.factId, reason: "not a source record" }));
      const reassessment = JSON.parse((await app.taxCase.source.assessment.prepare(envelope(s.tenantId, "reassess", assessmentPayload(s, [fact.factId]), "AGENT"))).resultJson);
      await app.taxCase.source.assessment.confirm(envelope(s.tenantId, "reassess-confirm", { taxCaseId: s.taxCaseId, sourceId: s.sourceId, assessmentId: reassessment.assessmentId, expectedAssessmentHash: reassessment.assessmentHash, reason: "human reviewed" }));
      expect((await app.taxCase.source.status(s.tenantId, s.taxCaseId, s.sourceId)).readinessStatus).toBe("READY");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("uses one CLI/MCP dispatcher and preserves tenant isolation", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-dispatch-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "dispatch" }); const s = await scope(app, "3003"); const other = await scope(app, "3004");
      const payload = assessmentPayload(s, [], "EMPTY"); const cli = await new OperationDispatcher({ databasePath: dbPath, source: "CLI", allowOperatorOperations: false }).dispatch("tax-case.source-assessment.prepare", envelope(s.tenantId, "dispatch-prepare", payload, "AGENT")); const mcp = await new OperationDispatcher({ databasePath: dbPath, source: "MCP", allowOperatorOperations: false }).dispatch("tax-case.source.status", { tenantId: s.tenantId, taxCaseId: s.taxCaseId, sourceId: s.sourceId });
      expect(cli.ok).toBe(true); expect(mcp.ok).toBe(true); await expect(app.taxCase.source.assessment.show(other.tenantId, other.taxCaseId, s.sourceId, "missing")).rejects.toMatchObject({ code: "SOURCE_ASSESSMENT_NOT_FOUND" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("allows FilingSnapshot seal only while the latest source assessment is READY", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-source-snapshot-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "snapshot" }); const s = await scope(app, "3005");
      const prepared = JSON.parse((await app.taxCase.source.assessment.prepare(envelope(s.tenantId, "snapshot-assessment", assessmentPayload(s, [], "EMPTY"), "AGENT"))).resultJson);
      await app.taxCase.source.assessment.confirm(envelope(s.tenantId, "snapshot-assessment-confirm", { taxCaseId: s.taxCaseId, sourceId: s.sourceId, assessmentId: prepared.assessmentId, expectedAssessmentHash: prepared.assessmentHash, reason: "human reviewed empty source" }));
      const preview = await app.taxCase.filingSnapshot.preview(s.tenantId, s.taxCaseId); expect(preview.blockers).toEqual([]);
      const sealed = JSON.parse((await app.taxCase.filingSnapshot.seal(envelope(s.tenantId, "snapshot-seal-ready", { taxCaseId: s.taxCaseId, candidateHash: preview.candidateHash }))).resultJson);
      const reassessment = JSON.parse((await app.taxCase.source.assessment.prepare(envelope(s.tenantId, "snapshot-reassessment", { ...assessmentPayload(s, [], "EMPTY"), parserVersion: "1.3", supersedesAssessmentId: prepared.assessmentId }, "AGENT"))).resultJson);
      expect(reassessment.assessmentId).not.toBe(prepared.assessmentId); expect((await app.taxCase.filingSnapshot.status(s.tenantId, s.taxCaseId, sealed.snapshotId))).toMatchObject({ status: "STALE" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
