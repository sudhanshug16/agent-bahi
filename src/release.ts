import { createHash } from "node:crypto";

/** Release identity is intentionally local and never performs network checks. */
export const CLI_VERSION = "1.0.0";
export const PROTOCOL_VERSION = 1;
export const BUILD_COMMIT = process.env.AGENT_BAHI_BUILD_COMMIT ?? "unbuilt";
export const BUILD_TARGET = process.env.AGENT_BAHI_BUILD_TARGET ?? "source";

export const VERSION_MANIFEST = Object.freeze({
  name: "agent-bahi",
  version: CLI_VERSION,
  buildCommit: BUILD_COMMIT,
  buildTarget: BUILD_TARGET,
  protocolVersion: PROTOCOL_VERSION,
  supportedSchemaVersion: 8,
  supportedDataFormatVersion: 1,
  updateChecks: "disabled",
});

export function versionResult(): Record<string, unknown> {
  return {
    ...VERSION_MANIFEST,
    supportedProtocolVersions: [PROTOCOL_VERSION],
    supportedDataFormatVersions: [1],
  };
}

export function pathHash(canonicalPath: string): string {
  return createHash("sha256").update(canonicalPath).digest("hex");
}
