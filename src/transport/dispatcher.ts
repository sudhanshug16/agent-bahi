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
  "tax.deductor-profile.create": (facade, input) => facade.tax.deductorProfile.create(input as never),
  "tax.deductor-profile.list": (facade, input) => facade.tax.deductorProfile.list(tenantId(input), optionalText(input, "date")),
  "tax.party-profile.create": (facade, input) => facade.tax.partyProfile.create(input as never),
  "tax.party-profile.list": (facade, input) => facade.tax.partyProfile.list(tenantId(input), bookSetId(input), text(input, "partyId"), optionalText(input, "date")),
  "tax.rule-snapshot.create": (facade, input) => facade.tax.ruleSnapshot.create(input as never),
  "tax.deposit": (facade, input) => facade.tax.deposit(input as never),
  "tax.register.tds": (facade, input) => facade.tax.register(tenantId(input), bookSetId(input), "TDS"),
  "tax.register.tcs": (facade, input) => facade.tax.register(tenantId(input), bookSetId(input), "TCS"),
  "company.status": (facade, input) => facade.company.status({
    ...(optionalText(input, "tenantId") ? { tenantId: brandTenantId(optionalText(input, "tenantId")!) } : {}),
    ...(optionalText(input, "bookSetId") ? { bookSetId: brandBookSetId(optionalText(input, "bookSetId")!) } : {}),
    ...(optionalText(input, "asOfDate") ? { asOfDate: optionalText(input, "asOfDate") } : {}),
  }),
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
