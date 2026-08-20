# Payroll Scope

## Purpose and boundary

Full India payroll is an active, first-class workstream after the core ledger
foundations. The parity target is based on the breadth documented on official
Zoho Payroll India help and pricing pages. It is a product target, not a claim
that every listed Zoho behavior, integration, or edge case has been confirmed
as identical. No Zoho MCP was used.

## CONFIRMED OFFICIAL BASELINE

The official Zoho pages establish the following baseline capabilities and
surfaces:

- employee master and salary details: [employees](https://www.zoho.com/in/payroll/help/employer/employees/);
- employee and payroll data import: [data import](https://www.zoho.com/in/payroll/help/employer/import.html);
- salary components, fixed/variable pay, and custom formulas: [salary components](https://www.zoho.com/in/payroll/help/employer/settings/set-salary-components.html);
- employee self-service, reimbursement-proof approval, investment-proof
  approval, payroll reports, and Books/People/Expense integrations: [official
  pricing](https://www.zoho.com/in/payroll/pricing/);
- pay schedules: [pay schedule](https://www.zoho.com/in/payroll/help/employer/settings/set-pay-schedule.html);
- leave, attendance, shifts, work hours, and leave encashment inputs: [leave
  and attendance](https://www.zoho.com/in/payroll/help/employer/leave-and-attendance/);
- attendance reporting: [attendance reports](https://www.zoho.com/in/payroll/help/employer/reports/attendance-reports.html); and
- People integration: [Zoho People integration](https://www.zoho.com/in/payroll/help/employer/integrations/integrations-people.html).

These pages are evidence for the parity baseline only. They do not prove
agent-bahi has implemented or behaviorally matched each feature.

## PRODUCT DECISIONS

### Parity modules

The target includes the complete India payroll workflow:

- employee statutory master, tax identity, jurisdiction, and statutory
  enrollment profile;
- salary structures, components, allowances, deductions, perquisites, loans,
  advances, formulas, effective-dated versions, and salary revisions;
- pay schedules and payroll periods;
- attendance, leave, overtime, holidays, and loss-of-pay (LOP) inputs;
- regular, bonus, arrears, correction, and off-cycle pay runs;
- employee reimbursements and perquisites;
- draft, validation, approval, posting, locking, and controlled correction;
- payslips, wage registers, attendance/overtime/deduction registers, reports,
  and employee self-service outputs;
- bank advice and payment-file export;
- payroll TDS, declarations, investment proofs, Form 16, and quarterly TDS
  statements;
- PF, ESI, professional tax (PT), and labour welfare fund (LWF) modules; and
- full-and-final settlement, including final payables, deductions, leave
  settlement, and statutory references.

### Deterministic engine responsibilities

Computation, rule selection, formula evaluation, jurisdiction and
effective-date selection, journal generation, validation, approval gates,
posting, locking, and audit history belong in deterministic code. The engine
must freeze the payroll inputs and rule/rate versions for a pay run, generate a
balanced journal, and reproduce the same result from that frozen snapshot.
Every payable, deduction, employer contribution, remittance, filing,
payslip, and bank batch must link back to the pay run and its audit history.

Skills and integrations may gather or normalize evidence, interpret supplied
documents, resolve ambiguity with the user, and propose actions. They cannot
invent amounts, select an unsupported rule, bypass a validation or lock, or
silently post. External systems are evidence and transport boundaries; the
ledger remains the source of truth for accounting outcomes.

### Transition and statutory implementation decisions

The notified [Income-tax Rules, 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf)
come into force on 1 April 2026. For tax year 2026-27, salary TDS is handled
under section 392(1) of the Income-tax Act, 2025. The Income Tax Department's
[TDS compliance guidance](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tds-compliance)
and
[Form 138 user manual](https://www.incometax.gov.in/iec/foportal/newformpage/forms/form138-um)
describes Form 138 for quarterly TDS reporting, replacing the prior-period
Form 24Q for the new regime; the [official Form 24Q page](https://www.incometax.gov.in/iec/foportal/node/309)
remains relevant to old-period handling. This is a cautious implementation
boundary: old tax periods, corrections, and transition cases remain
versioned, and the engine must not apply a 2026 rule to an earlier period.
Form 16 remains a required employee output, with the [official Form 16 page](https://www.incometax.gov.in/iec/foportal/newformpage/form16)
as the format reference.

PF, ESI, PT, and LWF are jurisdiction modules, not global constants. As a
starting PF rule set, the official EPFO material indicates generally 20 or
more employee coverage, a ₹15,000 membership-wage ceiling, and a 12% employee
plus 12% employer baseline; encode exceptions, voluntary coverage, wage-base
definitions, and effective dates rather than hard-code these values globally.
See the [official EPFO FAQ](https://www.epfindia.gov.in/site_en/FAQ.php/FAQ.php)
and [official EPFO parliamentary answer](https://www.epfindia.gov.in/site_docs/PDFs/PQ_PDFs/PQ_WinterSession_2019_RS_English.pdf).

For ESI, the establishment threshold can be 10 or 20 depending on
jurisdiction and establishment type, and the employee wage ceiling is ₹21,000.
Do not state contribution percentages until verified from a current official
source. PT and LWF require state/jurisdiction-specific modules and effective
rules. The [official ESIC publication](https://www.esic.gov.in/attachments/publicationfile/c6a6b058ec91e276a9dbd750326d5598.pdf)
is the source to use when encoding ESI rules.

Payslip, wage, attendance, overtime, and deduction-register support is in
scope. Payroll records have a five-year product-retention target based on
current [Labour Ministry guidance](https://www.labour.gov.in/static/uploads/2026/02/83978455025732b99b0165def80ab171.pdf?v=20260609051130),
subject to any longer applicable statutory retention requirement. The [Code on
Wages](https://labour.gov.in/sites/default/files/code_on_wages.pdf) remains a
jurisdiction and effective-date source for wage-rule implementation.

## OPEN RESEARCH

The parity target does not settle the following implementation details:

- exact Zoho edge-case behavior, plan entitlements, import formats, and
  integration failure semantics;
- the complete effective-dated tax tables, surcharge/cess, regime choices,
  declarations, proof validation, Form 16 generation, and Form 138/legacy
  correction rules;
- PF wage-base exceptions and voluntary coverage, ESI establishment and
  coverage exceptions, and state PT/LWF schedules;
- overtime, leave encashment, gratuity, bonus, perquisite valuation, loan, and
  full-and-final statutory edge cases;
- bank-file formats, filing gateways, remittance acknowledgements, and
  correction/retry semantics; and
- the exact retention interaction where labour, tax, company, GST, payroll,
  or evidence rules prescribe different periods.

Every researched rule must carry its official source, jurisdiction, version or
notification identifier, and effective dates. Until resolved, the engine must
surface an explicit review or block outcome rather than infer a rate or amount.
