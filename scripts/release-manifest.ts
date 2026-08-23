import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLI_VERSION, BUILD_COMMIT, PROTOCOL_VERSION, VERSION_MANIFEST } from "../src/release.ts";

const binary = join(process.cwd(), "dist", "agent-bahi-darwin-arm64");
const bytes = readFileSync(binary);
const checksum = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  ...VERSION_MANIFEST,
  version: CLI_VERSION,
  buildCommit: BUILD_COMMIT,
  protocolVersion: PROTOCOL_VERSION,
  target: "darwin-arm64",
  artifact: "agent-bahi-darwin-arm64",
  sha256: checksum,
  size: bytes.byteLength,
  signing: "not provided in V1",
};
writeFileSync(join(dirname(binary), "agent-bahi-darwin-arm64.sha256"), `${checksum}  agent-bahi-darwin-arm64\n`, { mode: 0o600 });
writeFileSync(join(dirname(binary), "agent-bahi-darwin-arm64.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
chmodSync(binary, 0o755);
