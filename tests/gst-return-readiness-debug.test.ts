import { describe, it, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { initializeAndUpgradeSqliteApplication } from "../src/application/application.ts";
import { Database as BunDatabase } from "bun:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";

type TenantData = {
  tenantId: string;
  defaultBookSetId: string;
  seedAccountIds: { assets: string; cash: string; liabilities: string; equity: string; income: string; expenses: string };
};

describe("GST Return Readiness Debug", () => {
  it("debug: inspect seed accounts", async () => {
    const dbPath = join(tmpdir(), `gst-debug-${randomUUID()}.sqlite`);
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(tmpdir(), `gst-debug-backup-${randomUUID()}.sqlite`), cliVersion: "test", buildId: "gst-debug" });
    const created = await app.tenant.create({ schemaVersion: 1, tenantId: `gst-debug-${randomUUID()}` as never, requestId: "tenant", actor: { kind: "HUMAN", id: "creator" }, source: "CLI", reason: "gst debug", payload: { kind: "COMPANY", name: "GST debug" } });
    const tenant = JSON.parse(created.resultJson) as TenantData;

    console.log("=== SEED ACCOUNT IDS ===");
    console.log(JSON.stringify(tenant.seedAccountIds, null, 2));

    // Check what's actually in the database
    const db = new BunDatabase(dbPath, { readonly: true });
    try {
      const accounts = db.query("SELECT id, code, name, account_type FROM accounts WHERE tenant_id = ? AND book_set_id = ? ORDER BY code").all(tenant.tenantId, tenant.defaultBookSetId) as Array<{ id: string; code: string; name: string; account_type: string }>;
      console.log("=== ACCOUNTS IN DATABASE ===");
      for (const acc of accounts) {
        console.log(`${acc.code} - ${acc.name}: type=${acc.account_type}, id=${acc.id}`);
      }
    } finally {
      db.close();
    }

    new BunDatabase(dbPath).close();
  });
});
