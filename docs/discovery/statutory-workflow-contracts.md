# Statutory Workflow Contracts

**Research cutoff:** 21 August 2026
**Status:** research baseline and workflow boundaries only; not legal advice and not implementation.

This document defines the contracted boundaries for statutory compliance workflows under Indian tax law (Income-tax Act 2025, Income-tax Rules 2026) and corporate law (Companies Act 2013). It specifies obligation scope, due-event calculation, validation gates, human/professional review requirements, and evidence expectations. It integrates with existing contracts for GST and payroll (see [gst-compliance-matrix.md](gst-compliance-matrix.md), [payroll-compliance-matrix.md](payroll-compliance-matrix.md), and [expense-evidence-policy.md](expense-evidence-policy.md)).

## Contract scope and boundaries

### In scope

- **TDS/TCS obligations**: Tax Deducted at Source and Tax Collected at Source computations, payments, and quarterly Form 141 / annual Form 140 filings under sections 193–197, 392, and related rules;
- **Annual income-tax return filing**: Return-form selection, income computation, tax computation, advance-tax reconciliation, and e-Filing portal submission under Rules 164 and Notification 22;
- **Company statutory compliance**: Annual accounts preparation, Board report, auditor appointment, AGM conduct, and Registrar filings under Companies Act 2013 sections 92–143;
- **Evidence and acknowledgement tracking**: Portal receipts (ARN, Registrar reference, TAN acknowledgement), filing dates, rejection/correction status, and amendment evidence;
- **Tenant registration and rule applicability**: Effective rule version, applicable sections, and entity-type classification for each obligation.

### Out of scope / linked contracts

- **GST obligations**: GSTR-1, GSTR-3B, ITC, e-way bills, e-invoices — see [gst-compliance-matrix.md](gst-compliance-matrix.md);
- **Payroll obligations**: Salary TDS (Form 130/Form 138), EPF, ESI, PT, LWF, wage registers — see [payroll-compliance-matrix.md](payroll-compliance-matrix.md);
- **Expense evidence**: Invoice receipt, bill reconciliation, document classification — see [expense-evidence-policy.md](expense-evidence-policy.md) and [accounting-contracts.md](accounting-contracts.md);
- **HRMS and employee portal**: Attendance, leave management, employee payroll portal — boundary per [decisions.md](decisions.md);
- **Bank and cash management**: Bank reconciliation, payment instruction, fund transfer verification — see [accounting-contracts.md](accounting-contracts.md);
- **Inventory and COGS**: Inventory tracking, stock valuation, manufacturing — outside v1 scope per [decisions.md](decisions.md).

## TDS/TCS workflow contract

### Obligation scope and entities involved

**Tenant**: Deductor or collector entity (individual, HUF, partnership, company) with TAN (Tax Account Number) registration on e-Filing portal.

**Payee**: Recipient of payment subject to TDS (professional, rent, commission, interest, goods supplier, etc.); identified by PAN or acknowledgement status.

**Authorities**: 
- Income Tax Department (ITD) — receipt of TDS payment via challan, processing of Form 141/Form 140 filings;
- RBI / approved banks — TDS deposit and challan reconciliation.

**Professional review**: 
- **Tax Professional (CA/non-CA)**: Verification of TDS computation, deduction applicability, and payee eligibility (optional but recommended);
- **Auditor (if applicable)**: For TDS obligations within audit scope, auditor verifies TDS computation against books and reconciles with quarterly filings.

### Effective rule pack

- **Governing Act**: Income-tax Act 2025 (sections 193–197 for salary TDS, sections 193–197 and 392 for non-payroll TDS/TCS);
- **Governing Rules**: Income-tax Rules 2026 (Rules 215, 218, 219 for TDS payment and filing; effective 1 April 2026);
- **Historical Rules**: Income-tax Act 1961 and corresponding rules for deductions in periods before 1 April 2026;
- **Applicable rates**: Section 393 rates for TDS; section 392 rates for TCS (rates and thresholds marked **OPEN** pending official Form 140 kit verification per [tds-tcs-compliance-matrix.md](tds-tcs-compliance-matrix.md)).

### Applicability facts (mandatory before obligation determination)

- **Deduction trigger**: Payment event date, payment type/category (s194M professional, s194I rent, s194A interest, etc.), payment amount, and payee type;
- **Payee identity**: Payee PAN, name, address, and eligibility (e.g., individual vs. corporate, threshold-based exemption status);
- **Deduction month**: Calendar month in which payment was made or TDS was deducted (separate from financial year);
- **Tax year and rule version**: Financial year (1 April to 31 March); effective rule version per date; distinguish old-law (before 1 April 2026) vs. new-law (from 1 April 2026) periods;
- **TAN validity**: Tenant TAN must be registered and active on e-Filing portal;
- **Exemption status**: Whether payee qualifies for exemption from TDS (if applicable) — requires payee disclosure and tenant verification.

### Due-event calculation

**Event trigger**: TDS deduction occurs at payment event date.

**Payment due date**: 
- For deductions in April through November: 7 days after month end;
- For December through March: 7 days after month end, but March deductions due on or before 30 April for non-government deductors (per Rule 215).

**Quarterly Form 141 filing due dates**:
- Q1 (April–June): 31 July;
- Q2 (July–September): 31 October;
- Q3 (October–December): 31 January (of following FY);
- Q4 (January–March): 31 May (of following FY).

**Annual Form 140 TDS certificate due date**: **OPEN** pending official Form 140 instruction kit.

### Source snapshot and workflow state

**State 1: Deduction recorded**
- Trigger: Payment event occurs; deduction is calculated and recorded in tenant's payable/liability;
- Data snapshot: Deduction date, deduction month, payee, amount, section/category, TAN, rule version;
- Output: Deduction record in tenant's books or working document.

**State 2: Deposit instructed and tracked**
- Trigger: Tenant initiates bank payment of TDS for the month;
- Data snapshot: Deduction month, total TDS amount, challan reference (if available), payment date, payment method, bank account;
- Output: Payment instruction; bank challan/proof-of-payment tracking entry.

**State 3: Deposit confirmed**
- Trigger: Payment is reflected in tenant's bank statement or challan receipt is obtained from bank;
- Data snapshot: Payment date, amount, bank reference, challan acknowledgement (if applicable);
- Output: Confirmed payment record linked to deduction month.

**State 4: Quarterly statement prepared**
- Trigger: Quarter end and deductions for the quarter are frozen;
- Data snapshot: All deductions and deposits for the quarter; quarterly aggregate TDS by category;
- Output: Form 141 draft with all deductions and deposits for the quarter.

**State 5: Quarterly statement filing submitted**
- Trigger: Tenant or CA initiates Form 141 filing on e-Filing portal;
- Data snapshot: Form 141 data, filing date, signatory method (DSC/EVC/authorized signer), quarter and tax year;
- Output: Portal upload confirmation; filing reference pending.

**State 6: Quarterly statement filing accepted**
- Trigger: Portal processes Form 141 and issues acceptance/rejection;
- Data snapshot: Portal acceptance status, ARN (if accepted), rejection reason (if rejected);
- Output: Filed status recorded; ARN and evidence retained.

**State 7: Annual certificate prepared**
- Trigger: Financial year end and all quarterly Form 141 filings are accepted; annual certificate is generated;
- Data snapshot: Financial year, aggregate TDS from all quarters and deposits, payee-wise TDS, certificate details;
- Output: Form 140 draft with aggregated annual TDS data.

**State 8: Annual certificate issued/filed**
- Trigger: Tenant or CA generates and delivers Form 140 to payee (and/or files with portal if applicable);
- Data snapshot: Certificate issuance date, payee receipt evidence, filing reference (if filed with portal);
- Output: Form 140 certificate with evidence of delivery/filing.

### Preparation workflow and validation

**Preparation**: Tenant or CA prepares TDS deduction, deposit, and filing records:
1. **Data gathering**: Collect payment invoices/documents, payee details, and payment dates for all TDS-applicable payments during the month/quarter;
2. **Deduction calculation**: Apply section 393 rates and thresholds (rates marked OPEN per [tds-tcs-compliance-matrix.md](tds-tcs-compliance-matrix.md)); verify payee eligibility and exemption claims;
3. **Quarterly statement assembly**: Aggregate all deductions and deposits for the quarter into Form 141 format (structure marked OPEN pending Form 141 kit);
4. **Annual certificate assembly**: Aggregate quarterly data for annual Form 140 (certificate due date and format marked OPEN pending Form 140 kit).

**Validation gates**:
- **Deduction gate**: TDS amount is positive and within bounds of the payment amount and applicable rule rates; payee PAN or status is recorded;
- **Deposit gate**: TDS deposit is made within the due date and amount matches deducted TDS for the month (within a documented variance, if any);
- **Quarterly filing gate**: Form 141 aggregates all deductions and deposits for the quarter; filing is submitted within the due date and accepted by portal (ARN issued);
- **Certificate gate**: Form 140 aggregates all quarterly Form 141 filings and deposits; certificate is issued/filed by due date and evidence is retained.

**Silent failure prevention**:
- Deduction without a corresponding payee PAN or exemption claim: **BLOCK** until payee identity is resolved;
- Deposit without matching deduction: **REVIEW** variance and reconcile or mark as exception;
- Form 141 filing without portal acceptance: Do not mark as "filed" from upload alone; track uploaded status separately from accepted status;
- Annual certificate without all quarterly fillings: **BLOCK** until all quarterly Form 141 filings are accepted and linked.

### Human/professional review and authorization

**Review by tax professional (optional but recommended)**:
- **CA/non-CA tax advisor**: Verifies TDS computation per applicable section and payee eligibility; certifies quarterly statement before filing if engaged;
- **Evidence**: Review notes or certification document retained with quarterly/annual statements.

**Review by auditor (if applicable)**:
- **Statutory auditor** (if company is subject to statutory audit or if TDS obligations are within audit scope): Verifies TDS deductions match books of account; reconciles quarterly Form 141 filings and deposits with auditor's audit evidence;
- **Audit report**: Includes TDS verification as part of audit scope (if applicable); auditor's findings and opinions retained in audit working papers.

### Export and portal submission

**Export format**:
- **Form 141 export**: Portal-compatible JSON or XML per eMCA/e-Filing specification (format marked OPEN pending Form 141 kit);
- **Form 140 export**: Portal-compatible format for annual certificate filing (format marked OPEN pending Form 140 kit);
- **Evidence export**: Payment reference, bank challan, quarterly receipts, auditor certification (if applicable).

**Manual portal action**:
- **Portal user (tenant, CA, or authorized signatory)**: Logs into e-Filing portal, selects TAN, inputs or uploads Form 141/Form 140, signs using DSC or authorized-signatory method per portal protocol;
- **Portal workflow**: Form 141 is submitted for processing; portal returns acceptance (with ARN) or rejection (with reason); Form 140 filing follows same process;
- **Evidence captured**: Filing date, signatory identity, portal reference, acceptance/rejection communication, ARN (if accepted).

### Acknowledgement, rejection, correction, and amendment

**Filing acknowledgement**:
- **Accepted**: Portal issues ARN and displays filed status; tenant/CA receives confirmation email/SMS from portal;
- **Evidence**: ARN, filing timestamp, portal reference number retained in tenant records.

**Filing rejection**:
- **Rejected**: Portal returns specific rejection reason (missing field, calculation error, payee mismatch, etc.);
- **Correction action**: Tenant/CA corrects the issue and re-files Form 141/Form 140; correction is tracked as separate filing (not an amendment of original);
- **Evidence**: Rejection reason, correction details, and re-filing reference retained.

**Correction after acceptance**:
- **Revised Form 141** or **revised annual certificate** (if applicable): Mechanism for correction after filing acceptance is marked **OPEN** pending official Form 141/Form 140 instruction kits. Clarify whether corrections are made via amended/revised filing or supplementary statement.

**Amendment by tax authority**:
- **Assessing Officer amendments**: Tax authority may adjust TDS credit in assessment/audit; adjustment is tracked separately and not a product of this workflow contract. Tenant receives demand/adjustment notice; adjustment evidence is retained for audit trail.

### States and no false 'filed' status

**Terminal states**:
1. **Deduction recorded** (intermediate state; no final status until deposit is made and filing is accepted);
2. **Deposit confirmed** (intermediate state; no final status until quarterly filing is accepted);
3. **Quarterly filing accepted** with ARN (final state for that quarter);
4. **Annual certificate issued** with evidence (final state for that financial year).

**Never mark as 'filed' or 'accepted' unless**:
- **Quarterly statement**: Portal has accepted Form 141 and issued ARN (do not mark filed from upload or submission alone);
- **Annual certificate**: Form 140 is issued/filed with date and evidence; if portal filing is required, acceptance is confirmed.

**Intermediate states** (do not represent filing completion):
- Upload to portal without acceptance;
- Rejection and correction in progress;
- Pending portal processing.

## Annual income-tax return filing contract

### Obligation scope and entities involved

**Tenant**: Individual, HUF, partnership, or company with income sources in India and filing obligation under Income-tax Act 2025.

**Financial year**: 1 April to 31 March; applicable rule version and return form selected per tenant's entity type and income composition.

**Authorities**: 
- Income Tax Department (e-Filing portal) — receipt and processing of return filings;
- Tax department assessment division — examination, audit, and adjustment of returns.

**Professional review**: 
- **Tax professional (CA)**: Verification of income computation, applicable deductions, tax computation, and return filing (if engaged; optional for certain taxpayers);
- **Auditor (if applicable)**: For returns with statutory audit, auditor verifies financial accounts against return; audit report is linked to return.

### Effective rule pack

- **Governing Act**: Income-tax Act 2025 (sections 63, 87, 89, 404, 408, Form 26 computation framework);
- **Governing Rules**: Income-tax Rules 2026 (Rule 47 Form 26, Rule 164/Notification 22 form selection, Rule 205 deduction verification; effective 1 April 2026);
- **Return form selection**: Determined per Rule 164 and Notification 22 (form code and structure marked OPEN pending Notification 22 and Form Navigator verification per [annual-income-tax-compliance-matrix.md](annual-income-tax-compliance-matrix.md)).

### Applicability facts (mandatory before return determination)

- **Tax year**: Financial year (1 April to 31 March) for which return is filed;
- **Entity type and classification**: Individual, HUF, partnership, or company; company sub-classification (small, large, listed, OPC, etc.);
- **Income sources and composition**: Salary, business/professional income, rental, interest, capital gains, foreign income, and any other sources;
- **Business/professional turnover or gross receipts**: If applicable, used to determine statutory audit requirement under section 63;
- **Tax audit applicability**: Whether statutory audit is required (section 63) or Rule 164 audit applies; audit report status if required;
- **Applicable form code**: Selected from Rule 164/Notification 22 based on entity type and income composition (form code marked OPEN pending Notification 22);
- **Return filing deadline**: 31 July of the following financial year (or extended date if allowed per applicable notification).

### Due-event calculation

**Event trigger**: Financial year close (31 March).

**Return filing deadline**: 31 July of the following financial year (e.g., for FY 2025-26, deadline is 31 July 2026).

**Tax computation deadline (advance tax)**:
- **Advance tax installment 1**: By 15 June (estimated tax for April–May);
- **Advance tax installment 2**: By 15 September (estimated tax for April–August);
- **Advance tax installment 3**: By 15 December (estimated tax for April–November);
- **Advance tax installment 4**: By 15 March (estimated tax for April–February);
- Exact dates and installment amounts marked **OPEN** pending official Notification 24 or applicable rule specification per [annual-income-tax-compliance-matrix.md](annual-income-tax-compliance-matrix.md).

**Audit timeline** (if applicable):
- If statutory audit required, audit report must be received before return filing;
- Audit report must be linked to and attached to return filing.

### Source snapshot and workflow state

**State 1: Income compiled and accounts prepared**
- Trigger: Financial year close (31 March);
- Data snapshot: Complete ledger, income-wise summary, applicable deductions, depreciation, tax losses (if any), Balance Sheet, Profit & Loss;
- Output: Final accounts or books of account for the year.

**State 2: Audit initiated** (if applicable)
- Trigger: Statutory audit requirement determined (section 63) or Rule 164 audit applicability confirmed;
- Data snapshot: Auditor engagement, audit scope, financial-account linkage;
- Output: Audit engagement letter or audit notification.

**State 3: Audit completed** (if applicable)
- Trigger: Auditor completes audit examination per Accounting Standards;
- Data snapshot: Audit findings, audit opinion (unqualified, qualified, adverse, or disclaimer), auditor report;
- Output: Statutory Auditor Report per section 143; auditor certificate (if any).

**State 4: Tax computation prepared (Form 26 draft)**
- Trigger: Accounts are finalized and audit (if required) is complete;
- Data snapshot: Total income computation, tax before relief (per applicable slab or new-law computation), eligible tax relief (sections 87, 89, foreign tax credit), TDS credit, advance-tax credit, net tax payable or refund due;
- Output: Form 26 draft with all computations detailed.

**State 5: Return form assembled**
- Trigger: Form 26 is finalized; applicable return form from Rule 164/Notification 22 is selected;
- Data snapshot: Return form code, applicable schedules, total income and tax from Form 26, audit report linkage (if applicable), supporting schedules (rental, capital gains, foreign income, eTDS reconciliation, digital assets, etc.);
- Output: Return form draft with all mandatory and applicable sections filled.

**State 6: Return submitted to e-Filing portal**
- Trigger: Return form is complete; tenant or CA initiates portal submission;
- Data snapshot: Tax year, entity PAN, return form code, filing date, signatory method (DSC/EVC/authorized signer);
- Output: Portal upload confirmation; filing reference pending.

**State 7: Return accepted/filed**
- Trigger: Portal processes return and issues acceptance or rejection;
- Data snapshot: Portal acknowledgement status, ARN (if accepted), rejection reason (if rejected);
- Output: Filed status recorded; ARN and portal evidence retained.

**State 8: Return acknowledged and finalized**
- Trigger: Portal processes return and tax department receives filing; acknowledgement issued;
- Data snapshot: Acknowledgement date, ARN, refund status (if applicable), balance-due status (if applicable);
- Output: Final return evidence with ARN and acknowledgement.

### Preparation workflow and validation

**Preparation**: Tenant or CA prepares tax return:
1. **Financial accounts finalization**: Balance Sheet, Profit & Loss, and supporting schedules are prepared per Accounting Standards;
2. **Audit (if required)**: Statutory audit is conducted and auditor report is obtained;
3. **Income computation**: Total income is computed per applicable sections and rules; income sources are classified (salary, business, rental, etc.);
4. **Tax computation (Form 26)**: Tax before relief is computed per applicable rate/slab; eligible relief and credit are computed (TDS, advance tax); net tax and refund/balance-due are determined;
5. **Return form selection**: Applicable return form is selected from Rule 164/Notification 22 per entity type and income composition;
6. **Return assembly**: Return form is filled with income, tax, and supporting schedules; audit report is attached (if applicable); return is signed by authorized signatory.

**Validation gates**:
- **Audit gate**: If statutory audit required, audit report is present and linked before return is filed;
- **Income gate**: Total income in return matches total income in Form 26;
- **Tax gate**: Net tax in return matches Form 26 net tax (TDS + advance tax + balance-due);
- **Form gate**: Applicable form code is selected per entity type and income composition; mandatory sections are filled;
- **Signature gate**: Return is signed by authorized signatory (director, partner, proprietor, or CA); DSC or authorized-signatory evidence is present;
- **Filing deadline gate**: Return is submitted to portal on or before 31 July (or extended deadline if applicable).

**Silent failure prevention**:
- Return submitted without audit report (when audit required): **BLOCK** until audit report is linked;
- Return income or tax does not match Form 26: **BLOCK** until reconciliation is completed;
- Return submitted with wrong form code: **BLOCK** and prompt form re-selection per entity/income type;
- Return signed without proper authority: **BLOCK** until authorized signatory is confirmed;
- Return filed after deadline without extension: **WARN** and surface rejection risk to tenant/CA.

### Human/professional review and authorization

**Review by tax professional (optional but recommended)**:
- **CA or non-CA tax advisor**: Verifies income computation, applicable deductions, tax computation, and return form selection; certifies return before filing if engaged;
- **Evidence**: Review notes or certification document retained with return.

**Review by auditor (if applicable)**:
- **Statutory auditor** (if section 63 or Rule 164 audit applies): Verifies financial accounts against return; audit report is linked to return; auditor's findings and any qualifications are reflected in audit report;
- **Audit report**: Section 143 Statutory Auditor Report; linked to return filing as evidence.

**Tenant authorization**:
- **Authorized signatory**: Proprietor (individual), partner (partnership), director (company), or authorized representative (if power-of-attorney is granted);
- **Signature method**: DSC (Digital Signature Certificate) or authorized-signatory method per portal protocol.

### Export and portal submission

**Export format**:
- **Return form export**: Portal-compatible JSON or e-form per e-Filing portal specification (format marked OPEN pending Notification 22 and portal manual);
- **Form 26 export**: Retained as separate artifact (filing status of Form 26 marked OPEN pending Form 26 instruction kit);
- **Audit report export** (if applicable): Linked as supporting document with return.

**Manual portal action**:
- **Portal user (tenant or CA)**: Logs into e-Filing portal, selects PAN and tax year, inputs or uploads return form, attaches supporting documents (audit report if applicable), signs using DSC or authorized-signatory method per portal protocol;
- **Portal workflow**: Return is submitted for processing; portal returns acceptance (with ARN) or rejection (with reason); acceptance may be auto (validation pass) or may require manual tax department review;
- **Evidence captured**: Filing date, signatory identity, portal reference, acceptance/rejection communication, ARN (if accepted).

### Acknowledgement, rejection, correction, and amendment

**Filing acknowledgement**:
- **Accepted**: Portal issues ARN and displays filed status; tenant/CA receives confirmation email/SMS;
- **Evidence**: ARN, filing timestamp, portal reference number, acknowledgement letter retained in records.

**Filing rejection**:
- **Rejected**: Portal returns specific rejection reason (missing field, signature invalid, income/tax mismatch, form code wrong, etc.);
- **Correction action**: Tenant/CA corrects the issue and re-files return; correction is tracked as separate filing (not an amendment of original);
- **Evidence**: Rejection reason, correction details, and re-filing reference retained.

**Revised return** (if allowed under law):
- **Revised return filing** (ITR-X or similar, if available): Mechanism for correction after acceptance is marked **OPEN** pending official Form 26/return instruction kit verification;
- **Conditions and deadline**: Applicability and deadline for revised return marked OPEN;
- **Evidence**: Revised return ARN, original return ARN, revision reason retained.

**Amendment by tax authority**:
- **Assessing Officer adjustment**: Tax authority may adjust income or tax in assessment; adjustment is tracked separately and not a product of this workflow contract;
- **Tenant notice**: Tenant receives adjustment notice; adjustment evidence is retained for audit trail.

### States and no false 'filed' status

**Terminal states**:
1. **Financial accounts and Form 26 completed** (intermediate state; no final status until return is filed and accepted);
2. **Return submitted to portal** (intermediate state; no final status until portal acceptance);
3. **Return accepted by portal** with ARN (final state for filing; tax authority may conduct further examination separately).

**Never mark as 'filed' or 'accepted' unless**:
- **Return filing**: Portal has accepted return and issued ARN (do not mark filed from submission/upload alone);
- **Filing completion**: ARN is in tenant records and linked to tax year and entity PAN.

**Intermediate states** (do not represent filing completion):
- Submitted to portal without acceptance;
- Rejection and re-filing in progress;
- Pending portal processing.

## Company statutory compliance workflow contract

### Obligation scope and entities involved

**Tenant**: Company incorporated under Companies Act 2013 with registered CIN and operating in India.

**Company classification**: Small company (section 92), large company (section 96), holding/subsidiary (section 2(87) definition), or other classification affecting audit and filing requirements.

**Authorities**: 
- Ministry of Corporate Affairs (MCA) via e-filing portal (eMCA module) — receipt and processing of annual accounts and forms;
- Registrar of Companies (ROC) — final authority on filing acceptance; company records.

**Professional engagement**:
- **Statutory auditor** (if company is subject to statutory audit per section 139 or applicable exemption): Conducts audit per Accounting Standards and section 143; issues auditor report;
- **Company Secretary (CS) or compliance professional**: Conducts due-diligence on statutory compliance; may certify forms and filing evidence;
- **Director/authorized signatory**: Board member or authorized officer who signs returns and attestations.

### Effective rule pack

- **Governing Act**: Companies Act 2013 (sections 92–143 cover classification, audit, and financial reporting);
- **Governing Regulations**: Companies (Accounts) Rules 2014, Companies (Audit and Auditors) Rules 2014, Companies (Board's Report) Rules 2014, and related MCA notifications;
- **Accounting Standards**: Ind-AS (Indian Accounting Standards) or IFRS as applicable per company classification and notification;
- **Auditing Standards**: Auditing and Assurance Standards (SA suite, UASG) for statutory audit; auditor report format per section 143.

### Applicability facts (mandatory before compliance determination)

- **Company identity and registration**: CIN, company name, registered office, company type (private/public), incorporation date;
- **Financial year**: 1 April to 31 March (standard); any exemption or variation must be documented with Registrar approval;
- **Company classification**: Small company (section 92), large company (section 96), holding/subsidiary, or other; determined from paid-up capital and turnover thresholds for the financial year;
- **Audit applicability**: Whether company is subject to statutory audit per section 139; if exempt, exemption notification must be documented;
- **Auditor appointment status** (if audit required): Auditor name, qualification credentials, appointment resolution (Board or AGM), and audit scope;
- **AGM conduct**: AGM date, shareholder resolutions for approval of accounts and auditor (if applicable), voting record;
- **Filing deadlines**: Registrar filing deadline for annual accounts is 30 days from AGM (specific to company type and FY close date).

### Due-event calculation

**Event trigger**: Financial year close (31 March).

**AGM timing**: Within 6 months from FY close (typically by 30 September); AGM may be extended by Registrar if cause shown.

**Registrar filing deadline**: 30 days from AGM (e.g., if AGM is on 25 August, filing deadline is approximately 24 September).

**Form filing due dates** (alongside annual accounts):
- **Form AOC-4** (consolidated statement, if holding company): Due with annual accounts;
- **Form MGT-7** (Board Meetings): Due with annual accounts;
- **Form MGT-7A** (Audit Committee Meetings, if applicable): Due with annual accounts;
- **Form ADT-1** (auditor details): Due with annual accounts;
- **Form DPT-3** (director details): Due with annual accounts;
- **Form MSME-1** (MSME disclosure, if applicable): Due with annual accounts.

### Source snapshot and workflow state

**State 1: Accounts prepared and finalized**
- Trigger: Financial year close (31 March);
- Data snapshot: Balance Sheet, Profit & Loss, Cash Flow Statement (if applicable), consolidated statements (if holding company), notes to accounts, audit report (if applicable);
- Output: Final audited or unaudited accounts per company classification.

**State 2: Audit initiated** (if applicable)
- Trigger: Statutory audit requirement determined per section 139;
- Data snapshot: Auditor engagement, audit scope, financial-account linkage, audit timeline;
- Output: Audit engagement letter or audit notification to company.

**State 3: Audit completed** (if applicable)
- Trigger: Auditor completes audit examination;
- Data snapshot: Audit findings, auditor opinion (unqualified, qualified, adverse, disclaimer), Statutory Auditor Report per section 143;
- Output: Auditor report with signature and date; management comments (if any).

**State 4: Board report prepared and approved**
- Trigger: Accounts and audit (if applicable) are finalized;
- Data snapshot: Board report content per section 134 and Schedule VI (mandatory disclosures, dividend policy, director comments, auditor findings if any), Board approval at Board meeting;
- Output: Board report with Board meeting resolution and signatures.

**State 5: Annual accounts prepared for filing**
- Trigger: Accounts, audit report, and Board report are complete;
- Data snapshot: All documents assembled per Registrar filing requirements; e-form data prepared (Form AOC-4, MGT-7, ADT-1, DPT-3, MSME-1 as applicable);
- Output: Annual accounts package with all forms and supporting documents.

**State 6: AGM held and shareholder approval obtained**
- Trigger: AGM is held within 6 months from FY close;
- Data snapshot: AGM date, shareholder resolutions for accounts/auditor approval, voting record, AGM minutes, attendance register;
- Output: AGM minutes document; approval evidence.

**State 7: Registrar filing submitted**
- Trigger: AGM is held; accounts are prepared and ready for filing;
- Data snapshot: Filing date, forms (AOC-4, MGT-7, ADT-1, DPT-3, MSME-1, etc.), signatory method (Director DSC or authorized signatory), CIN, tax year;
- Output: eMCA portal submission confirmation; filing reference pending.

**State 8: Registrar filing accepted**
- Trigger: eMCA processes annual accounts filing and issues acceptance or rejection;
- Data snapshot: Filing acceptance status, Registrar reference number (if accepted), rejection reason (if rejected);
- Output: Filed status recorded; Registrar reference and acceptance evidence retained.

### Preparation workflow and validation

**Preparation**: Company secretary or compliance professional prepares annual compliance:
1. **Accounts finalization**: Balance Sheet, Profit & Loss, and supporting schedules are prepared per Accounting Standards and section 133;
2. **Audit (if required)**: Statutory audit is conducted per section 139; auditor report is obtained;
3. **Board report**: Board report content is prepared per section 134 and Schedule VI; mandatory disclosures are completed; Board meeting is held and Board report is approved;
4. **Form preparation**: Forms AOC-4, MGT-7, ADT-1, DPT-3, MSME-1 (as applicable) are filled with required data (form structures marked OPEN pending MCA form instruction kits per [mca-companies-act-compliance-matrix.md](mca-companies-act-compliance-matrix.md));
5. **AGM preparation**: Notice to shareholders is sent at least 21 days before AGM; AGM is held; shareholder resolutions for accounts and auditor approval are passed; AGM minutes are recorded;
6. **Registrar filing**: All documents are assembled and filed with Registrar via eMCA portal within 30 days of AGM.

**Validation gates**:
- **Audit gate**: If audit required, audit report is complete and linked before filing;
- **Board approval gate**: Board report is approved at Board meeting before AGM;
- **Shareholder approval gate**: Annual accounts and Board report are approved at AGM via shareholder resolution before Registrar filing;
- **Form completeness gate**: All applicable forms (AOC-4, MGT-7, ADT-1, DPT-3, etc.) are filled with required data;
- **Filing deadline gate**: Filing is submitted to Registrar within 30 days of AGM;
- **AGM timing gate**: AGM is held within 6 months from FY close (or approved extension).

**Silent failure prevention**:
- Accounts filed with Registrar before AGM approval: **BLOCK** until shareholder AGM approval is documented;
- Audit report missing when audit required: **BLOCK** until audit is complete;
- Form data incomplete (e.g., auditor details missing from ADT-1): **BLOCK** and prompt completion;
- Filing submitted without Director signature or proper authorization: **BLOCK** until signature authorization is confirmed;
- Filing submitted after 30-day deadline without extension: **WARN** and surface rejection risk.

### Human/professional review and authorization

**Review by statutory auditor** (if applicable):
- **Audit**: Auditor examines accounts, vouchers, and records per Accounting Standards; auditor provides audit opinion in Statutory Auditor Report per section 143;
- **Evidence**: Auditor report with auditor signature, date, and audit firm details retained with annual accounts.

**Review by company secretary or compliance officer** (optional but recommended):
- **Compliance verification**: CS verifies all mandatory disclosures, form completeness, and filing deadlines; may certify compliance status;
- **Evidence**: CS certificate or compliance memo retained with filing documents.

**Board authorization**:
- **Board meeting**: Board meets and approves annual accounts, Board report, auditor appointment/continuation (as applicable);
- **Board resolution**: Documented in Board minutes; signed by Board members.

**Director/authorized signatory**:
- **Signature**: Director or authorized officer signs annual accounts package and e-forms before Registrar filing;
- **Signature method**: DSC (Digital Signature Certificate) or authorized-signatory method per eMCA protocol.

### Export and portal submission

**Export format**:
- **eMCA e-forms**: Forms AOC-4, MGT-7, MGT-7A, ADT-1, DPT-3, MSME-1 as JSON/XML per eMCA module specification (format marked OPEN pending MCA form instruction kits);
- **Annual accounts attachment**: PDF or image of Balance Sheet, Profit & Loss, notes, audit report (if applicable), Board report;
- **Registrar filing package**: All e-forms and documents assembled per eMCA filing protocol.

**Manual portal action**:
- **Portal user (Director, Company Secretary, or authorized signatory)**: Logs into eMCA portal, selects CIN and financial year, fills or uploads e-forms, attaches supporting documents (audit report, Board approval, AGM minutes), signs using DSC or authorized-signatory method per eMCA protocol;
- **Portal workflow**: Annual accounts filing is submitted for processing; portal may auto-validate (e-form field completeness, document attachment) or may require manual review by Registrar staff;
- **Evidence captured**: Filing date, signatory identity and method, portal reference, validation status, Registrar acknowledgement.

### Acknowledgement, rejection, correction, and amendment

**Filing acknowledgement**:
- **Accepted**: eMCA issues Registrar reference number and filed status; company receives confirmation from portal;
- **Evidence**: Registrar reference, filing date, acceptance confirmation, Registrar e-mail or letter retained.

**Filing rejection**:
- **Rejected**: eMCA returns specific rejection reason (form incomplete, signature invalid, document missing, data inconsistent, etc.);
- **Correction action**: Company secretary or authorized officer corrects the issue and re-files; correction is tracked as separate filing;
- **Evidence**: Rejection reason, correction details, re-filing reference retained.

**Correction after acceptance**:
- **Amended filing** (if available under current rules): Mechanism for filing correction after Registrar acceptance is marked **OPEN** pending MCA rule verification;
- **Conditions and timeline**: Applicability and deadline for amended filing marked OPEN;
- **Evidence**: Original filing reference, amended filing reference, amendment reason retained.

**Rectification by Registrar**:
- **Registrar notice**: Registrar may issue notice under section 399 if defects are observed in filed accounts or forms;
- **Company response**: Company must respond within prescribed period and file corrections or clarifications;
- **Evidence**: Registrar notice, company response, correction filing reference retained for audit trail.

### States and no false 'filed' status

**Terminal states**:
1. **Annual accounts and Board report completed** (intermediate state; no final status until AGM approval and Registrar filing);
2. **AGM held and shareholder approval obtained** (intermediate state; no final status until Registrar filing is accepted);
3. **Registrar filing accepted with Registrar reference** (final state for that financial year).

**Never mark as 'filed' or 'accepted' unless**:
- **Registrar filing**: eMCA has accepted annual accounts and issued Registrar reference number (do not mark filed from submission alone);
- **Filing completion**: Registrar reference and acceptance date are in company records.

**Intermediate states** (do not represent filing completion):
- Submitted to eMCA without acceptance;
- Rejection and correction in progress;
- Pending Registrar processing.

## Cross-contract linkages and integration points

### TDS/TCS workflow → Payroll workflow

- **Boundary**: Salary TDS (covered in [payroll-compliance-matrix.md](payroll-compliance-matrix.md)) is separate from non-payroll TDS (covered in this contract);
- **Integration**: If an employee receives both salary TDS (Form 130/Form 138 per payroll contract) and non-payroll TDS (e.g., rent payment to employee as landlord, covered in this TDS/TCS contract), ensure both are recorded separately and Form 140 annual certificate properly consolidates or distinguishes both sources;
- **Open item**: Interaction between payroll Form 130 and non-payroll Form 140 is marked OPEN in [tds-tcs-compliance-matrix.md](tds-tcs-compliance-matrix.md); payroll claims about Form 130 filing are marked OPEN/implementation-blocked pending direct official source verification.

### Annual income-tax return → Payroll workflow

- **Boundary**: Payroll income/TDS is computed in payroll contract; Form 130 or Form 138 is generated per payroll contract;
- **Integration**: Annual income-tax return (this contract) incorporates payroll income and TDS credit from payroll contract's Form 130 or Form 138 into total-income and TDS-credit computation;
- **Data flow**: Payroll contract produces Form 130 certificate by 15 June; annual return contract imports TDS amount from Form 130 for return preparation (by 31 July).

### Annual income-tax return → Company statutory compliance

- **Boundary**: Company statutory compliance (this contract) prepares annual accounts per section 133; annual income-tax return uses company's audited accounts and Form 26 tax computation;
- **Integration**: Company's audited Balance Sheet and Profit & Loss form the basis for company's annual income-tax return if company is filing ITR; company's total income and tax are reconciled between annual accounts and return;
- **Data flow**: Company statutory compliance generates audited accounts; annual-return contract imports audited accounts for Form 26 tax computation.

### Company statutory compliance → GST workflow

- **Boundary**: Company statutory compliance covers financial reporting and auditor appointment; GST compliance (covered in [gst-compliance-matrix.md](gst-compliance-matrix.md)) covers GSTR-1, GSTR-3B, and ITC;
- **Integration**: Company's audited accounts include GST liability and paid-GST figures (from GSTR-3B or GST payment evidence); company's annual return includes GST-paid credit if applicable;
- **Data flow**: GST contract produces GSTR-3B filing and GST payment evidence; company contract imports GST figures into financial accounts.

### All workflows → Evidence and acknowledgement

- **Common gate**: All contracts (TDS/TCS, annual return, company compliance) require portal acknowledgement (ARN, Registrar reference) as final proof of filing; upload/submission alone is not filing;
- **Common evidence**: All contracts retain portal receipts, filing dates, rejection/correction history, and final acknowledgement in tenant records for audit trail and statutory preservation.

## Open items and implementation blocks

The following items are marked **OPEN** or **IMPLEMENTATION-BLOCKED** and must be resolved before deterministic implementation:

1. **TDS/TCS rates and thresholds**: Section 393 and section 392 rates, thresholds, and exemption criteria must be verified from official Form 140 instruction kit;
2. **Form 141 and Form 140 structure and fields**: Form 141 quarterly and Form 140 annual certificate field mapping, mandatory disclosures, and portal upload format must be verified from official MCA ITD form kits;
3. **Annual return forms and notification 22**: Rule 164 and Notification 22 must specify current applicable return form code and structure for each entity type and income combination;
4. **Form 26 filing requirement**: Whether Form 26 is filed with portal return or retained for audit reference must be clarified from official Form 26 instruction kit;
5. **Advance-tax installment dates**: Official Notification 24 or applicable rule must confirm current advance-tax installment due dates for the financial year;
6. **Depreciation rates**: Official depreciation schedule (Notification 23 or applicable rule) must confirm rates for buildings, plant/machinery, vehicles, and intangible assets;
7. **MCA form instruction kits**: Current versions of all statutory forms (AOC-4, MGT-7, ADT-1, DPT-3, MSME-1, etc.) must be verified from MCA's official form portal;
8. **Audit Committee applicability**: Current rules must confirm applicability threshold, composition, and meeting frequency for Audit Committee requirement;
9. **Auditing and Assurance Standards**: Current auditing standards (SA suite, UASG) must be verified for auditor report format and opinion criteria;
10. **Payroll Form 130 interaction**: Payroll Form 130 filing requirement and interaction with non-payroll Form 140 must be resolved from official specifications and marked OPEN in payroll contract until clarified.

Until these items are resolved with applicable official sources, the product must surface explicit review/block outcomes rather than invent rates, forms, dates, or filing assumptions.

## Appendix: referenced contracts and matrices

- [gst-compliance-matrix.md](gst-compliance-matrix.md) — GST compliance baseline and GSTR-1/GSTR-3B/ITC workflow;
- [payroll-compliance-matrix.md](payroll-compliance-matrix.md) — Payroll TDS (Form 130/Form 138), EPF, ESI, PT, LWF baseline and workflow;
- [tds-tcs-compliance-matrix.md](tds-tcs-compliance-matrix.md) — TDS/TCS (Form 141/Form 140) compliance baseline;
- [annual-income-tax-compliance-matrix.md](annual-income-tax-compliance-matrix.md) — Annual income-tax (Form 26 and return) compliance baseline;
- [mca-companies-act-compliance-matrix.md](mca-companies-act-compliance-matrix.md) — Company statutory compliance (sections 92–143, audit, AGM, Registrar filing) baseline;
- [expense-evidence-policy.md](expense-evidence-policy.md) — Invoice, bill, and expense document evidence requirements;
- [accounting-contracts.md](accounting-contracts.md) — Canonical ledger, invoice, and bill workflow contracts;
- [decisions.md](decisions.md) — Confirmed product decisions and boundaries;
- [architecture-decisions.md](architecture-decisions.md) — Provisional architecture decisions and recommendations.

## Prior work notes

Prior workers (ro82, ro84, ro86) produced material errors and are not referenced in this baseline. This document uses only current official primary sources verified as of 21 August 2026.
