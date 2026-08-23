import { describe, expect, it } from "bun:test";

describe("remote MCP container contract", () => {
  it("keeps the image non-root, SQLite writable area, healthcheck, and signal contract explicit", async () => {
    const dockerfile = await Bun.file("Dockerfile").text();
    const compose = await Bun.file("docker-compose.yml").text();
    const ignore = await Bun.file(".dockerignore").text();
    expect(dockerfile).toContain("bun build src/cli.ts --compile");
    expect(dockerfile).toContain("USER 10001:10001");
    expect(dockerfile).toContain("VOLUME [\"/data\"]");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("ENTRYPOINT [\"/usr/local/bin/agent-bahi\"]");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("stop_signal: SIGTERM");
    expect(compose).toContain("agent-bahi-data:/data");
    expect(compose).toContain("AGENT_BAHI_MCP_TOKEN_FILE");
    expect(ignore).toContain("*.sqlite");
    expect(ignore).toContain("node_modules");
  });
});
