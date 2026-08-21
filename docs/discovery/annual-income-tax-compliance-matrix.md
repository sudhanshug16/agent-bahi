# Annual Income-Tax Compliance Matrix — Verified Official Baseline

**Research cutoff:** 21 August 2026  
**Effective period:** Income-tax Act 2025 and Rules 2026 from 1 April 2026
**Status:** Research baseline only; not legal advice and not implementation authority.

This matrix separates the annual tax computation artifact from Form 26. Every
date, amount, form, and eligibility claim is tied to an audit row and an
official Income Tax Department source.

## Legal Research Audit Table

| Claim ID | Authority | Source | Status | Implementation gate |
|---|---|---|---|---|
| AUDIT-001 | s63 business audit triggers | https://www.incometaxindia.gov.in/w/section-63-180 | VERIFIED for the official FAQ thresholds below | Verify taxpayer facts before Form 26 |
| AUDIT-002 | s63 profession audit trigger | https://www.incometaxindia.gov.in/documents/d/guest/form-26-faqs | VERIFIED: gross receipts exceed ₹50 lakh | Block absent/stale source snapshot |
| AUDIT-003 | Form 26 identity and timing | https://www.incometaxindia.gov.in/documents/d/guest/form-26-faqs | VERIFIED | Form 26 is s63 audit report, one month before return due date, not tax computation |
| RETURN-001 | Rule 164 form eligibility | https://www.incometaxindia.gov.in/w/rule-164-1 | OPEN | Rule 164 is not an audit rule; no form selection until verified |
| RETURN-002 | s263 due-date table | https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf | VERIFIED | 30 Nov only explicit s172-report cases; 31 Aug non-audit business/profession |
| ADVANCE-001 | s404 advance-tax liability | https://www.incometaxindia.gov.in/w/section-404-5 | VERIFIED | Any assessee, including a company, at ₹10,000 or more |
| ADVANCE-002 | s408 standard instalments | https://www.incometaxindia.gov.in/w/section-408-5 | VERIFIED | Four standard cumulative instalments |
| ADVANCE-003 | s408 presumptive branch | https://www.incometaxindia.gov.in/w/section-408-5 | VERIFIED | s408(2) branch: whole amount by 15 March; no invented eligibility threshold |
| DEPREC-001 | Tax depreciation rate source | https://www.incometaxindia.gov.in/w/rule-25-9 | VERIFIED | Rate comes from effective tax-year Rule 25 Appendix I/II |
| TAN-001 | TAN exceptions | https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf | VERIFIED | Profile/transaction-driven; no universal TAN requirement |

## Section 63 Audit and Form 26

Form 26 is the prescribed report of audit of accounts and statement of
particulars under s63 read with Rule 47. It is **not** an annual tax
computation. The product must keep a separate tax-computation artifact for
total income, rates, reliefs, credits, and net liability.

| Case | Official condition | Form 26 | Source/audit row |
|---|---|---|---|
| Business | Sales/turnover/gross receipts exceed ₹1 crore; the FAQ states the threshold increases to ₹10 crore where cash receipts and cash payments each do not exceed 5% of total receipts/payments | Mandatory | [Form 26 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-26-faqs) — AUDIT-001/AUDIT-003 |
| Profession | Gross receipts exceed ₹50 lakh | Mandatory | [Form 26 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-26-faqs) — AUDIT-002/AUDIT-003 |
| Presumptive case | Income declared lower than deemed income, or taxpayer opts out during the stated lock-in case, as described by the official FAQ | Mandatory where the FAQ condition applies | [Form 26 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-26-faqs) — AUDIT-003; retain exact section/fact snapshot |
| Voluntary audit | A taxpayer may separately obtain a voluntary audit | Not itself a s63 trigger; do not invent a threshold or treat “optional” as mandatory audit applicability | [Section 63](https://www.incometaxindia.gov.in/w/section-63-180) — AUDIT-001; product status OPEN if voluntary-audit workflow is offered |

Form 26 timing is annual and one month before the s263(1) return due date. If
the return due date is 31 October or 30 November, the FAQ gives 30 September
or 31 October respectively. Form 26 is furnished separately; it is not
attached to or accompanying the return.

Form 26 structure is **A+B+C** when accounts are audited under another law,
and **A+B+D** otherwise. Part C is the report where another-law audit exists;
Part D is the report where it does not. These structures and timing are from
the [official Form 26 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-26-faqs) (AUDIT-003).

## Section 263 Return Due Dates

The amended Act table applies from 1 April 2026. The 30 November route is only
for an assessee required to furnish the report referred to in s172. Do not
create a generic foreign-income, FPI, or AIF 30 November bucket.

| Person and condition | Due date | Official source/audit row |
|---|---:|---|
| Assessee, including applicable firm partners/spouse, required to furnish a report under s172 | 30 November | [Amended Income-tax Act PDF](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf) — RETURN-002 |
| Company, where s172 does not apply | 31 October | Same — RETURN-002 |
| Non-company assessee whose accounts are required to be audited under the Act or another law, where s172 does not apply | 31 October | Same — RETURN-002 |
| Partner of an audited firm or applicable spouse, where s172 does not apply | 31 October | Same — RETURN-002 |
| Business/profession assessee whose accounts are not required to be audited, where s172 does not apply | 31 August | Same — RETURN-002; Finance Act 2026 amendment effective 1 April 2026 |
| Any other assessee | 31 July | Same — RETURN-002 |

Rule 164 determines the return form, not audit applicability. Form selection
remains OPEN until the applicable Rule 164 source and taxpayer facts are
verified.

## Separate Tax Computation Artifact

The tax computation artifact stores total income, tax before relief, reliefs,
TDS/TCS credits, advance-tax credits, losses, depreciation, and net
liability/refund. It is separate from Form 26 and may link Form 26 as audit
evidence when s63 applies. No computation amount is generated from Form 26 or
from TDS Form 140/141 kits.

## Advance Tax: Sections 404 and 408

Section 404 says advance tax is payable by **the assessee** where tax payable
during the financial year is ₹10,000 or more. This includes companies; the
matrix must not restrict the rule to individuals, HUFs, or firms.

| Branch | Due date and amount | Source/audit row |
|---|---|---|
| Standard s408(1) instalment 1 | On or before 15 June; at least 15% of advance tax | [s408](https://www.incometaxindia.gov.in/w/section-408-5) — ADVANCE-002 |
| Standard s408(1) instalment 2 | On or before 15 September; cumulative at least 45%, less earlier payments | Same — ADVANCE-002 |
| Standard s408(1) instalment 3 | On or before 15 December; cumulative at least 75%, less earlier payments | Same — ADVANCE-002 |
| Standard s408(1) instalment 4 | On or before 15 March; whole amount, less earlier payments | Same — ADVANCE-002 |
| Verified presumptive-income branch s408(2) | Assessee declaring profits under s58(2) Table 1 or 3 pays the whole amount on or before 15 March | Same — ADVANCE-003; do not infer other presumptive cases or thresholds |

## Tax Depreciation

Rule 25(1) is the rate source: depreciation under s33(3) is calculated on the
written-down value of the block at the percentage in the effective Appendix I
table. Rule 25(3) separately routes the s33(2) power-generation case to
Appendix II. Preserve acquisition, block, use, WDV, and source inputs, but do
not freeze the tax rate at asset acquisition. Select the effective tax-year
Rule 25/Appendix rule when the tax depreciation run is prepared.

Source: [Rule 25](https://www.incometaxindia.gov.in/w/rule-25-9) (DEPREC-001).

## TAN Is Profile/Transaction Driven

Section 397(1)(a) is not a universal TAN requirement. The amended Act's
s397(1)(c) exceptions include deductions under s393(1) Tables 2(i), 3(i), and
6(ii); specified VDA-exchange cases for Table 8(vi); a resident individual or
HUF transferring immovable property under s393(2) Table 17; and notified
exceptions. Model TAN from profile and transaction facts and preserve that
exception in the effective rule snapshot.

Source: [Income-tax Act 2025 as amended by Finance Act 2026](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf) (TAN-001).

## Hard Predecessor for Every Legal Action

Every return, audit action, Form 26, tax computation, tax posting, deadline
generation, advance-tax action, payment, export, filing, depreciation posting,
or tax-credit import must first have `source_verified=true` and a non-stale
`effective_rule_snapshot` containing official source, version, effective date,
jurisdiction, and applicability facts. If either is absent or stale, or status
is **OPEN** or **TENTATIVE**, return **REVIEW/BLOCK** and perform no form
selection, computation/posting, deadline generation, payment, export, filing,
advance-tax action, Form 26, or tax-depreciation posting.

| Audit ID | Control | Official basis | Status/gate |
|---|---|---|---|
| ANNUAL-GATE-001 | Source verification and effective snapshot precede every legal action | s63, s172, s263, s404, s408, Rule 25, Form 26 FAQ | VERIFIED product control; missing/stale/OPEN/TENTATIVE → REVIEW/BLOCK |

## Open Items

- Rule 164 return-form codes and structures remain OPEN.
- Voluntary-audit product handling remains OPEN; no statutory trigger is
  inferred from the word “optional”.
- Exact relief, loss, tax-regime, and taxpayer-specific computation inputs must
  be separately verified before computation.
- Any old-law period through 31 March 2026 uses its own source snapshot; this
  matrix does not retroactively apply the 2025 Act.
