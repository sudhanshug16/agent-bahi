import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createSqliteApplication, initializeAndUpgradeSqliteApplication, inspectSqliteApplicationCompatibility } from "../../src/application/application.ts";
import { brandTenantId } from "../../src/core/types.ts";
import { BackupService } from "../../src/infrastructure/services/backup-service.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";
import { canonicalJson, computeResultHash } from "../../src/application/commands.ts";
import type { ComputationInputsRecordPayload } from "../../src/application/commands.ts";

type App = ReturnType<typeof createSqliteApplication>;
const artifacts = ["LAW", "RULES", "SCHEMA", "INSTRUCTION"].map((kind) => ({ kind, sourceUrl: "https://example.invalid/test-only", sourceTitle: "TEST_ONLY", officialReleaseIdentifier: "TEST_ONLY", officialReleaseDate: "2024-04-01", sha256: "b".repeat(64) }));
const envelope = (tenantId: string, requestId: string, payload: unknown, kind: "HUMAN" | "AGENT" = "HUMAN"): any => ({ schemaVersion: 1 as const, tenantId, requestId, actor: { kind, id: `${kind.toLowerCase()}-computation-test` }, source: "CLI" as const, reason: "TEST_ONLY computation workpaper", payload });

async function setup(app: App): Promise<{ tenantId: ReturnType<typeof brandTenantId>; taxCaseId: string; bookSetId: string; snapshotId: string; snapshotHash: string; worksheetId: string; worksheetHash: string }> {
  const tenant = JSON.parse((await app.tenant.create(envelope("bootstrap-computation", randomUUID(), { kind: "INDIVIDUAL", name: "TEST_ONLY computation taxpayer" }))).resultJson);
  await app.tenant.activate(envelope(tenant.tenantId, randomUUID(), { defaultBookSetId: tenant.defaultBookSetId }));
  await app.tenant.pan.set(envelope(tenant.tenantId, randomUUID(), { pan: "ABCDE1234F" }));
  const taxCaseId = "computation-case";
  await app.taxCase.create(envelope(tenant.tenantId, randomUUID(), { taxCaseId, financialYear: "2024-25", taxPeriod: "2024-25", filingTrigger: "ANNUAL", bookSetIds: [tenant.defaultBookSetId] }));
  const candidate = await app.taxCase.filingSnapshot.preview(tenant.tenantId, taxCaseId); const snapshot = JSON.parse((await app.taxCase.filingSnapshot.seal(envelope(tenant.tenantId, "computation-seal", { taxCaseId, candidateHash: candidate.candidateHash })).then((r) => r.resultJson)));
  const worksheet = JSON.parse((await app.taxCase.position.generate(envelope(tenant.tenantId, "computation-worksheet", { taxCaseId, filingSnapshotId: snapshot.snapshotId }, "AGENT")).then((r) => r.resultJson)));
  return { tenantId: brandTenantId(tenant.tenantId), taxCaseId, bookSetId: tenant.defaultBookSetId, snapshotId: snapshot.snapshotId, snapshotHash: snapshot.candidateHash, worksheetId: worksheet.worksheetId, worksheetHash: worksheet.canonicalOutputHash };
}

function arithmeticProgram() {
  return { nodes: [
    { name: "five", op: "constant", value: "5" },
    { name: "ratio_down", op: "multiply-ratio", arg: "five", numerator: "1", denominator: "2", rounding: "DOWN" },
    { name: "ratio_up", op: "multiply-ratio", arg: "five", numerator: "1", denominator: "2", rounding: "UP" },
    { name: "ratio_half", op: "multiply-ratio", arg: "five", numerator: "1", denominator: "2", rounding: "HALF_UP" },
    { name: "slab_basis", op: "constant", value: "150" },
    { name: "slab", op: "progressive-slabs", arg: "slab_basis", slabs: [{ upTo: "100", rateBasisPoints: "1000" }, { upTo: null, rateBasisPoints: "2000" }] },
    { name: "round_basis", op: "constant", value: "11" },
    { name: "round_down", op: "round-to-multiple", arg: "round_basis", multiple: "5", direction: "DOWN" },
    { name: "round_up", op: "round-to-multiple", arg: "round_basis", multiple: "5", direction: "UP" },
    { name: "manual", op: "input", field: "manual_adjustment" },
    { name: "eligible", op: "constant", value: "1" },
    { name: "ineligible", op: "constant", value: "0" },
    { name: "eligibility", op: "conditional", fact: "is_resident", equals: true, then: "eligible", else: "ineligible" },
    { name: "tax_base", op: "add", args: ["slab", "manual"] },
    { name: "gross", op: "add", args: ["tax_base", "eligibility"] },
    { name: "credits", op: "constant", value: "0" },
    { name: "net", op: "subtract", args: ["gross", "credits"] },
    { name: "gross_final", op: "final", arg: "gross" },
    { name: "credits_final", op: "final", arg: "credits" },
    { name: "net_final", op: "final", arg: "net" },
  ], outputs: [{ name: "grossTaxMinor", ref: "gross_final" }, { name: "creditsMinor", ref: "credits_final" }, { name: "netPayableMinor", ref: "net_final" }, { name: "ratio_down_minor", ref: "ratio_down" }, { name: "ratio_up_minor", ref: "ratio_up" }, { name: "ratio_half_minor", ref: "ratio_half" }, { name: "round_down_minor", ref: "round_down" }, { name: "round_up_minor", ref: "round_up" }] };
}

function computationPayload(authority: { packId: string; canonicalHash: string }, program: unknown, packVersion: string, declaredInputs: unknown[] = [{ name: "manual_adjustment", valueType: "INTEGER_MINOR" }, { name: "is_resident", valueType: "BOOLEAN" }]) {
  return { authorityPackId: authority.packId, authorityPackHash: authority.canonicalHash, financialYear: "2024-25", assessmentYear: "2025-26", itrForm: "ITR-1", packVersion, provenanceArtifacts: artifacts, declaredInputs, namedSchedules: ["TEST_ONLY"], program };
}

async function computationFixture(directory: string) {
  const dbPath = join(directory, "books.sqlite");
  const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
  const scope = await setup(app);
  const authority = JSON.parse((await app.taxAuthority.pack.register(envelope(scope.tenantId, "authority-register", { jurisdiction: "IN", authority: "INCOME_TAX", financialYear: "2024-25", assessmentYear: "2025-26", filingTypes: ["ANNUAL"], effectiveFrom: "2024-04-01", releasedAt: "2024-04-01", releaseIdentifier: "TEST_ONLY", artifactReferences: artifacts, packVersion: "TEST_ONLY-authority", candidateForms: ["ITR-1"], ruleAst: { forms: [{ form: "ITR-1", rule: { op: "eq", field: "is_resident", value: true } }] } }, "AGENT"))).resultJson);
  await app.taxAuthority.pack.verify(envelope(scope.tenantId, "authority-verify", { packId: authority.packId, expectedPackHash: authority.canonicalHash, reason: "TEST_ONLY human verification" }));
  await app.taxCase.eligibilityFacts.record(envelope(scope.tenantId, "eligibility-fact", { taxCaseId: scope.taxCaseId, filingSnapshotId: scope.snapshotId, worksheetId: scope.worksheetId, snapshotCandidateHash: scope.snapshotHash, worksheetOutputHash: scope.worksheetHash, fieldName: "is_resident", valueType: "BOOLEAN", value: true, provenanceKind: "HUMAN_ASSERTION", provenance: { source: "TEST_ONLY" } }));
  const evaluation = JSON.parse((await app.taxCase.itrEligibility.evaluate(envelope(scope.tenantId, "eligibility-evaluate", { taxCaseId: scope.taxCaseId, filingSnapshotId: scope.snapshotId, worksheetId: scope.worksheetId, packId: authority.packId }, "AGENT")).then((r) => r.resultJson)));
  const selection = JSON.parse((await app.taxCase.itrForm.select(envelope(scope.tenantId, "form-select", { taxCaseId: scope.taxCaseId, evaluationId: evaluation.evaluationId, expectedEvaluationHash: evaluation.evaluationHash, selectedForm: "ITR-1" })).then((r) => r.resultJson)));
  return { app, dbPath, scope, authority, evaluation, selection };
}

async function securitiesComputationFixture(directory: string) {
  const fixture = await computationFixture(directory); const native = new Database(fixture.dbPath, { safeIntegers: true });
  const existing = native.query("SELECT * FROM personal_tax_position_worksheets WHERE id = ? AND tenant_id = ? AND tax_case_id = ?").get(fixture.scope.worksheetId, fixture.scope.tenantId, fixture.scope.taxCaseId) as Record<string, unknown>;
  const output = JSON.parse(String(existing.output_json)) as Record<string, any>; output.unresolved = { items: [{ factId: "TEST_ONLY-security", kind: "SECURITIES_TRANSACTION", amountMinor: 100, reasonCode: "SECURITIES_COST_BASIS_REQUIRED" }], totalMinor: 100, detailCount: 1 };
  const inputBindings = JSON.parse(String(existing.input_bindings_json)); inputBindings.facts = [{ factId: "TEST_ONLY-security", kind: "SECURITIES_TRANSACTION", normalizedPayloadHash: "a".repeat(64), terminalEventId: "TEST_ONLY-event", terminalEventType: "HUMAN_CONFIRMED", terminalEventHash: "b".repeat(64) }]; const inputBindingsJson = canonicalJson(inputBindings); const inputHash = computeResultHash(inputBindingsJson); const worksheetId = randomUUID(); const outputJson = canonicalJson(output); const outputHash = computeResultHash(outputJson);
  native.query("INSERT INTO personal_tax_position_worksheets (id, tenant_id, tax_case_id, filing_snapshot_id, snapshot_candidate_hash, input_bindings_json, input_hash, output_json, output_hash, created_at, created_by_actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(worksheetId, fixture.scope.tenantId, fixture.scope.taxCaseId, fixture.scope.snapshotId, fixture.scope.snapshotHash, inputBindingsJson, inputHash, outputJson, outputHash, new Date().toISOString(), "human-computation-test"); native.close();
  await fixture.app.taxCase.eligibilityFacts.record(envelope(fixture.scope.tenantId, "securities-eligibility-fact", { taxCaseId: fixture.scope.taxCaseId, filingSnapshotId: fixture.scope.snapshotId, worksheetId, snapshotCandidateHash: fixture.scope.snapshotHash, worksheetOutputHash: outputHash, fieldName: "is_resident", valueType: "BOOLEAN", value: true, provenanceKind: "HUMAN_ASSERTION", provenance: { source: "TEST_ONLY" } }));
  const evaluation = JSON.parse((await fixture.app.taxCase.itrEligibility.evaluate(envelope(fixture.scope.tenantId, "securities-evaluation", { taxCaseId: fixture.scope.taxCaseId, filingSnapshotId: fixture.scope.snapshotId, worksheetId, packId: fixture.authority.packId }, "AGENT")).then((r) => r.resultJson)));
  const selection = JSON.parse((await fixture.app.taxCase.itrForm.select(envelope(fixture.scope.tenantId, "securities-selection", { taxCaseId: fixture.scope.taxCaseId, evaluationId: evaluation.evaluationId, expectedEvaluationHash: evaluation.evaluationHash, selectedForm: "ITR-1" })).then((r) => r.resultJson)));
  return { ...fixture, scope: { ...fixture.scope, worksheetId, worksheetHash: outputHash }, evaluation, selection };
}

function binding(fixture: Awaited<ReturnType<typeof computationFixture>>, computationPackId: string, inputs: ComputationInputsRecordPayload["inputs"]): ComputationInputsRecordPayload {
  return { taxCaseId: fixture.scope.taxCaseId, filingSnapshotId: fixture.scope.snapshotId, worksheetId: fixture.scope.worksheetId, evaluationId: fixture.evaluation.evaluationId, selectionId: fixture.selection.selectionId, computationPackId, inputs };
}

test("Personal Tax Computation Workpaper V1 is exact, BigInt-safe, immutable, and human-approved", async () => {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-computation-")); const app = await initializeAndUpgradeSqliteApplication(join(directory, "books.sqlite"), { backupDestinationPath: join(directory, "bootstrap.sqlite") });
  try {
    const scope = await setup(app); const authority = JSON.parse((await app.taxAuthority.pack.register(envelope(scope.tenantId, "authority-register", { jurisdiction: "IN", authority: "INCOME_TAX", financialYear: "2024-25", assessmentYear: "2025-26", filingTypes: ["ANNUAL"], effectiveFrom: "2024-04-01", releasedAt: "2024-04-01", releaseIdentifier: "TEST_ONLY", artifactReferences: artifacts, packVersion: "TEST_ONLY-authority", candidateForms: ["ITR-1"], ruleAst: { forms: [{ form: "ITR-1", rule: { op: "eq", field: "is_resident", value: true } }] } }, "AGENT"))).resultJson);
    await app.taxAuthority.pack.verify(envelope(scope.tenantId, "authority-verify", { packId: authority.packId, expectedPackHash: authority.canonicalHash, reason: "TEST_ONLY human verification" }));
    await app.taxCase.eligibilityFacts.record(envelope(scope.tenantId, "eligibility-fact", { taxCaseId: scope.taxCaseId, filingSnapshotId: scope.snapshotId, worksheetId: scope.worksheetId, snapshotCandidateHash: scope.snapshotHash, worksheetOutputHash: scope.worksheetHash, fieldName: "is_resident", valueType: "BOOLEAN", value: true, provenanceKind: "HUMAN_ASSERTION", provenance: { source: "TEST_ONLY" } }));
    const evaluation = JSON.parse((await app.taxCase.itrEligibility.evaluate(envelope(scope.tenantId, "eligibility-evaluate", { taxCaseId: scope.taxCaseId, filingSnapshotId: scope.snapshotId, worksheetId: scope.worksheetId, packId: authority.packId }, "AGENT")).then((r) => r.resultJson))); const selection = JSON.parse((await app.taxCase.itrForm.select(envelope(scope.tenantId, "form-select", { taxCaseId: scope.taxCaseId, evaluationId: evaluation.evaluationId, expectedEvaluationHash: evaluation.evaluationHash, selectedForm: "ITR-1" })).then((r) => r.resultJson)));
    const program = { nodes: [{ name: "gross", op: "constant", value: "10000000000000000001" }, { name: "credits", op: "input", field: "tax_credits_minor" }, { name: "net", op: "subtract", args: ["gross", "credits"] }, { name: "grossfinal", op: "final", arg: "gross" }, { name: "creditsfinal", op: "final", arg: "credits" }, { name: "netfinal", op: "final", arg: "net" }], outputs: [{ name: "grossTaxMinor", ref: "grossfinal" }, { name: "creditsMinor", ref: "creditsfinal" }, { name: "netPayableMinor", ref: "netfinal" }] };
    const computationPack = JSON.parse((await app.taxAuthority.computationPack.register(envelope(scope.tenantId, "computation-pack-register", { authorityPackId: authority.packId, authorityPackHash: authority.canonicalHash, financialYear: "2024-25", assessmentYear: "2025-26", itrForm: "ITR-1", packVersion: "TEST_ONLY-computation", provenanceArtifacts: artifacts, declaredInputs: [{ name: "is_resident", valueType: "BOOLEAN" }], namedSchedules: ["TEST_ONLY"], program }, "AGENT")).then((r) => r.resultJson)));
    await app.taxAuthority.computationPack.verify(envelope(scope.tenantId, "computation-pack-verify", { packId: computationPack.packId, expectedPackHash: computationPack.canonicalHash, reason: "TEST_ONLY human verification" }));
    const inputs = JSON.parse((await app.taxCase.computationInputs.record(envelope(scope.tenantId, "computation-inputs", { taxCaseId: scope.taxCaseId, filingSnapshotId: scope.snapshotId, worksheetId: scope.worksheetId, evaluationId: evaluation.evaluationId, selectionId: selection.selectionId, computationPackId: computationPack.packId, inputs: { is_resident: { valueType: "BOOLEAN", value: true, provenance: { source: "TEST_ONLY" }, verified: true } } })).then((r) => r.resultJson)));
    const preview = await app.taxCase.computation.preview(scope.tenantId, { taxCaseId: scope.taxCaseId, filingSnapshotId: scope.snapshotId, worksheetId: scope.worksheetId, evaluationId: evaluation.evaluationId, selectionId: selection.selectionId, computationPackId: computationPack.packId, inputs: { is_resident: { valueType: "BOOLEAN", value: true, provenance: { source: "TEST_ONLY" }, verified: true } } }); expect(preview.workpaper).toBe("WORKPAPER_NOT_RETURN"); expect(preview.grossTaxMinor).toBe("10000000000000000001");
    const generated = JSON.parse((await app.taxCase.computation.generate(envelope(scope.tenantId, "computation-generate", { taxCaseId: scope.taxCaseId, filingSnapshotId: scope.snapshotId, worksheetId: scope.worksheetId, evaluationId: evaluation.evaluationId, selectionId: selection.selectionId, computationPackId: computationPack.packId, inputSetId: inputs.inputSetId, inputs: { is_resident: { valueType: "BOOLEAN", value: true, provenance: { source: "TEST_ONLY" }, verified: true } } }, "AGENT")).then((r) => r.resultJson))); expect(generated.netPayableMinor).toBe("10000000000000000001"); await expect(app.taxCase.computation.approve(envelope(scope.tenantId, "agent-approve", { taxCaseId: scope.taxCaseId, computationId: generated.computationId, expectedComputationHash: generated.computationHash, reason: "agent" }, "AGENT"))).rejects.toMatchObject({ code: "TAX_COMPUTATION_APPROVAL_HUMAN_REQUIRED" }); const approved = await app.taxCase.computation.approve(envelope(scope.tenantId, "human-approve", { taxCaseId: scope.taxCaseId, computationId: generated.computationId, expectedComputationHash: generated.computationHash, reason: "human approved TEST_ONLY workpaper" })); expect(JSON.parse(approved.resultJson).status).toBe("APPROVED");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Personal Tax Computation V1 rejects unsafe programs and enforces pack lifecycle CAS and supersession", async () => {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-computation-ast-"));
  try {
    const fixture = await computationFixture(directory);
    const register = (requestId: string, program: unknown, declaredInputs = [{ name: "manual_adjustment", valueType: "INTEGER_MINOR" }, { name: "is_resident", valueType: "BOOLEAN" }]) => appRegister(fixture, requestId, computationPayload(fixture.authority, program, `TEST_ONLY-${requestId}`, declaredInputs));
    const simple = { nodes: [{ name: "zero", op: "constant", value: "0" }], outputs: [{ name: "grossTaxMinor", ref: "zero" }, { name: "creditsMinor", ref: "zero" }, { name: "netPayableMinor", ref: "zero" }] };
    const taxableInput = (field: string) => ({ nodes: [{ name: "amount", op: "input", field }, { name: "final", op: "final", arg: "amount" }], outputs: [{ name: "grossTaxMinor", ref: "final" }, { name: "creditsMinor", ref: "final" }, { name: "netPayableMinor", ref: "final" }] });
    await expect(register("bad-forward", { nodes: [{ name: "a", op: "ref", ref: "b" }, { name: "b", op: "constant", value: "0" }], outputs: [{ name: "grossTaxMinor", ref: "a" }, { name: "creditsMinor", ref: "a" }, { name: "netPayableMinor", ref: "a" }] })).rejects.toMatchObject({ code: "INVALID_TAX_COMPUTATION_FORWARD_REFERENCE" });
    await expect(register("bad-cycle", { nodes: [{ name: "a", op: "ref", ref: "b" }, { name: "b", op: "ref", ref: "a" }], outputs: [{ name: "grossTaxMinor", ref: "a" }, { name: "creditsMinor", ref: "a" }, { name: "netPayableMinor", ref: "a" }] })).rejects.toMatchObject({ code: "INVALID_TAX_COMPUTATION_FORWARD_REFERENCE" });
    await expect(register("bad-divzero", { nodes: [{ name: "zero", op: "constant", value: "0" }, { name: "ratio", op: "multiply-ratio", arg: "zero", numerator: "1", denominator: "0", rounding: "DOWN" }], outputs: [{ name: "grossTaxMinor", ref: "ratio" }, { name: "creditsMinor", ref: "zero" }, { name: "netPayableMinor", ref: "ratio" }] })).rejects.toMatchObject({ code: "INVALID_TAX_COMPUTATION_DIVIDE_BY_ZERO" });
    await expect(register("bad-field", { nodes: [{ name: "zero", op: "constant", value: "0", sql: "DROP TABLE" }], outputs: [{ name: "grossTaxMinor", ref: "zero" }, { name: "creditsMinor", ref: "zero" }, { name: "netPayableMinor", ref: "zero" }] })).rejects.toMatchObject({ code: "INVALID_TAX_COMPUTATION_PROGRAM" });
    await expect(register("bad-type", simple, [{ name: "manual_adjustment", valueType: "DECIMAL" }])).rejects.toMatchObject({ code: "INVALID_TAX_COMPUTATION_INPUT_DECLARATIONS" });
    await expect(register("double-count-receipts", taxableInput("supporting_business_receipts_minor"))).rejects.toMatchObject({ code: "INVALID_TAX_COMPUTATION_REFERENCE" });
    await expect(register("double-count-credits", taxableInput("tax_credits_minor"))).rejects.toMatchObject({ code: "INVALID_TAX_COMPUTATION_REFERENCE" });
    const tooManyNodes = Array.from({ length: 513 }, (_, index) => ({ name: `n${index}`, op: "constant", value: "0" }));
    await expect(register("bad-bounds", { nodes: tooManyNodes, outputs: [{ name: "grossTaxMinor", ref: "n0" }, { name: "creditsMinor", ref: "n0" }, { name: "netPayableMinor", ref: "n0" }] })).rejects.toMatchObject({ code: "INVALID_TAX_COMPUTATION_PROGRAM" });
    const first = JSON.parse((await register("pack-lifecycle", arithmeticProgram())).resultJson);
    await appRegister(fixture, "pack-idempotency", computationPayload(fixture.authority, simple, "TEST_ONLY-idempotency-a"));
    await expect(appRegister(fixture, "pack-idempotency", computationPayload(fixture.authority, simple, "TEST_ONLY-idempotency-b"))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(fixture.app.taxAuthority.computationPack.verify(envelope(fixture.scope.tenantId, "pack-agent-verify", { packId: first.packId, expectedPackHash: first.canonicalHash, reason: "agent" }, "AGENT"))).rejects.toMatchObject({ code: "TAX_COMPUTATION_PACK_HUMAN_REQUIRED" });
    await expect(fixture.app.taxAuthority.computationPack.verify(envelope(fixture.scope.tenantId, "pack-bad-cas", { packId: first.packId, expectedPackHash: "0".repeat(64), reason: "wrong" }))).rejects.toMatchObject({ code: "TAX_COMPUTATION_PACK_CAS_MISMATCH" });
    await fixture.app.taxAuthority.computationPack.verify(envelope(fixture.scope.tenantId, "pack-human-verify", { packId: first.packId, expectedPackHash: first.canonicalHash, reason: "human" }));
    await expect(fixture.app.taxAuthority.computationPack.verify(envelope(fixture.scope.tenantId, "pack-reverify", { packId: first.packId, expectedPackHash: first.canonicalHash, reason: "again" }))).rejects.toMatchObject({ code: "TAX_COMPUTATION_PACK_LIFECYCLE_INVALID" });
    const replacement = JSON.parse((await appRegister(fixture, "pack-replacement", { ...computationPayload(fixture.authority, arithmeticProgram(), "TEST_ONLY-replacement"), supersedesPackId: first.packId })).resultJson);
    expect(replacement.packId).not.toBe(first.packId);
    await fixture.app.taxAuthority.computationPack.verify(envelope(fixture.scope.tenantId, "replacement-human-verify", { packId: replacement.packId, expectedPackHash: replacement.canonicalHash, reason: "human" }));
    expect((await fixture.app.taxAuthority.computationPack.show(first.packId)).lifecycle).toBe("SUPERSEDED");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function appRegister(fixture: Awaited<ReturnType<typeof computationFixture>>, requestId: string, payload: unknown) {
  return fixture.app.taxAuthority.computationPack.register(envelope(fixture.scope.tenantId, requestId, payload, "AGENT"));
}

test("Personal Tax Computation V1 is deterministic, isolated, stale-safe, and shared across CLI/MCP", async () => {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-computation-runtime-"));
  try {
    const fixture = await computationFixture(directory);
    const pack = JSON.parse((await appRegister(fixture, "runtime-pack-register", computationPayload(fixture.authority, arithmeticProgram(), "TEST_ONLY-runtime"))).resultJson);
    await fixture.app.taxAuthority.computationPack.verify(envelope(fixture.scope.tenantId, "runtime-pack-verify", { packId: pack.packId, expectedPackHash: pack.canonicalHash, reason: "human" }));
    const missing = binding(fixture, pack.packId, { is_resident: { valueType: "BOOLEAN", value: true, provenance: { source: "TEST_ONLY" }, verified: true } });
    await expect(fixture.app.taxCase.computationInputs.record(envelope(fixture.scope.tenantId, "runtime-input-missing", missing))).rejects.toMatchObject({ code: "TAX_COMPUTATION_INPUT_MISSING" });
    const unverified = binding(fixture, pack.packId, { manual_adjustment: { valueType: "INTEGER_MINOR", value: "7", provenance: { source: "TEST_ONLY" }, verified: false }, is_resident: { valueType: "BOOLEAN", value: true, provenance: { source: "TEST_ONLY" }, verified: true } });
    await expect(fixture.app.taxCase.computationInputs.record(envelope(fixture.scope.tenantId, "runtime-input-unverified", unverified))).rejects.toMatchObject({ code: "TAX_COMPUTATION_INPUT_UNVERIFIED" });
    const validInputs = binding(fixture, pack.packId, { manual_adjustment: { valueType: "INTEGER_MINOR", value: "7", provenance: { source: "TEST_ONLY" }, verified: true }, is_resident: { valueType: "BOOLEAN", value: true, provenance: { source: "TEST_ONLY" }, verified: true } });
    const inputSet = JSON.parse((await fixture.app.taxCase.computationInputs.record(envelope(fixture.scope.tenantId, "runtime-input-valid", validInputs))).resultJson);
    const preview = await fixture.app.taxCase.computation.preview(fixture.scope.tenantId, validInputs);
    const trace = preview.trace as Array<{ name: string; value: string }>;
    const traceValue = (name: string) => trace.find((entry) => entry.name === name)?.value;
    expect(traceValue("ratio_down")).toBe("2"); expect(traceValue("ratio_up")).toBe("3"); expect(traceValue("ratio_half")).toBe("3");
    expect(traceValue("slab")).toBe("20"); expect(traceValue("round_down")).toBe("10"); expect(traceValue("round_up")).toBe("15"); expect(preview.grossTaxMinor).toBe("28"); expect(preview.netPayableMinor).toBe("28");
    expect(await fixture.app.taxCase.computation.preview(fixture.scope.tenantId, validInputs)).toEqual(preview);
    const generateEnvelope = envelope(fixture.scope.tenantId, "runtime-generate", { ...validInputs, inputSetId: inputSet.inputSetId }, "AGENT");
    const generated = await fixture.app.taxCase.computation.generate(generateEnvelope);
    const replay = await fixture.app.taxCase.computation.generate(generateEnvelope);
    expect(replay.replayed).toBe(true); expect(replay.resultJson).toBe(generated.resultJson);
    const computation = JSON.parse(generated.resultJson);
    await expect(fixture.app.taxCase.computation.approve(envelope(fixture.scope.tenantId, "runtime-human-bad-cas", { taxCaseId: fixture.scope.taxCaseId, computationId: computation.computationId, expectedComputationHash: "0".repeat(64), reason: "wrong" }))).rejects.toMatchObject({ code: "TAX_COMPUTATION_APPROVAL_CAS_MISMATCH" });
    await expect(fixture.app.taxCase.computation.approve(envelope(fixture.scope.tenantId, "runtime-agent-approval", { taxCaseId: fixture.scope.taxCaseId, computationId: computation.computationId, expectedComputationHash: computation.computationHash, reason: "agent" }, "AGENT"))).rejects.toMatchObject({ code: "TAX_COMPUTATION_APPROVAL_HUMAN_REQUIRED" });
    await fixture.app.taxCase.computation.approve(envelope(fixture.scope.tenantId, "runtime-human-approval", { taxCaseId: fixture.scope.taxCaseId, computationId: computation.computationId, expectedComputationHash: computation.computationHash, reason: "human" }));
    const cli = await new OperationDispatcher({ databasePath: fixture.dbPath, source: "CLI", allowOperatorOperations: false }).dispatch("tax-case.computation.show", { tenantId: fixture.scope.tenantId, taxCaseId: fixture.scope.taxCaseId, computationId: computation.computationId });
    const mcp = await new OperationDispatcher({ databasePath: fixture.dbPath, source: "MCP", allowOperatorOperations: false }).dispatch("tax-case.computation.show", { tenantId: fixture.scope.tenantId, taxCaseId: fixture.scope.taxCaseId, computationId: computation.computationId });
    expect(cli.ok).toBe(true); expect(mcp.ok).toBe(true); expect((cli as { result: unknown }).result).toEqual((mcp as { result: unknown }).result);
    await expect(fixture.app.taxCase.computation.show(brandTenantId("other-tenant"), fixture.scope.taxCaseId, computation.computationId)).rejects.toMatchObject({ code: "TAX_COMPUTATION_NOT_FOUND" });
    const native = new Database(fixture.dbPath);
    expect(() => native.query("UPDATE personal_tax_computation_packs SET pack_version = 'tampered' WHERE id = ?").run(pack.packId)).toThrow();
    expect(() => native.query("DELETE FROM personal_tax_computations WHERE id = ?").run(computation.computationId)).toThrow();
    native.close();
    const secondBookSet = JSON.parse((await fixture.app.bookSet.create(envelope(fixture.scope.tenantId, "runtime-second-bookset", { kind: "PROPRIETORSHIP", displayName: "TEST_ONLY second books" }))).resultJson);
    await fixture.app.taxCase.membershipRefresh(envelope(fixture.scope.tenantId, "runtime-membership-refresh", { taxCaseId: fixture.scope.taxCaseId, bookSetIds: [fixture.scope.bookSetId, secondBookSet.bookSetId] }));
    expect(await fixture.app.taxCase.computation.status(fixture.scope.tenantId, fixture.scope.taxCaseId, computation.computationId)).toMatchObject({ status: "STALE" });
    await expect(fixture.app.taxCase.computation.approve(envelope(fixture.scope.tenantId, "runtime-stale-approval", { taxCaseId: fixture.scope.taxCaseId, computationId: computation.computationId, expectedComputationHash: computation.computationHash, reason: "stale" }))).rejects.toMatchObject({ code: "TAX_COMPUTATION_NOT_CURRENT" });
    const compatibility = await inspectSqliteApplicationCompatibility(fixture.dbPath); expect(compatibility.status).toBe("READY"); expect(compatibility.currentSchemaVersion).toBe(8);
    const backupPath = join(directory, "runtime.backup.sqlite"); const restoredPath = join(directory, "runtime.restored.sqlite"); const backup = new BackupService(fixture.dbPath); await backup.createBackup(backupPath); expect(await backup.verifyBackup(backupPath)).toBe(true); expect(await backup.restoreFromBackup(backupPath, restoredPath)).toBe(true);
    const restored = new Database(restoredPath, { readonly: true, safeIntegers: true }); expect(restored.query("SELECT COUNT(*) AS count FROM personal_tax_computations").get()).toEqual({ count: 1n }); expect(restored.query("PRAGMA foreign_key_check").all()).toEqual([]); restored.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Personal Tax Computation V1 blocks unresolved securities and requires a verified capital-gain resolution", async () => {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-computation-securities-"));
  try {
    const fixture = await securitiesComputationFixture(directory);
    const program = { nodes: [{ name: "gain", op: "input", field: "capital_gain_minor" }, { name: "credits", op: "constant", value: "0" }, { name: "net", op: "subtract", args: ["gain", "credits"] }, { name: "gross_final", op: "final", arg: "gain" }, { name: "credits_final", op: "final", arg: "credits" }, { name: "net_final", op: "final", arg: "net" }], outputs: [{ name: "grossTaxMinor", ref: "gross_final" }, { name: "creditsMinor", ref: "credits_final" }, { name: "netPayableMinor", ref: "net_final" }] };
    const pack = JSON.parse((await appRegister(fixture, "securities-pack-register", { ...computationPayload(fixture.authority, program, "TEST_ONLY-securities-computation", [{ name: "capital_gain_minor", valueType: "INTEGER_MINOR" }, { name: "is_resident", valueType: "BOOLEAN" }]) })).resultJson); await fixture.app.taxAuthority.computationPack.verify(envelope(fixture.scope.tenantId, "securities-pack-verify", { packId: pack.packId, expectedPackHash: pack.canonicalHash, reason: "human" }));
    const base = { taxCaseId: fixture.scope.taxCaseId, filingSnapshotId: fixture.scope.snapshotId, worksheetId: fixture.scope.worksheetId, evaluationId: fixture.evaluation.evaluationId, selectionId: fixture.selection.selectionId, computationPackId: pack.packId, inputs: { is_resident: { valueType: "BOOLEAN", value: true, provenance: { source: "TEST_ONLY" }, verified: true } } };
    await expect(fixture.app.taxCase.computationInputs.record(envelope(fixture.scope.tenantId, "securities-unresolved", base))).rejects.toMatchObject({ code: "TAX_COMPUTATION_SECURITIES_UNRESOLVED" });
    await expect(fixture.app.taxCase.computationInputs.record(envelope(fixture.scope.tenantId, "securities-unverified-resolution", { ...base, inputs: { ...base.inputs, capital_gain_minor: { valueType: "INTEGER_MINOR", value: "100", provenance: { source: "TEST_ONLY" }, verified: false } } }))).rejects.toMatchObject({ code: "TAX_COMPUTATION_INPUT_UNVERIFIED" });
    const resolved = JSON.parse((await fixture.app.taxCase.computationInputs.record(envelope(fixture.scope.tenantId, "securities-resolved", { ...base, inputs: { ...base.inputs, capital_gain_minor: { valueType: "INTEGER_MINOR", value: "100", provenance: { source: "HUMAN_TEST_ONLY" }, verified: true } } })).then((r) => r.resultJson))); expect(resolved.status).toBe("CURRENT");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
