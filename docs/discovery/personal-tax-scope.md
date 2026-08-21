# Personal Tax Discovery Packet

**⚠️ BANNER: TENTATIVE — NOT OWNER-APPROVED**

All Personal Tax (PT) architecture entries below are **TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. Complete individual income-tax workflow for sole proprietors is **in product scope**. No implementation authority exists until owner review. No filing-deadline discussion is included; those belong to separate compliance-matrix research.

This document is the canonical discovery baseline for agent-bahi's expansion to handle personal income tax filing workflows. All references to law, forms, portals, and artifacts are primary-source only.

---

## 1. Verdict and Scope Boundary

**Product Scope Decision**: Agent-bahi will support the complete individual income-tax workflow for a sole proprietor, including:
- Personal income sources (salary, business, capital gains, income from house property, other sources)
- Personal banks, investment accounts, and tax-lot tracking
- Personal property/rent subledgers with provenance and reconciliation
- Personal deductions and tax credits
- Advance tax (s404/408) estimation, payment tracking, and reconciliation
- Return preparation, form selection (ITR-1, ITR-2, ITR-3, ITR-4, etc.)
- Return validation against official ITR schemas
- Export, filing workflow, and evidence recording
- Post-filing verification states and case lifecycle

**One Individual/PAN Tenant Model**: A single person identified by Permanent Account Number (PAN) and holding a sole proprietorship may maintain:
- One personal BookSet (non-business income, investments, property, bank accounts)
- Multiple proprietorship BookSets (one per business/profession)
- No company/legal-entity BookSets (companies are separate tenants)

**Non-Product Scope**: Partnership firms, HUFs, companies, trusts, and co-owners are out of scope for the initial personal-tax implementation. They require separate tenant and business-structure models.

**No Filing Deadlines in This Document**: Tax-year transitions, due dates (s139, s148, etc.), and filing deadlines are documented separately in [annual-income-tax-compliance-matrix.md](annual-income-tax-compliance-matrix.md) and linked statutory-workflow contracts. This packet focuses on architecture, workflow, and data-model decisions only.

---

## 2. Verified Official Baseline

### Individual Income Tax: Fundamental Facts

**One taxpayer/PAN return aggregates all income heads and sources**: A single individual files one annual income-tax return under their PAN per financial year (FY). That return covers all applicable income heads: salaries, business income (one or more proprietorships), capital gains, income from house property, other sources, deductions (s80 series), reliefs, and tax credits—all in one filing. The system must never separate personal and proprietorship ITRs and must not allow silent omission of applicable heads or sources.

**Source**: [Income-tax Act, 2025 as amended by Finance Act 2026](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf), Part II (Assessment), Chapter VI (Assessment Procedure), relevant sections (s2, s139, s140-A). [Official ITD Form Navigator](https://www.incometaxindia.gov.in/form-navigator).

**Form selection is year-specific and fact-driven, not universal**: The applicable ITR form (ITR-1, ITR-2, ITR-3, ITR-4, ITR-5, ITR-6, ITR-7) depends on taxpayer profile (individual, HUF, company, etc.), income heads, turn-over/revenue thresholds, and filing regime (old-law vs. new-law under s115BAC or other sections) effective in that assessment year. No single universal ITR-3 or ITR-4 mapping exists. Form selection must be redone annually based on current-year facts and effective rules.

**Source**: [Official ITD Form Navigator and ITR Instructions](https://www.incometaxindia.gov.in/form-navigator), [ITR-1 (SAHAJ) Instructions](https://www.incometaxindia.gov.in/documents/d/guest/sahaj_itr-1_fy-2024-25-pdf), ITR-3 (business/professional income) instructions per filing year, [ITR-2 Instructions](https://www.incometaxindia.gov.in/documents/d/guest/itr-2_fy-2024-25-pdf).

**Assessment Year (AY) and Governing Act: FY 2025-26 and Binding**:
- **FY 2025-26** (1 Apr 2025 – 31 Mar 2026): Governed by **Income-tax Act, 1961**. Assessment Year 2026-27.
- **Income-tax Act, 2025**: Effective from **1 Apr 2026** onward. Governs Tax Year 2026-27 (1 Apr 2026 – 31 Mar 2027) and AY 2027-28. Transition between Act 1961 and Act 2025 is external research; agent-bahi binds the governing Act per TaxCase atomically (PT-007).
- Every TaxCase immutably records governing Act, FY/TY period, and rule snapshot. Form structures, deduction limits, rates, and thresholds are rule-snapshot-dependent, not universal.

**Source**: [CBDT Press Release: Income-tax Act 2025 Effective 1 Apr 2026](https://www.incometaxindia.gov.in/documents/d/guest/press-release-income-tax-act-2025-comes-into-force-from-01-april-2026-pdf), [Income-tax Act 1961 (for FY 2025-26)](https://www.incometaxindia.gov.in/), [Official ITR Form Navigator](https://www.incometaxindia.gov.in/iec/foportal/downloads/income-tax-returns).

**Official ITR schemas and validation are year-version-specific**: Each ITR form (ITR-1, ITR-2, ITR-3, etc.) has an official schema: mandatory fields, optional fields, data types, allowed values, computed fields, and validation rules published by the ITD. These schemas and rules change between assessment years (AY 2026-27, AY 2027-28, etc.) and between old-law and new-law regimes. Agent-bahi must snapshot the applicable schema for each taxpayer/form/year/regime combination and use that snapshot for validation.

**Source**: [Official ITD Form Navigator](https://www.incometaxindia.gov.in/form-navigator) (version-specific links per AY), [ITR Form PDF and XML schema downloads](https://www.incometaxindia.gov.in/) per AY, [e-filing portal](https://www.incometaxindiaonline.gov.in/).

**AIS (Annual Information Statement) includes TIS values; it is incomplete**: The Annual Information Statement (AIS) is issued to taxpayers by ITD and uploaded to the taxpayer's e-filing portal account. It aggregates TDS (tax deducted at source) and TCS (tax collected at source) information from third-party reporting (Form 16, Form 16A, etc.). Since June 2024, AIS also includes TIS (Tax Information Summary) values: pre-calculated tax on various income heads based on reported incomes. However, AIS is incomplete: it includes only third-party-reported incomes, not self-assessed incomes, business income (proprietorship), rental income, or capital gains reported directly by the taxpayer. Agent-bahi must treat AIS data as supplementary evidence, not exhaustive.

**Source**: [ITD notification on AIS](https://www.incometaxindia.gov.in/), [AIS Portal documentation](https://www.incometaxindiaonline.gov.in/), [TIS (Tax Information Summary) launch announcement](https://www.incometaxindia.gov.in/) (announced FY 2023-24, effective FY 2024-25).

**26AS (Form 26AS / e-TDS Statement) is TDS/TCS-focused, not complete**: Form 26AS (e-TDS Statement) shows TDS (tax deducted at source) and TCS (tax collected at source) collected against the PAN during the financial year. It covers deductions like bank interest, investment gains, salary TDS (Form 16), vendor/contractor TDS (Form 16A), and sales TCS. It does **not** show business income, rental income, capital gains from stock markets, or personal expenses. It is a TDS/TCS verification document, not an income-tax return draft.

**Source**: [ITD notification on Form 26AS](https://www.incometaxindia.gov.in/), [e-filing portal 26AS download](https://www.incometaxindiaonline.gov.in/), [Rule 31 specifications](https://www.incometaxindia.gov.in/).

**File formats and AA (Account Aggregator) partner boundary**: AIS and 26AS are available as PDF and Excel/CSV from the e-filing portal. Brokers and financial institutions provide CAS (Consolidated Account Statement), e-CAS (electronic CAS), EPFO statements, and NPS statements in PDF and sometimes Excel. No credential-based scraping or browser automation is permitted. Account Aggregator (AA) is a **future regulated partner** under the RBI's Account Aggregator framework; direct AA integration is future-scoped and requires official partner agreements, not V1 scope.

**Source**: [e-filing portal download formats](https://www.incometaxindiaonline.gov.in/), [RBI Account Aggregator framework](https://www.rbi.org.in/Scripts/PublicationReportDetails.aspx?ID=904), [AA regulations and partner list](https://www.rbi.org.in/).

**ITR acknowledgement, verification status, and ARN (acknowledgement reference number)**: When a taxpayer files an ITR on the e-filing portal, they receive an acknowledgement number (ARN) if the form is accepted for processing. They must then download the ITR-V (acknowledgement form), sign it digitally (DSC) or physically, and upload it within 30 days for filing completion. "Filing" is **not** the same as "submission"; filing means verification/signing the acknowledgement. ITR status on the e-filing portal shows various states: Submitted (not yet verified), Verified (ITR-V uploaded), Under Processing, Processed, etc. Agent-bahi must record the exact state/evidence per ITD portal, not assume a universal ARN proves filing.

**Source**: [ITD e-filing portal documentation](https://www.incometaxindiaonline.gov.in/), [ITR Filing Instructions](https://www.incometaxindia.gov.in/documents/d/guest/itr-1_instructions-pdf) (per form/year), [s140-A (e-verification)](https://www.incometaxindia.gov.in/w/section-140-a-5).

---

## 3. Current-Product Interplay

### Existing Agent-Bahi Design (Non-Personal-Tax)

Agent-bahi currently models one-tenant-per-legal-entity with GSTIN-scoped GST accounting. Personal-tax expansion must integrate with and not contradict these existing decisions.

**Existing One-Tenant = One Legal Entity**:
- **Tenant Model** ([decisions.md § Confirmed](decisions.md#confirmed)): A tenant represents one legal entity. Sudhanshu operates three legal entities: two private-limited companies and one sole proprietorship. Currently, these are three separate tenants in agent-bahi with no cross-tenant relationships.
- **Multi-GSTIN within Tenant** ([decisions.md § Confirmed](decisions.md#confirmed)): One tenant may have multiple GST registrations (GSTIN). GST work is scoped to GSTIN, not tenant.
- **Tenant Independence** ([decisions.md § Confirmed](decisions.md#confirmed)): Every tenant is fully independent; cross-tenant paired entries are prohibited in V1.

**Contradiction for Personal-Tax Scope**: The existing tenant = legal entity model creates a mismatch for sole proprietors. A sole proprietor is a person (PAN), not a legal entity. The proprietorship's business income rolls into the proprietor's personal return. Agent-bahi must support one individual/PAN tenant containing multiple BookSets (personal + multiple proprietorships) while keeping companies as separate tenants. This is a scope expansion, not a contradiction; **PT-001** formalizes the new model.

**Existing Immutable Posting and Evidence**:
- **Posted-Document Correction** ([decisions.md § Confirmed](decisions.md#confirmed)): A posted document is corrected via explicit reversal + replacement. Original, reversal, replacement, and reason remain immutably linked.
- **Expense Evidence Policy** ([decisions.md § Confirmed](decisions.md#confirmed)): Missing supplier bill/receipt never blocks gross posting; evidence is typed and purpose-specific (bookkeeping, business-purpose, income-tax deductibility, GST ITC). Statutory rules apply first; tenant thresholds may add workflow only where law is silent.
- **Period Locking** ([decisions.md § Confirmed](decisions.md#confirmed)): A tenant may have a global or module-specific `locked-through` date. All ledger mutations within the locked range are rejected; evidence-only attachments are the sole exception. Full unlock and partial unlock require explicit human confirmation and fail closed.

**No Contradiction**: Personal-tax workflow operates on the same immutable posting and evidence infrastructure. PT-016 defines how original returns and corrections are linked.

**Current Report Basis**:
- **Canonical Ledger, Report Basis** ([decisions.md § Confirmed](decisions.md#confirmed)): Stored invoices, payments, bills, and postings are canonical. Cash-basis and accrual-basis reporting are views over those records.
- **Personal Bank and Investment Reconciliation**: Personal accounts and investment holdings must reconcile via the same mechanism as business bank accounts: explicit bank-match confirmation (decisions.md § Bank reconciliation boundary) and evidence-based subledger reconciliation (PT-004).

**No Contradiction**: Personal-tax subledgers use the same immutable posting infrastructure.

**Existing Skill/Engine Boundary** ([architecture-decisions.md § ARC-001, ARC-004, etc.]):
- Skills orchestrate, gather evidence, propose actions, and verify work.
- The engine owns rules, calculations, permissions/gates, and invariants.
- Draft documents are editable; finalization atomically creates canonical ledger entries.

**Personal-Tax Skill Scope**: A personal-tax skill may prepare return drafts, validate against official schemas (engine permission gate), propose form selection, and orchestrate filing workflows. The engine contains the immutable snapshots, effective-dated rule packs, and atomic posting logic.

**Ranked Contradictions by Silent-Wrong-Output Risk**:

1. **HIGH RISK**: Silently allowing personal and proprietorship ITRs to be filed separately or allowing a TaxCase to omit an applicable BookSet.
   - **Silent consequence**: Tax underpayment penalty, filing rejection, audit, or income misclassification.
   - **File:Line**: [decisions.md § Confirmed](decisions.md#confirmed) (no entry yet for sole-proprietor multi-BookSet model); PT-005 formalizes this.
   - **Mitigation**: PT-005 and PT-014 require explicit BookSet listing and fail-closed mutations.

2. **HIGH RISK**: Using an AIS value as exhaustive without reconciling against actual income reported.
   - **Silent consequence**: Underpaid tax on self-assessed heads (business, rental, capital gains).
   - **File:Line**: § 2 (Verified Baseline) above; PT-008 formalizes AIS/26AS as incomplete.
   - **Mitigation**: AIS is marked INGESTED; RECONCILED requires active validation against all income heads.

3. **MEDIUM RISK**: Applying form selection from a prior year without re-validation against current-year facts and rules.
   - **Silent consequence**: Wrong ITR form filed; portal rejection or post-filing correction required.
   - **File:Line**: § 2 (Verified Baseline) above; PT-006 formalizes year-specific form selection.
   - **Mitigation**: PT-006 and PT-007 require fact/rule snapshots per year.

4. **MEDIUM RISK**: Treating ITR acknowledgement (ARN) as universal evidence without tracking portal verification status.
   - **Silent consequence**: Incomplete filing (acknowledgement received, but ITR-V not uploaded); ITR status misreported.
   - **File:Line**: [architecture-decisions.md § CMP-004, T-009](architecture-decisions.md) (existing T-009 for Form 140; similar issue for ITR); PT-013 formalizes ITR-specific portal states.
   - **Mitigation**: PT-013 requires portal-state tracking per ITR form, not universal ARN.

---

## 4. Personal Tax Architecture Decisions PT-001 through PT-016

### Notation and Status

Each entry uses the following structure:
- **PT-NNN**: Decision ID
- **Title**: Short decision name
- **Status**: TENTATIVE - NOT OWNER-APPROVED
- **Definition**: Exact scope and constraint
- **Recommended Default**: Provisional choice pending owner review
- **Concrete Example**: Real-world scenario illustrating the decision
- **Credible Alternative**: An alternative approach the owner may select
- **Silent-Failure Risk**: What could go wrong if this decision is ignored
- **Reversal Path**: How the owner can change this decision later
- **Impacted Current Contracts**: Existing decisions or code boundaries affected
- **Owner Review Status**: Awaiting review (all are TENTATIVE)

---

<a id="pt-001"></a>
### PT-001: Individual/PAN Tenant Model with Multiple BookSets

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: One individual identified by Permanent Account Number (PAN) and holding a sole proprietorship may maintain one personal BookSet and multiple proprietorship BookSets, all within a single tenant. Companies and legal entities are separate tenants.

**Recommended Default**: 
- A sole proprietor is identified by PAN, not business entity registration. Agent-bahi treats the PAN as the tenant identifier.
- Within that PAN tenant:
  - One personal BookSet (non-business income, personal expenses, investments, property)
  - N proprietorship BookSets (one per business/professional register per ITD classification)
  - No company BookSets (company tenants are separate)
- All BookSets within one PAN tenant contribute to one annual income-tax return filed under that PAN.
- **BREAKING CHANGE from current model**: The current agent-bahi model is "one tenant = one legal entity." PT-001 changes this to "one tenant = one individual/PAN (for sole proprietors) OR one legal entity (for companies)." This requires data migration and canonical-contract update. Owner approval and coordinated canonical migration are required before implementation.

**Concrete Example**: Sudhanshu (PAN: AAABX5055K) operates one sole proprietorship (Register of Business Income maintained for ITD) and holds personal investments. His tenant contains:
- BookSet `personal` (personal bank accounts, investments, rental property, personal expenses)
- BookSet `proprietorship-business` (business income, business expenses, assets, business bank accounts)
Both roll into one ITR filed under PAN AAABX5055K in the same assessment year.

**Credible Alternative**: Each proprietorship is a separate tenant (business-entity-scoped model). This breaks the income-tax return (which is PAN-scoped, not business-scoped) and requires cross-tenant return generation.

**Silent-Failure Risk**: Separate tenants per proprietorship force cross-tenant return generation or silent omission of business BookSets in the personal return. This violates the statutory requirement (one return per PAN per year covers all applicable heads).

**Reversal Path**: Owner may choose business-entity-scoped tenants after Phase 1; the BookSet model (PT-002) allows flexible data organization within a tenant, so reversal is possible but requires re-tenanting logic.

**Impacted Current Contracts**: 
- **Tenant Independence** ([decisions.md § Confirmed](decisions.md#confirmed)): Existing "one tenant = one legal entity" now becomes "one tenant = one individual/PAN (for sole proprietors) OR one legal entity (for companies/partnerships)." The tenant-scoping boundary changes; tenant independence remains (no cross-tenant paired entries).
- **Multi-GSTIN Within Tenant** ([decisions.md § Confirmed](decisions.md#confirmed)): Each proprietorship BookSet may have its own GSTIN. GST work remains GSTIN-scoped within one PAN tenant. No change to multi-GSTIN model; extension to multi-BookSet.

**Owner Review Status**: Awaiting owner review. This decision enables sole-proprietor tax filing but requires explicit approval.

---

<a id="pt-002"></a>
### PT-002: BookSet-Owned Records with Tenant_ID + Book_Set_ID

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: Every business aggregate and posting record carries both `tenant_id` and `book_set_id`. Every BookSet is independently balanced (debit/credit per account within the BookSet). No cross-BookSet account balances without explicit inter-BookSet transfers (PT-003).

**Recommended Default**:
- Every ledger account, posting, invoice, bill, payment, asset, and subledger record includes:
  - `tenant_id`: Identifies the tenant (sole proprietor PAN, company ID, etc.)
  - `book_set_id`: Identifies the BookSet within that tenant (personal, proprietorship-business-1, etc.)
- **Uniqueness constraints remain tenant-wide**: Every existing tenant-wide uniqueness rule (account code, invoice number, document ID, etc.) is preserved and remains binding across all BookSets within the tenant until separately revised. New constraints may be BookSet-scoped; existing tenant-wide constraints are not auto-converted to BookSet-scoped.
- Reports, balances, and trial balances default to one BookSet; cross-BookSet views require explicit aggregation.
- Period locks are BookSet-scoped or tenant-wide; blocking is granular.

**Concrete Example**: Sudhanshu's tenant contains two BookSets:
- `personal`: Account 1010 (Personal Bank) has balance ₹500,000.
- `proprietorship-business`: Account 1010 (Business Bank) has balance ₹200,000.
These are separate accounts in separate BookSets; no automatic consolidation. An `agent-bahi balance` command without `--book-set` either fails (ambiguous) or defaults to one BookSet; the CLI contract (PT-014) specifies the default behavior.

**Credible Alternative**: All accounts and postings are tenant-scoped only; BookSet is a reporting/grouping tag, not a data-model boundary. This loses data-model isolation and requires expensive queries to separate business from personal accounts.

**Silent-Failure Risk**: Missing BookSet boundaries allow personal expenses to post to business accounts or vice versa, silently commingling tax treatment. GST ITC claims on personal purchases become unclear. Consolidated trial balances hide BookSet-specific anomalies.

**Reversal Path**: Owner may flatten BookSets to tags/reporting dimensions after Phase 1; this requires a migration but is possible if the data model proves too granular.

**Impacted Current Contracts**:
- **Reporting Allocations Explicit** ([decisions.md § Confirmed](decisions.md#confirmed)): BookSet is a structural boundary, not a percentage allocation. Reports may aggregate across BookSets, but the aggregation is explicit (via query filter/union), not implicit.
- **Multi-GSTIN Within Tenant** ([decisions.md § Confirmed](decisions.md#confirmed)): GSTIN is a property of a proprietorship BookSet, not tenant-wide. One BookSet may have multiple GST registrations (multi-GSTIN), but GST work remains scoped to BookSet + GSTIN.

**Owner Review Status**: Awaiting owner review. This enables data isolation but requires approval of the BookSet-ownership model.

---

<a id="pt-003"></a>
### PT-003: Atomic Same-Tenant Inter-BookSet Transfer with Balanced Linked Legs

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: A transfer of funds between BookSets within the same tenant is atomic and creates two balanced linked legs (debit in destination BookSet, credit in source BookSet). Transfer classification (loan, capital injection, dividend, distribution, etc.) does not suppress underlying supply/sale/loan/drawing tax facts.

**Recommended Default**:
- A single inter-BookSet transfer creates a paired entry:
  - Debit: Destination BookSet asset (bank/advance/loan receivable) and account
  - Credit: Source BookSet asset (bank/advance/loan payable) and account
  - Both legs reference the same transfer ID, date, and amount.
- The transfer classification (e.g., "proprietor capital injection" or "proprietor drawings") is metadata, not a suppression mechanism.
- Tax facts are explicit: if the transfer represents income (dividends, distributions), it is recorded separately in the relevant income-head subledger; if it represents a taxable event (sale, supply), that event is recorded independently.
- Example: Personal bank transfers ₹100,000 to business bank. This creates:
  - Debit Business Bank ₹100,000 / Credit Proprietor Advance Payable ₹100,000 (business BookSet)
  - Debit Proprietor Advance Receivable ₹100,000 / Credit Personal Bank ₹100,000 (personal BookSet)
  - The advance/receivable pair is a matched inter-BookSet transfer.
  - If the ₹100,000 is later determined to be a distribution of profits (not a loan), that tax classification is recorded separately.

**Concrete Example**: Sudhanshu transfers ₹50,000 from personal savings to business for inventory. The entry is:
- **Business BookSet**: Dr Inventory ₹50,000 / Cr Proprietor Payable ₹50,000
- **Personal BookSet**: Dr Proprietor Receivable ₹50,000 / Cr Personal Savings ₹50,000
Later, if this is determined to be a capital injection (not a loan), the proprietor payable/receivable may be reclassified to capital; the original transfer remains immutable.

**Credible Alternative**: Treat inter-BookSet transfers as implicit automatic postings (hidden from the user) or as single-legged entries in one BookSet only. This loses audit trail and comingles BookSet balances.

**Silent-Failure Risk**: Single-legged entries allow one BookSet to over/under-state assets. Automatic postings hide the actual proprietor advance/distribution logic and make it impossible to audit transfer amounts or classification changes.

**Reversal Path**: If the business BookSet and personal BookSet are later consolidated into one BookSet (reversing PT-001), inter-BookSet transfers become internal reclassifications or consolidation eliminations.

**Impacted Current Contracts**:
- **Double-Entry, Immutable Correction Lineage** ([decisions.md § Confirmed](decisions.md#confirmed)): Transfers are posted entries and follow immutable lineage.
- **Posted-Document Correction** ([decisions.md § Confirmed](decisions.md#confirmed)): Corrections to transfers use reversal + replacement across both BookSets atomically.

**Owner Review Status**: Awaiting owner review. This enables consistent BookSet balancing.

---

<a id="pt-004"></a>
### PT-004: Personal Bank, Investment/Tax-Lot, Property/Rent/Loan Subledgers with Provenance and Reconciliation

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: The personal BookSet contains specialized subledgers for (a) personal bank accounts with daily reconciliation/match records, (b) investment holdings with tax-lot tracking (cost basis, acquisition date, holding period, gains/losses), (c) property/rental subledgers (property details, rent received, maintenance, loan schedules), and (d) personal loans (EMI, interest, principal breakdown). Every line carries immutable provenance (source document, date, amount) and reconciliation evidence.

**Recommended Default**:
- **Personal Bank Subledger**: Links to personal bank statements. Every deposit and withdrawal is reconciled against bank source. Unmatched items trigger `RECONCILIATION_REQUIRED`. Match records store bank date, statement amount, posting date, posted amount, match source/reference, and confirmation timestamp.
- **Investment Subledger**: Tracks holdings per security/asset class:
  - ISIN or identifier, quantity, unit cost, acquisition date, holding period (>12 months, ≤12 months, <365 days per LTCG rules)
  - FV (Fair Value) snapshot dates and amounts (e.g., portfolio valuation per 31 Mar each year for capital gains calculation)
  - Gain/loss calculations per holding period, indexed cost, and applicable tax rate (indexed, ordinary, LTCG, etc.)
  - CAS/e-CAS reconciliation evidence
- **Property/Rental Subledger**: Tracks each property:
  - Property details (address, registration, acquisition date)
  - Annual rent received with source evidence (tenant agreement, bank deposits, receipts)
  - Maintenance, property tax, insurance, repairs
  - Home-loan schedule (principal, interest, EMI dates)
  - Deductibility tracking per income-tax act (s24, s25, s36, etc.)
- **Personal Loan Subledger**: Tracks loans taken by proprietor:
  - Lender, amount, term, interest rate, EMI schedule
  - Principal and interest breakdown per payment
  - Deductibility (if eligible per s24(1)(vi), personal loans interest is generally not deductible)

**Concrete Example**: Sudhanshu receives rent of ₹50,000 monthly from a property. The personal BookSet has:
- Property rental subledger entry: Property ID PRP-001, Amount ₹50,000, Source: Tenant bank transfer on 10th, Match Status: RECONCILED, Bank Statement Reference: Deposit on 10 Aug 2026, Personal Bank reconciliation complete.
- Annual deductibility calculation: Maintenance ₹5,000, Property Tax ₹10,000, Home Loan Interest ₹25,000 (per loan schedule), Net Income under "Income from House Property": ₹50,000 - ₹40,000 = ₹10,000.

**Credible Alternative**: Single generic ledger accounts for all personal items (Personal Bank, Investments, Property) with minimal subledger detail. This loses property-specific and tax-lot reconciliation granularity.

**Silent-Failure Risk**: Missing subledger reconciliation allows:
- Personal bank deposits to be unmatched against actual bank statements (reconciliation fraud/error risk).
- Investment holdings to misstate cost basis and holding period (LTCG/STCG misclassification).
- Rental income to omit maintenance or loan-interest deductions (overstated tax liability or deduction denial).
- Loan interest to be incorrectly claimed as deductible.

**Reversal Path**: Owner may simplify subledgers to basic tracking (no daily reconciliation) after Phase 1; immutable posting records are preserved, so simplification is a reporting choice, not a data model change.

**Impacted Current Contracts**:
- **Bank Reconciliation Boundary** ([decisions.md § Confirmed](decisions.md#confirmed)): Personal bank reconciliation follows the same pattern as business bank reconciliation (match records, explicit confirmation, fail-closed).
- **Expense Evidence** ([decisions.md § Confirmed](decisions.md#confirmed)): Property maintenance and loan interest must have supporting evidence (bills, loan statements); the subledger carries evidence provenance.

**Owner Review Status**: Awaiting owner review. This enables detailed personal-income and deduction tracking.

---

<a id="pt-005"></a>
### PT-005: ONE TaxCase/Return per Taxpayer/Year/Filing Sequence Covers ALL Applicable BookSets and External Sources

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: A single TaxCase (tax return object) for a taxpayer/PAN, financial year, and filing sequence (original, revised, corrected, etc.) automatically includes and aggregates:
- All applicable personal BookSet income, expenses, and tax-treatment facts
- All applicable proprietorship BookSet income, expenses, assets, and tax-treatment facts  
- External-source aggregates (AIS, 26AS, broker statements, CAS, EPFO, NPS) via immutable snapshots
- Never separate personal ITR and proprietorship ITR within the same year for the same taxpayer
- Never permit silent omission of an applicable BookSet or external source

**Recommended Default**:
- `TaxCase` is a year-scoped container for:
  - `taxpayer_id` (PAN)
  - `financial_year` (e.g., "2024-25", "2025-26")
  - `filing_sequence` (e.g., "original", "revised", "corrected")
  - `book_sets` array: References to all applicable BookSets (personal, proprietorship-1, proprietorship-2, etc.) with snapshot digests and aggregated balances
  - `external_sources` object: Aggregated snapshots of AIS, 26AS, broker CAS, EPFO, NPS with ingestion dates and reconciliation status per source
  - `form_selected` (e.g., "ITR-3" if business income > ₹50 lakh, else "ITR-2")
  - `validation_status` (e.g., UNKNOWN, DRAFT, VALIDATED, FILED, VERIFIED)
- Finalization of a TaxCase (marking as FILED or VERIFIED) atomically validates that:
  - No BookSet is omitted (all business and personal sources are included)
  - External sources are reconciled to target status (at minimum, INGESTED; preferably RECONCILED)
  - Form selection is correct per current-year facts and rules
  - No conflicting facts exist (e.g., same investment holding reported by two sources with different cost basis)
- A skill may prepare a return draft; the engine validates atomicity and fail-closes if a BookSet is missing or if external-source conflicts exist.

**Concrete Example**: Sudhanshu's TaxCase for FY 2025-26 contains:
- `book_sets`: ["personal", "proprietorship-consulting"]
- `external_sources`: {"AIS": {"status": "INGESTED", "ingested_at": "2026-06-15"}, "26AS": {"status": "RECONCILED", "TDS_amount": ₹50,000}}
- `form_selected`: "ITR-3" (business income reported from proprietorship-consulting BookSet)
- Final validation checks:
  - ✓ Personal BookSet included (salaries, investments, property)
  - ✓ Proprietorship BookSet included (consulting income, expenses, assets)
  - ✓ AIS ingested (TIS values cross-checked against personal BookSet salary heads)
  - ✓ 26AS reconciled (TDS ₹50,000 matches withholding entries in personal and business BookSets)
  - ✓ Form ITR-3 selected (because consulting business income > ₹0 and business asset holding exists)
  - If any check fails (e.g., proprietorship BookSet missing), validation returns `MISSING_BOOKSET` and fails closed.

**Credible Alternative**: Separate TaxCases for personal ITR and proprietorship ITR (business-centric model). Owner/skill orchestrates two filings manually. This breaks the statutory requirement (one return per PAN per year) and requires manual coordination.

**Silent-Failure Risk**: Separate TaxCases allow:
- A proprietorship BookSet to be silently omitted from the return (underpayment of tax on business income).
- Personal and business returns to file different salaries/income amounts for the same head (inconsistency with 26AS/AIS).
- External sources (AIS, 26AS) to be partially reconciled; missing reconciliation is not detected.
- Form selection to be missed if a second proprietorship is added mid-year.

**Reversal Path**: After Phase 1, if separate-filing workflows become necessary (e.g., separate business partnerships), owner may add multiple-TaxCase-per-year support; the single TaxCase model remains the default.

**Impacted Current Contracts**:
- **Tenant Independence** ([decisions.md § Confirmed](decisions.md#confirmed)): A TaxCase is tenant-scoped but BookSet-spanning within that tenant.
- **Canonical Ledger, Report Basis** ([decisions.md § Confirmed](decisions.md#confirmed)): TaxCase aggregates from canonical BookSet ledgers; no separate tax-return ledger.

**Owner Review Status**: Awaiting owner review. This is the cornerstone decision for sole-proprietor filing.

---

<a id="pt-006"></a>
### PT-006: Form Selection is Year-Specific and Fact-Driven; No Universal ITR-3/4 Mapping

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: The applicable ITR form (ITR-1, ITR-2, ITR-3, ITR-4, ITR-5, ITR-6, ITR-7) is determined annually based on:
- Applicable income heads (salary, business, capital gains, house property, other sources) in the current year
- Income thresholds and turnover limits per effective ITD rules
- Taxpayer profile (individual, HUF, NRI, etc.)
- Filing regime (old-law, new-law, special regimes)
No universal mapping exists (e.g., all business proprietors file ITR-3; some file ITR-4 under s44AB or ITR-1 if eligible).

**Recommended Default**:
- For each TaxCase (taxpayer/year/filing sequence):
  - Query current-year effective-dated rule pack: List applicable forms and eligibility criteria
  - Scan all BookSets for relevant income heads and thresholds (business turnover, capital gains, rental income, salary, etc.)
  - Match scanned facts against form eligibility criteria
  - Select the form with the narrowest scope that covers all reported heads (e.g., prefer ITR-1 > ITR-2 > ITR-3 > ITR-4)
  - If no single form covers all heads, return `FORM_SELECTION_CONFLICT` and fail closed
- Document form-selection reasoning in TaxCase metadata (which heads triggered which form).

**Concrete Example**: Sudhanshu files for FY 2025-26 (AY 2026-27). He consults the effective rule pack for AY 2026-27 (under Income-tax Act 1961) and the applicable form eligibility criteria per that year's official rules. The rule pack specifies ITR eligibility branches (e.g., ITR-1, ITR-2, ITR-3, ITR-4, ITR-5 with conditions per s2 definitions and Chapter VI assessment rules). Sudhanshu's BookSets show salary + capital gains + business income + house property income. Agent-bahi matches scanned heads against rule pack criteria and selects the form with the narrowest scope covering all heads. If business income is present, ITR-3 is typically required (unless specific 44AD/44ADA/44AE conditions in the applicable year make ITR-4 eligible); form selection output includes the rule-pack reasoning. Turnover thresholds, presumptive-income limits, and form applicability are sourced from the effective rule pack per year, not hardcoded.

**Credible Alternative**: Hard-code ITR-3 for all business proprietors, or ITR-4 for all presumptive. This loses compliance with annual form-eligibility rules and creates audit risk.

**Silent-Failure Risk**: Using wrong form (e.g., ITR-1 when business income is reported):
- Portal rejection (form does not accept business-income schedules)
- Post-filing correction required (filing ITR-2 when ITR-3 required)
- Audit focus (revenue officer may reject simpler form)

**Reversal Path**: Owner may lock a specific form per taxpayer if regulatory exemptions or special regimes justify it; reversal is a policy override, not a model change.

**Impacted Current Contracts**:
- **PT-007** (bind governing Act, rule snapshot): Form selection depends on effective rule snapshot per year.
- **Annual Income-Tax Compliance Matrix** ([annual-income-tax-compliance-matrix.md](annual-income-tax-compliance-matrix.md)): Form eligibility criteria are part of the compliance baseline.

**Owner Review Status**: Awaiting owner review. This decision prevents wrong-form filing.

---

<a id="pt-007"></a>
### PT-007: Bind Governing Act, Period, Trigger, Official Schema/Validation Release, and Rule Snapshot

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: Every TaxCase atomically binds:
- **Governing Act**: The version of the Income-tax Act and Finance Act amendments effective for the applicable year (Act 2025 for AY 2026-27, etc.)
- **Period**: Financial year (old-law) or Tax Year (new-law); start date and end date per regime
- **Trigger**: The event/deadline that required return filing (s139 due date, processing notice u/s 143(1), defect notice u/s 139(9), etc.)
- **Official Schema/Validation Release**: The exact ITD release of ITR form schema (XML, field definitions, validation rules) applicable to the form and year
- **Rule Snapshot**: The versioned effective-dated compliance rule pack used for form selection, schedules, deduction/credit eligibility, and tax calculation

All four components are immutable once the TaxCase is locked (finalized). Any change to the rule snapshot or schema requires a new TaxCase (revised/corrected filing).

**Recommended Default**:
- TaxCase schema includes:
  ```
  {
    "taxpayer_id": "PAN",
    "financial_year": "2025-26",  // or "2025" for new-law
    "filing_sequence": "original",
    "governing_act": "Income-tax Act, 2025 with Finance Act 2026 amendments",
    "period_start": "2025-04-01",
    "period_end": "2026-03-31",
    "filing_regime": "old-law",  // or "new-law"
    "official_schema_release": "ITR-3 v1.2 (AY 2026-27 Release Date: 2026-04-15)",
    "rule_snapshot_id": "INCOME_TAX_RULES_AY_2026_27_v1.5",
    "rule_snapshot_hash": "<content_hash>"
  }
  ```
- Rule snapshot includes:
  - Form eligibility criteria (s2, s139, etc.)
  - Deduction limits (s80C ₹150,000 limit per AY 2026-27, etc.)
  - Rate schedules (tax rates per slab, surcharge, cess per regime, gender, age)
  - Capital gains holding periods and indexation factors
  - Other heads and special provisions
- All references to ITD rules must cite the snapshot version, not live rules. This prevents retroactive rule application.

**Concrete Example**: Sudhanshu files for AY 2026-27 under old-law. The TaxCase binds:
- Governing Act: Income-tax Act 2025 + Finance Act 2026 amendments (effective until 31 Mar 2027)
- Period: 1 Apr 2025 – 31 Mar 2026 (FY 2025-26)
- Filing Regime: old-law (s115BAC not applicable; standard slabs apply)
- Schema: ITR-3 v1.2 (ITD release 2026-04-15)
- Rule Snapshot: INCOME_TAX_RULES_AY_2026_27_v1.5 (includes ₹150,000 s80C limit, current rate slabs, 0% surcharge for individuals, 4% cess, etc.)
Later, in AY 2027-28, if Finance Act 2027 changes the ₹150,000 limit to ₹200,000, Sudhanshu's AY 2026-27 return remains locked to the ₹150,000 limit (via the rule snapshot). A revised/corrected return for AY 2026-27 would re-bind the same snapshot; a return for AY 2027-28 would bind the new limit.

**Credible Alternative**: Use live rule data at return-generation time. This allows retroactive rule application and makes it impossible to audit which rules were applied to a filed return.

**Silent-Failure Risk**: Without snapshot binding:
- Rule changes mid-year silently change deduction/credit eligibility for a draft return.
- Audit does not know which rules were applied to a filed return.
- Revised/corrected returns silently adopt new rules, breaking consistency.

**Reversal Path**: Owner may add policy overrides (e.g., "use new rules for corrected return") after Phase 1; snapshot binding remains the default.

**Impacted Current Contracts**:
- **Effective-Dated Rules Engine** ([architecture-decisions.md § ARC-008, ARC-009](architecture-decisions.md)): Rule snapshots are part of the immutable rules infrastructure.
- **PT-006** (form selection): Form eligibility is rule-snapshot-dependent.

**Owner Review Status**: Awaiting owner review. This ensures audit-trail completeness.

---

<a id="pt-008"></a>
### PT-008: Preserve Primary Artifacts; AIS Including TIS Values; 26AS; Reconcile Without Overwrite; None Exhaustive

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: Agent-bahi imports and preserves AIS and 26AS as primary artifacts (immutable, hashed records). AIS includes TIS (Tax Information Summary) values as a component (not separate). 26AS is TDS/TCS-focused only. Neither is exhaustive:
- **AIS**: Aggregates third-party-reported incomes (salary from Form 16, TDS/TCS from Form 16A, interest from Form 16C, etc.). Includes TIS pre-calculated tax values on those heads. **Omits** self-assessed heads: business income, rental income, capital gains, other personal income reported directly by taxpayer.
- **26AS**: Shows only TDS (tax deducted at source) and TCS (tax collected at source) collected against PAN. **Omits** gross income heads, business income, rental income, capital gains, salary (except TDS withheld).
- **TIS**: Is an AIS component, not a separate document. Pre-calculated tax values on AIS heads only; not exhaustive income-tax liability.
Reconciliation validates consistency between external sources and BookSet ledgers without overwriting ledger data. Gaps or conflicts are marked explicitly. No external source overwrites canonical BookSet data.

**Recommended Default**:
- **AIS Import**:
  - Download/ingest AIS PDF or JSON from e-filing portal
  - Hash and store immutably as `external_source_artifact` with:
    - Source URL, download date, taxpayer PAN, financial year
    - File hash (SHA-256)
    - Extracted data: TDS info, TCS info, TIS (pre-calculated tax values) per head
  - Parse TIS values: Salary TIS, interest TIS, investment-income TIS, etc.
  - Reconcile TIS against TaxCase BookSet:
    - Match salary TIS against Personal BookSet salary subledger (Form 16 withholding)
    - Match interest/investment TIS against investment subledger (interest received, dividend)
    - Flag unmatched/conflicting amounts
  - Status transitions:
    - INGESTED: AIS file imported and parsed
    - RECONCILED: All TIS values matched to BookSet sources; no conflicts
    - CONFLICT: TIS values differ from BookSet (e.g., TIS shows ₹50,000 salary but BookSet shows ₹45,000)
    - INCOMPLETE: TIS values exist but corresponding BookSet entries are missing (e.g., salary TIS but no salary entry in personal BookSet)
- **26AS Import**:
  - Download/ingest 26AS PDF or Excel from e-filing portal
  - Hash and store immutably
  - Extract: TDS (per category: salary, interest, professional services, rent, etc.), TCS
  - Reconcile TDS/TCS against BookSet:
    - Match TDS on salary against Form 16 withholdings
    - Match TDS on interest against investment subledger
    - Match TCS on sales (if any)
    - Flag unmatched amounts
  - Status: INGESTED, RECONCILED, CONFLICT, INCOMPLETE (same as AIS)
- **Reconciliation Rules**:
  - No overwrite: If AIS TIS shows ₹50,000 salary but BookSet shows ₹45,000, the BookSet value is authoritative (ledger is canonical). Flag the conflict in TaxCase.
  - Reconciliation is one-way: External source ← BookSet (check if external matches BookSet), not BookSet ← External (do not pull external into BookSet).
  - Gaps are explicit: If AIS is imported but no corresponding BookSet entry exists, status is INCOMPLETE (not reconciled).
- **TIS is Part of AIS, Not Separate**: TIS values are extracted from AIS; no separate TIS import. TIS is not a public API and does not have a separate source document.

**Concrete Example**: Sudhanshu downloads AIS for FY 2025-26 on 2026-06-20. AIS contains:
- Salary TIS: ₹40,00,000, TDS withheld: ₹8,00,000 (from employer)
- Interest on Savings: ₹50,000, TDS withheld: ₹5,000
- Dividend: ₹20,000, TDS withheld: ₹2,000
Agent-bahi ingests and reconciles:
- BookSet Personal contains salary income ₹40,00,000 with TDS ₹8,00,000 ✓ Match → RECONCILED
- BookSet Personal contains interest income ₹50,000 with TDS ₹5,000 ✓ Match → RECONCILED
- BookSet Personal contains dividend income ₹25,000 with TDS ₹2,500 ✗ Conflict (AIS shows ₹20,000) → CONFLICT status
26AS shows the same TDS amounts for salary and interest; 26AS status is RECONCILED.

**Credible Alternative**: Auto-populate BookSet from AIS/26AS (data-pull model). This overwrites ledger entries with external sources and loses audit trail.

**Silent-Failure Risk**: 
- Without preservation: External source data is lost; cannot audit what reconciliation was attempted.
- Without overwrite-prevention: External source overwrites BookSet, silencing ledger errors.
- Without explicit gaps: Missing reconciliation (AIS imported but not reconciled) is not detected.

**Reversal Path**: Owner may add auto-correction workflows (e.g., "if conflict detected, update BookSet to match AIS") after Phase 1; the reconciliation model remains unchanged.

**Impacted Current Contracts**:
- **Bank Reconciliation Boundary** ([decisions.md § Confirmed](decisions.md#confirmed)): External reconciliation follows the same pattern (preserve, no overwrite, explicit gaps).
- **PT-004** (personal subledgers): Reconciliation evidence is stored per subledger record.

**Owner Review Status**: Awaiting owner review. This ensures external-source integrity.

---

<a id="pt-009"></a>
### PT-009: Hashed File-First V1; No Credential Scraping/OTP/Browser Automation; Official/Authorised Adapters Later; AA Partner-Required

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: V1 sources are ingested as files only (PDF, CSV, Excel, JSON downloaded by user). Hashes and metadata are stored immutably. No credential scraping, OTP automation, browser automation, or direct portal login is implemented. Account Aggregator (AA) is a future regulated partner; AA integration is deferred and requires official partner agreements.

**Recommended Default**:
- **Supported V1 File Sources**:
  - AIS: PDF and JSON/CSV (user downloads from e-filing portal)
  - 26AS: PDF and Excel/CSV (user downloads from e-filing portal)
  - Bank statements: CSV/Excel from personal bank (ICICI, HDFC, axis, etc., per bank format)
  - Broker CAS/e-CAS: PDF and Excel from broker (NSDL, CDSN, depository, etc.)
  - Property documents: PDF (property deed, rent agreement, property-tax receipt)
  - EPFO statement: PDF from EPFO portal (self-download, no OTP automation)
  - NPS statement: PDF from NPS portal or PFRDA (self-download, no OTP automation)
- **Import Workflow**:
  - User downloads file manually (via portal, email, bank, broker)
  - User uploads file to agent-bahi via CLI or web (future)
  - Agent-bahi computes file hash (SHA-256), stores immutably
  - Parsing extracts structured data (AIS heads, 26AS TDS, bank transactions, holdings, etc.)
  - Metadata recorded: Source file name, upload date, taxpayer PAN, period covered, file hash
  - Reconciliation occurs per PT-008 rules
- **No Credential or Automation**:
  - No username/password storage for bank, broker, EPFO, NPS, or e-filing
  - No OTP automation (user receives OTP, enters manually)
  - No browser automation or API scraping (future authorized adapters may add this)
  - No headless browser session maintenance
- **Account Aggregator (AA) Future Model**:
  - AA framework (RBI-regulated) allows one authorized aggregator (AA) to collect data from multiple financial institutions (FIs) with customer consent
  - Agent-bahi does NOT register as an AA. Agent-bahi is an FIU (Financial Information User) or TSP (Trustee Service Provider) participant or partner.
  - Future Phase may add AA integration as an optional data-ingest mechanism, but requires formal partner agreement with a registered AA, not Sudhanshu registration.
  - AA integration (if pursued later) requires:
    - Formal partner agreement with registered AA entity
    - Technical integration API (AA provides standard XML/JSON schema per RBI directions)
    - Consent/authorization management (customer data-access approval via AA portal)
  - V1 file-first is the sole method. No OTP automation, scraping, or credential storage for direct AA access. Until partner agreement and AA research are complete, file-download remains the only supported method.

**Concrete Example**: Sudhanshu downloads AIS from e-filing portal on June 20, 2026. Workflow:
1. Portal generates AIS PDF with TIS values
2. Sudhanshu downloads PDF to local device
3. Sudhanshu invokes: `agent-bahi import-ais --file ~/Downloads/AIS_FY25-26.pdf --tenant sudhanshu-pan`
4. Agent-bahi:
   - Computes hash: SHA-256(AIS_FY25-26.pdf) = "abc123..."
   - Stores: `external_artifact { file: "AIS_FY25-26.pdf", hash: "abc123...", uploaded_at: "2026-06-20", taxpayer: "AAABX5055K", period: "2025-26" }`
   - Parses AIS: Extracts TDS, TIS values
   - Reconciles against Personal BookSet
   - Status: INGESTED (or RECONCILED if all TIS match BookSet)
5. If integration with AA becomes available later, agent-bahi may add a separate `agent-bahi import-aa --aa-token <auth> --period <fy>` command; existing file-based reconciliation remains unchanged.

**Credible Alternative**: Direct portal API integration (using credentials). This requires ITD to provide a stable API (not yet available for individuals) and introduces credential storage risk.

**Silent-Failure Risk**: 
- Without hash: File integrity cannot be verified; same file uploaded twice may be treated as different.
- With credentials: Passwords/OTP are stored, exposing privacy/security risk.
- Without AA framework: Direct scraping violates portal ToS and is fragile to portal changes.

**Reversal Path**: After Phase 1, official ITD API or AA partner integration may be added as optional faster routes; file-first remains the supported baseline.

**Impacted Current Contracts**:
- **Privacy/Security Guardrails** ([PT-015](#pt-015) below): File-first prevents credential storage and reduces security surface.
- **Immutable Artifact Storage**: Hashes are part of the immutable record design (decisions.md).

**Owner Review Status**: Awaiting owner review. This ensures secure V1 scoping.

---

<a id="pt-010"></a>
### PT-010: Progressive Source Readiness Model

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: External sources (AIS, 26AS, broker statements, bank accounts, property records, EPFO, NPS) have a progressive readiness state. No arbitrary rupee or evidence thresholds block progression. An acknowledged mandatory gap cannot transition to READY; only the affected statutory action blocks completion.

**Recommended Default**: Source readiness states (per source per TaxCase):
1. **UNKNOWN**: Source has never been attempted; no import/download attempted.
2. **DECLARED_NOT_APPLICABLE**: User/operator confirms source does not apply to this taxpayer/year (e.g., "No NPS contributions this year").
3. **EXPECTED**: Source is expected to be available (e.g., employer should have issued Form 16); import not yet attempted or in progress.
4. **INGESTED**: Source file imported and parsed; structured data extracted; no reconciliation yet.
5. **RECONCILED**: Source data reconciled against BookSet ledger; no conflicts detected; reconciliation confirmation recorded.
6. **CONFLICT**: Source data imported and reconciled; conflicts detected (e.g., amount mismatch); awaiting resolution.
7. **INCOMPLETE**: Source partially available; some expected data missing (e.g., AIS missing an entire income head the taxpayer knows they have).
8. **READY**: Source is fully reconciled, no conflicts, no gaps; ready for return inclusion.
9. **STALE**: Source was READY but is now outdated (e.g., new version published, superseded by update); re-ingestion required.

**Progression Rules**:
- UNKNOWN → DECLARED_NOT_APPLICABLE (if user confirms not applicable)
- UNKNOWN → EXPECTED (if source is expected but not yet attempted)
- EXPECTED → INGESTED (when import attempted)
- INGESTED → RECONCILED (when all data matched with no conflicts)
- INGESTED → CONFLICT (when data imported but conflicts detected)
- INGESTED → INCOMPLETE (when partial data available)
- CONFLICT → RECONCILED (when conflicts are resolved)
- INCOMPLETE → RECONCILED (when missing data is obtained and reconciled)
- Any state → STALE (when source update is published or time-based expiry occurs; e.g., AIS refreshed by ITD after taxpayer makes a correction)
- READY → STALE (when new version of source is available)

**No Arbitrary Thresholds**: Examples of what NOT to impose:
- "Minimum ₹1,00,000 AIS income before reconciliation is complete" ← Do not do this; reconcile any amount.
- "If over 2 conflicts detected, source is unreliable" ← Do not do this; each conflict is resolved individually.
- "If ≥10% of entries unmatched, mark INCOMPLETE and block return" ← Do not do this; mark INCOMPLETE and wait for user action.

**Blocking Rule**: Only the affected statutory action is blocked, not the entire return. Example:
- If 26AS is INCOMPLETE (some TDS entries missing from receipt), but all TDS shown on 26AS is reconciled, return filing is not blocked; the return is filed with a note that 26AS reconciliation is incomplete.
- If a required proprietorship BookSet is UNKNOWN (no source data ingested), return finalization is blocked (violates PT-005).

**Concrete Example**: Sudhanshu's TaxCase for FY 2025-26 has:
- AIS: RECONCILED (TIS values match Personal BookSet; no conflicts)
- 26AS: CONFLICT (TDS on salary shows ₹8,00,000; BookSet shows ₹7,90,000; ₹10,000 discrepancy awaiting Form 16 re-issue by employer)
- Broker CAS: INGESTED (file imported but reconciliation in progress; holdings quantity and cost basis being verified)
- EPFO: DECLARED_NOT_APPLICABLE (no contributions this year per employer confirmation)
- NPS: STALE (old statement from 2026-05-01; updated statement from 2026-06-15 available; re-import required)
Return filing is not blocked by CONFLICT/INGESTED/STALE states; return can be filed with these source statuses marked. The 26AS conflict must be resolved (either ₹8,00,000 or ₹7,90,000 is corrected) before filing, but agent-bahi does not auto-block; it marks the conflict and leaves resolution to the user/CA.

**Credible Alternative**: Single binary (READY / NOT READY) state. This loses granularity and does not distinguish between expected/in-progress/conflicted states.

**Silent-Failure Risk**: Without progressive states:
- Incomplete reconciliation is not visible; user files with partial source data and claims completeness.
- Conflicts are not tracked; same conflict reoccurs in each filing.
- No expectation management; source that is delayed is indistinguishable from source that is not applicable.

**Reversal Path**: Owner may add SLA-based auto-escalation (e.g., "if EXPECTED > 30 days, mark STALE") after Phase 1; state definitions remain unchanged.

**Impacted Current Contracts**:
- **PT-008** (external sources): Source readiness is part of reconciliation tracking.
- **Bank Reconciliation Boundary** ([decisions.md § Confirmed](decisions.md#confirmed)): Bank statement reconciliation uses the same state model.

**Owner Review Status**: Awaiting owner review. This enables transparent external-source lifecycle management.

---

<a id="pt-011"></a>
### PT-011: GST Output Belongs to Applicable Business BookSet/GSTIN; Personal Source Label Alone Does Not Decide Treatment; Business-Use Routing Explicit

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: For a sole proprietor with personal and business BookSets, an income or transaction source initially labeled "personal" (e.g., "personal bank transfer to business") must not automatically route GST treatment to the personal BookSet or assume personal-account treatment. Applicable business use must be explicitly routed to the applicable business BookSet/GSTIN. GST output (GSTR-1, GSTR-3B) belongs to the applicable business BookSet/GSTIN, never the personal BookSet.

**Recommended Default**:
- When a transaction enters with source labeled "personal" (e.g., proprietor transfer from personal account to business):
  - GST treatment is determined by the transaction's underlying nature (sale, supply, loan, investment, etc.), not source account
  - If the transaction is a business supply (sale of goods/services), it belongs in the business BookSet and flows to GSTR-1/GSTR-3B for the applicable GSTIN
  - If the transaction is a personal transfer (loan, capital injection, drawings), it stays in the personal BookSet (if it originates there) or is inter-BookSet transferred (PT-003) and no GST treatment applies
  - System fails closed if business-use is ambiguous; user must explicitly route via CLI/workflow
- **Explicit Routing Requirement**:
  - CLI commands for invoice/bill creation require a `--book-set` flag when more than one BookSet exists (to avoid ambiguity)
  - Transfers and allocations similarly require explicit BookSet source/destination
  - Reports default to one BookSet or require `--aggregate-book-sets` for cross-BookSet views
- **GST Output Boundary**:
  - GSTR-1 (output tax): Generated only from business BookSet records with the applicable GSTIN
  - GSTR-3B (return): Reconciles GSTR-1 and GSTR-2B (ITC) for the applicable GSTIN
  - GST output belongs to applicable business BookSet/GSTIN only. Personal BookSet does not have a GSTIN.
  - **Source label does not determine GST treatment**: A transaction labeled "personal" may have business-use facts requiring business BookSet/GSTIN routing. Transaction nature (sale, supply, service, loan, investment, internal transfer, etc.) and applicable GSTIN determine treatment, not account label.
  - **Business-use correction workflow**: If a business expense is initially posted to personal BookSet (e.g., proprietor pays from personal card) and later identified as business-use, (1) reverse the personal posting with documented reason, (2) post the linked business expense to the applicable business BookSet/GSTIN, (3) record the proprietor funding as a separate, balanced inter-BookSet transfer (PT-003). Never comingle the business expense and transfer; both are explicit and immutable.

**Concrete Example**:
1. **Business invoice (correct routing)**: Sudhanshu issues invoice to Client A for ₹1,00,000 (services, 18% IGST). Invoice is posted directly to proprietorship-consulting BookSet (GSTIN). Flows to GSTR-1 output tax for the GSTIN.

2. **Personal expense misrouted, then corrected**: Sudhanshu purchases stationery for ₹5,000 + ₹900 GST on personal credit card. Initially, user posts to personal BookSet:
   - **Personal BookSet (initial, incorrect)**: `Stationery Expense ₹5,000 / Personal Credit Card ₹5,000` (no GST; personal account treatment).
   - Later, user realizes: "This is business stationery; should have GST ITC."
   - **Correction workflow** (explicit, immutable):
     - Step 1 (Reversal in personal BookSet): `Dr Personal Credit Card ₹5,000 / Cr Stationery Expense ₹5,000` with reason "Reversal: business stationery reclassified to proprietorship-consulting per review on 2026-08-21."
     - Step 2 (Replacement in business BookSet): `Dr Stationery Expense ₹5,000 / Cr Stationery GST Payable ₹900 / Cr Proprietor Advance Payable ₹5,900` (proprietorship-consulting BookSet, linked to original reversal).
     - Step 3 (Funding transfer, separate): `Dr Proprietor Advance Receivable ₹5,900 / Cr Personal Credit Card ₹5,900` (personal BookSet inter-BookSet transfer; links proprietorship advance payable and personal receivable).
   - Result: Personal BookSet shows net zero (reversal + transfer cancel out); proprietorship-consulting owns stationery with GST ITC claimable. Funding is explicit and separate.

**Credible Alternative**: Use account hierarchy/tagging (e.g., all "personal" accounts default to no-GST treatment regardless of transaction nature). This loses flexibility and auto-generates wrong GST treatment.

**Silent-Failure Risk**: 
- Without explicit routing: Personal account is used for business supply → No GSTR-1 output generated → Undeclared supply → Audit/penalty risk.
- With implicit GST treatment: Personal transfer labeled as business automatically claims GSTR-1 output/ITC → Unjustified ITC → RFD inspection/demand.

**Reversal Path**: Owner may add heuristics (e.g., "if amount > ₹50,000 and from business account, auto-route to business BookSet") after Phase 1; explicit routing remains the default.

**Impacted Current Contracts**:
- **Multi-GSTIN Within Tenant** ([decisions.md § Confirmed](decisions.md#confirmed)): GST work is GSTIN-scoped; explicit BookSet routing ensures GSTIN/BookSet alignment.
- **Mixed-Use Allocation Rules** ([decisions.md § Confirmed](decisions.md#confirmed)): Business-use allocation is explicit, not implicit.
- **PT-002** (BookSet ownership): Each record's BookSet determines GSTIN scope.

**Owner Review Status**: Awaiting owner review. This prevents GST misclassification.

---

<a id="pt-012"></a>
### PT-012: TDS/TCS/Remittance Branches Effective-Dated by Role and Transaction Facts

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: TDS (tax deducted at source) and TCS (tax collected at source) obligations are determined by effective-dated rules indexed on role (as deductor, collector, or remitter), transaction facts (nature of payment, amount, vendor type, etc.), and applicable rules per financial year. No single universal TDS/TCS rule applies to all circumstances.

**Recommended Default**:
- TDS/TCS obligations are determined by effective-dated rule packs per financial year, taxpayer role (deductor, collector, remitter), and transaction facts.
- Rules and applicability vary annually: Act 1961 rule packs apply to FY 2025-26; Act 2025 rule packs apply from FY 2026-27 onward. Each Act version has distinct sections, thresholds, rates, exemption criteria, and remittance forms.
- For each transaction requiring TDS/TCS evaluation, query the applicable effective-dated rule pack:
  - Match transaction facts (role, payment nature, payee/vendor classification, amount) against applicable branches in the rule pack
  - Retrieve: Rule ID, TDS/TCS rate, threshold amount, exemption criteria, remittance form/mechanism from the rule pack (do not hardcode)
  - Compute applicability: Yes/No per rule per financial year
  - If applicable, extract rate, threshold, and remittance method from rule snapshot
- Reconcile actual TDS/TCS deducted/collected against 26AS and remittance records.
- **No embedded examples, hardcoded sections, or thresholds**: Agent-bahi does not assume universal rules (e.g., "s193 salary", "₹5 lakh vendor threshold") across years or Acts. Every TDS/TCS determination must reference the effective-dated rule snapshot.
- **Unresolved mandatory TDS/TCS**: If a TDS/TCS section applies but rate, threshold, or remittance form is ambiguous or missing from rule snapshot, return REVIEW/BLOCK pending rule clarification.
- **Reference**: See [tds-tcs-compliance-matrix.md](tds-tcs-compliance-matrix.md) for effective-dated rules per year and Act version.

**Concrete Example**: Sudhanshu pays ₹50,000 for a business transaction in FY 2025-26.
- Query effective-dated rule pack for FY 2025-26 (Act 1961): Is this transaction subject to TDS or TCS? If yes, retrieve applicable rule ID, rate, threshold, exemption criteria, and remittance form.
- Match transaction facts (role, payee type, amount) against rule pack criteria.
- If a rule applies: Compute TDS/TCS per rule pack rate and threshold. Post: `Expense ₹50,000 / TDS Payable <amount> / Bank <net>` (amount from rule snapshot, not assumed).
- If rule does not apply or vendor is exempt: Post: `Expense ₹50,000 / Bank ₹50,000` (no TDS).
- Remittance: File applicable form per rule pack (e.g., Form 24Q, e-TDS return, quarterly return). Form name and mechanism come from rule pack, not assumed.
- Reconciliation: 26AS records TDS/TCS remitted. Match against BookSet postings. Unmatched or conflicting amounts are flagged CONFLICT; resolve before finalization.

**Credible Alternative**: Hard-code one TDS rule per payment type (e.g., "all salary is 10% TDS"). This ignores annual threshold/rate changes and exemption criteria.

**Silent-Failure Risk**: Using wrong TDS rate or threshold:
- Under-remitted TDS → Penalty u/s 201
- Over-remitted TDS → Excess credit claimed
- Exemption criteria ignored → Remitted TDS on exempt payments → Unjustified deduction

**Reversal Path**: Owner may add TDS-automation shortcuts (e.g., "default 10% TDS for all contractors") as opt-in per tenant after Phase 1; effective-dated rules remain authoritative.

**Impacted Current Contracts**:
- **PT-007** (rule snapshot binding): TDS/TCS rules are part of the annual rule snapshot.
- **Annual Income-Tax Compliance Matrix** ([annual-income-tax-compliance-matrix.md](annual-income-tax-compliance-matrix.md)): TDS/TCS branches and rates are compliance baseline.
- **TDS Workflow Contract** ([statutory-workflow-contracts.md](statutory-workflow-contracts.md)): TDS return filing workflows depend on accurate TDS calculation.

**Owner Review Status**: Awaiting owner review. This ensures TDS/TCS correctness.

---

<a id="pt-013"></a>
### PT-013: ITR-Specific Portal States/Evidence; No Universal ARN

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: ITR (income-tax return) filing status and evidence vary by form and portal state. Not all ITR states involve an ARN. Agent-bahi must track ITR-specific states and evidence (Submitted, Verified, Under Processing, Processed, Rejected) and not assume a universal ARN workflow applies to all forms.

**Recommended Default**:
- **ITR Portal States** (per ITR form per TaxCase):
  - DRAFT: ITR prepared in agent-bahi; not yet submitted
  - SUBMITTED: ITR submitted on e-filing portal; ITD acknowledgement received (may include ARN if form accepted)
  - VERIFIED: ITR-V downloaded and signed (DSC or physical); uploaded to portal within 30 days
  - UNDER_PROCESSING: ITD processing return; no final status yet
  - PROCESSED: ITD processing complete; status available on portal (Form 16A/26AS updated if applicable)
  - REJECTED: ITR rejected by portal validation or ITD processing; errors/defects identified
  - STALE: Return was PROCESSED; new correction notice or update requirement issued; return status changed
- **State-Specific Evidence**:
  - SUBMITTED: ARN (if ITD accepts submission) or Unique ID; timestamp of submission
  - VERIFIED: ITR-V signed document hash; signature type (DSC or physical); upload timestamp
  - PROCESSED: ITD processing acknowledgement; Form 16A issued (if any TDS adjustments); updated 26AS
  - REJECTED: Defect notice (u/s 139(9)) or Form 16A (if TDS rejected); specific error details
- **No Universal ARN**:
  - Some forms (ITR-1, ITR-2 with simple data) auto-generate ARN on submission
  - Other forms (ITR-3 with business schedules) may require scrutiny and not generate immediate ARN
  - Defective returns may have ARN but are still under ITD scrutiny
  - Revised/corrected returns may not generate new ARN; they reference original return ARN
- **Reconciliation Against e-Filing Portal**:
  - Every submission/state change must be correlated with official e-filing portal status
  - Agent-bahi does not assume a state based on elapsed time; user/operator retrieves actual status from portal

**Concrete Example**: Sudhanshu files ITR-3 (business income) for FY 2025-26 on 2026-07-01. Workflow:
1. **DRAFT state**: ITR prepared in agent-bahi; form validation complete; saved as draft
2. **SUBMITTED state**: Sudhanshu downloads ITR JSON and uploads to e-filing portal on 2026-07-01, 10:00 AM. Portal response: "Submission successful" with Unique ID `ITRUID-20260701-001234` (no ARN yet; ARN issued after e-TDS validation by ITD, which takes 24-48 hours). Agent-bahi records: `state: SUBMITTED, unique_id: ITRUID-20260701-001234, submitted_at: "2026-07-01 10:00 UTC"`
3. **VERIFIED state**: Sudhanshu downloads ITR-V from portal, signs digitally (DSC), uploads within 30 days on 2026-07-05. Portal confirms upload. Agent-bahi records: `state: VERIFIED, itr_v_signed_hash: <hash>, signature_type: DSC, verified_at: "2026-07-05"`
4. **PROCESSING state**: On 2026-07-03, ITD validates e-TDS for the filing. ARN is issued: `ARN-2026-0123456789`. Agent-bahi queries e-filing portal (manual user query or future automated sync) and updates: `state: UNDER_PROCESSING, arn: ARN-2026-0123456789, processing_started: "2026-07-03"`
5. **PROCESSED state**: On 2026-08-15, ITD completes processing. 26AS is updated with adjusted TDS (if any). Agent-bahi records: `state: PROCESSED, processing_completed: "2026-08-15", 26as_updated: "2026-08-15"`
6. **REJECTED state** (alternative): If ITD finds defects (e.g., business turnover declaration issue), a defect notice u/s 139(9) is issued on 2026-08-10. Agent-bahi records: `state: REJECTED, defect_notice: <reference>, defect_date: "2026-08-10", action_required: "Submit corrected ITR-3 by 2026-09-10"`

**Credible Alternative**: Treat ARN as proof of filing; assume PROCESSED state once ARN is issued. This ignores pending ITD scrutiny and misleads about actual filing status.

**Silent-Failure Risk**: 
- Assuming PROCESSED once ARN is issued → ITD may reject/scrutinize return after ARN issuance → Silent status mismatch
- Using universal ARN workflow → ITR-2 (may auto-verify) treated same as ITR-3 (may require scrutiny) → Different evidence expectations

**Reversal Path**: Owner may add automated e-filing portal status sync (future) after research; manual state recording remains the fallback.

**Impacted Current Contracts**:
- **T-009** ([tentative-decisions.md § T-009](tentative-decisions.md#t-009)): Form 140/141 export is similarly form-specific; ITR-specific states follow the same principle.
- **PT-007** (rule snapshot): Portal state tracking is independent of rules; state definitions are ITD-portal-specific.

**Owner Review Status**: Awaiting owner review. This prevents misstatement of ITR status.

---

<a id="pt-014"></a>
### PT-014: `agent-bahi status` Tenant-Wide Read-Only; Each BookSet/TaxCase Separate; Ambiguous Mutations Fail Closed

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: The `agent-bahi status` command is tenant-wide, read-only, and lists each BookSet and TaxCase separately with their current states. No `--book-set` flag is required for the overview command, but ambiguous mutations (commands that could apply to multiple BookSets/TaxCases) require explicit `--book-set` or fail closed.

**Recommended Default**:
- **Status Command** (read-only, no flag required if one tenant):
  ```
  $ agent-bahi status --tenant sudhanshu-pan
  ```
  Output:
  ```
  Tenant: sudhanshu-pan (Individual, PAN: AAABX5055K)
  
  BookSets:
    - personal (₹5,00,000 balance, locked until 2026-06-30)
    - proprietorship-consulting (₹3,00,000 balance, unlocked)
    - proprietorship-training (₹1,50,000 balance, unlocked)
  
  TaxCases:
    - FY 2025-26 original (Form ITR-3, DRAFT, last_edited: 2026-06-15)
    - FY 2024-25 original (Form ITR-3, PROCESSED, ARN: ARN-2026-0123456789)
    - FY 2024-25 corrected (Form ITR-3, SUBMITTED, unique_id: ITRUID-20260701-001234)
  
  Alerts:
    - Personal BookSet: Period locked until 2026-06-30
    - Proprietorship-consulting: 26AS source CONFLICT (TDS ₹5,000 mismatch)
    - FY 2025-26 TaxCase: AIS EXPECTED (not yet imported)
  ```
- **Mutation Commands** (require explicit BookSet when ambiguous):
  - Single BookSet: `agent-bahi invoice create --amount 10000 --date 2026-08-01` → OK (if only one BookSet and only one is unlocked; otherwise fails with "BookSet ambiguous")
  - Multiple BookSets: `agent-bahi invoice create --amount 10000 --date 2026-08-01` → Error: `AMBIGUOUS_BOOKSET. Use --book-set personal|proprietorship-consulting|proprietorship-training`
  - Explicit: `agent-bahi invoice create --book-set proprietorship-consulting --amount 10000 --date 2026-08-01` → OK
  - TaxCase selection similarly requires explicit period/sequence if multiple TaxCases exist: `agent-bahi import-ais --file ~/AIS.pdf --tax-case "FY 2025-26 original"` (or --fy 2025-26 --filing-sequence original)
- **Fail-Closed Rule**: If a mutation could apply to multiple BookSets/TaxCases and the user does not disambiguate, the command is rejected with `AMBIGUOUS_BOOKSET` or `AMBIGUOUS_TAXCASE` and clear instructions on how to fix (e.g., "Use --book-set <name>").

**Concrete Example**: Sudhanshu's first consultation:
```
$ agent-bahi status --tenant sudhanshu-pan
...one BookSet: personal; one TaxCase FY 2025-26...
```
No ambiguity; invoice creation works:
```
$ agent-bahi invoice create --amount 100000 --tax-rate 18 --client "Client A"
✓ Invoice created in personal BookSet
```
After business starts (second BookSet added):
```
$ agent-bahi status --tenant sudhanshu-pan
...BookSets: personal, proprietorship-consulting; TaxCases: FY 2025-26, FY 2024-25...
```
Now invoice creation is ambiguous:
```
$ agent-bahi invoice create --amount 100000 --tax-rate 18 --client "Client A"
✗ Error: AMBIGUOUS_BOOKSET. Specify one of: personal, proprietorship-consulting
  Use: agent-bahi invoice create --book-set proprietorship-consulting --amount 100000 --tax-rate 18 --client "Client A"
```

**Credible Alternative**: Default to a "primary" BookSet (e.g., business if it exists, else personal). This silently routes commands and creates audit confusion.

**Silent-Failure Risk**: Silent routing to wrong BookSet:
- Business invoice posted to personal BookSet → Not included in GSTR-1 → Undeclared supply
- Personal expense posted to business BookSet → Claimed as business deduction → Disallowed deduction

**Reversal Path**: Owner may add default-BookSet configuration per tenant (e.g., "for personal/sole-proprietor, business BookSet is primary") after Phase 1; fail-closed default remains safer.

**Impacted Current Contracts**:
- **Tenant Selection Policy** ([decisions.md § Confirmed](decisions.md#confirmed)): Similar fail-closed principle for tenant selection when multiple tenants exist.
- **PT-002** (BookSet ownership): BookSet metadata is used to determine command targets.

**Owner Review Status**: Awaiting owner review. This prevents silent wrong-BookSet routing.

---

<a id="pt-015"></a>
### PT-015: No Product Telemetry by Default; Protected Evidence/Secrets; Remote TLS; Redacted Logs; Actor/Resource Context; Deployment/Purpose Classification; No False Compliance Claims

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: Privacy and security guardrails are applied to personal-tax data and agent-bahi operations:
1. **No product telemetry** is transmitted by default (no usage metrics, feature flags, error tracking to external services without explicit consent)
2. **Evidence/secrets protection**: Personal documents (AIS, 26AS, property deeds), bank statements, investment statements, and credentials are never transmitted to external services or logged in readable form
3. **Remote database TLS**: If agent-bahi connects to remote databases (PostgreSQL, MySQL), TLS encryption is required; plaintext database connections are rejected
4. **Redacted operational logs**: Server/engine logs redact sensitive values (account numbers, amounts, names); logs are stored locally only unless explicitly exported
5. **Actor/resource context**: Every mutation records actor (user ID, operator name), source, reason, timestamp, and affected resources; audit trail is complete and immutable
6. **Deployment/purpose classification**: Agent-bahi instances are classified as development, staging, or production; development/staging instances have less strict privacy enforcement (for testing) than production
7. **No false compliance claims**: Agent-bahi does not claim DPDP (Data Protection) compliance, RBI compliance, SEBI compliance, or other regulatory approval without explicit official basis. Disclaimers clearly state agent-bahi is a tool, not a compliance service.

**Recommended Default**:
- **Telemetry Policy**:
  - Telemetry is OFF by default
  - Environment variable `AGENT_BAHI_TELEMETRY=1` opts in to non-sensitive usage metrics (command counts, error rates, no data values)
  - Even with telemetry enabled, PII, account numbers, amounts, names, and document contents are never transmitted
  - Privacy policy (if exposed via web API in future) states telemetry scope and user control
- **Evidence/Secrets**:
  - AIS, 26AS, CAS, bank statements, and personal documents are stored in tenant-scoped directories with restricted file permissions (0600 or 0700, no world-readable)
  - Credentials (if any stored for future AA integration) use encrypted vaults (e.g., libsodium secret boxes)
  - In-memory secrets are wiped after use (no residual credential strings in memory)
  - Logs NEVER include full account numbers, full PAN (if displayed, redacted: "PAN: AAAB****K"), amounts, or document file contents
  - Log example: `[INFO] Invoice created: id=INV-001234, book_set=<redacted>, amount_paise=<redacted>, client_id=<redacted>`
- **Remote Database Security**:
  - If PostgreSQL/MySQL is configured as remote (not localhost), TLS is mandatory: `ssl_mode=require` for PostgreSQL, SSL options for MySQL
  - Self-signed certificates are accepted in development/staging with explicit warning; production requires CA-verified certs
  - Connection strings never include passwords in logs; use environment variables or vault
- **Actor/Resource Context**:
  - Every mutation includes: `{actor: "operator-id", source: "CLI|API|IMPORT", reason: "User input|Automated correction", timestamp_utc: "2026-08-20T10:30:00Z", resource: "Invoice-INV-001234", tenant_id: "sudhanshu-pan", book_set_id: "proprietorship-consulting"}`
  - Audit log is immutable and stored separately from operational logs
  - Correction lineage is explicit and includes actor/reason/timestamp per reversal and replacement
- **Deployment Classification**:
  - Configuration file specifies `DEPLOYMENT_MODE: development|staging|production` (default: development)
  - Development/staging: Telemetry disabled, reduced audit retention, local storage OK
  - Production: Telemetry strictly controlled, full audit retention, remote DB requires TLS, external services explicitly approved
- **Compliance Claims**:
  - No claim of "DPDP compliant", "ISO 27701 certified", or "RBI approved" without explicit audit/approval by the certifying body
  - Personal-data duties are cited from the **MeitY Digital Personal Data Protection Act, 2023** and **DPDP Rules** (official sources) only. No fake or superseded frameworks (e.g., "CERT-In Data Protection Guidelines", "RBI cybersecurity framework" as universal mandate).
  - Incident/breach/log reporting duties cite only **CERT-In Directions s70B (28 Apr 2022)** where applicable to covered entities and triggering incidents. Not a universal prerequisite; applicability is entity/incident-specific.
  - Disclaimers state: "Agent-bahi is a software tool for accounting and tax preparation. It does not replace professional tax advice or compliance services. Use with a qualified Chartered Accountant or tax professional. Compliance with applicable tax laws, regulations, and data-protection rules remains the user's responsibility. Agent-bahi is not regulated by ITD, RBI, GSTN, or other government agency and does not guarantee compliance or filing acceptance."
  - ITD form references: "This tool prepares income-tax returns in ITR formats published by the Income-tax Department. Portal filing and ITR-V verification are the taxpayer's responsibility. Filing acceptance, processing, and assessment are determined by ITD."

**Concrete Example**: Sudhanshu's AIS is imported on 2026-06-20. Operations:
1. User invokes: `agent-bahi import-ais --file ~/Downloads/AIS_FY25-26.pdf --tenant sudhanshu-pan`
2. Operational log: `[INFO] import_ais: actor=operator-sudhanshu, source=CLI, file_hash=abc123..., status=success` (no file path, no PAN, no data values)
3. AIS file is stored: `/data/sudhanshu-pan/external/ais_fy_2025-26_<hash>.pdf` (file permissions 0600, owner-readable only)
4. Audit log: `{actor: "operator-sudhanshu", action: "IMPORT_AIS", resource: "external_artifact_AIS_2025-26", tenant: "sudhanshu-pan", timestamp: "2026-06-20T10:30:00Z", reason: "User upload"}`
5. If remote PostgreSQL is used: Connection string uses TLS and environment-variable password, never logged in plain text

**Credible Alternative**: Full telemetry by default for better debugging. This exposes PII and reduces privacy.

**Silent-Failure Risk**: Without these guardrails:
- PII leaked to telemetry services; privacy violation
- Credentials stored in plaintext logs; credential compromise
- Plaintext database connections intercepted; MITM attack risk
- False compliance claims expose Sudhanshu to regulatory action (claiming DPDP/RBI compliance when not compliant)

**Reversal Path**: Owner may enable telemetry collection after privacy review; privacy policy remains the foundation.

**Impacted Current Contracts**:
- **Tenant Independence** ([decisions.md § Confirmed](decisions.md#confirmed)): Tenant-scoped file storage and logs enforce tenant data isolation.
- **Posted-Document Correction** ([decisions.md § Confirmed](decisions.md#confirmed)): Audit trail includes actor/reason per correction.

**Owner Review Status**: Awaiting owner review. This protects personal data and prevents false compliance claims.

---

<a id="pt-016"></a>
### PT-016: Immutable Original + Linked Correction/Revised/Updated/Rectification/Defect-Response Case Selected by Verified Mechanism

**Status**: TENTATIVE - NOT OWNER-APPROVED

**Definition**: A TaxCase (income-tax return) is immutable once filed. Corrections, revisions, updated returns, rectifications, or defect-notice responses are separate TaxCases linked to the original. The applicable correction mechanism (e.g., revised return u/s 139(1)(b), correction application u/s 154, defect response u/s 139(9), assessment correction u/s 263, etc.) is determined by verified rules and facts, not user choice.

**Recommended Default**:
- **Original TaxCase**:
  - Once marked FILED or VERIFIED, immutable (no edits)
  - ARN or Unique ID recorded
  - Filing timestamp and portal state recorded
- **Correction TaxCases** (separate, linked instances):
  - Revised return (u/s 139(1)(b)): Filed before original assessment is completed; replaces original in ITD processing
  - Corrected return (u/s 139(1)(c)): Filed after original assessment; separate filing with reference to original ARN
  - Correction application (u/s 154): Administrative correction of return (e.g., duplicate/missing schedule); request to ITD
  - Defect response (u/s 139(9)): Response to ITD defect notice; amended return filed within specified deadline
  - Assessment correction (u/s 263): Correction demanded by tax officer post-assessment; separate case/response required
  - Each linked case includes:
    - `original_tax_case_id`: Reference to original TaxCase
    - `correction_mechanism`: Type (revised, corrected, correction_application, defect_response, assessment_correction, etc.)
    - `trigger_event`: What prompted the correction (taxpayer discovery, ITD notice, tax officer demand, etc.)
    - `trigger_reference`: Notice/ARN/demand number if ITD-initiated
    - `applicable_deadline`: Due date for correction filing (if ITD-mandated)
    - `correction_reason`: Detailed reason for correction (e.g., "Discovered unreported dividend; corrected investment subledger")
    - `linked_original_arn`: ARN of original TaxCase for portal reference
- **Mechanism Selection** (not user choice):
  - Query current date and original filing date:
    - If current date < original assessment completion date: Revised return (u/s 139(1)(b)) eligible
    - If current date > assessment completion date but < s154 30-day correction window: Correction application (u/s 154)
    - If defect notice u/s 139(9) received: Defect response (u/s 139(9)) required
    - If post-assessment, correction is needed: Corrected return (u/s 139(1)(c)) or assessment correction demand (u/s 263)
  - Engine validates selected mechanism against current date and filing history; if ineligible, returns `CORRECTION_MECHANISM_INELIGIBLE` and suggests alternatives
  - User does not select mechanism manually; system determines it

**Concrete Example**: 
**Scenario 1: Revised Return**
- Sudhanshu files ITR-3 for FY 2025-26 on 2026-07-01 (ARN-2026-0001)
- On 2026-08-15, Sudhanshu discovers unreported dividend income (₹50,000)
- He invokes: `agent-bahi tax-case create-revision --tax-case "FY 2025-26 original" --reason "Unreported dividend discovered"`
- Engine checks: Current date 2026-08-15 vs. assessment completion (estimated ~2026-12-31) → Still before completion → Revised return eligible
- Engine creates new TaxCase: `{filing_sequence: "revised", original_tax_case_id: "FY-2025-26-original", mechanism: "revised_return_139_1_b", trigger_event: "taxpayer_discovery", reason: "Unreported dividend ₹50,000"}`
- New TaxCase includes all prior heads PLUS dividend income
- Filed on portal as revised return; ITD processes and updates assessment (if already initiated) or supersedes draft

**Scenario 2: Defect Response**
- ITD issues defect notice u/s 139(9) on 2026-09-01: "Schedule-CFL (capital gains schedule) not submitted"
- Sudhanshu invokes: `agent-bahi tax-case create-defect-response --tax-case "FY 2025-26 original" --defect-notice "DEFECT-2026-001"`
- Engine checks: Defect notice references original ARN; creates new TaxCase with:
  ```
  {
    filing_sequence: "defect_response",
    original_tax_case_id: "FY-2025-26-original",
    mechanism: "defect_response_139_9",
    trigger_reference: "DEFECT-2026-001",
    applicable_deadline: "2026-10-01",  // 30 days from defect notice
    reason: "Response to ITD defect: Schedule-CFL now included"
  }
  ```
- New TaxCase includes Schedule-CFL (capital gains) filled in
- Filed on portal with defect notice reference; ITD accepts as defect response

**Scenario 3: Assessment Correction (u/s 263)**
- Tax officer issues assessment correction demand on 2026-12-15: "Home-office allocation disallowed; ₹20,000 deduction denied"
- Sudhanshu (with CA) invokes: `agent-bahi tax-case create-correction-challenge --tax-case "FY 2025-26 original" --assessment-demand "ASS-263-2026-001" --action dispute|revised-claim`
- Engine creates new case:
  ```
  {
    filing_sequence: "assessment_correction_263",
    original_tax_case_id: "FY-2025-26-original",
    mechanism: "assessment_correction_263",
    trigger_reference: "ASS-263-2026-001",
    applicable_deadline: "2027-01-14",  // 30 days from demand
    reason: "Challenging home-office allocation disallowance"
  }
  ```
- New TaxCase documents the CA's legal/factual rebuttal (separate letter/document)
- Case is tracked separately; response is filed per ITD procedure (not necessarily a new ITR form)

**Credible Alternative**: Allow users to edit original TaxCase after filing (mutate ARN/verified return). This breaks audit trail and violates ITD filing immutability.

**Silent-Failure Risk**: 
- Without linked correction cases: Multiple filings become orphaned; unclear which filing is current
- With wrong mechanism: Eligible revised return filed as corrected return (later deadline, separate ARN) → Missed ITD deadline
- User-selected mechanisms: User chooses corrected return when revised was still eligible → Missed opportunity to supersede draft assessment

**Reversal Path**: Owner may add manual-override mechanism selection (after Phase 1) for special cases; automatic mechanism remains the default.

**Impacted Current Contracts**:
- **Posted-Document Correction** ([decisions.md § Confirmed](decisions.md#confirmed)): TaxCase correction follows the same reversal-linkage model.
- **PT-005** (atomic TaxCase): Corrections are separate TaxCases, not edits to originals.
- **T-010** ([tentative-decisions.md § T-010](tentative-decisions.md#t-010)): Post-filing correction procedures are formalized here per s263(5)–(7) research.

**Owner Review Status**: Awaiting owner review. This preserves filing immutability and tracks correction lifecycle.

---

## 5. Source/Import Matrix

**File-First V1 Model** (no credential scraping or OTP automation in V1):

| Source | Supported Formats | Import Method | Hashing | Reconciliation | Status Tracking | Notes |
|--------|------|------|---------|---|---|---|
| **AIS** | PDF, JSON/CSV | Manual download from e-filing portal; user uploads via CLI | SHA-256 immutable | TIS values matched against BookSet income heads | UNKNOWN → INGESTED → RECONCILED/CONFLICT/INCOMPLETE → READY/STALE | Includes TIS; incomplete for self-assessed heads |
| **26AS** | PDF, Excel/CSV | Manual download from e-filing portal; user uploads via CLI | SHA-256 immutable | TDS/TCS matched against BookSet withholdings | UNKNOWN → INGESTED → RECONCILED/CONFLICT → READY/STALE | TDS/TCS-focused; not exhaustive for all income |
| **Broker CAS / e-CAS** | PDF, Excel (NSDL/CDSL standard formats) | Manual download from broker/depository; user uploads via CLI | SHA-256 immutable | Holdings quantity/cost basis matched against personal BookSet investment subledger | UNKNOWN → INGESTED → RECONCILED/CONFLICT → READY/STALE | Per holding; ISIN/account matching required |
| **Personal Bank Statement** | CSV/Excel per bank (ICICI, HDFC, Axis, etc. formats) | Manual export from bank portal; user uploads via CLI | SHA-256 immutable | Each deposit/withdrawal matched against personal BookSet bank subledger | UNKNOWN → INGESTED → RECONCILED/CONFLICT → READY/STALE | Bank-specific format parsing required |
| **Property Documents** | PDF (deed, rent agreement, property-tax receipt) | Manual upload by user | SHA-256 immutable | Metadata extracted (property ID, acquisition date, rent amount); linked to property subledger | UNKNOWN → INGESTED | Evidence only; no structured reconciliation |
| **EPFO Statement** | PDF (self-download from EPFO portal) | Manual download and upload by user | SHA-256 immutable | Contribution amounts matched against payroll/personal BookSet EPFO liability subledger | UNKNOWN → INGESTED → RECONCILED/CONFLICT → READY/STALE | No OTP automation; user downloads directly |
| **NPS Statement** | PDF (from NPS portal or PFRDA) | Manual download and upload by user | SHA-256 immutable | Contribution amounts and NAV matched against personal BookSet NPS subledger | UNKNOWN → INGESTED → RECONCILED/CONFLICT → READY/STALE | Tier-I/Tier-II distinction; holding period tracking |
| **Form 16** | PDF (issued by employer) | Manual upload by user (or future auto-receipt via email) | SHA-256 immutable | Part A (employee details, CTC) matched against salary subledger; Part B (salary breakup, TDS) matched against TDS reconciliation | UNKNOWN → INGESTED → RECONCILED/CONFLICT → READY/STALE | TDS per quarter; reconciliation per financial year |

**Not Supported in V1** (Deferred):
- Direct portal login with credentials (no password storage)
- OTP-based automation (user receives OTP, enters manually if needed for future AA integration)
- Browser automation or portal scraping
- Account Aggregator (AA) integration (future Phase, requires official AA partner agreement)

---

## 6. Readiness State Model

Source readiness progression is defined in **PT-010** above. States are:
- **UNKNOWN**: Not yet attempted
- **DECLARED_NOT_APPLICABLE**: User confirms not applicable
- **EXPECTED**: Expected but not yet imported
- **INGESTED**: Imported and parsed
- **RECONCILED**: Reconciled against BookSet; no conflicts
- **CONFLICT**: Imported; conflicts detected
- **INCOMPLETE**: Partial data; gaps identified
- **READY**: Fully reconciled; no conflicts or gaps; ready for return inclusion
- **STALE**: Outdated; new version available

**No Arbitrary Thresholds**: No "minimum amount" or "percentage match" blocking progression. Each conflict is resolved individually. Mandatory gaps prevent READY state only for the affected statutory action (e.g., missing proprietorship BookSet blocks return finalization, but CONFLICT in 26AS does not).

---

## 7. BookSet/TaxCase/CLI/Status Workflow

**Tenant-Wide Status Command**:
```bash
agent-bahi status [--tenant <tenant-id>]
```
Shows all BookSets and TaxCases; no `--book-set` required.

**Mutation Commands Fail Closed**:
- Invoice creation, transfers, imports require explicit `--book-set` if ambiguous
- TaxCase selection requires explicit period/sequence if multiple exist

**TaxCase Workflow**:
```bash
# Prepare return
agent-bahi tax-case create --fy 2025-26 --tenant sudhanshu-pan
agent-bahi import-ais --file ~/AIS.pdf --fy 2025-26 --tenant sudhanshu-pan
agent-bahi import-26as --file ~/26AS.xlsx --fy 2025-26 --tenant sudhanshu-pan
agent-bahi tax-case validate --fy 2025-26 --tenant sudhanshu-pan

# Review (returns DRAFT until filed)
agent-bahi tax-case review --fy 2025-26 --tenant sudhanshu-pan

# File
agent-bahi tax-case file --fy 2025-26 --output-format json --tenant sudhanshu-pan
# User downloads JSON; uploads to e-filing portal manually

# Record filing evidence
agent-bahi tax-case record-submission --fy 2025-26 --unique-id <portal-id> --submission-date 2026-07-01 --tenant sudhanshu-pan

# Corrections (if needed)
agent-bahi tax-case create-revision --fy 2025-26 --reason "Discovered dividend" --tenant sudhanshu-pan
agent-bahi tax-case file --fy 2025-26 --filing-sequence revised --output-format json --tenant sudhanshu-pan
```

---

## 8. Privacy/Security Guardrails

Defined in **PT-015** above. Summary:
- No telemetry by default
- Evidence/secrets protected (file permissions, redacted logs)
- Remote DB requires TLS
- Actor/resource context recorded
- Deployment classification (dev/stage/prod)
- No false compliance claims (DPDP, RBI, SEBI disclaimers required)

**Official Sources for Privacy/Security Policy**:
- [MeitY Digital Personal Data Protection Act (DPDP), 2023 and DPDP Rules](https://www.meity.gov.in/) — applicable to personal-data processing
- [CERT-In Directions s70B (28 Apr 2022)](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf) — applicable only for covered entities and triggering security incidents per s70B scope

---

## 9. Open Research and Dependency Order

**Open Research Items** (not blocking personal-tax discovery, but prerequisites for implementation/features):

1. **ITR Schema and Validation Rules** (AY 2026-27, 2027-28, etc.):
   - Official ITR-1, ITR-2, ITR-3, ITR-4 XML schemas and field validation rules per AY
   - Form eligibility criteria per taxpayer profile and income thresholds
   - Computed-field formulas per form (e.g., total income calculation, total deduction calculation)
   - Depends on: ITD Form Navigator release per AY (typically April each year)

2. **Finance Act 2026 and 2027 Amendments**:
   - New-law regime transition rules (Tax Year 2025-26 onwards)
   - Deduction limits, rate schedules, new sections
   - Depends on: Finance Act 2026/2027 official release and ITD circulars

3. **Account Aggregator (AA) Regulations and Partner List**:
   - RBI-regulated AA framework for data aggregation
   - AA partner agreements and technical integration API
   - Depends on: RBI AA regulations finalization and partner vetting (ongoing)

4. **Effective-Dated TDS/TCS Rule Packs** (per Act and AY):
   - Income-tax Act 1961 rule pack (for FY 2025-26 and earlier): Applicable TDS/TCS branches, rates, thresholds, exemption criteria, remittance forms per section per AY
   - Income-tax Act 2025 rule pack (for FY 2026-27 onward): Applicable TDS/TCS branches, rates, thresholds, exemption criteria, remittance forms per section per AY
   - Depends on: CBDT/ITD official TDS/TCS rule pack documentation per Act version and AY

5. **Property-Income Deduction Rules** (s24, s25, s36):
   - Home-loan interest deduction caps per regime
   - Rental income deductibility (s24(1), s25(1))
   - Depends on: Annual Finance Act amendments and ITD clarifications

6. **Capital Gains Holding Periods and Indexation Factors** (AY 2026-27):
   - LTCG (long-term capital gains) holding periods per asset class (stocks, real estate, others)
   - Indexation cost inflation factors per financial year
   - Depends on: Annual ITD notifications and RBI/CBDT circulars

**Dependency Order** (no implementation may begin until dependent research is closed):

- **Phase 1 (Setup & Accounting)**: No personal-tax research required; focus on core accounting engine
- **Phase 2 (Skills & CLI)**: Personal-tax skills remain deferred; GST skills prioritized
- **Phase 7 (Compliance)**: Personal-tax implementation gates on:
  - ITR Schema and Validation Rules (AY 2026-27 released by ITD)
  - Finance Act 2026 amendments finalized and official
  - TDS/TCS branches and rates documented per AY
- **Phase 8+ (Advanced)**: Account Aggregator integration gates on:
  - RBI AA framework finalization and partner agreements
  - AA technical integration API publicly available

**No Dates Claimed**: This packet does not claim specific dates for research closure or implementation phases. Owner reviews and approves gates; research closure is verified externally by ITD/RBI/Finance Act publications.

**Do Not Use Frappe/Zoho as Evidence** (for personal-tax specific rules):
- Frappe Books: Concept/behavior reference only; no individual-tax-specific rules sourced from Frappe
- Zoho Books: Reference for accounting workflow patterns; personal-tax form/rule specifics must come from ITD, not Zoho

---

## Summary and Next Steps

This discovery packet formalizes 16 core architectural and product decisions (PT-001 through PT-016) for Agent Bahi's personal-tax expansion. All entries are **TENTATIVE - NOT OWNER-APPROVED** and include explicit reversal paths and owner-review status.

**Next Steps**:
1. Sudhanshu reviews this packet and each PT entry
2. Sudhanshu approves, rejects, or modifies each decision
3. Approved decisions become SETTLED_OWNER_DECISION (documented in [decisions.md](decisions.md) or a new personal-tax decision memo)
4. Implementation gates on approved PT entries and closure of open-research items
5. Minimal cross-link updates are made to [tentative-decisions.md](tentative-decisions.md), [owner-review-docket.md](owner-review-docket.md), and README

---

## Document Metadata

- **Created**: 2026-08-21
- **Status**: Discovery documentation; awaiting owner review
- **Applies to**: Sole-proprietor personal-tax expansion scope only
- **Related Documents**:
  - [Decisions](decisions.md) (confirmed decisions; personal-tax decisions added pending owner approval)
  - [Tentative Decisions and Overnight Protocol](tentative-decisions.md) (PT-001–PT-016 index cross-linked)
  - [Owner Review Docket](owner-review-docket.md) (Personal Tax section added)
  - [Architecture Decisions](architecture-decisions.md) (RECOMMENDED entries; PT entries are more specific)
  - [Annual Income-Tax Compliance Matrix](annual-income-tax-compliance-matrix.md) (baseline research; TDS/TCS/form rules)
  - [Statutory Workflow Contracts](statutory-workflow-contracts.md) (return filing, TDS, corrections)
  - [Tentative Decisions § T-007, T-009, T-010](tentative-decisions.md) (advance tax, Form 140/141, post-filing corrections)
