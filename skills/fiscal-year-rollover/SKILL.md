<!-- agent-bahi-skill id="fiscal-year-rollover" version="1" -->
<!-- operation: company.status -->
<!-- operation: period.status -->
<!-- operation: fiscal-year.rollover.status -->
<!-- operation: fiscal-year.rollover.preview -->
<!-- operation: report.close-pack.get -->
<!-- operation: fiscal-year.rollover.finalize -->
<!-- operation: fiscal-year.rollover.show -->
<!-- operation: fiscal-year.rollover.export -->
<!-- status-focus: period-close -->
<!-- step: fiscal-year.rollover.preview kind="OPERATION" operation="fiscal-year.rollover.preview" -->
<!-- step: report.close-pack.get kind="OPERATION" operation="report.close-pack.get" -->
<!-- step: fiscal-year.rollover.finalize kind="OPERATION" operation="fiscal-year.rollover.finalize" -->
<!-- step: fiscal-year.rollover.status kind="OPERATION" operation="fiscal-year.rollover.status" -->
<!-- step: fiscal-year.rollover.show kind="OPERATION" operation="fiscal-year.rollover.show" -->
<!-- step: fiscal-year.rollover.export kind="OPERATION" operation="fiscal-year.rollover.export" -->

# Fiscal Year rollover

Inspect `company.status` first, then `fiscal-year.rollover.status` for the explicit tenant and BookSet scope. India V1 accepts only one financial year from 1 April through 31 March. Preview the exact current ledger revision and retain the closing Trial Balance, P&L result, Balance Sheet, per-account opening/closing balances, and preview hash.

Finalize only after the exact full-year period is currently `CLOSED` and the latest persisted CA close pack for that period is also `CLOSED`. Use a HUMAN actor, a fresh request ID, the preview hash, the ledger revision, the close-pack manifest ID/hash, `confirm=true`, and a nonblank reason.

The rollover is a carry-forward snapshot over the continuous ledger. It creates no synthetic closing/opening journals and does not post retained earnings. The next-year Balance Sheet continues from the ledger; the next-year P&L resets by report date range.

Use `fiscal-year.rollover.show` or `fiscal-year.rollover.export` for the immutable snapshot. CSV, text, and JSON exports are deterministic local artifacts only; export never means a government submission. A changed ledger revision, reopened period, changed close pack, or stale preview fails closed and requires a new preview/revision; report the blocker and obtain a fresh revision.
