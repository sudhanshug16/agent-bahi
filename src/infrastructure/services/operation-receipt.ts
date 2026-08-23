import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { assertSafeSqlitePath } from "../sqlite/path-policy.ts";
import { pathHash } from "../../release.ts";

export interface OperationReceipt {
  readonly schemaVersion: 1;
  readonly operation: string;
  readonly requestId: string;
  readonly actor: { readonly kind: "HUMAN"; readonly id: string };
  readonly cliVersion: string;
  readonly buildCommit: string;
  readonly databasePathHash: string;
  readonly from?: { readonly schemaVersion?: number; readonly dataFormatVersion?: number };
  readonly to?: { readonly schemaVersion?: number; readonly dataFormatVersion?: number };
  readonly migrations?: readonly { readonly id: string; readonly checksum: string }[];
  readonly backup?: { readonly pathHash: string; readonly fileHash: string; readonly size?: number };
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly outcome: "SUCCESS" | "RECOVERED" | "RECOVERY_FAILED" | "FAILED";
  readonly recovery?: string;
}

export function receiptPath(databasePath: string): string {
  const canonical = assertSafeSqlitePath(databasePath);
  return `${canonical}.agent-bahi-receipts.jsonl`;
}

/** Append one bounded JSON line and fsync it. The receipt never contains the raw DB path. */
export function appendOperationReceipt(databasePath: string, receipt: OperationReceipt): void {
  const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8");
  const fd = openSync(receiptPath(databasePath), "a", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function receiptDatabasePathHash(databasePath: string): string {
  return pathHash(assertSafeSqlitePath(databasePath));
}

export function hashReceiptValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
