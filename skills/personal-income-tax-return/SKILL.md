<!-- agent-bahi-skill id="personal-income-tax-return" version="1" -->
<!-- operation: company.status -->
<!-- operation: tax-case.status -->
<!-- operation: tax-case.filing-snapshot.preview -->
<!-- operation: tax-case.filing-snapshot.seal -->
<!-- operation: tax-case.position.preview -->
<!-- operation: tax-case.position.generate -->
<!-- operation: tax-case.itr-eligibility.evaluate -->
<!-- operation: tax-case.itr-form.select -->
<!-- operation: tax-case.computation.preview -->
<!-- operation: tax-case.computation.generate -->
<!-- operation: tax-case.computation.approve -->
<!-- operation: tax-case.return-artifact.preview -->
<!-- operation: tax-case.return-artifact.prepare -->
<!-- operation: tax-case.return-artifact.validate -->
<!-- operation: tax-case.return-artifact.export -->
<!-- operation: tax-case.return-artifact.show -->
<!-- step: tax-case.filing-snapshot.preview kind="OPERATION" operation="tax-case.filing-snapshot.preview" -->
<!-- step: tax-case.filing-snapshot.seal kind="OPERATION" operation="tax-case.filing-snapshot.seal" -->
<!-- step: tax-case.position.preview kind="OPERATION" operation="tax-case.position.preview" -->
<!-- step: tax-case.position.generate kind="OPERATION" operation="tax-case.position.generate" -->
<!-- step: tax-case.itr-eligibility.evaluate kind="OPERATION" operation="tax-case.itr-eligibility.evaluate" -->
<!-- step: tax-case.itr-form.select kind="OPERATION" operation="tax-case.itr-form.select" -->
<!-- step: tax-case.computation.preview kind="OPERATION" operation="tax-case.computation.preview" -->
<!-- step: tax-case.computation.generate kind="OPERATION" operation="tax-case.computation.generate" -->
<!-- step: tax-case.computation.approve kind="OPERATION" operation="tax-case.computation.approve" -->
<!-- step: tax-case.return-artifact.preview kind="OPERATION" operation="tax-case.return-artifact.preview" -->
<!-- step: tax-case.return-artifact.prepare kind="OPERATION" operation="tax-case.return-artifact.prepare" -->
<!-- step: tax-case.return-artifact.validate kind="OPERATION" operation="tax-case.return-artifact.validate" -->
<!-- step: tax-case.return-artifact.export kind="OPERATION" operation="tax-case.return-artifact.export" -->
<!-- step: income-tax-submit kind="EXTERNAL" -->

# Personal income-tax return

Inspect `company.status` first and require explicit TaxCase scope and current
source/BookSet bindings. Preview before sealing, computation, and export;
preserve candidate, input, evidence, artifact, and validation hashes. HUMAN
gates own snapshot sealing, form selection, computation approval, and export.
UNKNOWN eligibility remains UNKNOWN. A local workpaper or exported artifact is
never a government submission or acknowledgement; surface typed blockers and
never guess missing evidence or tax law.
