# TDS/TCS Compliance Matrix

**Research cutoff:** 21 August 2026
**Status:** research baseline only; not legal advice and not implementation.

This matrix records the official-source baseline for TDS (Tax Deducted at Source) and TCS (Tax Collected at Source) obligations under the Income-tax Act 2025 and Income-tax Rules 2026. It separates **CONFIRMED OFFICIAL FACT**, **PRODUCT VALIDATION POLICY**, **TENANT CONFIGURATION**, and **OPEN RESEARCH**. A blank or open cell is not permission to infer a rule.

## CONFIRMED OFFICIAL FACT: TDS baseline and scope

The governing period is selected from the obligation trigger event and the effective rule version. TDS obligations effective from 1 April 2026 are governed by sections 193–197 and section 392 of the Income-tax Act 2025, and corresponding Rules 215–220 and related rules of the Income-tax Rules 2026. Earlier periods remain under the Income-tax Act 1961.

Section 393 of the Income-tax Act 2025 specifies TDS rates for common small-business scenarios. The obligation matrix below separates payroll TDS (covered under [payroll-compliance-matrix.md](payroll-compliance-matrix.md)) from non-payroll TDS categories.

| Obligation | Trigger/applicability | Compute event | Payment due | Filing/return and due | Certificate/output and due | Required registration/config | Deterministic runtime gate | Official source | Effective period | Open uncertainty |
|---|---|---|---|---|---|---|---|---|---|---|
| **TDS — non-payroll obligations** | — | — | — | — | — | — | — | — | — | — |
| TDS on contractor/professional payments (s194M equivalent — individual/HUF technical/professional) | Payment to an individual or HUF for professional/technical services; check applicability threshold and exemption criteria | Compute TDS at section 393 rate/threshold when payment event occurs and amount/type threshold is met | Generally due within 7 days after the month in which deduction occurs, under Rule 215 | Form 141 quarterly statement; see separate Form 141 row | Form 140 TDS certificate; due date open to be confirmed from official Form 140 instruction kit | TAN registered with e-Filing portal; payee PAN or acknowledgement status; deduction month identification; governing rule version | Block if payment date, deduction month, payee identity, TDS amount calculation, or tax year/rule version is missing | [Income-tax Act 2025 — Sections 193–197](https://www.incometax.gov.in/); [Income-tax Rules 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf); [Form 140 instruction kit — OPEN: requires official MCA/ITD portal verification](OPEN) | Effective 1 April 2026 for new-law periods; older periods under 1961 Act | Exact section 393 rates, applicable thresholds, exemption criteria, and payee eligibility rules must be verified from official Form 140 kit before implementation |
| TDS on rent (s194I equivalent) | Payment of rent for immovable property (not plant/machinery); check tenant status and exemption | Compute TDS at section 393 rate/threshold | Generally due within 7 days after month end, Rule 215 | Form 141 quarterly statement | Form 140 TDS certificate | TAN; payee PAN or status; property identification; deduction month and governing rule | Block if deduction month, payee identity, property/rent amount, or rule version is unresolved | [Income-tax Act 2025](https://www.incometax.gov.in/); [Income-tax Rules 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf) | From 1 April 2026 | Exact section 393 rate, exemption thresholds, applicable property types, and payee identity verification rules remain open |
| TDS on commission (s194H equivalent) | Payment of commission to an individual or partnership; check applicability threshold | Compute TDS at section 393 rate/threshold | Due within 7 days after month end, Rule 215 | Form 141 quarterly statement | Form 140 TDS certificate | TAN; payee PAN; deduction month; governing rule version | Block if payment event, deduction month, payee identity, or rule version is missing | [Income-tax Act 2025](https://www.incometax.gov.in/); [Income-tax Rules 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf) | From 1 April 2026 | Exact section 393 commission rate, threshold, and exemption rules must be verified from official kit |
| TDS on interest (s194A equivalent) | Payment of interest on bank deposits, loans, or other instruments | Compute TDS at section 393 rate/threshold | Due within 7 days after month end, Rule 215 | Form 141 quarterly statement | Form 140 TDS certificate | TAN; payee identity/PAN; interest payment month; governing rule | Block if interest amount, payee, payment month, or rule version is missing | [Income-tax Act 2025](https://www.incometax.gov.in/); [Income-tax Rules 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf) | From 1 April 2026 | Exact section 393 rate and applicability remain open for verification |
| TDS on goods purchase (s194Q equivalent) | Purchase of goods from an unregistered dealer or supplier; check applicability amount and threshold | Compute TDS at section 393 rate/threshold | Due within 7 days after month end, Rule 215 | Form 141 quarterly statement | Form 140 TDS certificate | TAN; supplier PAN or acknowledgement; purchase document/order; deduction month; governing rule | Block if purchase event, supplier identity, deduction month, or rule version is missing | [Income-tax Act 2025](https://www.incometax.gov.in/); [Income-tax Rules 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf) | From 1 April 2026 | Exact section 393 rate, applicable goods types, threshold, and exemption rules need verification |
| TDS on benefits/perquisites | Payment of benefits or perquisites to employee or other recipient; check applicability | Compute TDS per applicable rule | Due within 7 days after month end per Rule 215 or applicable rule | Form 141 quarterly statement | Form 140 TDS certificate or payroll certificate per governing rule | TAN; payee identity; benefit/perquisite type and amount; governing rule version | Block if benefit amount, payee, payment month, classification, or rule version is missing | [Income-tax Act 2025](https://www.incometax.gov.in/); [Income-tax Rules 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf) | From 1 April 2026 | Applicability, rate, and interaction with payroll TDS remain open for verification |
| TDS on property purchase (s194LA equivalent) | Purchase of immovable property including land | Compute TDS at section 393 rate/threshold | Due within 7 days after month end, Rule 215 | Form 141 quarterly statement | Form 140 TDS certificate | TAN; seller PAN; property identification; purchase amount and month; governing rule | Block if property identification, purchase amount, seller identity, deduction month, or rule version is missing | [Income-tax Act 2025](https://www.incometax.gov.in/); [Income-tax Rules 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf) | From 1 April 2026 | Exact section 393 rate, threshold, property types in scope, and exemptions need verification |

## CONFIRMED OFFICIAL FACT: TCS baseline and scope

Section 392 and related sections of the Income-tax Act 2025 specify TCS obligations. TCS applies to goods sold by a specified person. Rules 218–220 govern TCS computation and payment.

| Obligation | Trigger/applicability | Compute event | Payment due | Filing/return and due | Certificate/output and due | Required registration/config | Deterministic runtime gate | Official source | Effective period | Open uncertainty |
|---|---|---|---|---|---|---|---|---|---|---|
| **TCS on goods sales** | Sale of goods by a person whose specified goods sales exceed the applicable turnover threshold in the preceding financial year; check applicability criteria and exemption | Compute TCS at section 392 rate/threshold | Due within 7 days after month end per Rule 218 | Form 141 quarterly statement | Form 140 TCS certificate | TAN; buyer PAN or acknowledgement; invoice/order identification; deduction month; governing rule version | Block if sale event, buyer identity, sales amount, deduction month, or rule version is missing | [Income-tax Act 2025](https://www.incometax.gov.in/); [Income-tax Rules 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf); [Section 392 specification — OPEN: requires Form 140 kit verification for goods categories](OPEN) | From 1 April 2026 | Exact section 392 rate, applicable goods categories, turnover threshold, exemptions, and buyer eligibility criteria need official verification |

## CONFIRMED OFFICIAL FACT: Form 141 quarterly TDS/TCS statement

Form 141 is the quarterly consolidated TDS/TCS statement replacing earlier 24Q/27Q variants under the new law.

| Obligation | Trigger/applicability | Compute event | Filing due date | Acceptance/filing status | Certificate/acknowledgement output | Required registration/config | Deterministic runtime gate | Official source | Effective period | Open uncertainty |
|---|---|---|---|---|---|---|---|---|---|---|
| Form 141 quarterly TDS/TCS statement | Deduction or collection during the quarter; new-law taxpayer | Aggregate all TDS/TCS for the quarter across all categories and payees | Q1 April–June: 31 July; Q2 July–September: 31 October; Q3 October–December: 31 January; Q4 January–March: 31 May of the following financial year | Filing status, acceptance/rejection, rejection reason, and portal acknowledgement are separate outputs | Quarterly statement receipt and ARN | TAN registered on e-Filing portal; current FVU/RPU version; DSC or authorized signatory method; governing rule version | Block filing if TAN, FVU/RPU version, quarter/tax year, deduction/collection data, or signatory method is missing; do not call upload success filing acceptance | [Form 141 User Manual — OPEN: official ITD portal instruction kit required](OPEN); [Income-tax Rules 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf); [Form Navigator](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-06/Navigator%201.pdf) | From 1 April 2026 | Form 141 exact structure, field mapping, rejection criteria, and correction workflow need official kit verification |

## CONFIRMED OFFICIAL FACT: Form 140 TDS/TCS certificate

Form 140 is the annual TDS/TCS certificate under the new law.

| Obligation | Trigger/applicability | Compute event | Certificate due date | Acknowledgement/correction/amendment | Evidence and output | Required registration/config | Deterministic runtime gate | Official source | Effective period | Open uncertainty |
|---|---|---|---|---|---|---|---|---|---|---|
| Form 140 TDS/TCS certificate | Deduction or collection during the financial year | Aggregate all TDS/TCS across all quarters and categories for the financial year | **OPEN: due date requires official Form 140 instruction kit verification** | Certificate issuance, correction, and amendment procedures remain open | Certificate receipt, serial number, and payee evidence | TAN; deductor/collector entity identity; payee identity; financial year; all quarterly Form 141 filings and deposit evidence | Block certificate generation if financial year, deductor identity, payee, or quarterly statement linkage is unresolved; retain quarterly receipt and deposit evidence | [Form 140 instruction kit — OPEN: requires ITD portal verification](OPEN); [Income-tax Rules 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf) | From 1 April 2026 | Exact Form 140 due date, correction workflow, amendment authority, transition treatment, and payee delivery method remain open |

## CONFIRMED OFFICIAL FACT: TDS deposit and payment

TDS payments and deposits are distinct from filing obligations.

| Obligation | Trigger/applicability | Compute event | Payment due date | Filing/return separate | Evidence and reconciliation | Required registration/config | Deterministic runtime gate | Official source | Effective period | Open uncertainty |
|---|---|---|---|---|---|---|---|---|---|---|
| TDS deposit to Government account | TDS deducted under applicable law; non-government deductor | Record deduction and deposit as separate events | Rule 215: generally within 7 days after month end; March deductions within 7 days after month end (no later than 30 April for non-government deductor) | Deposit is not filing; quarterly Form 141 is a separate outcome | Challan/payment reference, bank receipt, deposit date, and deduction month linkage | TAN, bank account for payment, challan/payment reference system, governing rule version | Block payment status if deduction month, deductor type, payment amount, challan, or remittance evidence is missing; do not mark Form 141 accepted from payment success | [Income-tax Rules 2026 — Rule 215](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf); [Tax Payments](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tax-payments) | From 1 April 2026 | Non-government deductor March deadline confirmation and government-deductor timeline remain open |

## PRODUCT VALIDATION POLICY

These are product rules for a deterministic TDS/TCS workflow. They are not claims that official sources prescribe a particular software design.

| Policy | Required behavior | Silent failure prevented |
|---|---|---|
| Period-aware rule selection | Freeze the payment date, deduction/collection event, governing Act/rule version, and financial year for each TDS/TCS obligation. Select Form 141, Form 140, and deposit timeline from the governing framework (new law from 1 April 2026; old law for earlier periods). | A new-law form or rule being applied to an old-law period, or conflicting rule versions being mixed in one return |
| Separate obligations | Track deduction/collection event, amount calculation, payment/deposit, quarterly filing, acceptance/rejection, and annual certificate as separate states with references. | A successful payment or upload being mistaken for an accepted return or certificate |
| Payee identity and scope | Do not hard-code payee eligibility, exemption, or identity verification. Retain payee PAN, acknowledgement status, and exemption claim evidence with each deduction. | A deduction or certificate being issued to a misidentified or ineligible payee |
| No unsupported rates/thresholds | Section 393 and section 392 rates, thresholds, and exemption criteria are not to be hard-coded without effective-dated official source and applicability verification. | A deduction at an unsupported or outdated rate, or an exemption being overlooked |
| Evidence-linked close | Link every deduction, deposit, quarterly filing, and certificate to the frozen financial year and audit history. Retain payment evidence, filing receipt, and quarterly linkage. | A reported TDS/TCS certificate that cannot be reconciled to quarterly filings and deposits |
| Preserve records | Retain all TDS/TCS payment evidence, deposit proof, quarterly receipts, and final certificates for the statutory preservation period. Retain longer where another obligation requires it. | Destructive cleanup removing evidence needed for later statutory, accounting, or payee query |

## TENANT CONFIGURATION: hard review/block inputs

The following facts are mandatory before deterministic TDS/TCS obligations can be resolved:

- **Deductor/collector identity and registration**: Tenant legal entity name, PAN, TAN registered on e-Filing, and entity type (individual, HUF, company, partnership, etc.);
- **Applicable rule version and effective dates**: Tax year, financial year, governing Act (2025 or 1961), and corresponding Rules (2026 or applicable old-law version) with effective dates;
- **Payment/obligation trigger event**: Date of payment, invoice, delivery, or other triggering event; applicable section and rate category (s194M, s194I, s194H, s194A, s194Q, s194LA, s392 as applicable);
- **Payee identity and eligibility**: Payee name, PAN, or acknowledgement status; exemption claim evidence where applicable; relationship to deductor;
- **Deduction/collection amount and computation**: Gross payment, applicable threshold check, exemption criteria, computed TDS/TCS amount, supporting documentation;
- **Deduction month**: Calendar month in which deduction occurred or collection happened; separate from financial year;
- **Deposit and payment evidence**: Bank account, challan reference, payment date, deposit confirmation, and reconciliation with deduction month and amount;
- **Filing credentials and workflows**: TAN login, RPU/FVU registration, DSC or authorized signatory method, and e-Filing portal access for Form 141 and Form 140 submission.

Do not infer rule applicability from payee entity form, assume a rate or threshold without verification, or mark an obligation satisfied from upload success alone.

## OPEN RESEARCH

The following items must remain visible rather than being filled with unsupported assumptions:

1. **Form 140 due date and delivery mechanism**: Official Form 140 instruction kit must specify the due date for certificate issuance to payee and any filing requirement with the portal. Current status: OPEN.

2. **Form 141 exact structure and field mapping**: Form 141 user manual and portal specification must be verified from the official ITD portal. Current status: OPEN.

3. **Section 393 TDS rates and thresholds**: Exact rates, applicable thresholds, exemption criteria, and payee eligibility rules for individual s194M, s194I, s194H, s194A, s194Q, and s194LA categories must be extracted from official Form 140 kit. Current status: OPEN.

4. **Section 392 TCS rates and goods categories**: Exact TCS rate, applicable goods categories, turnover threshold, exemptions, and buyer eligibility criteria must be verified from Form 140 kit and section 392 specification. Current status: OPEN.

5. **Payroll TDS Form 130 and Form 138 interaction with non-payroll TDS**: The boundary between payroll TDS (Form 130/Form 138 under [payroll-compliance-matrix.md](payroll-compliance-matrix.md)) and non-payroll Form 140/Form 141 must be clarified. Whether payroll deductions appear in Form 140 or remain separate in Form 130 requires official confirmation. Current status: **IMPLEMENTATION-BLOCKED** pending official Form 140 kit and payroll interaction rules.

6. **Correction, amendment, and rejection workflow**: Form 141 and Form 140 correction, amendment, rejection, and retry semantics must be verified from official kit. Current status: OPEN.

7. **Old-law period transition and legacy mapping**: For deductions in the old-law period (through 31 March 2026), verify Form 24Q, Form 16, and applicable old-law rules; confirm transition handling when new-law periods begin. Current status: OPEN.

8. **TDS claim under section 393 vs. old-law sections**: Section 393 consolidates rates; clarify whether deductions on old-law dates can use section 393 or must use the old-law section. Current status: OPEN.

## Official source list used

- [Income Tax Department — Main Portal](https://www.incometax.gov.in/)
- [Income Tax Department — TDS Compliance](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tds-compliance)
- [Income-tax Rules 2026 notified PDF](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf)
- [Income Tax Department — Form Navigator](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-06/Navigator%201.pdf)
- [Income Tax Department — Tax Payments](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tax-payments)
- [Income-tax Act 2025](https://www.incometax.gov.in/) — (specific section/provision URLs to be verified from ITD portal)

## Prior work notes

Prior workers (ro82, ro84, ro86) produced material errors and are not referenced in this baseline. This document uses only current official primary sources verified as of 21 August 2026.
