<!-- agent-bahi-skill id="source-staging" version="1" -->
<!-- operation: company.status -->
<!-- operation: source-staging.preview -->
<!-- operation: source-staging.stage -->
<!-- operation: source-staging.status -->
<!-- status-focus: source-staging -->
<!-- step: source-staging.preview kind="OPERATION" operation="source-staging.preview" -->
<!-- step: source-staging.stage kind="OPERATION" operation="source-staging.stage" -->
<!-- step: source-staging.status kind="OPERATION" operation="source-staging.status" -->

# Source staging

Inspect `company.status` first for the explicit tenant and BookSet scope. Preview one supported source family with `source-staging.preview`, retaining only the redacted source hash, parser/schema fingerprints, safe normalized facts, and typed blockers. Preview never mutates the database.

Stage only after human review of the exact preview with `source-staging.stage`. Staging writes immutable source evidence and normalized facts; it never creates parties, invoices, receipts, bank statements, journals, tax cases, matches, adjustments, closings, filings, or submissions.

Use `source-staging.status` to inspect the immutable report. Treat UNKNOWN_MISSING coverage, rejected rows, unresolved facts, unsafe paths, schema mismatches, missing PDF extraction, and extractor failures as blockers. The result explicitly proves zero journal postings and never means a government submission.

Supported parser IDs are explicit source families only: SCB-derived transaction CSV and the six Munim PDF report/view families. PDF staging requires the bounded `pdftotext` extractor (or the command named by `AGENT_BAHI_PDFTOTEXT`); missing or failed extraction is a blocker.
