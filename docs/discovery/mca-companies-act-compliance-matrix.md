# MCA Companies Act Compliance Matrix — Verified Official Baseline

**Research cutoff:** 21 August 2026  
**Effective period:** Companies Act, 2013 and the cited rules/orders as effective for the obligation
**Status:** Research baseline only; not legal advice and not implementation authority.

This matrix is the source-of-truth boundary for current Companies Act documentation. A legal claim may be used operationally only when its audit row is **VERIFIED**, `source_verified=true`, and the exact effective source is frozen in `effective_rule_snapshot`. **OPEN** and **TENTATIVE** claims hard-block preparation, filing, automatic posting, and deadline selection. Historical records may be imported and preserved, but historical form names never authorize a current filing.

The Companies Act statutory audit is separate from the section 63 income-tax audit. A mandatory Companies Act audit does not determine an income-tax return deadline; tax due dates remain in the separate, profile-driven income-tax contract.

## Legal research audit table

| Audit ID | Claim | Authority and nearby official source | Status | Operational gate |
|---|---|---|---|---|
| MCA-AUDIT-001 | Every company appoints an auditor under s139; small-company and OPC status do not create an audit exemption. | [Companies Act s139](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Require Companies Act auditor state for every company; keep it separate from s63 tax-audit state. |
| MCA-AUDIT-002 | Non-government first auditor: Board within 30 days of registration; on failure, members appoint at an EGM within 90 days under s139(6). | [Companies Act s139(6)](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Use this first-auditor state machine only for non-government companies. |
| MCA-AUDIT-003 | Government-company first auditor: CAG within 60 days; if CAG does not appoint, Board in the next 30 days; if Board fails, members within the next 60 days at an EGM under s139(7). | [Companies Act s139(7)](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Keep the government-company path separate from s139(6). |
| MCA-AUDIT-004 | Subsequent auditor appointment follows s139(1) at the applicable AGM and term; s139(1) does not create a generic within-30-days appointment rule. | [Companies Act s139(1)](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Never infer a 30-day subsequent-appointment deadline. |
| MCA-AUDIT-005 | Casual vacancy: Board fills a non-government vacancy within 30 days; only a resignation-caused vacancy also requires member approval at a general meeting within three months of the Board recommendation, under s139(8). | [Companies Act s139(8)](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Track vacancy cause; do not require three-month member approval for every vacancy. |
| MCA-AUDIT-006 | Removal before term expiry requires a company special resolution and prior Central Government approval; the auditor must have a reasonable opportunity of being heard, under s140(1). | [Companies Act s140(1)](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Block removal without both approvals and hearing evidence. |
| MCA-AUDIT-007 | A resigning auditor files the prescribed resignation statement with the company and Registrar within 30 days under s140(2), and with CAG where applicable. | [Companies Act s140(2)](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Track auditor filing separately from company appointment or vacancy state. |
| MCA-AUDIT-008 | Auditor eligibility and disqualification come from s141 and the Companies (Audit and Auditors) Rules; Schedule IV is not auditor qualification authority. | [Companies Act s141](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf), [Audit and Auditors Rules, rules 3–4](https://www.mca.gov.in/Ministry/pdf/NCARules_Chapter10.pdf) | **VERIFIED** | Do not use Schedule IV for auditor qualification checks; unresolved rule detail remains blocked. |
| MCA-AUDIT-009 | Financial statements are Board-approved before signature; s134(1) sets the signature alternatives and OPC one-director rule, and the auditor report is attached under s134(2). | [Companies Act s134](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Enforce approval-before-signature and all applicable signatures. |
| MCA-AUDIT-010 | Board-report disclosures are sourced from s134(3) and the Accounts Rules, not Schedule VI. | [Companies Act s134(3)](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf), [Accounts Rules](https://www.mca.gov.in/Ministry/pdf/Rules_09072015.pdf) | **VERIFIED for source boundary** | Detailed disclosure field mapping remains OPEN until the applicable current rule snapshot is attached. |
| MCA-AUDIT-011 | s137 governs financial-statement filing, including the 30-day AGM path, provisional unadopted filing, no-AGM path, and OPC member-adopted 180-day path. | [Companies Act s137](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Do not substitute s394 or let a missing adoption block the statutory provisional path. |
| MCA-AUDIT-012 | An OPC has no AGM under s96; member business is communicated and entered in signed, dated minutes under s122(3), and one-director Board business follows s122(4). | [Companies Act ss96 and 122](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Require member adoption evidence; never model OPC as Board-only or as “no member approval.” |
| MCA-AUDIT-013 | Annual return under s92(4) is due within 60 days of the AGM, or, if no AGM was held, within 60 days of the date it should have been held with reasons. | [Companies Act s92(4)](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Never reuse the OPC 180-day financial-statement deadline for annual return. |
| MCA-AUDIT-014 | MGT-7 applies other than to OPCs and small companies; MGT-7A is the abridged form for OPCs and small companies from FY 2020-21. | [MGT Rules amendment 2021](https://www.mca.gov.in/Ministry/pdf/CompaniesMgmtAdminAmndtRules_11032021.pdf) | **VERIFIED for form split** | Select by the frozen company classification and FY; detailed fields remain source-kit gated. |
| MCA-AUDIT-015 | Small-company classification first applies all s2(85) exclusions, then tests current thresholds of paid-up capital not over ₹4 crore and turnover not over ₹40 crore under G.S.R. 700(E). An OPC qualifies only if every condition is met. | [Companies Act s2(85)](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf), [G.S.R. 700(E)](https://www.mca.gov.in/content/dam/mca/pdf/notification-small-company-2015.pdf) | **VERIFIED** | Reject public, holding/subsidiary, s8, special-Act, and other statutory exclusions before threshold testing. |
| MCA-AUDIT-016 | AGM: first within nine months of first FY close; later within six months of FY close; Registrar extension up to three months applies only after the first AGM. | [Companies Act s96](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Do not map this to s106 or Rule 2A; do not extend the first AGM. |
| MCA-AUDIT-017 | s121 AGM report is a 30-day Registrar filing only for listed public companies; ordinary company minutes are retained internally under the minutes provisions. | [Companies Act ss118–121](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Do not create generic AGM-minutes filing or s121 obligations for every company. |
| MCA-AUDIT-018 | s177 Audit Committee composition/functions are governed by s177 and applicable Board Powers Rule 6; there is no separate Registrar-filed “Audit Committee Report” created by these provisions. | [Companies Act s177](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf), [Board Powers Rule 6 amendment](https://www.mca.gov.in/Ministry/pdf/CompaniesMeetingBoardPowersSecondRules_14072017.pdf) | **OPEN+BLOCK for applicability profile** | Composition/functions are source-verified; exact company applicability must be resolved from the current Rule 6/rule 4 profile before execution. |
| MCA-AUDIT-019 | Standalone financial statements use AOC-4; consolidated financial statements, if required, use AOC-4 CFS. CFS is not automatic merely because an associate exists; apply s129(3) and Accounts Rule 6 exemptions first. | [Accounts Rules, rule 12](https://www.mca.gov.in/Ministry/pdf/Rules_09072015.pdf), [Accounts Rule 6 amendment](https://www.mca.gov.in/Ministry/pdf/CompaniesAccountsAmendmentRules_28072016.pdf), [Companies Act s129](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED for routing; OPEN for profile** | AOC-4 CFS is blocked until the CFS obligation and Rule 6 exemption facts are frozen. |
| MCA-AUDIT-020 | DPT-3 is the return of deposits and particulars of money or loans not treated as deposits; it is not a director/KMP return. The official kit states the annual 30 June filing for applicable non-government companies using information as at 31 March duly audited by the company auditor. | [DPT-3 Instruction Kit](https://www.mca.gov.in/content/dam/mca-aem-forms/instructionkits/Instruction%20Kit_DPT-3.pdf) | **VERIFIED** | Model applicability and the kit’s 30 June/31 March audited-data rule; reject director/KMP semantics. |
| MCA-AUDIT-021 | MSME-1 is a half-yearly return for applicable outstanding payments to micro and small enterprise suppliers; the specified order establishes the 30 April and 31 October cycle. It is not a company-classification test or generic Board-report disclosure. | [MSME specified-companies order](https://www.mca.gov.in/Ministry/pdf/MSMESpecifiedCompanies_22012019.pdf) | **VERIFIED for stated order; OPEN for tenant applicability** | Require the applicable order/profile facts before generating the return. |
| MCA-AUDIT-022 | 23AC was the historical balance-sheet filing and 23ACA the historical Profit and Loss filing; they are not current Companies Act 2013 filings. | [MCA legacy e-form mapping](https://www.mca.gov.in/Ministry/pdf/eformsMapping.pdf) | **VERIFIED** | Preserve valid historical records/imports; reject these forms for current filings without deleting historical encoding. |
| MCA-AUDIT-023 | DPT-7 is not a current filing route. Current deposit matters route to DPT-3; historical records referring to another form are preserved as history. | [DPT-3 Instruction Kit](https://www.mca.gov.in/content/dam/mca-aem-forms/instructionkits/Instruction%20Kit_DPT-3.pdf), [MCA forms mapping](https://www.mca.gov.in/Ministry/pdf/eformsMapping.pdf) | **VERIFIED for current route** | Reject DPT-7 as current; do not delete historical references or silently rewrite imports. |
| MCA-AUDIT-024 | Companies Act annual accounts use s137; s394 is not the annual-accounts filing section. | [Companies Act s137](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf) | **VERIFIED** | Reject s394 as an annual-accounts mapping. |

## Company classification and audit boundary

Apply s2(85) exclusions before thresholds. A company is not small if it is public, a holding or subsidiary company, registered under s8, governed by a special Act, or excluded by another applicable statutory rule. Only after exclusions pass may the profile test paid-up capital of **≤ ₹4 crore** and turnover of **≤ ₹40 crore** under G.S.R. 700(E). An OPC can qualify only if it passes the exclusions and both thresholds. See **MCA-AUDIT-015**.

Every company, including a small company and an OPC, must have the Companies Act auditor state required by s139. This is not the same state as an income-tax s63 audit. A company’s mandatory Companies Act audit must never be used to infer the income-tax return due-date branch. See **MCA-AUDIT-001** and the separate income-tax matrix.

## Auditor state machines

| State path | Required transition | Evidence and gate |
|---|---|---|
| Non-government first auditor | Registration → Board appointment within 30 days → if Board fails, members appoint at EGM within the next 90 days → office until conclusion of first AGM. | Board/EGM resolution and auditor consent/eligibility evidence; **MCA-AUDIT-002**. |
| Government-company first auditor | Registration → CAG appointment within 60 days → if no CAG appointment, Board in next 30 days → if Board fails, members appoint within next 60 days at EGM. | CAG, Board, or member appointment evidence matching the branch; **MCA-AUDIT-003**. |
| Subsequent appointment | Applicable AGM appointment/re-appointment under s139(1) → term/rotation profile check → notice to Registrar only where the current rule requires it. | Do not invent a generic 30-day appointment rule; **MCA-AUDIT-004**, **MCA-AUDIT-008**. |
| Casual vacancy | Vacancy → Board fills within 30 days for non-CAG company → if caused by resignation, member approval at a general meeting within three months of Board recommendation. | Vacancy cause, Board resolution, and approval evidence when resignation-caused; **MCA-AUDIT-005**. |
| Removal | Proposed removal → auditor hearing opportunity → prior Central Government approval → company special resolution. | All four events required; **MCA-AUDIT-006**. |
| Resignation | Auditor resignation → prescribed statement filed by auditor with company and Registrar within 30 days, plus CAG where applicable → vacancy path. | Auditor filing evidence; **MCA-AUDIT-007**. |
| Eligibility | Candidate → s141 eligibility/disqualification and Audit Rules certificate checks → appointment. | Use s141 and Audit Rules, never Schedule IV; unresolved rule/profile facts block; **MCA-AUDIT-008**. |

ADT-1 is the prescribed Registrar notice named by Audit Rules rule 4 for the fourth proviso to s139(1), with the 15-day notice period in s139(1). Keep whether that notice is required profile-driven and source-snapshot-driven; do not turn it into an invented universal appointment deadline. See [Audit Rules rule 4](https://www.mca.gov.in/Ministry/pdf/NCARules_Chapter10.pdf) and **MCA-AUDIT-008**.

## Financial statements, signatures, AGM, and OPC

### s134 signing sequence

1. The Board approves the financial statements first.
2. The statements are then signed on behalf of the Board by the chairperson when Board-authorised **or** by two directors, one being the managing director if any, plus the CEO if a director, CFO, and company secretary wherever appointed.
3. For an OPC, one director signs.
4. The auditor report is attached to every financial statement.

These are s134(1)–(2) controls, not optional workflow conventions. Board-report disclosures come from s134(3) and the Accounts Rules; they are not sourced from Schedule VI. A provisional s137 filing still uses the statutory signing and attachment requirements. See **MCA-AUDIT-009**, **MCA-AUDIT-010**, and **MCA-AUDIT-011**.

### AGM and OPC paths

| Company/path | Rule | Filing/record gate |
|---|---|---|
| First AGM | Within nine months of first FY close; no Registrar extension applies to the first AGM. | s96 evidence; **MCA-AUDIT-016**. |
| Later AGM | Within six months of FY close; Registrar may extend by up to three months for a later AGM. | s96 evidence and extension record; **MCA-AUDIT-016**. |
| Ordinary company minutes | Retain minutes internally under the Act; no generic “minutes filing” is created. | s118/121 profile check; only listed public companies file the s121 AGM report within 30 days; **MCA-AUDIT-017**. |
| OPC member adoption | No AGM. The member communicates the required ordinary/special business; the resolution is entered in the minutes book, signed and dated. | Require member resolution/minutes evidence under s122(3); **MCA-AUDIT-012**. |
| OPC Board business | If there is one director, Board business is entered in the minutes book and signed/dated by that director. | Do not replace member adoption with Board-only approval; **MCA-AUDIT-012**. |
| Financial-statement filing | s137: adopted statements within 30 days of AGM; if not adopted, unadopted statements within 30 days of AGM are recorded provisionally, then adopted statements within 30 days of adjourned AGM; OPC member-adopted statements within 180 days of FY close. | Preserve provisional state and signing rules; **MCA-AUDIT-011**. |
| Annual return | s92(4): within 60 days of AGM, or if no AGM, within 60 days of the date it should have been held plus reasons. | Never reuse 180 days for annual return; **MCA-AUDIT-013**. |

## Current forms and rejected mappings

| Form | Current role and timing | Status/gate | Source |
|---|---|---|---|
| AOC-4 | Standalone financial-statement filing under s137/rule 12. | Purpose verified; current field schema and tenant applicability remain source-kit gated. | [Accounts Rules rule 12](https://www.mca.gov.in/Ministry/pdf/Rules_09072015.pdf) |
| AOC-4 CFS | Consolidated financial-statement filing only when s129(3) requires CFS after applicable Accounts Rule 6 exemptions are tested. An associate does not automatically require CFS. | Routing verified; CFS applicability/profile and current field schema OPEN+BLOCK. | [s129](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf), [Accounts Rule 6](https://www.mca.gov.in/Ministry/pdf/CompaniesAccountsAmendmentRules_28072016.pdf), [rule 12](https://www.mca.gov.in/Ministry/pdf/Rules_09072015.pdf) |
| MGT-7 | Annual return for companies other than OPCs and small companies. | Form split verified; exact current field mapping OPEN until the official kit is frozen. | [MGT Rules amendment 2021](https://www.mca.gov.in/Ministry/pdf/CompaniesMgmtAdminAmndtRules_11032021.pdf) |
| MGT-7A | Abridged annual return for OPCs and small companies from FY 2020-21. | Form split verified; exact current field mapping OPEN until the official kit is frozen. | [MGT Rules amendment 2021](https://www.mca.gov.in/Ministry/pdf/CompaniesMgmtAdminAmndtRules_11032021.pdf) |
| ADT-1 | Registrar notice of auditor appointment where rule 4/current profile requires it; 15-day period under s139(1). | Profile-driven; do not universalise the deadline as appointment timing. | [Companies Act](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf), [Audit Rules](https://www.mca.gov.in/Ministry/pdf/NCARules_Chapter10.pdf) |
| DPT-3 | Return of deposits and particulars of money or loans not treated as deposits; annual 30 June route for applicable non-government companies using 31 March information duly audited by the company auditor. | Verified from the official kit; reject director/KMP semantics. | [DPT-3 Instruction Kit](https://www.mca.gov.in/content/dam/mca-aem-forms/instructionkits/Instruction%20Kit_DPT-3.pdf) |
| MSME-1 | Half-yearly return for applicable outstanding payments to micro/small suppliers; order cycle is 30 April and 31 October. It is not classification or a generic Board-report disclosure. | Order purpose/dates verified; current company applicability profile OPEN+BLOCK. | [MSME specified-companies order](https://www.mca.gov.in/Ministry/pdf/MSMESpecifiedCompanies_22012019.pdf) |
| 23AC / 23ACA | Historical 1956 Act balance-sheet and Profit and Loss filings. | Preserve valid historical records/imports; reject for current 2013 Act filing and never delete historical encoding. | [MCA legacy e-form mapping](https://www.mca.gov.in/Ministry/pdf/eformsMapping.pdf) |
| DPT-7 | Not a current filing route. | Reject current use; preserve historical references and route current deposit matters to DPT-3. | [DPT-3 Instruction Kit](https://www.mca.gov.in/content/dam/mca-aem-forms/instructionkits/Instruction%20Kit_DPT-3.pdf) |

## Product validation policy

| Policy | Required behavior | Silent failure prevented |
|---|---|---|
| Source gate | Every claim carries an audit ID, official source, `source_verified`, and `effective_rule_snapshot`; OPEN/TENTATIVE means REVIEW/BLOCK. | Stale or guessed legal rule silently executes. |
| Company audit | Always create Companies Act audit state for every company, including small company and OPC; maintain a separate s63 tax-audit state. | Tax audit or small-company assumptions suppress statutory audit. |
| Signature gate | Board approval precedes s134 signatures; collect all applicable signatories and auditor report; OPC requires one director signature. | Unsigned or improperly approved statements are filed. |
| AGM/OPC gate | Branch by s96/s122; require OPC member adoption evidence; do not file a generic AGM report or minutes. | OPC “Board only” and false minutes-filing paths. |
| Form gate | Select AOC-4/AOC-4 CFS, MGT-7/MGT-7A, ADT-1, DPT-3, and MSME-1 only from frozen company/FY/profile facts and official source snapshots. | Wrong form, wrong deadline, or wrong purpose. |
| Filing evidence | Submission is not acceptance; retain SRN/Registrar acknowledgement, timestamp, signer, and acceptance evidence. | Upload incorrectly marked filed. |
| Historical boundary | Import and preserve 23AC/23ACA and other historical references; reject them for current filings without deletion. | Historical evidence is destroyed or reused operationally. |
| Tax boundary | Never infer an income-tax return deadline from the Companies Act audit obligation. | Mandatory company audit incorrectly selects a tax deadline. |

## Open items that hard-block operations

1. **Audit Committee applicability profile (MCA-AUDIT-018):** resolve the current Rule 6/rule 4 company-class test and tenant facts. Composition/functions may not be executed until this is frozen.
2. **Board-report field mapping (MCA-AUDIT-010):** resolve the applicable current s134(3)/Accounts Rules disclosures; do not use Schedule VI as a source.
3. **AOC-4/AOC-4 CFS field schema and CFS exemption profile (MCA-AUDIT-019):** attach the current official source snapshot and test s129(3)/Rule 6 facts. An associate alone is insufficient.
4. **MGT-7/MGT-7A field schema (MCA-AUDIT-014):** attach the current official form/instruction-kit snapshot; form split is verified but field execution is blocked.
5. **MSME-1 tenant applicability (MCA-AUDIT-021):** resolve whether the company and outstanding-payment facts fall within the cited order.
6. **ADT-1 applicability profile (MCA-AUDIT-008):** preserve the rule-based 15-day notice claim but resolve current applicability for the tenant before generation.

## Official source list

- [Companies Act, 2013](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf)
- [Companies (Audit and Auditors) Rules, 2014, Chapter 10](https://www.mca.gov.in/Ministry/pdf/NCARules_Chapter10.pdf)
- [Companies (Accounts) Rules source](https://www.mca.gov.in/Ministry/pdf/Rules_09072015.pdf)
- [Companies (Accounts) Rule 6 amendment](https://www.mca.gov.in/Ministry/pdf/CompaniesAccountsAmendmentRules_28072016.pdf)
- [Companies (Management and Administration) Amendment Rules, 2021](https://www.mca.gov.in/Ministry/pdf/CompaniesMgmtAdminAmndtRules_11032021.pdf)
- [Board Powers Rule 6 amendment](https://www.mca.gov.in/Ministry/pdf/CompaniesMeetingBoardPowersSecondRules_14072017.pdf)
- [DPT-3 Instruction Kit](https://www.mca.gov.in/content/dam/mca-aem-forms/instructionkits/Instruction%20Kit_DPT-3.pdf)
- [MSME specified-companies order](https://www.mca.gov.in/Ministry/pdf/MSMESpecifiedCompanies_22012019.pdf)
- [G.S.R. 700(E) small-company thresholds](https://www.mca.gov.in/content/dam/mca/pdf/notification-small-company-2015.pdf)
- [Legacy e-form mapping](https://www.mca.gov.in/Ministry/pdf/eformsMapping.pdf)

## Repair history

The 21 August 2026 repair removed rejected small-company audit-exemption, DPT-3 director/KMP, DPT-7 current-filing, Schedule IV auditor-qualification, s106/Rule 2A AGM, generic minutes-filing, Schedule VI Board-report-source, OPC Board-only, associate-implies-CFS, s394 annual-accounts, and tax-deadline-from-company-audit claims. It preserves historical form references and keeps every unresolved operational detail OPEN+BLOCK.
