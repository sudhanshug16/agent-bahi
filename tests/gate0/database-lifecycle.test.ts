import { expect, test } from "bun:test";
import {
  classifySpawnResult,
  integrationSummary,
  REQUIRED_SEMANTIC_PROOF_IDS,
  type IntegrationTestResult,
} from "../../spikes/gate0/database-integration.ts";

test("spawnSync lifecycle classification fails closed for null exit, timeout, and signal", () => {
  expect(classifySpawnResult({ success: true, exitCode: 0, signalCode: null })).toEqual({
    success: true,
    exitCode: 0,
    signalCode: null,
    timedOut: false,
  });
  expect(classifySpawnResult({ success: false, exitCode: null, signalCode: null })).toMatchObject({
    success: false,
    exitCode: null,
    timedOut: true,
  });
  expect(classifySpawnResult({ success: false, exitCode: null, signalCode: "SIGTERM" })).toEqual({
    success: false,
    exitCode: null,
    signalCode: "SIGTERM",
    timedOut: true,
  });
  expect(classifySpawnResult({ success: false, exitCode: 1, signalCode: null })).toEqual({
    success: false,
    exitCode: 1,
    signalCode: null,
    timedOut: false,
  });
});

test("integration summary is complete, sorted, and carries server version/details", () => {
  const results: IntegrationTestResult[] = [
    {
      id: "PG-IDEM-001",
      name: "idempotency",
      status: "PASS",
      evidence: ["winner"],
      detail: "same hash returned stored winner",
    },
    {
      id: "PG-MIG-001",
      name: "migration",
      status: "FAIL",
      evidence: ["failed checksum"],
    },
  ];
  const summary = integrationSummary("postgres", "PostgreSQL 17.11", results);

  expect(summary.server_version).toBe("PostgreSQL 17.11");
  expect(summary.proofs.map((proof) => proof.id)).toEqual([...REQUIRED_SEMANTIC_PROOF_IDS].sort());
  expect(summary.proofs.find((proof) => proof.id === "MIG-001")).toEqual({
    id: "MIG-001",
    status: "FAIL",
    detail: "failed checksum",
  });
  expect(summary.proofs.find((proof) => proof.id === "IDEM-001")).toEqual({
    id: "IDEM-001",
    status: "PASS",
    detail: "same hash returned stored winner",
  });
  expect(summary.proofs.every((proof) => proof.detail.length > 0)).toBe(true);
});
