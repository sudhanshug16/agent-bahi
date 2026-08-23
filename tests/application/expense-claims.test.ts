import { describe, expect, it } from "bun:test";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { Database as BunDatabase } from "bun:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function command(tenantId: string, bookSetId: string, requestId: string, actorId: string, payload: any) {
  return { schemaVersion: 1 as const, tenantId: tenantId as never, bookSetId: bookSetId as never, requestId, actor: { kind: "HUMAN" as const, id: actorId }, source: "CLI" as const, reason: "expense test", payload };
}

async function fixture() {
  const dbPath = join(tmpdir(), `expense-claims-${randomUUID()}.sqlite`);
  const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(tmpdir(), `expense-backup-${randomUUID()}.sqlite`), cliVersion: "test", buildId: "expense-test" });
  const created = await app.tenant.create({ schemaVersion: 1, tenantId: `expense-${randomUUID()}` as never, requestId: "tenant", actor: { kind: "HUMAN", id: "creator" }, source: "CLI", reason: "expense test", payload: { kind: "COMPANY", name: "Expense test" } });
  const tenant = JSON.parse(created.resultJson) as { tenantId: string; defaultBookSetId: string; seedAccountIds: { assets: string; cash: string; liabilities: string; expenses: string } };
  return { app, dbPath, tenant, env: (requestId: string, actorId: string, payload: unknown) => command(tenant.tenantId, tenant.defaultBookSetId, requestId, actorId, payload) };
}

describe("expense claims V1", () => {
  it("posts missing-receipt and mixed-use claims without posting the personal share", async () => {
    const f = await fixture();
    try {
      const claimant = await f.app.expense.claimant.create(f.env("claimant", "creator", { claimantType: "EMPLOYEE", displayName: "Asha" }));
      const claimantId = JSON.parse(claimant.resultJson).claimantId as string;
      const created = await f.app.expense.claim.create(f.env("claim", "creator", { claimantId, claimDate: "2026-08-23", reimbursementLiabilityAccountId: f.tenant.seedAccountIds.liabilities, lines: [{ description: "Mixed taxi", grossMinor: 1_000, businessMinor: 700, personalMinor: 300, expenseAccountId: f.tenant.seedAccountIds.expenses, evidenceStatus: "MISSING" }] }));
      const claimId = JSON.parse(created.resultJson).claimId as string;
      await f.app.expense.claim.submit(f.env("submit", "creator", { claimId }));
      await expect(f.app.expense.claim.review(f.env("review", "creator", { claimId, status: "APPROVED", observation: "Reviewed" }))).rejects.toMatchObject({ code: "INDEPENDENT_REVIEW_REQUIRED" });
      await f.app.expense.claim.review(f.env("review-independent", "reviewer", { claimId, status: "APPROVED", observation: "Reviewed allocation", allocationConfirmationFacts: { confirmedByOwner: true, basis: "explicit" } }));
      const posted = await f.app.expense.claim.post(f.env("post", "poster", { claimId }));
      expect(JSON.parse(posted.resultJson)).toMatchObject({ status: "POSTED", businessTotalMinor: 700 });
      const exceptions = await f.app.expense.evidenceExceptions(f.tenant.tenantId as never, f.tenant.defaultBookSetId as never);
      expect(exceptions).toHaveLength(1);
      const journal = new BunDatabase(f.dbPath, { readonly: true });
      try {
        const rows = journal.query("SELECT debit_minor, credit_minor FROM journal_lines WHERE journal_entry_id = ? ORDER BY debit_minor DESC").all(JSON.parse(posted.resultJson).journalId) as Array<{ debit_minor: number; credit_minor: number }>;
        expect(rows).toContainEqual({ debit_minor: 700, credit_minor: 0 });
        expect(rows).toContainEqual({ debit_minor: 0, credit_minor: 700 });
      } finally { journal.close(); }
      const mutable = new BunDatabase(f.dbPath);
      try {
        expect(() => mutable.query("UPDATE expense_claims SET narration = ? WHERE id = ?").run("tampered", JSON.parse(posted.resultJson).claimId)).toThrow();
        expect(() => mutable.query("UPDATE expense_claims SET status = 'DRAFT' WHERE id = ?").run(JSON.parse(posted.resultJson).claimId)).toThrow();
        expect(() => mutable.query("INSERT INTO expense_claim_lines (id, tenant_id, book_set_id, claim_id, line_number, description, gross_minor, business_minor, personal_minor, expense_account_id, evidence_id, evidence_status, explanation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)").run(randomUUID(), f.tenant.tenantId, f.tenant.defaultBookSetId, JSON.parse(posted.resultJson).claimId, 99, "tampered", 1, 1, 0, f.tenant.seedAccountIds.expenses, "MISSING", new Date().toISOString())).toThrow();
      } finally { mutable.close(); }
    } finally { new BunDatabase(f.dbPath).close(); }
  });

  it("settles a partial advance and reimbursement, rejecting over-allocation", async () => {
    const f = await fixture();
    try {
      const claimant = await f.app.expense.claimant.create(f.env("claimant", "creator", { claimantType: "OWNER", displayName: "Owner" }));
      const claimantId = JSON.parse(claimant.resultJson).claimantId as string;
      const advance = await f.app.expense.advance.issue(f.env("advance", "creator", { claimantId, issueDate: "2026-08-20", amountMinor: 1_000, advanceAssetAccountId: f.tenant.seedAccountIds.assets, bankAccountId: f.tenant.seedAccountIds.cash }));
      const advanceId = JSON.parse(advance.resultJson).advanceId as string;
      const claim = await f.app.expense.claim.create(f.env("claim", "creator", { claimantId, claimDate: "2026-08-23", reimbursementLiabilityAccountId: f.tenant.seedAccountIds.liabilities, lines: [{ description: "Travel", grossMinor: 2_000, businessMinor: 2_000, personalMinor: 0, expenseAccountId: f.tenant.seedAccountIds.expenses }] }));
      const claimId = JSON.parse(claim.resultJson).claimId as string;
      await f.app.expense.claim.submit(f.env("submit", "creator", { claimId }));
      await f.app.expense.claim.review(f.env("review", "reviewer", { claimId, status: "APPROVED", observation: "Approved" }));
      await f.app.expense.claim.post(f.env("post", "poster", { claimId, advanceAllocations: [{ advanceId, amountMinor: 1_000 }] }));
      await expect(f.app.expense.reimbursement.record(f.env("reimburse-too-much", "payer", { claimId, amountMinor: 1_001, bankAccountId: f.tenant.seedAccountIds.cash }))).rejects.toMatchObject({ code: "OVER_REIMBURSEMENT" });
      const paid = await f.app.expense.reimbursement.record(f.env("reimburse", "payer", { claimId, amountMinor: 1_000, bankAccountId: f.tenant.seedAccountIds.cash }));
      expect(JSON.parse(paid.resultJson).status).toBe("SETTLED");
      expect((await f.app.expense.advance.get(f.tenant.tenantId as never, f.tenant.defaultBookSetId as never, advanceId)).status).toBe("SETTLED");
    } finally { new BunDatabase(f.dbPath).close(); }
  });
});
