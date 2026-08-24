<!-- agent-bahi-skill id="bank-reconciliation" version="1" -->
<!-- operation: company.status -->
<!-- operation: bank-statement.list -->
<!-- operation: source.inspect-file -->
<!-- operation: bank-statement.import-file -->
<!-- operation: bank-statement.import -->
<!-- operation: bank-match.candidates -->
<!-- operation: bank-match.confirm -->
<!-- operation: bank-reconciliation.status -->
<!-- operation: bank-statement.get -->
<!-- operation: invoice.outstanding -->
<!-- step: source.inspect-file kind="OPERATION" operation="source.inspect-file" -->
<!-- step: bank-statement.import-file kind="OPERATION" operation="bank-statement.import-file" -->
<!-- step: bank-statement.import kind="OPERATION" operation="bank-statement.import" -->
<!-- step: bank-match.candidates kind="OPERATION" operation="bank-match.candidates" -->
<!-- step: bank-match.confirm kind="OPERATION" operation="bank-match.confirm" -->
<!-- step: bank-reconciliation.status kind="OPERATION" operation="bank-reconciliation.status" -->

# Bank reconciliation

Inspect `company.status` first, then use explicit tenant and BookSet scope and
the exact statement identity. For local files, use the operator-configured
source root and `source.inspect-file` before `bank-statement.import-file`.
Import source evidence, inspect non-mutating
candidates, and preview the exact line/target before the HUMAN confirmation
gate. Preserve source hashes, confirmation evidence, and typed stale-plan or
confirmation blockers. Unmatched items remain visible for investigation; do
not invent a document or silently post a fee. Export never means government
submission.
