import { expect, test } from "bun:test";
import {
  blockedDialectResults,
  classifySpawnResult,
  cleanupResource,
  DIALECT_NOT_APPLICABLE,
  finalizeProofResults,
  IntegrationBlockedError,
  integrationSummary,
  normalizeDatabaseRowKeys,
  POSTGRES_IMAGE,
  preflightDatabaseImage,
  REQUIRED_SEMANTIC_PROOF_IDS,
  startDatabaseContainer,
  type DockerCommandRunner,
  type IntegrationTestResult,
} from "../../spikes/gate0/database-integration.ts";

const successfulDockerResult = (stdout = "ok") => ({
  success: true,
  exitCode: 0,
  signalCode: null,
  stdout,
  stderr: "",
});

const missingDockerImageResult = {
  success: false,
  exitCode: 1,
  signalCode: null,
  stdout: "",
  stderr: "No such image",
};

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

test("proof finalizer fails missing, duplicate, unknown, and invalid N/A results", () => {
  const complete = REQUIRED_SEMANTIC_PROOF_IDS.map((proofId) => ({
    id: `PG-${proofId}`,
    name: proofId,
    status: DIALECT_NOT_APPLICABLE.postgres.includes(proofId as never) ? "NOT_APPLICABLE" as const : "PASS" as const,
    evidence: [proofId],
  }));
  const duplicateUnknown = finalizeProofResults("postgres", [
    ...complete,
    complete[0],
    { id: "PG-UNKNOWN", name: "unknown", status: "PASS", evidence: ["bad"] },
    { id: "PG-SCOPE-001", name: "invalid N/A", status: "NOT_APPLICABLE", evidence: ["bad"] },
  ]);
  expect(duplicateUnknown.find((result) => result.id === "PG-MIG-001")?.status).toBe("FAIL");
  expect(duplicateUnknown.find((result) => result.id === "PG-UNKNOWN")?.status).toBe("FAIL");
  expect(duplicateUnknown.find((result) => result.id === "PG-SCOPE-001")?.status).toBe("FAIL");

  const missing = finalizeProofResults("postgres", complete.filter((result) => result.id !== "PG-MIG-001"));
  expect(missing.find((result) => result.id === "PG-MIG-001")?.status).toBe("FAIL");
  expect(missing.find((result) => result.id === "PG-MIG-DIRTY-MARKER")?.status).toBe("NOT_APPLICABLE");
});

test("MySQL metadata key normalization handles actual uppercase driver labels", () => {
  expect(normalizeDatabaseRowKeys({ TABLE_NAME: "tenants", ENGINE: "InnoDB", Trigger: "trg", ACTION_STATEMENT: "BEGIN" })).toEqual({
    table_name: "tenants",
    engine: "InnoDB",
    trigger: "trg",
    action_statement: "BEGIN",
  });
});

test("Docker cleanup attempts all resources and verifies absence before failing", async () => {
  const calls: string[][] = [];
  const runDocker: DockerCommandRunner = (args) => {
    calls.push(args);
    if (args[0] === "network" && args[1] === "rm") {
      return { success: false, exitCode: 1, signalCode: null, stdout: "", stderr: "network busy" };
    }
    if (args[0] === "inspect") {
      return { success: false, exitCode: 1, signalCode: null, stdout: "", stderr: "No such resource" };
    }
    return successfulDockerResult("");
  };
  let failure: unknown;
  try {
    await cleanupResource("owned-container", "owned-network", true, true, runDocker)();
  } catch (error) {
    failure = error;
  }
  expect(String(failure)).toContain("network busy");
  expect(calls).toEqual([
    ["rm", "-f", "owned-container"],
    ["inspect", "--format={{.Id}}", "owned-container"],
    ["network", "rm", "owned-network"],
    ["network", "inspect", "owned-network"],
  ]);
});

test("an exact local image match skips pull and reports the local preflight", () => {
  const calls: string[][] = [];
  const runDocker: DockerCommandRunner = (args) => {
    calls.push(args);
    return successfulDockerResult("sha256:local-image");
  };

  expect(preflightDatabaseImage(POSTGRES_IMAGE, [], runDocker)).toBe("LOCAL");
  expect(calls).toEqual([["image", "inspect", "--format={{.Id}}", POSTGRES_IMAGE]]);
});

test("a missing image pulls once and verifies the exact reference before use", () => {
  const calls: string[][] = [];
  let imageInspectCount = 0;
  const runDocker: DockerCommandRunner = (args) => {
    calls.push(args);
    if (args[0] === "image") {
      imageInspectCount += 1;
      return imageInspectCount === 1 ? missingDockerImageResult : successfulDockerResult("sha256:pulled-image");
    }
    expect(args).toEqual(["pull", POSTGRES_IMAGE]);
    return successfulDockerResult("pulled");
  };

  expect(preflightDatabaseImage(POSTGRES_IMAGE, [], runDocker)).toBe("PULLED");
  expect(calls).toEqual([
    ["image", "inspect", "--format={{.Id}}", POSTGRES_IMAGE],
    ["pull", POSTGRES_IMAGE],
    ["image", "inspect", "--format={{.Id}}", POSTGRES_IMAGE],
  ]);
});

test("missing-image pull failure is blocked before network/run and cannot false-green", async () => {
  const calls: string[][] = [];
  const runDocker: DockerCommandRunner = (args) => {
    calls.push(args);
    if (args[0] === "image") return missingDockerImageResult;
    throw new Error("pull timed out (exit_code=null; timed_out=true)");
  };

  let failure: unknown;
  try {
    await startDatabaseContainer("postgres", runDocker);
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(IntegrationBlockedError);
  expect(String(failure)).toContain("image pull unavailable");
  expect(calls).toEqual([
    ["image", "inspect", "--format={{.Id}}", POSTGRES_IMAGE],
    ["pull", POSTGRES_IMAGE],
  ]);
  const blocked = blockedDialectResults("postgres", String(failure));
  expect(blocked.every((result) => result.status === "BLOCKED" || result.status === "NOT_APPLICABLE")).toBe(true);
  expect(blocked.some((result) => result.status === "NOT_APPLICABLE")).toBe(true);
  expect(blocked.some((result) => result.status === "PASS")).toBe(false);
});
