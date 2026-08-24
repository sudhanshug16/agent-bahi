<!-- agent-bahi-skill id="period-close-and-ca-pack" version="1" -->
<!-- operation: company.status -->
<!-- operation: period.status -->
<!-- operation: period.close.preview -->
<!-- operation: ledger.trial-balance -->
<!-- operation: ledger.profit-and-loss -->
<!-- operation: ledger.balance-sheet -->
<!-- operation: report.close-pack.export -->
<!-- operation: period.close -->
<!-- operation: report.close-pack.get -->
<!-- status-focus: period-close,journal-reports,compliance -->
<!-- step: period.close.preview kind="OPERATION" operation="period.close.preview" -->
<!-- step: ledger.trial-balance kind="OPERATION" operation="ledger.trial-balance" -->
<!-- step: ledger.profit-and-loss kind="OPERATION" operation="ledger.profit-and-loss" -->
<!-- step: ledger.balance-sheet kind="OPERATION" operation="ledger.balance-sheet" -->
<!-- step: report.close-pack.export kind="OPERATION" operation="report.close-pack.export" -->
<!-- step: period.close kind="OPERATION" operation="period.close" -->
<!-- step: ca-signoff kind="EXTERNAL" -->

# Period close and CA pack

Inspect `company.status` first: start with `agent-bahi status --focus period-close` and follow its exact action
codes; use `journal-reports` or `compliance` when those cards are returned.
Resolve explicit tenant/BookSet and period,
and preview the current close plan before irreversible actions. Preserve the
plan hash, ledger report hashes, close-pack section evidence, and any explicit
override. Period closure is HUMAN-only; CA review/sign-off is external. Never
claim professional sign-off from an exported pack, and surface stale-plan or
evidence blockers rather than clearing them. Export never means government
submission.
