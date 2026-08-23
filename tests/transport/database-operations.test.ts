import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeSqliteDatabase } from "../../src/application/application.ts";
import { databaseOperation } from "../../src/infrastructure/services/database-operations-service.ts";
import { OperationDispatcher } from "../../src/transport/dispatcher.ts";

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function fixture(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), "agent-bahi-db-operations-"));
  const path = join(directory, "books.sqlite");
  await initializeSqliteDatabase(path, { cliVersion: "1.0.0", buildId: "test" });
  return path;
}

const operatorInput = (requestId: string, extra: Record<string, unknown> = {}) => ({
  requestId,
  actor: { kind: "HUMAN", id: "test-operator" },
  yes: true,
  ...extra,
});

describe("Database Operations + Release CLI V1", () => {
  it("reports version and compatibility without implicit migration", async () => {
    const path = await fixture();
    const version = await new OperationDispatcher({ databasePath: path, source: "CLI" }).dispatch("system.version", {});
    expect(version).toMatchObject({ ok: true, result: { version: "1.0.0", protocolVersion: 1, supportedSchemaVersion: 8, updateChecks: "disabled" } });
    const compatibility = await databaseOperation("database.compatibility", path, {});
    expect(compatibility).toMatchObject({ status: "CURRENT", currentSchemaVersion: 8, currentDataFormatVersion: 1 });
  });

  it("previews exact ordered migration identity and rejects unconfirmed mutations", async () => {
    const path = await fixture();
    const preview = await databaseOperation("database.upgrade.preview", path, {}) as { requiresUpgrade: boolean; migrations: unknown[]; toSchemaVersion: number };
    expect(preview).toMatchObject({ requiresUpgrade: false, migrations: [], toSchemaVersion: 8 });
    await expect(databaseOperation("database.backup.create", path, { requestId: "missing-confirmation" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("creates, lists, verifies, and receipts a CLI-only backup without raw DB path in the receipt", async () => {
    const path = await fixture();
    const created = await databaseOperation("database.backup.create", path, operatorInput("backup-1")) as { path: string; manifest: { files: [{ checksum: string }] } };
    expect(created.path).toEndWith("backup-1.backup");
    const listed = await databaseOperation("database.backup.list", path, {}) as { backups: Array<{ fileHash: string }> };
    expect(listed.backups).toHaveLength(1);
    expect(listed.backups[0]?.fileHash).toBe(created.manifest.files[0].checksum);
    await expect(databaseOperation("database.backup.verify", path, { backupPath: created.path })).resolves.toMatchObject({ verified: true });
    const receipts = await readFile(path + ".agent-bahi-receipts.jsonl", "utf8");
    expect(receipts).toContain("\"operation\":\"database.backup.create\"");
    expect(receipts).not.toContain(path);
  });

  it("returns deterministic CLI_REQUIRED for MCP mutation attempts without executing them", async () => {
    const path = await fixture();
    const result = await new OperationDispatcher({ databasePath: path, source: "MCP", allowOperatorOperations: false }).dispatch("database.upgrade.apply", {});
    expect(result).toMatchObject({ ok: false, error: { code: "CLI_REQUIRED", details: { transportPolicy: "CLI_ONLY" } } });
    expect(await databaseOperation("database.compatibility", path, {})).toMatchObject({ status: "CURRENT" });
  });

  it("restores with a retained pre-restore safety backup", async () => {
    const path = await fixture();
    const created = await databaseOperation("database.backup.create", path, operatorInput("restore-source")) as { path: string };
    const restored = await databaseOperation("database.backup.restore", path, operatorInput("restore-1", { backupPath: created.path }));
    expect(restored).toMatchObject({ restored: true, verified: true, safetyBackup: { checksum: expect.any(String) } });
    const listed = await databaseOperation("database.backup.list", path, {}) as { backups: Array<{ name: string }> };
    expect(listed.backups.some((backup) => backup.name.includes("pre-restore"))).toBe(true);
  });
});
