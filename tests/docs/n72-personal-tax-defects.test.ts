/**
 * n72 Personal-Tax Documentation-Contract Defect Tests
 *
 * Validates that the four n72 defects in personal-tax schema are properly
 * documented and fixed in personal-tax-physical-schema.md
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const SCHEMA_DOC = readFileSync(
  join(import.meta.dir, "../../docs/discovery/personal-tax-physical-schema.md"),
  "utf-8"
);

describe("n72 Personal-Tax Documentation-Contract Defects", () => {
  describe("n72-1: FilingSnapshot OPEN→SEALED protocol", () => {
    it("should document seal_state field in FilingSnapshot", () => {
      // Section 2.12 should include seal_state
      const section2_12 = SCHEMA_DOC.match(
        /### 2\.12 `filing_snapshots`[\s\S]*?(?=### 2\.12a)/
      )?.[0] || "";
      expect(section2_12).toContain("seal_state");
      expect(section2_12).toContain("OPEN");
      expect(section2_12).toContain("SEALED");
    });

    it("should document membership count and hash fields", () => {
      const section2_12 = SCHEMA_DOC.match(
        /### 2\.12 `filing_snapshots`[\s\S]*?(?=### 2\.12a)/
      )?.[0] || "";
      expect(section2_12).toContain("bookset_membership_count");
      expect(section2_12).toContain("bookset_membership_hash");
      expect(section2_12).toContain("artifact_membership_count");
      expect(section2_12).toContain("artifact_membership_hash");
    });

    it("should document seal transition requirements", () => {
      const section2_12 = SCHEMA_DOC.match(
        /### 2\.12 `filing_snapshots`[\s\S]*?(?=### 2\.12a)/
      )?.[0] || "";
      expect(section2_12).toContain("OPEN -> SEALED");
      expect(section2_12).toContain("nonempty");
      expect(section2_12).toContain("one-way");
    });

    it("should document database-enforced seal protocol in 2.12c", () => {
      expect(SCHEMA_DOC).toContain("### 2.12c Database-enforced");
      const section2_12c = SCHEMA_DOC.match(
        /### 2\.12c Database-enforced[\s\S]*?(?=### 2\.13)/
      )?.[0] || "";
      expect(section2_12c).toContain("snapshot-seal trigger");
      expect(section2_12c).toContain("rejects all mutations after parent");
      expect(section2_12c).toContain("SQLite");
      expect(section2_12c).toContain("PostgreSQL");
      expect(section2_12c).toContain("MySQL");
    });

    it("should update 2.12a to document write guards on bookset membership", () => {
      const section2_12a = SCHEMA_DOC.match(
        /### 2\.12a `filing_snapshot_booksets`[\s\S]*?(?=### 2\.12b)/
      )?.[0] || "";
      expect(section2_12a).toContain("write guard");
      expect(section2_12a).toContain("reject");
      expect(section2_12a).toContain("SEALED");
    });

    it("should update 2.12b to document write guards on artifact membership", () => {
      const section2_12b = SCHEMA_DOC.match(
        /### 2\.12b `filing_snapshot_artifacts`[\s\S]*?(?=### 2\.12c)/
      )?.[0] || "";
      expect(section2_12b).toContain("write guard");
      expect(section2_12b).toContain("reject");
      expect(section2_12b).toContain("SEALED");
    });
  });

  describe("n72-2: Remove circular computation claim", () => {
    it("should NOT contain tax_computation_version in FilingSnapshot fields", () => {
      const section2_12 = SCHEMA_DOC.match(
        /### 2\.12 `filing_snapshots`[\s\S]*?(?=### 2\.12a)/
      )?.[0] || "";
      // The OLD defective version would have this
      expect(section2_12).not.toContain("declared `tax_computation_version`");
    });

    it("should NOT contain tax_computation_hash in FilingSnapshot fields", () => {
      const section2_12 = SCHEMA_DOC.match(
        /### 2\.12 `filing_snapshots`[\s\S]*?(?=### 2\.12a)/
      )?.[0] || "";
      expect(section2_12).not.toContain(
        "declared `tax_computation_hash`"
      );
    });

    it("should document computation as one-to-one child of SEALED snapshot", () => {
      const section2_13 = SCHEMA_DOC.match(
        /### 2\.13 `tax_computations`[\s\S]*?(?=### 2\.14)/
      )?.[0] || "";
      expect(section2_13).toContain(
        "created only after the target FilingSnapshot is SEALED"
      );
      expect(section2_13).toContain("SEALED");
      expect(section2_13).toContain(
        "filing_snapshot.seal_state = 'SEALED'"
      );
    });

    it("should document creation trigger verification", () => {
      const section2_13 = SCHEMA_DOC.match(
        /### 2\.13 `tax_computations`[\s\S]*?(?=### 2\.14)/
      )?.[0] || "";
      expect(section2_13).toContain("creation trigger");
      expect(section2_13).toContain("seal_state = 'SEALED'");
    });

    it("should NOT require snapshot computation hash match", () => {
      const section2_13 = SCHEMA_DOC.match(
        /### 2\.13 `tax_computations`[\s\S]*?(?=### 2\.14)/
      )?.[0] || "";
      expect(section2_13).toContain("No snapshot-declared computation version/hash match is required");
      expect(section2_13).not.toContain("tax_computation_version");
      expect(section2_13).not.toContain("tax_computation_hash");
    });
  });

  describe("n72-3: DB update/delete guards for SEALED entities", () => {
    it("should document update/delete guards for catalog snapshots", () => {
      const section2_17e = SCHEMA_DOC.match(
        /### 2\.17e Database-enforced[\s\S]*?(?=### 2\.18)/
      )?.[0] || "";
      expect(section2_17e).toContain("Catalog-entry insert/update/delete");
      expect(section2_17e).toContain("reject writes after");
      expect(section2_17e).toContain("SEALED");
    });

    it("should document update/delete guards for evidence sets", () => {
      const section2_17e = SCHEMA_DOC.match(
        /### 2\.17e Database-enforced[\s\S]*?(?=### 2\.18)/
      )?.[0] || "";
      expect(section2_17e).toContain("Evidence-entry insert/update/delete");
      expect(section2_17e).toContain("reject writes after");
      expect(section2_17e).toContain("SEALED");
    });

    it("should document update/delete guards for FilingSnapshot seals", () => {
      const section2_12c = SCHEMA_DOC.match(
        /### 2\.12c Database-enforced[\s\S]*?(?=### 2\.13)/
      )?.[0] || "";
      expect(section2_12c).toContain("write/state triggers");
      expect(section2_12c).toContain("reject");
      expect(section2_12c).toContain("mutations");
    });

    it("should document parallel guards on all three seal entities", () => {
      const section2_12c = SCHEMA_DOC.match(
        /### 2\.12c Database-enforced[\s\S]*?(?=### 2\.13)/
      )?.[0] || "";
      // Verify it references both membership and artifact junctions
      expect(section2_12c).toContain("booking-set");
      expect(section2_12c).toContain("artifact");
      expect(section2_12c).toContain("trigger");
    });
  });

  describe("n72-4: Single exact FK to SEALED evidence-set", () => {
    it("should replace redundant READY fields with single FK", () => {
      const section2_17 = SCHEMA_DOC.match(
        /### 2\.17 `external_sources`[\s\S]*?(?=### 2\.17a)/
      )?.[0] || "";
      // Should NOT have these copied fields
      expect(section2_17).not.toContain(
        "readiness_catalog_snapshot_id"
      );
      expect(section2_17).not.toContain(
        "readiness_catalog_snapshot_hash"
      );
      expect(section2_17).not.toContain("readiness_evidence_binding_hash");
      expect(section2_17).not.toContain("readiness_catalog_hash");
      expect(section2_17).not.toContain("readiness_evidence_entry_count");
    });

    it("should document READY FK to sealed evidence-set candidate", () => {
      const section2_17 = SCHEMA_DOC.match(
        /### 2\.17 `external_sources`[\s\S]*?(?=### 2\.17a)/
      )?.[0] || "";
      expect(section2_17).toContain("readiness_evidence_set_id");
      expect(section2_17).toContain("readiness_evidence_set_state");
      expect(section2_17).toContain("SEALED");
      expect(section2_17).toContain("single FK");
    });

    it("should document that summaries are derived from FK, not copied", () => {
      const section2_17 = SCHEMA_DOC.match(
        /### 2\.17 `external_sources`[\s\S]*?(?=### 2\.17a)/
      )?.[0] || "";
      expect(section2_17).toContain("derived through the evidence-set FK");
      expect(section2_17).toContain("is stored directly in this table");
      expect(section2_17).toContain("copied status");
    });

    it("should document FK order includes seal_state check", () => {
      const section2_17 = SCHEMA_DOC.match(
        /### 2\.17 `external_sources`[\s\S]*?(?=### 2\.17a)/
      )?.[0] || "";
      expect(section2_17).toContain(
        "readiness_evidence_set_state"
      );
      expect(section2_17).toContain("identical final `seal_state = 'SEALED'`");
    });

    it("should document no independent readiness status updates", () => {
      const section2_17 = SCHEMA_DOC.match(
        /### 2\.17 `external_sources`[\s\S]*?(?=### 2\.17a)/
      )?.[0] || "";
      expect(section2_17).toContain("no copied status");
      expect(section2_17).toContain("all derive from the single sealed-set FK");
    });
  });

  describe("Integration checks", () => {
    it("should have consistent field removal across section 2.12", () => {
      const section2_12 = SCHEMA_DOC.match(
        /### 2\.12 `filing_snapshots`[\s\S]*?(?=### 2\.12a)/
      )?.[0] || "";
      // Should not mention computation version/hash anywhere
      const hasComputationVersion =
        section2_12.includes("tax_computation_version") &&
        section2_12.includes("declared");
      const hasComputationHash =
        section2_12.includes("tax_computation_hash") &&
        section2_12.includes("declared");
      expect(hasComputationVersion).toBe(false);
      expect(hasComputationHash).toBe(false);
    });

    it("should document snapshot content hash excludes computation", () => {
      const section2_12 = SCHEMA_DOC.match(
        /### 2\.12 `filing_snapshots`[\s\S]*?(?=### 2\.12a)/
      )?.[0] || "";
      expect(section2_12).toContain("snapshot_content_hash");
      expect(section2_12).toContain("ordered BookSet entries");
      expect(section2_12).toContain("artifact hashes");
      expect(section2_12).not.toContain("computation hash");
    });

    it("should have Section 2.12c for seal protocol", () => {
      // Verify section 2.12c exists and is substantial
      const section2_12c = SCHEMA_DOC.match(
        /### 2\.12c Database-enforced[\s\S]*?(?=### 2\.13)/
      )?.[0] || "";
      expect(section2_12c.length).toBeGreaterThan(500);
      expect(section2_12c).toContain("trigger");
      expect(section2_12c).toContain("serializes");
      expect(section2_12c).toContain("dialect");
    });

    it("should maintain backward-compatible section numbering", () => {
      // Sections should still be 2.13, 2.14, etc. (not renumbered)
      expect(SCHEMA_DOC).toContain("### 2.13 `tax_computations`");
      expect(SCHEMA_DOC).toContain("### 2.14 `export_runs`");
      expect(SCHEMA_DOC).toContain("### 2.17 `external_sources`");
    });
  });
});
