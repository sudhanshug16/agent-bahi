# GST Compliance Matrix — Verified Research Baseline

**Research date: 2026-08-20**

This is a verified research baseline for **regular Indian GST taxpayers**. The
product model is per **GSTIN inside one legal-entity tenant**. One tenant may
have multiple GST registrations. GST amounts, decisions, evidence, and
obligations remain tenant- and GSTIN-scoped; there are no cross-tenant
relationships.

This document is discovery research, not legal advice. The official sources
linked here should be rechecked for the relevant tax period, notification,
state, registration, and portal behavior before any operational use.

## Silent failure gates

These are the failures most likely to look complete while producing the wrong
compliance result:

- wrong GSTIN or registration profile selected for the document or return;
- stale AATO threshold, scheme, state rule, or due date used as if timeless;
- JSON uploaded to the portal but the return not filed;
- books disagree with portal auto-population and the difference is not reviewed;
- ITC claimed without the required document or GSTR-2B evidence where applicable;
- an applicable invoice issued without IRN and QR evidence;
- goods moved when an applicable e-way bill is missing;
- a filed period mutated instead of using the applicable amendment/correction
  path; and
- ARN, portal response, signer method, or other filing evidence is missing.

## How to read the baseline

The sections below keep three kinds of statements separate:

1. **Verified law/portal behavior** — supported by the linked CBIC, GST Portal,
   GSTN, IRP, or e-way bill source and always subject to effective dates.
2. **agent-bahi product decisions** — the deterministic model and workflow
   boundary chosen for this repository; these are not claims that a source
   mandates a particular software design.
3. **Open research** — a question that must remain visible rather than being
   filled with a plausible but unsupported implementation assumption.

## Verified law/portal behavior

### Scope, registration, and time

- A GST registration profile must be selected by GSTIN, state, registration
  type, status, scheme, and effective dates. The same legal entity can have
  more than one registration, and a PAN-level fact such as AATO does not erase
  the GSTIN-level filing obligation.
- Return periods, scheme elections, thresholds, extensions, and portal
  functionality are effective-dated. A due date in this baseline is a
  period-specific baseline, not a timeless constant.
- For regular taxpayers, GSTR-1 is the statement of outward supplies. The GST
  Portal guide supports monthly and quarterly preparation and shows that a
  taxpayer can prepare online or upload an offline JSON file.
  [GSTR-1 Portal guide](https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm)

### QRMP

The verified QRMP profile is PAN-based AATO eligibility up to **INR 5 crore**,
subject to the portal's current-period conditions. Election is made per GSTIN.
Under QRMP, GSTR-1 and GSTR-3B are quarterly while tax is paid monthly. IFF is
optional and can carry eligible B2B invoices and credit/debit-note details for
months 1 and 2; the general IFF due date is the 13th of the following month.
Quarterly GSTR-1 is generally due on the 13th after the quarter, and quarterly
GSTR-3B is generally due on the 22nd or 24th according to the state group.
These dates and every extension must carry an effective date and source; they
must not be hard-coded as timeless values.

[QRMP profile FAQ](https://tutorial.gst.gov.in/userguide/returns/FAQs_change_profile.htm),
[QRMP advisory](https://tutorial.gst.gov.in/offlineutilities/returns/QRMP_Advisory.pdf)

### Sequential filing and portal boundaries

- GSTR-1 is sequential for applicable periods and must precede the same-period
  GSTR-3B. The product must model the predecessor gate rather than allow a
  later return to be treated as complete when its prerequisite is absent.
  [GST Portal sequential-filing compilation](https://tutorial.gst.gov.in/downloads/news/new_functionalities_compilation_january_december_2022.pdf)
- The portal distinguishes preparation, processing, errors, summary review,
  filing, and ARN evidence. The GSTR-1 guide explicitly separates offline JSON
  preparation/upload from the later “File Statement” action and DSC/EVC filing
  steps.
  [GSTR-1 Portal guide](https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm),
  [Returns Offline Tool manual](https://tutorial.gst.gov.in/downloads/invoiceuploadofflineutility.pdf)
- **JSON upload is not filing.** A local file or a portal upload is not proof
  that the statement was filed; only a portal-observed filing result with its
  evidence can support a filed outcome.

### GSTR-1 and GSTR-1A

GSTR-1 contains outward-supply details and supports the applicable tables for
invoices, credit/debit notes, advances, HSN summary, documents issued, and
amendments. The portal also reports processed and errored records; errored
records require action before filing.
  [GSTR-1 Portal guide](https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm)

GSTR-1A is **optional**. It is only for additions or amendments for the **same
tax period** after GSTR-1 and before that period's GSTR-3B. It becomes
unavailable after that GSTR-3B is filed. Prior-period amendments remain in the
later GSTR-1 tables; GSTR-1A is not a future-period return.
  [GSTR-1A FAQ](https://tutorial.gst.gov.in/downloads/news/creative_faqs_on_gstr1a_fo_cr25785.pdf)

### GSTR-3B and GSTR-2B / ITC reconciliation

- GSTR-3B can be assisted by portal auto-population from GSTR-1 and GSTR-2B.
  The official advisory describes these as auto-populated values that the
  taxpayer reviews and can edit; assistance is not authoritative ledger truth.
  [GSTR-3B auto-population advisory](https://tutorial.gst.gov.in/downloads/news/auto_population_of_details_in_gstr3b_5122020.pdf),
  [GSTR-3B functionality compilation](https://tutorial.gst.gov.in/downloads/news/functionalities_released_octtodec2020.pdf)
- Reverse charge, import of services, corrections, timing differences, and
  other gaps require books-based reconciliation. Portal population can be
  incomplete or require taxpayer review/editing; it must not silently replace
  the ledger or books.
- GSTR-2B is an input-tax-credit statement used for reconciliation, not a
  substitute for document and eligibility checks. Bookkeeping is document-first
  and effective-dated: when a valid statutory document or legally required
  communication or match is missing, book the lawful gross expense or liability
  but block the ITC claim and hold it as pending or ineligible as appropriate.
  Model explicit exceptions such as reverse charge and imports; never assume
  portal auto-population is complete.
  [CBIC input-tax-credit rules](https://cbic-gst.gov.in/input-tax-credit-rules.html),
  [CBIC GST invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html),
  [CGST Act](https://cbic-gst.gov.in/hindi/CGST-bill-e.html)
- No stable official third-party import artifact comparable to GSTR-1 has been
  confirmed for GSTR-3B. This remains **OPEN**; the product must not claim that
  such an artifact exists.

### Annual returns

- GSTR-9 is enabled only after the required GSTR-1 and GSTR-3B filings for the
  financial year. It is populated from filed returns and, from FY 2023-24,
  relevant GSTR-2B data. Once filed, GSTR-9 cannot be changed.
  [GSTR-9 manual](https://tutorial.gst.gov.in/userguide/returns/Manual_gstr9.htm),
  [GSTR-9 FY 2024-25 FAQ](https://tutorial.gst.gov.in/downloads/news/faq_on_gstr9_for_24_25_dt_15_oct_25_v6_final.pdf)
- GSTR-9C is self-certified. The threshold verified in [CBIC Circular
  246/03/2025](https://cbic-gst.gov.in/pdf/cir-cgst-246-03-2025.pdf) is aggregate
  turnover above INR 5 crore from 2021-08-01.
- The current GSTR-9 exemption threshold for FY 2025-26 is **OPEN** pending
  the applicable notification. This baseline does not assert one.

### Tax invoices, e-invoice, and HSN

- E-invoice applicability must preserve historical PAN-based AATO facts and
  notified exemptions. The verified threshold baseline is AATO above INR 5
  crore effective 2023-08-01, subject to exemptions.
  [GSTN e-invoice overview](https://tutorial.gst.gov.in/downloads/news/pamphlet_e_invoice_overview_updated_on_17_08_2023_approved_final.pdf),
  [IRP e-invoice mandate](https://einvoice6.gst.gov.in/content/einvoice-mandate/)
- For taxpayers with AATO of INR 10 crore and above, the IRP 30-day reporting
  restriction is effective 2025-04-01. The applicable invoice must not be
  finalized or issued without the required IRN and QR evidence in the product
  workflow; the requirement and exemption/rule version must be retained with
  the invoice.
  [IRP 30-day reporting restriction](https://einvoice6.gst.gov.in/content/revised-time-limit-for-e-invoice-reporting-for-businesses-with-aato-of-%E2%82%B910-crores-above/),
  [GST invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html)
- The GST Portal's May 2025 HSN Table 12 baseline uses 4-digit HSN for AATO up
  to INR 5 crore and 6-digit HSN above INR 5 crore, with portal dropdown and
  validation behavior. This is effective-dated portal behavior, not a timeless
  product constant.
  [HSN Table 12 advisory](https://tutorial.gst.gov.in/downloads/news/updated_advisory_hsn_table12_25042025.pdf)
- E-invoice details can flow from the IRP to GSTR-1, but that population is
  separate from an agent-bahi filing decision.
  [E-invoice to GSTR-1 advisory](https://tutorial.gst.gov.in/downloads/news/einovice_to_gstr1.pdf)

### E-way bill

- The baseline consignment threshold is above INR 50,000, subject to
  state-specific intra-state rules and exceptions. The applicable e-way bill
  is required before movement. Service-only supplies do not need an e-way bill.
  [E-way bill rules](https://docs.ewaybillgst.gov.in/Documents/EWBRules.pdf),
  [E-way bill FAQ](https://docs.ewaybillgst.gov.in/html/ewb_qna.html)
- A generated e-way bill cannot simply be edited. The correction path is the
  applicable cancellation and regeneration workflow, with the original and
  replacement evidence retained.
- The transport and API boundary remains **OPEN**.
  [E-way bill API documentation](https://docs.ewaybillgst.gov.in/apidocs/introduction.html)

## Compact compliance matrix

The dates below are general baselines where the cited source supports them.
The model must select the effective rule by GSTIN, period, state, scheme, and
source; a notification or portal extension can change the operative date.

| Obligation | Trigger / cadence | Deterministic output | Compliance gate | Filing / submission boundary | Evidence retained | Current research status |
|---|---|---|---|---|---|---|
| **GSTR-1** | Outward supplies; monthly or quarterly. Under QRMP, quarterly GSTR-1 is generally due on the 13th after the quarter. | GST Portal-compatible JSON plus human-readable reconciliation and preview. | Correct GSTIN/period; books and outward-supply documents reconcile; sequential predecessor rules satisfied; local validation has no blocking errors. | **GSTR-1-specific settled boundary:** agent-bahi prepares and locally validates JSON and preview. User or CA uploads, reviews, and files on the GST Portal with DSC/EVC. Record upload, processing, portal errors, summary review, filed result, and ARN. No GSP/API submission. JSON upload is not filing. | Immutable preparation snapshot, JSON hash, preview/reconciliation, upload/processing evidence, portal error response, summary-review evidence, signer method, filing timestamp, ARN. | Output boundary settled for GSTR-1 only. Portal transport and filing remain user/CA actions. |
| **IFF under QRMP** | Optional eligible B2B and credit/debit-note details in months 1 and 2; generally due on the 13th of the next month. | Period-scoped IFF detail package and reconciliation. | QRMP election valid for that GSTIN/period; eligible document types; no duplicate or invalid amendments. | Portal upload/review/file boundary is not settled as a separate product transport; track preparation and portal-observed evidence only. | Source documents, eligibility decision, package hash, portal upload/processing evidence if observed, and any filing/ARN evidence. | Due dates and extensions require effective-dated source. Separate transport decision remains open. |
| **GSTR-1A** | Optional same-period additions/amendments after GSTR-1 and before that period's GSTR-3B; unavailable after that GSTR-3B. | Same-period amendment/addition working paper linked to original GSTR-1 lines. | Same-period window open; original line or addition reason present; GSTR-3B predecessor not filed. Prior-period changes use later GSTR-1 tables. | Preparation and review only unless a later filing-specific decision is settled. Never model it as a future-period return. | Original line reference, amendment reason, snapshot, validation result, portal observation, and filing/ARN evidence if separately filed. | Semantics verified; product transport and detailed artifact contract remain open. |
| **GSTR-3B** | Monthly or quarterly; under QRMP, quarterly and generally due on the 22nd or 24th by state group. | Deterministic books-based working paper and reconciliation against ledger, GSTR-1, and GSTR-2B. | Correct GSTIN/period; GSTR-1 predecessor where applicable; reverse charge/import/correction gaps reviewed; values reviewed and editable differences explained. | Manual portal review and filing boundary remains OPEN. No stable official third-party import artifact comparable to GSTR-1 is confirmed. | Ledger snapshot, GSTR-1 and GSTR-2B inputs, books-to-portal variance lines, review decisions, portal values/observations with provenance, filing evidence and ARN if observed. | Assistance/auto-population verified; authoritative ledger and import artifact assumptions are explicitly rejected. |
| **GSTR-2B / ITC reconciliation** | Periodic statement and document-level ITC review; reconcile before the relevant claim. | Supplier-document reconciliation, eligible/pending/ineligible ITC classification, and books posting decision. | Valid document and statutory particulars; match/communication evidence where required; reverse charge/import exceptions explicit; no claim based only on portal population. | No separate agent filing boundary. Reconciliation supports taxpayer review and the relevant return working paper. | Invoice/debit-note/import/RCM evidence, GSTR-2B snapshot/hash, supplier and document identifiers, match result, rule version, and reasoned exception. | Document-first baseline verified; exact automation and exception coverage remain open. |
| **GSTR-9** | Annual return after required FY GSTR-1 and GSTR-3B filings. | Annual return working paper populated from filed returns and relevant GSTR-2B data, with variance reconciliation. | Required source filings present; FY-specific enablement and exemption notification resolved; filed snapshot immutable. | Portal review and filing transport is OPEN. Filed GSTR-9 cannot be changed; correction/reconciliation behavior needs effective-dated research. | Filed-return snapshots, GSTR-2B source, annual reconciliation, portal summary/review evidence, filing timestamp, signer method, and ARN. | FY 2025-26 exemption threshold is OPEN; no submission transport is settled. |
| **GSTR-9C** | Annual reconciliation statement when the applicable effective threshold and conditions require it. | Self-certified reconciliation statement and supporting turnover/audit evidence. | Threshold, FY, taxpayer facts, and self-certification route resolved; figures reconcile to annual return and books. | Portal review and filing transport is OPEN. | Reconciliation, books/return snapshots, threshold rule source, self-certification evidence, portal response, timestamp, and ARN. | Threshold above INR 5 crore from 2021-08-01 is verified in the cited CBIC circular; current FY applicability and transport remain open. |
| **E-invoice** | Applicable tax invoices/credit notes/debit notes for a GSTIN based on effective PAN-level AATO and exemptions; INR 5 crore threshold baseline from 2023-08-01. AATO INR 10 crore and above has a 30-day IRP reporting restriction from 2025-04-01. | Invoice with IRN/QR evidence, or an explicit non-applicability decision tied to the effective rule. | Applicability and exemption gate; valid tax document; IRN and QR evidence before applicable invoice finalization/issue; 30-day rule checked where applicable. | Direct IRP API versus export/upload/import-response is OPEN. No agent submission transport is authorized by this baseline. | Original invoice snapshot, applicability rule/source period, request/response hashes, IRN, signed QR, timestamps, cancellation/replacement lineage, and error response. | Applicability facts verified; transport choice and retry/correction contract remain open. |
| **E-way bill** | Goods movement where applicable; baseline consignment value above INR 50,000, subject to effective state rules and exceptions. | E-way bill request/result linked to consignment, invoice, transporter, and movement. | State/route/consignment rule and exception gate; generated before movement; service-only supplies excluded; cancellation/regeneration lineage for correction. | Direct/API versus export/upload/import-response is OPEN. | Consignment and invoice snapshot, threshold/state rule version, request/response hash, e-way bill number, timestamps, cancellation/replacement evidence. | Threshold and portal rules are baseline facts; state-rule detail and transport are OPEN. |

## agent-bahi product decisions

### GSTR-1-specific output boundary

The settled boundary is **specific to GSTR-1** and is not a global rule for
GSTR-3B, annual returns, e-invoice, e-way bill, or any other compliance:

- agent-bahi produces GST Portal-compatible JSON after deterministic local
  validation, plus a human-readable reconciliation and preview;
- the user or CA uploads, reviews, and files on the GST Portal with DSC/EVC;
- agent-bahi records local preparation and validation, upload and processing
  observations, portal errors, summary review, filed outcome, filing timestamp,
  signer method, and ARN evidence when supplied or observed; and
- agent-bahi does not perform GSP/API submission for GSTR-1.

The only compliance lifecycle states used by this baseline are:

- **prepared** and **locally validated** — local product states;
- **uploaded**, **portal processed**, **portal processed with errors**, and
  **portal summary reviewed** — portal-observed states that require response,
  screenshot, export, or other provenance;
- **filed** — a portal-observed filing result; and
- **ARN recorded** — the ARN is retained as evidence, not inferred from an
  upload or local preview.

These states are not interchangeable. Local validation cannot prove portal
processing, and portal processing cannot prove filing. A portal observation
must identify the GSTIN, return period, source artifact/hash, observation time,
actor or signer where relevant, and evidence location.

### Predecessor and period rules

The model must represent return obligations as a graph of effective-dated
predecessor links. For an applicable period, GSTR-1 precedes GSTR-3B; GSTR-1A
can only occur in its same-period window before GSTR-3B; GSTR-9 depends on the
required FY return filings. A filed period is immutable in place. Amendments
must link to the original document or return line and use the applicable later
period or correction workflow.

### Document-first ITC policy

The lawful gross expense or liability may be booked when the required ITC
document or communication is missing, but the ITC component is separately
blocked and held as pending or ineligible as the applicable rule supports. An
exception must be explicit, reasoned, scoped, effective-dated, and evidenced;
it cannot silently grant ITC. This extends the existing [expense evidence
policy](expense-evidence-policy.md) and is not a claim that every missing
document has the same legal consequence.

## Minimum model requirements

The discovery model must preserve the following without SQL or schema
assumptions:

- effective-dated GST registration profiles, including GSTIN, legal entity,
  state, registration type, status, effective dates, and scheme/frequency;
- PAN-level AATO facts with source period, source rule, effective dates, and
  the GSTIN applicability decision derived from them;
- e-invoice and e-way-bill applicability, exemptions, state rules, route or
  movement facts, and effective-dated source provenance;
- tax documents and evidence, including invoice/credit/debit note identity,
  document dates, source files, hashes, validation, retention, and links to
  original documents;
- return obligations, period and cadence, scheme, due-date rule/version,
  predecessor links, and the filing/extension source;
- immutable preparation and filing snapshots, with local state kept separate
  from portal-observed state;
- reconciliation lines with source-line provenance across books, ledger,
  GSTR-1, GSTR-2B, annual returns, and portal observations;
- explicit ITC states such as eligible, pending evidence, pending match,
  ineligible, claimed, reversed, and re-eligible, each with rule/evidence
  provenance;
- amendments linked to their originals, including period, reason, lineage,
  and correction outcome;
- portal artifacts with artifact type, content hash, source GSTIN/period,
  upload and processing timestamps, portal response/error details, signer
  method, filing timestamp, and ARN; and
- an audit trail for every preparation, validation, upload observation, review,
  filing observation, ARN record, amendment, exception, and decision.

All amounts and decisions remain scoped to exactly one tenant and one GSTIN
context. Multiple GSTINs under one tenant are modeled as registrations of that
tenant, not as relationships between tenants.

## Open research

- Composition taxpayer alternate path: research CMP-08, GSTR-4, and related
  rules as a separate track. Do not fabricate dates, due dates, or artifact
  contracts from the regular-taxpayer baseline.
- Confirm whether a stable official third-party GSTR-3B import artifact,
  comparable to GSTR-1 JSON, exists; it is not confirmed here.
- Confirm the applicable GSTR-9 exemption notification for FY 2025-26.
- Settle whether e-invoice transport should be direct IRP API, export/upload,
  or an import-response workflow.
- Settle e-way-bill transport/API behavior and research effective-dated
  intra-state rules and exceptions for each relevant state.
- Resolve the manual portal review and filing boundary for GSTR-3B and annual
  returns, including the exact evidence needed for portal observations.
- Recheck every due date and extension against the relevant effective-dated
  notification, portal advisory, GSTIN scheme, state group, and period.

## Not yet approved for implementation

This is discovery research. It authorizes no CLI behavior, schema, migration,
import, API integration, or automated filing merely by being documented. A
separate implementation decision must settle the relevant filing-specific
boundary, artifact contract, rule versions, evidence requirements, and review
gates.

## Official primary sources

- [GSTR-1 guide](https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm)
- [Returns Offline Tool manual](https://tutorial.gst.gov.in/downloads/invoiceuploadofflineutility.pdf)
- [GSTR-1A FAQ](https://tutorial.gst.gov.in/downloads/news/creative_faqs_on_gstr1a_fo_cr25785.pdf)
- [QRMP profile FAQ](https://tutorial.gst.gov.in/userguide/returns/FAQs_change_profile.htm)
- [QRMP advisory](https://tutorial.gst.gov.in/offlineutilities/returns/QRMP_Advisory.pdf)
- [Sequential filing compilation](https://tutorial.gst.gov.in/downloads/news/new_functionalities_compilation_january_december_2022.pdf)
- [GSTR-3B auto-population advisory](https://tutorial.gst.gov.in/downloads/news/auto_population_of_details_in_gstr3b_5122020.pdf)
- [GSTR-3B functionality compilation](https://tutorial.gst.gov.in/downloads/news/functionalities_released_octtodec2020.pdf)
- [GSTR-9 manual](https://tutorial.gst.gov.in/userguide/returns/Manual_gstr9.htm)
- [GSTR-9 FY 2024-25 FAQ](https://tutorial.gst.gov.in/downloads/news/faq_on_gstr9_for_24_25_dt_15_oct_25_v6_final.pdf)
- [CBIC Circular 246/03/2025](https://cbic-gst.gov.in/pdf/cir-cgst-246-03-2025.pdf)
- [GST invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html)
- [GST ITC rules](https://cbic-gst.gov.in/input-tax-credit-rules.html)
- [CGST Act](https://cbic-gst.gov.in/hindi/CGST-bill-e.html)
- [HSN Table 12 advisory](https://tutorial.gst.gov.in/downloads/news/updated_advisory_hsn_table12_25042025.pdf)
- [GSTN e-invoice overview](https://tutorial.gst.gov.in/downloads/news/pamphlet_e_invoice_overview_updated_on_17_08_2023_approved_final.pdf)
- [IRP mandate](https://einvoice6.gst.gov.in/content/einvoice-mandate/)
- [IRP 30-day restriction](https://einvoice6.gst.gov.in/content/revised-time-limit-for-e-invoice-reporting-for-businesses-with-aato-of-%E2%82%B910-crores-above/)
- [E-invoice to GSTR-1](https://tutorial.gst.gov.in/downloads/news/einovice_to_gstr1.pdf)
- [E-way bill rules](https://docs.ewaybillgst.gov.in/Documents/EWBRules.pdf)
- [E-way bill FAQ](https://docs.ewaybillgst.gov.in/html/ewb_qna.html)
- [E-way bill API docs](https://docs.ewaybillgst.gov.in/apidocs/introduction.html)
