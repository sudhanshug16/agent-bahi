import { isAbsolute } from "node:path";
import { computeResultHash, canonicalJson } from "../application/commands.ts";
import { createSqliteApplication, initializeSqliteDatabase, inspectSqliteApplicationCompatibility, upgradeSqliteDatabase } from "../application/application.ts";
import type { PublicApplicationFacade } from "../application/public-facade.ts";
import { DomainError, brandAccountId, brandBookSetId, brandTenantId } from "../core/types.ts";
import { BUSINESS_OPERATION_CATALOG, findOperation } from "./catalog.ts";
import type { DispatchEnvelope } from "./types.ts";

type Input = Record<string, unknown>;
type Handler = (facade: PublicApplicationFacade, input: Input) => Promise<unknown>;

function text(input: Input, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_INPUT", `${name} must be a nonblank string`);
  return value;
}

function optionalText(input: Input, name: string): string | undefined {
  const value = input[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new DomainError("INVALID_INPUT", `${name} must be a nonblank string when supplied`);
  return value;
}

function tenantId(input: Input) { return brandTenantId(text(input, "tenantId")); }
function bookSetId(input: Input) { return brandBookSetId(text(input, "bookSetId")); }

const handlers: Record<string, Handler> = {
  "tenant.get": (facade, input) => facade.tenant.getTenant(tenantId(input)),
  "tenant.list-active": (facade) => facade.tenant.listActiveTenants(),
  "tenant.create": (facade, input) => facade.tenant.create(input as never),
  "tenant.activate": (facade, input) => facade.tenant.activate(input as never),
  "tenant.pan.get": (facade, input) => facade.tenant.pan.get(tenantId(input)),
  "tenant.pan.reveal": (facade, input) => facade.tenant.pan.reveal(tenantId(input)),
  "tenant.pan.set": (facade, input) => facade.tenant.pan.set(input as never),
  "book-set.get-default": (facade, input) => facade.bookSet.getDefault(tenantId(input)),
  "book-set.get": (facade, input) => facade.bookSet.getById(bookSetId(input), tenantId(input)),
  "book-set.list": (facade, input) => facade.bookSet.listByTenant(tenantId(input)),
  "book-set.create": (facade, input) => facade.bookSet.create(input as never),
  "book-set.set-default": (facade, input) => facade.bookSet.setDefault(input as never),
  "book-set.archive": (facade, input) => facade.bookSet.archive(input as never),
  "account.get": (facade, input) => facade.account.getById(brandAccountId(text(input, "accountId")), tenantId(input), bookSetId(input)),
  "account.get-by-code": (facade, input) => facade.account.getByCode(text(input, "code"), tenantId(input), bookSetId(input)),
  "account.list": (facade, input) => facade.account.listByBookSet(tenantId(input), bookSetId(input)),
  "book-set.scope.resolve": (facade, input) => facade.bookSetScope.resolve(tenantId(input), optionalText(input, "bookSetId") ? { bookSetId: bookSetId(input) } : undefined),
  "journal.post": (facade, input) => facade.journal.post(input as never),
  "ledger.trial-balance": (facade, input) => facade.ledger.trialBalance(tenantId(input), bookSetId(input), text(input, "asOfDate")),
  "ledger.profit-and-loss": (facade, input) => facade.ledger.profitAndLoss(tenantId(input), bookSetId(input), text(input, "fromDate"), text(input, "toDate")),
  "ledger.balance-sheet": (facade, input) => facade.ledger.balanceSheet(tenantId(input), bookSetId(input), text(input, "asOfDate")),
  "period.close.preview": (facade, input) => facade.periodClose.preview(tenantId(input), bookSetId(input), text(input, "periodStart"), text(input, "periodEnd")),
  "period.close": (facade, input) => facade.periodClose.close(input as never),
  "period.reopen.preview": (facade, input) => facade.periodClose.reopenPreview(tenantId(input), bookSetId(input), text(input, "periodStart"), text(input, "periodEnd")),
  "period.reopen": (facade, input) => facade.periodClose.reopen(input as never),
  "period.status": (facade, input) => facade.periodClose.status(tenantId(input), bookSetId(input)),
  "party.create": (facade, input) => facade.party.create(input as never),
  "invoice.create": (facade, input) => facade.invoice.create(input as never),
  "invoice.post": (facade, input) => facade.invoice.post(input as never),
  "invoice.get": (facade, input) => facade.invoice.get(tenantId(input), bookSetId(input), text(input, "invoiceId")),
  "invoice.outstanding": (facade, input) => facade.invoice.outstanding(tenantId(input), bookSetId(input)),
  "receipt.record": (facade, input) => facade.receipt.record(input as never),
  "bill.create": (facade, input) => facade.bill.create(input as never),
  "bill.post": (facade, input) => facade.bill.post(input as never),
  "bill.get": (facade, input) => facade.bill.get(tenantId(input), bookSetId(input), text(input, "billId")),
  "bill.outstanding": (facade, input) => facade.bill.outstanding(tenantId(input), bookSetId(input)),
  "vendor-payment.record": (facade, input) => facade.vendorPayment.record(input as never),
  "bank-statement.import": (facade, input) => facade.bankStatement.import(input as never),
  "bank-statement.get": (facade, input) => facade.bankStatement.get(tenantId(input), bookSetId(input), text(input, "statementId")),
  "bank-statement.list": (facade, input) => facade.bankStatement.list(tenantId(input), bookSetId(input), optionalText(input, "statementId") ? { statementId: optionalText(input, "statementId") } : undefined),
  "bank-match.confirm": (facade, input) => facade.bankMatch.confirm(input as never),
  "bank-match.undo": (facade, input) => facade.bankMatch.undo(input as never),
  "bank-match.candidates": (facade, input) => facade.bankMatch.candidates(tenantId(input), bookSetId(input), text(input, "statementLineId")),
  "bank-reconciliation.status": (facade, input) => facade.bankReconciliation.status(tenantId(input), bookSetId(input), text(input, "statementId")),
  "gst.registration.create": (facade, input) => facade.gst.registration.create(input as never),
  "gst.registration.get": (facade, input) => facade.gst.registration.get(tenantId(input), text(input, "registrationId")),
  "gst.registration.list": (facade, input) => facade.gst.registration.list(tenantId(input), optionalText(input, "date")),
  "gst.party-profile.create": (facade, input) => facade.gst.partyProfile.create(input as never),
  "gst.party-profile.list": (facade, input) => facade.gst.partyProfile.list(tenantId(input), bookSetId(input), text(input, "partyId"), optionalText(input, "date")),
  "gst.register.sales": (facade, input) => facade.gst.register.sales({ tenantId: tenantId(input), bookSetId: bookSetId(input), gstin: text(input, "gstin"), fromDate: optionalText(input, "fromDate"), toDate: optionalText(input, "toDate") }),
  "gst.register.purchases": (facade, input) => facade.gst.register.purchases({ tenantId: tenantId(input), bookSetId: bookSetId(input), gstin: text(input, "gstin"), fromDate: optionalText(input, "fromDate"), toDate: optionalText(input, "toDate") }),
  "gst.outward-facts.record": (facade, input) => facade.gst.returnReadiness.outwardFacts.record(input as never),
  "gst.outward-facts.get": (facade, input) => facade.gst.returnReadiness.outwardFacts.get(tenantId(input), bookSetId(input), text(input, "factsId")),
  "gst.outward-facts.list": (facade, input) => facade.gst.returnReadiness.outwardFacts.list(tenantId(input), bookSetId(input)),
  "gst.return.prepare": (facade, input) => facade.gst.returnReadiness.return.prepare(input as never),
  "gst.return.validate": (facade, input) => facade.gst.returnReadiness.return.validate(tenantId(input), bookSetId(input), text(input, "snapshotId"), text(input, "actorId")),
  "gst.return.export-review-pack": (facade, input) => facade.gst.returnReadiness.return.exportReviewPack(input as never),
  "gst.return.get": (facade, input) => facade.gst.returnReadiness.return.get(tenantId(input), bookSetId(input), text(input, "returnId")),
  "gst.return.list": (facade, input) => facade.gst.returnReadiness.return.list(tenantId(input), bookSetId(input)),
  "gst.return.record-observation": (facade, input) => facade.gst.returnReadiness.return.recordObservation(input as never),
  "gst.return.readiness-report": (facade, input) => facade.gst.returnReadiness.return.readinessReport(tenantId(input), bookSetId(input)),
  "compliance.fact-profile.create": (facade, input) => facade.compliance.factProfile.create(input as never),
  "compliance.fact-profile.get": (facade, input) => facade.compliance.factProfile.get(tenantId(input), bookSetId(input), text(input, "factProfileId")),
  "compliance.fact-profile.list": (facade, input) => facade.compliance.factProfile.list(tenantId(input), bookSetId(input)),
  "compliance.rule.create": (facade, input) => facade.compliance.rule.create(input as never),
  "compliance.rule.get": (facade, input) => facade.compliance.rule.get(tenantId(input), bookSetId(input), text(input, "ruleId")),
  "compliance.rule.list": (facade, input) => facade.compliance.rule.list(tenantId(input), bookSetId(input)),
  "compliance.deadline.create": (facade, input) => facade.compliance.deadline.create(input as never),
  "compliance.deadline.get": (facade, input) => facade.compliance.deadline.get(tenantId(input), bookSetId(input), text(input, "deadlineId")),
  "compliance.deadline.list": (facade, input) => facade.compliance.deadline.list(tenantId(input), bookSetId(input), { fromDate: optionalText(input, "fromDate"), toDate: optionalText(input, "toDate"), code: optionalText(input, "code") }),
  "compliance.predecessor.create": (facade, input) => facade.compliance.predecessor.create(input as never),
  "compliance.applicability.evaluate": (facade, input) => facade.compliance.applicability.evaluate(input as never),
  "compliance.applicability.get": (facade, input) => facade.compliance.applicability.get(tenantId(input), bookSetId(input), text(input, "decisionId")),
  "compliance.applicability.list": (facade, input) => facade.compliance.applicability.list(tenantId(input), bookSetId(input)),
  "compliance.obligation.generate": (facade, input) => facade.compliance.obligation.generate(input as never),
  "compliance.obligation.get": (facade, input) => facade.compliance.obligation.get(tenantId(input), bookSetId(input), text(input, "obligationId")),
  "compliance.obligation.list": (facade, input) => facade.compliance.obligation.list(tenantId(input), bookSetId(input), { status: optionalText(input, "status") as never, code: optionalText(input, "code") }),
  "compliance.obligation.calendar": (facade, input) => facade.compliance.obligation.calendar(tenantId(input), bookSetId(input), text(input, "fromDate"), text(input, "toDate"), text(input, "asOfDate"), { status: optionalText(input, "status") as never, code: optionalText(input, "code") }),
  "compliance.artifact.attach": (facade, input) => facade.compliance.artifact.attach(input as never),
  "compliance.obligation.event": (facade, input) => facade.compliance.obligation.event(input as never),
  "compliance.status": (facade, input) => facade.compliance.status(tenantId(input), bookSetId(input), text(input, "asOfDate")),
  "tax.deductor-profile.create": (facade, input) => facade.tax.deductorProfile.create(input as never),
  "tax.deductor-profile.list": (facade, input) => facade.tax.deductorProfile.list(tenantId(input), optionalText(input, "date")),
  "tax.party-profile.create": (facade, input) => facade.tax.partyProfile.create(input as never),
  "tax.party-profile.list": (facade, input) => facade.tax.partyProfile.list(tenantId(input), bookSetId(input), text(input, "partyId"), optionalText(input, "date")),
  "tax.rule-snapshot.create": (facade, input) => facade.tax.ruleSnapshot.create(input as never),
  "tax.deposit": (facade, input) => facade.tax.deposit(input as never),
  "tax.register.tds": (facade, input) => facade.tax.register(tenantId(input), bookSetId(input), "TDS"),
  "tax.register.tcs": (facade, input) => facade.tax.register(tenantId(input), bookSetId(input), "TCS"),
  "asset.register": (facade, input) => facade.fixedAssets.register(input as never),
  "asset.depreciation.preview": (facade, input) => facade.fixedAssets.depreciation.preview(input as never),
  "asset.depreciation.post": (facade, input) => facade.fixedAssets.depreciation.post(input as never),
  "asset.tax-rule.create": (facade, input) => facade.fixedAssets.taxRule.create(input as never),
  "asset.tax-block.register": (facade, input) => facade.fixedAssets.taxBlock.register(input as never),
  "asset.tax.compute": (facade, input) => facade.fixedAssets.tax.compute(input as never),
  "asset.dispose": (facade, input) => facade.fixedAssets.dispose(input as never),
  "asset.register.report": (facade, input) => facade.fixedAssets.reports.register(tenantId(input), bookSetId(input), optionalText(input, "asOfDate")),
  "asset.depreciation.report": (facade, input) => facade.fixedAssets.reports.depreciation(tenantId(input), bookSetId(input), text(input, "periodStart"), text(input, "periodEnd")),
  "asset.tax.report": (facade, input) => facade.fixedAssets.reports.tax(tenantId(input), bookSetId(input), text(input, "periodStart"), text(input, "periodEnd")),
  "asset.reconciliation.report": (facade, input) => facade.fixedAssets.reports.reconciliation(tenantId(input), bookSetId(input), text(input, "periodStart"), text(input, "periodEnd")),
  "currency.register": (facade, input) => facade.fx.currency.register(input as never),
  "fx.rate.create": (facade, input) => facade.fx.rate.create(input as never),
  "fx.exposure.report": (facade, input) => facade.fx.exposure(tenantId(input), bookSetId(input)),
  "fx.revaluation-policy.create": (facade, input) => facade.fx.revaluation.policy(input as never),
  "fx.revaluation.post": (facade, input) => facade.fx.revaluation.post(input as never),
  "fx.revaluation.reverse": (facade, input) => facade.fx.revaluation.reverse(input as never),
  "company.status": (facade, input) => facade.company.status({
    ...(optionalText(input, "tenantId") ? { tenantId: brandTenantId(optionalText(input, "tenantId")!) } : {}),
    ...(optionalText(input, "bookSetId") ? { bookSetId: brandBookSetId(optionalText(input, "bookSetId")!) } : {}),
    ...(optionalText(input, "asOfDate") ? { asOfDate: optionalText(input, "asOfDate") } : {}),
  }),
  "expense.claimant.create": (facade, input) => facade.expense.claimant.create(input as never),
  "expense.claimant.get": (facade, input) => facade.expense.claimant.get(tenantId(input), bookSetId(input), text(input, "claimantId")),
  "expense.claimant.list": (facade, input) => facade.expense.claimant.list(tenantId(input), bookSetId(input)),
  "expense.claim.create": (facade, input) => facade.expense.claim.create(input as never),
  "expense.claim.submit": (facade, input) => facade.expense.claim.submit(input as never),
  "expense.claim.review": (facade, input) => facade.expense.claim.review(input as never),
  "expense.claim.post": (facade, input) => facade.expense.claim.post(input as never),
  "expense.claim.get": (facade, input) => facade.expense.claim.get(tenantId(input), bookSetId(input), text(input, "claimId")),
  "expense.claim.list": (facade, input) => facade.expense.claim.list(tenantId(input), bookSetId(input)),
  "expense.advance.issue": (facade, input) => facade.expense.advance.issue(input as never),
  "expense.advance.get": (facade, input) => facade.expense.advance.get(tenantId(input), bookSetId(input), text(input, "advanceId")),
  "expense.advance.list": (facade, input) => facade.expense.advance.list(tenantId(input), bookSetId(input)),
  "expense.advance.repay": (facade, input) => facade.expense.advance.repay(input as never),
  "expense.reimbursement.record": (facade, input) => facade.expense.reimbursement.record(input as never),
  "expense.register": (facade, input) => facade.expense.register(tenantId(input), bookSetId(input)),
  "expense.open-items": (facade, input) => facade.expense.openItems(tenantId(input), bookSetId(input)),
  "expense.evidence-exceptions": (facade, input) => facade.expense.evidenceExceptions(tenantId(input), bookSetId(input)),
  "payroll.employee.create": (facade, input) => facade.payroll.employee.create(input as never),
  "payroll.employee.get": (facade, input) => facade.payroll.employee.get(tenantId(input), bookSetId(input), text(input, "employeeId")),
  "payroll.employee.list": (facade, input) => facade.payroll.employee.list(tenantId(input), bookSetId(input)),
  "payroll.employee-profile.create": (facade, input) => facade.payroll.employeeProfile.create(input as never),
  "payroll.salary-structure.create": (facade, input) => facade.payroll.salary.structure(input as never),
  "payroll.salary-version.create": (facade, input) => facade.payroll.salary.version(input as never, (input.payload as Record<string, unknown> | undefined)?.components as never),
  "payroll.rule-snapshot.create": (facade, input) => facade.payroll.ruleSnapshot.create(input as never),
  "payroll.claim.create": (facade, input) => facade.payroll.claim.create(input as never),
  "payroll.claim.review": (facade, input) => facade.payroll.claim.review(input as never),
  "payroll.pay-run.prepare": (facade, input) => facade.payroll.payRun.prepare(input as never),
  "payroll.pay-run.approve": (facade, input) => facade.payroll.payRun.approve(input as never),
  "payroll.pay-run.post": (facade, input) => facade.payroll.payRun.post(input as never),
  "payroll.register": (facade, input) => facade.payroll.register(tenantId(input), bookSetId(input), optionalText(input, "periodStart"), optionalText(input, "periodEnd")),
  "payroll.payslip.list": (facade, input) => facade.payroll.payslip.list(tenantId(input), bookSetId(input), optionalText(input, "payRunId")),
  "payroll.payment-batch.create": (facade, input) => facade.payroll.paymentBatch.create(input as never),
  "payroll.bank-export.create": (facade, input) => facade.payroll.paymentBatch.export(input as never),
  "payroll.remittance.create": (facade, input) => facade.payroll.remittance.create(input as never),
  "payroll.remittance.update": (facade, input) => facade.payroll.remittance.update(input as never),
  "report.close-pack.export": (facade, input) => facade.closePack.export(input as never),
  "report.close-pack.get": (facade, input) => facade.closePack.getManifest(tenantId(input), bookSetId(input), text(input, "manifestId")),
  "report.close-pack.section": (facade, input) => facade.closePack.getSection(tenantId(input), bookSetId(input), text(input, "manifestId"), text(input, "sectionName")),
  "tax-case.create": (facade, input) => facade.taxCase.create(input as never),
  "tax-case.membership.refresh": (facade, input) => facade.taxCase.membershipRefresh(input as never),
  "tax-case.status": (facade, input) => facade.taxCase.status(tenantId(input), text(input, "taxCaseId")),
  "tax-case.source.import": (facade, input) => facade.taxCase.source.import(input as never),
  "tax-case.source.list": (facade, input) => facade.taxCase.source.list(tenantId(input), text(input, "taxCaseId")),
  "tax-case.source.status": (facade, input) => facade.taxCase.source.status(tenantId(input), text(input, "taxCaseId"), text(input, "sourceId")),
  "tax-case.fact.propose": (facade, input) => facade.taxCase.fact.propose(input as never),
  "tax-case.fact.confirm": (facade, input) => facade.taxCase.fact.confirm(input as never),
  "tax-case.fact.reject": (facade, input) => facade.taxCase.fact.reject(input as never),
  "tax-case.fact.list": (facade, input) => facade.taxCase.fact.list(tenantId(input), text(input, "taxCaseId"), optionalText(input, "sourceId")),
  "tax-case.reconciliation.record": (facade, input) => facade.taxCase.reconciliation.record(input as never),
  "tax-case.reconciliation.list": (facade, input) => facade.taxCase.reconciliation.list(tenantId(input), text(input, "taxCaseId"), optionalText(input, "factId")),
  "tax-case.reconciliation.summary": (facade, input) => facade.taxCase.reconciliation.summary(tenantId(input), text(input, "taxCaseId")),
  "tax-case.filing-snapshot.preview": (facade, input) => facade.taxCase.filingSnapshot.preview(tenantId(input), text(input, "taxCaseId")),
  "tax-case.filing-snapshot.seal": (facade, input) => facade.taxCase.filingSnapshot.seal(input as never),
  "tax-case.filing-snapshot.show": (facade, input) => facade.taxCase.filingSnapshot.show(tenantId(input), text(input, "taxCaseId"), text(input, "snapshotId")),
  "tax-case.filing-snapshot.status": (facade, input) => facade.taxCase.filingSnapshot.status(tenantId(input), text(input, "taxCaseId"), text(input, "snapshotId")),
};

for (const entry of BUSINESS_OPERATION_CATALOG) {
  if (!handlers[entry.id]) throw new Error(`Operation catalog has no dispatcher handler: ${entry.id}`);
}

function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return value;
}

function inputObject(value: unknown): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("INVALID_INPUT", "Input must be a JSON object");
  return value as Input;
}

function validateRequired(operationId: string, input: Input): void {
  const operation = findOperation(operationId);
  for (const name of operation?.inputSchema.required ?? []) {
    if (input[name] === undefined || input[name] === null) throw new DomainError("INVALID_INPUT", `${name} is required`, { operationId, field: name });
  }
}

function errorEnvelope(operationId: string | undefined, error: unknown): DispatchEnvelope {
  const code = error instanceof DomainError ? error.code : error instanceof Error && /^([A-Z][A-Z0-9_]+)$/.test(error.name) ? error.name : "INTERNAL_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  const context = error instanceof DomainError ? error.context : undefined;
  return { ok: false, ...(operationId ? { operationId } : {}), error: { code, message, ...(context ? { details: jsonValue(context) as Record<string, unknown> } : {}) } };
}

function readinessError(operationId: string, status: string, requiredSchemaVersion: number): DispatchEnvelope {
  const code = status === "UNINITIALIZED" ? "UNINITIALIZED" : status === "UPDATE_REQUIRED" ? "UPDATE_REQUIRED" : "DATABASE_UNAVAILABLE";
  return { ok: false, operationId, error: { code, message: `Database is ${status}; normal business operations do not mutate it.`, details: { status, requiredSchemaVersion, remediation: code === "UNINITIALIZED" ? "Run database.init explicitly." : "Run database.upgrade with an explicit verified backup." } } };
}

export interface DispatcherOptions {
  readonly databasePath: string;
  readonly allowOperatorOperations?: boolean;
  readonly source?: "CLI" | "MCP";
}

export class OperationDispatcher {
  constructor(private readonly options: DispatcherOptions) {}

  async dispatch(operationId: string, rawInput: unknown): Promise<DispatchEnvelope> {
    const entry = findOperation(operationId, this.options.allowOperatorOperations ?? true);
    if (!entry) return errorEnvelope(operationId, new DomainError("UNKNOWN_OPERATION", `Unknown or unavailable operation: ${operationId}`));
    let input: Input;
    try {
      input = inputObject(rawInput);
      validateRequired(operationId, input);
      if (entry.operatorOnly) return this.dispatchOperator(entry.id, input);
      const compatibility = await inspectSqliteApplicationCompatibility(this.options.databasePath);
      if (compatibility.status !== "READY") return readinessError(operationId, compatibility.status, compatibility.requiredSchemaVersion);
      const facade = createSqliteApplication(this.options.databasePath);
      const commandResult = await handlers[operationId](facade, input);
      const isCommand = commandResult && typeof commandResult === "object" && "resultJson" in commandResult && "resultHash" in commandResult;
      const result = isCommand ? JSON.parse(String((commandResult as { resultJson: string }).resultJson)) : jsonValue(commandResult);
      const resultHash = isCommand ? String((commandResult as { resultHash: string }).resultHash) : computeResultHash(canonicalJson(result));
      return { ok: true, operationId, result, resultHash, ...((commandResult as { replayed?: boolean } | undefined)?.replayed !== undefined ? { replayed: (commandResult as { replayed?: boolean }).replayed } : {}) };
    } catch (error) {
      return errorEnvelope(operationId, error);
    }
  }

  private async dispatchOperator(operationId: string, input: Input): Promise<DispatchEnvelope> {
    if (!(this.options.allowOperatorOperations ?? true)) return errorEnvelope(operationId, new DomainError("OPERATOR_OPERATION_FORBIDDEN", "Operator database operations are not available through MCP"));
    try {
      if (operationId === "database.status") {
        const result = await inspectSqliteApplicationCompatibility(this.options.databasePath);
        return { ok: true, operationId, result, resultHash: computeResultHash(canonicalJson(result)) };
      }
      if (operationId === "database.init") {
        await initializeSqliteDatabase(this.options.databasePath, { cliVersion: "0.0.0-gate0", buildId: "cli-init" });
        const result = { initialized: true, compatibility: await inspectSqliteApplicationCompatibility(this.options.databasePath) };
        return { ok: true, operationId, result, resultHash: computeResultHash(canonicalJson(result)) };
      }
      const backupDestinationPath = text(input, "backupDestinationPath");
      if (!isAbsolute(backupDestinationPath)) throw new DomainError("INVALID_BACKUP_PATH", "backupDestinationPath must be absolute");
      await upgradeSqliteDatabase(this.options.databasePath, { backupDestinationPath, cliVersion: "0.0.0-gate0", buildId: "cli-upgrade" });
      const result = { upgraded: true, compatibility: await inspectSqliteApplicationCompatibility(this.options.databasePath) };
      return { ok: true, operationId, result, resultHash: computeResultHash(canonicalJson(result)) };
    } catch (error) {
      return errorEnvelope(operationId, error);
    }
  }
}
