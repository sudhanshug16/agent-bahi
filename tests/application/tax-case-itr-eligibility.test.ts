import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSqliteApplication, initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

const envelope = (tenantId: string, requestId: string, payload: unknown, actor: "HUMAN" | "AGENT" = "HUMAN") => ({ schemaVersion: 1 as const, tenantId, requestId, actor: { kind: actor, id: actor.toLowerCase() }, source: "CLI" as const, reason: "TEST_ONLY authority pack fixture", payload }) as any;
const artifacts = ["LAW", "RULES", "SCHEMA", "INSTRUCTION"].map((kind) => ({ kind, sourceUrl: "https://example.invalid/test-only", sourceTitle: "TEST_ONLY authority artifact", officialReleaseIdentifier: "TEST_ONLY", officialReleaseDate: "2024-04-01", sha256: "a".repeat(64) }));
const packPayload = (ruleAst: unknown) => ({ jurisdiction: "IN" as const, authority: "INCOME_TAX" as const, financialYear: "2024-25", assessmentYear: "2025-26", filingTypes: ["ORIGINAL"], effectiveFrom: "2024-04-01", releasedAt: "2024-04-01", releaseIdentifier: "TEST_ONLY", artifactReferences: artifacts, packVersion: "TEST_ONLY-1", candidateForms: ["ITR-1"], ruleAst });

describe("Personal Tax ITR Eligibility Authority Pack V1", () => {
  test("registers and human-verifies an immutable TEST_ONLY pack with shared CLI/MCP show", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-itr-pack-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") });
      const tenant = JSON.parse((await app.tenant.create(envelope("bootstrap", "tenant", { kind: "INDIVIDUAL", name: "TEST_ONLY taxpayer" }))).resultJson);
      const payload = packPayload({ forms: [{ form: "ITR-1", rule: { op: "int_cmp", field: "total_income_minor", comparator: "lte", value: "500000" } }] });
      const registered = JSON.parse((await app.taxAuthority.pack.register(envelope(tenant.tenantId, "pack-register", payload, "AGENT"))).resultJson);
      expect(registered.lifecycle).toBe("PROPOSED"); expect(registered.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
      await expect(app.taxAuthority.pack.verify(envelope(tenant.tenantId, "pack-agent-verify", { packId: registered.packId, expectedPackHash: registered.canonicalHash, reason: "agent cannot verify" }, "AGENT"))).rejects.toMatchObject({ code: "AUTHORITY_PACK_HUMAN_REQUIRED" });
      const verified = JSON.parse((await app.taxAuthority.pack.verify(envelope(tenant.tenantId, "pack-verify", { packId: registered.packId, expectedPackHash: registered.canonicalHash, reason: "human verified TEST_ONLY fixture" }))).resultJson);
      expect(verified.lifecycle).toBe("HUMAN_VERIFIED");
      const cli = await new OperationDispatcher({ databasePath: dbPath, source: "CLI", allowOperatorOperations: false }).dispatch("tax-authority.pack.show", { packId: registered.packId });
      const mcp = await new OperationDispatcher({ databasePath: dbPath, source: "MCP", allowOperatorOperations: false }).dispatch("tax-authority.pack.show", { packId: registered.packId });
      expect(cli).toEqual(mcp); expect((cli as { result: { lifecycle: string } }).result.lifecycle).toBe("HUMAN_VERIFIED");
      const native = new Database(dbPath); expect(() => native.query("UPDATE personal_tax_authority_packs SET pack_version = pack_version WHERE id = ?").run(registered.packId)).toThrow(); expect(() => native.query("DELETE FROM personal_tax_authority_packs WHERE id = ?").run(registered.packId)).toThrow(); native.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("rejects unknown operators, undeclared fields, and excessive AST depth before persistence", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-itr-pack-invalid-")); const dbPath = join(directory, "books.sqlite");
    try {
      const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite") }); const tenant = JSON.parse((await app.tenant.create(envelope("bootstrap", "tenant", { kind: "INDIVIDUAL", name: "TEST_ONLY taxpayer" }))).resultJson);
      await expect(app.taxAuthority.pack.register(envelope(tenant.tenantId, "bad-op", packPayload({ forms: [{ form: "ITR-1", rule: { op: "eval", field: "is_resident" } }] }), "AGENT"))).rejects.toMatchObject({ code: "INVALID_ITR_RULE_OPERATOR" });
      await expect(app.taxAuthority.pack.register(envelope(tenant.tenantId, "bad-field", packPayload({ forms: [{ form: "ITR-1", rule: { op: "eq", field: "untrusted_field", value: true } }] }), "AGENT"))).rejects.toMatchObject({ code: "INVALID_ITR_RULE_FIELD" });
      let rule: any = { op: "fact", field: "is_resident", test: "exists" }; for (let index = 0; index < 13; index += 1) rule = { op: "not", rule };
      await expect(app.taxAuthority.pack.register(envelope(tenant.tenantId, "bad-depth", packPayload({ forms: [{ form: "ITR-1", rule }] }), "AGENT"))).rejects.toMatchObject({ code: "ITR_RULE_AST_DEPTH_EXCEEDED" });
      const native = new Database(dbPath, { safeIntegers: true }); expect(native.query("SELECT COUNT(*) AS count FROM personal_tax_authority_packs").get()).toEqual({ count: 0n }); native.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
