import { expect, test } from "bun:test";

test("SQLite remains behind infrastructure and no runtime subprocess is bundled", async () => {
  const domain = await Bun.file("src/domain/commands/registry.ts").text();
  const application = await Bun.file("src/application/ports/sqlite-port.ts").text();
  expect(domain).not.toContain("bun:sqlite");
  expect(application).not.toContain("bun:sqlite");
  const sources = `${await Bun.file("spikes/gate0/cli-smoke.ts").text()}\n${await Bun.file("spikes/gate0/proof.ts").text()}`;
  expect(sources).not.toContain("child_process");
  expect(sources).not.toContain("spawn(");
});
