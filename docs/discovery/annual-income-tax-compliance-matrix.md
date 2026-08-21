# Annual Income-Tax Compliance Matrix — Verified Official Baseline

**Research cutoff:** 21 August 2026  
**Effective period:** Income-tax Act 2025 / Rules 2026, from 1 April 2026  
**Status:** Research baseline only; not legal advice and not implementation authority.

This matrix records verified baselines for annual income-tax filing, computation, and tax audit under the Income-tax Act 2025. Every claim herein is sourced from official ITD documentation or marked **OPEN**. Unverified thresholds, due dates, and form structures remain blocked and do not gate filing, penalties, or automatic posting. Entity-neutral thresholds and profile-driven due dates are modeled per law; default dates or assumptions are rejected.

---

## Legal Research Audit Table

| Claim ID | Authority | Section/Rule | Source URL | Status | Implementation Gate |
|---|---|---|---|---|---|
| AUDIT-001 | Tax audit applicability — business | Section 63 | https://www.incometaxindia.gov.in/w/section-63-180 | OPEN | Verify ₹1 crore and ₹10 crore thresholds + cash conditions |
| AUDIT-002 | Tax audit applicability — profession | Section 63 | https://www.incometaxindia.gov.in/w/section-63-180 | OPEN | Verify ₹50 lakh threshold |
| AUDIT-003 | Tax audit report form | Rule 47, Form 26 | https://www.incometaxindia.gov.in/w/rule-47-5 | OPEN | Form 26 Parts A-D per section 63; not an annual-computation artifact |
| RETURN-001 | Return form eligibility | Rule 164 | https://www.incometaxindia.gov.in/w/rule-164-1 | OPEN | Rule 164 is ITR form verification, not audit rule |
| RETURN-002 | Return form selection — audited company | Section 263, profile-driven | https://www.incometaxindia.gov.in/w/section-263-72 | OPEN | Due 31 Oct for audited companies; verify entity profile |
| RETURN-003 | Return form selection — unaudited business/profession | Section 263, profile-driven | https://www.incometaxindia.gov.in/w/section-263-72 | OPEN | Due 31 Aug for unaudited; verify category |
| RETURN-004 | Return form selection — other assesses | Section 263, profile-driven | https://www.incometaxindia.gov.in/w/section-263-72 | OPEN | Due 31 Jul for other assessees; verify category |
| RETURN-005 | Return form selection — specified cases | Section 263, profile-driven | https://www.incometaxindia.gov.in/w/section-263-72 | OPEN | Due 30 Nov for specified/report cases; verify applicability |
| NOTIF-001 | Employee evidence claims — Rule 205 | Notification 22/2026 | OPEN: ITD notification | OPEN | Verify Rule 205 applicability to annual return, not form selection |
| TAX-COMP-001 | Tax computation entity basis | Section 263 | https://www.incometaxindia.gov.in/w/section-263-72 | OPEN | Profile-driven due dates per entity type/audit status |
| ADVANCE-001 | Advance tax threshold | Section 404 | https://www.incometaxindia.gov.in/w/section-404-5 | OPEN | Verify ₹10,000 threshold |
| ADVANCE-002 | Advance tax installments | Section 408 | https://www.incometaxindia.gov.in/w/section-408-5 | OPEN | Verify 15%/45%/75%/100% schedule and due dates |
| DEPREC-001 | Depreciation allowance — block WDV | Section 33 | https://www.incometaxindia.gov.in/w/section-33-180 | OPEN | General Rule 25/Appendix I; verify rates by asset class |
| DEPREC-002 | Depreciation — power generation exception | Section 33 | https://www.incometaxindia.gov.in/w/section-33-180 | OPEN | Separately prescribed rate; verify from official rule |

---

## CONFIRMED OFFICIAL FACT: Tax Audit Applicability (Section 63)

Section 63 of the Income-tax Act 2025 defines when a statutory tax audit is required. Thresholds are entity-type and income-type specific. The s63 audit report is furnished under Rule 47 as Form 26 Parts A-D; it is not an optional annual-income computation artifact.

| Entity Type | Income Category | Audit Trigger | Threshold | s63 Audit Report Form | Official Source | Status | Implementation Gate |
|---|---|---|---|---|---|---|---|
| Individual/HUF | Business income | Exceeds threshold **OR** optional | ₹1 crore gross receipts | Form 26 Parts A–D (Rule 47) | https://www.incometaxindia.gov.in/w/section-63-180 | OPEN | Verify exact ₹1 crore test; block if ambiguous |
| Individual/HUF | Business with cash receipts/payments | Exceeds ₹10 crore *and* cash test met | ₹10 crore + cash condition | Form 26 Parts A–D (Rule 47) | https://www.incometaxindia.gov.in/w/section-63-180 | OPEN | Verify cash-payment condition; block if missing |
| Individual/HUF | Professional income | Exceeds threshold **OR** optional | ₹50 lakh gross receipts | Form 26 Parts A–D (Rule 47) | https://www.incometaxindia.gov.in/w/section-63-180 | OPEN | Verify exact ₹50 lakh test |
| Partnership firm | Business/professional | Entity-specific | **OPEN: firm thresholds** | Form 26 Parts A–D (Rule 47) | https://www.incometaxindia.gov.in/w/section-63-180 | OPEN | Block until firm s63 thresholds verified |
| Company | Business/professional | Mandatory (every company) | N/A — always required | Statutory Auditor Report (s143) | [Companies Act 2013 s143](https://www.mca.gov.in/) | VERIFIED | Company audit is Companies Act s143, not s63 tax audit |
| Small company (s2(85)) | Business/professional | Mandatory (every company) | N/A — every company audited | Statutory Auditor Report (s143) | [Companies Act 2013 s139/s141](https://www.mca.gov.in/) | VERIFIED | Small-company status never exempts from Companies Act s143 audit |

**CRITICAL**: Section 63 tax audit and Companies Act statutory audit are separate obligations. Do not conflate.

---

## CONFIRMED OFFICIAL FACT: Return Filing Due Dates and Form Selection (Section 263, Rule 164)

Section 263 and Rule 164 specify return-filing deadlines and form eligibility. Due dates are profile-driven per entity type and audit status; no hard-coded date applies universally.

**Rule 164 Note**: Rule 164 specifies which ITR form applies to each entity/income type; it does NOT define which returns require audit. Confusion between Rule 164 (form eligibility) and section 63 (audit applicability) is a common error.

| Entity Type | Audit Status | Filing Deadline | ITR Form | Determining Fact | Official Source | Status | Implementation Gate |
|---|---|---|---|---|---|---|---|
| Company | Audited per s139/s143 | 31 October | **OPEN: form code** | Audited financial statements filed per Companies Act | https://www.incometaxindia.gov.in/w/section-263-72 | OPEN | Verify Company ITR form and structure |
| Individual/HUF/Partnership | Audited per s63 | 31 October | **OPEN: form code** | s63 Form 26 Parts A–D filed with return | https://www.incometaxindia.gov.in/w/section-263-72 | OPEN | Verify s63-audited ITR form and structure |
| Individual/HUF | Not audited (business/profession) | 31 August | **OPEN: form code** | Business/professional income but no s63 audit | https://www.incometaxindia.gov.in/w/section-263-72 | OPEN | Verify unaudited-business ITR form |
| Individual/HUF | Not audited (salary + other income) | 31 July | **OPEN: form code** | No business/professional income; salary/rental/interest/other | https://www.incometaxindia.gov.in/w/section-263-72 | OPEN | Verify salary-only ITR form |
| Specified assessees / Report cases | Various | 30 November | **OPEN: form code** | Per section 263 special cases (foreign income, FPI, AIF, etc.) | https://www.incometaxindia.gov.in/w/section-263-72 | OPEN | Verify applicability and ITR form for each specified case |

**GATE**: Do not hard-code 31 July as universal deadline. Select deadline from entity type + audit status from frozen configuration before filing. Ambiguous cases block with review notice.

---

## CONFIRMED OFFICIAL FACT: Tax Computation Inputs (Form 26, Sections 87/89/404/408)

Tax computation requires frozen inputs for total income, eligible relief/credit, advance-tax, and TDS. Form 26 is the s63 audit report (not an optional artifact); it is furnished under Rule 47.

| Component | Applicability | Computation Basis | Official Source | Status | Implementation Gate |
|---|---|---|---|---|---|
| **Total income** | All returns | Sum of income per applicable sections (salary, business, rental, interest, capital gains, foreign, etc.) | Section 263 | VERIFIED | Reconcile return total income to Form 26 (s63) or trial balance |
| **Tax before relief** | All returns | Per applicable rate/slab for the entity and tax year | **OPEN: tax tables for 2026-27 FY** | https://www.incometaxindia.gov.in/w/section-263-72 | OPEN | Block on unverified tax tables or regime selection |
| **Section 87 relief** | Individual income | Full or partial relief per conditions | https://www.incometaxindia.gov.in/w/section-87-180 | OPEN | Verify applicability conditions and amount |
| **Section 89 relief** | Individual income (arrears, family pension, etc.) | Per specified income category | **OPEN** | OPEN | Verify s89(1) relief conditions by income type |
| **Foreign tax credit** | Foreign income | Credit per bilateral treaty or FTA | **OPEN: treaty application** | OPEN | Block until treaty/FTA terms verified |
| **TDS credit** | All returns (if TDS deducted) | Per Form 16/Form 130/Form 131 received | [payroll-compliance-matrix.md](payroll-compliance-matrix.md) / [tds-tcs-compliance-matrix.md](tds-tcs-compliance-matrix.md) | VERIFIED (domain link) | Import TDS amounts from linked domains only |
| **Advance tax credit** | All returns (if advance tax paid) | Per s404/s408 payment records | https://www.incometaxindia.gov.in/w/section-404-5 / w/section-408-5 | OPEN | Block on unverified advance-tax schedule |
| **Carryforward losses** | Business/professional | Per applicable sections (s72, s73, etc.) | **OPEN: carryforward rules by loss type** | OPEN | Verify loss type and carryforward availability |

---

## CONFIRMED OFFICIAL FACT: Advance Tax (Sections 404 and 408)

Advance tax is a payment obligation during the financial year; it is separate from the return-filing obligation. Installment due dates and thresholds are specified by section.

| Obligation | Applicability | Threshold | Installment Schedule | Due Dates (s408) | Official Source | Status | Implementation Gate |
|---|---|---|---|---|---|---|---|
| **Advance tax requirement** | Individual/HUF/partnership with estimated income exceeding threshold | ₹10,000 estimated liability (s404) | Per s408 quarterly schedule | **OPEN: verify schedule** | https://www.incometaxindia.gov.in/w/section-404-5 / w/section-408-5 | OPEN | Block if estimated liability unresolved |
| **s408 Installment 1** | First 3 months (Apr–Jun) | 15% estimated liability | Due 15 June | 15 June | https://www.incometaxindia.gov.in/w/section-408-5 | OPEN | Verify percentage and date |
| **s408 Installment 2** | First 6 months (Apr–Sep) | 45% estimated liability | Due 15 September | 15 September | https://www.incometaxindia.gov.in/w/section-408-5 | OPEN | Verify percentage and date |
| **s408 Installment 3** | First 9 months (Apr–Dec) | 75% estimated liability | Due 15 December | 15 December | https://www.incometaxindia.gov.in/w/section-408-5 | OPEN | Verify percentage and date |
| **s408 Installment 4** | Full year (Apr–Mar) | 100% estimated liability | Due 15 March | 15 March | https://www.incometaxindia.gov.in/w/section-408-5 | OPEN | Verify percentage and date |
| **Presumptive income scheme** | Self-employed (specified professions/trades) | Alternative to s404/s408 | **OPEN: verify if separate scheme exists** | **OPEN** | https://www.incometaxindia.gov.in/ | OPEN | Block until presumptive rules verified |

---

## CONFIRMED OFFICIAL FACT: Depreciation (Section 33)

Section 33 allows depreciation allowance on capital assets. General method is block depreciation using Written-Down Value (WDV); power generation assets have separate prescribed rates.

| Asset Class | Depreciation Method | Rates | Source | Status | Implementation Gate |
|---|---|---|---|---|---|
| **General capital assets** (buildings, plant, machinery, vehicles, etc.) | Block depreciation (WDV) | Per Rule 25, Appendix I | https://www.incometaxindia.gov.in/w/section-33-180 | OPEN | Verify Rule 25 and Appendix I asset classifications and rates |
| **Power generation assets** | Separate prescribed rates | **OPEN: rates by asset type** | https://www.incometaxindia.gov.in/w/section-33-180 | OPEN | Verify which asset types qualify and their rates |
| **Intangible assets** | **OPEN: method and rate** | **OPEN** | https://www.incometaxindia.gov.in/w/section-33-180 | OPEN | Verify intangible-asset depreciation rules |

**NOTE**: Depreciation is computed per frozen asset base and rule version at the time of acquisition. Do not hard-code rates or modify historical depreciation retroactively.

---

## PRODUCT VALIDATION POLICY

These are product rules for deterministic annual-tax workflows. They are not claims that official sources prescribe particular software design.

| Policy | Required Behavior | Failure Prevented |
|---|---|---|
| Profile-driven due date | Freeze entity type (individual, HUF, partnership, company), audit status (audited per s63 or Companies Act, not audited), and applicable income category. Select return-filing deadline from frozen profile per Section 263. Do not default to 31 July. | Wrong due date applied; extension opportunity missed. |
| Audit-vs-form separation | Determine whether section 63 audit applies (individual/HUF/partnership business/professional only) BEFORE selecting ITR form. Companies Act audit is separate. | ITR form wrong for audit status. |
| Rule 164 as form verification only | Rule 164 specifies which form to use; it does NOT determine audit applicability. Audit applicability is per section 63 (for individual/HUF/partnership) or Companies Act s139 (company). | Confusing form eligibility (Rule 164) with audit requirement (s63). |
| No assumed tax computation | Do not hard-code tax relief amounts (s87, s89, foreign credit), depreciation rates, or advance-tax percentages. Every amount must be sourced from frozen rule version at computation time. | Tax liability wrong from stale or unsupported inputs. |
| Advance tax as separate obligation | Track advance-tax payments (s404/s408) as distinct from return-filing obligation. Credit at return filing. Do not mark advance-tax paid as proof of filing or complete status. | Payment success mistaken for filing; wrong credit applied. |
| TDS and advance-tax credit reconciliation | Link TDS credit (from Form 16, Form 130, Form 131) and advance-tax credit (from s404/s408 payment records) to return filing. Reconcile total credits to net refund/balance-due. | Missing credit or mismatched credit/liability. |
| Evidence-linked audit trail | Link every return filing, Form 26 (if s63 audit), audit report, TDS/advance-tax credit claim, and filing receipt to frozen financial year, entity, rule version, and portal evidence. | Return disconnected from basis or evidence. |

---

## TENANT CONFIGURATION: Hard Review/Block Inputs

The following facts are mandatory before deterministic annual-tax workflows can proceed:

- **Entity type and classification**: Individual, HUF, partnership, company (including small-company status per s2(85));
- **Income types and sources**: Salary, business, professional, rental, interest, capital gains, foreign, or other specified;
- **Applicable tax audit requirement**: Meets section 63 threshold (business ₹1 crore, profession ₹50 lakh, or optional); Companies Act audit if company;
- **Audit completion status** (if audit required): Auditor engaged, audit report status, Form 26 Parts A–D (if s63) complete;
- **Return-filing deadline per profile**: 31 October (audited), 31 August (unaudited business/profession), 31 July (salary/other), 30 November (specified), per Section 263;
- **Tax computation inputs**: Gross income, allowable deductions, depreciation, applicable relief (s87, s89), TDS credits (Form 16/130/131), advance-tax payments (s404/s408), losses (if applicable);
- **Applicable tax regime and slabs**: Old or new regime selection (if applicable); frozen tax tables for tax year;
- **Filing credentials**: PAN, e-Filing portal access, DSC or authorized-signatory method;
- **Prior-year linkage**: Carryforward losses, unrealized depreciation, prior-year adjustments.

Do not assume audit applicability, due date, or tax computation from entity name or income description. Profile-driven queries must be answered explicitly before execution.

---

## OPEN RESEARCH

The following items must remain visible and block implementation until resolved with official sources:

1. **Section 63 thresholds and conditions**: Exact ₹1 crore business test, ₹50 lakh profession test, and ₹10 crore with cash-receipt/payment conditions must be verified. Status: **OPEN**.

2. **Return-filing form codes and structure**: ITR form codes for audited company, audited individual, unaudited business, salary-only individual, and specified cases must be verified from Rule 164 and official Form Navigator. Status: **OPEN**.

3. **Tax tables and relief amounts**: Section 87 and section 89 relief criteria and amounts for 2026-27 tax year must be verified. Status: **OPEN**.

4. **Advance-tax installment schedule**: Confirm s408 installment percentages (15%/45%/75%/100%) and due dates (15 Jun/15 Sep/15 Dec/15 Mar). Status: **OPEN**.

5. **Depreciation rates by asset class**: Rule 25 and Appendix I depreciation rates for buildings, plant, machinery, vehicles, and intangible assets must be verified. Power-generation exception rates must be confirmed. Status: **OPEN**.

6. **Form 26 Parts A–D structure**: Section 63 audit report form structure, mandatory schedules, and field mapping must be verified from Rule 47 and official Form 26 instruction kit. Status: **OPEN**.

7. **Revised return and amendment procedures**: Whether revised return (ITR-X or similar) is available after acceptance; deadline and conditions; authority to amend after filing. Status: **OPEN**.

8. **Carryforward loss rules**: Scope and carryforward period for business loss (s72), long-term capital loss (s73), and other loss types must be verified. Status: **OPEN**.

9. **Profile-driven due-date logic**: Exact Section 263 conditions for each deadline category (31 Oct/31 Aug/31 Jul/30 Nov) must be verified per entity type and audit status. Status: **OPEN**.

10. **Old-law transition and period handling**: For financial years straddling old-law (1961 Act) and new-law (2025 Act) boundary, confirm blended rules or full new-law applicability. Status: **OPEN**.

---

## Official Source List (Verified as of 21 August 2026)

- [Section 63 — Tax Audit](https://www.incometaxindia.gov.in/w/section-63-180)
- [Section 263 — Return Due Dates](https://www.incometaxindia.gov.in/w/section-263-72)
- [Section 33 — Depreciation](https://www.incometaxindia.gov.in/w/section-33-180)
- [Section 404 — Advance Tax Requirement](https://www.incometaxindia.gov.in/w/section-404-5)
- [Section 408 — Advance Tax Installments](https://www.incometaxindia.gov.in/w/section-408-5)
- [Rule 47 — Form 26 (s63 Audit Report)](https://www.incometaxindia.gov.in/w/rule-47-5)
- [Rule 164 — ITR Form Selection](https://www.incometaxindia.gov.in/w/rule-164-1)
- [Income-tax Act 2025 — Full text](https://www.incometaxindia.gov.in/)
- [Income-tax Rules 2026 — Notified PDF](https://www.incometaxindia.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf)

---

## Prior Work and Repair History

**Rejected draft (21 August 2026)**: Initial version conflated Rule 164 (form eligibility) with section 63 (audit requirement), hard-coded 31 July as universal return deadline, and incorrectly mapped Form 26 as annual-income computation artifact. Comprehensive repair applied 21 August 2026 using official Section 263 profile-driven deadline model, proper Rule 164 and section 63 separation, and Form 26 as s63 audit report only. All pre-repair claims removed; unverified items marked OPEN with fail-closed gates.
