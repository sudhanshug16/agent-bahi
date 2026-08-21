# TDS/TCS Compliance Matrix — Verified Official Baseline

**Research cutoff:** 21 August 2026  
**Effective period:** Income-tax Act 2025 and Rules 2026 from 1 April 2026
**Status:** Research baseline only; not legal advice and not implementation authority.

This matrix records the statutory routing needed for non-payroll TDS and TCS.
Legacy section numbers are aliases for pre-1 April 2026 records only. Rates,
thresholds, exemptions, payee tests, and effective dates are operational only
when the current official source is verified.

## Legal Research Audit Table

| Claim ID | Authority | Section/Rule | Source URL | Status | Implementation Gate |
|---|---|---|---|---|---|
| TDS-001 | Salary TDS | Section 392(1) | https://www.incometaxindia.gov.in/w/section-392-5 | VERIFIED | Payroll contract only; never route through non-payroll forms |
| TDS-002 | Resident non-salary TDS | Section 393 | https://www.incometaxindia.gov.in/w/section-393-5 | VERIFIED | Select the exact table entry before computation |
| TDS-003 | Specified-senior-citizen TDS | Section 393(1) Table 8(iii) | https://www.incometaxindia.gov.in/w/section-393-5 | VERIFIED | Specified bank branch; Form 130/Form 138 under Rules 215/219 and ordinary Rule 218 timing; applicability remains snapshot-gated |
| TCS-001 | TCS categories | Section 394 | https://www.incometaxindia.gov.in/w/section-394-5 | OPEN | Nine groups are identified below; exact rate/condition/threshold must be snapshot-verified |
| TDS-CERT-001 | Form 130 certificate | Form 130 under Rule 215 | https://www.incometaxindia.gov.in/w/rule-215-1 | VERIFIED | s392 salary and s393(1) Table 8(iii) specified-senior-citizen branches; payroll-owned output, not salary-exclusive |
| TDS-CERT-002 | General non-salary certificate | Form 131 under Rule 215 | https://www.incometaxindia.gov.in/w/rule-215-1 | VERIFIED | Only the Rule 215 general branch |
| TDS-CERT-003 | Special non-salary certificate | Form 132 under Rule 215 | https://www.incometaxindia.gov.in/w/rule-215-1 | VERIFIED | Follows Form 141 for Tables 2(i), 3(i), 6(ii), 8(vi) |
| TCS-CERT-001 | TCS certificate | Form 133 under Rule 215 | https://www.incometaxindia.gov.in/w/rule-215-1 | VERIFIED | Rule 215 s394(1) branch |
| STMT-001 | Form 138 quarterly statement | Form 138 under Rule 219 | https://www.incometaxindia.gov.in/documents/d/guest/form-138-faqs | VERIFIED | s392 salary and s393(1) Table 8(iii) specified-senior-citizen branches; payroll-owned output, not salary-exclusive |
| STMT-002 | General non-salary quarterly statement | Form 140 under Rule 219 | https://www.incometaxindia.gov.in/w/rule-219-1 | VERIFIED | Resident general branch; applicable non-resident branch can be Form 144 |
| STMT-003 | Special challan-cum-statement | Form 141 under Rule 219 | https://www.incometaxindia.gov.in/w/rule-219-1 | VERIFIED | 30 days from end of deduction month for four listed branches |
| TCS-STMT-001 | TCS quarterly statement | Form 143 under Rule 219 | https://www.incometaxindia.gov.in/w/rule-219-1 | VERIFIED | Section 394(1) |
| DEPOSIT-001 | TDS/TCS deposit | Rule 218 | https://www.incometaxindia.gov.in/w/rule-218-1 | VERIFIED | Ordinary and special timing are separate |
| DEADLINE-001 | Ordinary quarterly statements | Rule 219 | https://www.incometaxindia.gov.in/w/rule-219-1 | VERIFIED | Forms 140/143/144 due 31 Jul, 31 Oct, 31 Jan, and 31 May following the tax year; Form 141 is the separate 30-day month-end branch |

## Section 393 Table Routing

Section 393(1) routes resident payments by table entry. These are the only
routes for the legacy aliases below; a legacy alias cannot select a form by
itself.

| Legacy alias | Transaction | Current route | Rule 215 certificate | Rule 219 statement | Source and gate |
|---|---|---|---|---|---|
| 194M | Contract, professional-service, or commission/brokerage payment by an individual/HUF branch | s393(1) Table 6(ii) | Form 132 | Form 141 | [s393](https://www.incometaxindia.gov.in/w/section-393-5), [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1), [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1); REVIEW/BLOCK until payer and transaction facts are verified |
| 194I | Rent, payer in the Table 2(i) branch | s393(1) Table 2(i) | Form 132 | Form 141 | Same official sources; REVIEW/BLOCK until payer branch is verified |
| 194I | Rent, specified-person branch | s393(1) Table 2(ii) | Form 131 | Form 140 | Same official sources; REVIEW/BLOCK until payer branch is verified |
| 194A | Interest income | s393(1) Table 5(i)–(iii) | Form 131 | Form 140, or Form 144 where Rule 219 routes the payee there | Same official sources; REVIEW/BLOCK until interest type and payee status are verified |
| 194Q | Purchase of goods | s393(1) Table 8(ii) | Form 131 | Form 140 | Same official sources; never characterize as an unregistered dealer or Table 8(vi) |
| 194LA | Compensation/consideration for compulsory acquisition of immovable property other than agricultural land | s393(1) Table 3(iii) | Form 131 | Form 140 | Same official sources; REVIEW/BLOCK until compulsory-acquisition facts are verified |
| N/A | Ordinary transfer of immovable property other than agricultural land | s393(1) Table 3(i) | Form 132 | Form 141 | Same official sources; REVIEW/BLOCK until transfer facts are verified |
| N/A | Specified senior citizen income paid by a specified bank | s393(1) Table 8(iii) | Form 130 | Form 138 | [s393](https://www.incometaxindia.gov.in/w/section-393-5), [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1), [Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1), [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1); ordinary Rule 218 timing; REVIEW/BLOCK until specified-bank, senior-citizen, income, and current-rule facts are verified |
| 194H | Commission/brokerage | Table 1(i)/(ii), or Table 6(ii) only where its facts apply | Form 131/Form 140, or Form 132/Form 141 only for Table 6(ii) | Form 140 or Form 141 | Same official sources; do not select from the legacy alias alone |

General non-salary Forms 131 and 140/144 are selected only where Rules 215
and 219 directly say so. Form 141 is not an annual or quarterly aggregate.

## Section 394 TCS Category Groups

Section 394(1) has all nine official category groups below. This matrix does
not freeze rates or thresholds where a current applicability snapshot is not
attached. Each OPEN row blocks computation, payment, export, filing, and Form
133 selection.

| s394 group | Official category | Collector | Exact condition/rate/threshold | Source | Status/gate |
|---|---|---|---|---|---|
| 1 | Sale of alcoholic liquor for human consumption | Seller | OPEN | https://www.incometaxindia.gov.in/w/section-394-5 | OPEN+BLOCK |
| 2 | Sale of tendu leaves | Seller | OPEN | https://www.incometaxindia.gov.in/w/section-394-5 | OPEN+BLOCK |
| 3 | Sale of timber or other forest produce under the statutory condition | Seller | OPEN | https://www.incometaxindia.gov.in/w/section-394-5 | OPEN+BLOCK |
| 4 | Sale of scrap | Seller | OPEN | https://www.incometaxindia.gov.in/w/section-394-5 | OPEN+BLOCK |
| 5 | Sale of minerals: coal, lignite, or iron ore | Seller | OPEN | https://www.incometaxindia.gov.in/w/section-394-5 | OPEN+BLOCK |
| 6 | Sale consideration above the statutory threshold for a motor vehicle or notified goods | Seller | OPEN | https://www.incometaxindia.gov.in/w/section-394-5 | OPEN+BLOCK |
| 7 | Remittance above the statutory threshold under the Liberalised Remittance Scheme | Authorised dealer | OPEN | https://www.incometaxindia.gov.in/w/section-394-5 | OPEN+BLOCK |
| 8 | Sale of an overseas tour programme package | Seller | OPEN | https://www.incometaxindia.gov.in/w/section-394-5 | OPEN+BLOCK |
| 9 | Use of a parking lot, toll plaza, mine, or quarry for business | Licensor or lessor | OPEN | https://www.incometaxindia.gov.in/w/section-394-5 | OPEN+BLOCK |

## Rule 218 Payment and Rule 219 Statement Routing

Rule 218's ordinary seven-day route must never be applied to the four special
branches. For Tables 2(i), 3(i), 6(ii), and 8(vi), payment and Form 141 are due
within 30 days from the **end of the month** in which deduction is made. Rule
219 separately gives Form 141 for those same four branches. Rule 215 routes the
resulting certificate to Form 132. This is a month-end rule, not a transaction-
date or generic seven-day rule. Table 8(iii) is not one of the four special
branches, so its payment, Form 138 statement, and Form 130 certificate follow
the ordinary Rule 218/219/215 routes.

| Branch | Payment | Statement | Certificate | Source |
|---|---|---|---|---|
| Ordinary TDS/TCS branch | Rule 218 ordinary branch: generally within seven days from end of month, subject to deductor type and March/Government branches | Rule 219 quarterly Form 138/140/143/144 as applicable | Rule 215 Form 130/131/133 as applicable | [Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1), [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1), [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1) |
| s393(1) Tables 2(i), 3(i), 6(ii), 8(vi) | Within 30 days from end of deduction month | Form 141 | Form 132 | Same official sources |

For ordinary quarterly statements, Rule 219 sets the same tax-year schedule
for Forms 140, 143, and 144 (and for Form 138 under the Form 138 FAQ):

| Quarter ended | Form 140 / Form 143 / Form 144 due | Form 138 due where the branch is s392 or Table 8(iii) |
|---|---|---|
| 30 June | 31 July | 31 July |
| 30 September | 31 October | 31 October |
| 31 December | 31 January | 31 January |
| 31 March | 31 May following the tax year | 31 May following the tax year |

These are ordinary quarterly statement deadlines from [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1); Form 141 remains a separate special statement due within 30 days from the end of the deduction month.

Form 131 follows the Rule 219 Form 140/144 path and is due within 15 days
from the due date for the applicable Rule 219 statement. It is not an annual
aggregate of Forms 140 and 141. Form 141 follows Form 132 instead.

## Payroll Boundary

Salary TDS under s392 is excluded from this non-payroll contract entirely.
Payroll owns s392 salary deductions and the payroll Form 130/Form 138 workflow,
but Forms 130 and 138 are not salary-exclusive: the s393(1) Table 8(iii)
specified-senior-citizen branch uses those same forms under Rules 215 and 219
with ordinary Rule 218 timing. Non-payroll Forms 131, 132, 140, 141, 143, and
144 must never contain salary TDS. An annual return may reconcile both domains,
but must not merge their source records.

## TAN Is Profile/Transaction Driven

Section 397(1)(a) is not a universal TAN requirement. The amended Act's
s397(1)(c) exceptions include a person deducting under s393(1) Tables 2(i),
3(i), or 6(ii); specified VDA-exchange cases for Table 8(vi); and a resident
individual/HUF transferring immovable property under s393(2) Table 17, plus
any notified exception. Model TAN as profile/transaction-driven and retain
the exception fact in the effective rule snapshot.

Source: [Income-tax Act 2025 as amended by Finance Act 2026](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf).

## Hard Predecessor for Every Legal Action

Every deduction, tax computation, tax posting, deadline generation, payment,
export, filing, advance-tax action, certificate, statement, Form 26, or
tax-depreciation posting must first have both `source_verified=true` and a
non-stale `effective_rule_snapshot` containing official source, rule version,
effective date, jurisdiction, and applicability facts. If either is absent or
stale, or the status is **OPEN** or **TENTATIVE**, return **REVIEW/BLOCK** and
perform no form selection, computation, posting, deadline generation,
payment, export, filing, or certificate action.

| Audit ID | Control | Official basis | Status/gate |
|---|---|---|---|
| TDS-GATE-001 | Source verification and effective snapshot precede every legal action | Sections 393/394; Rules 215/218/219 | VERIFIED product control; missing/stale/OPEN/TENTATIVE → REVIEW/BLOCK |

## Official Sources and Open Items

- [Section 393](https://www.incometaxindia.gov.in/w/section-393-5)
- [Section 394](https://www.incometaxindia.gov.in/w/section-394-5)
- [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1)
- [Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1)
- [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1)
- [Form 138 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-138-faqs)
- [Income-tax Act 2025 as amended by Finance Act 2026](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf)

OPEN items remain: exact s393/s394 rates and applicability snapshots where
not recorded above; tenant/payee facts; Government and special payment branch
facts; return/form instruction-kit details; and old-law transition details.
All remain REVIEW/BLOCK until an official, effective-dated snapshot closes
them.
