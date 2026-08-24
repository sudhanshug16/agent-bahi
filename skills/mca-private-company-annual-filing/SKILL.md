<!-- agent-bahi-skill id="mca-private-company-annual-filing" version="1" -->
<!-- operation: company.status -->
<!-- operation: period.status -->
<!-- operation: mca.annual.package-status -->
<!-- operation: mca.form-pack.show -->
<!-- operation: mca.fact.propose -->
<!-- operation: mca.fact.confirm -->
<!-- operation: mca.annual.preview -->
<!-- operation: mca.annual.prepare -->
<!-- operation: mca.annual.validate -->
<!-- operation: mca.annual.export -->
<!-- operation: mca.annual.status -->
<!-- operation: mca.annual.show -->
<!-- operation: mca.annual.content -->
<!-- status-focus: period-close,compliance -->
<!-- step: mca.annual.package-status kind="OPERATION" operation="mca.annual.package-status" -->
<!-- step: mca.form-pack.show kind="OPERATION" operation="mca.form-pack.show" -->
<!-- step: mca.fact.propose kind="OPERATION" operation="mca.fact.propose" -->
<!-- step: mca.fact.confirm kind="OPERATION" operation="mca.fact.confirm" -->
<!-- step: mca.annual.preview kind="OPERATION" operation="mca.annual.preview" -->
<!-- step: mca.annual.prepare kind="OPERATION" operation="mca.annual.prepare" -->
<!-- step: mca.annual.validate kind="OPERATION" operation="mca.annual.validate" -->
<!-- step: mca.annual.export kind="OPERATION" operation="mca.annual.export" -->
<!-- step: mca.annual.status kind="OPERATION" operation="mca.annual.status" -->
<!-- step: mca-signature-filing kind="EXTERNAL" -->

# MCA private-company annual filing preparation

Inspect `company.status` first and use explicit tenant and BookSet scope. Confirm
the period is closed, then inspect the annual package and the exact TEST_ONLY
form pack. Propose company and governance facts with evidence, effective dates,
and provenance; a human must confirm each exact hash. Preview before preparing,
then run local validation and human-export only a current valid artifact.

MCA workpapers are immutable and one artifact is produced per form. UNKNOWN
applicability, missing evidence, open or reopened books, stale CA close packs,
unresolved obligations, and missing governance facts are blockers. MGT-7 versus
MGT-7A selection is an explicit human decision. External CA/CS signature,
certification, DSC, MCA upload, filing, and acknowledgement are outside V1;
export never means submission and must never be described as filing.
