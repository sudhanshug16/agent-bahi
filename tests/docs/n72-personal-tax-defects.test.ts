/**
 * Adversarial personal-tax contract tests.
 *
 * These tests extract declared candidate keys/FKs and guard clauses instead of
 * accepting isolated keywords. They are intentionally documentation tests:
 * the physical schema remains an RFC and has no executable migration here.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const read = (name: string) =>
  readFileSync(join(import.meta.dir, `../../docs/discovery/${name}`), "utf-8");

const SCHEMA = read("personal-tax-physical-schema.md");
const SCOPE = read("personal-tax-scope.md");
const WORKFLOW = read("statutory-workflow-contracts.md");
const DOCKET = read("owner-review-docket.md");

function section(document: string, heading: string, nextHeading: string): string {
  const start = document.indexOf(heading);
  const end = document.indexOf(nextHeading, start + heading.length);
  expect(start, `missing section ${heading}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing section boundary ${nextHeading}`).toBeGreaterThan(start);
  return document.slice(start, end);
}

function tupleAfter(text: string, marker: string): string[] {
  const start = text.indexOf(marker);
  expect(start, `missing tuple marker: ${marker}`).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("(", start + marker.length);
  const close = text.indexOf(")", open + 1);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return text
    .slice(open + 1, close)
    .split(",")
    .map((value) => value.trim().replaceAll("`", ""));
}

function uniqueTupleAfter(text: string, marker: string): string[] {
  return tupleAfter(text, `${marker}UNIQUE`);
}

function lineContaining(text: string, needle: string): string {
  const line = text.split("\n").find((candidate) => candidate.includes(needle));
  expect(line, `missing line containing: ${needle}`).toBeDefined();
  return line ?? "";
}

describe("personal-tax n74/ro394/ro395 contract repairs", () => {
  it("binds READY to the exact seven-column SEALED evidence-set candidate", () => {
    const source = section(
      SCHEMA,
      "### 2.17 `external_sources`",
      "### 2.17a"
    );
    const evidence = section(
      SCHEMA,
      "### 2.17c `readiness_evidence_sets`",
      "### 2.17d"
    );
    const readyLine = lineContaining(source, "READY uses composite FK");
    const child = tupleAfter(readyLine, "READY uses composite FK");
    const target = uniqueTupleAfter(
      readyLine,
      "`readiness_evidence_sets` candidate key `"
    );
    expect(child.length).toBe(target.length);
    expect(target).toEqual([
      "tenant_id",
      "tax_case_id",
      "source_id",
      "evidence_set_id",
      "catalog_snapshot_id",
      "catalog_snapshot_hash",
      "seal_state",
    ]);
    expect(child).toEqual([
      "tenant_id",
      "tax_case_id",
      "source_id",
      "readiness_evidence_set_id",
      "readiness_catalog_snapshot_id",
      "readiness_catalog_snapshot_hash",
      "readiness_evidence_set_state",
    ]);
    expect(evidence).toContain(
      "UNIQUE(tenant_id, tax_case_id, source_id, evidence_set_id, catalog_snapshot_id, catalog_snapshot_hash, seal_state)"
    );
    expect(source).toContain("readiness_catalog_snapshot_id");
    expect(source).toContain("readiness_catalog_snapshot_hash");
  });

  it("checks every readiness evidence FK for matching declared arity/order", () => {
    const entries = section(
      SCHEMA,
      "### 2.17d `readiness_evidence_set_entries`",
      "### 2.17e"
    );
    const line = lineContaining(entries, "exact FK");
    const setFk = tupleAfter(line, "exact FK");
    const catalogFk = tupleAfter(line, "; exact FK");
    const artifactFk = tupleAfter(line, "; and exact FK");
    expect(setFk).toEqual([
      "tenant_id",
      "tax_case_id",
      "source_id",
      "evidence_set_id",
      "catalog_snapshot_id",
      "catalog_snapshot_hash",
    ]);
    expect(catalogFk).toEqual([
      "tenant_id",
      "tax_case_id",
      "source_id",
      "catalog_snapshot_id",
      "catalog_snapshot_hash",
      "catalog_ordinal",
      "requirement_key",
    ]);
    expect(artifactFk).toEqual([
      "tenant_id",
      "tax_case_id",
      "source_id",
      "evidence_artifact_id",
      "evidence_artifact_hash",
    ]);
  });

  it("derives SEALED membership hashes from complete provenance rows", () => {
    const snapshot = section(
      SCHEMA,
      "### 2.12 `filing_snapshots`",
      "### 2.12a"
    );
    const booksets = section(
      SCHEMA,
      "### 2.12a `filing_snapshot_booksets`",
      "### 2.12b"
    );
    const artifacts = section(
      SCHEMA,
      "### 2.12b `filing_snapshot_artifacts`",
      "### 2.12c"
    );
    expect(snapshot).toContain("derived `bookset_membership_hash`");
    expect(snapshot).toContain("derived `artifact_membership_hash`");
    expect(booksets).toContain("book_set_id, ledger_version, event_cursor");
    expect(artifacts).toContain(
      "source_id, evidence_artifact_id, evidence_artifact_hash, parser_version"
    );
    expect(snapshot).toContain("never caller-asserted");
    expect(snapshot).toContain("ordered complete artifact rows");
    expect(snapshot).toContain("nonempty");
  });

  it("guards SEALED readiness parents and every child row in all dialects", () => {
    const guards = section(
      SCHEMA,
      "### 2.17e Database-enforced readiness seal protocol",
      "### 2.18"
    );
    for (const dialect of ["SQLite", "PostgreSQL", "MySQL"]) {
      expect(guards).toContain(dialect);
    }
    expect(guards).toContain("catalog-parent seal/update/delete guard");
    expect(guards).toContain("evidence-set-parent seal/update/delete guard");
    expect(guards).toContain("Catalog-entry insert/update/delete triggers");
    expect(guards).toContain("Evidence-entry insert/update/delete triggers");
    expect(guards).toContain("parent mutation after `SEALED`");
    expect(guards).toContain("parent is `SEALED`");
    expect(guards).toContain("two anti-joins are empty");
  });

  it("requires retry self-FKs to preserve the full binding/snapshot/export tuple", () => {
    const attempts = section(
      SCHEMA,
      "### 2.15 `submission_attempts`",
      "### 2.16"
    );
    const candidate = lineContaining(
      attempts,
      "exact immutable SubmissionBinding/FilingSnapshot/ExportRun tuple"
    );
    const candidateTuple = uniqueTupleAfter(candidate, "and `");
    const retryLine = lineContaining(attempts, "For retries, composite FK");
    const child = tupleAfter(retryLine, "For retries, composite FK");
    const target = uniqueTupleAfter(retryLine, "exact retry candidate `");
    expect(child.length).toBe(target.length);
    expect(candidateTuple.length).toBe(target.length);
    expect(target).toEqual([
      "tenant_id",
      "tax_case_id",
      "attempt_id",
      "attempt_number",
      "binding_id",
      "snapshot_id",
      "snapshot_content_hash",
      "selected_export_id",
      "selected_export_content_hash",
      "selected_export_validation_outcome",
    ]);
    expect(child.slice(0, 2)).toEqual(["tenant_id", "tax_case_id"]);
    for (const field of [
      "binding_id",
      "snapshot_id",
      "snapshot_content_hash",
      "selected_export_id",
      "selected_export_content_hash",
      "selected_export_validation_outcome",
    ]) {
      expect(child).toContain(field);
    }
    expect(attempts).toContain("mixed tuple cannot satisfy the chain");
  });

  it("defines immutable validation runs/evidence and forbids free-form validation identity", () => {
    const run = section(SCHEMA, "### 2.13a `validation_runs`", "### 2.13b");
    const evidence = section(
      SCHEMA,
      "### 2.13b `validation_evidence`",
      "### 2.14"
    );
    const exportRun = section(SCHEMA, "### 2.14 `export_runs`", "### 2.14a");
    expect(run).toContain("seal_state");
    expect(run).toContain("evidence_count > 0");
    expect(run).toContain("exactly `PASSED`");
    expect(run).toContain("computed from complete ordered evidence rows at seal");
    expect(evidence).toContain("Primary key");
    expect(evidence).toContain("update/delete guards");
    expect(evidence).toContain("every ordered row");
    expect(exportRun).not.toContain("validation_identity");
    expect(exportRun).toContain("validation_run_id");
    expect(exportRun).toContain("validation_run_hash");
    expect(exportRun).toContain("derived through the exact validation-run FK");
    expect(SCHEMA).not.toContain("linked by export_id");
  });

  it("blocks computation/export creation unless the snapshot is SEALED and CURRENT", () => {
    const computation = section(
      SCHEMA,
      "### 2.13 `tax_computations`",
      "### 2.13a"
    );
    const exportRun = section(SCHEMA, "### 2.14 `export_runs`", "### 2.14a");
    expect(computation).toContain("SEALED` and `integrity_status = 'CURRENT'");
    expect(computation).toContain("OPEN, STALE, or DRIFTED");
    expect(exportRun).toContain(
      "seal_state = 'SEALED' AND integrity_status = 'CURRENT'"
    );
    expect(exportRun).toContain("STALE/DRIFTED snapshots cannot create new");
    expect(exportRun).toContain("validation run whose output tuple matches");
  });

  it("structurally binds form selection to facts, source snapshot, predicates, and zero unresolved branches", () => {
    const evaluation = section(
      SCHEMA,
      "### 2.9b `form_eligibility_evaluations`",
      "### 2.10"
    );
    const taxCase = section(SCHEMA, "### 2.11 `tax_cases`", "### 2.12");
    expect(evaluation).toContain("selected_form");
    for (const field of [
      "eligibility_fact_set_id",
      "eligibility_fact_set_hash",
      "eligibility_source_snapshot_id",
      "eligibility_source_snapshot_hash",
      "eligibility_predicate_artifact_id",
      "eligibility_predicate_artifact_hash",
    ]) {
      expect(evaluation).toContain(field);
    }
    expect(evaluation).toContain("unresolved_predicate_count` must equal zero");
    expect(evaluation).toContain("exact official predicate artifact");
    expect(taxCase).toContain("form_selection_id");
    expect(taxCase).toContain("never stored as an independently writable nullable TaxCase assertion");
    expect(taxCase).not.toContain("Nullable: selected form");
  });

  it("keeps PT-013 lifecycle separation and aligns workflow approval boundaries", () => {
    expect(SCOPE).toContain("Local lifecycle (`PREPARED`, `EXPORTED`, `UNKNOWN`)");
    expect(SCOPE).toContain("immutable validation run/evidence record");
    expect(SCOPE).toContain("PT-013");
    expect(WORKFLOW).toContain("T-001 through T-011 and PT-001 through PT-016");
    expect(WORKFLOW).toContain("NOT ARCHITECT-REVIEWED");
    expect(WORKFLOW).toContain("no direct filing, portal-submission, payment");
    expect(WORKFLOW).not.toContain("This document remains NOT OWNER-APPROVED");
    expect(DOCKET).toContain("All 16 PT decisions (PT-001 through PT-016) are OWNER-APPROVED; NOT ARCHITECT-REVIEWED");
    expect(DOCKET).toContain("grants no direct portal-filing authority");
  });
});
