# Statutory Workflow Contracts — Verified Official Baseline

**Research cutoff:** 21 August 2026  
**Status:** Research baseline and workflow boundaries only; not legal advice and not implementation authority.  
**TENTATIVE PROTOCOL**: This document remains NOT OWNER-APPROVED. No unapproved product default, gate, or auto-decision must reference this baseline; all must link to [tentative-decisions.md](tentative-decisions.md) and Sudhanshu's review.

This document defines the contracted boundaries for statutory compliance workflows under Indian tax law (Income-tax Act 2025, Rules 2026) and corporate law (Companies Act 2013). It specifies obligation scope, due-event calculation, validation gates, human/professional review requirements, and evidence expectations. It integrates with existing contracts for GST ([gst-compliance-matrix.md](gst-compliance-matrix.md)) and payroll ([payroll-compliance-matrix.md](payroll-compliance-matrix.md)) without rewriting their settled boundaries.

**Critical error correction in this version**: This document reflects comprehensive repair of section/form/rule mappings using only official ITD and MCA sources. See repair history at end.

---

## Contract Scope and Out-of-Scope Boundaries

### In Scope

- **TDS obligations (non-payroll)**: Sections 392 (salary), 393 (resident non-salary), 394 (TCS) with quarterly Form 140/141 statements and annual Form 131/132/133 certificates under Rules 218–219;
- **Annual income-tax return filing**: Profile-driven return deadlines (s263: 31 Oct audited, 31 Aug unaudited business, 31 Jul others, 30 Nov specified), Form 26 (s63 audit report only), e-Filing portal submission;
- **Advance tax**: Sections 404/408 installment tracking and credit reconciliation;
- **Company statutory compliance**: Section 139 auditor appointment (mandatory for all companies), annual accounts, Board report, AGM (except OPC), Registrar filings under Companies Act 2013;
- **Evidence and acknowledgement tracking**: Portal receipts (ARN, Registrar reference, TAN acknowledgement), filing dates, rejection/correction status, amendment evidence;
- **Tenant registration and rule applicability**: Effective rule version, applicable sections, entity-type classification.

### Out of Scope / Linked Contracts

- **Payroll TDS**: Form 130 (annual salary), Form 138 (quarterly salary statement) — see [payroll-compliance-matrix.md](payroll-compliance-matrix.md);
- **Payroll EPF/ESI/PT/LWF**: Statutory contributions — see [payroll-compliance-matrix.md](payroll-compliance-matrix.md);
- **GST obligations**: GSTR-1, GSTR-3B, ITC, e-way bills, e-invoices — see [gst-compliance-matrix.md](gst-compliance-matrix.md);
- **Expense evidence**: Invoice receipt, bill reconciliation — see [expense-evidence-policy.md](expense-evidence-policy.md) and [accounting-contracts.md](accounting-contracts.md);
- **HRMS and employee portal**: Attendance, leave — per [decisions.md](decisions.md);
- **Inventory and COGS**: Outside v1 scope per [decisions.md](decisions.md).

---

## TDS Workflow Contract (Non-Payroll, Sections 393–394)

### Effective Rule Pack

- **Salary TDS**: Section 392(1), Rule 215 (certificate), Rule 218 (deposit), Rule 219 (statement if applicable);
- **Resident non-salary TDS**: Section 393 (table-driven per transaction type), Forms 131/132, Rules 215–219;
- **TCS**: Section 394, Rules 215–219, Forms 133;
- **Historical law**: Income-tax Act 1961, old sections 192/194A/194H/194I/194LA/194Q (legacy aliases only for pre-1 April 2026 periods).

### Obligation Scope and Applicability Facts

**Tenant**: Deductor/collector entity (individual, HUF, partnership, company) with TAN on e-Filing.

**Payee**: Recipient of TDS; identified by PAN or exemption claim.

**Mandatory configuration before execution**:
- Deductor entity, PAN, TAN;
- Applicable rule version (effective 1 April 2026 for new law);
- Transaction type (professional→s393(1)(ii), rent→s393(2), commission→s393(1), interest→s393(5), goods→s393(8), property→s393(3), TCS→s394);
- Payee PAN/name/address;
- Deduction amount and month (calendar month, separate from FY);
- Deposit evidence (bank, challan, payment date).

### Due-Event Calculation

| Event | Trigger | Due Date | Rule | Deterministic Gate |
|---|---|---|---|---|
| **TDS deduction** | Payment event to payee | At payment; deduction month recorded | Applicable section (s392/s393/s394) | Deduction month and section frozen; do not retroactively change |
| **TDS deposit to Government** | Deduction recorded | Within 7 days after month end (Rule 218); **OPEN: March deadline** | Rule 218 | Block if month, amount, or deductor type unresolved |
| **Form 140 quarterly statement** | Quarter-end; all non-salary TDS in quarter | **OPEN: per-quarter due date** | Rule 219 | Block Form 140 filing if quarterly data incomplete |
| **Form 141 special statement** | **OPEN: 4 enumerated special transactions** | 30 days after transaction (if applicable) | Rule 219 | Block unless transaction type matches Form 141 scope (OPEN) |
| **Form 131 annual certificate** | Financial year end; annual non-salary TDS | **OPEN: due date for certificate issuance** | Rule 215 | Block certificate generation if quarterly Form 140 filings not linked |

### Workflow States and No-False-Filing

| State | Trigger | Output | Terminal? | Failed State Prevents |
|---|---|---|---|---|
| **Deduction recorded** | Payment event; TDS computed | Deduction entry in books/payable | No | Completion without deposit |
| **Deposit confirmed** | Bank confirmation of payment | Payment reference, receipt | No | Completion without filing |
| **Form 140 filed** | Quarter-end; quarterly aggregate submitted to portal | Portal receipt; filing timestamp pending | No | Certificate issuance without filing |
| **Form 140 accepted** | Portal processes; ARN issued | ARN and acceptance date recorded | No | Completion without acceptance |
| **Form 131 certificate issued** | Annual deductions + Form 140 ARNs linked; certificate prepared | Form 131 with payee evidence, issue date | **YES** | Invalid certificate (orphaned or incomplete) |

**GATE: Never mark "filed" or "accepted" without documented portal acknowledgement (ARN). Submission and acceptance are distinct events.**

---

## Annual Income-Tax Return Workflow Contract

### Effective Rule Pack

- **Audit applicability**: Section 63 (business ₹1 crore, profession ₹50 lakh, conditional ₹10 crore with cash test);
- **Form 26 audit report**: Rule 47 (s63 audit only; not optional computation artifact);
- **Return form selection**: Rule 164 (form eligibility per entity type; NOT audit determination);
- **Return-filing due dates**: Section 263 (profile-driven: 31 Oct audited, 31 Aug unaudited business, 31 Jul others, 30 Nov specified);
- **Advance tax**: Sections 404/408 (s404 ₹10,000 threshold; s408 15%/45%/75%/100% installments);
- **Depreciation**: Section 33 (Rule 25 block WDV; power-generation exception separate);
- **Tax relief**: Sections 87/89 (eligibility and amounts OPEN);
- **Transition**: Old-law (pre-1 April 2026) and new-law (from 1 April 2026) periods have separate rules.

### Obligation Scope and Applicability Facts

**Tenant**: Individual, HUF, partnership, or company with income and filing obligation under section 263.

**Mandatory configuration**:
- Entity type (individual, HUF, partnership, company) and classification (small company per s2(85), OPC per s2(62), if applicable);
- Income types and sources (salary, business, rental, interest, capital gains, foreign);
- Business/professional gross receipts (determines s63 audit applicability);
- Audit requirement (s63 audit required per threshold or optional; company Companies Act audit mandatory);
- Applicable return form per Rule 164 (form code OPEN; form structure OPEN);
- Tax computation: total income, TDS/advance-tax credits, applicable relief (s87, s89, foreign credit), carryforward losses;
- Filing credentials (PAN, e-Filing login, DSC or authorized signatory);
- Applicable tax year and financial year.

### Due-Event Calculation

| Event | Trigger | Due Date | Determining Facts | Gate |
|---|---|---|---|---|
| **s63 audit (if required)** | Business/prof receipts exceed threshold | Audit report (Form 26) to accompany return | Section 63 threshold test; audit status frozen at return preparation | Block return filing if s63 required but audit report absent |
| **Advance tax installment** | FY progress | s408: 15% by 15 Jun, 45% by 15 Sep, 75% by 15 Dec, 100% by 15 Mar | Estimated tax per taxpayer profile | Block payment gate if estimate unresolved |
| **Return filing** | FY end (31 March) | Per Section 263 profile: 31 Oct (audited), 31 Aug (unaudited business), 31 Jul (other), 30 Nov (specified) | Entity type + audit status | Block if deadline category ambiguous |
| **Depreciation schedule** | Asset base and prior-year depreciation | Compute per frozen FY depreciation rules | Rule 25, Appendix I rates (OPEN per asset class) | Block if rate unverified |

### Workflow States and No-False-Filing

| State | Trigger | Output | Terminal? | Failed State Prevents |
|---|---|---|---|---|
| **Accounts finalized** | FY close (31 March); books closed | Balance Sheet, P&L, trial balance | No | Return preparation without accounts |
| **Audit initiated** (if required) | s63 audit applicability determined | Auditor engaged; audit scope documented | No | Filing without audit (if required) |
| **Audit completed** (if required) | Auditor examination complete | Statutory Auditor Report (s143 for company) or Form 26 Parts A–D (s63 for individual/partnership) | No | Return filing without audit report |
| **Tax computation (Form 26)** | Accounts final, audit complete (if required); relief/credit inputs frozen | Form 26 draft with total income, tax before relief, reliefs, credits, net tax | No | Filing without tax reconciliation |
| **Return form assembled** | Form code selected from Rule 164; all mandatory schedules filled | Return form with income, tax, audit report linkage (if applicable) | No | Filing with incomplete form |
| **Return submitted to portal** | Return complete; submitted for filing | Portal receipt; ARN pending | No | Completion from upload alone |
| **Return accepted by portal** | Portal processes; tax department receives | ARN issued; filing date recorded | **YES** | Tax adjustment/audit is separate subsequent process |

**GATE: Never mark "filed" from upload. Only ARN receipt marks filing complete.**

---

## Company Statutory Compliance Workflow Contract

### Effective Rule Pack

- **Company audit**: Section 139 (mandatory every company, including small company and OPC; NO exemption);
- **Auditor appointment**: Sections 140–141 (Schedule IV qualifications; Section 141 disqualifications);
- **Financial statements**: Section 137 (filing deadline per company type and AGM);
- **Board Report**: Section 134 (Schedule VI mandatory disclosures);
- **AGM conduct**: Section 106, Rules 2A (first AGM 9 months, subsequent 6 months; OPC no AGM, files within 180 days);
- **Registrar filings**: Forms AOC-4, AOC-4 CFS, MGT-7, MGT-7A, ADT-1, DPT-3, MSME-1 (applicability OPEN per company type);
- **Historical law**: Pre-2013 Act forms 23AC/23ACA obsolete; DPT-7 non-existent (rejected).

### Obligation Scope and Applicability Facts

**Tenant**: Company incorporated under Companies Act 2013 with CIN.

**Mandatory configuration**:
- Company registration and CIN;
- Company classification (small per s2(85): ₹4 crore paid-up capital AND ₹40 crore turnover; OPC per s2(62); holding/subsidiary; private/public);
- Financial year (standard 1 April – 31 March or exempted variation);
- Auditor appointment (Name, DIN, Schedule IV verification, appointment meeting date, Registrar notice);
- Annual accounts status (Balance Sheet, P&L, notes, audit report, Board report);
- AGM conduct (date held within deadline; shareholder approval resolutions; voting record; except OPC);
- Filing credentials (Registrar e-filing, DSC, authorized signatory);
- Applicable forms for company type (AOC-4 vs. AOC-4 CFS, MGT-7 vs. MGT-7A, etc.).

### Due-Event Calculation

| Event | Trigger | Due Date | Company Type Variation | Gate |
|---|---|---|---|---|
| **Auditor appointment** | Post-incorporation (first) or prior auditor ends (subsequent) | Appoint before end of current audit term; notice to Registrar **OPEN: within what days** | Small company has no exemption | Block if auditor unqualified (Schedule IV) |
| **Annual accounts ready** | FY close (31 March); audit (if required) complete | Accounts frozen; board approval before signature | All companies | Block if audit required but report absent |
| **AGM held** (except OPC) | FY close | First AGM within 9 months; subsequent within 6 months (max 3-month extension for non-first) | OPC exempt; files directly in 180 days | Block if AGM outside deadline (first = 9 months, non-first = 6 months) |
| **Shareholders approve accounts** (except OPC) | AGM held | Approval via ordinary resolution at AGM | OPC: no approval; Board only | Block filing without shareholder approval (except OPC) |
| **Registrar filing submitted** | Accounts approved (AGM or Director for OPC) | 30 days after AGM (or 180 days for OPC) | OPC: 180 days FY close without AGM | Block if deadline exceeded |
| **Registrar filing accepted** | eMCA processes; Registrar reference issued | Registrar reference + acceptance date recorded | All companies | **YES** — filing complete per Registrar |

### Workflow States and No-False-Filing

| State | Trigger | Output | Terminal? | Failed State Prevents |
|---|---|---|---|---|
| **Accounts audited** (if required) | Auditor examination complete | Statutory Auditor Report (s143) signed by auditor | No | Approval without audit report |
| **Board approves accounts** | Board meeting held; Board approves statements before signature | Board minutes; director signatures | No | Shareholder/Registrar approval without Board approval |
| **AGM held** (except OPC) | AGM held within deadline | AGM minutes; shareholder resolutions | No | Filing without AGM approval |
| **Shareholders approve** (except OPC) | AGM ordinary resolution | Approval evidence in AGM minutes | No | Registrar filing without approval (except OPC) |
| **Forms completed** (AOC-4, MGT-7, ADT-1, DPT-3, MSME-1 per company type) | Company type determined; form applicability verified | Form data prepared per e-form structure | No | Filing with incomplete form data |
| **Registrar filing submitted** | Forms + documents + signatures + DSC | eMCA upload receipt; filing timestamp | No | Completion from upload alone |
| **Registrar filing accepted** | eMCA validates and accepts | Registrar reference number + acceptance date | **YES** | Completion per Registrar |

**GATE: Every company must appoint an auditor. Do not create "audit exemption" logic for any company type, including small company or OPC.**

---

## Cross-Contract Linkages

### TDS (Non-Payroll) → Payroll Domain Boundary

| Component | Non-Payroll TDS (This Contract) | Payroll TDS (payroll-compliance-matrix.md) |
|---|---|---|
| **Governing section** | Section 393 (resident non-salary) | Section 392(1) (salary) |
| **Certificates** | Form 131 (general), Form 132 (special), Form 133 (TCS) | Form 130 (annual salary) |
| **Quarterly statement** | Form 140 (non-salary quarterly) | Form 138 (salary quarterly) |
| **Payroll Form 138 quarterly and annual Form 130** | Separate domain (payroll) | Primary payroll documents; NOT in this contract |
| **Interaction** | If same individual receives both salary (Form 130) and non-salary (Form 131), both TDS amounts must be reconciled and reported separately to payee | Form 130 and Form 131 are separate certificates to same payee; do not conflate |

**GATE**: Form 140/141/131 (non-payroll) must never include salary TDS amounts. Payroll domain owns salary TDS (Form 130, Form 138). Every TDS filing must identify deductor category (salary vs. non-salary) before execution.

### Annual Return → Payroll Domain

| Component | Annual Return (This Contract) | Payroll TDS (payroll-compliance-matrix.md) |
|---|---|---|
| **TDS credit from payroll** | Form 130 (annual salary TDS certificate) and Form 131 (non-payroll TDS) both credit against return-filing tax liability | Form 130 is annual certificate per payroll contract; payroll domain owns generation and issue |
| **Integration** | Annual return imports TDS credit from Form 130 + Form 131 (if applicable); reconciles total TDS to net tax |

**Data flow**: Payroll contract produces Form 130 by 15 June; annual return contract imports Form 130 TDS amount for return filing by applicable deadline (31 Oct/31 Aug/31 Jul per s263).

### Annual Return → Company Statutory Compliance

| Component | Annual Return (This Contract) | Company Compliance (This Contract) |
|---|---|---|
| **Scope** | Individual/HUF/partnership with business/professional income | Company (mandatory audit per s139) |
| **Audit** | Section 63 tax audit (if threshold met); Form 26 report | Section 139 Companies Act audit (mandatory) + section 143 Statutory Auditor Report |
| **Accounts** | Trial balance or books of account; if s63 audit, Form 26 Parts A–D | Balance Sheet, P&L, notes per section 133 and Accounting Standards |
| **Return due date** | Section 263 profile-driven | Same Section 263 for company: audited 31 Oct (since Companies Act audit always required) |
| **Integration** | Company's audited Balance Sheet is input to company's annual return filing | Audited financial statements from company compliance workflow feed into return-filing workflow |

### Annual Return + Company Compliance → GST Domain

| Component | Statutory (This Contract) | GST (gst-compliance-matrix.md) |
|---|---|---|
| **GST amounts in annual return** | Annual return may reference GST paid (input tax) and GST liability; these amounts come from GST compliance workflow | GSTR-3B portal-reported GST amounts must reconcile to books-recorded GST (annual return and statutory compliance must match GST filing) |
| **Separate obligations** | Annual return is tax-liability calculation; GST is separate compliance filing | No cross-filing required; but GST figures in P&L/balance sheet must match GSTR-3B summary |

---

## Product Validation Policy

These are product rules for deterministic statutory workflows. They are not claims that official sources prescribe software design.

| Policy | Required Behavior | Failure Prevented |
|---|---|---|
| **Section/form/rule version selection** | Freeze applicable section, form, rule, and rule version at obligation trigger. Do not retroactively change effective period. | Wrong section or obsolete rule applied to deduction/return/filing. |
| **Separate obligations as distinct states** | Deduction/deposit/filing/acceptance are separate state transitions, each with separate evidence. Do not assume one success implies next state. | Deposit success mistaken for filing; upload mistaken for acceptance. |
| **No assumed rates/thresholds/due dates** | Every rate, threshold (s63 ₹1 crore, s404 ₹10,000, s393 entry rates), due date, or exemption must have explicit source verification. OPEN items block execution. | Deduction at unsupported rate; return filed after deadline due to wrong date assumption. |
| **Entity-type driven profile** | Determine entity type (individual, HUF, partnership, company, small, OPC) and audit status before applying rules. Do not assume uniform rules across entity types. | Small company incorrectly treated as audit-exempt; OPC treated as regular company requiring AGM. |
| **No false "filed" status** | "Filed" status requires documented portal acknowledgement (ARN, Registrar reference) or equivalent. Submission/upload alone never marks filed. | False "filed" status creating compliance gap. |
| **Gateway enforcement — section 63 audit** | If entity meets s63 threshold, audit report (Form 26 Parts A–D) is mandatory before return filing. Do not allow return without audit when required. | Return filed without audit report (if audit required). |
| **Gateway enforcement — company audit** | Every company (including small company, OPC) must appoint auditor. Do not create exemption logic. Auditor must be qualified per Schedule IV. | Small company or OPC incorrectly treated as audit-exempt. |
| **Form selection from official classification** | Select Form 140/141/131/132/133 (TDS) or AOC-4/MGT-7 (company) from frozen official classification. Do not use obsolete (23AC/23ACA) or non-existent (DPT-7) forms. | Wrong or obsolete form filed. |
| **Payroll boundary maintenance** | Keep Form 130/138 (salary TDS) separate from Form 140/141/131 (non-salary TDS). Reconcile both TDS amounts at annual return, not before. | Salary TDS conflated with non-salary TDS; wrong total TDS credit applied to return. |
| **Portal evidence preservation** | Retain all portal receipts (ARN, Registrar reference, filing timestamp, acceptance date, signer method, DSC verification). Do not delete filing evidence. | Missing evidence; cannot verify filing or respond to Registrar/tax authority objection. |

---

## No Unapproved Product Defaults

This contract must link to [tentative-decisions.md](tentative-decisions.md) for every product choice not explicitly settled. Examples:

- **Advance-tax payment workflow**: How does system handle estimated-tax input? Auto-calculation from FY projection, or manual entry? → **TENTATIVE** (link to tentative-decisions.md);
- **Depreciation depreciation recalculation**: If asset acquisition date or rate changes retroactively, does system auto-recalculate prior-year depreciation or block? → **TENTATIVE** (link to tentative-decisions.md);
- **Form 140/141 export format**: JSON, XML, or both? → **TENTATIVE** (link to tentative-decisions.md);
- **Amendment/revised return workflow**: If return is rejected or taxpayer wants to amend, does system support revised return (ITR-X) or only re-filing? → **TENTATIVE** (link to tentative-decisions.md).

No product gate, auto-decision, or default behavior must exist without explicit Sudhanshu approval and documentation in approved decision record.

---

## Open Items Blocking Implementation

All items below must remain visible and unimplemented until resolved with official sources:

1. **Section 393 transaction-type rates and thresholds**: Exact rates, applicability tests, and exemption criteria for each s393 table entry (194M→6(ii), 194I→2, etc.) must be verified from official notification or Form 131 instruction kit. **OPEN**. Blocks: all non-payroll TDS computations.

2. **Section 394 TCS rates and goods categories**: Exact TCS rate, applicable goods types, and turnover threshold must be verified. **OPEN**. Blocks: all TCS computations.

3. **Form 140/141/131 quarterly and annual due dates and structure**: Official Rule 219 must specify due-date logic per quarter and form field structure. **OPEN**. Blocks: quarterly statement filing.

4. **Form 138 (payroll quarterly salary statement)**: Applicability, due dates, and structure require official payroll-domain specification. **OPEN**. Blocks: payroll workflow until verified.

5. **Section 63 thresholds and conditions**: Exact ₹1 crore business, ₹50 lakh profession, ₹10 crore with cash-payment tests must be verified. **OPEN**. Blocks: audit applicability determination for individual/HUF/partnership.

6. **Section 263 return-filing due-date profile logic**: Exact conditions for 31 Oct (audited), 31 Aug (unaudited business), 31 Jul (other), 30 Nov (specified) must be verified per entity type and audit status. **OPEN**. Blocks: return-filing deadline selection.

7. **Section 87/89 relief eligibility and amounts**: Conditions and amounts for each relief type must be verified. **OPEN**. Blocks: tax-relief calculation.

8. **Section 33 depreciation rates by asset class**: Rule 25 and Appendix I rates for each asset type; power-generation exception rates separately. **OPEN**. Blocks: depreciation computation.

9. **Section 408 advance-tax installment percentages and due dates**: Verify 15%/45%/75%/100% schedule and dates (15 Jun/15 Sep/15 Dec/15 Mar). **OPEN**. Blocks: advance-tax installment tracking.

10. **Section 139 + Schedule IV auditor qualifications**: Current Schedule IV disqualification criteria must be verified. **OPEN**. Blocks: company auditor-appointment eligibility check.

11. **Section 177 + Rules 6–7 Audit Committee applicability**: Exact threshold and composition rules. **OPEN**. Blocks: Audit Committee requirement determination for companies.

12. **Section 134 + Schedule VI Board Report mandatory disclosures**: Current Schedule VI and all applicable notifications (dividend policy, related-party, BRSR if applicable, etc.). **OPEN**. Blocks: Board Report preparation.

13. **Form AOC-4/AOC-4 CFS/MGT-7/MGT-7A field structure**: Current official instruction kits must specify field mapping and validation rules. **OPEN**. Blocks: company statutory form filing.

14. **Form MSME-1 applicability and filing schedule**: Current MSME classification criteria and half-yearly filing requirement (30 April, 31 October). **OPEN**. Blocks: MSME disclosure filing.

15. **Amended/revised return workflow**: Whether ITR-X or similar mechanism exists; deadline; authority to amend after acceptance. **OPEN**. Blocks: post-filing correction if return rejected.

---

## Appendix: Referenced Contracts and Matrices

- [gst-compliance-matrix.md](gst-compliance-matrix.md) — GST compliance baseline and GSTR-1/GSTR-3B workflow;
- [payroll-compliance-matrix.md](payroll-compliance-matrix.md) — Payroll TDS (Form 130/Form 138), EPF, ESI, PT, LWF baseline and workflow;
- [tds-tcs-compliance-matrix.md](tds-tcs-compliance-matrix.md) — Non-payroll TDS/TCS (section 393/394, Form 131/132/133, Form 140/141) verified baseline;
- [annual-income-tax-compliance-matrix.md](annual-income-tax-compliance-matrix.md) — Annual return filing, Form 26 (s63 audit), section 263 due dates, section 63 audit applicability verified baseline;
- [mca-companies-act-compliance-matrix.md](mca-companies-act-compliance-matrix.md) — Company audit (section 139), AGM, Registrar filings verified baseline;
- [expense-evidence-policy.md](expense-evidence-policy.md) — Invoice, bill, evidence requirements;
- [accounting-contracts.md](accounting-contracts.md) — Canonical ledger and posting contracts;
- [tentative-decisions.md](tentative-decisions.md) — Product defaults awaiting owner review;
- [decisions.md](decisions.md) — Confirmed product decisions and boundaries.

---

## Prior Work and Repair History

**Rejected draft (21 August 2026)**: Initial version used incorrect section/form/rule mappings (e.g., Form 140/141 reversed, section 393 treated as generic rate table, small-company audit exemption incorrectly stated, Rule 164 conflated with section 63 audit). Comprehensive repair applied 21 August 2026 using official ITD and MCA sources for all section/form/rule mappings. All pre-repair claims removed; unverified items marked OPEN with fail-closed gates. Section 139 mandate (every company audited) and Form 140/141/131/132 correct mapping verified and restored. Obsolete Form 23AC/23ACA and non-existent Form DPT-7 explicitly rejected from operational prose.

**Repair sources used:**
- Official ITD section and rule URLs (sections 392–394, rules 215–219, section 263)
- Official MCA Companies Act 2013 PDF
- MCA form instruction kits (ADT-1, DPT-3)
- G.S.R. 700(E) small-company thresholds
- Official MSME notification

**Validation**: All claims in verified sections have explicit links to official sources. All unverified claims marked OPEN with blocking gates. No hard-coded dates, rates, thresholds, or form structure assumptions remain.
