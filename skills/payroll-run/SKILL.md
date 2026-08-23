<!-- agent-bahi-skill id="payroll-run" version="1" -->
<!-- operation: company.status -->
<!-- operation: payroll.employee.list -->
<!-- operation: payroll.register -->
<!-- operation: payroll.pay-run.prepare -->
<!-- operation: payroll.pay-run.approve -->
<!-- operation: payroll.pay-run.post -->
<!-- operation: payroll.payslip.list -->
<!-- operation: payroll.bank-export.create -->
<!-- step: payroll.employee.list kind="OPERATION" operation="payroll.employee.list" -->
<!-- step: payroll.pay-run.prepare kind="OPERATION" operation="payroll.pay-run.prepare" -->
<!-- step: payroll.pay-run.approve kind="OPERATION" operation="payroll.pay-run.approve" -->
<!-- step: payroll.pay-run.post kind="OPERATION" operation="payroll.pay-run.post" -->
<!-- step: payroll.register kind="OPERATION" operation="payroll.register" -->
<!-- step: payroll.payslip.list kind="OPERATION" operation="payroll.payslip.list" -->
<!-- step: payroll.bank-export.create kind="OPERATION" operation="payroll.bank-export.create" -->
<!-- step: bank-payment kind="EXTERNAL" -->

# Payroll run

Inspect `company.status` first and use explicit tenant and BookSet scope.
Prepare a frozen run with explicit facts and source-backed rules, preview it,
then use the HUMAN approval gate before posting. Preserve calculation hashes,
register/payslip evidence, and typed claim or rule blockers. The bank artifact
is an export only; it never means payment submission. Surface blockers instead
of changing frozen facts silently.
