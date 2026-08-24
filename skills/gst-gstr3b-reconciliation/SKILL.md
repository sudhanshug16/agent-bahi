<!-- agent-bahi-skill id="gst-gstr3b-reconciliation" version="1" -->
<!-- operation: company.status -->
<!-- operation: gst.return.readiness-report -->
<!-- operation: gst.gstr3b-schema-pack.show -->
<!-- operation: gst.gstr3b-fact.propose -->
<!-- operation: gst.gstr3b-fact.confirm -->
<!-- operation: gst.gstr3b.preview -->
<!-- operation: gst.gstr3b.prepare -->
<!-- operation: gst.gstr3b.validate -->
<!-- operation: gst.gstr3b.export -->
<!-- operation: gst.gstr3b.status -->
<!-- operation: gst.gstr3b.show -->
<!-- operation: gst.gstr3b.content -->
<!-- step: gst.return.readiness-report kind="OPERATION" operation="gst.return.readiness-report" -->
<!-- step: gst.gstr3b-schema-pack.show kind="OPERATION" operation="gst.gstr3b-schema-pack.show" -->
<!-- step: gst.gstr3b-fact.propose kind="OPERATION" operation="gst.gstr3b-fact.propose" -->
<!-- step: gst.gstr3b-fact.confirm kind="OPERATION" operation="gst.gstr3b-fact.confirm" -->
<!-- step: gst.gstr3b.preview kind="OPERATION" operation="gst.gstr3b.preview" -->
<!-- step: gst.gstr3b.prepare kind="OPERATION" operation="gst.gstr3b.prepare" -->
<!-- step: gst.gstr3b.validate kind="OPERATION" operation="gst.gstr3b.validate" -->
<!-- step: gst.gstr3b.export kind="OPERATION" operation="gst.gstr3b.export" -->
<!-- step: gst.gstr3b.status kind="OPERATION" operation="gst.gstr3b.status" -->
<!-- step: gstn-gstr3b-submit kind="EXTERNAL" -->

# GST GSTR-3B reconciliation

Inspect `company.status` first: start with the GST focus and use the exact action or blocker codes. Provide explicit tenant and BookSet scope, GSTIN, tax period, GSTR-1 readiness/artifact evidence, human-verified schema pack, and human-confirmed supplemental facts.

Preview is read-only and must show every pack-declared semantic lane, exact book/portal values, variances, tolerances, and blockers. Missing ITC eligibility, stale or mismatched GSTR-1 data, unconfirmed facts, ledger/deposit shortfalls, and unresolved variances block preparation. Never infer rates, thresholds, eligibility, or omitted portal fields.

Local validation is not official validation. Export is HUMAN-only and means neither filing nor submission; portal credentials, OTP, upload, and acknowledgement remain external.
