<!-- agent-bahi-skill id="tds-tcs-bookkeeping" version="1" -->
<!-- operation: company.status -->
<!-- operation: tax.register.tds -->
<!-- operation: tax.register.tcs -->
<!-- operation: tax.rule-snapshot.create -->
<!-- operation: invoice.post -->
<!-- operation: bill.post -->
<!-- operation: tax.deposit -->
<!-- status-focus: tds-tcs,compliance -->
<!-- step: tax.rule-snapshot.create kind="OPERATION" operation="tax.rule-snapshot.create" -->
<!-- step: invoice.post kind="OPERATION" operation="invoice.post" -->
<!-- step: bill.post kind="OPERATION" operation="bill.post" -->
<!-- step: tax.register.tds kind="OPERATION" operation="tax.register.tds" -->
<!-- step: tax.register.tcs kind="OPERATION" operation="tax.register.tcs" -->
<!-- step: tax.deposit kind="OPERATION" operation="tax.deposit" -->
<!-- step: statutory-return kind="NOT_IMPLEMENTED" -->
<!-- step: portal-remittance kind="EXTERNAL" -->

# TDS/TCS bookkeeping

Inspect `company.status` first: start with `agent-bahi status --focus tds-tcs` and follow its exact action or
blocker codes; use `compliance` for deadlines. Use explicit tenant and BookSet scope for
mutations and record source-backed rule facts before tax-bearing posting.
Never infer rates, thresholds, or applicability. Preview/read registers before
deposit allocation, preserve challan/evidence references, and use HUMAN gates
for rule and deposit decisions. Statutory return generation is
NOT_IMPLEMENTED; portal remittance is external. Surface typed blockers. Export
never means government submission.
