import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SKILL_GUIDES, validateSkillGuides } from "../src/transport/skills.ts";

const root = join(process.cwd(), "skills");
const failures: string[] = validateSkillGuides().map((item) => `${item.guideId}: ${item.code}: ${item.message}`);
const expectedDirectories = new Set(SKILL_GUIDES.map((guide) => guide.id));
const directories = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

if (JSON.stringify(directories) !== JSON.stringify([...expectedDirectories].sort())) failures.push(`Markdown directories drift: expected ${[...expectedDirectories].sort().join(",")}, found ${directories.join(",")}`);

for (const guide of SKILL_GUIDES) {
  const path = join(root, guide.id, "SKILL.md");
  let body: string;
  try { body = readFileSync(path, "utf8"); } catch { failures.push(`${guide.id}: missing SKILL.md`); continue; }
  const header = body.match(/^<!-- agent-bahi-skill id="([^"]+)" version="([0-9]+)" -->$/m);
  if (!header || header[1] !== guide.id || Number(header[2]) !== guide.version) failures.push(`${guide.id}: registry header drift`);
  const operations = [...body.matchAll(/^<!-- operation: ([^ ]+) -->$/gm)].map((match) => match[1]);
  if (JSON.stringify(operations) !== JSON.stringify(guide.operationReferences)) failures.push(`${guide.id}: operation markers drift`);
  const steps = [...body.matchAll(/^<!-- step: ([^ ]+) kind="(OPERATION|EXTERNAL|NOT_IMPLEMENTED)"(?: operation="([^"]+)")? -->$/gm)].map((match) => ({ id: match[1], kind: match[2], ...(match[3] ? { operationId: match[3] } : {}) }));
  const expectedSteps = guide.steps.map((step) => ({ id: step.id, kind: step.kind, ...(step.operationId ? { operationId: step.operationId } : {}) }));
  if (JSON.stringify(steps) !== JSON.stringify(expectedSteps)) failures.push(`${guide.id}: step markers drift`);
  if (!/Inspect `company\.status` first/.test(body)) failures.push(`${guide.id}: missing status-first instruction`);
  if (!/explicit (?:tenant and BookSet|tenant\/BookSet|TaxCase)(?: scope)?/.test(body)) failures.push(`${guide.id}: missing explicit-scope instruction`);
  if (!/preview/i.test(body)) failures.push(`${guide.id}: missing preview instruction`);
  if (!/never means|never mean|never claim|not official|submission/i.test(body)) failures.push(`${guide.id}: missing export/submission boundary`);
  if (!/blocker|blockers/i.test(body)) failures.push(`${guide.id}: missing blocker instruction`);
  if (/agent-bahi\s+(skills|operations)\s+(list|show|check)/i.test(body)) failures.push(`${guide.id}: stale command string in Markdown`);
  if (/https?:\/\/|\b(password|passwd|token|secret|credential|api[_ -]?key)\b/i.test(body)) failures.push(`${guide.id}: secret-like literal or URL in Markdown`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Validated ${SKILL_GUIDES.length} skill guides against the live operation catalog.\n`);
}
