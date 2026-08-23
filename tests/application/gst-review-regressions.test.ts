import { afterEach, describe, expect, it } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";

const GSTIN_27 = "27AAPFU0939F1ZV";

function envelope<T>(tenantId: string, bookSetId: string, payload: T, requestId = randomUUID()) {
  return { schemaVersion: 1 as const, tenantId: tenantId as any, bookSetId: bookSetId as any, requestId, actor: { kind: "HUMAN" as const, id: "review" }, source: "CLI" as const, reason: "GST review regression", payload };
}

describe("GST independent review regressions", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  async function fixture() {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-gst-review-"));
    const dbPath = join(directory, "books.sqlite");
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
    const tenant = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as any, requestId: randomUUID(), actor: { kind: "SYSTEM", id: "test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name: "GST Review Co", baseCurrency: "INR" } });
    const created = JSON.parse(tenant.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { assets: string; income: string; cash: string; expenses: string; liabilities: string } };
    const customer = await app.party.create(envelope(created.tenantId, created.defaultBookSetId, { displayName: "GST Customer", role: "CUSTOMER" }));
    const vendor = await app.party.create(envelope(created.tenantId, created.defaultBookSetId, { displayName: "GST Vendor", role: "VENDOR" }));
    return { app, dbPath, ...created, customerId: JSON.parse(customer.resultJson).partyId as string, vendorId: JSON.parse(vendor.resultJson).partyId as string };
  }

  async function registerAndProfile(f: Awaited<ReturnType<typeof fixture>>) {
    const registration = await f.app.gst.registration.create({ schemaVersion: 1, tenantId: f.tenantId as any, requestId: randomUUID(), actor: { kind: "HUMAN", id: "review" }, source: "CLI", reason: "registration", payload: { gstin: GSTIN_27, effectiveFrom: "2026-01-01" } });
    const registrationId = JSON.parse(registration.resultJson).registrationId as string;
    const profile = await f.app.gst.partyProfile.create(envelope(f.tenantId, f.defaultBookSetId, { partyId: f.customerId, gstin: GSTIN_27, treatment: "REGISTERED", stateCode: "27", effectiveFrom: "2026-01-01" }));
    const profileId = JSON.parse(profile.resultJson).profileId as string;
    return { registrationId, profileId };
  }

  it("uses a profile ID as an ID and rejects a registered GSTIN/state mismatch before mutation", async () => {
    const f = await fixture();
    const before = new BunDatabase(f.dbPath, { readonly: true, safeIntegers: true });
    const auditsBefore = Number((before.query("SELECT COUNT(*) AS count FROM audit_records").get() as { count: bigint }).count);
    before.close();
    await expect(f.app.gst.partyProfile.create(envelope(f.tenantId, f.defaultBookSetId, { partyId: f.customerId, gstin: GSTIN_27, treatment: "REGISTERED", stateCode: "29", effectiveFrom: "2026-01-01" }))).rejects.toMatchObject({ code: "GSTIN_STATE_MISMATCH" });
    const after = new BunDatabase(f.dbPath, { readonly: true, safeIntegers: true });
    expect(Number((after.query("SELECT COUNT(*) AS count FROM party_gst_profiles").get() as { count: bigint }).count)).toBe(0);
    expect(Number((after.query("SELECT COUNT(*) AS count FROM audit_records").get() as { count: bigint }).count)).toBe(auditsBefore);
    after.close();

    const { registrationId, profileId } = await registerAndProfile(f);
    const draft = await f.app.invoice.create(envelope(f.tenantId, f.defaultBookSetId, { invoiceNumber: "GST-ID", customerId: f.customerId, issueDate: "2026-08-23", lines: [{ description: "Zero-rated service", revenueAccountId: f.seedAccountIds.income, amountMinor: 10_000 }], gst: { sellerRegistrationId: registrationId, buyerProfileId: profileId, localComponent: "SGST", lines: [{ lineNumber: 1, classification: "9983", rateBps: 0, evidenceIds: ["evidence-1"] }] } }));
    const invoiceId = JSON.parse(draft.resultJson).invoiceId as string;
    await expect(f.app.invoice.post(envelope(f.tenantId, f.defaultBookSetId, { invoiceId, receivableAccountId: f.seedAccountIds.assets }))).resolves.toBeDefined();
  });

  it("requires exact GST line coverage and rolls back posting side effects", async () => {
    const f = await fixture();
    const { registrationId, profileId } = await registerAndProfile(f);
    const draft = await f.app.invoice.create(envelope(f.tenantId, f.defaultBookSetId, { invoiceNumber: "GST-COVERAGE", customerId: f.customerId, issueDate: "2026-08-23", lines: [{ description: "Service", revenueAccountId: f.seedAccountIds.income, amountMinor: 10_000 }], gst: { sellerRegistrationId: registrationId, buyerProfileId: profileId, localComponent: "SGST", lines: [{ lineNumber: 2, classification: "9983", rateBps: 1800, evidenceIds: ["evidence-1"] }] } }));
    const invoiceId = JSON.parse(draft.resultJson).invoiceId as string;
    await expect(f.app.invoice.post(envelope(f.tenantId, f.defaultBookSetId, { invoiceId, receivableAccountId: f.seedAccountIds.assets }))).rejects.toMatchObject({ code: "GST_LINE_FACT_REQUIRED" });
    const db = new BunDatabase(f.dbPath, { readonly: true, safeIntegers: true });
    expect(db.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual({ count: 0n });
    expect(db.query("SELECT COUNT(*) AS count FROM gst_tax_snapshots").get()).toEqual({ count: 0n });
    db.close();
  });

  it("keeps posted GST history stable and blocks source-fact mutation", async () => {
    const f = await fixture();
    const { registrationId, profileId } = await registerAndProfile(f);
    const draft = await f.app.invoice.create(envelope(f.tenantId, f.defaultBookSetId, { invoiceNumber: "GST-HISTORY", customerId: f.customerId, issueDate: "2026-08-23", lines: [{ description: "Service", revenueAccountId: f.seedAccountIds.income, amountMinor: 10_000 }], gst: { sellerRegistrationId: registrationId, buyerProfileId: profileId, localComponent: "SGST", lines: [{ lineNumber: 1, classification: "9983", rateBps: 0, evidenceIds: ["evidence-1"] }] } }));
    const invoiceId = JSON.parse(draft.resultJson).invoiceId as string;
    await f.app.invoice.post(envelope(f.tenantId, f.defaultBookSetId, { invoiceId, receivableAccountId: f.seedAccountIds.assets }));
    const before = await f.app.gst.register.sales({ tenantId: f.tenantId as any, bookSetId: f.defaultBookSetId as any, gstin: GSTIN_27 });
    expect(before).toHaveLength(1);
    const db = new BunDatabase(f.dbPath, { safeIntegers: true });
    expect(() => db.query("UPDATE gst_registrations SET state = '29' WHERE id = ?").run(registrationId)).toThrow();
    expect(() => db.query("DELETE FROM party_gst_profiles WHERE id = ?").run(profileId)).toThrow();
    db.close();
    await expect(f.app.gst.register.sales({ tenantId: f.tenantId as any, bookSetId: f.defaultBookSetId as any, gstin: GSTIN_27 })).resolves.toEqual(before);
  });

  it("rejects direct payment-status spoofing for invoices and bills", async () => {
    const f = await fixture();
    const invoice = await f.app.invoice.create(envelope(f.tenantId, f.defaultBookSetId, { invoiceNumber: "GST-PAY-INV", customerId: f.customerId, issueDate: "2026-08-23", lines: [{ description: "Service", revenueAccountId: f.seedAccountIds.income, amountMinor: 10_000 }] }));
    const invoiceId = JSON.parse(invoice.resultJson).invoiceId as string;
    await f.app.invoice.post(envelope(f.tenantId, f.defaultBookSetId, { invoiceId, receivableAccountId: f.seedAccountIds.assets }));
    const bill = await f.app.bill.create(envelope(f.tenantId, f.defaultBookSetId, { billNumber: "GST-PAY-BILL", vendorId: f.vendorId, billDate: "2026-08-23", lines: [{ description: "Expense", expenseAccountId: f.seedAccountIds.expenses, amountMinor: 10_000 }] }));
    const billId = JSON.parse(bill.resultJson).billId as string;
    await f.app.bill.post(envelope(f.tenantId, f.defaultBookSetId, { billId, payableAccountId: f.seedAccountIds.liabilities }));
    const db = new BunDatabase(f.dbPath, { safeIntegers: true });
    expect(() => db.query("UPDATE sales_invoices SET paid_minor = 1, status = 'PARTIALLY_PAID', updated_at = updated_at WHERE id = ?").run(invoiceId)).toThrow();
    expect(() => db.query("UPDATE vendor_bills SET paid_minor = 1, status = 'PARTIALLY_PAID', updated_at = updated_at WHERE id = ?").run(billId)).toThrow();
    db.close();
  });
});
