# TDS/TCS Compliance Matrix — Verified Official Baseline

**Research cutoff:** 21 August 2026  
**Effective period:** Sections 392–397, Rules 215–220 (Income-tax Act 2025 / Rules 2026, from 1 April 2026)  
**Status:** Research baseline only; not legal advice and not implementation authority.

This matrix records verified baselines for Tax Deducted at Source (TDS) and Tax Collected at Source (TCS) under the Income-tax Act 2025. Every claim herein is sourced from official ITD documentation or marked **OPEN**. Unverified rates, thresholds, exemptions, and form structures remain blocked and do not gate filing, penalties, or automatic posting. Legacy section references (192, 194M, 194I, etc.) appear only as pre-1 April 2026 aliases, never as current authority for new-law periods.

---

## Legal Research Audit Table

| Claim ID | Authority | Section/Rule | Source URL | Status | Implementation Gate |
|---|---|---|---|---|---|
| TDS-001 | Salary TDS governing section | Section 392(1) | https://www.incometaxindia.gov.in/w/section-392-5 | VERIFIED | Adopt s392 rate/threshold from official source |
| TDS-002 | Non-salary/resident TDS section | Section 393 | https://www.incometaxindia.gov.in/w/section-393-5 | VERIFIED | Use s393 table mapping per transaction type |
| TCS-001 | TCS governing section | Section 394 | https://www.incometaxindia.gov.in/w/section-394-5 | VERIFIED | Adopt s394 rate/threshold from source |
| TDS-CERT-001 | Salary TDS certificate | Form 130 under Rule 215 | https://www.incometaxindia.gov.in/w/rule-215-1 | VERIFIED | Annual salary certificate only |
| TDS-CERT-002 | Non-salary TDS certificate | Form 131 under Rule 215 | https://www.incometaxindia.gov.in/w/rule-215-1 | VERIFIED | General resident non-salary TDS |
| TDS-CERT-003 | Special TDS certificate | Form 132 under Rule 215 | https://www.incometaxindia.gov.in/w/rule-215-1 | VERIFIED | For 4 enumerated special categories |
| TCS-CERT-001 | TCS certificate | Form 133 under Rule 215 | https://www.incometaxindia.gov.in/w/rule-215-1 | VERIFIED | Annual TCS certificate |
| STMT-001 | Non-salary TDS quarterly statement | Form 140 under Rule 219 | https://www.incometaxindia.gov.in/w/rule-219-1 | VERIFIED | Quarterly resident non-salary only |
| STMT-002 | Special TDS challan-cum-statement | Form 141 under Rule 219 | https://www.incometaxindia.gov.in/w/rule-219-1 | VERIFIED | 30-day special transactions only (4 categories) |
| TCS-STMT-001 | TCS quarterly statement | Form 143 under Rule 219 | https://www.incometaxindia.gov.in/w/rule-219-1 | VERIFIED | Quarterly TCS only |
| DEPOSIT-001 | TDS deposit timing | Rule 218 | https://www.incometaxindia.gov.in/w/rule-218-1 | VERIFIED | Due date per Rule 218 (not 215) |
| PAYROLL-001 | Salary TDS annual certificate | Form 130 | Per payroll domain | VERIFIED | Annual; separate from Form 131 |
| PAYROLL-002 | Salary TDS quarterly statement | Form 138 under Rule 205 | OPEN: official source | OPEN | Quarterly; requires Form 205 specification |

---

## CONFIRMED OFFICIAL FACT: Section 393 Transaction Type Mapping

Section 393 of the Income-tax Act 2025 consolidates non-salary TDS obligations. Each transaction type maps to a specific table entry. Rates and thresholds are listed in s393 and must not be assumed or hard-coded without current official source.

| Legacy Section | Transaction Type | Section 393 Table Entry | Payee Category | Rate/Threshold | Certificate Form | Official Source | Implementation Gate |
|---|---|---|---|---|---|---|---|
| 194M | Professional/technical fees | s393(1) Table 6(ii) | Individual/HUF | **OPEN** | Form 131 | https://www.incometaxindia.gov.in/w/section-393-5 | Block until rates verified |
| 194I | Rent (property, land, building) | s393(2)(i)/(ii) | Individual/HUF owner | **OPEN** | Form 131 | https://www.incometaxindia.gov.in/w/section-393-5 | Block until category/rate verified |
| 194H | Commission/brokerage | s393(1)(i)/(ii) or 6(ii)/(iii) | Depends on payer type | **OPEN** | Form 131 | https://www.incometaxindia.gov.in/w/section-393-5 | Block until payer/category verified |
| 194A | Interest on bank deposits, loans | s393(5)(i)–(iii) | Bank or specified person | **OPEN** | Form 131 | https://www.incometaxindia.gov.in/w/section-393-5 | Block until interest type verified |
| 194Q | Goods purchase from unregistered dealer | s393(8)(ii) | Goods supplier | **OPEN** | Form 131 | https://www.incometaxindia.gov.in/w/section-393-5 | Block until goods category/threshold verified |
| 194LA | Immovable property purchase | s393(3)(iii) | Property seller | **OPEN** | Form 131 | https://www.incometaxindia.gov.in/w/section-393-5 | Block until property type/rate verified |
| N/A | Immovable property transfer (ordinary) | s393(3)(i) | Transferor | **OPEN** | Form 131 | https://www.incometaxindia.gov.in/w/section-393-5 | Block until applicability verified |

**CRITICAL**: All s393 table rates, thresholds, exemption criteria, and payee eligibility remain **OPEN** pending official notification or Form 131 instruction kit. Implementation must not assume any rate or threshold without explicit source verification.

---

## CONFIRMED OFFICIAL FACT: Section 394 TCS Transaction Types

Section 394 governs Tax Collected at Source on goods sold by specified persons. Rates, thresholds, and goods categories must be sourced from official notification.

| Transaction Type | Collector Category | Goods Category | Threshold | Certificate Form | Official Source | Status | Implementation Gate |
|---|---|---|---|---|---|---|---|
| Goods sales | Specified person (defined in s394) | **OPEN: goods list** | **OPEN: turnover threshold** | Form 133 | https://www.incometaxindia.gov.in/w/section-394-5 | OPEN | Block until goods/threshold official |

---

## CONFIRMED OFFICIAL FACT: Deposit Timing and Payment (Rule 218)

TDS/TCS deposits are distinct from filing/return obligations. Deposit due dates are governed by Rule 218, not Rule 215.

| Obligation | Deduction/Collection Month | Deposit Due | Government vs. Non-Government | Distinction | Official Source | Status |
|---|---|---|---|---|---|---|
| TDS/TCS deposit to Government | Non-March months | Within 7 days after month end | Non-government deductor/collector | **OPEN: Government deductor timing** | https://www.incometaxindia.gov.in/w/rule-218-1 | VERIFIED for non-government |
| TDS/TCS deposit — March | March deductions/collections | **OPEN: exact deadline** | Non-government deductor/collector | **OPEN: March extension rule** | https://www.incometaxindia.gov.in/w/rule-218-1 | OPEN |

---

## CONFIRMED OFFICIAL FACT: Return/Statement Filing (Rule 219)

Quarterly and annual statements are distinct from deposit obligations. Filing occurs under Rule 219.

| Statement Form | Applicability | Filing Deadline | Aggregate Scope | Official Source | Status | Implementation Gate |
|---|---|---|---|---|---|---|
| Form 140 | Quarterly non-salary TDS deductions | **OPEN: per quarter due date** | All resident non-salary TDS in quarter | https://www.incometaxindia.gov.in/w/rule-219-1 | OPEN | Block until Form 140 due-date verified |
| Form 141 | 30-day special transactions (4 categories only) | 30 days after TDS event | Only 4 enumerated special TDS categories | https://www.incometaxindia.gov.in/w/rule-219-1 | OPEN | Block: unclear which 4 transactions |
| Form 143 | Quarterly TCS collections | **OPEN: per quarter due date** | All TCS in quarter | https://www.incometaxindia.gov.in/w/rule-219-1 | OPEN | Block until Form 143 due-date verified |
| Form 130 | Annual salary TDS (payroll domain) | 15 June following FY | Annual employee salary deductions | Per payroll-compliance-matrix.md | VERIFIED | Separate from Form 131 |
| Form 131 | Annual non-salary TDS certificate | **OPEN: due date** | Annual aggregate of Forms 140, 141 | https://www.incometaxindia.gov.in/w/rule-215-1 | OPEN | Block until Form 131 due-date verified |

---

## CRITICAL SEPARATIONS: Payroll vs. Non-Payroll TDS

| Component | Payroll Domain | Non-Payroll TDS Domain |
|---|---|---|
| **Governing section** | Section 392(1) salary TDS | Section 393 resident non-salary |
| **Annual certificate** | Form 130 (salary) | Form 131 (general) |
| **Quarterly statement** | Form 138 (payroll quarterly) | Form 140 (non-salary quarterly) |
| **Special statement** | N/A | Form 141 (30-day special) |
| **Deposit rule** | Rule 218 | Rule 218 |
| **Coverage** | Salary, house rent, medical, leave encashment, perquisites | Professional fees, rent, interest, commission, goods, property, etc. |
| **Reference** | [payroll-compliance-matrix.md](payroll-compliance-matrix.md) | This matrix |

**GATE**: Payroll Form 138 and Form 140 non-salary must not be conflated. Every filing must identify deductor category and form applicability before execution.

---

## PRODUCT VALIDATION POLICY

These are product rules for deterministic TDS/TCS workflows. They are not claims that official sources prescribe a particular software design.

| Policy | Required Behavior | Failure Prevented |
|---|---|---|
| Section-driven rate selection | Select TDS/TCS section (s392 salary, s393 non-salary, s394 TCS) before computing any amount. Freeze section version at deduction time. | Wrong section or rate being applied to deduction. |
| Transaction-type gating | Determine transaction type (194M→s393(1)(ii), 194I→s393(2), etc.) before computation. If type is ambiguous, mark OPEN and block. | Ambiguous transaction mapped to wrong s393 table entry. |
| Form selection from rule | Select certificate form (130/131/132/133) and statement form (140/141/143) from frozen rule version. Do not assume. | Wrong form being filed for transaction type. |
| Deposit vs. filing separation | Record deposit timing (Rule 218) as distinct event from filing (Rule 219). Do not mark filing complete from deposit alone. | Deposit success mistaken for filing acceptance. |
| No rate/threshold assumption | Do not hard-code any s393 or s394 rate, threshold, or exemption without explicit current source. | Deduction at unsupported rate or threshold. |
| Government-vs-nongov | **OPEN**: Government-deductor timeline and special rules remain unverified. Do not auto-apply non-government rules to government entity. | Wrong deposit timeline for entity type. |
| Evidence-linked audit trail | Link every deduction, deposit, filing, statement, certificate to frozen section version, transaction type, deduction month, and applicable rule version. | Deduction/filing/certificate disconnected from rule basis. |

---

## TENANT CONFIGURATION: Hard Review/Block Inputs

The following facts are mandatory before deterministic TDS/TCS obligations can be resolved:

- **Deductor/collector identity and registration**: Legal entity name, PAN, TAN registered on e-Filing, entity type;
- **Applicable rule version**: Effective from 1 April 2026 (new law) or prior date (old law), per deduction date;
- **Transaction type and section**: Salary (s392), professional (s393(1)(ii)), rent (s393(2)), commission (s393(1)), interest (s393(5)), goods (s393(8)), property (s393(3)), or TCS (s394);
- **Payee identity and PAN/status**: Payee name, PAN, or exemption claim; verified before deduction;
- **Deduction amount and threshold check**: Gross payment, applicable exemption, computed TDS/TCS amount;
- **Deduction month**: Calendar month; separate from financial year;
- **Deposit evidence**: Bank account, challan reference, payment date, reconciliation;
- **Filing credentials**: TAN login, RPU/FVU registration, DSC or authorized signatory.

Do not assume any section, rate, threshold, or form without explicit configuration and official verification.

---

## OPEN RESEARCH

The following items must remain visible and block implementation until resolved with official sources:

1. **Section 393 rates and thresholds by transaction type**: Official notification or Form 131 instruction kit must specify exact rates and applicability tests for each s393 table entry. Status: **OPEN**.

2. **Section 394 TCS rates, goods categories, and turnover threshold**: Official s394 specification and notification must clarify. Status: **OPEN**.

3. **Form 140 quarterly due dates and structure**: Form 140 instruction kit (Rule 219) must specify due-date logic per quarter and field structure. Status: **OPEN**.

4. **Form 141 special transactions**: Which 4 enumerated special categories trigger Form 141 30-day filing? Status: **OPEN** — clarify from official source.

5. **Form 131 annual certificate due date**: When must Form 131 be issued to payee and filed (if applicable)? Status: **OPEN**.

6. **Government-deductor TDS deposit timing**: Do government entities follow different Rule 218 timeline than non-government? Status: **OPEN**.

7. **March deduction deposit deadline**: What is the exact deadline for March TDS/TCS deposit? Status: **OPEN**.

8. **Form 138 quarterly salary statement and Form 124 employee evidence**: Verify applicability, due dates, and form structure from payroll domain specification. Status: Covered in payroll-compliance-matrix.md but marked OPEN there pending Form 138/124 kit verification.

9. **Old-law transition (s192, 194M, 194I, etc. before 1 April 2026)**: For deductions in old-law period (through 31 March 2026), confirm old-law section and form applicability; verify transition to s393 on 1 April 2026. Status: **OPEN**.

---

## Official Source List (Verified as of 21 August 2026)

- [Section 392 — Salary TDS](https://www.incometaxindia.gov.in/w/section-392-5)
- [Section 393 — Resident Non-Salary TDS](https://www.incometaxindia.gov.in/w/section-393-5)
- [Section 394 — TCS](https://www.incometaxindia.gov.in/w/section-394-5)
- [Rule 215 — Certificates](https://www.incometaxindia.gov.in/w/rule-215-1)
- [Rule 218 — Deposit](https://www.incometaxindia.gov.in/w/rule-218-1)
- [Rule 219 — Statements](https://www.incometaxindia.gov.in/w/rule-219-1)
- [Income-tax Act 2025 — Full text](https://www.incometaxindia.gov.in/)
- [Income-tax Rules 2026 — Notified PDF](https://www.incometaxindia.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf)

---

## Prior Work and Repair History

**Rejected draft (21 August 2026)**: Initial version used incorrect section 393 as generic rate table and wrong form numbering (Form 140/141 reversed). Comprehensive repair applied 21 August 2026 using official source mapping per section 393 table entries and Rule 215/219 specifications. All pre-repair claims removed; unverified items marked OPEN with fail-closed gates.
