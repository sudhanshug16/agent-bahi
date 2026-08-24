import { OPERATION_CATALOG, findOperation, type RequiredScope } from "./catalog.ts";
import type { OperationCatalogEntry } from "./catalog.ts";

export type SkillStepKind = "OPERATION" | "EXTERNAL" | "NOT_IMPLEMENTED";
export type SkillCheckStatus = "READY" | "PARTIAL" | "BROKEN";

export interface SkillStep {
  readonly id: string;
  readonly title: string;
  readonly kind: SkillStepKind;
  readonly scope: RequiredScope;
  readonly instruction: string;
  readonly operationId?: string;
  /** Structured marker for work that is deliberately outside the dispatcher. */
  readonly marker?: "EXTERNAL" | "NOT_IMPLEMENTED";
  readonly reason?: string;
}

export interface SkillHumanGate {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
  readonly operationIds: readonly string[];
  readonly evidence: readonly string[];
}

export interface SkillBlockerRemediation {
  readonly blocker: string;
  readonly remediation: string;
}

export interface SkillDrilldown {
  readonly title: string;
  readonly operationId?: string;
  readonly marker?: "EXTERNAL" | "NOT_IMPLEMENTED";
  readonly reason?: string;
}

export interface SkillGuide {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly summary: string;
  readonly applicability: string;
  readonly requiredScope: RequiredScope;
  readonly statusFocus?: readonly string[];
  readonly statusActionCodes?: readonly string[];
  readonly preflightOperations: readonly string[];
  readonly steps: readonly SkillStep[];
  readonly allowedAgentJudgmentPoints: readonly string[];
  readonly humanOnlyGates: readonly SkillHumanGate[];
  /** The complete, ordered, de-duplicated operation reference set. */
  readonly operationReferences: readonly string[];
  readonly blockerRemediation: readonly SkillBlockerRemediation[];
  readonly completionEvidence: readonly string[];
  readonly nextDrilldowns: readonly SkillDrilldown[];
}

export interface SkillCheckReport {
  readonly id: string;
  readonly version: number;
  readonly status: SkillCheckStatus;
  readonly missingOperationIds: readonly string[];
  readonly externalStepIds: readonly string[];
  readonly notImplementedStepIds: readonly string[];
  readonly invalidScopeTransitions: readonly string[];
  readonly issues: readonly string[];
}

export interface SkillValidationIssue {
  readonly guideId: string;
  readonly code: string;
  readonly message: string;
}

const op = (id: string, title: string, scope: RequiredScope, instruction: string): SkillStep => ({ id, title, kind: "OPERATION", scope, operationId: id, instruction });
const external = (id: string, title: string, scope: RequiredScope, reason: string): SkillStep => ({ id, title, kind: "EXTERNAL", scope, marker: "EXTERNAL", instruction: reason, reason });
const notImplemented = (id: string, title: string, scope: RequiredScope, reason: string): SkillStep => ({ id, title, kind: "NOT_IMPLEMENTED", scope, marker: "NOT_IMPLEMENTED", instruction: reason, reason });

function guide(value: Omit<SkillGuide, "operationReferences">): SkillGuide {
  const references: string[] = [];
  for (const id of [...value.preflightOperations, ...value.steps.flatMap((step) => step.operationId ? [step.operationId] : []), ...value.humanOnlyGates.flatMap((gate) => gate.operationIds), ...value.nextDrilldowns.flatMap((drilldown) => drilldown.operationId ? [drilldown.operationId] : [])]) {
    if (!references.includes(id)) references.push(id);
  }
  return { ...value, operationReferences: references };
}

const commonEvidence = ["The exact operation envelope/result hash is preserved.", "The tenant, BookSet, or TaxCase identifiers and source evidence are retained.", "The final status and any typed blockers are recorded without guessing."] as const;

export const SKILL_GUIDES: readonly SkillGuide[] = [
  guide({
    id: "daily-bookkeeping", version: 1, title: "Daily bookkeeping", summary: "Record supported double-entry activity and inspect deterministic ledger reports.", applicability: "A company or personal BookSet with explicit tenant and BookSet scope.", requiredScope: "bookSet",
    statusFocus: ["journal-reports", "ar", "ap", "bank", "expenses"], statusActionCodes: ["LEDGER_UNBALANCED", "AR_OUTSTANDING", "AP_OUTSTANDING", "BANK_RECONCILIATION_REVIEW", "EXPENSE_EVIDENCE_OR_REVIEW_REQUIRED"],
    preflightOperations: ["company.status", "book-set.scope.resolve"],
    steps: [
      op("journal.post", "Post balanced journal", "bookSet", "Use explicit account IDs, source evidence, and an idempotency request ID; never infer a missing account."),
      op("ledger.trial-balance", "Read Trial Balance", "bookSet", "Read the as-of Trial Balance and retain its result hash."),
      op("ledger.profit-and-loss", "Read Profit and Loss", "bookSet", "Read the explicit date-range P&L and investigate unexpected balances."),
      op("ledger.balance-sheet", "Read Balance Sheet", "bookSet", "Read the as-of Balance Sheet and compare it with the Trial Balance."),
    ],
    allowedAgentJudgmentPoints: ["Choose among explicitly supported accounts only when source evidence and the configured chart make the choice unambiguous.", "Propose a classification exception for HUMAN review; do not turn an unresolved judgment into a posting."],
    humanOnlyGates: [{ id: "classification-review", title: "Classification review", reason: "A human owns ambiguous classification and mixed-use allocation decisions.", operationIds: ["journal.post"], evidence: ["Human actor identity", "Source/evidence reference", "Reason for the selected classification"] }],
    blockerRemediation: [{ blocker: "UNINITIALIZED or UPDATE_REQUIRED", remediation: "Inspect database status, then use the explicit operator initialization or verified upgrade workflow." }, { blocker: "UNBALANCED_POSTING or invalid account scope", remediation: "Correct the explicit lines and BookSet scope; do not retry a changed payload under the same request ID." }],
    completionEvidence: commonEvidence,
    nextDrilldowns: [{ title: "Inspect period status", operationId: "period.status" }, { title: "Inspect bank reconciliation", operationId: "bank-reconciliation.status" }],
  }),
  guide({
    id: "bank-reconciliation", version: 1, title: "Bank reconciliation", summary: "Import bank evidence, inspect deterministic candidates, and confirm exact matches.", applicability: "A BookSet with an identified bank statement and explicit statement line scope.", requiredScope: "bookSet",
    preflightOperations: ["company.status", "bank-statement.list"],
    steps: [
      op("bank-statement.import", "Import statement", "bookSet", "Import with a stable request ID and preserve the source statement identity."),
      op("bank-match.candidates", "Inspect candidates", "bookSet", "Treat candidates as non-mutating suggestions; compare amount, date, currency, and source line."),
      op("bank-match.confirm", "Confirm exact match", "bookSet", "Submit only the exact statement line and target entry after the human confirmation gate."),
      op("bank-reconciliation.status", "Read reconciliation status", "bookSet", "Record matched, unmatched, and outstanding status for the explicit statement."),
    ],
    allowedAgentJudgmentPoints: ["Rank or explain deterministic candidates using the returned evidence, but never confirm a match on ranking alone.", "Suggest the next investigation for an unmatched line without inventing a document or counterparty."],
    humanOnlyGates: [{ id: "match-confirmation", title: "Match confirmation", reason: "A match changes reconciliation state and must bind a human decision to the exact plan and source line.", operationIds: ["bank-match.confirm"], evidence: ["Statement line ID and source hash", "Target entry ID", "Human actor and confirmation reason"] }],
    blockerRemediation: [{ blocker: "STALE_RECONCILIATION_PLAN or RECONCILIATION_CONFIRMATION_REQUIRED", remediation: "Regenerate candidates/status and obtain a fresh human confirmation for the exact line and target." }, { blocker: "Duplicate statement identity", remediation: "Inspect the existing statement and use its deterministic identity; do not import a changed file as a replay." }],
    completionEvidence: commonEvidence,
    nextDrilldowns: [{ title: "Inspect statement", operationId: "bank-statement.get" }, { title: "Inspect outstanding invoices", operationId: "invoice.outstanding" }],
  }),
  guide({
    id: "gst-gstr1-return", version: 1, title: "GST GSTR-1 return", summary: "Prepare and locally validate a source-linked GSTR-1 artifact from a READY snapshot.", applicability: "A GST-registered BookSet with an explicit registration, tax period, readiness snapshot, and verified schema pack.", requiredScope: "bookSet",
    statusFocus: ["gst", "compliance"], statusActionCodes: ["GST_ITC_REVIEW_REQUIRED", "GST_EXPORTED_NOT_SUBMITTED", "COMPLIANCE_OBLIGATION_OVERDUE"],
    preflightOperations: ["company.status", "gst.return.readiness-report"],
    steps: [
      op("gst.return.readiness-report", "Read GST readiness", "bookSet", "Require READY readiness and retain its exact snapshot identity before artifact work."),
      op("gst.gstr1-artifact.preview", "Preview artifact", "bookSet", "Preview against the exact readiness snapshot and schema pack; resolve every blocker before persistence."),
      op("gst.gstr1-artifact.prepare", "Prepare artifact", "bookSet", "Persist the immutable local JSON artifact with source and schema bindings."),
      op("gst.gstr1-artifact.validate", "Run local validation", "bookSet", "Run bounded local validation and retain diagnostics; local validity is not GSTN acceptance."),
      op("gst.gstr1-artifact.export", "Export review artifact", "bookSet", "Export only after human confirmation of the exact current LOCAL_VALID artifact."),
      external("gstn-submit", "Submit to GSTN", "bookSet", "EXTERNAL: government-portal submission and acknowledgement are outside this dispatcher; export never means submission."),
    ],
    allowedAgentJudgmentPoints: ["Group source-backed facts only when the deterministic readiness/artifact contract permits it.", "Surface missing source facts and schema blockers; never fill statutory fields from assumptions."],
    humanOnlyGates: [{ id: "gstr1-export", title: "GSTR-1 export approval", reason: "Export is an irreversible evidence handoff and must be human-approved.", operationIds: ["gst.gstr1-artifact.export"], evidence: ["Exact artifact hash", "Exact LOCAL_VALID validation hash", "Human actor and reason"] }],
    blockerRemediation: [{ blocker: "GST readiness is UNKNOWN, BLOCKED, or stale", remediation: "Resolve source-document and readiness blockers, then create a fresh preview." }, { blocker: "LOCAL_INVALID", remediation: "Follow deterministic JSON-pointer diagnostics; never describe the artifact as filed." }],
    completionEvidence: [...commonEvidence, "The artifact status is PREPARED or LOCAL_VALID/EXPORTED and explicitly states submitted=false."],
    nextDrilldowns: [{ title: "Show GSTR-1 artifact", operationId: "gst.gstr1-artifact.show" }, { title: "Government submission", marker: "EXTERNAL", reason: "Use the separately controlled official portal workflow." }],
  }),
  guide({
    id: "tds-tcs-bookkeeping", version: 1, title: "TDS/TCS bookkeeping", summary: "Maintain source-verified withholding context, inspect registers, and record deposits with evidence.", applicability: "A BookSet whose tenant has explicit deductor and party tax facts; statutory rules remain source-linked.", requiredScope: "bookSet",
    statusFocus: ["tds-tcs", "compliance"], statusActionCodes: ["TDS_TCS_SOURCE_OR_DEPOSIT_BLOCKED", "TDS_TCS_STATEMENT_FOLLOW_UP", "TDS_TCS_EXPORTED_NOT_SUBMITTED"],
    preflightOperations: ["company.status", "tax.register.tds", "tax.register.tcs"],
    steps: [
      op("tax.rule-snapshot.create", "Record rule snapshot", "tenant", "Record an immutable source-backed rule snapshot at tenant scope; unverified rules must not drive posting."),
      op("invoice.post", "Post withholding-bearing sale", "bookSet", "Post an explicit invoice payload only when applicable tax facts and accounts are known."),
      op("bill.post", "Post withholding-bearing purchase", "bookSet", "Post an explicit bill payload only when applicable tax facts and accounts are known."),
      op("tax.register.tds", "Read TDS register", "bookSet", "Inspect outstanding and deposited TDS events in explicit scope."),
      op("tax.register.tcs", "Read TCS register", "bookSet", "Inspect outstanding and deposited TCS events in explicit scope."),
      op("tax.deposit", "Record deposit evidence", "bookSet", "Record a deposit and allocate it only to exact outstanding events with challan evidence."),
      notImplemented("statutory-return", "Generate statutory TDS/TCS return", "bookSet", "NOT_IMPLEMENTED: no statutory TDS/TCS return-generation operation exists in the live catalog."),
      external("portal-remittance", "Complete portal remittance", "bookSet", "EXTERNAL: bank payment, portal upload, and government acknowledgement are outside this system."),
    ],
    allowedAgentJudgmentPoints: ["Propose a source-backed rule or party classification for human review; never infer a rate or threshold.", "Explain a register exception from returned evidence without changing the liability."],
    humanOnlyGates: [{ id: "withholding-rule-review", title: "Withholding rule review", reason: "A human verifies the applicable source and rule snapshot before tax-bearing posting.", operationIds: ["tax.rule-snapshot.create", "invoice.post", "bill.post"], evidence: ["Source version/hash", "Applicability facts", "Human review reason"] }, { id: "deposit-approval", title: "Deposit approval", reason: "A human owns payment/challan evidence and allocation approval.", operationIds: ["tax.deposit"], evidence: ["Challan or bank evidence reference", "Allocated event IDs", "Human actor"] }],
    blockerRemediation: [{ blocker: "Rule applicability UNKNOWN or unverified", remediation: "Collect source-linked facts and human verification; do not default to a rate." }, { blocker: "Outstanding amount or allocation mismatch", remediation: "Re-read the register and allocate only the exact outstanding amount." }],
    completionEvidence: commonEvidence,
    nextDrilldowns: [{ title: "Inspect TDS register", operationId: "tax.register.tds" }, { title: "Statutory return generation", marker: "NOT_IMPLEMENTED", reason: "No live catalog operation exists." }],
  }),
  guide({
    id: "payroll-run", version: 1, title: "Payroll run", summary: "Prepare, approve, post, and inspect a frozen payroll run with explicit rule and claim gates.", applicability: "A payroll-enabled BookSet with employees, effective salary versions, payable-day facts, and source-backed rules.", requiredScope: "bookSet",
    preflightOperations: ["company.status", "payroll.employee.list", "payroll.register"],
    steps: [
      op("payroll.employee.list", "Read employee scope", "bookSet", "Confirm the explicit employee set and effective employment data."),
      op("payroll.pay-run.prepare", "Prepare frozen run", "bookSet", "Supply explicit payable-day facts, salary versions, and rule snapshots; retain the calculation hash."),
      op("payroll.pay-run.approve", "Approve run", "bookSet", "Human approves the exact frozen run after pending claims and rule blockers are resolved."),
      op("payroll.pay-run.post", "Post payroll", "bookSet", "Post only the approved frozen run and retain journal and payslip identities."),
      op("payroll.register", "Read payroll register", "bookSet", "Inspect deterministic register output for the exact period."),
      op("payroll.payslip.list", "Read payslips", "bookSet", "Retain immutable payslip export metadata; PDF rendering is not claimed."),
      op("payroll.bank-export.create", "Create bank export", "bookSet", "Create the generic export artifact; it does not submit payment."),
      external("bank-payment", "Submit employee payment", "bookSet", "EXTERNAL: bank upload, authorization, and payment acknowledgement are outside this system."),
    ],
    allowedAgentJudgmentPoints: ["Suggest missing claim evidence or rule inputs; never alter frozen calculation facts silently.", "Explain a payroll variance using register and payslip evidence."],
    humanOnlyGates: [{ id: "payroll-approval", title: "Payroll approval", reason: "Approval commits the exact frozen payroll calculation for posting.", operationIds: ["payroll.pay-run.approve"], evidence: ["Calculation hash", "Claim/rule blocker summary", "Human actor and approval reason"] }, { id: "payroll-posting", title: "Payroll posting", reason: "Posting creates immutable accounting and payslip records.", operationIds: ["payroll.pay-run.post"], evidence: ["Approved run ID", "Calculation hash", "Human actor"] }],
    blockerRemediation: [{ blocker: "Pending claim or unresolved rule", remediation: "Review or reject the claim and provide a verified current rule snapshot before preparing again." }, { blocker: "Bank export submitted=true", remediation: "This system only creates export artifacts; inspect the artifact and use the controlled external bank process." }],
    completionEvidence: [...commonEvidence, "The bank export explicitly remains an export artifact and not a payment submission."],
    nextDrilldowns: [{ title: "Inspect payroll register", operationId: "payroll.register" }, { title: "Inspect payslips", operationId: "payroll.payslip.list" }],
  }),
  guide({
    id: "period-close-and-ca-pack", version: 1, title: "Period close and CA pack", summary: "Preview a close plan, preserve reports, produce a close pack, and human-confirm period closure.", applicability: "A BookSet with an explicit inclusive period and all required source/reconciliation evidence available for review.", requiredScope: "bookSet",
    statusFocus: ["period-close", "journal-reports", "compliance"], statusActionCodes: ["PERIOD_CLOSE_OR_PACK_STALE", "LEDGER_UNBALANCED", "COMPLIANCE_OBLIGATION_OVERDUE"],
    preflightOperations: ["company.status", "period.status", "period.close.preview"],
    steps: [
      op("period.close.preview", "Preview close plan", "bookSet", "Generate the current plan and retain its exact plan hash."),
      op("ledger.trial-balance", "Capture Trial Balance", "bookSet", "Capture the as-of report bound to the close period."),
      op("ledger.profit-and-loss", "Capture Profit and Loss", "bookSet", "Capture the exact period report and investigate material exceptions."),
      op("ledger.balance-sheet", "Capture Balance Sheet", "bookSet", "Capture the as-of report and confirm it reconciles to the Trial Balance."),
      op("report.close-pack.export", "Export CA close pack", "bookSet", "Persist the immutable neutral close pack with section hashes and explicit period status."),
      op("period.close", "Close period", "bookSet", "Human confirms the current plan hash and any explicit override evidence before closure."),
      external("ca-signoff", "CA review/sign-off", "bookSet", "EXTERNAL: professional CA review, signature, and delivery are outside the dispatcher."),
    ],
    allowedAgentJudgmentPoints: ["Prioritize deterministic exceptions for human review without changing their meaning.", "Suggest evidence gaps and next drilldowns; never assert CA sign-off."],
    humanOnlyGates: [{ id: "period-close", title: "Period close confirmation", reason: "Closure is an irreversible accounting boundary and requires current-plan human confirmation.", operationIds: ["period.close"], evidence: ["Current plan hash", "Override reason where applicable", "Human actor and confirmation"] }],
    blockerRemediation: [{ blocker: "Stale close plan", remediation: "Run period.close.preview again and compare the new hash before any confirmation." }, { blocker: "Open reconciliation or missing evidence", remediation: "Drill into the exact source operation and record evidence or a human override; never silently clear the finding." }],
    completionEvidence: commonEvidence,
    nextDrilldowns: [{ title: "Show close pack", operationId: "report.close-pack.get" }, { title: "CA sign-off", marker: "EXTERNAL", reason: "Use the controlled professional review process." }],
  }),
  guide({
    id: "personal-income-tax-return", version: 1, title: "Personal income-tax return", summary: "Build a source-linked personal-tax workpaper and local return artifact with human approvals and explicit submission boundaries.", applicability: "An individual TaxCase with explicit eligible BookSet membership, current source evidence, and verified authority/schema packs.", requiredScope: "taxCase",
    statusFocus: ["personal-tax", "tenant-pan"], statusActionCodes: ["PERSONAL_TAX_SOURCE_READINESS_UNKNOWN", "PERSONAL_TAX_EXPORTED_NOT_SUBMITTED", "TENANT_PAN_MISSING"],
    preflightOperations: ["company.status", "tax-case.status"],
    steps: [
      op("tax-case.filing-snapshot.preview", "Preview filing snapshot", "taxCase", "Preview the exact current books/source basis and resolve all blockers."),
      op("tax-case.filing-snapshot.seal", "Seal filing snapshot", "taxCase", "Human seals only the exact current candidate hash."),
      op("tax-case.position.preview", "Preview position worksheet", "taxCase", "Inspect the bounded workpaper; it is not a tax-law conclusion or return."),
      op("tax-case.position.generate", "Generate position worksheet", "taxCase", "Persist the immutable workpaper with exact snapshot bindings."),
      op("tax-case.itr-eligibility.evaluate", "Evaluate ITR eligibility", "taxCase", "Evaluate candidates with a verified authority pack; UNKNOWN must remain UNKNOWN."),
      op("tax-case.itr-form.select", "Select ITR form", "taxCase", "Human selects an eligible form by exact evaluation hash when a choice is required."),
      op("tax-case.computation.preview", "Preview computation", "taxCase", "Preview the bounded workpaper with exact current input bindings."),
      op("tax-case.computation.generate", "Generate computation workpaper", "taxCase", "Persist the immutable computation workpaper; it is not a filed return."),
      op("tax-case.computation.approve", "Approve computation", "taxCase", "Human approves the exact current computation hash."),
      op("tax-case.return-artifact.preview", "Preview return artifact", "taxCase", "Preview local mapped JSON from exact current upstream bindings."),
      op("tax-case.return-artifact.prepare", "Prepare local artifact", "taxCase", "Persist the immutable local artifact."),
      op("tax-case.return-artifact.validate", "Validate locally", "taxCase", "Persist local validation diagnostics; this is not official portal validation."),
      op("tax-case.return-artifact.export", "Export local artifact", "taxCase", "Human exports the exact current locally valid artifact."),
      external("income-tax-submit", "Submit income-tax return", "taxCase", "EXTERNAL: government-portal submission, verification, acknowledgement, and assessment are outside this dispatcher; export never means submission."),
    ],
    allowedAgentJudgmentPoints: ["Propose source facts and explain evidence gaps, while preserving review-required lifecycle states.", "Summarize candidate eligibility traces; never turn UNKNOWN into eligible or ineligible."],
    humanOnlyGates: [{ id: "snapshot-seal", title: "Snapshot seal", reason: "The human owns the exact books/source basis for the filing workpaper.", operationIds: ["tax-case.filing-snapshot.seal"], evidence: ["Candidate hash", "Source and ledger binding summary", "Human actor"] }, { id: "form-selection", title: "Form selection", reason: "The human selects among eligible forms when judgment is required.", operationIds: ["tax-case.itr-form.select"], evidence: ["Evaluation hash", "Selected form", "Human reason"] }, { id: "return-export", title: "Return artifact export", reason: "Export is a controlled handoff and does not submit to government.", operationIds: ["tax-case.return-artifact.export"], evidence: ["Artifact hash", "Latest local validation hash", "Human actor"] }],
    blockerRemediation: [{ blocker: "TaxCase, snapshot, or worksheet is stale", remediation: "Read the exact status, regenerate from current upstream evidence, and repeat the human gate." }, { blocker: "Eligibility UNKNOWN or missing verified authority/schema pack", remediation: "Collect and human-verify the missing evidence; never guess a form or rule." }],
    completionEvidence: [...commonEvidence, "The result is explicitly labeled a local workpaper/artifact and not a government submission."],
    nextDrilldowns: [{ title: "Show return artifact", operationId: "tax-case.return-artifact.show" }, { title: "Government submission", marker: "EXTERNAL", reason: "Use the separately controlled official portal workflow." }],
  }),
] as const;

const scopeRank: Record<RequiredScope, number> = { none: 0, tenant: 1, bookSet: 2, taxCase: 3 };
const statusFocusIds = new Set(["database", "tenant-bookset", "journal-reports", "ar", "ap", "bank", "gst", "tds-tcs", "fixed-assets", "fx", "payroll", "expenses", "compliance", "period-close", "tenant-pan", "personal-tax", "skills", "remote-mcp"]);
function issue(guideId: string, code: string, message: string): SkillValidationIssue { return { guideId, code, message }; }

export function validateSkillGuides(guides: readonly SkillGuide[] = SKILL_GUIDES): readonly SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];
  const ids = new Set<string>();
  const guideIds = new Set<string>();
  for (const item of guides) {
    if (ids.has(item.id)) issues.push(issue(item.id, "DUPLICATE_SKILL_ID", `Duplicate skill ID: ${item.id}`));
    ids.add(item.id);
    guideIds.add(item.id);
    if (!item.id || item.version < 1 || !item.title || !item.summary || !item.applicability) issues.push(issue(item.id, "INVALID_METADATA", "Skill metadata is incomplete."));
    if (item.humanOnlyGates.length === 0) issues.push(issue(item.id, "MISSING_HUMAN_GATE", "Every guide must declare at least one HUMAN-only gate."));
    for (const focus of item.statusFocus ?? []) if (!statusFocusIds.has(focus)) issues.push(issue(item.id, "MISSING_STATUS_FOCUS", `Missing status card focus: ${focus}`));
    if ((item.statusFocus?.length ?? 0) > 0 && (item.statusActionCodes?.length ?? 0) === 0) issues.push(issue(item.id, "MISSING_STATUS_ACTION_CODES", "Status-focused guides must declare exact action codes."));
    const operationReferences = [...item.preflightOperations, ...item.steps.flatMap((step) => step.operationId ? [step.operationId] : []), ...item.humanOnlyGates.flatMap((gate) => gate.operationIds), ...item.nextDrilldowns.flatMap((drilldown) => drilldown.operationId ? [drilldown.operationId] : [])];
    const uniqueReferences = [...new Set(operationReferences)];
    if (JSON.stringify(uniqueReferences) !== JSON.stringify(item.operationReferences)) issues.push(issue(item.id, "STALE_OPERATION_REFERENCES", "operationReferences does not match the ordered structured references."));
    for (const operationId of uniqueReferences) if (!findOperation(operationId)) issues.push(issue(item.id, "MISSING_OPERATION", `Missing operation: ${operationId}`));
    for (const step of item.steps) {
      if (step.kind === "OPERATION") {
        if (!step.operationId || step.marker) issues.push(issue(item.id, "INVALID_OPERATION_STEP", `Operation step ${step.id} must have only an operationId.`));
        const operation = step.operationId ? findOperation(step.operationId) : undefined;
        if (operation && operation.requiredScope !== step.scope) issues.push(issue(item.id, "INVALID_SCOPE_TRANSITION", `${step.id} declares ${step.scope} but ${step.operationId} requires ${operation.requiredScope}.`));
        if (operation && scopeRank[operation.requiredScope] > scopeRank[item.requiredScope]) issues.push(issue(item.id, "INVALID_SCOPE_TRANSITION", `${step.operationId} requires scope outside ${item.requiredScope}.`));
      } else if (step.marker !== step.kind || step.operationId || !step.reason) {
        issues.push(issue(item.id, "INVALID_EXTERNAL_STEP", `${step.id} must use a structured ${step.kind} marker, reason, and no operationId.`));
      }
      if (/https?:\/\/|\b(password|passwd|token|secret|credential|api[_ -]?key)\b/i.test(`${step.instruction} ${step.reason ?? ""}`)) issues.push(issue(item.id, "SENSITIVE_EXTERNAL_LITERAL", `External step ${step.id} contains a URL or credential-like literal.`));
    }
    for (const gate of item.humanOnlyGates) {
      if (!gate.id || !gate.title || !gate.reason || gate.evidence.length === 0) issues.push(issue(item.id, "INVALID_HUMAN_GATE", `Human gate ${gate.id} is incomplete.`));
      for (const operationId of gate.operationIds) if (!findOperation(operationId)) issues.push(issue(item.id, "MISSING_OPERATION", `Human gate references missing operation: ${operationId}`));
    }
    for (const drilldown of item.nextDrilldowns) if (drilldown.marker && drilldown.operationId) issues.push(issue(item.id, "INVALID_DRILLDOWN", `Drilldown ${drilldown.title} cannot be both external and an operation.`));
  }
  if (guideIds.size !== guides.length) issues.push(issue("registry", "DUPLICATE_SKILL_ID", "Skill registry contains duplicate IDs."));
  return issues;
}

export function findSkillGuide(id: string): SkillGuide | undefined { return SKILL_GUIDES.find((item) => item.id === id); }

export function checkSkillGuide(item: SkillGuide): SkillCheckReport {
  const validation = validateSkillGuides([item]).filter((entry) => entry.guideId === item.id || entry.guideId === "registry");
  const missingOperationIds = item.operationReferences.filter((operationId) => !findOperation(operationId));
  const externalStepIds = item.steps.filter((step) => step.kind === "EXTERNAL").map((step) => step.id);
  const notImplementedStepIds = item.steps.filter((step) => step.kind === "NOT_IMPLEMENTED").map((step) => step.id);
  const invalidScopeTransitions = validation.filter((entry) => entry.code === "INVALID_SCOPE_TRANSITION").map((entry) => entry.message);
  const issues = [...new Set([...validation.map((entry) => entry.message), ...missingOperationIds.map((id) => `Missing operation: ${id}`)])];
  const status: SkillCheckStatus = issues.length > 0 ? "BROKEN" : externalStepIds.length > 0 || notImplementedStepIds.length > 0 ? "PARTIAL" : "READY";
  return { id: item.id, version: item.version, status, missingOperationIds: [...new Set(missingOperationIds)], externalStepIds, notImplementedStepIds, invalidScopeTransitions, issues };
}

export function listSkillGuides(): readonly Pick<SkillGuide, "id" | "version" | "title" | "summary" | "requiredScope">[] {
  return SKILL_GUIDES.map(({ id, version, title, summary, requiredScope }) => ({ id, version, title, summary, requiredScope }));
}

export function listOperations(): readonly Pick<OperationCatalogEntry, "id" | "description" | "sideEffect" | "requiredScope" | "transportPolicy">[] {
  return OPERATION_CATALOG.map(({ id, description, sideEffect, requiredScope, transportPolicy }) => ({ id, description, sideEffect, requiredScope, ...(transportPolicy ? { transportPolicy } : {}) }));
}

export function operationForDisplay(id: string): OperationCatalogEntry | undefined { return findOperation(id, true); }
