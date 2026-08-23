import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { findOperation } from "../../src/transport/catalog.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

type TenantFixture = { tenantId: string; defaultBookSetId: string; seedAccountIds: { assets: string; cash: string; income: string; expenses: string; liabilities: string } };

describe("Neutral CA Close Pack V1", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function fixture() {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-close-pack-"));
    const dbPath = join(directory, "books.sqlite");
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "close-pack" });
    const created = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "close-pack-test" }, source: "INTERNAL", reason: "create close pack tenant", payload: { kind: "INDIVIDUAL", name: "Close Pack Co" } });
    const tenant = JSON.parse(created.resultJson) as TenantFixture;
    await app.tenant.activate({ schemaVersion: 1, tenantId: tenant.tenantId as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "close-pack-test" }, source: "INTERNAL", reason: "activate close pack tenant", payload: { defaultBookSetId: tenant.defaultBookSetId as any } });
    return { app, dbPath, tenant };
  }

  function envelope(tenant: TenantFixture, requestId: string = randomUUID()): any {
    return {
      schemaVersion: 1 as const,
      tenantId: tenant.tenantId as any,
      bookSetId: tenant.defaultBookSetId as any,
      requestId,
      actor: { kind: "AGENT" as const, id: "close-pack-agent" },
      source: "MCP" as const,
      reason: "quarterly close review",
      payload: { periodStart: "2026-01-01", periodEnd: "2026-03-31", asOfDate: "2026-03-31", basis: "ACCRUAL" as const },
    };
  }

  function scoped(tenant: TenantFixture, payload: unknown, requestId = randomUUID()): any {
    return { schemaVersion: 1, tenantId: tenant.tenantId, bookSetId: tenant.defaultBookSetId, requestId, actor: { kind: "HUMAN", id: "close-pack-fixture" }, source: "INTERNAL", reason: "close pack fixture", payload };
  }

  it("exports, gets, and reads sections through the public facade and dispatcher", async () => {
    const { app, dbPath, tenant } = await fixture();
    const exported = await app.closePack.export(envelope(tenant, "close-export"));
    const result = JSON.parse(exported.resultJson) as { manifestId: string; sectionNames: string[] };
    expect(result.sectionNames).toContain("trial_balance");
    expect(result.sectionNames).toContain("compliance_readiness_summary");
    expect(await app.closePack.getManifest(tenant.tenantId as any, tenant.defaultBookSetId as any, result.manifestId)).toMatchObject({ id: result.manifestId, scope: { tenantId: tenant.tenantId, bookSetId: tenant.defaultBookSetId } });
    expect(await app.closePack.getSection(tenant.tenantId as any, tenant.defaultBookSetId as any, result.manifestId, "trial_balance")).toContain("Account ID,Code,Name");

    for (const operationId of ["report.close-pack.export", "report.close-pack.get", "report.close-pack.section"]) {
      expect(findOperation(operationId)).toBeDefined();
    }
    const dispatcher = new OperationDispatcher({ databasePath: dbPath, source: "CLI" });
    const read = await dispatcher.dispatch("report.close-pack.get", { tenantId: tenant.tenantId, bookSetId: tenant.defaultBookSetId, manifestId: result.manifestId });
    expect(read).toMatchObject({ ok: true, operationId: "report.close-pack.get" });
    const section = await dispatcher.dispatch("report.close-pack.section", { tenantId: tenant.tenantId, bookSetId: tenant.defaultBookSetId, manifestId: result.manifestId, sectionName: "trial_balance" });
    expect(section).toMatchObject({ ok: true, operationId: "report.close-pack.section" });
  });

  it("scopes TDS checklist facts to the requested period and keeps empty facts unavailable", async () => {
    const { app, dbPath, tenant } = await fixture();
    const db = new Database(dbPath);
    db.query("INSERT INTO withholding_compliance_cases (id, tenant_id, book_set_id, tax_kind, period_start, period_end, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("tds-in", tenant.tenantId, tenant.defaultBookSetId, "TDS", "2026-01-01", "2026-03-31", "PREPARED", "2026-01-01", "2026-01-01");
    db.query("INSERT INTO withholding_compliance_cases (id, tenant_id, book_set_id, tax_kind, period_start, period_end, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("tds-out", tenant.tenantId, tenant.defaultBookSetId, "TDS", "2026-04-01", "2026-06-30", "PREPARED", "2026-04-01", "2026-04-01");
    db.close();

    const exported = await app.closePack.export(envelope(tenant, "close-period-scope"));
    const manifestId = (JSON.parse(exported.resultJson) as { manifestId: string }).manifestId;
    const summary = await app.closePack.getSection(tenant.tenantId as any, tenant.defaultBookSetId as any, manifestId, "compliance_readiness_summary");
    const checklist = await app.closePack.getSection(tenant.tenantId as any, tenant.defaultBookSetId as any, manifestId, "period_close_checklist");
    expect(summary).toContain("TDS/TCS Compliance,1,0,1,REVIEW_REQUIRED");
    expect(summary).not.toContain("TDS/TCS Compliance,2");
    expect(summary).toContain("GST Returns,0,0,0,NOT_AVAILABLE");
    expect(summary).toContain("Compliance Obligations,0,0,0,NOT_AVAILABLE");
    expect(checklist).toContain("TDS/TCS Cases Resolved,✗,1");
  });

  it("rejects an as-of date before period end before any writes", async () => {
    const { app, dbPath, tenant } = await fixture();
    await expect(app.closePack.export({ ...envelope(tenant, "close-invalid-as-of"), payload: { periodStart: "2026-01-01", periodEnd: "2026-03-31", asOfDate: "2026-03-30", basis: "ACCRUAL" } })).rejects.toMatchObject({ code: "INVALID_AS_OF_DATE", message: "asOfDate must be on or after periodEnd" });
    const db = new Database(dbPath, { readonly: true });
    expect(db.query("SELECT COUNT(*) AS count FROM close_pack_manifests").get()).toEqual({ count: 0 });
    expect(db.query("SELECT COUNT(*) AS count FROM audit_records WHERE action = 'CLOSE_PACK_EXPORT'").get()).toEqual({ count: 0 });
    db.close();
  });

  it("rejects impossible Gregorian dates before any Close Pack writes", async () => {
    const { app, dbPath, tenant } = await fixture();
    const invalidPayloads = [
      { periodStart: "2026-02-31", periodEnd: "2026-03-31", asOfDate: "2026-03-31", basis: "ACCRUAL" },
      { periodStart: "2026-02-01", periodEnd: "2026-02-29", asOfDate: "2026-03-01", basis: "ACCRUAL" },
      { periodStart: "2026-01-01", periodEnd: "2026-01-31", asOfDate: "2026-13-01", basis: "ACCRUAL" },
    ];
    for (const payload of invalidPayloads) {
      await expect(app.closePack.export({ ...envelope(tenant), payload })).rejects.toMatchObject({ code: "INVALID_DATE" });
    }
    const db = new Database(dbPath, { readonly: true });
    expect(db.query("SELECT COUNT(*) AS count FROM close_pack_manifests").get()).toEqual({ count: 0 });
    expect(db.query("SELECT COUNT(*) AS count FROM audit_records WHERE action = 'CLOSE_PACK_EXPORT'").get()).toEqual({ count: 0 });
    db.close();
  });

  it("preserves actor, source, reason, and one-row idempotent audit/export replay", async () => {
    const { app, dbPath, tenant } = await fixture();
    const first = await app.closePack.export(envelope(tenant, "close-replay"));
    const replay = await app.closePack.export(envelope(tenant, "close-replay"));
    expect(replay).toMatchObject({ replayed: true, resultJson: first.resultJson, resultHash: first.resultHash });
    const db = new Database(dbPath, { readonly: true });
    expect(db.query("SELECT COUNT(*) AS count FROM close_pack_manifests WHERE tenant_id = ? AND book_set_id = ?").get(tenant.tenantId, tenant.defaultBookSetId)).toEqual({ count: 1 });
    expect(db.query("SELECT COUNT(*) AS count FROM idempotency_records WHERE tenant_id = ? AND request_id = ?").get(tenant.tenantId, "close-replay")).toEqual({ count: 1 });
    expect(db.query("SELECT actor_type, actor_id, source, reason FROM audit_records WHERE action = 'CLOSE_PACK_EXPORT' AND request_id = ?").get("close-replay")).toEqual({ actor_type: "AGENT", actor_id: "close-pack-agent", source: "MCP", reason: "quarterly close review" });
    db.close();
  });

  it("keeps later settlements, 90/91 aging, bank-period rows, CSV quoting, manifest rehash, and BookSet isolation deterministic", async () => {
    const { app, dbPath, tenant } = await fixture();
    const customer = JSON.parse((await app.party.create(scoped(tenant, { displayName: "Aging Customer", role: "CUSTOMER" }))).resultJson) as { partyId: string };
    const createPostedInvoice = async (invoiceNumber: string, issueDate: string, dueDate: string) => {
      const created = await app.invoice.create(scoped(tenant, { invoiceNumber, customerId: customer.partyId, issueDate, dueDate, lines: [{ description: "Aging", revenueAccountId: tenant.seedAccountIds.income, amountMinor: 100 }] }));
      const draft = JSON.parse(created.resultJson) as { invoiceId: string };
      await app.invoice.post(scoped(tenant, { invoiceId: draft.invoiceId, receivableAccountId: tenant.seedAccountIds.assets }));
      return draft.invoiceId;
    };
    const settledLater = await createPostedInvoice("AGING-LATER", "2026-01-01", "2026-01-01");
    const aging90 = await createPostedInvoice("AGING-90", "2025-12-31", "2025-12-31");
    const aging91 = await createPostedInvoice("AGING-91", "2025-12-30", "2025-12-30");
    await app.receipt.record(scoped(tenant, { customerId: customer.partyId, receiptDate: "2026-04-01", bankAccountId: tenant.seedAccountIds.cash, allocations: [{ invoiceId: settledLater, amountMinor: 100 }] }));

    const db = new Database(dbPath);
    db.query("INSERT INTO accounts (id, tenant_id, book_set_id, code, name, account_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), tenant.tenantId, tenant.defaultBookSetId, "9,9", "Cr\rName", "EXPENSE", "2026-01-01", "2026-01-01");
    db.close();
    await app.bankStatement.import(scoped(tenant, { bankAccountId: tenant.seedAccountIds.cash, externalStatementId: "Q1", periodStart: "2026-01-01", periodEnd: "2026-03-31", openingBalanceMinor: 0, closingBalanceMinor: 100, rows: [{ lineNumber: 1, transactionDate: "2026-03-31", description: "Q1", signedAmountMinor: 100 }] }));
    await app.bankStatement.import(scoped(tenant, { bankAccountId: tenant.seedAccountIds.cash, externalStatementId: "Q2", periodStart: "2026-04-01", periodEnd: "2026-06-30", openingBalanceMinor: 100, closingBalanceMinor: 200, rows: [{ lineNumber: 1, transactionDate: "2026-04-01", description: "Q2", signedAmountMinor: 100 }] }));

    const first = await app.closePack.export(envelope(tenant, "close-aging-q1"));
    const firstManifest = JSON.parse(first.resultJson) as { manifestId: string; manifestHash: string };
    const firstAr = await app.closePack.getSection(tenant.tenantId as any, tenant.defaultBookSetId as any, firstManifest.manifestId, "ar_aging");
    expect(firstAr).toContain(settledLater);
    expect(firstAr).toContain(aging90);
    expect(firstAr).toContain("61_90");
    expect(firstAr).toContain(aging91);
    expect(firstAr).toContain("91_PLUS");
    expect(await app.closePack.getSection(tenant.tenantId as any, tenant.defaultBookSetId as any, firstManifest.manifestId, "bank_reconciliation_summary")).toContain(",0,100,0,1");
    const firstTrialBalance = await app.closePack.getSection(tenant.tenantId as any, tenant.defaultBookSetId as any, firstManifest.manifestId, "trial_balance");
    expect(firstTrialBalance).toContain("\"9,9\",\"Cr\rName\"");
    expect(firstTrialBalance).toContain("\r\n");

    const later = await app.closePack.export({ ...envelope(tenant, "close-aging-later"), payload: { periodStart: "2026-01-01", periodEnd: "2026-03-31", asOfDate: "2026-04-01", basis: "ACCRUAL" } });
    const laterId = (JSON.parse(later.resultJson) as { manifestId: string }).manifestId;
    expect(await app.closePack.getSection(tenant.tenantId as any, tenant.defaultBookSetId as any, laterId, "ar_aging")).not.toContain("AGING-LATER");
    expect(later.resultJson).not.toBe(first.resultJson);
    const second = await app.closePack.export(envelope(tenant, "close-aging-rehash"));
    expect((JSON.parse(second.resultJson) as { manifestHash: string }).manifestHash).toBe(firstManifest.manifestHash);

    const secondBookSet = JSON.parse((await app.bookSet.create({ schemaVersion: 1, tenantId: tenant.tenantId as any, requestId: "close-second-bookset", actor: { kind: "HUMAN", id: "close-pack-fixture" }, source: "INTERNAL", reason: "second BookSet", payload: { kind: "PROPRIETORSHIP", displayName: "Other Books" } })).resultJson) as { bookSetId: string };
    expect(await app.closePack.getManifest(tenant.tenantId as any, secondBookSet.bookSetId as any, firstManifest.manifestId)).toBeNull();
  });

  it("settles AP aging with withholding and bounds later cash settlement by as-of date", async () => {
    const { app, tenant } = await fixture();
    const vendor = JSON.parse((await app.party.create(scoped(tenant, { displayName: "AP Aging Vendor", role: "VENDOR" }))).resultJson) as { partyId: string };
    const withholdingRule = JSON.parse((await app.tax.ruleSnapshot.create({
      schemaVersion: 1, tenantId: tenant.tenantId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "close-pack-fixture" }, source: "INTERNAL", reason: "AP aging rule", payload: {
        taxKind: "TDS", sourceUrl: "https://www.incometaxindia.gov.in/w/section-393-5", sourceDocument: "Income-tax Act 2025", sourceVersion: "2026-04-01", sectionReference: "393", categoryCode: "AP-AGING", effectiveFrom: "2026-01-01", eventTiming: "CREDIT", rateBps: 1000, applicabilityFacts: { source: "close-pack" }, tanRequired: true, tanExceptionAllowed: false, statementRoute: "REVIEW_ONLY", statementForm: "NOT_CLAIMED", roundingMode: "HALF_UP", sourceVerified: true,
      },
    })).resultJson) as { ruleSnapshotId: string };
    const fullWithholdingRule = JSON.parse((await app.tax.ruleSnapshot.create({
      schemaVersion: 1, tenantId: tenant.tenantId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "close-pack-fixture" }, source: "INTERNAL", reason: "AP aging full withholding rule", payload: {
        taxKind: "TDS", sourceUrl: "https://www.incometaxindia.gov.in/w/section-393-5", sourceDocument: "Income-tax Act 2025", sourceVersion: "2026-04-01", sectionReference: "393", categoryCode: "AP-AGING-FULL", effectiveFrom: "2026-01-01", eventTiming: "CREDIT", rateBps: 10000, applicabilityFacts: { source: "close-pack" }, tanRequired: true, tanExceptionAllowed: false, statementRoute: "REVIEW_ONLY", statementForm: "NOT_CLAIMED", roundingMode: "HALF_UP", sourceVerified: true,
      },
    })).resultJson) as { ruleSnapshotId: string };
    const postBill = async (billNumber: string, ruleSnapshotId: string) => {
      const created = JSON.parse((await app.bill.create(scoped(tenant, { billNumber, vendorId: vendor.partyId, billDate: "2026-01-15", dueDate: "2026-01-31", lines: [{ description: billNumber, expenseAccountId: tenant.seedAccountIds.expenses, amountMinor: 1_000 }] }))).resultJson) as { billId: string };
      await app.bill.post(scoped(tenant, { billId: created.billId, payableAccountId: tenant.seedAccountIds.liabilities, withholding: { taxKind: "TDS", ruleSnapshotId, taxBaseMinor: 1_000, thresholdApplicabilityEvidenceReferences: [`evidence:${billNumber}`], liabilityAccountId: tenant.seedAccountIds.liabilities, calculationFacts: { roundingMode: "HALF_UP", basis: "credit" } } }));
      return created.billId;
    };
    const fullyWithheldId = await postBill("AP-FULL-WITHHELD", fullWithholdingRule.ruleSnapshotId);
    const settledByAsOfId = await postBill("AP-PARTIAL-BEFORE-ASOF", withholdingRule.ruleSnapshotId);
    const settledLaterId = await postBill("AP-PARTIAL-LATER", withholdingRule.ruleSnapshotId);
    await app.vendorPayment.record(scoped(tenant, { vendorId: vendor.partyId, paymentDate: "2026-03-31", bankAccountId: tenant.seedAccountIds.cash, allocations: [{ billId: settledByAsOfId, amountMinor: 900 }] }));
    await app.vendorPayment.record(scoped(tenant, { vendorId: vendor.partyId, paymentDate: "2026-04-01", bankAccountId: tenant.seedAccountIds.cash, allocations: [{ billId: settledLaterId, amountMinor: 900 }] }));

    const before = await app.closePack.export({ ...envelope(tenant, "close-ap-aging-before"), payload: { periodStart: "2026-01-01", periodEnd: "2026-03-31", asOfDate: "2026-03-31", basis: "ACCRUAL" } });
    const beforeId = (JSON.parse(before.resultJson) as { manifestId: string }).manifestId;
    const beforeAp = await app.closePack.getSection(tenant.tenantId as any, tenant.defaultBookSetId as any, beforeId, "ap_aging");
    expect(beforeAp).not.toContain(fullyWithheldId);
    expect(beforeAp).not.toContain(settledByAsOfId);
    expect(beforeAp).toContain(settledLaterId);
    expect(beforeAp).toContain(",900,");

    const after = await app.closePack.export({ ...envelope(tenant, "close-ap-aging-after"), payload: { periodStart: "2026-01-01", periodEnd: "2026-03-31", asOfDate: "2026-04-01", basis: "ACCRUAL" } });
    const afterId = (JSON.parse(after.resultJson) as { manifestId: string }).manifestId;
    const afterAp = await app.closePack.getSection(tenant.tenantId as any, tenant.defaultBookSetId as any, afterId, "ap_aging");
    expect(afterAp).not.toContain(fullyWithheldId);
    expect(afterAp).not.toContain(settledByAsOfId);
    expect(afterAp).not.toContain(settledLaterId);
  });
});
