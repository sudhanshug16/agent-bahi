import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Database as BunDatabase } from "bun:sqlite";
import { initializeAndUpgradeSqliteApplication } from "../../src/application/application.ts";

const PAN_A = "ABCDE1234F";
const PAN_B = "PQRSX9876L";
const hash = (pan: string) => createHash("sha256").update(pan).digest("hex");

describe("tenant PAN V1", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function fixture() {
    directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "agent-bahi-tenant-pan-"));
    const dbPath = join(directory, "books.sqlite");
    const app = await initializeAndUpgradeSqliteApplication(dbPath, { backupDestinationPath: join(directory, "bootstrap.sqlite"), cliVersion: "test", buildId: "tenant-pan" });
    return { app, dbPath };
  }

  function envelope(tenantId: string, requestId: string, payload: { pan: string; expectedCurrentHash?: string; reason?: string; confirm?: boolean }, reason = "PAN test") {
    return { schemaVersion: 1 as const, tenantId: tenantId as never, requestId, actor: { kind: "HUMAN" as const, id: "pan-test" }, source: "INTERNAL" as const, reason, payload };
  }

  async function tenant(app: Awaited<ReturnType<typeof initializeAndUpgradeSqliteApplication>>, name: string) {
    const created = await app.tenant.create({ schemaVersion: 1, tenantId: "bootstrap" as never, requestId: `create-${name}`, actor: { kind: "SYSTEM", id: "pan-test" }, source: "INTERNAL", reason: "create tenant", payload: { kind: "COMPANY", name } });
    const data = JSON.parse(created.resultJson) as { tenantId: string; defaultBookSetId: string };
    return data;
  }

  it("normalizes and stores PAN while keeping ordinary results, audit, idempotency, and status masked", async () => {
    const { app, dbPath } = await fixture();
    const data = await tenant(app, "PAN Co");
    const result = await app.tenant.pan.set(envelope(data.tenantId, "pan-set-1", { pan: `  ${PAN_A.toLowerCase()}  ` }, `set ${PAN_A} and ${PAN_B.slice(0, 5)} ${PAN_B.slice(5, 9)}-${PAN_B.slice(9)}`));
    const parsed = JSON.parse(result.resultJson) as Record<string, unknown>;
    expect(parsed).toEqual({ panProfileId: expect.any(String), lookupHash: hash(PAN_A), maskedPan: "******234F", changeKind: "INITIAL_SET" });
    expect(result.resultJson).not.toContain(PAN_A);
    expect(await app.tenant.pan.get(data.tenantId as never)).toMatchObject({ lookupHash: hash(PAN_A), lastFour: "234F", maskedPan: "******234F" });
    expect(await app.tenant.pan.reveal(data.tenantId as never)).toMatchObject({ pan: PAN_A });
    await app.tenant.activate({ schemaVersion: 1, tenantId: data.tenantId as never, requestId: "activate-pan", actor: { kind: "SYSTEM", id: "pan-test" }, source: "INTERNAL", reason: "activate", payload: { defaultBookSetId: data.defaultBookSetId as never } });
    const status = await app.company.status({ tenantId: data.tenantId as never, asOfDate: "2026-08-23" });
    expect(status.selectedTenant).toMatchObject({ hasPan: true, maskedPan: "******234F" });
    expect(JSON.stringify(status)).not.toContain(PAN_A);

    const db = new BunDatabase(dbPath, { readonly: true });
    try {
      const audit = db.query("SELECT reason, change_summary FROM audit_records WHERE command = 'tenant.pan.set'").all() as Array<Record<string, string>>;
      const idem = db.query("SELECT result_json FROM idempotency_records WHERE tenant_id = ? AND request_id = ?").all(data.tenantId, "pan-set-1") as Array<Record<string, string>>;
      expect(JSON.stringify(audit)).not.toContain(PAN_A);
      expect(JSON.stringify(audit)).not.toContain(PAN_B);
      expect(JSON.stringify(idem)).not.toContain(PAN_A);
      expect(db.query("SELECT pan, lookup_hash, masked_display FROM tenant_pan_profiles WHERE tenant_id = ?").get(data.tenantId)).toEqual({ pan: PAN_A, lookup_hash: hash(PAN_A), masked_display: "******234F" });
    } finally { db.close(); }
  });

  it("replays idempotently and gates replacement on current hash, reason, and confirmation", async () => {
    const { app } = await fixture();
    const data = await tenant(app, "Replacement Co");
    const initial = await app.tenant.pan.set(envelope(data.tenantId, "replace-1", { pan: PAN_A }));
    const replay = await app.tenant.pan.set(envelope(data.tenantId, "replace-1", { pan: PAN_A }));
    expect(replay.replayed).toBe(true);
    expect(replay.resultJson).toBe(initial.resultJson);
    await expect(app.tenant.pan.set(envelope(data.tenantId, "replace-stale", { pan: PAN_B, expectedCurrentHash: hash("ZZZZZ9999Z"), reason: "change", confirm: true }))).rejects.toMatchObject({ code: "PAN_REPLACEMENT_STALE" });
    await expect(app.tenant.pan.set(envelope(data.tenantId, "replace-no-reason", { pan: PAN_B, expectedCurrentHash: hash(PAN_A), confirm: true }))).rejects.toMatchObject({ code: "PAN_REPLACEMENT_REASON_REQUIRED" });
    await expect(app.tenant.pan.set(envelope(data.tenantId, "replace-no-confirm", { pan: PAN_B, expectedCurrentHash: hash(PAN_A), reason: "change" }))).rejects.toMatchObject({ code: "PAN_REPLACEMENT_CONFIRMATION_REQUIRED" });
    const replaced = await app.tenant.pan.set(envelope(data.tenantId, "replace-ok", { pan: PAN_B, expectedCurrentHash: hash(PAN_A), reason: `replace ${PAN_A}`, confirm: true }));
    expect(JSON.parse(replaced.resultJson)).toMatchObject({ lookupHash: hash(PAN_B), maskedPan: "******876L", changeKind: "REPLACED" });
    expect(replaced.resultJson).not.toContain(PAN_B);
    expect(await app.tenant.pan.reveal(data.tenantId as never)).toMatchObject({ pan: PAN_B });
  });

  it("rejects duplicate ownership atomically and keeps tenant scopes separate", async () => {
    const { app } = await fixture();
    const first = await tenant(app, "First PAN Co");
    const second = await tenant(app, "Second PAN Co");
    await app.tenant.pan.set(envelope(first.tenantId, "first-pan", { pan: PAN_A }));
    await expect(app.tenant.pan.set(envelope(second.tenantId, "second-pan", { pan: PAN_A }))).rejects.toMatchObject({ code: "PAN_ALREADY_OWNED" });
    expect(await app.tenant.pan.get(second.tenantId as never)).toBeNull();
    await expect(app.tenant.pan.reveal(second.tenantId as never)).rejects.toMatchObject({ code: "PAN_NOT_SET" });
    await expect(app.tenant.pan.set(envelope("missing-tenant", "missing-pan", { pan: PAN_B }))).rejects.toMatchObject({ code: "TENANT_NOT_FOUND" });
    await expect(app.tenant.pan.set(envelope(first.tenantId, "bad-pan", { pan: "ABCDE1234" }))).rejects.toMatchObject({ code: "INVALID_PAN" });
  });
});
