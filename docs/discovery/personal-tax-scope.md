# Personal Tax Discovery Packet

**Status banner:** PT-001, PT-002, PT-003, PT-004, PT-006, PT-008, PT-009, PT-011, PT-012, PT-013, and PT-015 are **OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. PT-005, PT-007, PT-010, PT-014, and PT-016 remain **TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. This is discovery documentation only. It is not implementation authority.

Sudhanshu's explicit owner approvals of PT-001, PT-002, PT-003, PT-004, PT-006, PT-008, PT-009, PT-011, PT-012, PT-013, and PT-015 are recorded, but architect review, the documented Gate-0/readiness safeguards, and a coordinated canonical migration remain required. No implementation follows from any owner approval alone.

## 1. Verdict and scope

Complete personal and sole-proprietor individual income-tax workflow is in product scope. One return/tax case for the taxpayer aggregates applicable sources from the personal BookSet, every applicable sole-proprietorship BookSet, and external evidence. Books remain separate by BookSet.

No implementation may begin until the owner and architect review this packet, the affected canonical contracts, and the migration plan. This packet does not approve a data-model change, a legal interpretation, a filing route, or a portal integration.

**Related RFC**: The physical-schema RFC for personal-tax support is documented separately in [personal-tax-physical-schema.md](personal-tax-physical-schema.md). That RFC records a tentative dialect-neutral relational contract, ownership rules, transaction gates, and Gate0 proof obligations. It is also TENTATIVE and requires architect review.

The packet covers an individual taxpayer and one or more sole proprietorships. Company entities remain separate. Other legal forms require their own reviewed scope.

Time limits live outside this packet. The owner parked time-limit and deadline research; this document does not enumerate it.

## 2. Verified official baseline

The following are the safe baseline facts used by this discovery packet. They are deliberately narrower than the law. Detailed legal choices must load from immutable, effective-dated official rule and schema snapshots.

### Taxpayer, period, and form boundary

- One PAN/taxpayer filing aggregates the applicable income heads, including proprietorship business income. The same individual does not file separate personal and proprietorship returns for the same period.
- Year, form, and schema selection are year-specific. A prior-year selection is not a current-year authority.
- FY 2025-26 is **1 Apr 2025 to 31 Mar 2026**, with AY 2026-27, governed by the Income-tax Act 1961.
- The Income-tax Act 2025 applies from **1 Apr 2026** for Tax Year 2026-27. The transition boundary is an input to the effective snapshot, not a reason to copy rules between periods.
- For AY 2026-27, business or profession income excludes ITR-1 and ITR-2. ITR-4 is available only when the official presumptive-return eligibility predicates are satisfied; otherwise ITR-3 is the applicable business or profession branch. Later years use their own official pack.
- Structural schema validation is not legal correctness. A structurally valid export can still be legally wrong when the taxpayer facts, effective rule pack, or evidence are wrong.

### Information statements and filing evidence

- AIS is non-exhaustive information available to the department. AIS may contain securities or SFT information and other reported information that needs reconciliation with the books.
- TIS is a category-wise summary within AIS. It is evidence to reconcile, not tax computation.
- 26AS is non-exhaustive, TDS/TCS-focused evidence. It may include salary withholding, but it is not a complete income or return record.
- Filing evidence is filing-specific: acknowledgement, verification or ITR-V evidence, status evidence, intimation, and defect evidence where applicable. There is no universal ARN rule and this packet makes no timing claim.

### Acquisition and authority boundary

- V1 is file-first. A user or authorised operator obtains the artifact and imports it; the product does not scrape personal portals or store portal credentials.
- Account Aggregator is future-only through a registered RBI Account Aggregator ecosystem and consent flow. Agent Bahi's exact role is **OPEN** until regulatory and partner research is complete.
- No Zoho or Frappe claim is used as individual-tax legal authority. Vendor materials may not fill an evidence gap.
- Every legal choice loads from an immutable, effective-dated official rule or schema snapshot. Missing, stale, conflicting, or unapproved authority yields review or block.

## 3. Current-product interplay

The current canonical product contract is one legal entity per tenant and one balanced book. See [confirmed decisions](decisions.md#confirmed) and the existing [data-model requirements](data-model-requirements.md).

PT-001 extends that contract for an individual taxpayer: one individual/PAN tenant may contain a personal BookSet and multiple independently balanced sole-proprietorship BookSets. Companies remain separate tenants. This is a breaking data-model contract change. Owner approval is recorded, but architect review, the documented Gate-0/readiness safeguards, and a coordinated canonical migration remain required.

This is not a relaxation across legal persons. Cross-tenant posting remains prohibited. The extension is a controlled grouping of books belonging to one individual legal person so the one PAN return can aggregate them without merging their ledgers.

Existing ledger invariants remain in force unless a separately approved contract says otherwise:

- posted records remain immutable and corrections use linked reversal and replacement;
- every BookSet balances independently;
- evidence is preserved rather than silently overwritten;
- GST work remains attached to the applicable business BookSet and GSTIN;
- engine-owned rules and gates are separate from skill orchestration.

## 4. Personal Tax decisions PT-001 through PT-016

PT-001, PT-002, PT-003, PT-004, PT-006, PT-008, PT-009, PT-011, PT-012, PT-013, and PT-015 have the exact status **OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. PT-005, PT-007, PT-010, PT-014, and PT-016 each have the exact status **TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED**. The entries are discovery constraints, not implementation authority.

<a id="pt-001"></a>
### PT-001: Individual/PAN tenant and BookSets

**Status:** OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision:** One individual/PAN tenant may contain exactly one personal BookSet for its entire lifetime and one or more sole-proprietorship BookSets. Companies stay in separate tenants.

**Boundary:** The PAN identifies the individual taxpayer and is globally unique across PAN tenants. Duplicate tenant creation for the same PAN fails, so one taxpayer cannot be split across tenants or returns. A business name, GSTIN, bank account, or source label does not create a second personal return. Each BookSet keeps its own ledger and scope.

**Why:** Sole-proprietorship income is part of the proprietor's individual return. Separate personal and proprietorship returns would create an omission path.

**Contract impact:** This breaks the current one-legal-entity-per-tenant data model. Owner approval is recorded, but architect review, the documented Gate-0/readiness safeguards, and a coordinated canonical migration are prerequisites. No implementation follows from this entry alone.

**Failure mode:** A new business BookSet is created in a separate tenant and the TaxCase silently omits it.

**Open choice:** The exact tenant migration and legal-person identity model remain owner and architect decisions.

#### Apprentice debate record

Two moderated rounds compared these models:

- **A — recommended default:** one individual/PAN tenant with independent personal and sole-proprietorship BookSets.
- **B:** separate personal and business bookkeeping tenants aggregated by a PAN/TaxCase authority.
- **C:** separate business tenants plus a non-posting personal tax workspace.

The outcome remains **A**. Sole proprietorship and individual are the same legal person/PAN for this boundary; companies remain separate legal-entity tenants. A preserves the no-cross-tenant product-query/write rule, while B needs a privileged cross-tenant aggregation exception.

Personal banks, investments, property, and loans require canonical balances and reconciliation. C therefore either creates a second accounting engine or collapses into A/B. Same-tenant BookSets allow balanced atomic personal/business settlement; B requires two independently successful postings. TaxCase can enumerate all BookSets inside the PAN tenant, mark itself `STALE` when membership changes, and block omissions.

Honest losing arguments:

- A is a pervasive breaking data-model change: `book_set_id` scope, queries, indexes, uniqueness, fixtures, and migrations.
- Separate tenants provide a harder future access boundary and simpler single-book mutations.

Mandatory safeguards before A is implementation-ready:

- Thread BookSet-level actor/resource authorization context from day one; a CA granted one business BookSet cannot read the personal BookSet by default.
- Every BookSet-owned row carries `tenant_id` plus `book_set_id`, and each BookSet independently balances.
- BookSet-scoped mutations fail with `AMBIGUOUS_BOOKSET` when not explicit; tenant-wide status/TaxCase aggregation is read-only and separately authorized.
- The TaxCase source/BookSet catalog cannot be empty or `UNKNOWN`; exactly one personal BookSet exists across the tenant lifetime, including archived state, and replacement/migration preserves that identity.
- Gate-0 scenarios must prove personal-paid business expense, drawing/loan transfer, new BookSet mid-year staleness, and business-only CA access cannot read personal data.

Reversal trigger: if Gate 0 cannot prove fail-closed BookSet authorization/isolation, or migration would require weakening canonical ledger invariants, reopen B with an explicit PAN registry and read-only snapshot authority.

This apprentice debate is evidence, not architect review or implementation authority.
It changes no other PT decision, legal rule, source, or index file.

<a id="pt-002"></a>
### PT-002: BookSet-owned records and independent balance

**Status:** OWNER-APPROVED; NOT ARCHITECT-REVIEWED

Sudhanshu's owner approval is recorded for this clarified model. Architect review, the physical-schema RFC review, and the existing Gate-0/readiness safeguards remain outstanding.

**Decision:** A BookSet is one independently balanced books/business boundary, not a bank account. Every posted accounting record belongs to exactly one BookSet and carries `tenant_id` and `book_set_id`.

**Boundary:** A company tenant normally has one BookSet even when it has multiple bank, cash, or card accounts. An individual/PAN tenant may have one personal BookSet plus separate sole-proprietorship BookSets. Accounts, postings, invoices, bills, payments, assets, subledgers, evidence links, and reconciliations are BookSet-owned. Raw imported lines are not posted accounting records and may remain unassigned until explicitly classified. Cross-BookSet views are explicit aggregations, not hidden shared balances.

Cross-BookSet movement is represented by linked entries rather than duplicated balances. One-BookSet commands resolve that BookSet automatically; when a write is ambiguous across multiple BookSets, it fails closed unless the operator supplies explicit, visible BookSet context as documented by PT-014. The atomic transfer mechanics remain separately specified in PT-003 and are not approved by this entry.

All existing tenant-wide identifier uniqueness remains in force until separately revised. Adding BookSets does not silently narrow uniqueness to a BookSet.

Account codes remain tenant-wide unique, immutable, and never reused, while account ownership, parent references, and BookSet defaults remain bound to the same BookSet.

**Failure mode:** A bank, cash, or card account is mistaken for a BookSet, a raw imported line is posted before classification, or a personal record is treated as business data because a report merged two books without an explicit scope.

**Open choice:** Physical schema, migration ordering, and the precise list of BookSet-owned aggregates require the reviewed schema RFC.

<a id="pt-003"></a>
### PT-003: Atomic same-tenant inter-BookSet transfer with balanced linked legs

**Status:** OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision:** A same-tenant transfer between two BookSets is represented by exactly two balanced, linked, independently reconciled accounting entries/legs—one in each affected BookSet. Both legs carry an identical purpose classification selected once at the shared event level. Each leg's ledger accounts are derived deterministically from that shared purpose. The transfer wrapper never suppresses the underlying supply, sale, loan, drawing, expense, or tax fact.

**Supported purposes:** Capital introduced/withdrawal, proprietor/owner loan (business to personal or personal to business), due-to-owner/due-from-business, drawings, proprietor reimbursement, or other equivalent accounting terminology reflecting the real economic relationship. Use precise accounting wording, not an exhaustive closed enum. An ambiguous purpose fails closed; an agent may propose a classification, but posting requires explicit human confirmation under the existing evidence/confirmation policy.

**Boundary:** The engine records source BookSet, destination BookSet, shared purpose, evidence, and the two linked legs in one atomic transaction. Each leg posts to the same BookSet and independently balances. A transfer is not an eraser for the underlying transaction; if it is actually a supply, sale, loan, drawing, or expense, those facts must be represented explicitly in the accounting entries.

**Atomic commitment and idempotency:** Both linked entries commit or fail together. They preserve an immutable audit link and idempotency guarantee so that a duplicate or interrupted submission does not post two independent sets of legs.

**Failure mode:** A personal-to-business movement is posted only on one side, or a drawing is relabelled as a neutral transfer and disappears from a TaxCase, or the underlying economic fact is suppressed by a transfer wrapper.

**Control:** The operation fails closed when either BookSet, the transfer purpose, the evidence binding, or form selection is ambiguous.

**Example 1—Personal bank to business current account:** A proprietor moves ₹100,000 personal savings to the business current account for working capital.
- Personal leg: `Dr due-from-business-investment / Cr personal-bank ₹100k`
- Business leg: `Dr business-bank / Cr owner-capital-introduced ₹100k`
- Purpose: `capital-introduced` (shared across both legs)
- Both legs in one atomic transaction; both BookSets reconcile; the proprietor's personal bank decreases and the investment commitment increases; the business bank increases and the capital obligation increases.

**Example 2—Personal bank directly pays a business expense:** A proprietor uses their personal SBI account to pay a software bill of ₹23,600, comprising a ₹20,000 base amount plus ₹3,600 GST, on behalf of the consulting business.
- Purpose: `due-to/due-from-proprietor` (shared across both legs; not capital)
- Personal BookSet leg: `Dr amount-due-from-business ₹23,600 / Cr personal-SBI-bank ₹23,600`
- Business BookSet leg: `Dr software-expense ₹20,000 / Dr input-GST ₹3,600` only where eligibility is separately established under the existing rules; otherwise use the appropriate non-creditable tax/expense treatment without guessing, and `Cr amount-due-to-proprietor ₹23,600`.
- This is one atomic transaction with the same shared gross amount of ₹23,600 across the linked legs. There is no fictional receipt into the business bank and no second ₹23,600 cash settlement in this event.
- If the business later reimburses the proprietor, that is a separate linked event: business `Dr amount-due-to-proprietor ₹23,600 / Cr business-bank ₹23,600`; personal `Dr personal-SBI-bank ₹23,600 / Cr amount-due-from-business ₹23,600`. It reduces the mirrored due-to/due-from balances and moves ₹23,600 from business bank to personal bank; it is not part of the original direct-payment event.

**Consolidated personal-tax reporting:** The same shared gross amount is one economic event across the linked personal and business legs. When a TaxCase aggregates both BookSets for annual income-tax filing, it must not double-count the ₹23,600 personal outflow and the business software expense as two unrelated expenses; the due-to/due-from mirror and any later reimbursement are linked movements, not additional expense or income.

**Open choice:** Exact ledger-account vocabulary, UI/CLI shape, and form-eligibility proof await the canonical migration and architecture review.

<a id="pt-004"></a>
### PT-004: Personal bank, investment, property, rent, and loan subledgers

**Status:** OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Approved Decision:** The personal BookSet supports bank, investment and tax-lot, property and rent, and loan subledgers with structured factual records and reconciliation, preserving provenance and real-world facts. Tax treatment is derived later from versioned rule snapshots, not embedded in subledger structure.

**Boundary:** Personal subledgers preserve structured factual records for real-world accounting facts:
- **Bank:** account nature, ownership, and reconciliation/evidence provenance
- **Investment:** instrument type, acquisition/disposal lots and dates, quantity/cost, broker/demat/source evidence
- **Property:** identity, ownership, and effective-dated actual use (self-used, rented, or business-used; not treated as immutable lifetime category)
- **Loan:** lender, secured/unsecured fact, stated purpose, linked collateral/property, rate/schedule, evidence
- **Rent:** property/party linkage, agreement/effective dates, gross receipts/payments and source evidence

Holding rules are asset-class and effective-date driven. Acquisition, disposal, income, financing, ownership, and evidence records remain distinct. Interest treatment follows the use of borrowed funds and the applicable rule snapshot, never the lender label.

No static tax rule is embedded here. Subledgers preserve facts and evidence without asserting deductibility, exemption, section eligibility, long-term/short-term, or allowed/disallowed status. Tax treatment is derived for the relevant tax year from preserved facts plus versioned applicable rule snapshots. If required facts or evidence are missing, readiness fails closed or remains unresolved; the system must not guess.

**Failure mode:** A loan product name is used as a shortcut for tax treatment, a broker statement overwrites the investment ledger, property use is treated as immutable, or tax classification is embedded in the subledger structure instead of derived from rule snapshots.

**Implementation boundary:** Schema granularity is a product/data-model choice; the government does not mandate this hierarchy. Keep user-extensible labels/tags possible without allowing them to override canonical factual fields or statutory classification. Preserve effective-dated property/use and investment-lot facts to avoid silent historical overwrite. Preserve prior PT-001, PT-002, PT-003, and PT-009 semantics and all existing evidence/human-confirmation boundaries.

<a id="pt-005"></a>
### PT-005: One non-posting TaxCase per taxpayer, period, and filing sequence

**Status:** TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision:** Create one **NON-POSTING** TaxCase per taxpayer, year, and filing sequence. It automatically includes every applicable BookSet and external source.

**Boundary:** A TaxCase is a preparation, evidence, validation, export, and filing-lineage object. It does not replace or merge the underlying books. Applicable BookSets and sources must be enumerated; omission is an error, never a default.

**Failure mode:** A TaxCase is built from only the currently selected BookSet, producing a complete-looking but incomplete return.

**Control:** TaxCase creation stores the immutable taxpayer, period, filing sequence, BookSet set, external-source set, and snapshot bindings. A missing applicable source stays visible and blocks the affected action.

The TaxCase membership snapshot is one sealed normalized set created at case creation. No insert, update, or delete is allowed on the old case's membership after creation. Before `validate`, `export`, `submit`, or `finalize`, applicability is deterministically checked against current taxpayer facts, applicable BookSets, tax heads, the governing rule snapshot, and the selected official schema. If an applicable BookSet or required external source was added, removed, or changed since the snapshot, the old TaxCase is marked `STALE` and a successor with a new complete membership set is created; the old snapshot remains unchanged and all affected actions stay blocked until that successor is ready.

**Open choice:** Exact TaxCase persistence and inclusion-query shape require the canonical contract migration.

<a id="pt-006"></a>
### PT-006: Year-specific, fact-driven form selection

**Status:** OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision:** The form is selected from official year-specific eligibility predicates and frozen taxpayer facts. Income-tax return form selection is deterministic from complete taxpayer facts plus the official year/period-specific eligibility rule snapshot. Prior-year form is not authority; user/agent preference cannot override statutory eligibility. Missing/conflicting facts or rule bindings produce REVIEW/BLOCK.

**AY 2026-27 baseline:** Where business or profession income exists, ITR-1 and ITR-2 are excluded. ITR-4 is selected only if the official presumptive-return predicates are satisfied; otherwise ITR-3 is selected.

There is no generic form priority order, threshold shortcut, business-assets shortcut, or assumption that every proprietor uses one form. There are no separate personal and proprietorship returns for the same individual.

**Failure mode:** A prior form or a structural schema match is treated as proof of legal eligibility.

**Control:** Selection records the evaluated facts, official predicate identifiers, source snapshot, and unresolved branches. Unresolved eligibility returns REVIEW/BLOCK.

**Note:** PT-007 AuthorityPack sourcing/binding remains unresolved and does not prevent owner approval of this semantic rule.

<a id="pt-007"></a>
### PT-007: Bind period, trigger, and four independent official bindings

**Status:** TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision:** Every TaxCase binds the period and trigger facts plus four independent official bindings atomically and immutably:

1. governing Act determined from the normalized income period;
2. period;
3. filing trigger;
4. effective-dated compatible rule snapshot;
5. four independent official bindings: schema, validation rules, utility, and instructions. Each binding is immutable, source-bound, hashed, effective-dated, and compatible with the period, Act, and selected form.

The FY 2025-26 case binds the Income-tax Act 1961 and AY 2026-27 context. The Tax Year 2026-27 case binds the Income-tax Act 2025 from the 1 Apr 2026 boundary. The binding is exact; a rule from one period cannot leak into another.

**Failure mode:** A form validates under one release while the TaxCase silently uses a different Act, rule, validator, utility, or instruction release.

**Control:** All four official bindings and the compatible rule snapshot are mandatory before validation or export. Any missing, stale, conflicting, unapproved, source-unbound, or incompatible binding returns REVIEW/BLOCK. Schema validation alone never marks a TaxCase legally correct.

<a id="pt-008"></a>
### PT-008: Preserve AIS, TIS, and 26AS artifacts

**Status:** OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision:** Preserve raw AIS, including its TIS values, and raw 26AS as immutable, hashed evidence. Reconcile without overwrite. Preserve raw AIS/TIS/26AS and related government artifacts immutably with hashes/provenance. Reconcile them against books/bank/broker evidence without overwriting either side or auto-declaring a winner. Record explicit reconciliation outcomes; unresolved conflict remains visible.

AIS is non-exhaustive and may contain securities or SFT data. TIS is a category-wise AIS summary, not tax computation. 26AS is non-exhaustive TDS/TCS-focused evidence and may include salary withholding.

The books remain the canonical accounting records. A difference produces a linked reconciliation result, not an automatic replacement of either artifact or book record. A required conflict cannot become READY.

**Failure mode:** Imported AIS or 26AS values are mistaken for the complete return and self-assessed income is omitted.

**Control:** Keep artifact hash, parser version, source period, identity, raw bytes, derived records, reconciliation outcome, and reviewer evidence.

**Note:** Do not decide PT-010 READY tolerance here.

<a id="pt-009"></a>
### PT-009: Hashed file-first acquisition; future AA only

**Status:** OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Approved V1 boundary:** V1 is file-first. Users download supported bank, broker, mutual-fund, AIS/26AS, and other artifacts; Agent Bahi imports them, verifies provenance and hash, reconciles them, and reports gaps. It does not store credentials, scrape portals, automate OTP, or automate browsers.

Live Account Aggregator or partner connections are future and not a V1 dependency. Future AA access may exist only through a registered RBI AA ecosystem and consent flow. The Agent Bahi role, permissions, data path, and partner are **OPEN** until regulatory and partner research. Do not invent a direct AA token flow or claim a regulated intermediary role.

**Failure mode:** A parser or portal helper silently becomes a credentialed collection channel.

**Control:** Raw file and derived records are linked by content hash and parser release. Re-import creates a new evidence version or an explicit duplicate outcome; it never mutates the original.

<a id="pt-010"></a>
### PT-010: Nine-state source readiness

**Status:** TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision:** Source readiness uses exactly these states: `UNKNOWN`, `DECLARED_NOT_APPLICABLE`, `EXPECTED`, `INGESTED`, `RECONCILED`, `CONFLICT`, `INCOMPLETE`, `READY`, `STALE`.

Before readiness evaluation, the complete required source catalog is deterministically enumerated from taxpayer facts, applicable BookSets, tax heads, the governing rule snapshot, and the selected official schema. The catalog must be non-empty and complete. Every required catalog entry must be either `RECONCILED` or `READY`, or have evidenced `DECLARED_NOT_APPLICABLE` status. Any required `UNKNOWN`, `EXPECTED`, `INGESTED`, `CONFLICT`, `INCOMPLETE`, or `STALE` entry returns `REVIEW/BLOCK` for the affected action.

`RECONCILED -> READY` is allowed only for a complete, non-empty catalog when every required entry is reconciled or ready, any not-applicable entry is evidenced, no required conflict, incomplete, or stale state exists, and deterministic validations pass. An empty or not-yet-enumerated catalog can never pass `READY`.

Required unresolved states block only the affected computation, export, or filing action. They do not block unrelated BookSet work. Optional unresolved sources remain visible and do not silently disappear.

User or CA acknowledgement can provide review evidence, but it cannot relabel a mandatory gap as READY.

**Failure mode:** A missing artifact is treated as optional because a user acknowledged the checklist, or an optional source is hidden because it is unresolved.

<a id="pt-011"></a>
### PT-011: GST output follows business BookSet and GSTIN

**Status:** OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision:** GST output belongs to an applicable business BookSet and GSTIN. Preserve the repaired PT-003-aligned mechanics at current HEAD: payment source never decides economic owner/GST. Personal-bank-paid business bill uses linked due-from/due-to or separately human-confirmed capital purpose; business BookSet owns expense and any eligible GST only under correct GSTIN/period/evidence/rules; no fictional business-bank receipt, reversal, duplicate settlement, cash, expense, or GST. Later reimbursement is separate linked event.

A personal source location or personal label alone never decides treatment. Payment-source account/label (e.g., personal SBI bank) never decides economic owner or GST treatment. GST ownership, output, input-credit analysis is bound only to the explicit business BookSet + GSTIN + period + evidence/rule snapshot. Personal BookSet retains funding/settlement facts but never owns GST solely because its bank paid.

For a personal bank directly paying a business expense (e.g., proprietor's SBI account paying a ₹23,600 software bill), the correct mechanics follow PT-003 Example 2:

- **Personal BookSet leg:** `Dr amount-due-from-business ₹23,600 / Cr personal-SBI-bank ₹23,600`.
- **Business BookSet leg:** `Dr software-expense (base amount) / Dr eligible-input-GST` (only where eligibility is separately established under the existing rules; otherwise use the appropriate non-creditable tax/expense treatment), `Cr amount-due-to-proprietor ₹23,600` (gross amount matching the personal leg).
- **Event structure:** One atomic transaction with the same shared gross amount across both linked legs. There is no fictional receipt into the business bank and no second ₹23,600 cash settlement in this event.
- **Later reimbursement:** If the business later reimburses the proprietor, that is a separate linked event (business `Dr amount-due-to-proprietor / Cr business-bank`; personal `Dr personal-bank / Cr amount-due-from-business`), not part of the original direct-payment event.

Each leg is linked, each BookSet balances, and there is no double cash/expense/GST counting. An ambiguous economic owner, business GSTIN, or GST eligibility fails closed.

<a id="pt-012"></a>
### PT-012: Effective-dated TDS, TCS, and remittance gate

**Status:** OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision:** TDS/TCS/remittance selection uses effective-dated transaction date, payer/collector role, payee facts, transaction nature, and official rule snapshot. Vendor labels/current generic rates/manual guesses are not authority. Missing/stale/conflicting statutory facts/rules/evidence fail closed. Exact rates/thresholds/forms/dates remain sourced official facts, not owner-configurable policy.

TDS, TCS, and remittance handling is selected by effective-dated role and transaction facts. FY 2025-26 uses the Income-tax Act 1961 rule pack. Tax Year 2026-27 uses the Income-tax Act 2025 rule pack.

No branch example, form example, section, rate, threshold, or due date is embedded here. The applicable branch must be loaded from the frozen source pack in [tds-tcs-compliance-matrix.md](tds-tcs-compliance-matrix.md).

Missing mandatory rule or evidence returns REVIEW/BLOCK. A ledger label, vendor label, or BookSet label cannot substitute for the role and transaction facts.

<a id=”pt-013”></a>
### PT-013: Filing-specific states and evidence (Issue #1)

**Status:** OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision (Issue #1):** Local lifecycle (prepared/validated/exported) is separate from portal/government status. Export never implies upload/submission/verification/processing. A government status such as submitted is recorded only by an explicit action and bound filing-specific receipt/acknowledgement/evidence; preserve exact raw label/evidence and do not infer later states from elapsed time. Every export creates an immutable activity/audit event. Configurable automation may create a reminder/activity asking whether it was submitted. User may dismiss/remind later; dismissal never means submitted and does not delete audit history.

Separate internal filing lifecycle from external portal status/evidence. Internal lifecycle states: `prepared`, `exported`, `unknown` (never confuse with government/portal states). External portal status uses exactly these five normalized labels: `submitted`, `verified`, `processed`, `defective`, `case_transferred_to_assessing_officer`. They correspond to the exact raw labels in the current [ITD ITR Status FAQ](https://www.incometax.gov.in/iec/foportal/help/e-filing-know-itr-status-faq), which must be retained with filing-specific bound evidence.

The normalized-to-raw mapping is fixed by that source: `submitted` → “Submitted and pending for e-Verification / Verification”; `verified` → “Successfully e-Verified / Verified”; `processed` → “Processed”; `defective` → “Defective”; `case_transferred_to_assessing_officer` → “Case transferred to Assessing Officer”.

Record filing-specific acknowledgement, verification or ITR-V evidence, the exact raw official status label, portal status, intimation, and defect evidence where present. There is no universal ARN. An e-TDS delay is not a product state. If a defective return is treated as invalid after the notice path, record that as a separate derived legal consequence/internal condition only with defect or notice evidence; it is never a portal status. Form 16A is not return-processing evidence (only TDS evidence, never portal status). Do not claim a physical ITR-V upload route without source evidence.

The product records evidence supplied by the taxpayer or CA; it does not infer a later portal state from elapsed time or from a local export. Internal states (prepared, exported) are never mistaken for external government status.

**Failure mode:** A prepared export is reported as filed, an acknowledgement is reported as processed without filing-specific status evidence, an invalid legal consequence is stored as a portal status, or Form 16A is classified as portal status instead of TDS evidence.

**Note:** Exact FilingSnapshot/ExportRun object split remains part of unresolved PT-005 refinement; do not pre-approve it here.

<a id="pt-014"></a>
### PT-014: Tenant-wide read-only status and explicit mutation scope

**Status:** TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Note:** PT-014 remains **TENTATIVE - NOT OWNER-APPROVED** and gates only
BookSet/TaxCase-specific behavior. The global company health status command is
separately defined and owner-approved in [CLI-008](accounting-contracts.md#cli-008)
(non-approval cross-reference only; this PT entry does not change CLI-008's
status or scope).

**Decision:** `agent-bahi status` in the personal-tax context is tenant-wide and read-only. It shows BookSets and TaxCases separately. It does not require `--book-set`.

Every mutation, reconciliation, import, and correction requires an explicit BookSet when more than one eligible BookSet exists. Every TaxCase mutation requires immutable `--tax-case tc_...`, or FY plus filing sequence only when that pair is unambiguous.

Ambiguity returns `AMBIGUOUS_BOOKSET` or `AMBIGUOUS_TAXCASE`; the command does not guess. A read-only overview cannot authorize a mutation.

<a id="pt-015"></a>
### PT-015: Privacy and security boundary

**Status:** OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision (baseline, optional future privacy mode deferred):** Default local/file-first; explicitly configured remote DB remains allowed but is intentional. Raw PAN, credentials, secrets, personal documents, or sensitive financial payloads must not appear in product analytics telemetry or ordinary logs. Preserve necessary security/audit logs using IDs/hashes/redacted metadata. Authorized local CLI may show full data; an optional UI/output masking "privacy mode" is future roadmap, not V1 implementation and not a reason to weaken baseline logging/telemetry controls. Network/cloud/external-agent sharing requires explicit configuration/opt-in and auditability. Do not claim DPDP/CERT-In or other legal compliance absent deployment-specific research.

Product analytics telemetry is off by default for personal-tax data. Required protected audit and security logs remain. Evidence and secrets are protected, remote database connections use TLS, logs are redacted, and actor/resource scope plus deployment and purpose classification are recorded.

The boundary is evidence protection, not a blanket privacy or compliance claim. The [DPDP Act](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf) and official [DPDP Rules page](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa) are sources for personal-data research. CERT-In Directions under section 70B are cited only for duties that apply to a covered entity, security incident, log, or reporting condition; they do not establish a universal product compliance claim.

There is no blanket local-SQLite exemption, India-only claim, automatic Significant Data Fiduciary claim, invented RBI framework, or universal ISO prerequisite. The deployment and processing facts must be assessed for the actual environment.

**Failure mode:** Redacted operational logs still expose raw evidence, or a product disclaimer is mistaken for a legal determination.

<a id="pt-016"></a>
### PT-016: Immutable original and linked successor TaxCases

**Status:** TENTATIVE - NOT OWNER-APPROVED; NOT ARCHITECT-REVIEWED

**Decision:** Preserve the immutable original TaxCase and create linked successor TaxCases for a revised, updated, rectification, defect-response, or other verified mechanism.

The mechanism selection remains **OPEN**. The successor returns REVIEW/BLOCK until the year-specific branch, eligibility, portal route, schema, and evidence requirements are researched and owner-approved. The product does not select a mechanism automatically from a date, user preference, or generic label.

**Failure mode:** A filed case is edited in place, or a correction route is inferred without verifying the governing period and portal route.

**Control:** Store original-case linkage, trigger evidence, selected mechanism after approval, immutable source snapshots, and the successor's independent filing state.

## 5. Source and import matrix

All sources are evidence inputs, not automatic postings. No source is exhaustive. Every raw artifact is hashed and immutable; every parser is versioned; source period and account or identity are recorded; derived records point back to the raw artifact; reconciliation and readiness are explicit.

| Source | Accepted artifact examples | Required provenance | Derived records and reconciliation |
|---|---|---|---|
| Bank CSV/PDF | User-exported statement | account identity, source period, file hash, parser release | transactions and balances matched to the BookSet bank subledger; unresolved matches remain visible |
| AIS JSON/CSV/PDF, including TIS data | Raw AIS artifact and parser output | taxpayer identity, source period, file hash, parser release | reported categories, securities/SFT information, and TIS categories reconciled without overwrite |
| 26AS PDF/text/spreadsheet | Raw 26AS artifact | taxpayer identity, source period, file hash, parser release | TDS/TCS evidence reconciled to withholding and collection records |
| Form 16A | Raw non-salary TDS certificate/artifact | taxpayer identity, deductor identity, relevant period, content hash, parser release | non-salary TDS evidence reconciled to the applicable TDS records; it never changes portal status |
| Broker ledgers/contract notes | User-exported broker artifacts | account identity, instrument identity, source period, file hash | transactions and tax-lot facts reconciled to investment subledger |
| CAS/e-CAS | Depository or broker statement | account identity, statement period, file hash | holdings and transaction evidence reconciled to investment records |
| Property/rent/loan | User-supplied agreements, statements, and schedules | property or loan identity, relevant period, file hash | ownership, rent, financing, and payment facts linked to property or loan subledger |
| EPFO/NPS | User-supplied statement | account identity, source period, file hash | contribution and holding evidence reconciled to the applicable BookSet |

No row silently posts. An import may propose derived records, but posting, correction, and reconciliation use the explicit BookSet and TaxCase controls.

### Import invariants

The matrix has the same minimum control for every source:

- the raw artifact is retained before parsing;
- the content hash is immutable and can be used to find the exact input;
- parser name and release are recorded with the derived output;
- source period and account, taxpayer, instrument, property, or loan identity are explicit;
- a parser warning is not a reconciliation success;
- a duplicate artifact is visible and linked, not silently discarded;
- derived records retain a raw-artifact pointer;
- a failed parse remains an evidence record with an actionable error;
- no parser may infer a legal classification from a filename;
- no import may select a BookSet by account-name similarity;
- no import may select a TaxCase by most-recent-created ordering;
- an operator may correct a proposed mapping only through a recorded mutation;
- a correction creates a successor record and preserves the earlier result;
- evidence access is authorized independently from ledger posting;
- source absence is represented by a readiness state;
- the affected action is the smallest blocked unit.

These controls protect against the silent failure in which a plausible parser result is accepted as a complete and legally correct return input.

## 6. State transitions and blocking semantics

| State | Meaning | Allowed next outcome |
|---|---|---|
| `UNKNOWN` | No source attempt or evidence is recorded | `EXPECTED`, `DECLARED_NOT_APPLICABLE`, or `INGESTED` |
| `DECLARED_NOT_APPLICABLE` | Applicability is recorded with actor and evidence | `EXPECTED` if facts change, or remain visible |
| `EXPECTED` | Required or selected source is expected but not present | `INGESTED`, `DECLARED_NOT_APPLICABLE`, or `INCOMPLETE` |
| `INGESTED` | Raw artifact is stored and parsed | `RECONCILED`, `CONFLICT`, `INCOMPLETE`, or `STALE` |
| `RECONCILED` | Artifact and derived records reconcile for its scope | `READY`, `CONFLICT`, `INCOMPLETE`, or `STALE` |
| `CONFLICT` | Evidence and books or another source disagree | `RECONCILED`, `INCOMPLETE`, or `STALE` |
| `INCOMPLETE` | Artifact or required facts are partial | `RECONCILED`, `CONFLICT`, or `STALE` |
| `READY` | A complete, non-empty required catalog exists; every required entry is `RECONCILED`/`READY` or evidenced `DECLARED_NOT_APPLICABLE`; deterministic validations pass | `STALE` or a new reconciliation outcome |
| `STALE` | A newer or invalidating source version exists | `INGESTED`, `INCOMPLETE`, or `CONFLICT` |

Before any readiness transition, deterministically enumerate the complete required source catalog from taxpayer facts, applicable BookSets, tax heads, the governing rule snapshot, and the selected official schema. The catalog must be non-empty. The only inbound path to `READY` is from `RECONCILED`, and only when every required catalog entry is `RECONCILED` or `READY`, every `DECLARED_NOT_APPLICABLE` entry has evidence, no required `UNKNOWN`, `EXPECTED`, `INGESTED`, `CONFLICT`, `INCOMPLETE`, or `STALE` entry exists, and deterministic validations pass. An empty or not-yet-enumerated catalog can never pass `READY`. A mandatory unresolved source blocks only the affected computation, export, or filing. Optional unresolved sources stay visible. User or CA acknowledgement does not convert a mandatory gap to `READY`.

### Transition review rules

The state machine is scoped to an action, not to a vague account-wide health score. For example, an investment artifact can be reconciled for a holdings review while a separate tax-lot action remains incomplete. The product must show that distinction.

- `UNKNOWN` is not evidence that a source is unnecessary.
- `DECLARED_NOT_APPLICABLE` requires an actor, reason, scope, and supporting evidence.
- `EXPECTED` means the source is still outstanding; it is not an error-free empty source.
- `INGESTED` means storage and parsing succeeded, not that the facts are accepted.
- `RECONCILED` means the defined scope was matched; it does not certify legal treatment.
- `CONFLICT` requires both sides of the disagreement to remain inspectable.
- `INCOMPLETE` records the missing portion and the action it affects.
- `READY` is recomputed after source, rule, schema, or fact changes.
- `STALE` preserves the earlier result and points to the newer evidence or authority.

No global readiness badge may hide a required unresolved state in a component action.

## 7. BookSet, TaxCase, and CLI scenario

The status overview is read-only:

```text
agent-bahi status --tenant tenant_person
```

It lists the personal BookSet, each proprietorship BookSet, and the TaxCases separately. It does not require `--book-set`.

Aggregate TaxCase create, validate, and status operations are tenant/TaxCase-scoped and are explicitly exempt from `--book-set`. Only BookSet-scoped imports, reconciliations, ledger postings, and corrections require explicit `--book-set` when multiple eligible BookSets exist. Every TaxCase mutation after creation names an immutable `--tax-case tc_...`; ambiguity fails closed.

```text
agent-bahi tax-case create --tenant tenant_person --tax-case tc_person_fy25_original --period FY-2025-26 --filing-sequence original
agent-bahi import-ais --tenant tenant_person --book-set personal --tax-case tc_person_fy25_original --file AIS.json
agent-bahi import-26as --tenant tenant_person --book-set personal --tax-case tc_person_fy25_original --file 26AS.pdf
agent-bahi reconcile --tenant tenant_person --book-set proprietorship_consulting --tax-case tc_person_fy25_original --source bank
agent-bahi tax-case validate --tenant tenant_person --tax-case tc_person_fy25_original
agent-bahi tax-case export --tenant tenant_person --tax-case tc_person_fy25_original
agent-bahi tax-case record-evidence --tenant tenant_person --tax-case tc_person_fy25_original --kind acknowledgement
```

The commands are scenario notation, not an implementation contract. Each mutation carries the explicit scope; a command that omits required scope fails closed.

### Personal-paid business expense

An operator determines that a personal bank payment was for the consulting BookSet. The posting uses PT-003 mechanics:

1. Personal BookSet leg: `Dr amount-due-from-business E / Cr personal-bank E`.
2. Business BookSet leg: `Dr software-expense (base amount) / Dr eligible-input-GST` (only where eligibility is separately established under the existing rules; otherwise use the appropriate non-creditable tax/expense treatment), `Cr amount-due-to-proprietor E` (gross amount matching the personal leg).
3. One atomic transaction with the same shared gross amount across both linked legs. There is no fictional receipt into the business bank and no second settlement in this event.
4. Reconcile both BookSets and attach the evidence to `tc_person_fy25_original` using explicit `--book-set` and `--tax-case tc_...` on each mutation. If the business later reimburses the proprietor, that is a separate linked event (business `Dr amount-due-to-proprietor / Cr business-bank`; personal `Dr personal-bank / Cr amount-due-from-business`), not part of this posting.

Each BookSet is reconciled independently, and the expense is not counted once in the personal BookSet and again as an unrelated business expense.

The scenario also demonstrates the boundary between accounting and tax evidence. BookSet routing is an accounting fact; GST eligibility and return treatment are effective-dated decisions loaded from the relevant official source pack. A source label, payment instrument, or operator expectation cannot decide those lanes alone.

## 8. Privacy and security boundary

PT-015 is the binding discovery boundary for this packet:

- no product analytics telemetry by default for personal-tax content;
- protected audit and security logs remain required;
- raw evidence, derived sensitive records, and secrets are access-controlled;
- remote database connections use TLS;
- operational logs redact personal data and credentials;
- every event records actor, resource, tenant, BookSet or TaxCase scope, purpose, and deployment classification where required;
- no credential storage, personal-data scraping, OTP automation, or browser automation;
- no blanket DPDP, CERT-In, RBI, India-only, SDF, or ISO claim.

The DPDP Act and Rules are legal research sources. CERT-In Directions under section 70B are limited to covered security incident, logging, and reporting duties. Actual applicability is an open deployment and processing assessment.

## 9. Dependencies and open research

Implementation is blocked until all of the following are reviewed and approved:

1. Architect review of PT-001, PT-002, PT-003, PT-004, and PT-009; owner and architect approval of PT-005 through PT-008 and PT-010 through PT-016.
2. Canonical contract migration from one legal entity/one balanced book to the reviewed individual/PAN tenant plus independently balanced BookSets model.
3. Immutable official rule snapshots and official schema or validator releases for each supported period and form.
4. Year-specific correction-route research and owner-approved mechanism selection.
5. AA regulatory and partner research, including Agent Bahi's exact role.
6. Parser fixtures for every source in the import matrix, including raw artifact preservation and conflict cases.
7. Review of the [TDS/TCS compliance matrix](tds-tcs-compliance-matrix.md) as the source boundary for PT-012.

Time-limit and deadline research is explicitly deferred. No time-limit rules are reproduced here.

### Dependency ordering

The dependencies are gates, not a suggested implementation sequence:

- the tenant and BookSet contract must be approved before any personal-tax record can be created;
- the TaxCase binding must be approved before a form or validator can be selected;
- source parser fixtures must be available before an import is considered supported;
- readiness tests must cover mandatory missing, conflict, incomplete, stale, and optional-source cases;
- TDS/TCS actions must resolve the effective rule pack before they can leave review;
- filing evidence must be recorded before a local export can be described as submitted;
- correction cases must remain blocked until their mechanism research is owner-approved;
- privacy and security review must cover the actual deployment and processing path;
- AA remains future-only until its role and partner path are explicitly decided.

No dependency here grants implementation authority. The owner and architect review is the release gate for this packet.

## 10. Official sources

This packet uses direct official pages only. Worker or reviewer prose is not authority.

The official links are source entry points, not evergreen snapshots. A future implementation must capture the relevant release, retrieval evidence, applicability facts, and immutable content hash before using a rule or schema. A live page changing later must not rewrite an existing TaxCase.

- [CBDT transition release](https://www.incometaxindia.gov.in/documents/d/guest/press-release-income-tax-act-2025-comes-into-force-from-01-april-2026-pdf)
- [ITR downloads and schemas](https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns)
- [Business or profession guidance](https://www.incometax.gov.in/iec/foportal/help/individual-business-profession)
- [AIS FAQ](https://www.incometax.gov.in/iec/foportal/ais-faq)
- [ITR status FAQ](https://www.incometax.gov.in/iec/foportal/help/e-filing-know-itr-status-faq)
- [RBI Account Aggregator directions](https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=10598)
- [Digital Personal Data Protection Act](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf)
- [Digital Personal Data Protection Rules and official commencement material](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa)
- [Digital Personal Data Protection commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf)
- [CERT-In Directions under section 70B](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf)

### Source-use checklist

Before a source is used by an implementation, the review record must answer:

- which official publisher issued it;
- which Act, period, form, or schema it governs;
- which taxpayer and transaction facts make it applicable;
- which effective boundary starts and ends its authority;
- which exact release or artifact was frozen;
- which parser or validator release consumes it;
- which fields are structural and which require legal review;
- which evidence proves the source was obtained;
- which conflicts can occur with books or another source;
- which action is blocked while the conflict remains;
- whether the source is exhaustive or only corroborative;
- whether a later source supersedes it without mutating old TaxCases;
- which owner and architect approvals are still missing.

The checklist prevents an official URL from being mistaken for a complete legal implementation. It also keeps the source boundary auditable when official pages, schemas, or portal artifacts change.

### Explicit non-authorities

The following cannot approve a personal-tax action on their own:

- a vendor product's feature description;
- a parser's successful exit status;
- a structurally valid JSON or XML document;
- a bank or broker label without the underlying transaction facts;
- an AIS or 26AS value without reconciliation;
- a user or CA acknowledgement of a mandatory gap;
- a local export without filing-specific portal evidence;
- a current web page without a frozen effective snapshot;
- a prior TaxCase's form or rule binding;
- an agent's confidence or suggested classification.

## 11. Review handoff

The canonical packet is complete as a discovery baseline. PT-001, PT-002, PT-003, PT-004, and PT-009 owner approval is recorded, but architect review, the documented Gate-0/readiness safeguards, the breaking tenant/BookSet contract, the source and readiness boundaries, the coordinated canonical migration, and the open research gates remain required before implementation planning proceeds.
