# Payroll Scope

## Purpose and boundary

Full India payroll is an active, first-class workstream after the core ledger
foundations. The parity target is based on the breadth documented on official
Zoho Payroll India help and pricing pages. It is a product target, not a claim
that every listed Zoho behavior, integration, or edge case has been confirmed
as identical. No Zoho MCP was used.

The statutory research baseline is [Payroll Compliance Matrix](payroll-compliance-matrix.md).
It is research documentation, not legal advice and not implementation. The
matrix uses a research cutoff of 20 August 2026 and separates confirmed
official facts, product validation policy, tenant configuration, and open
research.

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
- payroll TDS, declarations, investment proofs, a certificate selected as
  Form 16 or Form 130 by governing period and rule version, and quarterly TDS
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
come into force on 1 April 2026. Salary paid through March 2026 remains under
section 192 of the Income-tax Act, 1961. Salary paid from April 2026 for Tax
Year 2026-27 is under section 392(1) of the Income-tax Act, 2025. The
[TDS compliance guidance](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tds-compliance)
states that salary TDS follows the date of payment: March 2026 salary uses
the old Act and April 2026 salary uses the new Act.

The engine must select the governing Act, rule version, forms, rates, and
effective dates from the payroll period and salary payment event. The employee
certificate is selected by that period: Form 16 is the old-law certificate for
periods governed by the 1961 Act, while Form 130 is the certificate for salary
TDS under the 2025 Act/2026 Rules. The new-law certificate is due on 15 June
immediately following the tax year. New-law employee investment/evidence
claims use Form 124 under Rule 205; no old-form mapping is assumed here.

Form 138, earlier Form 24Q, is the quarterly salary TDS statement for the new
framework. Its Q1/Q2/Q3/Q4 due dates are 31 July, 31 October, 31 January, and
31 May respectively. It requires a valid TAN and the current RPU/FVU
workflow. TDS payment, statement filing, acceptance/rejection, and
acknowledgement are separate tracked outcomes. See the [Form 138 user
manual](https://www.incometax.gov.in/iec/foportal/newformpage/forms/form138-um)
and the full [payroll compliance matrix](payroll-compliance-matrix.md) for
the transition table and gates.

PF, ESI, PT, and LWF are jurisdiction modules, not global constants. EPF
establishment coverage generally begins at 20 employees; this is not a
company-versus-sole-proprietorship shortcut. The ₹15,000 figure is a
membership/contribution wage-ceiling baseline with exceptions and
existing/voluntary coverage, not the headcount trigger. The baseline EPF
contributions are 12% employee and 12% employer, with allocation and
exceptions selected by effective-dated rules; the employer share cannot be
deducted from the employee. Monthly ECR/payment is due by the 15th after
month close, and filing plus fund transfer remain separate outcomes. See the
[official EPFO FAQ](https://www.epfindia.gov.in/site_en/FAQ.php/FAQ.php),
[Employer Information Booklet](https://www.epfindia.gov.in/site_docs/PDFs/MiscPDFs/Employer_Information_Booklet.pdf),
and [official EPFO parliamentary answer](https://www.epfindia.gov.in/site_docs/PDFs/PQ_PDFs/PQ_WinterSession_2019_RS_English.pdf).

For ESI, the establishment threshold can be 10 or 20 depending on jurisdiction
and establishment type, and the employee wage ceiling baseline is ₹21,000.
Leave rates, exact due dates, returns, and exceptions remain open until
independently confirmed from the official source. PT and LWF are
state-specific: there is no pan-India rate, frequency, due date, or form. The
[official ESIC publication](https://www.esic.gov.in/attachments/publicationfile/c6a6b058ec91e276a9dbd750326d5598.pdf)
is the source boundary for ESI research; the matrix lists missing tenant
inputs that must block a deterministic run.

Payslip, wage, attendance, overtime, and deduction-register support is in
scope. The current [Labour Ministry Compliance Handbook](https://www.labour.gov.in/static/uploads/2026/02/83978455025732b99b0165def80ab171.pdf)
is employer guidance: it says attendance/muster, wage, overtime, and
fines/deductions registers must be maintained, wage slips issued on or before
wage payment, and records preserved five years. The handbook says the
governing code/rules prevail, so a longer or different obligation may apply.
Five years is not an instruction to delete older records.

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
