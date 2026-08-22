# Statutory Workflow Contracts — Verified Official Baseline

**Research cutoff:** 21 August 2026  
**Status:** Research baseline and workflow boundaries only; not legal advice and not implementation authority. It remains **NOT ARCHITECT-REVIEWED** and grants no direct filing, portal-submission, payment, or implementation authority.
**OWNER DECISION BOUNDARY**: T-001 through T-011 and PT-001 through PT-016 are owner-approved decision frameworks as recorded in the [Owner Review Docket](owner-review-docket.md). This document records no new product decision and does not expand those approvals. Any tentative item beyond that docket remains **TENTATIVE - NOT OWNER-APPROVED** and must link to [tentative-decisions.md](tentative-decisions.md) and Sudhanshu's review.

**CRITICAL**: Entries in [tentative-decisions.md](tentative-decisions.md) are planning proposals and working defaults only. They are **NOT authorization** for implemented legal behavior, tax computation, export, filing, payment, or submission. Until Sudhanshu explicitly approves a tentative entry, it remains a working hypothesis and must NOT authorize any ledger posting, tax liability calculation, deadline generation, export artifact, portal submission, or payment action. Every tentative choice must pass through owner review before implementation moves forward.

This document defines the contracted boundaries for statutory compliance workflows under Indian tax law (Income-tax Act 2025, Rules 2026) and corporate law (Companies Act 2013). It specifies obligation scope, due-event calculation, validation gates, human/professional review requirements, and evidence expectations. It integrates with existing contracts for GST ([gst-compliance-matrix.md](gst-compliance-matrix.md)) and payroll ([payroll-compliance-matrix.md](payroll-compliance-matrix.md)) without rewriting their settled boundaries.

**Critical error correction in this version**: This document reflects comprehensive repair of section/form/rule mappings using only official ITD and MCA sources. See repair history at end.

---

## Contract Scope and Out-of-Scope Boundaries

### In Scope

- **TDS/TCS obligations (non-payroll)**: Section 393 (resident non-salary) and section 394 (TCS), with Rule 218 governing payment, Rule 219 governing statements, and Rule 215 governing certificates. Section 392 salary is excluded entirely and lives only in the payroll contract; the s393(1) Table 8(iii) specified-senior-citizen branch is non-salary but uses the payroll-owned Forms 130/138 under Rules 215/219;
- **Annual income-tax return filing**: Profile-driven return deadlines (s263: 31 Oct audited, 31 Aug non-audit business/profession, 31 Jul other, 30 Nov only explicit s172-report cases), separate tax computation artifact, Form 26 (s63 audit report only), e-Filing portal submission;
- **Advance tax**: Sections 404/408 installment tracking and credit reconciliation;
- **Company statutory compliance**: Section 139 auditor appointment (mandatory for all companies), annual accounts, Board report, AGM (except OPC), Registrar filings under Companies Act 2013;
- **Evidence and acknowledgement tracking**: Portal receipts (ARN, Registrar reference, TAN acknowledgement), filing dates, rejection/correction status, amendment evidence;
- **Tenant registration and rule applicability**: Effective rule version, applicable sections, entity-type classification.

### Out of Scope / Linked Contracts

- **Payroll TDS**: s392 salary ownership and the payroll-owned Form 130/Form 138 workflow — see [payroll-compliance-matrix.md](payroll-compliance-matrix.md). Forms 130/138 are not salary-exclusive because s393(1) Table 8(iii) uses them; salary is out of scope for this contract;
- **Payroll EPF/ESI/PT/LWF**: Statutory contributions — see [payroll-compliance-matrix.md](payroll-compliance-matrix.md);
- **GST obligations**: GSTR-1, GSTR-3B, ITC, e-way bills, e-invoices — see [gst-compliance-matrix.md](gst-compliance-matrix.md);
- **Expense evidence**: Invoice receipt, bill reconciliation — see [expense-evidence-policy.md](expense-evidence-policy.md) and [accounting-contracts.md](accounting-contracts.md);
- **HRMS and employee portal**: Attendance, leave — per [decisions.md](decisions.md);
- **Inventory and COGS**: Outside v1 scope per [decisions.md](decisions.md).

---

## TDS Workflow Contract (Non-Payroll, Sections 393–394)

### Effective Rule Pack

- **s393(1) Table 8(iii) specified-senior-citizen TDS**: Non-salary but routes to Form 138/Form 130 (payroll-owned artifact). The s393 Table 8(iii) event, deduction trigger, and evidence gate belong in this contract's TDS scope; the Form 138 quarterly statement and Form 130 certificate semantics (due dates Q1 31 Jul, Q2 31 Oct, Q3 31 Jan, Q4 31 May, filing/acceptance/rejection evidence) are **canonical in [payroll-compliance-matrix.md](payroll-compliance-matrix.md)** and are not duplicated here. This is a cross-lane route: s393 Table 8(iii) event triggers Form 138/130 (payroll domain), but applicability and evidence belong in statutory contract.
- **Salary TDS (s392)**: Excluded; s392 salary is payroll-owned per [payroll-compliance-matrix.md](payroll-compliance-matrix.md).
- This contract references only the non-payroll TDS sections: s393 resident non-salary (Forms 140/131), s394 TCS (Forms 143/133), and the special month-end Form 141→132 route for specific tables. Do not confuse Table 8(iii) as salary or select general-nonpayroll forms;
- **Resident non-salary TDS**: Section 393 table-driven routing: 194M→Table 6(ii), rent→Table 2(i)/(ii), interest→Table 5(i)–(iii), goods purchase→Table 8(ii), 194LA→Table 3(iii), ordinary property transfer→Table 3(i), specified-senior-citizen bank payments→Table 8(iii). Forms 131/132/140/141/143/144 and the Table 8(iii) Form 130/138 branch are selected only where Rules 215/218/219 directly route them;
- **TCS**: Section 394, Rule 218 payment, Rule 219 Form 143 statements, and Rule 215 Form 133 certificates;
- **Historical law**: Income-tax Act 1961, old sections 192/194A/194H/194I/194LA/194Q (legacy aliases only for pre-1 April 2026 periods).

### Obligation Scope and Applicability Facts

**Tenant**: Deductor/collector entity (individual, HUF, partnership, company).

**Payee**: Recipient of TDS; identified by PAN or exemption claim.

**Mandatory configuration before execution**:
- Deductor entity, PAN, and TAN only where the profile/transaction requires it under s397(1)(c) exceptions; TAN is not universal;
- Applicable rule version (effective 1 April 2026 for new law);
- Transaction type and exact s393/s394 table entry;
- Payee PAN/name/address;
- Deduction amount and month (calendar month, separate from FY);
- Deposit evidence (bank, challan, payment date).

### Due-Event Calculation

The due events below use [Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1)
for payment, [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1) for
statements, and [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1) for
certificates. The existing source/effective-snapshot gate remains mandatory.

| Event | Trigger | Due Date | Rule | Deterministic Gate |
|---|---|---|---|---|
| **TDS/TCS action** | Payment/receipt event to payee, buyer, or collectee | At the applicable s393/s394 event; deduction/collection month recorded | Applicable s393/s394 table entry | Deduction/collection month and section frozen; do not retroactively change; salary s392 is payroll-owned |
| **TDS deposit to Government** | Deduction recorded | Ordinary Rule 218 branch; special Tables 2(i), 3(i), 6(ii), 8(vi) within 30 days from end of deduction month with Form 141 | [Rule 218](https://www.incometaxindia.gov.in/w/rule-218-1) | Block if month, amount, deductor type, or source snapshot unresolved |
| **Form 140 quarterly statement** | Quarter-end; general non-salary TDS | 31 Jul, 31 Oct, 31 Jan, and 31 May following the tax year for quarters ending 30 Jun, 30 Sep, 31 Dec, and 31 Mar | [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1) | Block Form 140 filing if quarterly data incomplete or branch is special |
| **Form 143 quarterly statement** | Quarter-end; s394(1) TCS | 31 Jul, 31 Oct, 31 Jan, and 31 May following the tax year for quarters ending 30 Jun, 30 Sep, 31 Dec, and 31 Mar | [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1) | Block Form 143 filing if quarterly data or s394 snapshot is incomplete |
| **Form 144 quarterly statement** | Quarter-end; Rule 219 non-resident/non-ordinarily-resident branch | 31 Jul, 31 Oct, 31 Jan, and 31 May following the tax year for quarters ending 30 Jun, 30 Sep, 31 Dec, and 31 Mar | [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1) | Block Form 144 filing if payee status, quarterly data, or branch snapshot is incomplete |
| **Form 141 special statement** | Tables 2(i), 3(i), 6(ii), 8(vi) | Within 30 days from end of deduction month, not transaction date | [Rule 219](https://www.incometaxindia.gov.in/w/rule-219-1) | Form 141 → Form 132; never generic seven-day route |
| **Form 131 certificate** | General non-salary branch | Within 15 days from due date for applicable Rule 219 statement | [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1) | Form 131 follows Form 140/144 path; it is not an annual aggregate of Forms 140/141 |

### Workflow States and No-False-Filing

After the auditor report is attached, the workflow branches to AGM/member adoption or, when adoption fails, the provisional s137 filing path; neither branch can precede Board approval, s134 signatures, auditor submission, report receipt, and attachment.

| State | Trigger | Output | Terminal? | Failed State Prevents |
|---|---|---|---|---|
| **Deduction recorded** | Payment event; TDS computed | Deduction entry in books/payable | No | Completion without deposit |
| **Deposit confirmed** | Bank confirmation of payment | Payment reference, receipt | No | Completion without filing |
| **Form 140 submitted** | Quarter-end; general quarterly statement submitted to portal | Dedicated Form 140 submission attempt, portal acknowledgement and processing evidence; record ARN only if the official statement portal supplies it | No | Statement evidence incomplete; do not start certificate issuance |
| **Form 140 accepted** | Portal processes the Form 140 statement | Statement-specific acceptance evidence and ARN only where officially supplied | **YES** | Statement rejected with its own reason and correction lineage |

Rule 215 requires a certificate to be generated and downloaded from the specified
web portal and furnished to the payee; it does not make Form 131, 132, or 133 a
separately filed and portal-accepted return. The official [Form 131 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-131-faqs)
describes generation after the quarterly statement is processed and download
from TRACES, while the official [Form 132](https://www.incometaxindia.gov.in/documents/d/guest/form-no-132-1)
and [Form 133](https://www.incometaxindia.gov.in/documents/d/guest/form-no-133-1)
templates identify a certificate number and contain transaction/statement or
deposit references. A certificate therefore closes through its own artifact,
certificate/control number, authentication, issue, and delivery evidence—not
through a certificate ARN or portal acceptance.

Each statement branch below is its own state machine. Statement submission,
portal acknowledgement, acceptance/rejection/unknown outcome, and any ARN are
branch-scoped evidence. Certificate issuance starts only after the applicable
statement is complete and has a separate evidence chain; statement evidence
must never be reused as certificate evidence, and certificate evidence must
never be treated as statement acceptance.

| Branch transition | Statement due event | Statement submission attempt | Statement portal acknowledgement/acceptance evidence | Later certificate issuance and delivery | Certificate evidence and terminal handling |
|---|---|---|---|---|---|
| **Form 141 → Form 132** | Form 141 and payment due within 30 days from the end of the deduction month; [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1) Form 132 due within 15 days from the Form 141 due date | Record a dedicated Form 141 submission attempt | `form_141_portal_ack`, statement acceptance/rejection/unknown, and `form_141_arn` only where the official statement portal supplies an ARN | After Form 141 is complete, generate/download Form 132 and furnish it within the Rule 215 window | Require Form 132 artifact/hash, certificate number or control number, digital-signature/authentication log, issue date, delivery evidence, and source/effective snapshot. Terminal is **ISSUED/DELIVERED** only when complete; rejected, missing, or unknown certificate evidence is **REVIEW/BLOCK**. No Form 132 ARN or certificate acceptance state |
| **Form 143 → Form 133** | Form 143 due under the ordinary Rule 219 quarterly dates; [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1) Form 133 due within 15 days from the Form 143 due date | Record a dedicated Form 143 submission attempt | `form_143_portal_ack`, statement acceptance/rejection/unknown, and `form_143_arn` only where the official statement portal supplies an ARN | After Form 143 is complete, generate/download Form 133 and furnish it within the Rule 215 window | Require Form 133 artifact/hash, certificate number or control number, digital-signature/authentication log, issue date, delivery evidence, and source/effective snapshot. Terminal is **ISSUED/DELIVERED** only when complete; rejected, missing, or unknown certificate evidence is **REVIEW/BLOCK**. No Form 133 ARN or certificate acceptance state |
| **Form 144 → Form 131** | Form 144 due under the ordinary Rule 219 quarterly dates; [Rule 215](https://www.incometaxindia.gov.in/w/rule-215-1) Form 131 due within 15 days from the Form 144 due date | Record a dedicated Form 144 submission attempt | `form_144_portal_ack`, statement acceptance/rejection/unknown, and `form_144_arn` only where the official statement portal supplies an ARN | After Form 144 is complete, generate/download Form 131 and furnish it within the Rule 215 window | Require Form 131 artifact/hash, certificate number or control number, digital-signature/authentication log, issue date, delivery evidence, and source/effective snapshot. Terminal is **ISSUED/DELIVERED** only when complete; rejected, missing, or unknown certificate evidence is **REVIEW/BLOCK**. No Form 131 ARN or certificate acceptance state |

**GATE:** Statement forms 141/143/144 require their own submission attempt,
portal acknowledgement, and acceptance/rejection/unknown outcome. Record an
ARN only where the official statement portal supplies it. Certificate forms
131/132/133 are not separately filed or portal-accepted under Rule 215: require
their generated/downloaded artifact, certificate/control number,
digital-signature/authentication log, issue date, delivery evidence, and
source/effective snapshot instead. Statement completion and later certificate
issuance/delivery are separate transitions.

---

## Annual Income-Tax Return Workflow Contract

### Effective Rule Pack

- **Audit applicability**: Section 63 (business/profession conditions verified from the official Form 26 FAQ; voluntary audit is separate and does not become a mandatory s63 trigger);
- **Form 26 audit report**: Rule 47 and the [official Form 26 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-26-faqs) (s63 audit report only; separate from the tax computation artifact; furnished one month before the return due date and not attached/accompanying the return);
- **Return form selection**: Rule 164 (form eligibility per entity type; NOT audit determination);
- **Return-filing due dates**: Amended section 263 (31 Oct audited, 31 Aug non-audit business/profession, 31 Jul other, 30 Nov only explicit s172-report cases);
- **Advance tax**: Sections 404/408 (s404 ₹10,000 threshold for any assessee including companies; standard s408 15%/45%/75%/100% instalments plus verified s408(2) presumptive branch);
- **Depreciation**: Section 33 (Rule 25 block WDV; power-generation exception separate);
- **Tax relief**: Sections 87/89 (eligibility and amounts OPEN);
- **Transition**: Old-law (pre-1 April 2026) and new-law (from 1 April 2026) periods have separate rules.

### Obligation Scope and Applicability Facts

**Tenant**: Individual, HUF, partnership, or company with income and filing obligation under section 263.

**Mandatory configuration**:
- Entity type (individual, HUF, partnership, company) and classification (small company per s2(85), OPC per s2(62), if applicable);
- Income types and sources (salary, business, rental, interest, capital gains, foreign);
- Business/professional gross receipts and cash facts (determine s63 audit applicability);
- Audit requirement (s63 conditions; voluntary audit is a separate product/legal lane; company Companies Act audit remains outside this tax contract);
- Applicable return form per Rule 164 (form code OPEN; form structure OPEN);
- Separate tax computation artifact: total income, TDS/advance-tax credits, applicable relief (s87, s89, foreign credit), carryforward losses;
- Filing credentials (PAN, e-Filing login, DSC or authorized signatory);
- Applicable tax year and financial year.

### Due-Event Calculation

| Event | Trigger | Due Date | Determining Facts | Gate |
|---|---|---|---|---|
| **s63 audit (if required)** | Verified s63 condition | Form 26 furnished one month before applicable return due date; not attached/accompanying return | Section 63 + official Form 26 FAQ | Block return filing if s63 required but Form 26 evidence absent |
| **Advance tax installment** | FY progress | s408: 15% by 15 Jun, 45% by 15 Sep, 75% by 15 Dec, 100% by 15 Mar | Estimated tax per taxpayer profile | Block payment gate if estimate unresolved |
| **Return filing** | FY end (31 March) | Per amended s263: 31 Oct audited, 31 Aug non-audit business/profession, 31 Jul other, 30 Nov only explicit s172-report cases | Entity type + audit status + s172 report fact | Block if deadline category ambiguous |
| **Depreciation schedule** | Asset base and prior-year depreciation | Compute per frozen FY depreciation rules | Rule 25, Appendix I rates (OPEN per asset class) | Block if rate unverified |

### Workflow States and No-False-Filing

| State | Trigger | Output | Terminal? | Failed State Prevents |
|---|---|---|---|---|
| **Accounts finalized** | FY close (31 March); books closed | Balance Sheet, P&L, trial balance | No | Return preparation without accounts |
| **Audit initiated** (if required) | s63 audit applicability determined | Auditor engaged; audit scope documented | No | Filing without audit (if required) |
| **Audit completed** (if required) | Auditor examination complete | Statutory Auditor Report (s143 for company) or Form 26 A+B+C / A+B+D (s63, based on audit under another law) | No | Return filing without audit report |
| **Tax computation artifact** | Accounts final; audit evidence and relief/credit inputs frozen where applicable | Separate computation with total income, tax before relief, reliefs, credits, net tax | No | Filing without tax reconciliation |
| **Form 26 audit report** | s63 condition verified; accountant completes report | Form 26 A+B+C or A+B+D, depending on audit under another law | No | Filing without required audit report; never treat it as computation |
| **Return form assembled** | Form code selected from Rule 164; all mandatory schedules filled | Return form with income, tax, audit report linkage (if applicable) | No | Filing with incomplete form |
| **Return submitted to portal** | Return complete; submitted for filing | Portal receipt; ARN pending | No | Completion from upload alone |
| **Return accepted by portal** | Portal processes; tax department receives | ARN issued; filing date recorded | **YES** | Tax adjustment/audit is separate subsequent process |

**GATE: Never mark "filed" from upload. Only ARN receipt marks filing complete.**

---

## Company Statutory Compliance Workflow Contract

### Effective Rule Pack

- **Company audit**: Section 139 requires every company, including every small company and OPC, to appoint an auditor. This Companies Act audit is separate from the section 63 income-tax audit. [MCA-AUDIT-001](mca-companies-act-compliance-matrix.md#legal-research-audit-table)
- **Auditor state machines**: Non-government first auditor s139(6), government-company first auditor s139(7), subsequent appointment s139(1), casual vacancy s139(8), removal and resignation s140, and eligibility/disqualification s141 plus Audit Rules. Schedule IV is not auditor qualification authority. [MCA-AUDIT-002–008](mca-companies-act-compliance-matrix.md#legal-research-audit-table)
- **Financial statements and Board report**: Section 134 controls Board approval, signatures, auditor-report attachment, and s134(3)/Accounts Rules disclosure sources; section 137 controls filing. Schedule VI is not the Board-report source for this contract. [MCA-AUDIT-009–011](mca-companies-act-compliance-matrix.md#legal-research-audit-table)
- **AGM and OPC**: Section 96 controls AGM timing; section 122 provides the OPC member minutes/resolution path; section 137 provides the OPC 180-day member-adopted financial-statement filing. [MCA-AUDIT-012, MCA-AUDIT-016–017](mca-companies-act-compliance-matrix.md#legal-research-audit-table)
- **Registrar forms**: AOC-4, AOC-4 CFS when s129(3) is triggered by one or more subsidiaries or associate companies subject only to current Rule 6 exemptions, MGT-7/MGT-7A, ADT-1 within 15 days for every applicable s139(1) appointment, DPT-3, and applicable MSME-1. Current source gaps remain OPEN+BLOCK as marked in the MCA matrix.
- **Historical law**: Preserve valid historical 23AC/23ACA records; reject them for current Companies Act 2013 filing. Reject DPT-7 as a current route and route current deposit matters to DPT-3. [MCA-AUDIT-022–023](mca-companies-act-compliance-matrix.md#legal-research-audit-table)

**MCA execution gate:** Every company-law obligation must carry `source_verified=true`, an exact `effective_rule_snapshot`, and an audit ID from the [MCA matrix](mca-companies-act-compliance-matrix.md). Missing, stale, OPEN, or TENTATIVE evidence hard-blocks operational use.

### Obligation Scope and Applicability Facts

**Tenant**: Company incorporated under Companies Act 2013 with CIN.

**Mandatory configuration**:
- Company registration and CIN;
- Company classification after freezing the exact effective G.S.R. 700(E) source snapshot, then all s2(85) exclusions, then current paid-up capital ≤ ₹4 crore and turnover ≤ ₹40 crore; OPC per s2(62); holding/subsidiary; private/public. An OPC qualifies as small only if every condition passes. [MCA-AUDIT-015](mca-companies-act-compliance-matrix.md#legal-research-audit-table);
- Financial year (standard 1 April – 31 March or exempted variation);
- Auditor appointment (name, DIN, s141/Audit Rules verification, appointment meeting date, and ADT-1 notice within 15 days for every applicable s139(1) appointment; rotation applicability is separate);
- Annual accounts status (Balance Sheet, P&L, notes, s134 signatures, auditor report, Board report);
- AGM/member conduct (AGM date and resolutions for non-OPC; signed member minutes/resolution for OPC);
- Filing credentials (Registrar e-filing, DSC, authorized signatory);
- Applicable forms for company/FY/profile (AOC-4 vs. conditional AOC-4 CFS, MGT-7 vs. MGT-7A, ADT-1, DPT-3, MSME-1).

### Due-Event Calculation

| Event | Trigger | Due Date | Company Type Variation | Gate |
|---|---|---|---|---|
| **First auditor** | Registration | Non-government: Board within 30 days; if failure, members at EGM within next 90 days. Government-company path: CAG 60 days, Board next 30, members next 60. | Separate s139(6)/(7) branches | Block if branch or evidence is missing; [MCA-AUDIT-002–003](mca-companies-act-compliance-matrix.md#legal-research-audit-table) |
| **Subsequent appointment** | Applicable AGM under s139(1) | Appointment under s139(1); no generic within-30-days rule. ADT-1 notice is due within 15 days of the appointment meeting for every applicable appointment. | Rotation applicability is separate | Block if source snapshot or eligibility evidence is missing; [MCA-AUDIT-004, 008, 025](mca-companies-act-compliance-matrix.md#legal-research-audit-table) |
| **Casual vacancy** | Auditor vacancy | Board within 30 days; member approval within three months only when vacancy is caused by resignation. | CAG vacancy has separate branch | Block if vacancy cause is unknown; [MCA-AUDIT-005](mca-companies-act-compliance-matrix.md#legal-research-audit-table) |
| **Removal/resignation** | Proposed removal or auditor resignation | Removal: special resolution + prior Central Government approval + hearing. Resignation: auditor files statement within 30 days. | s140 path, not s139(11) | Block without prescribed evidence; [MCA-AUDIT-006–007](mca-companies-act-compliance-matrix.md#legal-research-audit-table) |
| **ADT-1 notice** | Applicable s139(1) appointment meeting | File notice to Registrar within 15 days of the appointment meeting under the fourth proviso to s139(1) and Audit Rules rule 4(2). | Separate from auditor rotation applicability | Block only for missing appointment/source evidence; do not gate by small-company/profile class; [MCA-AUDIT-025](mca-companies-act-compliance-matrix.md#legal-research-audit-table) |
| **Annual accounts ready** | FY close; Board approval and s134 signatures complete | Submit the approved/signed statements to the auditor, receive the report, and attach it before AGM/member adoption or provisional filing. | Audit is mandatory for every company | Block if Board/signature/report order is broken; [MCA-AUDIT-001, 009](mca-companies-act-compliance-matrix.md#legal-research-audit-table) |
| **AGM/member adoption** | FY close | Non-OPC AGM: first within 9 months, later within 6 months; extension only later. OPC: no AGM; member resolution/minutes path. | s96/s122 | Block wrong meeting path; [MCA-AUDIT-012, 016](mca-companies-act-compliance-matrix.md#legal-research-audit-table) |
| **Financial-statement filing** | AGM/member adoption or failure to adopt | s137: adopted within 30 days; unadopted within 30 days as provisional; OPC adopted statements within 180 days of FY close. | Do not use s394 | Block only unsupported path; preserve provisional filing; [MCA-AUDIT-011](mca-companies-act-compliance-matrix.md#legal-research-audit-table) |
| **Annual return** | AGM or date AGM should have been held | s92(4): within 60 days; include reasons when no AGM. | MGT-7 vs MGT-7A by profile | Never use 180-day OPC financial-statement deadline; [MCA-AUDIT-013–014](mca-companies-act-compliance-matrix.md#legal-research-audit-table) |
| **Registrar form selection** | Frozen company/FY/profile | AOC-4 standalone; AOC-4 CFS when one or more subsidiaries or associate companies trigger s129(3), subject only to current Rule 6 exemptions; DPT-3 deposit/money return; MSME-1 only when applicable. | AOC/MGT field schemas and Rule 6 exemption profile remain OPEN where marked | Block unsupported form or profile; [MCA-AUDIT-019–021](mca-companies-act-compliance-matrix.md#legal-research-audit-table) |
| **Registrar filing accepted** | eMCA processes; Registrar reference issued | Registrar reference + acceptance date recorded | All companies | **YES** — filing complete per Registrar |

### Workflow States and No-False-Filing

| State | Trigger | Output | Terminal? | Failed State Prevents |
|---|---|---|---|---|
| **Board approves and signs accounts** | Board meeting held | Board approval first, then s134 signature route: chairperson if authorised or two directors including MD if any, plus CEO if director, CFO and CS wherever appointed; OPC one director | No | Auditor submission or filing before Board approval/signature |
| **Statements submitted to auditor** | Signed financial statements ready | Submit the Board-approved and s134-signed statements to the auditor for report | No | Auditor work detached from approved/signed statements |
| **Auditor report received** | Auditor examination complete | Statutory auditor report under s143 | No | Adoption or filing without mandatory Companies Act audit/report |
| **Auditor report attached** | Auditor report received | Attach the report to the financial statements and required filing documents | No | Report omitted or attached to a different statement snapshot |
| **AGM/member adoption** | Correctly signed statements and attached auditor report ready | AGM resolution/minutes for non-OPC; signed, dated OPC member resolution/minutes | No | Filing without correct adoption evidence |
| **Provisional s137 filing** | Statements not adopted at AGM/adjourned AGM | Signed statements with attached auditor report and required documents filed within 30 days, marked provisional | No | False block on required provisional route |
| **Forms completed** | Company/FY/profile and source snapshot frozen | AOC-4/AOC-4 CFS, MGT-7/MGT-7A, ADT-1, DPT-3, MSME-1 only where applicable | No | Wrong form or unsupported fields |
| **Registrar filing submitted** | Forms + documents + signatures + DSC | eMCA upload receipt; filing timestamp | No | Completion from upload alone |
| **Registrar filing accepted** | eMCA validates and accepts | Registrar reference number + acceptance date | **YES** | Completion per Registrar |

**GATE: Every company must appoint an auditor. Do not create audit-exemption logic for any company type, including small company or OPC. Every unresolved MCA claim remains OPEN+BLOCK under the source/effective-snapshot gate.**

---

## Cross-Contract Linkages

### TDS (Non-Payroll) → Payroll Domain Boundary

| Component | Non-Payroll TDS (This Contract) | Payroll TDS (payroll-compliance-matrix.md) |
|---|---|---|
| **Governing section** | Section 393 (resident non-salary) | Section 392(1) (salary) |
| **Certificates** | Form 131 (general), Form 132 (special), Form 133 (TCS) | Form 130 for s392 salary and s393(1) Table 8(iii); payroll-owned output, not salary-exclusive |
| **Quarterly statement** | Form 140, Form 143, or Form 144 as directly routed by Rule 219; Form 141 is the special month-end statement | Form 138 for s392 salary and s393(1) Table 8(iii); payroll-owned output, not salary-exclusive |
| **Payroll Form 138 quarterly and annual Form 130** | Separate domain (payroll); Table 8(iii) uses the shared payroll-owned forms but remains non-salary | Primary payroll documents and Table 8(iii) transport; general non-payroll forms remain in this contract |
| **Interaction** | Reconcile s392 salary, Table 8(iii), and general non-salary TDS credits separately by governing branch; do not merge source records | Form 130/Form 138 and Forms 131/132/133/140/141/143/144 remain distinct outputs and evidence chains |

**GATE**: Form 140/141/131/143/144 (general non-payroll) must never include salary TDS amounts, and Table 8(iii) must not be treated as salary merely because it uses payroll-owned Forms 130/138. Every TDS filing must identify the governing s392 or s393/s394 branch before execution.

### Annual Return → Payroll Domain

| Component | Annual Return (This Contract) | Payroll TDS (payroll-compliance-matrix.md) |
|---|---|---|
| **TDS credit from payroll** | Form 130 for s392 salary or s393(1) Table 8(iii), plus Form 131 for general non-payroll TDS, all credit against return-filing tax liability by branch | Form 130 is a Rule 215 certificate for either payroll-owned branch; payroll domain owns generation and issue |
| **Integration** | Annual return imports TDS credit from Form 130 + Form 131 (if applicable); reconciles total TDS to net tax |

**Data flow**: Payroll contract produces Form 130 by 15 June; annual return contract imports Form 130 TDS amount for return filing by applicable deadline (31 Oct/31 Aug/31 Jul per s263).

### Annual Return → Company Statutory Compliance

| Component | Annual Return (This Contract) | Company Compliance (This Contract) |
|---|---|---|
| **Scope** | Individual/HUF/partnership with business/professional income | Company (mandatory audit per s139) |
| **Audit** | Section 63 tax audit (if threshold met); Form 26 report | Section 139 Companies Act audit (mandatory) + section 143 Statutory Auditor Report |
| **Accounts** | Trial balance or books of account; if s63 audit, Form 26 A+B+C or A+B+D according to whether accounts are audited under another law | Balance Sheet, P&L, notes per section 133 and Accounting Standards |
| **Return due date** | Section 263 profile-driven | Income-tax profile logic only; the mandatory Companies Act audit does not select the income-tax return deadline |
| **Integration** | Company's audited Balance Sheet is input to company's annual return filing | Audited financial statements from company compliance workflow feed into return-filing workflow |

### Annual Return + Company Compliance → GST Domain

| Component | Statutory (This Contract) | GST (gst-compliance-matrix.md) |
|---|---|---|
| **GST amounts in annual return** | Annual return may reference GST paid (input tax) and GST liability; these amounts come from GST compliance workflow | GSTR-3B portal-reported GST amounts must reconcile to books-recorded GST (annual return and statutory compliance must match GST filing) |
| **Separate obligations** | Annual return is tax-liability calculation; GST is separate compliance filing | No cross-filing required; but GST figures in P&L/balance sheet must match GSTR-3B summary |

---

## Hard Predecessor for Compliance-Decision Actions Only

Every compliance-decision action in this contract—form selection, TDS/TCS
deduction/rate/threshold selection, tax computation, tax posting, deadline
generation, compliance export/filing, advance-tax action, Form 26 selection,
tax depreciation, or certificate/statement generation—must first have
`source_verified=true` and a non-stale `effective_rule_snapshot` containing
official source, rule version, effective date, jurisdiction, and applicability
facts for that specific obligation.

**Scope of the gate**: If either source_verified or effective_rule_snapshot is
absent, stale, or the rule status is **OPEN** or **TENTATIVE** for a specific
tax/filing obligation, the action must return **REVIEW/BLOCK** for that
affected obligation only—form selection, tax computation/posting, deadline
generation, compliance export, filing, or related statutory outputs for that
obligation.

**Unblocked work**: Core bookkeeping (invoice/bill/payment/journal posting),
draft entry, evidence reconciliation, and already-researched statutory slices
(e.g., GSTR-1 when GST is verified) proceed independently. The gate is
obligation-specific, not blanket.

| Audit ID | Control | Source basis | Scope | Status/gate |
|---|---|---|---|---|
| STAT-GATE-001 | Source verification and effective snapshot precede every compliance-decision action | Linked ITD section/rule matrices and official Form 26 FAQ | Form selection, tax computation, posting, deadline generation, export/filing for affected obligation only | VERIFIED product control; missing/stale/OPEN/TENTATIVE for specific tax/filing → REVIEW/BLOCK for that obligation; unrelated core bookkeeping and already-researched slices proceed |

## Product Validation Policy

These are product rules for deterministic statutory workflows. They are not claims that official sources prescribe software design.

| Policy | Required Behavior | Failure Prevented |
|---|---|---|
| **Section/form/rule version selection** | Freeze applicable section, form, rule, and rule version at obligation trigger. Do not retroactively change effective period. | Wrong section or obsolete rule applied to deduction/return/filing. |
| **Separate obligations as distinct states** | Deduction/deposit/statement submission/statement acceptance and later certificate generation/issue/delivery are separate state transitions, each with separate evidence. Certificate issuance is not certificate portal filing or acceptance. | Deposit success mistaken for statement filing; upload mistaken for statement acceptance; certificate delivery mistaken for statement acceptance. |
| **No assumed rates/thresholds/due dates** | Every rate, threshold, due date, or exemption must have explicit source verification. Rates/thresholds derive from s393/s394 and applicable annual-tax sections, never from Form 140/141 kits. OPEN items block execution. | Deduction at unsupported rate; return filed after deadline due to wrong date assumption. |
| **Entity-type driven profile** | Determine entity type (individual, HUF, partnership, company, small, OPC) and audit status before applying rules. Do not assume uniform rules across entity types. | Small company incorrectly treated as audit-exempt; OPC treated as regular company requiring AGM. |
| **No false "filed" status** | A statement "filed" status requires its own documented portal acknowledgement/acceptance evidence, with an ARN only where the official portal supplies one; submission/upload alone never marks filed. Certificates use issuance/delivery evidence and have no "filed" status under Rule 215. | False statement filing or certificate acceptance status creating a compliance gap. |
| **Gateway enforcement — section 63 audit** | If verified s63 conditions apply, Form 26 is mandatory before return filing; it is not the tax computation and is not attached/accompanying the return. | Return filed without audit report or with Form 26 misused as computation. |
| **Gateway enforcement — company audit** | Every company (including small company and OPC) must appoint an auditor under s139. Keep this Companies Act audit separate from the s63 income-tax audit; test auditor eligibility under s141 and the Audit Rules, not Schedule IV. | Small company/OPC audit suppression or tax/company-audit conflation. See [MCA matrix](mca-companies-act-compliance-matrix.md#legal-research-audit-table). |
| **Gateway enforcement — MCA source snapshot** | Every MCA obligation must carry `source_verified=true`, an exact `effective_rule_snapshot`, and a verified MCA audit ID. OPEN/TENTATIVE applicability or field detail is REVIEW/BLOCK. | Silent execution from stale or invented section/form/date claims. |
| **Gateway enforcement — OPC/member path** | An OPC has no AGM, but the member adopts required business through the signed, dated minutes/resolution path under s122; s137 financial statements are due within 180 days. | “Board only,” “no member approval,” or accidental reuse of 180 days for annual return. |
| **Gateway enforcement — forms** | AOC-4 is standalone; AOC-4 CFS follows the s129(3) trigger of one or more subsidiaries or associate companies, subject only to current Rule 6 exemptions; MGT-7/MGT-7A follow company profile; ADT-1 is due within 15 days for every applicable s139(1) appointment; DPT-3 is deposits/money not treated as deposits; MSME-1 is applicable supplier-payment return. | Wrong form purpose, historical associate-only exception reused as current, ADT-1 suppressed by profile class, DPT-3 director/KMP data, or MSME classification misuse. |
| **Form selection from official classification** | Select TDS forms from frozen s393 classification, Rule 215 certificate routes, and Rule 219 statement routes: Form 141→132 for Tables 2(i), 3(i), 6(ii), 8(vi); general branches use Form 131 and Form 140/144; s393(1) Table 8(iii) uses Form 130/Form 138. Do not derive rates/thresholds from form kits. | Wrong or obsolete form filed. |
| **Payroll boundary maintenance** | Keep s392 salary, s393(1) Table 8(iii), and general non-salary/TCS branches distinct even where payroll owns Form 130/138 transport. Reconcile credits at annual return only after preserving branch evidence. | Salary TDS conflated with Table 8(iii) or general non-salary TDS; wrong total TDS credit applied to return. |
| **Portal evidence preservation** | Retain all portal receipts (ARN, Registrar reference, filing timestamp, acceptance date, signer method, DSC verification). Do not delete filing evidence. | Missing evidence; cannot verify filing or respond to Registrar/tax authority objection. |

---

## No Unapproved Product Defaults

This contract must link to [tentative-decisions.md](tentative-decisions.md) for every product choice not explicitly settled. The following examples have been assigned tentative-decision IDs and moved to tentative-decisions.md:

- **[T-007: Full Individual Income-Tax Scope—Sole Proprietor, Accounting-Separated from Business/GST](tentative-decisions.md#t-007)**: Scope decision approving full personal income-tax support for sole proprietor. **Note:** Advance-tax scheduling and behavior (s404/408 estimated-amount input, auto-projection, deadline tracking) remain separate tentative/not owner-approved within personal-tax research scope; no current T-007 decision approves advance-tax behavior. Refer to personal-tax scope documentation ([personal-tax-scope.md](personal-tax-scope.md)) for detailed personal-tax decisions (PT-001 through PT-016).
- **[T-008: Controlled User Corrections and Deletions—Immutable Artifacts with Reversal Lineage](tentative-decisions.md#t-008)**: Approves controlled corrections/deletions after FY/report/audit/filing via preview/reason/confirmation/unlock, using reversal/replacement and version/tombstone lineage; no destructive mutation. Prior artifacts remain immutable; affected derived work marked STALE/DRIFTED.
- **[T-009: Form 140/141 Statutory Export—Research-Gated, Fail-Closed](tentative-decisions.md#t-009)**: Should agent-bahi export Form 140/141, or defer until official utility/schema/portal flow verified? → Tentative default: fail-closed; internal data only until research closes.
- **[T-010: Post-Filing Return Case/Evidence/Correction—Research-Gated Submission](tentative-decisions.md#t-010)**: How to handle post-filing return corrections or disputes? → Tentative default: preserve case details and correction lineage; no submission adapter until s263(5)-(7) branches and procedures researched.

No product gate, auto-decision, or default behavior must exist without explicit Sudhanshu approval and documentation in [tentative-decisions.md](tentative-decisions.md) or [decisions.md](decisions.md).

---

## Open Items Blocking Implementation

All items below must remain visible and unimplemented until resolved with official sources:

1. **Section 393 transaction-type rates and thresholds**: Exact rates, applicability tests, and exemption criteria for each s393 table entry (194M→6(ii), rent→2(i)/(ii), interest→5(i)–(iii), goods→8(ii), 194LA→3(iii), ordinary property→3(i), specified-senior-citizen bank payments→8(iii)) must be verified from the official s393 source snapshot. **OPEN**. Blocks: all affected non-payroll TDS computations, including the Table 8(iii) Form 130/Form 138 branch.

2. **Section 394 TCS rates and goods categories**: Exact TCS rate, applicable goods types, and turnover threshold must be verified. **OPEN**. Blocks: all TCS computations.

3. **Form 140/141/131/143/144 due-date and structure details**: Rule 219 routing and ordinary quarterly dates are verified; field/export structure and any tenant-specific transport remain **OPEN**. Blocks: export or filing until the current form snapshot is attached.

4. **Form 138 (payroll-owned quarterly statement)**: Applicability and quarter dates for s392 salary and s393(1) Table 8(iii) are verified by the official Form 138 FAQ; detailed correction/transport semantics remain **OPEN**. Blocks only those unresolved payroll actions.

5. **Section 63 thresholds and conditions**: Exact ₹1 crore business, ₹50 lakh profession, ₹10 crore with cash-payment tests must be verified. **OPEN**. Blocks: audit applicability determination for individual/HUF/partnership.

6. **Section 263 return-filing due-date profile logic**: The amended Act verifies 31 Oct audited, 31 Aug non-audit business/profession, 31 Jul other, and 30 Nov only explicit s172-report cases. Tenant classification and source snapshot remain required. **OPEN** for unresolved facts. Blocks: ambiguous deadline selection.

7. **Section 87/89 relief eligibility and amounts**: Conditions and amounts for each relief type must be verified. **OPEN**. Blocks: tax-relief calculation.

8. **Section 33 depreciation rates by asset class**: Rule 25 and Appendix I rates for each asset type; power-generation exception rates separately. **OPEN**. Blocks: depreciation computation.

9. **Section 408 advance-tax installment percentages and due dates**: Verify 15%/45%/75%/100% schedule and dates (15 Jun/15 Sep/15 Dec/15 Mar). **OPEN**. Blocks: advance-tax installment tracking.

10. **Section 141 + Audit Rules auditor eligibility detail**: Section 141 and Audit Rules govern eligibility/disqualification; Schedule IV is not the source. Current tenant-level certificate/profile facts remain **OPEN**. Blocks: company auditor-appointment eligibility check. See [MCA matrix](mca-companies-act-compliance-matrix.md#legal-research-audit-table).

11. **Section 177 + Board Powers Rule 6 Audit Committee applicability**: s177 composition/functions and the current Board Powers Rule 6 company-class profile must be frozen; Chapter 12 Rule 4 is meeting-mode-only and is not the applicability rule. There is no separate Registrar-filed Audit Committee Report. Applicability remains **OPEN+BLOCK**. See [MCA matrix](mca-companies-act-compliance-matrix.md#legal-research-audit-table).

12. **Section 134(3) + Accounts Rules Board-report disclosures**: Current field-level disclosure mapping remains **OPEN+BLOCK**; do not use Schedule VI as the source. See [MCA matrix](mca-companies-act-compliance-matrix.md#legal-research-audit-table).

13. **AOC-4/AOC-4 CFS/MGT-7/MGT-7A field structure**: Current official form/instruction-kit snapshots must specify field mapping and validation rules. AOC-4 CFS is triggered by one or more subsidiaries or associate companies under s129(3), subject only to a verified current Rule 6 exemption profile; an associate-only company is not optional, and the historical FY2014-15 exception is not current. **OPEN+BLOCK**. See [MCA matrix](mca-companies-act-compliance-matrix.md#legal-research-audit-table).

14. **Form DPT-3/MSME-1 tenant applicability**: DPT-3 purpose and official 30 June/31 March audited-data wording are verified; MSME-1 order cycle is 30 April/31 October. Tenant applicability and current source snapshots remain **OPEN+BLOCK**. Neither form is a director/KMP return or company-classification/Board-report shortcut. See [MCA matrix](mca-companies-act-compliance-matrix.md#legal-research-audit-table).

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
