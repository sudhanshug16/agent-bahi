# Payroll Compliance Matrix

**Research cutoff:** 21 August 2026
**Status:** research baseline only; not legal advice and not implementation.

This matrix records only the official-source baseline supplied for this
discovery pass. It separates **CONFIRMED OFFICIAL FACT**, **PRODUCT VALIDATION
POLICY**, **TENANT CONFIGURATION**, and **OPEN RESEARCH**. A blank or open cell
is not permission to infer a rule. Salary TDS legal claims use the official
Income Tax Department sources for s392, Rules 215/218/219, and the official
Form 138 FAQ listed at the end.

## CONFIRMED OFFICIAL FACT: income tax and salary TDS

The governing period is selected from the salary payment event and the
effective rule version. Salary paid through March 2026 remains under section
192 of the Income-tax Act, 1961. Salary paid from April 2026 for Tax Year
2026-27 is under section 392(1) of the Income-tax Act, 2025. The Income-tax
Rules, 2026 come into force on 1 April 2026.

| Obligation | Trigger/applicability | Compute/deduct event | Payment due | Filing/return and due | Certificate/output and due | Required registration/config | Deterministic runtime gate | Official source | Effective period | Open uncertainty |
|---|---|---|---|---|---|---|---|---|---|---|
| Salary TDS — old-law period | Salary paid through March 2026; governing period is the 1961 Act | Deduct at salary payment under section 192 | Generally by the 7th after month end; March deductions by 30 April for a non-government deductor, subject to the applicable old-law snapshot | Use the old-law quarterly salary statement workflow for the governing period; retain filing and acknowledgement separately from payment | Form 16 for the period governed by the 1961 Act; due date and correction handling must follow that period's rules | TAN; old-law tax year/assessment-period mapping; employee PAN and declarations/evidence | Block if payment period, governing Act, TAN, employee tax identity, or applicable old-law rule version is missing | [Rule 30](https://www.incometaxindia.gov.in/w/rule-30-7); exact legacy filing/certificate source remains OPEN+BLOCK | Payment/credit through 31 March 2026; old-law corrections remain old-law | Exact old-law correction, return, certificate, and acknowledgement rules are not restated in this matrix |
| Salary TDS — new-law period | Salary paid from April 2026 for Tax Year 2026-27 | Deduct at salary payment under [section 392(1)](https://www.incometaxindia.gov.in/w/section-392-5); reset projection, deductions, and regime from 1 April 2026 | Generally by the 7th after month end under [Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1); March deductions by 30 April for a non-government deductor | Form 138 quarterly salary TDS statement under [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1); see separate Form 138 row | Form 130 under [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1); due 15 June immediately following the tax year | Valid TAN where required by the profile/transaction; employee tax identity; current tax/rule version | Block if payment date, governing rule version, TAN applicability, or tax computation inputs are missing | [Section 392](https://www.incometaxindia.gov.in/w/section-392-5); [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1); [Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1); [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1); [Form 138 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-138-faqs) | From 1 April 2026; Rules 2026 from 1 April 2026 | Rates, regime edge cases, arrears, corrections, and detailed certificate generation need further rule-version research |
| Specified senior-citizen TDS — s393(1) Table 8(iii) | Specified bank pays specified senior citizen income after the statutory deductions/rebate tests | Deduct under the verified s393(1) Table 8(iii) snapshot; this is not s392 salary | Ordinary Rule 218 timing; do not use the special Form 141 month-end route | Form 138 under Rule 219; Q1 31 Jul, Q2 31 Oct, Q3 31 Jan, Q4 31 May following the tax year | Form 130 under Rule 215, due 15 June immediately following the tax year | Specified bank, specified senior citizen, payee identity, current s393/rule snapshot, and TAN applicability | OPEN+BLOCK until all s393 applicability/rate/threshold facts are source-verified; Forms 130/138 are payroll-owned but not salary-exclusive | [Section 393](https://www.incometaxindia.gov.in/w/section-393-5); [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1); [Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1); [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1); [Form 138 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-138-faqs) | From 1 April 2026; exact conditions/rates/thresholds remain snapshot-gated | Do not treat this branch as salary or select Forms 140/141 |
| TDS deposit to Government account | Tax deducted under the applicable Act; non-government deductor | Record deduction and deposit as separate events | [Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1): generally on or before the 7th from month end; March deductions on or before 30 April | No filing is substituted by payment; keep challan/payment evidence separate from the quarterly statement outcome | Employee certificate must reflect deposited amounts; do not mark the certificate complete from deduction alone | TAN where required, payment account/challan workflow, governing Act/rule version | Block payment status if deduction month, deductor type, challan, or remittance evidence is missing; do not mark filing accepted from payment success | [Section 392](https://www.incometaxindia.gov.in/w/section-392-5); [Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1); [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1) | Rule 218 from 1 April 2026; old-law periods retain the corresponding old timeline | Government-deductor timing and non-salary exceptions are outside this salary baseline |
| Form 138 quarterly TDS statement | New-law s392 salary or s393(1) Table 8(iii) specified-senior-citizen TDS; Form 138 was earlier Form 24Q for salary periods | Prepare the applicable branch's quarter data after deductions are frozen | Not a payment deadline; TDS deposit remains a separate obligation | Q1 April–June: 31 July; Q2 July–September: 31 October; Q3 October–December: 31 January; Q4 January–March: 31 May of the following financial year | Filing status, acceptance/rejection, rejection reason, and acknowledgement/communication are separate outputs; retain branch identity | Valid TAN where required; current RPU; matching valid FVU; DSC where filing through DSC; s392 or s393 Table 8(iii) snapshot | Block filing if branch, TAN applicability, RPU/FVU version, tax year/quarter, upload type, or statement data is missing; do not call upload success acceptance | [Form 138 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-138-faqs); [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1); [Section 392](https://www.incometaxindia.gov.in/w/section-392-5); [Section 393](https://www.incometaxindia.gov.in/w/section-393-5) | New framework from 1 April 2026; Form 24Q remains the old-form equivalent for old-law periods | Correction workflow, final processing time, and legacy-period filing details need versioned confirmation |
| Employee investment/evidence claims | New-law salary TDS claims under section 392(5)(b) | Employee submits claims and evidence for payroll tax computation | No separate payment event; accepted claims affect salary TDS computation | Retain the claim/evidence record with the payroll period | Form 124 under Rule 205; no old-form mapping is assumed | Employee PAN/tax identity, tax year, claim category, evidence, and employer review status | Block tax computation or claim acceptance when required evidence, tax year, or review outcome is missing; never silently map Form 124 to an old form | [Form 124 note](https://www.incometaxindia.gov.in/documents/d/guest/fn-124); [Income-tax Rules, 2026 notified PDF](https://www.incometaxindia.gov.in/documents/d/guest/en-notified-it-rules-2026-20-03-2026-pdf) | From 1 April 2026 / Tax Year 2026-27 | Detailed claim validation, evidence sufficiency, and any transition treatment remain OPEN+BLOCK |
| Salary TDS certificate | Certificate follows the governing period/rule version | Generate from frozen salary TDS and deposit records | No separate payment deadline beyond the underlying TDS deposit | Link to the relevant quarterly statement receipts and deposit evidence | Form 130 under the 2025 Act/2026 Rules, due 15 June immediately following the tax year; Form 16 for periods governed by the 1961 Act | Employee identity, employer TAN where required, tax year, employment period, quarterly receipts, and deposit matching | Block output when governing period, certificate form, employee identity, or deposit matching is unresolved; select the certificate by period rather than defaulting to Form 16 | [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1); [Section 392](https://www.incometaxindia.gov.in/w/section-392-5); [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1) | Form 130 from 1 April 2026; Form 16 for old-law periods | Old-law certificate details and cross-period corrections need separate confirmation |

## CONFIRMED OFFICIAL FACT: EPF, ESI, PT, and LWF

EPF figures below are baselines, not global constants. Establishment coverage,
membership, wage base, allocation, exceptions, and effective dates must be
resolved from the tenant's actual coverage and the applicable rule version.

| Obligation | Trigger/applicability | Compute/deduct event | Payment due | Filing/return and due | Certificate/output and due | Required registration/config | Deterministic runtime gate | Official source | Effective period | Open uncertainty |
|---|---|---|---|---|---|---|---|---|---|---|
| EPF establishment coverage and membership | Establishment coverage generally begins at 20 employees; apply establishment facts and coverage orders. Do not infer coverage from company versus sole-proprietorship form | Determine covered employees and membership from effective-dated coverage, membership, and wage rules | Not applicable until contribution obligation is established | Registration/ECR workflow only after coverage is confirmed | Employee UAN/member records and applicable EPF records | Establishment registration, establishment type, headcount history, coverage order, employee membership/existing-member status, wage base, voluntary coverage choice | Hard-block when headcount history, establishment type, registration/coverage order, or employee membership status is missing; ₹15,000 must never be used as the headcount trigger | [EPFO FAQ](https://www.epfindia.gov.in/site_en/FAQ.php/FAQ.php); [EPFO Employer Information Booklet](https://www.epfindia.gov.in/site_docs/PDFs/MiscPDFs/Employer_Information_Booklet.pdf); [EPFO parliamentary answer](https://www.epfindia.gov.in/site_docs/PDFs/PQ_PDFs/PQ_WinterSession_2019_RS_English.pdf) | Effective coverage and membership rule version for the payroll month | Exact establishment categories, exemptions, voluntary coverage, existing membership, and effective-date exceptions require case-specific research |
| EPF contribution computation | Covered member; ₹15,000 is a membership/contribution wage-ceiling baseline with exceptions and existing/voluntary coverage | Deduct employee contribution of baseline 12%; compute employer baseline contribution of 12% separately; employer share cannot be deducted from employee | Monthly payment due by the 15th after month close | ECR submission is a separate tracked outcome from fund transfer | Member contribution/account credit evidence; retain employer/employee allocation evidence | EPFO registration, UAN/member status, effective wage base, applicable allocation and exception rules | Block if wage base, membership, allocation version, or exception status is missing; reject any calculation that shifts employer share to employee | [EPFO FAQ](https://www.epfindia.gov.in/site_en/FAQ.php/FAQ.php); [EPFO Employer Information Booklet](https://www.epfindia.gov.in/site_docs/PDFs/MiscPDFs/Employer_Information_Booklet.pdf); [EPFO parliamentary answer](https://www.epfindia.gov.in/site_docs/PDFs/PQ_PDFs/PQ_WinterSession_2019_RS_English.pdf) | Baseline at research cutoff; every allocation/exception must be effective-dated | Exact PF/EPS/EDLI allocation, wage-base exceptions, voluntary higher-wage contributions, and other effective-dated exceptions remain open |
| EPF ECR and fund transfer | Covered establishment with monthly EPF contribution | Freeze ECR rows and remittance amount from the payroll run | Fund transfer due by the 15th after month close | ECR filing/submission is tracked independently from payment and acknowledgement | ECR acknowledgement, payment reference, and member credit evidence are separate outcomes | Employer EPFO login/registration, ECR workflow, bank/payment reference | Block close if either ECR outcome or fund-transfer outcome is absent; do not mark the pair complete from one successful leg | [EPFO Employer Information Booklet](https://www.epfindia.gov.in/site_docs/PDFs/MiscPDFs/Employer_Information_Booklet.pdf) | Monthly wage month under the applicable EPF rule version | Correction, rejection, retry, and acknowledgement semantics need further confirmation |
| ESI establishment and employee coverage | Threshold may be 10 or 20 depending on jurisdiction and establishment type; employee wage ceiling baseline ₹21,000 | Compute/deduct only after establishment and employee coverage are confirmed | Open pending independent official confirmation for the applicable jurisdiction and establishment type | Returns and due dates open | Employee insurance records/output open | ESIC registration, jurisdiction, establishment type, employee work location, headcount history, wage history, coverage order | Hard-block when jurisdiction, establishment type, headcount history, work location, or coverage order is missing; do not infer rate or due date | [Official ESIC publication](https://www.esic.gov.in/attachments/publicationfile/c6a6b058ec91e276a9dbd750326d5598.pdf) | Effective rule and jurisdiction at the payroll period | Leave rates, contribution rates, exact due dates, returns, and exceptions are open |
| Professional tax (PT) | State-specific; applicability depends on employment/operating state and local registration/coverage | Compute/deduct only from the selected state and effective rule | Open; no pan-India due date | Open; no pan-India return/form | State output/certificate open | Every employment/operating state, employee work location, establishment type, registration, state rule version | Hard-block when state, work location, registration, or effective rule is missing; never use a pan-India PT constant | No listed official source establishes a pan-India PT rule; tenant/state authority research is required | State and effective-date specific | Rate, slab, frequency, due date, return, form, exemptions, and registration remain open |
| Labour welfare fund (LWF) | State-specific; applicability depends on state, establishment, and employee work location | Compute/deduct only from selected state and effective rule | Open; no pan-India due date | Open; no pan-India return/form | State output/certificate open | Every employment/operating state, employee work location, establishment type, registration, state rule version | Hard-block when state, work location, registration, or effective rule is missing; never use a pan-India LWF constant | No listed official source establishes a pan-India LWF rule; tenant/state authority research is required | State and effective-date specific | Rate, slab, frequency, due date, return, form, exemptions, and registration remain open |

## CONFIRMED OFFICIAL FACT: wage records

The source below is employer guidance, not a substitute for the governing code,
rules, or state rule. It says the listed registers must be maintained and
updated, wage slips issued on or before wage payment, and records preserved for
five years. A longer or different obligation may apply. The five-year point is
not a deletion rule.

| Obligation | Trigger/applicability | Compute/deduct event | Payment due | Filing/return and due | Certificate/output and due | Required registration/config | Deterministic runtime gate | Official source | Effective period | Open uncertainty |
|---|---|---|---|---|---|---|---|---|---|---|
| Attendance/muster, wage, overtime, fines/deductions registers | Employer payroll records under the Labour Ministry handbook's central-government-sphere guidance | Update records from approved payroll inputs and wage events | Not applicable | Any return is separate and not established by this handbook row | Wage slip in prescribed form on or before wage payment | Employer scope, establishment jurisdiction, wage period, attendance/overtime/deduction inputs | Block payroll close when required register inputs or wage-slip generation status is missing; retain records rather than delete at five years | [Labour Ministry Compliance Handbook for Employers](https://www.labour.gov.in/static/uploads/2026/02/83978455025732b99b0165def80ab171.pdf) | Handbook published February 2026; governing code/rules/state rule may differ | Prescribed formats, state applicability, retention longer than five years, and return obligations remain open |

## PRODUCT VALIDATION POLICY

These are product rules for a deterministic payroll workflow. They are not
claims that the official sources prescribe a particular software design.

| Policy | Required behavior | Silent failure prevented |
|---|---|---|
| Period- and branch-aware rule selection | Freeze payroll inputs, governing Act, rule/rate version, jurisdiction, and effective date for each pay run. Select Form 16/Form 130 from the governing period and branch; select Form 138/Form 24Q from the governing framework and branch. Forms 130/138 may serve s392 salary or s393(1) Table 8(iii), so they are not salary-exclusive. | A new-law form or rule being applied to an old-law period, or Table 8(iii) being misclassified as salary |
| Separate obligations | Track deduction, payment/remittance, filing/return, acceptance/rejection, acknowledgement, and certificate issuance as separate states with references. | A successful payment or upload being mistaken for an accepted return or employee certificate |
| No unsupported constants | Do not hard-code EPF, ESI, PT, or LWF rates, thresholds, due dates, forms, or exceptions without effective-dated source and tenant applicability. | A plausible-looking deduction being posted under the wrong state, establishment type, or rule version |
| Evidence-linked close | Link every deduction, employer contribution, payment, filing, acknowledgement, and employee output to the frozen pay run and audit history. | A report or certificate that cannot be reconciled to the remittance or payroll calculation |
| Preserve records | Treat five years as the handbook's stated preservation period, not a deletion instruction; retain longer where another governing obligation requires it. | Destructive cleanup removing evidence needed for a later statutory, accounting, or employee query |

## TENANT CONFIGURATION: hard review/block inputs

The following facts are mandatory before a deterministic payroll run or
statutory output. Missing values are hard **REVIEW/BLOCK** inputs, not defaults:

- every employment state and operating state for the tenant;
- each establishment's type, address/jurisdiction, and coverage order;
- headcount history by establishment and payroll period;
- registrations and identifiers: TAN, EPFO, ESIC, PT, and LWF as applicable;
- employee work location for every payroll period, including transfers;
- employee PAN/tax identity, UAN/member status, and existing/voluntary coverage
  elections where relevant;
- salary payment date, payroll period, tax year, governing Act/rule version,
  applicable tax regime, declarations, and evidence status;
- statutory wage bases, effective-dated rates/thresholds, contribution
  allocations, exemptions, and jurisdictional rule versions; and
- filing credentials/workflows and evidence references for RPU/FVU, ECR, bank
  payment, return acknowledgement, and certificate delivery.

In particular, do not infer EPF coverage from entity form, use ₹15,000 as an
establishment headcount trigger, or assign PT/LWF from an employee's home
address when the work location or state rule is unknown.

## HARD PREDECESSOR FOR EVERY LEGAL ACTION

Every payroll legal action—salary tax computation, deduction, tax posting,
deadline generation, advance-tax action, statutory payment, bank/export
artifact, statement, filing, certificate, or tax-depreciation posting—must
first have `source_verified=true` and a non-stale `effective_rule_snapshot`
containing the official source, rule version, effective date, jurisdiction,
and applicability facts. If either is absent or stale, or status is **OPEN** or
**TENTATIVE**, return **REVIEW/BLOCK**. Do not select a form, compute or post
tax, generate a deadline, pay, export, file, or generate Form 130/138.

| Audit ID | Control | Official basis | Status/gate |
|---|---|---|---|
| PAYROLL-GATE-001 | Source verification and effective snapshot precede every payroll legal action | [s392](https://www.incometaxindia.gov.in/w/section-392-5), [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1), [Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1), [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1), [Form 138 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-138-faqs) | VERIFIED product control; missing/stale/OPEN/TENTATIVE → REVIEW/BLOCK |

## OPEN RESEARCH

- Validate all 1961 Act Form 16, Form 24Q, correction, and legacy-period
  acknowledgement rules against the applicable old-law source before shipping
  a period transition.
- Confirm the complete 2025 Act/2026 Rules tax tables, regime handling,
  arrears, perquisites, declarations, Form 124 evidence review, Form 130
  generation, and Form 138 correction/retry semantics.
- Resolve EPF allocation and exception rules by effective date, including wage
  base, EPS/EDLI treatment, existing membership, voluntary coverage, and
  higher-wage elections.
- Independently confirm ESI contribution/leave rates, due dates, returns, and
  exceptions for each relevant establishment type and jurisdiction.
- Research PT and LWF state authorities for every tenant state; no pan-India
  rate, frequency, due date, return, or form is assumed.
- Confirm labour-code, central-government-sphere, and state-rule differences
  for register formats, wage-slip requirements, returns, and retention. The
  handbook is guidance and does not override the governing code/rules.

Until an open item is resolved with an applicable official source and tenant
facts, the product must surface an explicit review/block outcome rather than
invent a rate, amount, form, due date, or certificate.

## Official source list used

- [Income Tax Department — Section 392](https://www.incometaxindia.gov.in/w/section-392-5)
- [Income Tax Department — Section 393](https://www.incometaxindia.gov.in/w/section-393-5)
- [Income Tax Department — Rule 30](https://www.incometaxindia.gov.in/w/rule-30-7)
- [Income Tax Department — Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1)
- [Income Tax Department — Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1)
- [Income Tax Department — Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1)
- [Income Tax Department — Form 138 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-138-faqs)
- [Income Tax Department — Form 124 note](https://www.incometaxindia.gov.in/documents/d/guest/fn-124)
- [Income-tax Rules, 2026 notified PDF](https://www.incometaxindia.gov.in/documents/d/guest/en-notified-it-rules-2026-20-03-2026-pdf)
- [Income Tax Department — Form Navigator](https://www.incometaxindia.gov.in/Documents/draft-income-tax-rules/navigator-Income-tax-Forms-2026.pdf)
- [EPFO — FAQ](https://www.epfindia.gov.in/site_en/FAQ.php/FAQ.php)
- [EPFO — Employer Information Booklet](https://www.epfindia.gov.in/site_docs/PDFs/MiscPDFs/Employer_Information_Booklet.pdf)
- [EPFO — parliamentary answer](https://www.epfindia.gov.in/site_docs/PDFs/PQ_PDFs/PQ_WinterSession_2019_RS_English.pdf)
- [ESIC — official publication](https://www.esic.gov.in/attachments/publicationfile/c6a6b058ec91e276a9dbd750326d5598.pdf)
- [Labour Ministry — Compliance Handbook for Employers](https://www.labour.gov.in/static/uploads/2026/02/83978455025732b99b0165def80ab171.pdf)
