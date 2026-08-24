<!-- agent-bahi-skill id="daily-bookkeeping" version="1" -->
<!-- operation: company.status -->
<!-- operation: book-set.scope.resolve -->
<!-- operation: journal.post -->
<!-- operation: ledger.trial-balance -->
<!-- operation: ledger.profit-and-loss -->
<!-- operation: ledger.balance-sheet -->
<!-- operation: period.status -->
<!-- operation: bank-reconciliation.status -->
<!-- status-focus: journal-reports,ar,ap,bank,expenses -->
<!-- step: journal.post kind="OPERATION" operation="journal.post" -->
<!-- step: ledger.trial-balance kind="OPERATION" operation="ledger.trial-balance" -->
<!-- step: ledger.profit-and-loss kind="OPERATION" operation="ledger.profit-and-loss" -->
<!-- step: ledger.balance-sheet kind="OPERATION" operation="ledger.balance-sheet" -->

# Daily bookkeeping

Inspect `company.status` first: start with `agent-bahi status --focus journal-reports` (then `ar`, `ap`, `bank`,
or `expenses` as indicated by the returned action codes), and resolve the exact
tenant and BookSet. Use
explicit tenant and BookSet scope for every mutation, preserve source evidence and operation
result hashes, and post only balanced entries. Preview/report reads are
deterministic; classification uncertainty is a HUMAN gate. Surface typed
blockers rather than guessing, and retain Trial Balance, Profit and Loss, and
Balance Sheet evidence for the completed day. Export never means government
submission.
