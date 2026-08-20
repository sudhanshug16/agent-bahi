# Expense Evidence Policy

**Status**: SETTLED by Sudhanshu on 2026-08-20

## Policy Summary

The foundational policy is:

1. **Gross bookkeeping entry is NEVER blocked by missing supplier bill/receipt.** Post the gross expense or asset normally. Attach a visible evidence exception where applicable. Never silently treat missing evidence as compliant.
2. **Evidence is typed, additive, and purpose-specific**, with independent decision lanes per transaction: bookkeeping support, business-purpose support, income-tax treatment, and GST ITC eligibility.
3. **Statutory rules apply first.** Tenant-configured thresholds may add stricter workflows where law is silent; they may never weaken document, voucher, retention, or GST ITC requirements.
4. **Draft exports, working papers, CA/audit bundles, and exception reports remain exportable** with explicit non-clean status and exception manifests. Only the "clean/audit-ready" designation, an unsupported statutory claim/finalization, or purpose-specific tax treatment may be blocked.

This document separates legal-source facts from product decisions. Legal behavior is stored with jurisdiction, source, rule version, and effective-dated applicability so a later rule change does not reinterpret an old posting.

## Evidence Types (Typed and Additive)

Every attachment must identify its type, source, and validation status. The following list is minimal; types are additive (additional proven types may be registered):

1. **Prescribed supplier/tax document**: Tax-invoice (GST), e-invoice (IRN/QR), e-way bill, bill of entry, customs invoice, or other statutory document issued by the counterparty or portal.
2. **Ordinary receipt**: Shop bill, sales receipt, machine-printed invoice (including print-on-demand from automated systems), or vendor receipt without full GST particulars.
3. **Bank transaction**: Debit/credit advice, transaction statement line, reconciliation match, or gateway payment confirmation.
4. **Payment confirmation**: Payment gateway success response, cheque clearance, NEFT/RTGS confirmation, or bank teller receipt.
5. **Contract/order**: Purchase order, service contract, supply agreement, or similar binding document evidencing the transaction/commitment.
6. **Email/message**: Written communication from supplier, vendor, or counterparty describing or confirming the transaction (date, amount, description captured).
7. **Internal voucher**: Manual memo, petty-cash voucher, journal note, or operator-created record documenting the transaction (not a substitute for statutory evidence, but audit-eligible for historical support).
8. **Business-purpose memo/declaration**: Statement by actor explaining business purpose, necessity, or policy justification (e.g., "client entertainment," "office supply," "conference travel").
9. **Allocation workpaper**: Calculation sheet, invoice split, or documented basis showing how an amount was allocated across expense categories, projects, or cost centers.
10. **Approval/reviewer decision**: Sign-off, authorization record, or expense policy approval from an authorized principal (e.g., manager, finance team, director) with timestamp and reason.
11. **Statutory portal/match evidence**: Response artifact from government portal (GST, e-way bill, customs, tax portal), statement match record, or official correspondence/acknowledgement.

All evidence records preserve: source/provenance, storage hash, issuer/counterparty, document date, verification timestamp, validation result, rule source/version, and exception scope if applicable.

## Four Independent Evidence/Decision Lanes per Transaction

Every transaction maintains separate, independent state for:

### 1. Bookkeeping Support
- **Supported**: Gross posting documented by bank transaction, statutory receipt, or internal voucher with amount, date, and description.
- **Exception-Open**: Gross posting documented by partial evidence (e.g., bank transaction only, no receipt); visible exception recorded with actor, reason, and review date.
- **Never blocks gross posting.** Exception is recorded alongside the ledger entry.

### 2. Business-Purpose Support
- **Supported**: Evidence shows legitimate business purpose (e.g., contract, invoice description, expense policy match).
- **Review-Required**: Purpose unclear or policy-dependent; human/CA judgment needed before GST treatment or audit finalization.
- **Unsupported**: Evidence indicates personal or non-business character.
- **Never infer business purpose solely from one evidence item.** Combine amount, type, context, and decision-maker judgment.

### 3. Income-Tax Deductibility (Current: Act 2025 s34; Historical: Act 1961 s37 under savings)
- **Unassessed**: No review attempted; default state when posted.
- **Candidate**: Preliminary assessment suggests compliance with applicable deduction rule per current/effective tax law (business character, not personal, wholly/exclusively for business purpose).
- **Review-Required**: Ambiguity (e.g., dual-use, borderline policy) or policy threshold (amount, actor approval) demands expert/CA review.
- **Allowed**: Expert opinion or explicit tax treatment confirms deductibility under applicable law.
- **Disallowed**: Expert opinion or rule source confirms disallowance (e.g., entertainment cap, personal consumption, prohibited category).
- **Never infer legal deductibility merely from one evidence item.** This is not automated from receipt presence/absence.

### 4. GST ITC Eligibility (CGST Act s16(2) + Rule 36)
- **Not-Applicable**: Transaction has no ITC lane under resolved rule pack (e.g., exempt supply input, salary, advance, personal use, domestic passenger air travel under blocking rule).
- **Reverse-Charge Candidate**: Reverse-charge inward supply (taxpayer liable for tax under applicable rule); remains an independent ITC lane requiring supplier s31 invoice, tax payment, receipt/use, and effective-dated RCM conditions. Not not_applicable.
- **Import Candidate**: IGST import (taxpayer liable on importation); remains an independent ITC lane requiring bill of entry or Customs assessment document, tax payment, receipt/use, and effective-dated import conditions. Not not_applicable.
- **Pending-Prescribed-Document**: A Rule 36(1) prescribed document is required but not yet attached; no ITC claim yet.
- **Pending-Other-Conditions-or-Match**: Prescribed document present but condition check incomplete (tax payment date, GSTR-2B match, time limit, reverse-charge determination, receipt/use verification).
- **Eligible**: All Rule 36(1) conditions and applicable effective-dated requirements confirmed; ITC claimable (subject to later utilization policy).
- **Ineligible**: Rule 36(1) condition(s) failed (prescribed document missing/invalid, time bar expired, reverse-charge ineligibility confirmed, payment condition unmet, blocked category confirmed); no ITC.
- **Claimed**: ITC reclassification journal posted (Dr. ITC Recoverable | Cr. Expense/Asset for tax portion).
- **Reversed/Re-Eligible**: Original claim reversed; eligibility reassessed.
- **Never assume ITC from one evidence item; never claim ITC without s16(2) and applicable Rule 36 conditions.** This lane is independent of business-purpose and income-tax lanes.

## Gross Expense Posting (Never Blocked)

When a transaction is finalized:

1. Post the gross amount (expense or asset) to its configured ledger account.
2. Post the supplier/payable to the creditor account.
3. If evidence is missing, ambiguous, or conditionally acceptable:
   - Create a visible exception record (actor, reason, authority/rule source, timestamp, scope, review/expiry date).
   - Attach the partial or exception-marked evidence.
   - Post the transaction as planned; ledger balance is unaffected.
4. Never silently omit the posting. Never retroactively block or unblock the gross ledger entry based on later evidence.
5. The exception is a non-ledger tracking state; it does not prevent balance-sheet posting or bank reconciliation.

## GST ITC: Prescribed Documents and Rule 36 (NEVER Auto-Inferred)

GST input-tax credit is a separate, **independent eligibility state** tracked outside the bookkeeping posting.

**Prescribed documents under CGST Act s16(2) and GST (Goods and Services Tax) Rules, 2017 Rule 36(1):**

Rule 36(1) identifies the documentary basis for ITC eligibility. The main prescribed documents are:

- **(a) Supplier s31 invoice**: A tax invoice issued by the supplier under s31 with full statutory particulars (invoice date, serial number, GSTIN, HSN/SAC, tax rate, amount, etc.).
- **(b) Recipient-issued invoice under s31(3)(f)**: Where the supplier is unregistered, and the recipient issues an invoice against payment of tax, subject to the tax payment and other effective-dated conditions.
- **(c) Supplier s34 debit note**: A debit note issued by the supplier under s34.
- **(d) Bill of entry or Customs assessment**: For IGST on imports, the bill of entry or similar Customs assessment document serving as the basis for tax liability and credit claim.
- **(e) ISD invoice, credit note, and Rule 54 ISD document**: Input service distributor invoices, credit notes, or documents issued under Rule 54 where ISD framework applies.

**NOT prescribed ITC bases:**
- Bill of supply (issued by composition-liable suppliers; no ITC eligibility for recipient).
- Ordinary credit note (not issued by supplier as s34 debit/credit note adjustment; adjustment via bill of entry equivalent mechanisms may apply).
- Generic customs invoice (bill of entry or equivalent assessment is the prescribed document, not an invoice from a private party).
- Shop receipt, sales receipt, ordinary bill, or receipt without statutory particulars (supports bookkeeping-support or business-purpose lanes; does NOT satisfy Rule 36 prescription).
- Bank statement, internal voucher, memo, or home-office explanation alone (these may support bookkeeping-support or business-purpose lanes but NEVER substitute for Rule 36 prescribed documents).

**Conditions (effective-dated per rule version)**:
- Prescribed document must be in compliance with statutory particulars and validation rules as effective on the supply date and claimed date.
- Receipt/invoice date, time of payment (for tax payment conditions), place of supply, and reverse-charge applicability must be verified per effective rules.
- Reverse-charge inward supply or import transaction: not_applicable classification is **incorrect**. These transactions remain **candidates** requiring their prescribed documents (e.g., supplier s31 invoice for RCM supply, bill of entry for import), payment of tax, receipt/use within effective timelines, and other applicability-specific conditions. RCM and import supplies retain independent ITC lanes.
- GSTR-2B auto-population or explicit supplier communication may provide evidence of the supply being reported; it never replaces the prescribed document requirement.
- Time bar, amendments, and procedural conditions affect eligibility.

**Product gates**:
- **ITC Not-Applicable**: Transaction has no ITC lane (e.g., personal consumption, expense explicitly exempt, domestic passenger air travel under applicable blocking rule). Never use this for reverse-charge or import transactions.
- **ITC Pending-Prescribed-Document**: No Rule 36(1) prescribed document present; document is required for eligibility → no ITC claim yet.
- **ITC Pending-Other-Conditions-or-Match**: Prescribed document present but condition check incomplete (tax payment date, GSTR-2B match pending, reverse-charge determination pending, time limit check pending, recipient s31(3)(f) conditions pending).
- **ITC Eligible**: All Rule 36(1) conditions and applicable effective-dated requirements confirmed → reclassification journal may be posted.
- **ITC Ineligible**: Condition failed (prescribed document missing/invalid, time bar expired, reverse-charge ineligibility confirmed, payment condition unmet, blocked category confirmed) → no reclassification, no ITC claim.
- **ITC Claimed**: Reclassification journal (Dr. ITC Recoverable | Cr. Expense/Asset) posted.
- **ITC Reversed/Re-Eligible**: Original claim reversed; eligibility reassessed (e.g., amendment filed, time condition re-evaluated).

The engine never auto-claims ITC. Explicit reclassification journal (Dr. ITC Recoverable | Cr. Expense/Asset) is posted only after all Rule 36(1) and applicable effective-dated conditions verified. If later circumstances change (amendment, GSTR-2B discrepancy, time bar, payment date correction), a reversal + correction entry adjusts the claim.

**Official reference**: [CBIC CGST Act s16](https://cbic-gst.gov.in/hindi/CGST-bill-e.html), [CBIC Rule 36 and related Rules (GST Rules 2017, subject to effective amendments)](https://cbic-gst.gov.in/pdf/01012022-CGST-Rules-2017-amended_Part-A.pdf). These are subject to effective-date refresh and state-specific variations; confirm the rule version and amendments applicable to the transaction date and claim date.

## Home-Office and Mixed-Use Expenses

Evidence packet for home office or mixed-use allocation (e.g., internet, electricity, rent for mixed residence/office):

- **Entity/premises relationship**: Ownership or lease agreement, residency proof, business registration for the address.
- **Period and usage**: Months/years, percentage business use, or documented allocation basis.
- **Invoices and payment proof**: Utility bills, rent invoice, payment receipts (bank or cheque).
- **Allocation basis and calculation**: Area method (sq. ft. office / sq. ft. total), time method (hours/days business use per period), usage method (e.g., devices), or documented rationale with supporting schedule.
- **Business vs. personal share**: Explicit split (e.g., "60% business, 40% personal").
- **Agreement/expense claim/approval**: Supporting policy, manager approval, director sign-off, or CA recommendation where relevant to the allocation.

**Product rules:**
- Never auto-approve home-office deductibility, allocation percentage, or GST ITC based on one evidence item.
- Require explicit human/CA review for final tax treatment and ITC eligibility.
- Account separately for each legal entity; do not cross-tenant inference (no "Group office" shared between two separate tenants).
- Document the allocation basis and reviewer decision as immutable evidence.
- Applicable income-tax law (current: Act 2025 s34 general-deduction conditions; historical: Act 1961 s37 under savings) plus GST rules (s16/Rule 36 plus home-office applicability under state rules) must be applied per rule version and reviewed by expert.

## Companies Act 2013 — Section 128 (Books and Voucher Retention)

**Statutory fact**: Section 128 of the Companies Act, 2013 requires a company to maintain books of account and **all relevant vouchers** for at least **eight financial years immediately preceding a financial year**, together with longer retention if Central Government directs investigation or prosecution. See [official MCA Companies Act PDF](https://www.mca.gov.in/Ministry/pdf/CompaniesAct2013.pdf) for exact statutory language and exceptions.

**Statutory clarification (what this does NOT mean)**:
- Section 128 is **not** a documented pre-posting requirement for receipt attachment. It is a post-posting retention and proof requirement.
- A company may post the gross expense/asset to the ledger even if the voucher is not attached at posting time. Subsequent retention of vouchers within the statutory window is the obligation.
- "Vouchers relevant to entries" is determined by auditor/investigator/reviewer judgment and context, not by a checklist of approved document types. No single voucher format is mandated.
- Electronic evidence (scanned invoice, email proof, bank statement, digital receipt) may constitute a "relevant voucher" if it is authentic, verifiable, accessible, complete, and retained with appropriate backup/integrity measures. Legal sufficiency of electronic evidence depends on applicable information technology laws (IT Act, Digital Signature Act, e-commerce rules) and auditor judgment, not merely on cryptographic hashing.
- Missing evidence at posting time does not invalidate the ledger entry. The entry remains posted; future audit/investigation examines whether the retained voucher (if produced later) satisfies statutory sufficiency.

**Product policy**:
- Retain each financial year's books and evidence until it falls outside the statutory rolling retention window (8 FYs plus current FY = typically 9 years).
- Extend retention beyond the statutory window while investigation, assessment, legal hold, or litigation applies.
- Retention timeline is governed by effective statute and investigation direction, not by transaction date or voucher creation date alone.

**Applies to**: Indian private and public limited companies as per the Companies Act 2013.

**Does not apply**: Sole proprietorships, partnerships, trusts, and other entity types (governed by different retention and evidence rules under Income Tax and related statutes; not settled in this document).

## Income Tax — General Deduction Conditions and Books/Documents Requirements

### Current Law: Income Tax Act 2025 s34 (General Deduction Conditions)

**Verified fact (effective tax years from 2026-04-01)**: Income Tax Act 2025 s34 identifies general conditions for allowable deductions. An expense is deductible if it is not covered by specific charging sections, not capital in nature, not personal, and not in a prescribed prohibited category. The business-purpose test does not prescribe one universal receipt format or document type.

**Clarification**:
- S34 is a **legal test on character and category**, not an evidence-format requirement.
- An expense may satisfy s34 with a simple internal memo, bank statement, or internal voucher if accompanied by business context and purpose evidence. Conversely, a formal printed invoice does not guarantee s34 compliance if the expense is personal, capital, or prohibited.
- S34 assessment is **manual judgment**: amount, type, business context, and decision-maker (tax officer, CA, appellate authority) judgment required. No single evidence item automatically proves or disproves s34 compliance.
- Do not infer deductibility merely from one evidence item. Combine amount, type, context, and expert judgment.

**Historical reference (tax years prior to 2026-04-01)**: Income Tax Act 1961 s37 applies to tax years/proceedings governed by the savings transition under [Income Tax Act 2025 s536](https://www.incometaxindia.gov.in/w/section-536-1).

**Official reference (current)**: [Income Tax Act 2025 s34](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-34-175), [Income Tax Rules 2026 (effective 2026-04-01)](https://www.incometaxindia.gov.in/documents/d/guest/en-notified-it-rules-2026-20-03-2026-pdf).

### Books and Documents Requirement: Income Tax Act 2025 s62 and Rules 2026 Rule 46

**Verified fact**: Income Tax Act 2025 s62 requires maintenance of books and documents. Income Tax Rules 2026 Rule 46 specifies books/documents requirements for specified professions (e.g., advocates, chartered accountants, medical practitioners) and certain small-value transaction thresholds.

**Clarification**:
- Rule 46 is a **specified-profession and specified-activity books/documents rule**, not a universal business rule or cash-payment disallowance.
- Rule 46 prescribes documentation and books-maintenance conditions for eligible professions and specific activities; these thresholds must **NOT be generalized** to ordinary business or company expenses.
- The books/documents rule affects deductibility determination and taxpayer compliance, not accounting posting validity. An expense failing Rule 46 (if applicable to the transaction) is subject to tax disallowance but remains posted in the books.
- Gross expense posting proceeds; tax treatment (deductibility under Rule 46 if applicable) is separately reviewed.
- Do **NOT** hard-code Rule 46 thresholds or profession scope. Expert/CA review per transaction date and applicable profession/activity is required.

**Official reference**: [Income Tax Act 2025 s62](https://www.incometaxindia.gov.in/w/section-62-134), [Income Tax Rules 2026 Rule 46](https://www.incometaxindia.gov.in/documents/d/guest/en-notified-it-rules-2026-20-03-2026-pdf).

### Cash-Payment Disallowance (Separate Effective-Dated Rule Family)

**Verified fact**: Cash-payment disallowance rules exist under Income Tax law as effective-dated provisions for specified professions and transactions. These are separate from books/documents requirements and evidence-format expectations.

**Clarification**:
- Cash-payment disallowance rules are a **distinct effective-dated rule family** separate from general deduction conditions, books/documents requirements, and evidence retention.
- Do **NOT** state a universal cash threshold in this evidence policy. Cash-payment disallowance scopes, thresholds, profession applicability, and effective dates are complex and must be reviewed by expert/CA.
- Failing a cash-payment disallowance rule (e.g., cash payment above threshold in a covered transaction) disallows the tax deduction but does not invalidate the bookkeeping posting. The gross expense posts; tax treatment is separately determined.
- Gross posting and cash-payment disallowance assessment are independent lanes.

**Official reference**: Effective-dated rules under Income Tax law (Act 2025 and Rules 2026 or prior savings provisions). Expert/CA review required for current applicability.

## Zoho Books Official Documentation Review

**Context**: Agent-bahi is designed as a deterministic, purpose-specific evidence and compliance engine. Zoho Books is a general accounting SaaS product with different design goals. A brief reference to Zoho's documented behavior clarifies agent-bahi's positioning.

**Zoho Books documented behavior**:
- Expense creation allows saving an expense without an attached receipt. See [Zoho Books expense creation guide](https://www.zoho.com/in/books/help/expense/basic-functions.html) and [Zoho expenses without attachments](https://www.zoho.com/us/books/kb/expenses/expenses-without-attachments.html).
- "Attach Receipt" is a separate input field, not a blocking prerequisite for saving the expense.
- Official documentation reviewed did **not establish** a universal receipt-based blocking gate for saving, GST ITC calculation, audit readiness, or export in Zoho Books.

**Zoho's evidence/decision lane architecture**: Official documentation reviewed did not detail how Zoho internally separates bookkeeping support, business-purpose assessment, income-tax deductibility, and GST ITC eligibility. This remains unknown from public docs.

**Agent-bahi design difference**:
- Agent-bahi **does not block gross posting** due to missing receipt, consistent with Zoho's documented non-blocking model.
- Agent-bahi **explicitly tracks evidence type and exception status** with audit/provenance (not addressed in Zoho public docs).
- Agent-bahi **separates and tracks four independent decision lanes** (bookkeeping-support, business-purpose, income-tax deductibility, GST ITC eligibility) as persistent, auditable states.
- Agent-bahi **never auto-infers GST ITC** from evidence presence; it requires explicit Rule 36 prescribed-document verification and reclassification posting.
- Agent-bahi **never auto-infers deductibility** from one evidence item; income-tax deductibility assessments (current law: Act 2025 s34; historical: Act 1961 s37; books/documents: Rule 46; cash-payment rules: separate effective-dated family) are policy/expert decisions, not algorithm outcomes.

## Product Gates and Blocking Policy

The engine may **BLOCK** (prevent command execution) only in these specific cases:

1. **GST ITC claim without Rule 36 prescribed document**: Explicit reclassification journal requesting ITC recovery is rejected if the prescribed document is missing or ineligible.
2. **Clean/audit-ready designation on exception-open transaction**: Explicit report or export command requesting "clean" or "audit-ready" status is rejected; export remains available with "exception-open" status.
3. **Statutory claim/finalization without effective rule**: A filing snapshot, compliance certificate, or statutory declaration cannot be created if the governing rule version is missing or stale.
4. **Purpose-specific tax treatment requiring special regime verification**: An expense claimed under a special regime (e.g., research-and-development R&D deduction, scientific-experiment exemption) has its **special-regime tax treatment blocked** or marked **review-required** until applicable evidence is verified. The gross posting proceeds with **exception_open** when bookkeeping facts are sufficient; only the purpose-specific tax classification remains gated.

**Never block**:
- Gross expense/asset posting due to missing receipt or partial evidence.
- Draft document creation, edit, or save.
- Draft export, working paper, CA audit bundle, or exception report.
- Bank reconciliation or internal use due to evidence state.
- Correction/reversal lineage or historical amendment.

## Exception Recording

Every evidence exception is recorded with:

- **Reason**: Why the evidence is missing, partial, or conditionally acceptable (e.g., "oral agreement, email confirmation pending," "receipt awaiting supplier," "allocation across projects").
- **Actor**: Who approved or recorded the exception (operator name/ID, timestamp).
- **Authority/Source**: What rule or policy permits the exception (or why the exception is necessary despite no rule; e.g., "per expense policy, amount < threshold, manager approval sufficient").
- **Scope**: Which lanes are affected (e.g., "bookkeeping-support exception, full ITC claim blocked, business-purpose under review").
- **Expiry/Review date**: When the exception should be revisited or when missing evidence becomes overdue (e.g., "receipt expected by 2026-09-30, reassess then").

## Runtime and Audit Requirements

The engine:

1. Evaluates the applicable jurisdiction, rule version, and effective dates at the command's transaction date.
2. Records the rule version(s) and evidence state with every posting.
3. Returns the outcome (posted/exception/blocked) before ledger mutation.
4. Links every posted transaction to its evidence records, validation result, exception (if any), and tax-eligibility decision.
5. Preserves evidence history immutably; corrections use explicit reversal + corrected-version lineage.
6. Never overwrites or reinterprets evidence. If a later rule change affects historical treatment, an auditable adjustment (not retroactive reposting) documents the change.

## Validation Checklist

When finalizing an expense (at minimum; transaction-specific rules may add requirements):

- [ ] Gross amount, date, account, payee identified and validated.
- [ ] Bookkeeping-support lane: evidence present (bank transaction, internal voucher, receipt, contract) OR no evidence with exception_open recorded; gross posting proceeds regardless.
- [ ] Business-purpose lane: purpose evident from type/context or marked review-required; never block gross posting solely for purpose ambiguity.
- [ ] Income-tax deductibility lane: assessment completed (candidate/allowed/disallowed/review-required) per applicable law; never assume from one evidence item.
- [ ] Books/documents condition (if applicable rule applies): noted as per applicable effective-dated statute/rule; expert/CA review required.
- [ ] GST ITC lane state recorded: not-applicable, reverse-charge-candidate, import-candidate, pending-prescribed-document, pending-conditions, eligible, ineligible, claimed, or reversed; no auto-inference from evidence presence.
- [ ] Exception (if any) recorded with reason, actor, authority/rule source, scope, and expiry/review date.
- [ ] Ledger posting proceeds; exception does NOT block gross entry.
- [ ] Correction lineage, evidence retention timeline, compliance tags, and audit trail linked for later review.
