import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import type { PublicApplicationFacade } from "../../src/application/public-facade.ts";
import { brandBookSetId, brandTenantId, type BookSetId, type TenantId } from "../../src/core/types.ts";

describe("Compliance Obligations & Calendar V1", () => {
  let directory: string;
  let app: PublicApplicationFacade;
  let dbPath: string;
  let tenantId: TenantId;
  let bookSetId: BookSetId;

  const envelope = (payload: Record<string, unknown>, requestId: string, tenant = tenantId) => ({ schemaVersion: 1 as const, tenantId: tenant, bookSetId, requestId, actor: { kind: "HUMAN" as const, id: "compliance-test" }, source: "CLI" as const, reason: "fictional compliance test", payload: { bookSetId, ...payload } }) as any;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "agent-bahi-compliance-"));
    dbPath = join(directory, "books.sqlite");
    app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "compliance" });
    const created = await app.tenant.create({ schemaVersion: 1, tenantId: "ignored" as any, requestId: "tenant", actor: { kind: "HUMAN", id: "test" }, source: "CLI", reason: "test", payload: { kind: "COMPANY", name: "Fictional Compliance Co" } });
    const tenant = JSON.parse(created.resultJson) as { tenantId: string; defaultBookSetId: string };
    tenantId = brandTenantId(tenant.tenantId);
    bookSetId = brandBookSetId(tenant.defaultBookSetId);
    await app.tenant.activate({ schemaVersion: 1, tenantId, requestId: "activate", actor: { kind: "HUMAN", id: "test" }, source: "CLI", reason: "test", payload: { defaultBookSetId: bookSetId } });
  });

  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  test("evaluates fictional snapshots, generates idempotent obligations, and derives lifecycle status from events", async () => {
    const facts = await app.compliance.factProfile.create(envelope({ effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", facts: { eligible: true }, sourceUrl: "https://fictional.example/facts", evidenceReference: "facts-evidence", verificationStatus: "VERIFIED" }, "facts"));
    const factProfileId = (JSON.parse(facts.resultJson) as { factProfileId: string }).factProfileId;
    const rule = await app.compliance.rule.create(envelope({ code: "FICTIONAL-RULE", version: "1", jurisdiction: "fictional", authority: "fictional-authority", formLabel: "fictional-form", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", officialSourceUrl: "https://fictional.example/rule", lawReference: "fictional-law", sourceVersion: "fictional-v1", sourceHash: "a".repeat(64), evidenceReference: "rule-evidence", verificationStatus: "VERIFIED", requiredFactKeys: ["eligible"], applicabilityPredicate: { all: [{ key: "eligible", op: "EQ", value: true }] } }, "rule"));
    const ruleId = (JSON.parse(rule.resultJson) as { ruleId: string }).ruleId;
    await app.compliance.deadline.create(envelope({ ruleId, periodStart: "2026-01-01", periodEnd: "2026-03-31", dueDate: "2026-04-15", sourceUrl: "https://fictional.example/deadline", evidenceReference: "deadline-evidence", sourceHash: "b".repeat(64) }, "deadline"));
    const decision = await app.compliance.applicability.evaluate(envelope({ ruleId, factProfileId }, "evaluate"));
    expect(JSON.parse(decision.resultJson).decision).toBe("APPLIES");
    const generated = await app.compliance.obligation.generate(envelope({ ruleId, periodStart: "2026-01-01", periodEnd: "2026-03-31", factProfileId }, "generate"));
    const generatedAgain = await app.compliance.obligation.generate(envelope({ ruleId, periodStart: "2026-01-01", periodEnd: "2026-03-31", factProfileId }, "generate"));
    expect(generatedAgain.resultJson).toBe(generated.resultJson);
    const obligationId = (JSON.parse(generated.resultJson) as { obligationId: string }).obligationId;
    const artifact = await app.compliance.artifact.attach(envelope({ obligationId, artifactKind: "FICTIONAL_REVIEW_PACK", artifactHash: "c".repeat(64), artifactReference: "fictional://review-pack" }, "artifact"));
    const artifactId = (JSON.parse(artifact.resultJson) as { artifactId: string }).artifactId;
    await app.compliance.obligation.event(envelope({ obligationId, eventType: "READY" }, "ready"));
    await app.compliance.obligation.event(envelope({ obligationId, eventType: "EXPORTED", artifactId }, "export"));
    await app.compliance.obligation.event(envelope({ obligationId, eventType: "USER_MARKED_SUBMITTED", evidenceReference: "submission-evidence" }, "submit"));
    await app.compliance.obligation.event(envelope({ obligationId, eventType: "ACKNOWLEDGED", evidenceReference: "ack-evidence" }, "ack"));
    await app.compliance.obligation.event(envelope({ obligationId, eventType: "CLOSED" }, "close"));
    const view = await app.compliance.obligation.get(tenantId, bookSetId, obligationId);
    expect(view.currentStatus).toBe("CLOSED");
    expect((view.events as unknown[]).length).toBe(6);
    expect((await app.compliance.obligation.calendar(tenantId, bookSetId, "2026-01-01", "2026-12-31", "2026-04-01"))[0]?.overdue).toBe(false);
    const db = new BunDatabase(dbPath);
    expect(() => db.query("UPDATE compliance_obligations SET due_date = '2026-01-01'").run()).toThrow();
    db.close();
  });

  test("persists UNKNOWN for missing facts and never generates from it", async () => {
    const facts = await app.compliance.factProfile.create(envelope({ effectiveFrom: "2026-01-01", facts: {}, sourceUrl: "https://fictional.example/facts", evidenceReference: "facts-evidence", verificationStatus: "VERIFIED" }, "facts-unknown"));
    const factProfileId = (JSON.parse(facts.resultJson) as { factProfileId: string }).factProfileId;
    const rule = await app.compliance.rule.create(envelope({ code: "FICTIONAL-MISSING", version: "1", jurisdiction: "fictional", authority: "fictional-authority", formLabel: "fictional-form", effectiveFrom: "2026-01-01", officialSourceUrl: "https://fictional.example/rule", lawReference: "fictional-law", sourceVersion: "fictional-v1", sourceHash: "d".repeat(64), evidenceReference: "rule-evidence", verificationStatus: "VERIFIED", requiredFactKeys: ["missingKey"], applicabilityPredicate: { all: [{ key: "missingKey", op: "EXISTS" }] } }, "rule-unknown"));
    const ruleId = (JSON.parse(rule.resultJson) as { ruleId: string }).ruleId;
    const decision = await app.compliance.applicability.evaluate(envelope({ ruleId, factProfileId }, "evaluate-unknown"));
    expect(JSON.parse(decision.resultJson)).toMatchObject({ decision: "UNKNOWN", missingKeys: ["missingKey"] });
  });

  test("enforces only explicit predecessors at lifecycle gates and reports blockers", async () => {
    const facts = await app.compliance.factProfile.create(envelope({ effectiveFrom: "2026-01-01", facts: { eligible: true }, sourceUrl: "https://fictional.example/facts", evidenceReference: "facts-evidence", verificationStatus: "VERIFIED" }, "facts-predecessor"));
    const factProfileId = (JSON.parse(facts.resultJson) as { factProfileId: string }).factProfileId;
    const createRule = (code: string, requestId: string) => app.compliance.rule.create(envelope({ code, version: "1", jurisdiction: "fictional", authority: "fictional-authority", formLabel: "fictional-form", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", officialSourceUrl: "https://fictional.example/rule", lawReference: "fictional-law", sourceVersion: "fictional-v1", sourceHash: "e".repeat(64), evidenceReference: "rule-evidence", verificationStatus: "VERIFIED", requiredFactKeys: ["eligible"], applicabilityPredicate: { all: [{ key: "eligible", op: "EQ", value: true }] } }, requestId));
    const predecessorRuleId = (JSON.parse((await createRule("FICTIONAL-PREVIOUS", "rule-previous")).resultJson) as { ruleId: string }).ruleId;
    const dependentRuleId = (JSON.parse((await createRule("FICTIONAL-DEPENDENT", "rule-dependent")).resultJson) as { ruleId: string }).ruleId;
    const deadline = (ruleId: string, requestId: string) => app.compliance.deadline.create(envelope({ ruleId, periodStart: "2026-01-01", periodEnd: "2026-03-31", dueDate: "2026-04-15", sourceUrl: "https://fictional.example/deadline", evidenceReference: "deadline-evidence", sourceHash: "f".repeat(64) }, requestId));
    await deadline(predecessorRuleId, "deadline-previous");
    await deadline(dependentRuleId, "deadline-dependent");
    await app.compliance.predecessor.create(envelope({ ruleId: dependentRuleId, predecessorRuleId, requiredStatus: "CLOSED", sourceUrl: "https://fictional.example/dependency", evidenceReference: "dependency-evidence", sourceHash: "1".repeat(64) }, "predecessor"));
    const previous = await app.compliance.obligation.generate(envelope({ ruleId: predecessorRuleId, factProfileId, periodStart: "2026-01-01", periodEnd: "2026-03-31" }, "generate-previous"));
    const previousId = (JSON.parse(previous.resultJson) as { obligationId: string }).obligationId;
    const dependent = await app.compliance.obligation.generate(envelope({ ruleId: dependentRuleId, factProfileId, periodStart: "2026-01-01", periodEnd: "2026-03-31" }, "generate-dependent"));
    const dependentId = (JSON.parse(dependent.resultJson) as { obligationId: string }).obligationId;
    await expect(app.compliance.obligation.event(envelope({ obligationId: dependentId, eventType: "READY" }, "dependent-ready-blocked"))).rejects.toMatchObject({ code: "BLOCKED_PREDECESSOR" });
    expect((await app.compliance.status(tenantId, bookSetId, "2026-04-01")).blockedPredecessorCount).toBe(1);
    const previousArtifact = await app.compliance.artifact.attach(envelope({ obligationId: previousId, artifactKind: "FICTIONAL_REVIEW_PACK", artifactHash: "2".repeat(64), artifactReference: "fictional://previous" }, "previous-artifact"));
    const previousArtifactId = (JSON.parse(previousArtifact.resultJson) as { artifactId: string }).artifactId;
    await app.compliance.obligation.event(envelope({ obligationId: previousId, eventType: "READY" }, "previous-ready"));
    await app.compliance.obligation.event(envelope({ obligationId: previousId, eventType: "EXPORTED", artifactId: previousArtifactId }, "previous-export"));
    await app.compliance.obligation.event(envelope({ obligationId: previousId, eventType: "USER_MARKED_SUBMITTED", evidenceReference: "previous-submit" }, "previous-submit"));
    await app.compliance.obligation.event(envelope({ obligationId: previousId, eventType: "ACKNOWLEDGED", evidenceReference: "previous-ack" }, "previous-ack"));
    await app.compliance.obligation.event(envelope({ obligationId: previousId, eventType: "CLOSED" }, "previous-close"));
    await app.compliance.obligation.event(envelope({ obligationId: dependentId, eventType: "READY" }, "dependent-ready"));
  });
});
