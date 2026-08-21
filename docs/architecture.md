# Agent-Bahi Pre-Implementation Architecture

**Document Status**: Pre-implementation architecture based on SETTLED constraints and RECOMMENDED defaults.

**Date/As-of**: 2026-08-20

**Scope**: This document is a working architecture informed by [Architecture Decisions](discovery/architecture-decisions.md), [Discovery Decisions](discovery/decisions.md), [Data Model Requirements](discovery/data-model-requirements.md), and cross-cutting research baselines. The domain-level bookkeeping contract is the canonical pre-implementation detail for the accounting records and posting templates: see [Accounting Contracts](discovery/accounting-contracts.md). Statutory compliance workflows and verified compliance baselines are documented in [Statutory Workflow Contracts](discovery/statutory-workflow-contracts.md) with linked matrices for [TDS/TCS](discovery/tds-tcs-compliance-matrix.md), [Annual Income-Tax](discovery/annual-income-tax-compliance-matrix.md), and [MCA Companies Act](discovery/mca-companies-act-compliance-matrix.md). MCA claims are operational only with `source_verified=true` and an exact `effective_rule_snapshot`; OPEN+BLOCK items do not authorize implementation. It combines SETTLED constraints with remaining RECOMMENDED architecture choices. TypeScript + Bun is owner-selected; the remaining recommendations still require evidence, review, and any applicable owner decision.

**Authorization**: This document authorizes no Gate0, Phase 1, or implementation. Sudhanshu must explicitly authorize Gate0 after reviewing the docket. Gate0 is mandatory evidence before implementation, but does not authorize Phase 1 or approve libraries. Proof spikes and OPEN RESEARCH gates remain hard blockers, and any later blocker stops the affected work and requires a new owner decision. The definition of ready (§22) must be satisfied.

---

## 1. Outcome and Scope

**Agent-Bahi is a local-first, agent-first, India-focused, deterministic accounting and compliance modular monolith.**

### Core Outcome

- **Default storage**: SQLite, deployable locally without external databases or services.
- **Adapters**: PostgreSQL and MySQL supported through pluggable persistence ports and proven migration consistency across all dialects before release.
- **Tenancy model**: One legal entity = one independent tenant. Sudhanshu's three legal entities (two private limited companies and one sole proprietorship) are three separate tenants. Cross-tenant/intercompany paired posting is **DEFERRED and PROHIBITED in V1**; mistaken inter-entity payments are represented separately in each tenant with explicit due-to/due-from or correction journals only when the user records them, never through a cross-tenant atomic write.
- **GST registrations**: One tenant may have multiple GSTIN registrations; GST work, amounts, obligations, and evidence are scoped by tenant and GSTIN.
- **Technology direction**: TypeScript + Bun is the owner-selected runtime. Prefer Bun-native APIs first. ORM, parser, validator, decimal, database-driver, migration, and build libraries remain unapproved candidates that require individual proof under the pinned Bun runtime; Gate0 records evidence but does not approve them.

### Non-Goals

The following are explicitly out of scope for v1 and remain deferred:

- **Inventory accounting**: Products/services and document lines carry description, quantity, unit, rate, tax treatment, and account references, but the system does not track stock, warehouses, valuation, automated COGS, batches, serials, or manufacturing behavior.
- **Attendance/Leave/HRMS**: Payroll accepts approved summarized inputs (payable days, loss-of-pay days, overtime amounts/hours) but does not maintain attendance records, leave balances, shifts, or attendance-import workflows. Agent-bahi is not the system of record for employee time.
- **Employee portal**: No employee self-service. Payslips and employee outputs are generated for secure external delivery; expense claims and payroll evidence enter through operator/agent workflows.
- **RBAC implementation**: Authorization hooks are present and no-ops for v1; RBAC is deferred. Actor, source, and permission context are threaded through every mutation.
- **Web server/microservices**: CLI is the primary adapter. API and web clients are future options; reusable application services enable this without breaking changes.
- **Direct government filing**: There is no universal auto-filing policy. Each filing (GST, TDS, e-invoice, e-way bill, income tax, MCA, etc.) has its own researched submission boundary or remains prepare/validate/export only. GSTR-1 is the only settled filing boundary (user/CA manual portal upload); other filings require individual approval and research.
- **Zoho import until final phase**: Zoho Books is the validated migration source but is intentionally deferred to Phase 9 and must not drive the canonical accounting model. Feature parity with Zoho (and reference to Frappe Books) is validated in [zoho-frappe-parity.md](discovery/zoho-frappe-parity.md).

---

## 2. Architecture Drivers and Silent Failures

### Prioritized Architecture Drivers

1. **Accounting correctness**: Ledger invariants (debit=credit), posting integrity, and audit trails are non-negotiable. Double-entry with immutable correction lineage.
2. **Tenant and GSTIN isolation**: Every command operates on exactly one tenant. GSTIN-scoped work remains scoped. Cross-tenant leaks are a critical failure.
3. **Immutability and audit**: Posted documents are immutable except through explicit reversal + replacement. Every decision is auditable with actor, source, timestamp, and evidence links.
4. **Compliance freshness**: Effective-dated rules ensure compliance decisions reflect the rules in effect at decision time. Stale/missing rules fail closed for statutory operations.
5. **Deterministic agent interface**: Skills invoke deterministic CLI commands with stable schemas. No hidden accounting decisions in prompt or agent heuristics.
6. **Local simplicity**: SQLite default, no external runtime dependencies, fully testable offline.
7. **Dialect portability**: Multi-dialect support through adapters means zero coupling to one database.
8. **Recoverability**: Immutable evidence, content-addressed blobs, and restore-in-isolation verification gates.

### Silent Failures to Prevent (Most Damaging First)

These are failures that look complete while producing the wrong compliance/accounting result:

1. **Wrong tenant or GSTIN silently used**: Command executes against unintended tenant or GSTIN without visible confirmation.
2. **Debit-credit imbalance**: Posting is not rejected despite unequal entries.
3. **Duplicate retry**: Same command payload replayed creates second posting instead of idempotent return.
4. **Number reuse**: A voided, cancelled, failed, or reserved document number
   is reused in the same series/year/GSTIN.
5. **Stale rules applied silently**: Tax/compliance calculation uses old rule version without versioning.
6. **Upload mistaken for filing**: JSON uploaded to portal treated as filed return with no portal-observed ARN.
7. **Portal/books divergence unmissed**: GSTR-3B portal auto-population applied/used without review against books.
8. **ITC claimed without evidence**: GST input tax claimed without required document and GSTR-2B evidence.
9. **Invoice issued without IRN**: Applicable invoice finalized without e-invoice IRN and QR evidence.
10. **Movement without EWB**: Goods moved when effective rules require e-way bill evidence.
11. **Closed-period mutation**: Draft/invoice created with accounting date in locked period.
12. **FX/rate drift**: Exchange rate changed retroactively, affecting historical conversions.
13. **Partial batch success hidden**: 900 of 1000 records imported without user awareness.
14. **External success lost/duplicated**: Network success duplicated on retry or lost on timeout without durable evidence.
15. **Secrets in logs/bundles**: API keys, DSCs, or credentials exposed in debug logs or CA export bundle.
16. **SQLite contention silently retried**: SQLITE_BUSY silently retried without application knowledge.

---

## 3. System Context and Dependency Rule

### Dependency Inward Architecture

```
User / Agent / CA
    ↓
CLI command registry (human help, JSON schema, skill bindings, parser)
    ↓
Application services (versioned command envelope, validation, authorization hooks, domain orchestration)
    ↓
Application Ports (outbound: Repository, RuleProvider, EvidenceStore, ExternalAdapter, Clock, etc.)
    ↓
Domain modules (accounting, tax, compliance rules, ledger invariants, state machines)
    ↓
Infrastructure adapters (SQL dialect implementations, evidence storage, external API calls)
```

### Dependency Rules

**Inward constraint**: Domain and application layers import no CLI framework, ORM, network library, or runtime-specific feature. Contracts flow inward only. Application owns outbound port interfaces (Repository, RuleProvider, EvidenceStore, ExternalAdapter, Clock, UnitOfWork); infrastructure implements them. Domain imports only core types.

**Versioned skills**: Skills call CLI commands only via the published command registry. Skills never call domain services directly or import domain/persistence code. Skills invoke `agent-bahi` as an external process with well-defined inputs/outputs.

**External calls outside transaction**: Network calls (bank APIs, IRPs, government portals) never occur inside the accounting database transaction. Durable outbox/saga patterns record requests and responses as separate state transitions.

**No full event sourcing**: Ledger owns immutable JournalEntry/Posting records and may emit domain events/outbox messages. Current application state is relational (accounts, entities, documents, balances); it is NOT rebuilt solely by replaying events. Read models are non-authoritative and rebuildable from postings. Explanation: simpler than full event sourcing, sufficient for deterministic accounting, and trades replay complexity for query efficiency.

---

## 4. Conceptual Package/Layer Topology

Logical packages (provisional names, boundaries are architectural, exact package names are TBD):

### Domain Layer

- **`domain/accounting`**: Account, posting, journal-entry logic; debit-credit rules; balance derivation.
- **`domain/documents`**: Invoice, bill, payment, expense, journal-entry state machines; document versions; posted document immutability.
- **`domain/tax`**: Tax-component models; tax posting rules; GST, TDS calculation contracts.
- **`domain/ledger`**: Ledger-invariant enforcement; balance correctness; correction lineage.
- **`domain/rules`**: Rule pack loading; effective-date selection; rule versioning; immutable compliance rules.

### Application Layer

- **`application/commands`**: Command handlers; request envelope; versioned input/output schemas; validation before domain calls.
- **`application/services`**: Service layer; orchestration; transaction boundaries; external call staging.
- **`application/authorization`**: Authorization hooks; permission context threading; audit event emission.
- **`application/ports`**: Outbound port interfaces: Repository, RuleProvider, EvidenceStore, ExternalAdapter, Clock, UnitOfWork.

### Accounting Domain Submodules

- **`domain/documents/sales`**: Invoices, sales orders, returns, credit/debit notes for outward supplies.
- **`domain/documents/purchases`**: Bills, purchase orders, returns, credit/debit notes for inward supplies.
- **`domain/documents/expenses`**: Employee claims, advances, reimbursements, corporate-card expenses.
- **`domain/documents/banking`**: Bank transactions, reconciliation matches, settlements.
- **`domain/documents/payroll`**: Payroll periods, inputs, runs, payables, remittances.
- **`domain/posting`**: Ledger posting logic; atomic batch posts; reversal/replacement patterns.

### Compliance and Tax Layer

- **`domain/compliance/gst`**: GST registration, AATO, GSTR-1/GSTR-3B/GSTR-2B logic; ITC states.
- **`domain/compliance/payroll`**: Payroll tax, statutory deductions, contributions, PF, ESI, PT, LWF; effective-dated rule selection; no hardcoded form numbers or section references.
- **`domain/compliance/fixed-assets`**: Asset register, depreciation runs, disposal tracking.
- **`domain/compliance/obligations`**: Obligation engine; predecessor gates; filing snapshots; amendments.
- **`domain/compliance/rules`**: Effective-dated rule selection; versioned rule packs; fail-closed gates.

### Infrastructure/Adapter Layer

- **`infrastructure/persistence`**: Repository implementations; Bun-native persistence first, with individually proof-gated Drizzle, Kysely, better-sqlite3, or other candidate adapters implementing the application Repository port.
- **`infrastructure/dialects`**: SQL migrations and dialect-specific handling (SQLite, PostgreSQL, MySQL).
- **`infrastructure/evidence`**: Content-addressed evidence storage; local filesystem default; S3/cloud adapter option (implements application EvidenceStore port).
- **`infrastructure/external-adapters`**: Bank APIs, IRP/e-invoice, e-way bill, GST portal integrations (implements application ExternalAdapter port).
- **`infrastructure/rules-loader`**: Rule pack manifest validation, signature verification, versioning (implements application RuleProvider port).

### CLI and Skills Layer

- **`cli/command-registry`**: Domain-owned command definitions; parser bindings; help generation; schema export.
- **`cli/adapter`**: Bun-native parser first; Clipanion or another individually proof-gated parser candidate may provide human and JSON output; exit-code taxonomy remains domain-owned.
- **`skills/manifests`**: Skill version contracts, prerequisites, automation gates, exception routes.
- **`skills/implementations`**: Skill orchestration logic; CLI invocation; evidence gathering; validation.

### Cross-Cutting

- **`core/types`**: Tenant context, money/currency, date/time models, idempotency keys, audit events.
- **`core/errors`**: Structured exception taxonomy; remediation data; error serialization.
- **`core/decimal`**: Exact decimal wrapper for tax/rate/FX; never floats; rounding rules.

### Allowed Dependencies (Inward)

- CLI imports command registry, application services, core types.
- Application imports domain, core types, authorization hooks, error types.
- Domain imports core types only. No ORM, no CLI, no external libraries except rule/compliance data structures.
- Infrastructure (adapters) implements application-owned outbound ports only; never imports domain business logic.
- Skills import CLI schemas and command definitions; subprocess only the packaged `agent-bahi` executable, never Node/npm scripts or another runtime; never import domain or application business logic.

### Forbidden Dependencies

- Domain → CLI, ORM, network, runtime-specific features.
- Infrastructure → Domain business logic (only via ports).
- Skills → Domain, application services, or persistence code.
- Cross-tenant leaks: every repository operation requires `TenantContext`.

---

## 5. Tenant, Identity, Configuration, and Storage Topology

### Tenant Model

**One legal entity = one independent tenant.** Sudhanshu has three legal entities; the product models three tenants.

### Multi-Tenant Database Deployment

A single configured database (SQLite, PostgreSQL, or MySQL) may contain multiple independent tenants. Every business aggregate, constraint, and repository operation is **tenant-scoped**. Only the following operations may execute without a selected tenant context:

- Tenant catalog/list/creation (admin scope).
- No product command defaults to global scope.

### Tenant Selection Rules (Non-Negotiable)

**Auto-select exactly one active tenant; fail explicitly on ambiguity:**

- If exactly one active tenant exists, commands use it without a `--tenant` flag.
- If more than one active tenant exists, require explicit `--tenant <name>` or an explicit named session context.
- Inactive tenants do not create ambiguity.
- Never silently remember last tenant choice.

**Echo effective tenant in every output** (human and JSON), both interactive and batch modes.

### GSTIN Selection (GST-Scoped Commands)

**Auto-select exactly one active, applicable GSTIN; fail explicitly on ambiguity:**

- If exactly one active GSTIN registration applies to the command's date and scope, use it without a `--gstin` flag.
- If more than one active GSTIN registration applies, require explicit `--gstin <value>` or an explicit named session context.
- Inactive registrations do not create ambiguity.
- **Never use global GSTIN constants; all GST logic is GSTIN-scoped.**

**Echo effective GSTIN in GST-command output** (human and JSON).

### GSTIN Resolution Everywhere

**Each command declares GSTIN context requirement: `none` or `required`.** Apply uniformly across tenant section, command lifecycle, CLI section, and workflows:

**`gst_context = none`** (Non-GST operations: expenses, payroll, journal entries, bank reconciliation, fixed assets, internal transfers):
- Do not resolve or use a GSTIN.
- Clear prior GSTIN context from this command onward.
- Reject an inapplicable `--gstin` flag with explicit error.

**`gst_context = required`** (GST-scoped operations: invoices with GST, GSTR-1, GSTR-3B, e-invoice, e-way bill, ITC, filing obligations):
- Resolve registrations that are ACTIVE and APPLICABLE to the command's accounting date and scope.
- If zero ACTIVE APPLICABLE registrations: **Fail explicitly; no GSTIN applicable.**
- If exactly one ACTIVE APPLICABLE registration: Auto-select without `--gstin` flag; echo it.
- If more than one ACTIVE APPLICABLE registration: Require `--gstin <value>` or explicit named session context; echo the chosen GSTIN.
- Reject operations without a resolved GSTIN when context is required.

- **GSTIN applicability**: Determined by effective-dated registration profile (state, status, scheme, effective dates) and command date/scope. A registration inactive on the command date does not apply.

- **Echo context always**: Human output always shows `Tenant: <tenant_id>` plus exactly one GST line: `GSTIN: <actual identifier>` when `gst_context=required`, or the literal `GSTIN: not applicable` when `gst_context=none`. JSON always contains `tenant_id` and nullable `gstin_id`; it contains the actual GSTIN identifier when required and `null` when none. For `gst_context=none`, do not resolve, look up, use, or store any GSTIN.

### Tenant Configuration

Each tenant stores and maintains:

- **Base currency** (exactly one, e.g., INR).
- **Timezone** (IANA identifier, e.g., Asia/Kolkata; used for display and midnight boundaries).
- **Fiscal year settings** (start month, end month; may differ from calendar year).
- **Default report basis** (cash or accrual).
- **Registrations**: GST registrations with GSTIN, state, type, scheme, effective dates, status.
- **Numbering series**: Document families (invoice, bill, journal entry, etc.) with series definitions, allocators, and locked sequences.
- **Period locks**: Global or module-specific `locked-through` dates.
- **Rule channels**: Jurisdiction/version selections for tax, payroll, compliance rules.
- **Evidence store**: Path or S3 bucket configuration for content-addressed evidence.
- **Bank/export presets**: Versions for bank CSV formats, payroll export formats.
- **Reporting dimensions** (optional): Tags/dimensions for project, location, department, etc.

### Future Database-per-Tenant Deployment

The architecture preserves database-per-tenant as an operational deployment option without code-level changes. Every repository operation requires `TenantContext` so that connection/catalog boundaries can be swapped later.

---

## 6. Canonical Accounting Model

### Core Entities (Conceptual, No SQL)

**Tenant**
The legal entity; all records are tenant-scoped.

**Registration**
GST registration within a tenant; one tenant may have multiple; every GST operation selects exactly one active applicable GSTIN.

**FiscalPeriod and Lock**
Fiscal year and month/period boundaries; optional period locks prevent mutation within `locked-through` date range.

**Period-lock mutation coverage**: A locked date rejects create, edit, delete,
issue, post, void, reverse, payment creation/posting,
allocation/deallocation/reallocation, bank reconciliation/unreconciliation,
credit/debit note, refund, write-off, reclassification, depreciation, FX
revaluation/realization adjustment, asset disposal, tax/payroll journals,
opening-balance changes, and journal import/posting. Evidence-only
attachments/imports that do not alter books are the sole exception. Unlock is
an authorized, reasoned, audited operation with impact preview and explicit
confirmation.

**Account**
Chart of accounts; account type (asset, liability, equity, revenue, expense); balance sheet vs. profit & loss classification; parent-child hierarchy; tenant-scoped.

**Contact**
Supplier, customer, employee, or other party; tenant-scoped; used for invoicing/payment.

**ItemOrServiceReference**
Description, quantity unit, rate, tax treatment, default ledger account reference; never implies stock tracking, warehouse, or COGS.

**BusinessDocument (abstract, versioned)**
Invoice, Bill, Payment, JournalEntry, ExpenseClaim, PayrollRun, PayrollPayment, FixedAssetAcquisition, etc.
- Tenant-scoped.
- Unique document number within series/year/applicable GSTIN.
- Draft editable; finalized/issued/posted immutable.
- Correction lineage: original → reversal + replacement, immutably linked.

**DocumentLine**
Line-level amounts, quantities, tax components, reporting-tag allocations (optional).

**TaxComponent**
GST (SGST, CGST, IGST, Cess), TDS, TCS, deduction; calculated or explicit; posted separately to tax payables.

**JournalEntry**
Balanced accounting entries; atomic posting of multiple postings; may include multi-currency settlement calculations.

**Posting**
Immutable ledger record: account, amount (minor units, currency), debit/credit, tenant, GSTIN (if applicable), date, source document, actor, timestamp.

**Settlement / Allocation**
Document payment or partial payment, with document-currency amount/carrying base
value removed, actual paid currency/amount, paid-currency-to-base rate snapshot,
bank base value, allocation amount, and bank-fee/realized-FX separation. For
each slice, `B = round(actual_paid_amount * paid_currency_to_base_rate)`;
receivable FX is `B - carrying_base_removed`, payable FX is
`carrying_base_removed - B`. Bank cash never uses document quantity. Unapplied
residuals remain open and partial slices retain their own values.

Settlement posting is cash-first: the actual bank amount `B` is posted exactly
once to `Bank/Cash` against the relevant unapplied-cash control, then the
allocation/reclassification leg clears that control against AR/AP. Realized FX
is part of that second balancing leg and never causes a second Bank/Cash
posting. Any aggregate settlement presentation that displays Bank/Cash,
AR/AP, and realized FX together is reporting-only and authorizes no additional
journal.

**CurrencyRateSnapshot**
Immutable exchange rate: date, document currency, base currency, rate, source, timestamp. Attached to document at creation and never changed.

**Credit/refund clearing**: Customer credit notes initially credit signed AR;
customer refunds debit that AR credit balance and credit bank. Vendor credits
initially debit signed AP; supplier refunds debit bank and credit that AP debit
balance. If a named refund control is used, AR/AP reclassification and cash
legs commit atomically and the source balance plus control must both clear.
Each refund has one idempotency identity over all legs.

**ReportingSplit**
Explicit allocation line when one source amount maps to multiple reporting tags: amount, tag assignment, source document reference.

**Evidence**
Content-addressed immutable blob (receipt, statement, e-invoice response, etc.) with checksum, storage reference, tax eligibility, validation status, rule source, rule effective dates, and exception record if applicable.

**AuditRecord**
Immutable entry: action, actor, timestamp, entity, change summary, idempotency key, request ID, outcome. Links to relevant evidence and domain events.

**IdempotencyRecord**
Request ID (deterministic or caller-supplied), content hash, response, timestamp. Replay of same request ID returns same response; different content with same ID is rejected.

### Canonical State Principles

- **Stored once**: Invoices, bills, payments, and postings are the canonical records; never duplicated for cash vs. accrual.
- **Draft vs. finalized**: Draft documents are editable and do not post ledger entries. Finalization is atomic: creates canonical ledger entries and audit records.
- **Finalized immutability**: Posted documents never overwrite; corrections use reversal + replacement lineage.
- **Balances derived, not authoritative**: Account balances are calculated from postings, not stored as mutable authoritative facts. If balance/read-model tables exist, they are explicitly rebuildable, non-authoritative caches with drift detection. Posting sums are the authoritative source.
- **Cache/read-model rebuilding**: Caches are non-authoritative and fully rebuildable from posting and audit records.
- **Item lines without inventory**: Document lines carry item reference, quantity, unit, rate, tax treatment, and account, but never warehouse stock or valuation.
- **Source-line splitting for allocations**: When one amount is allocated across reporting tags, represent as explicit split lines with one tag per line and totals reconciling to the source.

### Relationship Diagram (Conceptual)

```
Tenant
├── Registration (GSTIN)
├── Account
├── Contact
├── ItemOrServiceReference
├── BusinessDocument
│   ├── DocumentLine
│   │   ├── TaxComponent
│   │   └── ReportingSplit (optional tags)
│   ├── JournalEntry (ledger outcomes from posting)
│   ├── Settlement (payment records with rate snapshots)
│   └── CorrectionLineage (original → reversal + replacement)
├── Posting (immutable ledger entries)
├── CurrencyRateSnapshot (immutable rate at document creation)
├── Evidence (content-addressed attachments)
├── AuditRecord (immutable state changes)
├── IdempotencyRecord (request deduplication)
└── FiscalPeriod / Lock
```

---

## 7. Exact Money, Time, Numbering, Concurrency

### Money and Rounding

**Posted amounts**: Currency-aware integer minor units (e.g., paise for INR, cents for USD). No ambiguity in balance checks.

**Intermediates**: Tax calculations, exchange-rate conversions, and FX intermediates use an exact decimal domain wrapper, never binary floats. Bun-native exact arithmetic is preferred; decimal.js remains an unapproved candidate requiring individual proof.

**Preserved metadata**: For every conversion or calculation, store:
- Original currency and amount.
- Base-currency result.
- Rate used (with source, timestamp).
- Rounding rule applied.
- Intermediate decimal values before posting rounding.

Rationale: Audit trail enables recalculation if rules change. Balance checks are exact.

### Rounding and Precision Declaration

**Every calculator must declare**:
- **Rounding stage**: Where in the calculation pipeline rounding occurs (e.g., per-line, after total).
- **Rounding scope**: Per component, per line, per batch, or global.
- **Tie-breaking mode**: Round-half-up, round-half-even, banker's rounding, etc.
- **Currency scale**: Number of decimal places before posting (e.g., 2 for INR paise).
- **Tax-component allocation policy**: How multi-component tax totals are allocated across lines (proportional, by-line-rate, remainder-last).
- **Remainder policy**: Where unaccounted paise/fractional units go (rounding, error account, deferred).
- **FX quote direction**: Which currency in numerator/denominator for exchange rates (e.g., INR/USD vs. USD/INR).

Do not hardcode one timeless legal rounding mode. Each effective-dated rule pack declares its rounding rules. Golden tests reconcile all components and rounding to totals.

### Time

**Accounting dates**: Calendar dates (LocalDate-like; no time component). "2026-03-31" means the whole accounting day. **Immutable once set; never reinterpreted by timezone.**

**Event timestamps**: Immutable UTC timestamps for audit and ordering. Every mutation records creation time, approval time, posting time separately.

**Tenant timezone**: Each tenant has an IANA timezone (e.g., Asia/Kolkata) for display only, midnight boundaries for scheduling/cutoffs, and interpreting external timestamps into proposed accounting dates. **Timezone is never used to retroactively redate an immutable posted transaction.**

**Fiscal-year settings**: Tenant configuration defines fiscal year start/end (e.g., April 1 – March 31). **Fiscal-year profile is effective-dated and versioned**; numbering and postings snapshot the applied fiscal profile at decision time. Later fiscal-year changes do not reinterpret historical sequences.

### Numbering

**Scope**: Tenant + applicable GSTIN (if any) + document family/series + financial year.

**Allocation**: Allocated at legal issue/finalization (not at draft creation).

**Monotonic/no reuse**: Every invoice, bill, note, receipt, payment, journal,
and reserved issuance series is tenant-scoped, serialized, monotonic, and never
reuses a number. This includes numbers reserved for an issuance-pending
candidate whose external attempt fails or times out.

**Preserve gaps**: Every gap, void, cancellation, reservation failure, and
failed issuance retains a durable number-gap record with series scope, number,
reason, request/operation ID, actor, timestamp, frozen payload/artifact hash
when applicable, and audit evidence. A failed reservation never releases its
number to the allocator.

**Example**: Invoice series "INV" for GSTIN 18AAXXX1234A1Z1 in FY 2025-26 → sequence INV/2025-26/18AAXXX1234A1Z1/001, INV/2025-26/18AAXXX1234A1Z1/002, etc.

### Optimistic and Explicit Serialization

**Default**: Optimistic concurrency (version check) for routine document edits.

**Exclusive locks** (serialization) for high-consequence operations:
1. Posting-number allocation (no concurrent same-series allocations).
2. Document finalization (atomic posting).
3. Period lock/unlock (state change).
4. Payroll finalization (affects 100+ employees).
5. Reconciliation decisions (bank matches).
6. Filing snapshots (immutable export).

Conflicts fail visibly; never last-write-wins.

### Idempotency

**Command envelope**: Every mutation includes:
- Request ID (deterministic or caller-supplied).
- Tenant context (required).
- GSTIN context (only if command metadata declares `gst_context=required`).
- Actor/source.
- Expected version (for optimistic concurrency).
- Timestamp.
- Reason (where required, e.g., unlock, reversal).

**Idempotency record**: Same request ID replayed returns same result without side-effect duplication. Different content with same ID is rejected as conflict. **Scope**: Idempotency lookups are tenant-scoped plus command/operation scope. If `gst_context=required`, effective GSTIN and payload are hash-bound; GSTIN is part of the idempotency key. If `gst_context=none`, GSTIN is not used or stored in idempotency records. Never return another tenant/GSTIN response.

### External Operations and Blind Retry Prevention

**ExternalOperation aggregate** (mutable current-state, tenant+ID scoped CAS versioned):
- **Tenant and GSTIN scope** (exact GSTIN if applicable, or null for non-GST operations).
- **Provider identity**: Bank, IRP, e-way bill gateway, GST Portal, etc.
- **Operation type**: E-invoice IRN request, e-way bill generation, bank API call, etc.
- **Internal request ID**: Local command/request ID; used for idempotency.
- **Payload hash**: Hash of complete request payload.
- **Provider idempotency key** (if supported): Bank transaction ID, IRP correlation ID, etc.
- **Provider request ID** (if assigned): Bank ref, IRP request number, etc.
- **Outbox intent**: What business action triggers if/when evidence_recorded; used for async resumption.
- **current_state** (mutable, versioned via CAS): Exactly one of:
  - `prepared`: ExternalOperation persisted BEFORE any external side effect. Request or artifact hash, tenant, GSTIN, provider, document correlation, and outbox intent recorded. Ready for its selected transport.
  - `submitted`: Sender durably CASes prepared → submitted and appends a pre-side-effect submission-intent observation. The external request or upload has been or may be attempted; `submitted` is not proof that it was sent or succeeded. For API, this CAS happens before dispatch; for manual, it happens before human upload and never permits automatic re-upload.
  - `known_success`: Authoritative provider or portal evidence confirms success. CAS from submitted, unknown, or manual_review → known_success with append-only observation.
  - `known_failure`: Authoritative provider or portal evidence confirms failure. CAS from submitted, unknown, or manual_review → known_failure with observation. A NEW separate retry operation may be created only for that same statutory obligation when explicitly authorized.
  - `unknown`: Timeout, no response, or missing authoritative provider status. Quarantined; not allowed to retry API or switch to manual submission while unknown.
  - `manual_review`: Authoritative lookup impossible or outcome ambiguous; requires human judgment to decide next step.
  - `cancelled`: Operation cancelled by user or policy before submission or after explicit policy-allowed cancellation.
  - `evidence_recorded`: Evidence (IRN, QR, EWB number, etc.) and signed response bytes persisted and verified accessible. Idempotent; re-reading and re-persisting evidence doesn't change state.
  - `business_finalized`: Domain business transaction (e.g., invoice issue-and-post) executed idempotently based on evidence_recorded; mutated aggregate versions incremented. Resume-safe: seeing business_finalized does not re-finalize.
- **version**: Incremented on each CAS state transition. Final transaction: WHERE id=? AND tenant=? AND version=expected, increments version, commits atomically, or rolls back on conflict.
- **Attempts**: Count and timestamps per state.
- **Response hash** and **response content** (truncated if large): What the provider returned.

**ExternalOperationObservation** (append-only immutable audit log):
- Immutable record of each state transition: timestamp, actor, request_hash, response_hash, old state, new state, reason, evidence references.
- State transitions and observations are separate: every CAS state change appends a corresponding observation. Observations do not mutate state.
- Enables audit trail and compliance verification.

**Direct automated transport enabled only if**:
- Provider supports a usable idempotency/correlation contract (e.g., correlation ID for status lookup), OR
- Authoritative status lookup exists by taxpayer document/reference (e.g., invoice number query on portal).

If neither exists, direct automation is disabled; only manual export/upload/import-response workflow may be used.

**Reconciliation action/checkpoint** (timeout, no response, provider unreachable, or ambiguous manual evidence):
- [TX] Quarantine an `unknown` outcome; neither API retry nor manual submission is allowed while it is unresolved.
- [EXT] Reconciliation queries the provider by correlation/idempotency identity or performs an authoritative portal/external lookup. For manual transport, the authoritative evidence must bind to the operation and its frozen artifact hash.
- [TX] Append the reconciliation request/response as an observation, then CAS `submitted`, `unknown`, or `manual_review` directly to `known_success` or `known_failure` only when authoritative evidence exists. `manual_review` may remain pending for human direction; it is not a replacement current state for reconciliation.
- Local pending state is not proof; only authoritative provider/portal confirmation resolves the outcome.
- Only after reconciliation completes may obligation-specific evidence recording, finalization/gating, or an explicit terminal-failure retry decision proceed.

Reconciliation is an action/checkpoint and append-only observation, not a `current_state` value.

---

## 8. Command Execution and Transaction Boundaries

### Deterministic Command Lifecycle (Numbered)

1. **Resolve tenant context** → validate exactly one active tenant; fail explicitly on ambiguity.
2. **Inspect command metadata** → determine `gst_context` (none or required).
3. **Resolve GSTIN context (if gst_context=required)** → validate active APPLICABLE registration; fail on ambiguity or zero APPLICABLE registrations. If `gst_context=none`, do not resolve GSTIN and clear any session GSTIN.
4. **Parse and validate versioned input** → reject invalid commands before any domain call.
5. **Authorization hook** → check actor permission and source context (no-op in v1; framework in place).
6. **Idempotency check** → if same request ID exists, return cached result; if different content with same key, reject conflict. Scope includes GSTIN only if `gst_context=required`.
7. **Load aggregate (read-only preview)** → fetch current state for plan generation; do NOT lock yet.
8. **Choose effective rules** → select versioned rule pack by date, GSTIN (if applicable), jurisdiction.
9. **Pure domain plan** → compute deterministic outcome (e.g., journal entries, tax amounts, validation errors).
10. **Show/validate gates** → return preview and plan hash/ID; require recorded explicit human confirmation where the operation's contract requires it (prepare/commit pattern).
11. **Load approval artifact** → for high-consequence actions, verify an unexpired plan/approval token matches the request payload (required by policy). For reconciliation or allocation, this artifact is not an authorization: only the separately recorded exact human confirmation described below can permit persistence.
12. **Atomic transaction** (final write):
    - **Load aggregate with expected version** → optimistic concurrency check (version=expected for conditional update; exactly one affected record; otherwise rollback/conflict). OR acquire exclusive lock for posting-number allocation, document finalization, period locks, payroll finalization, reconciliation, filing snapshots.
    - **Revalidate the plan/approval token, plan hash, and expected entity versions** (if required) inside the transaction.
    - **Write business state** + postings + audit + idempotency record (tenant-scoped, GSTIN-scoped if applicable) + outbox events.
    - **All succeed or all roll back**; no partial commits.
13. **Return stable result** → versioned JSON or human-readable output with request ID, effective tenant, GSTIN (if gst_context=required), rule versions, and outcome.

### Prepare/Preview → Validate → Commit (High-Consequence)

**For high-consequence actions** (period close, payroll finalization, filing snapshot, bank reconciliation):

1. **Prepare**: Compute plan without side effects; return preview and plan hash/ID.
2. **Validate**: A human reviews the preview and explicitly confirms it;
   hashes must match. An agent or skill may prepare and validate only; neither
   may approve a high-consequence action.
3. **Commit**: Recompute to verify plan matches preview; acquire locks; post atomically. If plan diverged, abort and re-prepare.

Dry-run is always side-effect-free.

### Plan and Approval Artifacts

**For high-consequence actions** (period close, payroll finalization, filing snapshot, bank reconciliation, plan/approval-gated operations):

**Plan/Approval artifact structure**:
- **Plan hash**: SHA-256 of the complete prepared plan (not the request, but the computed outcome).
- **Plan ID**: Short reference ID for human review.
- **Tenant and GSTIN scope**: Exact context binding.
- **Request payload hash**: Hash of the incoming request (for replay validation).
- **Entity versions**: Expected versions of all mutated aggregates at plan time.
- **Rule versions**: Effective-dated rule pack versions used in the plan.
- **Action class**: Posting, period-lock, payroll-finalize, etc.
- **Policy classification**: Actor and policy class are retained as non-authorizing metadata (auto-commit, requires-review, human-confirmation-required, etc.); policy, workflow, agent, and skill status never authorizes a reconciliation or allocation mutation.
- **Reconciliation/allocation confirmation**: For a bank match or payment
  allocation, this must be a recorded explicit human confirmation bound to the
  exact plan ID/digest, bank source line, target document/payment, amount,
  currency and FX snapshot, expected entity versions, tenant, actor, and
  timestamp. The binding must be cryptographic or deterministic. Auto-commit,
  policy, workflow, agent, or skill approval cannot substitute for it; missing,
  stale, or mismatched bindings return `RECONCILIATION_CONFIRMATION_REQUIRED`,
  `STALE_RECONCILIATION_PLAN`, or `RECONCILIATION_PLAN_MISMATCH`.
- **Expiry**: Plan tokens expire after a configurable TTL (e.g., 24 hours).
- **Immutability**: Signed/hashed; any modification invalidates the token.

**Enforcement**:
- Skills cannot skip required approval gates.
- Application services enforce plan/approval matching inside the final DB transaction (step 12 above).
- Authorization hooks bind actor and permission context (even though RBAC is deferred to v2).

### Evidence Write Protocol

**Atomic content-addressing for evidence**:

1. **Stage write**: Write evidence bytes to a temporary staging object (temp path or temp key).
2. **Fsync/complete**: Ensure bytes are durable on disk or remote object store (fsync on local, object-complete on S3, etc.).
3. **Compute and verify hash**: SHA-256 (or configured algorithm) of the byte stream; compare to expected if provided.
4. **Atomic promotion**: Move/rename temp object to final content-addressed location (e.g., `evidence/sha256/<hash>`) atomically.
5. **SQL commit**: Only after successful promotion, commit SQL metadata row with hash and storage reference.

**Rationale**: DB failure may leave orphan temp objects for garbage collection; SQL never references missing bytes.

**Remote adapters** (S3, etc.) provide equivalent guarantees via put-if-absent semantics and version tracking. Do not commit SQL reference until the provider confirms object durability.

**Backup and restore**: Backup includes actual evidence bytes (or a remote snapshot/version ID). Restore verifies every referenced object is accessible before activation.

### Batch Atomicity and Resumability

**Per-file/snapshot atomic**: Document import is atomic per file; all records in one file commit or all roll back.

**Per-item outcomes**: Accounting proposal returns per-item success/failure without hiding partial success.

**Explicit commit**: Results are shown; user explicitly selects items to post. Never silently apply majority rule or best-effort.

**Batch resumability**:
- Each item has a stable key/request ID; skill/batch uses them to track progress.
- Resumability state stores committed-item set (as a cursor or explicit set) and outcome for each item.
- Resume operation reuses the same item keys; never regenerates IDs.
- Upon resume, skip already-committed items; retry only items marked retryable/failed.

**Partial-success exit category**:
- Commands that process multiple items must distinguish success, partial success, and failure.
- Partial success = at least one item succeeded, at least one retryable/failed.
- Exit code for partial success must be **non-zero** (not success for shell automation).
- Output includes per-item committed/retryable/terminal states and a safe retry set.

**Batch command atomicity declaration**:
- Each batch operation must declare atomicity: per-file (all-or-nothing), per-item (independent outcomes), or per-batch (with specified rollback policy).
- Declared atomicity must be visible to user/agent.

### External Calls Outside Transaction

```
[Prepare request]
  → [Atomic TX: save durable pending state + generate request]
  → [Return request ID to user]
  → [External call (bank API, IRP, portal)]
  → [Durable evidence record: request hash, response hash, timestamp]
  → [Optional: immediate finalization TX if response success]
  → [Or: hold pending; user/agent reviews response]
  → [Finalization TX: post business outcome + evidence]
```

**Never inside transaction**: Network call blocks or timeouts; no Hail Mary retry; durable evidence records the outcome.

**Idempotent retries**: Same request ID + same input = same result, no duplicate postings or IRNs.

**Unknown outcome**: Timeout or response unknown → reconciliation skill must query external status and record actual state separately.

### Sequence Diagram: External Request → Evidence → Finalization

```
Command → [TX1: save durable pending request]
        → External call
        → [Async or skill-driven]
        → [TX2: record response evidence]
        → [TX3: finalize business outcome]
```

---

## 9. Module Ownership Table

Each module owns and must never own the listed state:

| Module | Owns | Must Never Own |
|--------|------|---|
| **Tenant/Config** | Tenant list, settings, registrations, locks, series allocators | Business transactions; documents |
| **Chart of Accounts** | Account definitions, hierarchies, types, GL structure | Document amounts; balances |
| **Contacts** | Supplier/customer/employee directory; contact details | Invoices; payments; claims |
| **Catalog (no inventory)** | Item/service descriptions, units, rates, tax treatment, default account | Stock levels; warehouse; COGS; batches |
| **Sales/Receivables** | Invoices, SO/PO drafts, advances, credit/debit notes, customer aging | Payment posting; bank matching |
| **Purchases/Payables** | Bills, PO drafts, credit/debit notes, vendor aging, ITC pending/matched | Payment posting; bank matching |
| **Expenses/Claims** | Employee claims, advances, reimbursements, corporate-card statements | Settlement posting; bank payment |
| **Payroll** | Employee profiles, salary structure, pay runs, payables, remittances, TDS/PF/ESI data, bank export | Tax filing; deposit; employee certificates |
| **Banking/Reconciliation** | Bank statements, proposed matches, reconciled matches, bank-fees separation | Ledger posting; cash balance derivation |
| **Ledger/Posting** | Immutable journal entries, account balances, audit trail, idempotency records | Document state changes; event sourcing |
| **Tax Engine** | Tax rules, rates, slabs, calculations (GST, TDS, TCS), tax component posting | Business rule changes; approval policies |
| **Compliance/Obligations** | Obligation engine, filing deadlines, predecessor gates, filing snapshots, amendments, ARN/evidence | Ledger truth; automatic filing decisions |
| **Fixed Assets** | Asset register, acquisition, depreciation runs, disposal tracking, separate book/tax schedules | Operating transactions; tax strategy |
| **Reporting/Export** | Report generation (P&L, balance sheet, aging, reconciliation, compliance exports), query/filtering | Ledger mutations; document state changes |
| **Audit/Evidence** | Immutable audit log, evidence storage, checksums, lineage tracking, compliance evidence | Ledger corrections; document retroactive changes |
| **Rule Packs** | Versioned, immutable rule manifests, declarative tables, calculators, signatures | Compliance decisions; tax policy exceptions |
| **Skills/Automation** | Job skill definitions, versioned manifests, orchestration logic, evidence gathering | Accounting rules; tax calculations; authorization |
| **Persistence/Adapters** | SQL dialects, schema, migrations, repository implementations | Domain logic; business rule calculations |

**Canonical ledger principle**: Ledger/Posting is authoritative. Reports never write. Tax/Compliance never infer filing status from portal assumption; records explicit evidence.

**Fixed-asset method status**: Separate book and tax schedules and SLM as the default book method are **T-003 OWNER-APPROVED**. See [Owner Decision T-003](discovery/tentative-decisions.md#t-003).
Exact statutory tax methods and rule-pack contents remain OPEN RESEARCH; the separate schedule model is reversible and settled.

**Capitalization ownership**: When an AP bill line carries asset-capitalization
metadata, that bill posting is the sole owner: `Dr Fixed Asset | Cr AP` and the
asset-register record is created from that source journal. Direct cash/manual
acquisition has its own one-time `Dr Fixed Asset | Cr Bank/Cash` journal.
The engine enforces unique `(tenant_id, source_document_id, source_line_id)`
and rejects any second capitalization, including a different capitalization
kind or journal; it never posts a bill-plus-manual duplicate.

---

## 10. State Machines

### Business Document State Machine

**Documents without external issuance gating** (most transactions):

```
Draft → Validated → Posted → Settled (zero signed open balance after allocation plus approved balanced credit/write-off/refund)
                      ↓
                  Void (pre-post reversal entry)
                  Correction (posted reversal + replacement)
```

**Documents with external issuance gating** (e.g., applicable e-invoice requiring IRN):

```
Draft → Validated → Issuance-Pending/Frozen (immutable candidate, number reserved with gap reason)
  → [IRP external call, unknown outcome reconciliation]
  → Issue-and-Post-Atomically (IRN/QR evidence recorded, number allocated, journal posted)
  → Settled (zero signed open balance after allocation plus approved balanced credit/write-off/refund)
    ↓
  Void (pre-post) or Correction (post reversal + replacement)
```

**Partial and Settled states**: Partial/open allocation is a derived view while
the document remains `Posted`; it is not `Settled`. A document reaches
`Settled` only when the signed open balance is zero after allocation plus an
approved balanced credit, write-off, or refund journal. Administrative or
audited close-out alone never settles AR/AP; aging derives from ledger/open-item
balances and cannot hide an uncleared amount.

**Issuance reservation failure**: An `Issuance-Pending/Frozen` candidate keeps
its frozen payload, artifact hash, operation observations, and reserved number
when reservation, submission, or external processing fails or times out. The
number becomes a durable gap/void record with reason and audit evidence; it is
never released or reused. A superseding attempt is a new child operation and
candidate with a new monotonic number linked to the failed lineage.

**Forbidden shortcuts**: Never skip validation. Never mutate posted documents; only reversal + replacement. Pre-post documents may be voided; posted documents require reversal lineage.

**Issuance concept**: Only applies to actions gated by effective external-authority rules. IRN gates e-invoice issuance/posting when effective rules require it. EWB gates goods movement when effective rules require it. ARN is post-filing acknowledgement evidence only; it never gates ledger posting. Each external reference gates only the exact action defined by its effective rule. Non-applicable documents bypass the gate and post directly after validation.

### Bank Statement Line State Machine

```
Imported → Proposed (skill-matched candidates) → Human-Confirmed (exact plan) → Persisted → Reconciled
```

**Distinction**: Proposal ≠ Match. Proposal is non-deterministic candidate; match is explicit validated persistence.

### Skill Run State Machine

```
Pending → Ready → Executing → Completed / Exception / Failed / Cancelled
```

### Statutory Preparation State Machine (Generic)

```
Prepared (local snapshot)
  → Locally Validated (internal checks pass)
  → Exported (local file created)
  → Uploaded (sent to portal/external system)
  → Portal-Processed (authority system received and processed)
  → Reviewed (user/CA portal review of results)
  → Filed (user/CA initiates filing with authority)
  → Acknowledgement/ARN Recorded (authority response evidence)
```

**Never use "accepted" unless the authority explicitly defines that state.**

### GSTR-1 Specific States

**GSTR-1 statutory states** (per GST Portal terminology, exact sequence with separate nodes):

```
Prepared (JSON drafted, no validation)
  → Locally-Validated (internal validation checks pass; human-readable preview created)
  → Uploaded (file sent to portal, timestamp recorded)
  → exactly one of:
     ├─ Portal-Processed (portal received, validation complete, no errors; success)
     │  → Portal-Summary-Reviewed (user/CA reviews on portal, confirms results)
     │  → Filed (user/CA files statement via DSC/EVC on portal)
     │  → ARN-Recorded (authority issues ARN; immutable evidence of filing)
     └─ Portal-Processed-With-Errors (portal received, validation detected errors)
        → Correct/Re-Upload/Reprocess (user corrects invoice data locally)
        → Uploaded (corrected file re-sent to portal; retry cycle)
```

**Non-filing states must be distinct**:
- Prepared is draft only; no validation embedded.
- Locally-Validated confirms internal checks before sending to portal.
- Uploaded ≠ Filed. Upload is file receipt; filing is authoritative submission.
- Portal-Processed ≠ Filed. Processing is portal validation; filing is user/CA action.
- Portal-Processed-With-Errors cannot progress until corrected, re-uploaded, and re-processed.
- ARN receipt is the canonical proof of filed status; everything before is preparation/review.
- JSON upload is not filing; no GSP/auto-submission boundaries (manual portal only for v1).

### Payroll Bank File State Machine

```
Generated → Uploaded → Accepted-by-Bank / Rejected-by-Bank → Debited → Reconciled
```

**Distinct states** (bank-specific terminology where the bank provider explicitly defines these states):
- Generated (file created)
- Uploaded (sent to bank)
- Accepted-by-Bank (format/receipt confirmed; payment not yet executed) OR Rejected-by-Bank (format error; payment blocked)
  - If Rejected-by-Bank: preserve rejection evidence; require corrected/new file. No debit, no payment posting, no reconciliation.
  - If Accepted-by-Bank: wait for debit execution.
- Debited (bank confirms account debit execution)
- After debit observed: [TX] Post exactly one balanced entry Dr Salary Payable | Cr Bank (no duplicate submissions/clearings).
- Reconciled (payment matched to bank statement)

Each state requires separate evidence and status observation.

### E-Invoice/E-Way External Request State Machine

```
prepared
  → submitted (durable pre-side-effect submission intent; request/upload has been or may be attempted)
  → one of:
    ├─ known_success (authoritative success)
    ├─ known_failure (authoritative failure)
    └─ unknown (timeout or no response)
       ── reconciliation action/checkpoint ──→ known_success | known_failure | manual_review

manual_review ── authoritative evidence and explicit human action ──→ known_success | known_failure

known_success → evidence_recorded (hash, timestamp, IRN/EWB number, provider confirmation)
              → obligation-specific business finalization or movement gate
```

**Transport ordering**: API CASes `prepared → submitted` before dispatch and relies on provider idempotency for safe retry; manual CASes before human upload and never automatically re-uploads. Reconciliation is the action/checkpoint and observation that resolves `submitted`, `unknown`, or `manual_review`; `Status-Reconciled` is not a current state. No blind retry: authoritative evidence must be recorded before finalization, movement gating, or an explicit terminal-failure retry.

---

## 11. Rules and Compliance Architecture

### Effective-Dated, Immutable Rule Packs

**Rule pack structure**:
- Versioned manifest: jurisdiction, applicability interval, official source/provenance, checksum, signature.
- Declarative tables: rates, slabs, dates, thresholds, exemptions (not embedded in code).
- Deterministic calculators: pure functions over tables; testable, auditable.
- Official fixture tests: public golden examples; reproducible.

**No prompts as law**: Accounting and compliance law never live only in skill prompts or agent logic. Law is in the rule engine or declared rule packages.

**Rule selection snapshot**: At decision time, freeze selected rule version and effective date. Later rule changes do not rewrite history.

### Stale/Missing/Ambiguous Rules Fail Closed

For dependent statutory operations (tax claims, payroll finalization, filing artifacts, e-invoice, e-way bill):
- Missing rule → **FAIL CLOSED** with explicit review/block outcome.
- Stale rule (superseded) → **FAIL CLOSED**.
- Ambiguous/conflicting rules → **FAIL CLOSED**.

For drafts and unrelated bookkeeping:
- Continue with explicit visible exception/warning.
- Never silently use newest or previous rule.

### Approved Mixed-Use Allocation Rules (Tenant-Scoped, Versioned, Immutable)

**Purpose and lifecycle**: For recurring expenses with both business and personal use (e.g., home-office rent, utilities), an allocation rule records an evidence-backed business/personal split. Its lifecycle is **proposed → explicitly human-approved → superseded**. An agent or skill may create or suggest only a proposal; it may never approve its own rule or silently imply approval. A separate deterministic approve action requires recorded human confirmation before transitioning the proposal to `human_approved`. Approved rules are immutable.

**Rule structure** (persisted separately from statutory rule packs):
- **Tenant and scope**: Legal-entity tenant plus premises, expense/vendor/category scope.
- **Method/formula and share**: Allocation basis and percentage or cap.
- **Evidence**: Supporting allocation workpaper, invoice split schedule, or CA recommendation.
- **Approval**: `actor_type` (must be `human`), approving human identity, `approved_at`, approval evidence/source, and immutable audit binding to the proposal, evidence hashes, and recorded human confirmation.
- **Version and effective interval**: Immutable version ID and a half-open effective interval; a new version supersedes the prior version and closes its interval at the new version's effective boundary.
- **Matching snapshots/fingerprints**: Persist normalized snapshots and fingerprints for premises characteristics; vendor/payee identity and classification; tariff/plan; usage basis/pattern; and applicable tax-rule version.

**Reuse and triggers**:
- Reuse only a `human_approved` rule for the same tenant/scope, within its effective interval, when all required stored match inputs remain equal and exactly one applicable rule exists.
- Missing or unverifiable match inputs produce `candidate_only` and require reapproval. Zero or multiple exact matches fail closed for rule reuse and require user resolution; gross bookkeeping posting remains allowed with a visible exception.
- Enforce non-overlapping applicable intervals per tenant and scope. Premises, tariff/plan, usage, vendor/payee classification, or tax-rule changes require a new proposal and version.

**Independence from tax treatment**:
- An approved allocation rule documents the split only; it does NOT determine tax deductibility, depreciation treatment, or GST ITC eligibility.
- s28(2) and s33(3)(b) restrict an otherwise allowable deduction/depreciation and do not themselves create entitlement; fair-proportion determination is assigned to the Assessing Officer having regard to business use. Do not imply utilities fall under s28(2). The approved split is a workpaper/input, not binding on the Assessing Officer or other tax authority.
- Tax treatment is assessed separately against effective statutory rules (Income Tax Act 2025 s28(2), s33(3)(b), s34, s62; CGST Act s16(2), s17, Rule 36) by CA review. Under GST, s16(2) carries invoice possession, receipt, tax-paid, and return conditions; s17 governs business/non-business and taxable/exempt apportionment and blocked credits. Allocation approval never grants ITC.
- Where Income-tax Rules 2026 Rule 46 applies, an internal memo, bank statement, or internal voucher may support a business-purpose explanation but never substitutes for a mandatory bill, receipt, original voucher, or payment voucher. A missing receipt never blocks gross posting; the required-record gap leaves the relevant tax lane incomplete and `review_required`.
- Allocation approval is not automatic tax approval; the CA may disallow, partially allow, or modify the tax claim regardless of the approved rule.

**Sole proprietor vs. company posting**:
- **Sole proprietor**: Books the business share to the relevant expense account and the personal share to drawings (not business expense).
- **Company**: If an employee/director paid personally, reimburse only the approved business share. If the company bank paid the full mixed-use bill, post the business share to expense/asset and the personal share to a named recoverable/receivable from the accountable individual, or use a separately reviewed payroll/perquisite treatment. Keep the double-entry balanced; never silently expense the personal share. No automatic tax treatment is claimed.

**Storage**: Rules are tenant-scoped and immutable (new version on change, never overwrite). The engine's deterministic approve action records the human confirmation and audit binding. Queries enforce tenant/scope and exact stored match inputs; they never silently choose among zero or multiple matches.

### Obligation Engine

**Components**:
- **Effective-dated registrations**: GSTIN, state, scheme, status, effective dates.
- **PAN-level AATO facts**: Source, rule version, effective dates; GSTIN-level applicability.
- **Obligation derivation**: Tenant/GSTIN/employer facts → set of applicable obligations (GSTR-1, GSTR-3B, GSTR-9, payroll TDS, PF, etc.).
- **Obligation snapshots**: Period, cadence, due-date rule/version, source, predecessor links.
- **Extensions**: New sourced rule versions (date extensions, postponements) immutable.
- **Predecessor gates**: GSTR-1 before GSTR-3B; GSTR-1 + GSTR-3B before GSTR-9; dependencies explicit.

**Immutable preparation/filing snapshots**: Snapshot of calculation, validation, and filing evidence at the time of obligation. Amendments link to originals.

### Portal Data as Evidence, Not Ledger Truth

GSTR-3B auto-population from ledger/GSTR-1/GSTR-2B is assistance, not authoritative. The product model is document-first:
- Reverse charge, imports, corrections, timing differences require books-based reconciliation.
- Portal population can be incomplete; never silently replace ledger with portal values.
- Explicit exceptions (RCM, imports) remain visible.

### Compliance Transport Boundaries (Settled and Open)

#### GSTR-1 (SETTLED Boundary)

**GSTR-1**: Outward supplies return; monthly or quarterly per registration profile.
- **Product**: Produces GST Portal-compatible JSON after local validation plus human-readable reconciliation and preview.
- **Workflow**: User or CA uploads, reviews, and files on GST Portal with DSC/EVC.
- **Recording**: Agent-bahi records upload/processing, portal errors, summary review, filed status, and ARN evidence.
- **Not filing**: JSON upload is not filing; no GSP/API submission.

#### GSTR-1A (Same-Period Amendments; Timing VERIFIED FACT; Transport OPEN RESEARCH/Filing-Specific)

**GSTR-1A** is a separate filing mechanism for same-period amendments:
- **Statutory timing (VERIFIED FACT)**: Available only after GSTR-1 is filed and before the same-period GSTR-3B is filed.
- **Amendments (VERIFIED FACT)**: GSTR-1A allows additions or corrections for invoices/credit notes/debit notes within same return period.
- **Prior-period amendments (VERIFIED FACT)**: Amendments to prior periods are not filed via GSTR-1A; they flow through later GSTR-1 tables.
- **After GSTR-3B (VERIFIED FACT)**: Once GSTR-3B for the period is filed, GSTR-1A becomes unavailable; no further same-period amendments via GSTR-1A.
- **Product (Architecture Domain)**: Prepare same-period amendment/addition candidate working papers linked to original GSTR-1 lines; validation checks predecessor (GSTR-1 filed and within window).
- **Recording (Architecture Domain)**: Agent-bahi records GSTR-1A candidate preparation and validation.
- **Transport/Upload/Filing/Acknowledgement (OPEN RESEARCH / Filing-Specific Decision)**: How agent-bahi transports, uploads, files, and records GSTR-1A evidence is a filing-specific decision, NOT settled globally. Do not inherit GSTR-1 transport semantics.

#### GSTR-3B (RECOMMENDED Default; Manual Portal)

- **Product**: Deterministic locked working paper/reconciliation derived from ledger, GSTR-1, and GSTR-2B.
- **Workflow**: User/CA manually reviews and files via GST Portal.
- **Recording**: Agent-bahi records evidence/ARN.
- **Open research**: Stable official GSTR-3B artifact (analogous to GSTR-1 JSON) is unconfirmed. Direct GSP submission remains **OPEN RESEARCH**.

#### E-Invoice (V1 Frozen at Manual Upload-File + Manual Portal; API Deferred)

- **V1 Boundary**: Upload-file/manual portal workflow only. Direct IRP API adapter submission deferred pending CMP-006 research closure and explicit owner approval. No direct API transport in V1.
- **Applicability**: Effective-dated rule selection within research-gated e-invoice rules; AATO thresholds, exemptions, invoice type (not a universal baseline threshold).
- **Transport**: Export to JSON file + manual upload to portal; import response evidence separately. No automated IRP API dispatch in V1.
- **Idempotency**: Same request cannot duplicate IRNs (applies to manual upload tracking, not API retries).
- **Blocking gate**: Applicable invoice not issued/finalized until IRN and signed QR evidence recorded via manual upload reconciliation.
- **Unknown outcome**: Reconciliation skill queries status from portal evidence; records actual evidence.

#### E-Way Bill (V1 Frozen at Manual Upload-File; API Deferred)

- **V1 Boundary**: Upload-file/manual portal workflow only. Direct e-way bill API adapter submission deferred pending CMP-007 research closure and explicit owner approval. No direct API transport in V1.
- **Applicability**: Effective-dated rules determine when EWB required; thresholds, exemptions, state rules remain **OPEN RESEARCH**. Research closure and owner approval required before any API transport or V2+.
- **Blocking gate**: Only when effective rules say required; block movement/dispatch until valid EWB evidence recorded via manual upload reconciliation.
- **No blind claim**: Absence of research does not mean "no EWB required."

#### Other Filings (Per-Filing Decisions, Not Settled Globally)

- **GSTR-9, TDS, income-tax, MCA**: Each filing requires separate researched decision. Absence of approved adapter means prepare/validate/export/manual/record evidence; does not imply global auto-filing ban.
- **CA bundle**: Immutable manifest + hashes + JSON/CSV/PDF/Markdown working papers, reconciliations, rule versions, evidence index, ARNs; no credentials.

---

## 12. Skills and Automation

### Versioned Skill Manifests

Each skill defines immutable metadata:

| Field | Content |
|-------|---------|
| **Purpose** | Job description and intended outcome |
| **Version** | Immutable version ID; effective_from/to dates |
| **Engine/Rule Compatibility** | Required agent-bahi engine version; rule pack versions |
| **Prerequisites** | Preconditions (e.g., tenant exists, period not locked) |
| **Inputs** | User, entity, period, records supplied by agent |
| **Evidence** | Required source evidence; quality expectations |
| **Allowed Commands** | Explicit CLI commands the skill may invoke |
| **Ordered Procedure** | Workflow steps; explicit pause points |
| **Validation** | Checks verifying intended outcome |
| **Automation Gate** | High-confidence conditions for auto-commit |
| **Exception Routes** | Named routes for ambiguity, missing evidence, failures |
| **Outputs** | Records, reports, exceptions, audit metadata |

### Deterministic Engine Gates, Not Agent Confidence

- Skills propose explicit candidates and evidence (e.g., bank match candidates).
- **Engine rules** and **per-action automation policy** decide whether work auto-commits.
- **Ambiguous/high-consequence** actions stop for review.
- **Confidence percentages do not bypass gates**. No heuristic "80% confident, so auto-commit."

### Explicit Automation Action Classes

Defined per-action with review/auto-commit policy:

1. **Read-only**: Evidence gathering, preview generation (no ledger mutation).
2. **Draft/preparation**: Create draft document, prepare snapshot (recorded explicit human confirmation before finalization where required).
3. **Accounting posting**: Post to ledger (requires explicit approval gate).
4. **Lock/override**: Period lock changes, draft edits past deadline (explicit reason, audit record).
5. **Statutory artifact**: Filing snapshot, export (immutable evidence; no auto-retry).
6. **External transmission**: Send to portal, API call (durable evidence; unknown outcome → reconciliation).

### Exception Taxonomy

Standard exception classes raised by skills:

- **Validation/blocking**: Missing required input; rule not applicable.
- **Missing evidence**: Source document absent; attachment not found.
- **Ambiguity/selection**: Multiple candidates; user choice required.
- **Review required**: High-consequence action; human judgment needed.
- **Retryable external**: Network timeout; temporary API unavailability.
- **Terminal external**: Invalid credentials; permanent API error.
- **Conflict/lock**: Concurrent mutation; period locked.
- **Permission denied**: Actor lacks authorization (v2+).
- **Internal invariant**: Ledger corruption; audit trail gap.

Each exception carries remediation context (e.g., candidates for selection, retry-after timestamp).

### Resumable Skill Runs with Checkpoints

- Durable checkpoints: command request IDs, input/evidence hashes, versions, outcomes.
- Explicit state: Completed / Exception / Failed / Cancelled.
- Infrastructure restart does not lose resumption context.
- Hashes and versions ensure idempotent replay.

### Allowlist-Based Skill Loading

- Load skills from explicit allowlist/configuration only.
- Include hashes and provenance for audit.
- No auto-discovered or arbitrary filesystem execution.
- Fallback: signed skill packages (future governance model).

### Initial Skill Catalog (Job Boundaries)

Versioned job skills without embedded accounting rules:

- Daily bookkeeper (routine posting, memo entries)
- Accounts payable (bill matching, payment proposals)
- Accounts receivable (invoice tracking, payment matching)
- Expense review (claim validation, receipt attachment)
- Bank reconciliation (statement import, match proposals)
- Fixed assets (acquisition, depreciation runs, disposal)
- Payroll accounting (run input, finalization, remittance)
- Month-end close (period lock, variance review)
- Year-end close (annual adjustments, filing prep)
- GST (obligation prep, GSTR-1, GSTR-3B review)
- TDS/TCS (deduction tracking, statement prep, return filing)
- Compliance calendar (obligation reminders, deadline tracking)
- Audit preparation (evidence export, control testing)
- Management reporting (custom report generation, drill-down)

---

## 13. CLI Contract for Agents

### Binary and Command Registry

- **Product binary**: `agent-bahi` (package, CLI command, binary name).
- **Command structure**: Noun/verb groups (e.g., `agent-bahi invoice create`, `agent-bahi gst compute`).
- **Command registry**: Domain-owned declarations (not CLI framework as source of truth).
- **Generated artifacts**: Parser bindings, human help, JSON schemas, skill references.

### Tenant and GSTIN Selection

**Tenant selection** (applied to every command):
- One active tenant: auto-select without `--tenant` flag.
- More than one active tenant: require `--tenant <name>` or named session context; fail explicitly on ambiguity.
- Echo effective tenant in all output.

**GSTIN selection** (conditional on command metadata `gst_context`):
- If `gst_context = none`: Do not resolve GSTIN; clear prior session GSTIN; reject `--gstin` flag; human output always shows `Tenant: <tenant_id>` plus exactly one `GSTIN: not applicable` line; JSON always contains `tenant_id` and `gstin_id: null`; do not look up, use, or store any GSTIN.
- If `gst_context = required`: Resolve ACTIVE+APPLICABLE registrations for command date/scope. Zero registrations: fail explicitly (no GSTIN applicable). One registration: auto-select without `--gstin` flag. Multiple registrations: require `--gstin <value>` or named session context; fail explicitly on ambiguity. Human output always shows `Tenant: <tenant_id>` plus exactly one `GSTIN: <actual identifier>` line; JSON always contains `tenant_id` and `gstin_id` with the actual identifier.

- **No silent defaults**: Ambiguity fails explicitly; no hidden last-choice memory.

### Human and JSON Output

- **Default**: Human-readable for TTY.
- **Explicit JSON**: `--json` flag returns stable versioned envelope.
- **Stderr/stdout**: Errors and progress on stderr; results on stdout.
- **Returned metadata**: Human output always shows `Tenant: <tenant_id>` plus exactly one GST line: `GSTIN: <actual identifier>` when `gst_context=required`, or the literal `GSTIN: not applicable` when `gst_context=none`. JSON always contains `tenant_id` and nullable `gstin_id`; it contains the actual GSTIN identifier when required and `null` when none. For `gst_context=none`, do not resolve, look up, use, or store any GSTIN. Also: report basis, period/date range, request ID, rule versions, warnings/exceptions, evidence references.

### Exit-Code Taxonomy

Stable, structured exit codes for orchestration and retry logic:

| Code | Meaning | Retry? |
|------|---------|--------|
| 0 | Success (all items committed/processed) | No |
| 1 | Validation error (bad input) | No |
| 2 | Ambiguity/selection required (e.g., >1 tenant) | User action |
| 3 | Conflict/lock (concurrent mutation, period locked) | Eventual retry |
| 4 | Compliance gate (missing rule, stale obligation) | Manual research |
| 5 | External retryable (timeout, temp unavailable) | Retry OK |
| 6 | External terminal (auth, permanent error) | No |
| 7 | Permission denied (RBAC v2+) | No |
| 8 | Internal error (ledger corruption, bug) | No |
| TBD | PARTIAL_SUCCESS (some items committed, some failed/retryable) | Retry safe subset |

**Partial success (named category: PARTIAL_SUCCESS)**:
- At least one item succeeded and committed; at least one item failed or is retryable.
- Exit code is non-zero; numeric assignment to PARTIAL_SUCCESS is a future CLI-contract/versioning decision (TBD).
- JSON output includes per-item states: committed, retryable, terminal.
- Safe retry set identified (retryable items only).
- Non-zero exit enables shell automation to detect and handle retry.

Never exit zero for partial or failed work.

### High-Consequence Flows: Prepare/Commit with Hash

For period close, payroll finalization, filing snapshot, bank reconciliation:

```
Command prepare → preview + plan hash
               → validate (user confirms, hashes match)
               → commit (execute, verify plan matches)
```

Low-risk operations (invoice draft, memo) may commit directly under policy.

`--dry-run` is always side-effect-free.

**Period unlock command contract**: Full unlock is
`period unlock preview --scope <global|module> --through <date> --reason <text>`
then `period unlock commit --preview <plan_id> --confirmation <human_confirmation>`.
Bounded partial unlock is
`period partial-unlock preview --scope <global|module> --from <date> --to <date> --reason <text>`
then `period partial-unlock commit --preview <plan_id> --confirmation <human_confirmation>`.
Preview binds the current lock version, scope/range, impact, actor, reason,
and plan hash. Commit revalidates them under serialization and requires a
recorded explicit human confirmation. Missing/stale preview returns
`UNLOCK_PREVIEW_REQUIRED`; invalid range/scope returns
`PARTIAL_UNLOCK_INVALID`; a changed lock returns `UNLOCK_CONFLICT`; missing
reason or confirmation returns `REASON_REQUIRED` or
`LOCK_CONFIRMATION_REQUIRED`. No skill or workflow may self-authorize a lock
change.

### Batch Atomicity Declared

Source ingestion: atomic per file/snapshot.

Accounting proposals: per-item outcomes; explicit commit selection.

Never hide partial success; never silently apply majority rule.

### Deterministic Ordering and Cursor Pagination

- **Listing**: Deterministic order (e.g., by ID, date, then name).
- **Pagination**: Cursor-based (stable across concurrent changes); never offset-only.
- **Agent workflows**: Agents can safely paginate without missed/duplicate rows.

### Cash/Accrual Flag Behavior

- **Basis-aware reports**: Accept optional `--basis cash|accrual`.
- **Default**: Tenant's default report basis.
- **Output**: Effective basis and date range in human and JSON output.
- **Fixed-basis reports**: Reject inapplicable basis flag with error; never ignore.
- **Compliance exports**: Use prescribed basis; basis flag is not an override.

### Secrets and Credential References

- **Never passed in shell history**: Use environment variables, OS keychain, or external vault.
- **Redact in logs**: Connection strings, API keys, DSCs scrubbed from operational logs.
- **Credential references**: Use named credential references in configs; actual credentials external.

---

## 14. Persistence, Evidence, and Adapters

### Domain-Independent Persistence

Domain and application layers import no ORM. Persistence contracts (ports) are defined in the application layer; adapters implement them in infrastructure.

### Technology Stack and Proof-Gated Candidates

**Note**: TypeScript + Bun is owner-selected. Prefer Bun-native APIs first. Third-party npm-compatible TypeScript packages are allowed only when needed, must be individually proof-gated, and must execute under the pinned Bun runtime. ORM, parser, validator, decimal, database-driver, migration, and build libraries remain unapproved candidates. Gate0 is mandatory evidence before implementation but is not authorized by this document, does not authorize Phase 1, and does not approve libraries.

- **Persistence**: Bun-native database APIs first. Drizzle, Kysely, better-sqlite3, and other ORM/driver candidates may be evaluated individually against bun-sqlite, PostgreSQL, and MySQL; none is pre-approved.
- **CLI parser**: Bun-native parsing first. Clipanion and other parser candidates remain unapproved and require individual proof.
- **Schema/validation**: Bun-native validation first. Zod and other validator candidates remain unapproved and require individual proof.
- **Decimal math**: Bun-native exact arithmetic first. decimal.js and other decimal candidates remain unapproved and require individual proof; all paths use the domain wrapper and never floats.
- **Migrations**: Separate SQLite, PostgreSQL, and MySQL histories with shared logical IDs and checksums. Migration libraries remain unapproved candidates and must prove fresh install, every supported upgrade, replay/checksum behavior, and pinned-Bun execution.
- **Testing**: bun:test (Bun native).
- **Build/distribution**: Bun build and one Bun-embedded platform-specific single-file executable for macOS arm64, Linux x64, and Linux arm64. Released operation must not require or invoke Node, a Node subprocess, a Node lifecycle hook, a separate Bun runtime, source distribution, or package/bin fallback.

### SQLite Default Configuration

**Filesystem requirement**: SQLite default is supported on local filesystems only. Fail closed at startup if filesystem cannot be verified.
- Resolve symlinks and detect mount type where possible.
- Refuse known network/sync filesystem paths (NFS, SMB, iCloud-style sync, WebDAV, FUSE, network mounts) with explicit startup error.
- If filesystem type cannot be determined/verified, refuse startup (fail closed).
- Direct users to PostgreSQL or MySQL for networked/remote deployments.
- Tests cover both known network paths (explicit rejection) and unknown/unprovable filesystem types (fail closed). Do not test or imply WAL support on network filesystems.

**Foreign keys**: `PRAGMA foreign_keys = ON` (referential integrity enforced).

**WAL mode**: Write-Ahead Logging for local filesystems (concurrent readers).

**Single serialized writer**: One writer at a time; `BEGIN IMMEDIATE` for high-consequence operations.

**Visible BUSY handling**: `SQLITE_BUSY` errors raised to application, never silently retried. Application decides retry logic.

**Short transactions**: Minimize lock duration; external calls outside transaction.

### Three Dialect Migration Histories

Separate, parallel migration paths:

- `migrations/sqlite/`: SQLite-specific DDL and migrations.
- `migrations/postgres/`: PostgreSQL-specific DDL and migrations.
- `migrations/mysql/`: MySQL-specific DDL and migrations.

**Shared logical IDs and checksums**: Each migration has a logical ID and checksum; all dialects apply equivalent changes.

**Never production push/sync**: Migrations are versioned, reviewed, and tested before release. No auto-schema-sync or schema-push in production.

**Testing gates**: Fresh install + every supported upgrade path tested on all three dialects before release.

### Content-Addressed Immutable Evidence

**Storage port**: Abstraction for evidence blob storage.

**Default**: Local filesystem beside app data directory (SQLite database + evidence directory).

**Metadata in SQL**: Hash, storage reference, content type, validation status, rule source, lineage.

**Immutable**: No mutable overwrite; versioning via new blob + new hash.

**Future adapters**: S3 or other cloud object storage via port implementation (no code changes).

**Backup/restore**: Backup includes actual evidence bytes (or verified remote-object snapshot/version ID, e.g., S3 object version) plus DB, manifest, hashes, rule/skill versions. Restore verifies every referenced byte/object is accessible and consistent (hashes match, counts reconcile) before activation.

### Secrets Redaction

No secrets in logs, exports, or audit bundles:

- API keys, DSCs, bank credentials → environment variables or vault.
- Connection strings in logs → redact passwords.
- Evidence bundles → no credentials; only references.

---

## 15. Reporting

### Canonical Source

All reports derive from canonical stored state (invoices, bills, payments, postings), never from mutable duplicates.

### Cash vs. Accrual Basis

**Report basis parameter**: Optional `--basis cash|accrual`.

**Default**: Tenant's configured default basis.

**Fixed-basis reports**: Compliance reports use prescribed basis; inapplicable basis flag rejected with error.

**Cash basis**: P&L recognizes income/expense pro rata from settled document
components on payment/allocation dates. A ₹100 invoice with a ₹40 payment
recognizes ₹40 cash-basis revenue and leaves ₹60 deferred; the next ₹60
payment recognizes the remainder. Unapplied cash and overpayments remain
balance-sheet controls until applied. Refunds reverse on refund/linked
allocation dates; credit/debit notes follow settlement/application dates.
Taxes follow the jurisdiction-specific cash/accrual rule and fail closed when
unknown. Realized FX and fees use settlement dates; revaluation and
depreciation remain accrual-only unless an explicit supported cash policy says
otherwise.

**Accrual basis**: P&L recognizes from posted invoice/bill journal dates.
Trial balance, balance sheet, and AR/AP aging remain ledger/as-of reports and
never silently switch to payment-date accounting.

### Report Output Requirements

**Human-readable**:
- Labeled basis and date range.
- Clear column headers.
- Subtotals and totals.

**Machine-readable (JSON)**:
- Versioned schema.
- Basis and date range fields.
- Original currency and base currency amounts.
- Metadata: rule versions, report version, timestamp.

### Report Types

- **Trial balance**: All accounts and balances.
- **Profit & loss**: Revenue, expenses, net result (cash/accrual basis).
- **Balance sheet**: Assets, liabilities, equity (balance-sheet date).
- **Aging reports**: Receivables, payables by due date.
- **Reconciliation**: Books vs. bank/portal; variances and exceptions.
- **Compliance exports**: GST, TDS, payroll (prescribed basis, statutory output format).
- **Tagged/split analysis**: By reporting dimensions (project, location, etc.); drill-down.

### Report Generation is Read-Only

Reports never write to ledger or mutate documents. Read-model rebuilding is optional (for performance only).

---

## 16. Eight End-to-End Workflows

Concrete numbered steps; `[TX]` = database transaction, `[EXT]` = external action, `[REVIEW]` = human/agent review.

### 1. Invoice Draft → Issue/Post → Payment → Bank Reconciliation
**(Ordinary invoice workflow. For any invoice with an IRN/e-invoice or EWB obligation, see Workflow 7.)**

1. Agent/user creates invoice draft (items, tax).
2. [REVIEW] Draft validation (SKU, tax applicability).
3. [REVIEW] Determine the full statutory obligation set using effective-dated rules: IRN/e-invoice required, EWB required, both, or neither.
4. If either IRN or EWB applies, **invoke Workflow 7; no EWB-only invoice may bypass it**:
   - If IRN is required, Workflow 7 controls invoice issue/business finalization until IRN evidence is `evidence_recorded`.
   - If EWB is required without IRN, Workflow 7 creates and processes the EWB `ExternalOperation`; the invoice may post/issue independently, but dispatch/goods movement is held until EWB evidence is `evidence_recorded`.
   - If both apply, IRN evidence gates invoice finalization and EWB evidence independently gates dispatch/goods movement.
5. If neither IRN nor EWB applies:
   1. [TX] Finalize invoice → allocate number → post balanced journal entry:
      - Dr. Accounts Receivable (total invoice amount) | Cr. Revenue (taxable/net amount) + Cr. Output Tax (tax components, if applicable).
   2. [EXT] Issue invoice to customer (email, portal, external system).
   3. Bank statement arrives; includes customer payment.
   4. Bank reconciliation skill prepares a non-posting match plan binding the
      statement line, target invoice, payment inputs, amount, currency/FX
      snapshot, expected versions, tenant, actor, timestamp, and plan digest.
   5. [REVIEW] A human explicitly confirms that exact plan. An agent or skill
      may propose and validate only; neither may approve.
   6. [TX] Revalidate the confirmation, versions, and idempotency key. First
      create/post the payment to `Dr. Bank | Cr. Unapplied Customer Receipts`;
      then apply the confirmed allocation with `Dr. Unapplied Customer
      Receipts | Cr. Accounts Receivable`, in the same atomic transaction.
      No allocation can reference an unposted/nonexistent payment, and retry
      cannot duplicate cash.
   7. Derive invoice state from the remaining unallocated amount: a positive
      remainder leaves the invoice `Posted` with a `Partially Allocated`
      derived status; zero remainder makes it `Settled` only after the signed
      AR balance is zero. An approved balanced credit, refund, or write-off
      journal may be the final zeroing event; administrative close-out alone
      never settles it.

### 2. Vendor Bill → Posting/Payment → ITC Pending/Matched/Claimed Reconciliation

1. Agent/user creates bill draft (items, tax invoice particulars).
2. [REVIEW] Validate bill (vendor, tax invoice number, HSN if required).
3. [REVIEW] Check ITC eligibility facts at posting time:
   - Statutory particulars present (invoice date, number, GSTIN)?
   - Rule 36(1) prescribed document present (supplier s31 invoice, recipient s31(3)(f), s34 debit note, bill of entry, ISD invoice, etc.)?
   - Reverse charge or import condition applicable per effective rules?
   - GSTR-2B match or supplier communication already available?
   - Other effective-rule conditions (tax payment date, time bar, advance payment terms)?
4. [TX] Finalize bill → allocate number → post balanced journal **DETERMINISTICALLY**:
   - **Always post**: Dr. Expense/Asset (gross amount) | Cr. AP (invoice total). Never block the gross posting due to missing evidence.
   - **ITC lane state (non-ledger, separate from gross posting)**: Mark state independent of gross posting decision:
     - If all Rule 36(1) prescribed-document and effective-rule conditions confirmed: Mark as Eligible candidate (subject to later 2B match and time bar verification).
     - If Rule 36 prescribed document missing: Mark as Pending-Prescribed-Document (ITC lane remains pending; no claim yet; gross posts).
     - If prescribed document present but other conditions incomplete (tax payment, time limit, reverse-charge determination): Mark as Pending-Other-Conditions (ITC lane remains pending).
     - If reverse charge or import detected and conditions are candidates (document present, payment pending): Mark as Pending-Conditions; ITC lane remains candidate under RCM/import specific rules.
     - If evidence exception approved (e.g., receipt promised/delayed): Mark as Exception-Open; ITC lane remains pending/ineligible; gross posts with exception record.
     - If Rule 36 condition failed (no prescribed document, time bar, blocked supply): Mark as Ineligible (gross posts; ITC claim never occurs).
5. [EXT] Portal/vendor statement provides GSTR-2B autofill (evidence gathered).
6. Agent/skill reconciles GSTR-2B with booked bills.
7. [REVIEW] ITC eligibility reconciliation (only after all effective-rule prerequisites pass):
   - Document exists, valid, and statutory particulars complete? (Yes/No/Exception)
   - Supplier GSTIN present and matched in GSTR-2B? (Yes/No/Unknown)
   - Reverse charge or import applicable per effective rule? (Yes/No/Exception; rule-driven, not heuristic)
   - All required evidence sources present (invoice, proof, communication)?
8. [TX] Transition ITC candidate state (non-ledger) to final classification:
   - Pending-Evidence / Candidate → Eligible (all prerequisites and evidence/2B conditions met) OR Ineligible-with-reason (missing evidence or rule bar).
   - RCM/Import → Reclassify per rule outcome: recoverable or blocked.
   - Matched: Link to GSTR-2B line entry as evidence.
9. [TX] Only after eligible classification confirmed AND every effective-rule prerequisite/evidence/2B condition passes: Post reclassification journal:
   - Dr. ITC Recoverable | Cr. the original expense/asset cost account(s) for the same allocated tax portion.
   - Never credit nil; always reconcile to the gross amount allocated at posting.
10. Payment due date arrives. This changes aging/reminder status only; due date
    alone never clears AP and never makes the bill settled.
11. [TX] After an actual, validated supplier payment is observed, a human
    confirms the exact allocation plan, and that confirmation is bound to the
    plan ID/digest, source line, target document/payment, amount, currency and
    FX snapshot, expected versions, tenant, actor, and timestamp, first post
    `Dr. Unapplied Supplier Payments | Cr. Bank/Cash`, then apply it with
    `Dr. AP | Cr. Unapplied Supplier Payments`, in one atomic transaction.
    No allocation references an unposted payment; idempotency prevents
    duplicate cash. A vendor credit allocation is the other explicit clearing
    path; neither a due date nor a bank-file export clears AP.
12. GST return prep reflects ITC claim sourced from eligible booked bill + matching evidence (never portal-only, never GSTR-2B-alone). Claim/utilization state is separate from eligibility/reclassification; Portal 2B alone never proves eligibility.

### 3. Statement Import → Proposed Match → Explicit Persistence

1. User uploads bank statement (CSV from bank).
2. [TX] Import as statement batch (if any error, full batch rejected).
3. Skill invokes bank-reconciliation flow.
4. Skill gathers open AR/AP records; proposes matches (non-deterministic, may fail to match).
5. [REVIEW] Skill surfaces candidates: amount, date, vendor/customer.
6. [REVIEW] A human explicitly confirms the exact match plan. The persisted
   confirmation is cryptographically or deterministically bound to the plan
   ID/digest, source line, target document/payment, amount, currency and FX
   snapshot, expected versions, tenant, actor, and timestamp. An agent, skill,
   scheduler, workflow, or policy cannot approve the match.
7. Skill invokes CLI `reconciliation match` only with that recorded human
   confirmation bound to the selected plan.
8. [TX] CLI validates tenant, account, currency, amount, confirmation binding,
   state transitions, and idempotency.
9. [TX] Persist match + provenance (skill version, evidence hash, human
   confirmation, actor, and outcome); no workflow can self-authorize.
10. Remaining unmatched items shown for next cycle.

### 4. Payroll Inputs → Compute → Review/Finalize → Journal → Payslip → Bank CSV → Debit/Reconcile → Statutory Evidence

**Prerequisites before any statutory deduction/finalization**:
- Effective employer/establishment registrations and coverage orders (required, unknown blocks).
- Establishment type, location/jurisdiction, headcount history (required; unknown blocks; headcount matters if rules depend on it).
- Work location(s) for employee (may differ from home state; required for applicability determination).
- Applicable PT/LWF registration per work location/state (required if applicable per rule; unknown blocks).
- ESI coverage order/registration plus employee coverage facts and wage history where required (required if applicable; unknown blocks).
- EPF establishment registration, employee member status, and wage history where required (required if applicable; unknown blocks).
- Employee applicability facts: tax identity, prior-year wages, coverage elections (required where rule depends; unknown blocks).
- Rule versions and effective dates for all applicable statutes (required; frozen at run time; unknown blocks).

Workflow:
1. Agent/user configures: employer registration, establishment (type, location, jurisdiction, headcount).
2. [REVIEW] Validate employee coverage facts:
   - Employer registration, establishment type, location/work state → statutory registration applicability.
   - Employee work location (may differ from home state) → determine applicable statutory registrations.
   - Employee existing identity, member status, coverage elections.
   - Effective tax year and rule version (frozen at run time).
   - **BLOCK if**: Any prerequisite registration, fact, or rule version unknown. Do not infer or guess.
3. Agent inputs payroll period, pay days, loss-of-pay days, approved overtime amounts/hours (from HR system or manual).
4. [TX] Create payroll run (draft, versioned inputs from step 1–3, frozen rule snapshot).
5. [TX] Compute statutory obligations per frozen rule version:
   - Gross per component (salary, bonus, etc.).
   - Employee and employer statutory deductions/contributions per frozen rule (TDS, PF, ESI, PT, LWF).
   - Never shift employer contributions to employee; keep distinct.
   - Net pay (gross earnings minus employee deductions).
6. [REVIEW] Show payroll summary per employee; review deductions; approve finalization.
7. [TX] Finalize run → post balanced journal:
   - Dr. Gross salary/wage expense (per component account) | Multiple entries.
   - Dr. Employer-contribution expense (PF, ESI, PT, LWF per applicable account) | Multiple entries.
   - Cr. Employee-deduction liabilities (TDS, PF, ESI, PT, LWF per applicable account) | Multiple entries.
   - Cr. Employer-contribution liabilities (PF, ESI, PT, LWF per applicable account) | Multiple entries.
   - Cr. Net-pay employee payable.
   - Balanced: Debits (gross + employer contributions) = Credits (employee deductions + employer liabilities + net pay).
   - Entry links frozen inputs, rule versions, and audit metadata.
   - Do not reference statutory form names, section numbers, or thresholds; use effective rule pack versions.
8. [TX] Generate payslips + bank CSV export from configured preset version. Payslips are separate from statutory employee certificates and are not delayed by the later filing or certificate gate.
9. [EXT] **Bank file workflow**:
    - User uploads bank file to bank portal (export ≠ payment; export ≠ debit).
    - [TX] Record accepted_by_bank OR rejected_by_bank state (bank provider confirmation of receipt/validity).
10. **If rejected_by_bank** (format error; payment blocked):
    - [TX] Preserve rejection evidence; require corrected/new file.
    - No debit, no payment posting, no reconciliation. Stop here; restart from step 9 with corrected file.
11. **If accepted_by_bank** (format/receipt confirmed; payment not yet executed):
    - Wait for bank to process ACH/transfer and debit account.
    - Bank returns statement.
12. [EXT] **After debit_observed**:
    - [TX] Post exactly one balanced entry: Dr. Net-Pay Employee Payable | Cr. Bank (no duplicate submissions/clearings).
    - [TX] Bank reconciliation skill matches statement debit to export record and reconciles.
13. [TX] Calculate statutory deposit liability (date-scoped per rule version; not deduction date but deposit/filing deadline).
14. [EXT] **Government deposit/remittance** (separate from bank payment):
    - User prepares and remits statutory amounts per effective obligation (e.g., TDS, PF, ESI) via bank challan or portal.
    - [EXT] Payment/debit evidence observed (transaction ID, receipt timestamp).
    - [TX] After actual government payment/debit confirmed: Post exactly one balanced entry Dr. [applicable statutory liability account] | Cr. Bank.
    - [TX] Record challan/portal evidence and reconcile to payment evidence.
15. [EXT] **Government statement/return filing** (separate from employee certificate delivery):
    - [EXT] User files statutory return on government portal (e.g., quarterly TDS statement, PF return).
    - [TX] Record filing evidence (timestamp, method, response).
    - [TX] Record acknowledgement/ARN and authoritative processing evidence, if returned or required by the portal/authority.
16. [EXT] **Employee certificate generation and delivery** (after the required government statement is acknowledged/processed; separate from filing):
    - [TX] After the required filed statement is acknowledged/processed, generate statutory documents (form/certificate/declaration) from frozen payroll data + deposit evidence and use the portal/authority artifact where required.
    - [EXT] Verify receipt by employee (where required).
    - [EXT] Deliver to employee (email, portal, etc.).
    - Certificates are NEVER uploaded/filed to government portal as "certificates"; they are delivered to employee.
    - Certificates do NOT receive ARN; they are employee deliverables, not government filings.
17. **Distinct outcomes/obligations** (separate states and evidence):
    - **Payroll deduction**: Computed, posted via payroll run (frozen inputs, rule version).
    - **Bank file export**: Generated from configured preset; uploaded to bank.
    - **Bank acceptance/rejection**: Separate state; if rejected, requires corrected/new file.
    - **Bank debit**: Observed via bank reconciliation; separate state from payment posting.
    - **Payroll payment**: Balanced journal Dr Net-Pay Payable / Cr Bank after debit observed (posted once).
    - **Bank reconciliation**: Matches debit to export record.
    - **Government deposit/remittance**: Separate bank remittance per effective obligation; posted after debit confirmed.
    - **Government return/statement filing**: Separate portal submission; not same as certificate delivery.
    - **Filing acknowledgement/ARN**: Portal response to filed return only.
    - **Employee certificate generation**: Derived from frozen payroll + deposit evidence after required filing acknowledgement/processing; use the portal/authority artifact where required.
    - **Employee certificate delivery**: Employee receives document; no government upload; no ARN.
    - **Employee claim/evidence**: Employee declarations or investment proofs; input prior to payroll run.

    Do not combine or skip these steps. Each has distinct actors, timing, evidence, prerequisites, and audit requirements.

18. **No unverified form/threshold assumptions**: This architecture stores effective rule versions and evidence states; it does not assert statutory form numbers, section numbers, thresholds, transitions, or eligibility rules without effective-dated source and tenant applicability research. See [Payroll Compliance Matrix](discovery/payroll-compliance-matrix.md) and OPEN RESEARCH sections. Payroll accepts prescribed employee declarations and evidence per effective rule packs; the architecture does not embed specific form, section, or threshold references in workflows.

### 5. Late Document in Locked Period → Preview → Explicit Branch (Original-Date Unlock + Reversal OR Current-Period Adjustment)

1. Agent attempts to finalize invoice dated 2026-03-15 (March 2026).
2. Period lock enforced: `locked-through = 2026-03-31`.
3. CLI rejects create/finalize with "PERIOD_LOCKED" error (names locked period).
4. Skill invokes `period late-document preview` to assess two distinct branches (never auto-select).
5. [REVIEW] Two branches presented; human must explicitly choose ONE:
   - **Branch A: Original-Date Correction via Unlock + Reversal + Replacement**
     - Unlock March period with explicit reason and preview.
     - Post invoice at original 2026-03-15 date.
     - Later when period is reopened: record reversal lineage.
     - Relock March period after work complete.
     - Branch A allows the invoice to reflect the actual original date; prior locked-period journals/state remain, new invoice posts in its own sequence.
   - **Branch B: Current-Period Adjustment (Keep Old Period Locked, Post New Entry)**
     - Keep March locked; do NOT unlock.
     - Create a current-period (April 2026) linked journal/adjustment entry that reconciles the late discovery against original month.
     - Original March journal/state immutable; April receives the correction entry.
     - No reversal or replacement of original; linked as separate current-period adjustment.
6. Human selects exactly one branch and provides reason (e.g., "customer dispute resolved, backdated invoice discovered").
7. **Branch A Path** (Unlock + Original Date):
   - [TX] Unlock with reason, actor, audit record; impact preview confirmed and locked-version/scope validated.
   - [TX] Finalize invoice at 2026-03-15, post balanced journal.
   - [TX] Relock period with new audit entry after work complete (operator may reopen/reclose as needed).
   - Original locked-period state and any subsequent entries remain; only this invoice added to its original date.
8. **Branch B Path** (Current-Period Adjustment, Old Period Stays Locked):
   - [TX] Do NOT unlock March period.
   - [TX] Create and post a current-period journal dated April 2026+ that links to the original March fact and records the correction.
   - Original March remains locked; April entry is visible as linked adjustment with source reference and reason.
   - No reversal or re-posting of March; correction is a separate April entry explicitly linked to original.

### 6. GSTR-1 Preparation → JSON → Manual Portal → ARN

1. Agent/skill invokes `gst prepare gstr1 --period 2026-Q2 --gstin <value>`.
2. [TX] Compute: outward supplies, HSN summary, amendments, documentcounts from ledger.
3. [TX] Validate: correct GSTIN, required fields, no duplicate/invalid amendment links, sequential filing predecessor met.
4. [TX] Generate JSON + human-readable preview (amounts reconcile, HSN coverage, state-wise split).
5. [TX] Save immutable snapshot (JSON hash, validation result, rule version).
6. Agent/user reviews preview.
7. [EXT] User downloads JSON, uploads to GST Portal.
8. [EXT] Portal processing (errors or success).
9. [TX] Agent records upload evidence (timestamp, errors if any, user entry).
10. [EXT] User reviews on portal, files with DSC.
11. [TX] Agent records filing (timestamp, signer method, ARN received).
12. GSTR-3B preparation later can reference filed GSTR-1 ARN as prerequisite satisfied.

### 7. Applicable E-Invoice IRN and E-Way Bill Flow (V1: Manual Upload-File Workflow Only)

**V1 Boundary**: Direct IRP API and e-way bill API are unavailable in V1. V1 supports upload-file/manual portal workflow only. Direct APIs require CMP-006/007 research closure and explicit owner approval (post-V1).

**Applicability check happens BEFORE issue/post or dispatch. It returns an obligation set: IRN/e-invoice required, EWB required, both, or neither. The following is one sequential flow; each statutory obligation is handled independently:**

1. [TX] Validate the invoice draft (items, tax, movement facts, and required statutory particulars).
2. [REVIEW] Determine the obligation set using effective-dated rules (AATO applicability per e-invoice rules only, invoice type, exemptions, movement facts, and applicable e-invoice/e-way-bill rules): IRN/e-invoice, EWB, both, or neither.
3. If the obligation set is **neither**, return to Workflow 1 step 5 for ordinary invoice finalization. Workflow 7 creates no external operation in this case. Stop.
4. [REVIEW] Preview the invoice content, obligation set, rule versions, reserved invoice number (if IRN applies), and dispatch requirements (if EWB applies).
5. **V1 Manual-Only Transport**: No API transport selection in V1. All applicable obligations use manual upload-file workflow: export to artifact (JSON for IRN, EWB form for movement), then user uploads to portal manually.
6. **Single atomic orchestration setup transaction** for the manual upload attempts — one operation per statutory obligation attempt, not one operation per invoice:
   - Freeze the invoice basis. If IRN applies, freeze the issuance-pending candidate and reserve the statutory invoice number ONCE with an "awaiting-IRN" gap reason. If IRN does not apply, do not create an IRN gate or reserve an IRN gap. A reservation, submission, or external failure never releases that number: retain the frozen candidate, attempt observations, void/gap reason, and artifact hash, then link any superseding retry to a new child candidate and new number.
   - For each applicable obligation, freeze the exact API request or manual export artifact and its hash. For `manual`, durably store the exact artifact bytes and compute the hash before creating its operation; the prepared operation is bound to those immutable bytes/hash.
   - If EWB applies — whether EWB-only or IRN+EWB — create a durable `dispatch_hold` tied to the invoice and the EWB obligation. If EWB applies without IRN, atomically post/issue the invoice once in this same transaction, then create the hold; do not wait for EWB evidence to post. The invoice post and hold occur before the prepared EWB operation and its intent are inserted, and none are visible until this transaction commits. On an IRN+EWB invoice, keep the invoice pending IRN finalization while still creating the hold in this transaction.
   - For each applicable obligation and attempt, create exactly one `ExternalOperation` with `operation_kind = irn` or `ewb`, `current_state = prepared`, tenant/GSTIN/document correlation, and `transport_type = manual`.
   - Persist each operation's idempotency identity (internal operation/request identity).
   - Create exactly one durable outbox/submission intent corresponding to each operation and obligation: IRN evidence permits invoice finalization; EWB evidence releases the existing dispatch hold. Do not combine intents.
   - **Commit all invoice state/posting, dispatch holds, frozen payload/artifact bindings, prepared operations, and intents atomically. Manual-upload tracking and portal reconciliation occur after this commit.**
7. **Manual Upload-File Workflow (V1 Only)** (for each committed operation):
   - [TX] CAS `prepared → submitted` and append the durable submission-intent observation **before** permitting human portal upload. **COMMIT.** The `submitted` state means upload may already have happened.
   - After `submitted` is durable, export and persist the exact frozen artifact bound to this operation. Never auto-generate, mutate, auto-upload, or auto-reupload a different artifact.
   - [EXT] The human downloads the artifact, uploads it to the government portal manually.
   - [EXT]/[TX] Reconcile authoritative portal evidence (user provides ARN or rejection response from portal). Portal evidence must bind to this operation and match its artifact hash. A mismatch or absent/ambiguous evidence remains `manual_review`.
   - With authoritative evidence (ARN received or portal rejection confirmed), [TX] CAS `submitted → known_success` or `known_failure` and append the response observation. If `known_success`, [TX] verify/store this operation_kind's evidence (IRN/QR for IRN, EWB number for movement), then CAS `known_success → evidence_recorded` and append the observation. Proceed to step 9 for the obligation-specific gate.
   - If `known_failure` (portal rejection): record the authoritative error for this obligation and stop this operation. No auto-retry or fallback. Operator may explicitly create a new child operation and re-prepare with corrected data.
8. **Explicit new attempt after terminal `known_failure`, per obligation only** (V1 Manual Workflow):
   - A new attempt is allowed only as a NEW child/retry `ExternalOperation` for the same `operation_kind`, explicitly authorized by the operator and linked to the failed parent.
   - The child gets its own atomic setup transaction (as in step 6), its own frozen artifact hash, idempotency identity, and evidence tracking. The failed parent never finalizes. Repeat step 7 for the child. For an EWB-only child, retain the already-posted invoice and existing dispatch hold; do not repost or create a duplicate hold.
9. **Apply the obligation-specific gate** after each operation independently reaches `evidence_recorded`:
   - If IRN is required, that IRN evidence triggers the atomic invoice finalization in step 12.
   - If EWB is required, that EWB evidence atomically releases the `dispatch_hold` for dispatch/goods movement. It never finalizes the invoice and never substitutes for IRN evidence.
   - If both are required, release the invoice and dispatch gates independently: IRN evidence gates invoice finalization and EWB evidence gates dispatch. Neither evidence substitutes for the other.
10. **Atomic invoice finalization for an IRN-required invoice** (requires the IRN operation's `current_state = evidence_recorded`):
   - [TX] In one transaction, verify the IRN/QR evidence is accessible and bound to the IRN operation; finalize the invoice using the reserved number (do not re-allocate); post the balanced journal: Dr Accounts Receivable (total) | Cr Revenue (net) + Cr Output Tax (if applicable); CAS that operation `evidence_recorded → business_finalized` and append the observation; and honor only its exactly-one IRN intent atomically. Any CAS or validation failure rolls back the entire finalization.
   - Resume-safe: if the process crashes, resume sees `business_finalized` and does not re-finalize. An EWB operation remains a separate dispatch gate.
   - [REVIEW] Confirm on CA/user side if required.

### 8. Cash/Accrual/Tagged Report Generation

1. Agent invokes `report profit-loss --basis accrual --start 2026-01-01 --end 2026-03-31`.
2. [TX] Query ledger postings for P&L accounts (revenue, expenses) in accrual basis (invoice dates).
3. Generate report: Gross revenue - Expenses = Net profit. V1 has no inventory or automated COGS; the report must not invent a COGS line.
4. [REVIEW] If tags defined, agent requests `report profit-loss --basis accrual --tag Project-A`.
5. Query applies tag filter: only lines with Project-A tag included.
6. [TX] Generate JSON with effective basis, date range, rule version, tag applied.
7. Report shows base-currency totals, drill-down to original currency.

---

## 17. Security, Privacy, Audit, and Recovery

### Threat Model and Controls

| Threat | Control |
|--------|---------|
| Wrong tenant/GSTIN posted silently | Explicit context resolution; echo effective tenant/GSTIN in output; fail on ambiguity |
| Secret leakage (API keys, DSCs, creds) | External secret references; redact from logs; no credentials in exports |
| Evidence/rules tampered undetected | Content-addressed hashes; signatures on rule packs; immutable audit trail |
| Unauthorized future actor modifies history | Audit trail records actor; authorization hooks (RBAC v2+); immutable past records |
| Unsafe plugin loaded/executed | Allowlist-based skill loading; hashes; no auto-discovered code |
| Logs/telemetry leak financial data | Redacted operational logs; sensitive detail in audit subsystem only |
| Backup loss or corrupted restore | Immutable evidence; backup verification (hashes, row counts); restore-in-isolation testing |
| Partial external outcome lost | Durable outbox/saga; idempotent retries; evidence recorded before finalization |

### Actor Context Now; RBAC Later

- **v1**: Every mutation accepts actor and source context (threaded through domain calls).
- **v2**: Authorization hooks (`checkPermission(actor, action, resource)`) present but no-op.
- **Audit trail**: Actor recorded in every AuditRecord; enables forensics and future enforcement.

### Audit and Evidence Retention

**Audit subsystem**: Immutable records of every state change, actor, timestamp, change summary.

**Evidence subsystem**: Content-addressed blobs, metadata (hash, checksum, validation status, rule source), lineage.

**Retention periods**: OPEN RESEARCH / effective-policy decisions, not settled globally.
- Store retention policy/rule source/version/jurisdiction with each document/record.
- Permit retention longer than initial guidance; no automatic deletion.
- Research and apply effective statutory/regulatory periods per jurisdiction and document type.

### No Sensitive Details in Operational Logs

Operational logs and metrics redact financial values, PII, bank data, tokens, documents by default. Include only:
- Request ID
- Actor (pseudonym or ID)
- Source
- Action
- Timestamp
- Outcome

### Backup and Restore Verification

- **Backup scope**: Database + actual local evidence bytes (or verified consistent remote-object snapshot/version ID, e.g., S3 object version/tag) + manifest + hashes + rule/skill versions.
- **Backup verification**: Verify every referenced byte/object is accessible, checksums match, row counts reconcile, before declaring backup successful.
- **Restore procedure**: Restore to isolation; verify every referenced byte/object before activation; verify tenant isolation, debit=credit, row counts, hashes, migration version.
- **Never restore over production**: Always test isolation verification first.
- **Verify after activation**: Post-restore sanity checks (balance reconciliation, evidence linking, byte/object accessibility).

---

## 18. Testing and Proof Spikes

### Testing Pyramid / Layers

From tight to loose:

1. **Pure domain tests**: No I/O; tax rules, posting logic, state transitions (fastest; most coverage).
2. **Posting golden tests**: Canonical sequences with expected journal outcomes (determinism).
3. **Command contract snapshots**: CLI input/output verification (human and JSON).
4. **Repository/dialect contracts**: CRUD correctness on SQLite, PostgreSQL, MySQL.
5. **Migration tests**: Fresh install + every supported upgrade; schema consistency across dialects.
6. **Rule pack official fixtures**: Compliance rules against known-good outputs (reproducible).
7. **End-to-end workflows**: Full invoice-to-cash, bill-to-payment, payroll, close cycles.
8. **External adapter sandbox tests**: Bank API mocking, IRP sandbox, e-way bill simulation.

Zoho fixture validation separate; not the accounting oracle.

### Explicit Pre-Implementation Spikes

STK-001 through STK-006 must be resolved by passing proof spikes. **This gate must be passed before Phase 1 implementation begins, but Gate0 itself does not authorize Phase 1 or approve any library.** Sudhanshu must explicitly authorize Gate0; a blocker discovered during or after it stops the affected work and requires a new owner decision.

#### STK-001: Exact Pinned Bun

- At Gate0 resolve the authoritative latest stable Bun release; then record its exact version, `bun --revision`, artifact checksums, and lockfile/CI/release pins. Do not hard-code a guessed current version today.
- Verify Bun-native install, workspaces, lockfile, and embedded runtime on macOS arm64, Linux x64, and Linux arm64.

#### STK-002: Multi-Dialect ORM

- Prefer Bun-native persistence. If needed, test one candidate at a time, such as Drizzle, Kysely, or better-sqlite3; no candidate is pre-approved.
- Identical contract on bun-sqlite, Bun SQL PostgreSQL, MySQL.
- Verify schema definition, query generation, type inference on all three.
- Verify migrations fresh and all upgrade paths.

#### STK-003: SQLite Configuration

- Verify `PRAGMA foreign_keys = ON`, WAL mode, SQLITE_BUSY handling, transaction isolation.
- Test on target filesystems (local, network).

#### STK-004: Migrations Fresh and Upgrade

- Fresh-install migrations on all three dialects.
- Every supported upgrade path on all three.
- Schema consistency verification.

#### STK-005: Parser, validation, and exact decimal candidates

- Prefer Bun-native parser, validation, JSON schema, and exact decimal APIs.
- If needed, individually proof-gate Zod, Clipanion, decimal.js, or another npm-compatible TypeScript package under pinned Bun.
- Verify command registry remains domain-owned, parser bindings and help output are deterministic, and decimal precision/rounding is exact for INR (paise), tax, and FX.

#### STK-006: Build and Distribution

- Bun build on all target platforms.
- Release exactly one Bun-embedded single-file executable for each of macOS arm64, Linux x64, and Linux arm64.
- Required DB drivers (MySQL, PostgreSQL) and migration assets work on all platforms.
- Prove skills invoke only the packaged `agent-bahi` executable and that no released path invokes Node, a Node subprocess, a Node lifecycle hook, a separate Bun runtime, source distribution, or package/bin fallback.

Each spike produces a decision update, not production code.

---

## 19. Implementation Slices and Gates

### Vertical Slices (Aligned to Roadmap)

Detailed roadmap is the source of truth: [docs/discovery/roadmap.md](discovery/roadmap.md). Architecture does not change roadmap phase numbering.

**Suggested slice order**:

0. **Proof spikes + architecture review** (gate).
1. **Tenant/config/COA/money/ledger/audit** → idempotent command skeleton.
2. **Invoice/bill/payment/posting/corrections/locks** → daily workflow foundation.
3. **Bank statement/reconciliation + evidence** → close workflows.
4. **Reports/currency/assets/expenses** → reporting and fixed assets.
5. **Payroll** → full India payroll including tax/remittance.
6. **Compliance rule/obligation framework** then filing-specific vertical slices (GSTR-1, e-invoice, e-way bill, etc.).
7. **PostgreSQL/MySQL adapter conformance** → validation on all dialects.
8. **Zoho import final** → migration from Zoho Books.

### Slice Acceptance Criteria

Every slice acceptance requires:

- **Invariants**: Debit=credit balance, tenant/GSTIN isolation, audit trail completeness.
- **Tenant isolation tests** (all dialects): No cross-tenant leaks in queries, writes, or returned results; verify returned records belong to requested tenant/GSTIN only.
- **Decimal precision tests** (all dialects): Exact decimal intermediates for tax/FX; no float rounding errors; golden test reconciliation to posted amounts.
- **Idempotency tests** (all dialects): Same request ID returns same result; different content with same ID rejected; replay safe (no duplicates).
- **Compare-and-swap (CAS) concurrency tests** (all dialects): Optimistic version checks work; conflicts fail visibly; locking on high-consequence ops serializes correctly.
- **Numbering contention tests** (all dialects): Concurrent allocations in same series never duplicate or reuse numbers; gaps are preserved/explained (reserved, voided, failed issuance are lawful gaps).
- **Locking tests** (all dialects): Period locks, document finalization, payroll finalization serialize correctly; lock conflicts surfaced to user.
- **Partial batch tests** (all dialects): Per-item success/failure outcomes correct; partial-success exit code non-zero; retry set accurate.
- **Unknown external outcome tests** (all dialects): Timeout handling defers finalization; reconciliation queries status; no blind retries.
- **Deterministic JSON output** (all dialects): Same query returns same JSON (order, precision, field presence); versions match schema.
- **CLI JSON/help**: Commands stable, JSON schema versioned, human help accurate.
- **Audit/evidence**: Every mutation auditable with actor/timestamp; evidence linked correctly.
- **Reconciliation confirmation**: A deterministic suggestion never persists; missing, stale, or mismatched exact-plan human confirmation returns the stated confirmation/stale-plan error without mutation.
- **Payment atomicity**: A payment posts bank/unapplied cash before allocation, retries do not duplicate cash, and an unposted payment cannot be allocated.
- **Refund/credit clearing**: Customer and supplier refund journals clear their signed AR/AP credit balance and refund control without an orphan balance.
- **FX settlement**: Bank cash equals actual paid currency multiplied by its immutable base-rate snapshot; carrying value, fees, rounding, and realized FX reconcile independently for full and partial settlement.
- **Capitalization ownership**: An AP bill asset line or direct cash acquisition posts exactly once; a repeated source-document/source-line attempt returns `DUPLICATE_CAPITALIZATION`.
- **Settlement and direction**: Partial/open remains Posted; Settled requires zero signed open balance after allocations and approved balanced credit/write-off/refund; opposite-direction note allocation fails closed.
- **Migration/restore**: Fresh-install and all upgrade paths pass on all three dialects; restore-in-isolation verification (tenant isolation, debit=credit).
- **Failure-path tests**: Invalid inputs rejected; lock conflicts surfaced; external timeouts handled; GSTIN ambiguity fails explicitly.

---

## 20. Open Research and User Review Checklist

### Architect-Tier Debates Pending

The following remaining RECOMMENDED decisions in [architecture-decisions.md](discovery/architecture-decisions.md) remain subject to architect-tier debate or explicit owner acceptance:

- **ARC-001** through **ARC-014** (core architecture).
- **CLI-001** through **CLI-007** (CLI contract).
- **SKL-001** through **SKL-005** (skills).
- **SEC-001, SEC-002** (security).
- **OBS-001** (observability).
- **CMP-001** through **CMP-009** (compliance).
- **STK-001** through **STK-006** (technology stack).
- **QA-001 through QA-003** (quality).

Architect debates must resolve or Sudhanshu must explicitly accept the remaining recommendations before implementation. This does not reopen the owner-selected TypeScript + Bun runtime.

### Five Provisional Owner Choices (Already Recommended)

1. **E-invoice transport** (CMP-006): IRP API + manual fallback; applicability rules **OPEN RESEARCH**.
2. **E-way bill transport** (CMP-007): API + state rules **OPEN RESEARCH**; no blind claim of mandatory-everywhere.
3. **GSTR-3B boundary** (CMP-005): Manual portal filing; direct GSP submission **OPEN RESEARCH**.
4. **Stale-rule fail closed** (CMP-002): Statutory operations fail if rule missing/ambiguous; drafts warn.
5. **CA bundle** (CMP-008): Immutable manifest with hashes; no credentials.

### Remaining High-Impact Choices (User May Override)

- **Shared multi-tenant database** vs. database-per-tenant (architecture deployed later; code-level change not needed).
- **Modular monolith** vs. initial microservices (monolith chosen; API adapter deferred).
- **Drizzle/Kysely/better-sqlite3/Clipanion/Zod/decimal and other package candidates** (individually proven under pinned Bun before use).
- **External adapter policy**: Opt-in per filing, no global auto-submission policy.
- **Inventory extension seams**: Stable item/line references vs. placeholder tables (stable references chosen).

### OPEN RESEARCH Items (Settled Elsewhere)

See [architecture-decisions.md § Open Research / Deferred List](discovery/architecture-decisions.md#open-research--deferred-list) for items requiring external verification:

- GSTR-9 exemption for FY 2025-26.
- Composition scheme (CMP-08, GSTR-4).
- Stable GSTR-3B artifact.
- E-invoice applicability and exemptions.
- E-way bill state-specific rules.
- Bank CSV preset formats.
- TDS/TCS rules and forms.
- Income-tax statutory forms.
- PT/LWF thresholds and rates.
- Payroll statutory forms.
- Fixed-asset depreciation methods.
- Exchange-rate provider selection.
- Evidence retention periods.
- IRP/E-way bill credential provisioning.
- Plugin trust/signing governance.
- Inventory accounting.
- Zoho Books import.

---

## 21. Traceability Matrix

Mapping from key requirements/decisions to decision IDs and architecture sections:

| Requirement/Decision | Decision ID(s) | Architecture Section(s) |
|---|---|---|
| Local-first, agent-first | decisions.md | §1 Outcome |
| SQLite default, multi-dialect adapters | STK-002, STK-003, STK-004 | §1, §14, §18 |
| One legal entity = one tenant | decisions.md, ARC-002 | §5, §6 |
| Multi-GSTIN within tenant | decisions.md, gst-compliance-matrix.md | §1, §5, §6 |
| Tenant context on every command | ARC-002, CLI-002 | §5, §13 |
| No RBAC v1, hooks for v2 | SEC-002 | §17 |
| Deterministic accounting | ARC-001, ARC-003, ARC-004 | §7, §8, §9 |
| Immutable corrections (reversal+replacement) | data-model-requirements.md, ARC-004 | §6, §10 |
| Cash/accrual basis reporting | decisions.md, cli-contract.md | §13, §15 |
| Explicit bank match (not AI guess) | data-model-requirements.md, cli-contract.md, skill-architecture.md | §10, §12, §16 |
| Locked periods prevent mutation | data-model-requirements.md, cli-contract.md | §5, §8, §10 |
| E-invoice IRN before finalization | gst-compliance-matrix.md, CMP-006 | §11, §16 |
| GSTR-1 JSON + manual portal + ARN | decisions.md, gst-compliance-matrix.md, CMP-004, CMP-009 | §11, §16 |
| Payroll full model, no HRMS | decisions.md, payroll-compliance-matrix.md | §1, §9 |
| Bank export only, no auto-pay | decisions.md | §4, §9 |
| Versioned skill manifests | SKL-001, skill-architecture.md | §12 |
| Rule packs immutable + versioned | CMP-001, CMP-002 | §11 |
| Stale/missing rules fail closed | CMP-002 | §11, §16 |
| External calls outside transaction | ARC-014 | §8 |
| Durable evidence + outbox pattern | ARC-010, ARC-014 | §8, §14 |
| Content-addressed evidence | ARC-010 | §14 |
| Idempotent retries via request ID | ARC-005 | §7, §13 |
| Optimistic + explicit locks | ARC-006 | §7, §8 |
| Exit-code taxonomy | CLI-004 | §13 |
| Prepare/commit with hash | CLI-005 | §8, §13 |
| No inventory v1 | decisions.md, ARC-013 | §1, §4 |
| Zoho import final | decisions.md | §1, §19 |
| No cross-tenant relationships | decisions.md, ARC-002 | §5, §9 |
| Reporting tags/splits explicit | decisions.md, data-model-requirements.md | §6, §15 |

---

## 22. Definition of Ready for Implementation

**⚠️ CRITICAL: The current state is documentation-only; this document authorizes no Gate0, Phase 1, or implementation.** TypeScript + Bun is owner-selected, but Phase 1 is ready only when every item below is satisfied:

1. [ ] **Docket review and Gate0 direction**: Sudhanshu reviews the [Owner Review Docket](discovery/owner-review-docket.md) and [Tentative Decisions](discovery/tentative-decisions.md), then explicitly directs/authorizes the reversible Gate0 proof spikes. This direction does not authorize Phase 1 or approve any library.
2. [ ] **Gate0 evidence**: STK-001 through STK-006 complete on macOS arm64 and Linux x64/arm64, including the exact Bun release/revision/checksum and lockfile/CI/release pin record. No library or implementation is pre-approved by Gate0. A blocker stops the affected work and requires a new owner decision.
3. [ ] **Architecture and applicable Phase 1 decisions**: Architecture contradiction review is clean, architect-tier debates are resolved or explicitly waived, and decisions applicable to Phase 1 are approved. Later-phase tentative IDs block only their affected phase/action, not all of Phase 1.
4. [ ] **Physical-schema RFC**: The data-model RFC covering tables, keys, constraints, and indexes is reviewed separately before Phase 1 authorization. Schema documentation does not imply physical-schema approval.
5. [ ] **No silent defaults**: Every architectural choice in code is explicit in code comments or cites a decision ID; unresolved decisions are not silently implemented.
6. [ ] **Per-action research gates**: Missing or stale legal/compliance research REVIEW/BLOCKs only the affected compliance action; unrelated bookkeeping, draft entry, and already-researched statutory slices proceed. See [Discovery Roadmap: verified statutory compliance baseline](discovery/roadmap.md#cross-cutting-discovery-milestone-verified-statutory-compliance-baseline-2026-08-21).
7. [ ] **Implementation plan**: The [Implementation Plan](discovery/implementation-plan.md) contains the Phase 1 acceptance tests, slice definitions, and assignments, with applicable Phase 1 decisions reflected.

**No implementation is authorized by this document alone.** The [Implementation Plan](discovery/implementation-plan.md) defines the detailed prerequisites for later phases and actions.

---

## Appendix: Quick Links to Discovery Documents

**OWNER REVIEW & APPROVAL** (prerequisite):
- [Owner Review Docket](discovery/owner-review-docket.md): Compact index of the remaining owner-review records; T-001–T-010 are owner-approved and TypeScript + Bun is owner-selected.
- [Tentative Decisions and Overnight Protocol](discovery/tentative-decisions.md): Full details for each T-ID with rationale, reversal paths, and owner-review status.
- [Implementation Plan](discovery/implementation-plan.md): Gate0 proof spikes, Phase 1–9 sequencing, prerequisites.

**DOMAIN & ARCHITECTURE**:
- [Decisions](discovery/decisions.md): Confirmed decisions and working defaults.
- [Architecture Decisions](discovery/architecture-decisions.md): SETTLED, RECOMMENDED, OPEN RESEARCH, DEFERRED.
- [Data Model Requirements](discovery/data-model-requirements.md): Entities, invariants, canonical records.
- [Accounting Contracts](discovery/accounting-contracts.md): Canonical pre-implementation domain contracts and account-role posting templates.
- [CLI Contract](discovery/cli-contract.md): Reports, reconciliation, period controls.
- [Skill Architecture](discovery/skill-architecture.md): Engine/CLI/skill/agent responsibilities.

**COMPLIANCE RESEARCH BASELINES**:
- [GST Compliance Matrix](discovery/gst-compliance-matrix.md): Verified research baseline; GSTR-1, GSTR-3B, e-invoice, e-way bill.
- [Payroll Compliance Matrix](discovery/payroll-compliance-matrix.md): TDS, EPF, ESI, PT, LWF, wage records.
- [Expense Evidence Policy](discovery/expense-evidence-policy.md): Legal and product rules for evidence.

**PLANNING & ROADMAP**:
- [Roadmap](discovery/roadmap.md): Phases 1–9, cross-cutting milestones, gates, per-action research gates.

---

**Document revision**: 2026-08-20
**Status**: Awaiting Sudhanshu review and architect-tier debate resolution.
