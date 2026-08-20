# Agent-Bahi Pre-Implementation Architecture

**Document Status**: Pre-implementation architecture based on SETTLED constraints and RECOMMENDED defaults.

**Date/As-of**: 2026-08-20

**Scope**: This document is a working architecture informed by [Provisional Architecture Decisions](discovery/architecture-decisions.md), [Discovery Decisions](discovery/decisions.md), [Data Model Requirements](discovery/data-model-requirements.md), and cross-cutting research baselines. It combines SETTLED constraints from discovery with RECOMMENDED provisional architecture choices. New recommendations remain provisional because architect-tier debates could not run in an apprentice-only session; Sudhanshu reviews and adjusts all RECOMMENDED entries before implementation.

**Authorization**: This document authorizes no implementation. Sudhanshu must review, adjust, and confirm the architecture. Proof spikes and OPEN RESEARCH gates remain hard blockers before Phase 1 begins. The definition of ready (§22) must be satisfied.

---

## 1. Outcome and Scope

**Agent-Bahi is a local-first, agent-first, India-focused, deterministic accounting and compliance modular monolith.**

### Core Outcome

- **Default storage**: SQLite, deployable locally without external databases or services.
- **Adapters**: PostgreSQL and MySQL supported through pluggable persistence ports and proven migration consistency across all dialects before release.
- **Tenancy model**: One legal entity = one independent tenant. Sudhanshu's three legal entities (two private limited companies and one sole proprietorship) are three separate tenants with no cross-tenant relationships, paired entries, or intercompany modeling.
- **GST registrations**: One tenant may have multiple GSTIN registrations; GST work, amounts, obligations, and evidence are scoped by tenant and GSTIN.
- **Technology direction**: TypeScript + Bun is the current working direction. Final stack selections for ORM, CLI parser, decimal math, database drivers, and migrations are RECOMMENDED choices gated by Phase 1 proof spikes (§18).

### Non-Goals

The following are explicitly out of scope for v1 and remain deferred:

- **Inventory accounting**: Products/services and document lines carry description, quantity, unit, rate, tax treatment, and account references, but the system does not track stock, warehouses, valuation, automated COGS, batches, serials, or manufacturing behavior.
- **Attendance/Leave/HRMS**: Payroll accepts approved summarized inputs (payable days, loss-of-pay days, overtime amounts/hours) but does not maintain attendance records, leave balances, shifts, or attendance-import workflows. Agent-bahi is not the system of record for employee time.
- **Employee portal**: No employee self-service. Payslips and employee outputs are generated for secure external delivery; expense claims and payroll evidence enter through operator/agent workflows.
- **RBAC implementation**: Authorization hooks are present and no-ops for v1; RBAC is deferred. Actor, source, and permission context are threaded through every mutation.
- **Web server/microservices**: CLI is the primary adapter. API and web clients are future options; reusable application services enable this without breaking changes.
- **Direct government filing**: There is no universal auto-filing policy. Each filing (GST, TDS, e-invoice, e-way bill, income tax, MCA, etc.) has its own researched submission boundary or remains prepare/validate/export only. GSTR-1 is the only settled filing boundary (user/CA manual portal upload); other filings require individual approval and research.
- **Zoho import until final phase**: Zoho Books is the validated migration source but is intentionally deferred to Phase 9 and must not drive the canonical accounting model.

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
4. **Number reuse**: Voided document number reused in same series/year/GSTIN.
5. **Stale rules applied silently**: Tax/compliance calculation uses old rule version without versioning.
6. **Upload mistaken for filing**: JSON uploaded to portal treated as filed return with no portal-observed ARN.
7. **Portal/books divergence unmissed**: GSTR-3B portal auto-population accepted without review against books.
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
Domain modules (accounting, tax, compliance rules, ledger invariants, state machines)
    ↓
Ports (repository interfaces, rule pack loader, evidence adapter, external API contracts)
    ↓
Infrastructure adapters (SQL dialect implementations, evidence storage, external API calls)
```

### Dependency Rules

**Inward constraint**: Domain and application layers import no CLI framework, ORM, network library, or runtime-specific feature. Contracts flow inward only. Adapters implement ports; the application coordinates and validates before calling domain logic.

**Versioned skills**: Skills call CLI commands only via the published command registry. Skills never call domain services directly or import domain/persistence code. Skills invoke `agent-bahi` as an external process with well-defined inputs/outputs.

**External calls outside transaction**: Network calls (bank APIs, IRPs, government portals) never occur inside the accounting database transaction. Durable outbox/saga patterns record requests and responses as separate state transitions.

**No full event sourcing**: The system maintains relational current-state tables (accounts, entities, documents, postings) plus immutable journals, audit logs, and outbox records. Balances derive from postings; read models are non-authoritative and rebuildable. Explanation: simpler than full event sourcing, sufficient for deterministic accounting, and trades replay complexity for query efficiency.

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

### Accounting Domain Submodules

- **`domain/documents/sales`**: Invoices, sales orders, returns, credit/debit notes for outward supplies.
- **`domain/documents/purchases`**: Bills, purchase orders, returns, credit/debit notes for inward supplies.
- **`domain/documents/expenses`**: Employee claims, advances, reimbursements, corporate-card expenses.
- **`domain/documents/banking`**: Bank transactions, reconciliation matches, settlements.
- **`domain/documents/payroll`**: Payroll periods, inputs, runs, payables, remittances.
- **`domain/posting`**: Ledger posting logic; atomic batch posts; reversal/replacement patterns.

### Compliance and Tax Layer

- **`domain/compliance/gst`**: GST registration, AATO, GSTR-1/GSTR-3B/GSTR-2B logic; ITC states.
- **`domain/compliance/payroll`**: Payroll tax, TDS, Form 16/138, PF, ESI, PT, LWF rules.
- **`domain/compliance/fixed-assets`**: Asset register, depreciation runs, disposal tracking.
- **`domain/compliance/obligations`**: Obligation engine; predecessor gates; filing snapshots; amendments.
- **`domain/compliance/rules`**: Effective-dated rule selection; versioned rule packs; fail-closed gates.

### Infrastructure/Adapter Layer

- **`infrastructure/persistence`**: Repository implementations; Drizzle or Kysely dialect-agnostic contracts.
- **`infrastructure/dialects`**: SQL migrations and dialect-specific handling (SQLite, PostgreSQL, MySQL).
- **`infrastructure/evidence`**: Content-addressed evidence storage; local filesystem default; S3/cloud adapter option.
- **`infrastructure/external-adapters`**: Bank APIs, IRP/e-invoice, e-way bill, GST portal integrations.
- **`infrastructure/rules-loader`**: Rule pack manifest validation, signature verification, versioning.

### CLI and Skills Layer

- **`cli/command-registry`**: Domain-owned command definitions; parser bindings; help generation; schema export.
- **`cli/adapter`**: Clipanion or fallback CLI parser; human and JSON output; exit-code taxonomy.
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
- Infrastructure (adapters) implements ports from domain and application; never imports domain business logic.
- Skills import CLI schemas and command definitions; invoke CLI as a subprocess; never import domain.

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
Document payment or partial payment, with bank/cash currency, document currency, applied amounts, exchange rate used, and bank fees/FX gain-loss separation.

**CurrencyRateSnapshot**
Immutable exchange rate: date, document currency, base currency, rate, source, timestamp. Attached to document at creation and never changed.

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
- **Balances derived**: Account balances are calculated from postings, never stored duplicatively.
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

**Intermediates**: Tax calculations, exchange-rate conversions, and FX intermediates use exact decimal arithmetic (decimal.js domain wrapper), never binary floats.

**Preserved metadata**: For every conversion or calculation, store:
- Original currency and amount.
- Base-currency result.
- Rate used (with source, timestamp).
- Rounding rule applied.
- Intermediate decimal values before posting rounding.

Rationale: Audit trail enables recalculation if rules change. Balance checks are exact.

### Time

**Accounting dates**: Calendar dates (LocalDate-like; no time component). "2026-03-31" means the whole accounting day.

**Event timestamps**: Immutable UTC timestamps for audit and ordering. Every mutation records creation time, approval time, posting time separately.

**Tenant timezone**: Each tenant has an IANA timezone (e.g., Asia/Kolkata) for display and midnight boundaries. Reports are never derived from server timezone.

**Fiscal-year settings**: Tenant configuration defines fiscal year start/end (e.g., April 1 – March 31). No hardcoded calendar assumptions.

### Numbering

**Scope**: Tenant + applicable GSTIN (if any) + document family/series + financial year.

**Allocation**: Allocated at legal issue/finalization (not at draft creation).

**Never reuse**: Voided or cancelled numbers are not reused within the scope.

**Preserve gaps**: Gaps are documented with explicit reason (e.g., voided, test number, legal reversal).

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
- Tenant and GSTIN context.
- Actor/source.
- Expected version (for optimistic concurrency).
- Timestamp.
- Reason (where required, e.g., unlock, reversal).

**Idempotency record**: Same request ID replayed returns same result without side-effect duplication. Different content with same ID is rejected as conflict.

---

## 8. Command Execution and Transaction Boundaries

### Deterministic Command Lifecycle (Numbered)

1. **Resolve tenant and GSTIN context** → validate active selection; fail explicitly on ambiguity.
2. **Parse and validate versioned input** → reject invalid commands before any domain call.
3. **Authorization hook** → check actor permission and source context (no-op in v1; framework in place).
4. **Idempotency check** → if same request ID exists, return cached result; if different content with same key, reject conflict.
5. **Load aggregate with expected version** → optimistic concurrency check (or acquire exclusive lock for high-consequence ops).
6. **Choose effective rules** → select versioned rule pack by date, GSTIN, jurisdiction.
7. **Pure domain plan** → compute deterministic outcome (e.g., journal entries, tax amounts, validation errors).
8. **Show/validate gates** → return preview; ask user for approval if needed (prepare/commit pattern).
9. **Atomic transaction** → write business state + postings + audit + idempotency record + outbox events in one ACID transaction.
10. **Return stable result** → versioned JSON or human-readable output with request ID, effective tenant/GSTIN, rule versions, and outcome.

### Prepare/Preview → Validate → Commit (High-Consequence)

**For high-consequence actions** (period close, payroll finalization, filing snapshot, bank reconciliation):

1. **Prepare**: Compute plan without side effects; return preview and plan hash/ID.
2. **Validate**: User or agent reviews preview; hashes match; approves.
3. **Commit**: Recompute to verify plan matches preview; acquire locks; post atomically. If plan diverged, abort and re-prepare.

Dry-run is always side-effect-free.

### Batch Atomicity

**Per-file/snapshot atomic**: Document import is atomic per file; all records in one file commit or all roll back.

**Per-item outcomes**: Accounting proposal returns per-item success/failure without hiding partial success.

**Explicit commit**: Results are shown; user explicitly selects items to post. Never silently apply majority rule or best-effort.

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
| **Fixed Assets** | Asset register, acquisition, depreciation runs, disposal tracking, depreciation schedules | Operating transactions; tax strategy |
| **Reporting/Export** | Report generation (P&L, balance sheet, aging, reconciliation, compliance exports), query/filtering | Ledger mutations; document state changes |
| **Audit/Evidence** | Immutable audit log, evidence storage, checksums, lineage tracking, compliance evidence | Ledger corrections; document retroactive changes |
| **Rule Packs** | Versioned, immutable rule manifests, declarative tables, calculators, signatures | Compliance decisions; tax policy exceptions |
| **Skills/Automation** | Job skill definitions, versioned manifests, orchestration logic, evidence gathering | Accounting rules; tax calculations; authorization |
| **Persistence/Adapters** | SQL dialects, schema, migrations, repository implementations | Domain logic; business rule calculations |

**Canonical ledger principle**: Ledger/Posting is authoritative. Reports never write. Tax/Compliance never infer filing status from portal assumption; records explicit evidence.

---

## 10. State Machines

### Business Document State Machine

```
Draft → Validated → Finalized/Issued → Posted → Settled (full or partial)
                                         ↓
                                    Void/Reversal (creates linked reversal document)
                                    Correction (creates linked replacement)
```

**Forbidden shortcuts**: Never skip validation or post without finalization. Never mutate posted documents; only reversal + replacement.

**State transitions**:
- Draft → Validated: user or agent validation check.
- Validated → Finalized: approve/authorize; allocate document number; immutable from here.
- Finalized → Issued: user/agent decision; may update external reference (e.g., supplier ack).
- Issued → Posted: atomic transaction, journal entries, audit record.
- Posted → Settled: partial or full payment/settlement records.
- Posted → Void: create reversal entry linked to original; reason required.
- Posted → Correction: create reversal entry + replacement document, linked lineage.

### Bank Statement Line State Machine

```
Imported → Proposed (skill-matched candidates) → Reviewed/Approved (user selects) → Persisted → Reconciled
```

**Distinction**: Proposal ≠ Match. Proposal is non-deterministic candidate; match is explicit validated persistence.

### Skill Run State Machine

```
Pending → Ready → Executing → Completed / Exception / Failed / Cancelled
```

### Statutory Preparation State Machine

```
Prepared (local snapshot)
  → Locally Validated (internal checks pass)
  → Exported/Uploaded/Portal-Processed (external action, may error)
  → Reviewed (user/CA portal review)
  → Filed (user/CA initiates filing)
  → Acknowledgement/ARN Recorded (authority response evidence)
```

**Never "accepted" unless authority explicitly defines it.**

### Payroll Bank File State Machine

```
Generated → Uploaded/Accepted-by-Bank → Debited (bank confirmation) → Reconciled (matched statement)
```

**Distinct states**: Export ≠ Upload ≠ Debit ≠ Reconciled. Each requires separate evidence.

### E-Invoice/E-Way External Request State Machine

```
Prepared (local snapshot)
  → Submitted (request sent)
  → Response-Known/Unknown (received response or timeout)
  → Evidence-Recorded (hash, timestamp, IRN/EWB number)
  → Business Finalization (document state updated based on evidence)
```

**No blind retry**: Unknown outcome → reconciliation skill queries status; records actual response.

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

- **Product**: Produces GST Portal-compatible JSON after local validation plus human-readable reconciliation and preview.
- **Workflow**: User or CA uploads, reviews, and files on GST Portal with DSC/EVC.
- **Recording**: Agent-bahi records upload/processing, portal errors, summary review, filed status, and ARN evidence.
- **Not filing**: JSON upload is not filing; no GSP/API submission.

#### GSTR-3B (RECOMMENDED Default; Manual Portal)

- **Product**: Deterministic locked working paper/reconciliation derived from ledger, GSTR-1, and GSTR-2B.
- **Workflow**: User/CA manually reviews and files via GST Portal.
- **Recording**: Agent-bahi records evidence/ARN.
- **Open research**: Stable official GSTR-3B artifact (analogous to GSTR-1 JSON) is unconfirmed. Direct GSP submission remains **OPEN RESEARCH**.

#### E-Invoice (RECOMMENDED; IRP API + Manual Fallback)

- **Applicability**: Effective-dated rule selection; AATO, exemptions, invoice type.
- **Transport**: Configured IRP adapter for direct submission; export/upload/import-response fallback.
- **Idempotency**: Same request cannot duplicate IRNs.
- **Blocking gate**: Applicable invoice not issued/finalized until IRN and signed QR evidence recorded.
- **Unknown outcome**: Reconciliation skill queries status; records actual evidence.

#### E-Way Bill (RECOMMENDED; API + State-Specific Rules OPEN RESEARCH)

- **Transport**: Configured API adapter; manual fallback.
- **Applicability**: Effective-dated rules determine when EWB required; thresholds, exemptions, state rules remain **OPEN RESEARCH**.
- **Blocking gate**: Only when effective rules say required; block movement/dispatch until valid EWB evidence recorded.
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
2. **Draft/preparation**: Create draft document, prepare snapshot (user approval before finalization).
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

- **Auto-select**: One active tenant or GSTIN; explicit selection for more than one.
- **Echo effective context**: Every output includes effective tenant and GSTIN (where applicable).
- **No silent defaults**: Ambiguity fails explicitly; no hidden last-choice memory.

### Human and JSON Output

- **Default**: Human-readable for TTY.
- **Explicit JSON**: `--json` flag returns stable versioned envelope.
- **Stderr/stdout**: Errors and progress on stderr; results on stdout.
- **Returned metadata**: Tenant, GSTIN (applicable), report basis, period/date range, request ID, rule versions, warnings/exceptions, evidence references.

### Exit-Code Taxonomy

Stable, structured exit codes for orchestration and retry logic:

| Code | Meaning | Retry? |
|------|---------|--------|
| 0 | Success | No |
| 1 | Validation error (bad input) | No |
| 2 | Ambiguity/selection required (e.g., >1 tenant) | User action |
| 3 | Conflict/lock (concurrent mutation, period locked) | Eventual retry |
| 4 | Compliance gate (missing rule, stale obligation) | Manual research |
| 5 | External retryable (timeout, temp unavailable) | Retry OK |
| 6 | External terminal (auth, permanent error) | No |
| 7 | Permission denied (RBAC v2+) | No |
| 8 | Internal error (ledger corruption, bug) | No |

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

### Provisional Technology Stack (Proof Spike Candidates)

**Note**: All choices are provisional and cited from [Provisional Architecture Decisions](discovery/architecture-decisions.md). They remain gated by Phase 1 proof spikes (§18) before commit.

- **ORM**: Drizzle (primary) or Kysely (fallback). Both support bun-sqlite, PostgreSQL, MySQL with identical contract; multi-dialect spike validates before commit.
- **CLI parser**: Clipanion (primary) with fallback for Bun help/JSON schema generation.
- **Schema/validation**: Zod for runtime schemas and JSON schema generation.
- **Decimal math**: decimal.js behind a domain math wrapper (never floats).
- **Testing**: bun:test (Bun native).
- **Build/distribution**: ESM TypeScript with bun:build; platform binaries and package/bin fallback.

### SQLite Default Configuration

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

**Backup/restore**: Evidence manifest and hashes included; restore verifies content integrity before activation.

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

**Cash basis**: Reports over payments received/paid dates.

**Accrual basis**: Reports over invoice/bill dates.

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

1. Agent/user creates invoice draft (items, tax).
2. [REVIEW] Draft validation (SKU, tax applicability).
3. [TX] Finalize invoice → allocate number → post journal entry (AR debit, revenue credit).
4. [EXT] Issue invoice to customer (email, portal, external system).
5. Bank statement arrives; includes customer payment.
6. Bank reconciliation skill proposes match: statement line ↔ payment record.
7. [REVIEW] Skill validation checks (tenant, amount, currency, status).
8. [TX] Persist match + evidence.
9. [TX] Post payment journal (bank debit, AR credit).
10. AR aged report shows invoice fully settled.

### 2. Vendor Bill → Posting/Payment → ITC Pending/Matched/Claimed Reconciliation

1. Agent/user creates bill draft (items, tax, GSTR-2B eligibility check).
2. [REVIEW] Validate bill (vendor, tax invoice number, HSN if required, ITC applicability).
3. [TX] Finalize bill → allocate number → post journal (expense/asset debit, AP credit, ITC receivable debit).
4. [EXT] Portal/vendor statement provides GSTR-2B autofill (evidence gathered).
5. Agent reconciles GSTR-2B with booked bills.
6. [REVIEW] ITC eligibility: document valid? Supplier GSTIN valid? Reverse charge applicable?
7. [TX] Update ITC state (eligible → pending match → matched / ineligible with reason).
8. Payment due date arrives.
9. [TX] Post payment (cash/bank debit, AP credit, ITC receivable credit if claimed).
10. GST return prep reflects ITC claim sourced from booked bill + matching evidence.

### 3. Statement Import → Proposed Match → Explicit Persistence

1. User uploads bank statement (CSV from bank).
2. [TX] Import as statement batch (if any error, full batch rejected).
3. Skill invokes bank-reconciliation flow.
4. Skill gathers open AR/AP records; proposes matches (non-deterministic, may fail to match).
5. [REVIEW] Skill surfaces candidates: amount, date, vendor/customer.
6. Agent/user selects/approves matches.
7. Skill invokes CLI `reconciliation match` command per selected match.
8. [TX] CLI validates tenant, account, currency, amount, state transitions, idempotency.
9. [TX] Persist match + provenance (skill version, evidence hash, actor, outcome).
10. Remaining unmatched items shown for next cycle.

### 4. Payroll Inputs → Compute → Review/Finalize → Journal → Payslip → Bank CSV → Debit/Reconcile → Statutory Evidence

1. Agent inputs payroll period, pay days, absent days, approved overtime (from HR system or manual).
2. [REVIEW] Validate employees, salaries, tax regime (old-law → new-law transition 1 Apr 2026?).
3. [TX] Create payroll run (draft, versioned inputs, rule snapshot).
4. [TX] Compute gross, TDS, PF, ESI, PT, LWF, net per employee (frozen rule version).
5. [REVIEW] Show payroll summary; review deductions; approve finalization.
6. [TX] Finalize run → post balanced journal (payroll expense debit, payables credit, TDS/PF payables, net-pay payable).
7. [TX] Generate payslips + bank CSV export from preset format.
8. [EXT] User uploads bank file to bank portal (export ≠ payment).
9. [EXT] Bank debits account, confirms ACH acceptance.
10. [TX] Bank statement arrived; reconciliation skill matches debit to export record.
11. [TX] Post matching entry (net-pay payable cleared).
12. [TX] Generate Form 16/130 and quarterly TDS statement from frozen payroll data + deposit evidence.
13. [EXT] User files statements on income-tax portal; records ARN.

### 5. Late Document in Locked Period → Preview → Explicit Reopen or Current-Period Adjustment

1. Agent attempts to finalize invoice dated 2026-03-15 (March 2026).
2. Period lock enforced: `locked-through = 2026-03-31`.
3. CLI rejects create/finalize with "period locked" error.
4. Skill invokes `period unlock preview` to assess impact.
5. [REVIEW] Skill presents two options:
   a. Reopen March period → post invoice at original date → relock.
   b. Post current-period adjustment (dummy invoice at April 1) → reconcile difference.
6. Agent/user selects option (e.g., reopen March).
7. [TX] Unlock with reason, actor, audit record; impact preview confirmed.
8. [TX] Finalize invoice at original date, post journal.
9. [TX] Relock period with new audit entry.

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

### 7. Applicable E-Invoice IRN Flow with API + Manual Fallback, Unknown Outcome Handling

1. Agent/user finalizes invoice (B2B, exports, stock transfer → e-invoice applicable).
2. [REVIEW] Applicability rule: AATO ≥ 5 crore (effective 2023-08-01), no exemption.
3. [TX] Invoice posted (draft state initially).
4. IRP adapter configured; agent invokes `tax generate e-invoice --invoice <ID>`.
5. [EXT] Adapter calls IRP API: `POST /request IRN generation`; passes signed invoice JSON.
6. [EXT] Response unknown (timeout or invalid response).
7. [TX] Record durable pending request: request hash, timestamp, status = unknown.
8. Agent/user can invoke `tax status e-invoice --invoice <ID>`.
9. [EXT] Adapter queries IRP: `GET /status`; fetches actual IRN/QR.
10. [TX] Record response evidence (IRN, signed QR, timestamps).
11. If successful: [TX] Update invoice state to posted + IRN/QR recorded.
12. If failed: [TX] Record error; fail closed (invoice remains draft, not issuable without IRN).
13. Fallback: If IRP unavailable, agent exports invoice JSON + QR placeholder for manual IRP submission; same workflow via `record e-invoice evidence --response <response-file>`.

### 8. Cash/Accrual/Tagged Report Generation

1. Agent invokes `report profit-loss --basis accrual --start 2026-01-01 --end 2026-03-31`.
2. [TX] Query ledger postings for P&L accounts (revenue, expenses) in accrual basis (invoice dates).
3. Generate report: Gross revenue - COGS - Expenses = Net profit.
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

**Retention periods**: OPEN RESEARCH. Statutory minimum (8 years for companies, 5 years per payroll basis) documented per authority; longer where code/rule prescribes.

**No default deletion**: Five-year guidance is preservation baseline, not destruction instruction.

### No Sensitive Details in Operational Logs

Operational logs and metrics redact financial values, PII, bank data, tokens, documents by default. Include only:
- Request ID
- Actor (pseudonym or ID)
- Source
- Action
- Timestamp
- Outcome

### Backup and Restore Verification

- **Backup scope**: Database + evidence manifest + rule/skill versions + checksums.
- **Restore procedure**: Restore to isolation; verify tenant isolation, debit=credit, row counts, hashes, migration version.
- **Never restore over production**: Always test isolation verification first.
- **Verify after activation**: Post-restore sanity checks (balance reconciliation, evidence linking).

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

All decisions in [architecture-decisions.md § RECOMMENDED Decisions](discovery/architecture-decisions.md) marked STK-001 through STK-006 must be resolved by passing proof spikes. **This gate must be passed before Phase 1 implementation begins.**

#### STK-001: Exact Pinned Bun

- Pin exact Bun version in `package.json`, CI, and release artifacts.
- Verify `bun install`, workspaces, lockfile on macOS arm64, Linux x64/arm64.

#### STK-002: Multi-Dialect ORM

- Test Drizzle (primary) and Kysely (fallback).
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

#### STK-005: Zod, JSON Schema, Clipanion

- Zod runtime validation, JSON schema generation for CLI.
- Clipanion command registry from domain-owned declarations.
- Parser bindings and help output.
- decimal.js precision, rounding for INR (paise), tax, FX.

#### STK-006: Build and Distribution

- ESM TypeScript with bun:build on all target platforms.
- Compiled output, package/bin fallback.
- Optional DB drivers (MySQL, PostgreSQL) work on all platforms.
- **Prebuilt binaries**: Not viable for v1 until native driver integration is stable and tested.

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

- **Invariants**: Debit=credit, tenant isolation, audit trail completeness.
- **Tenant isolation**: No cross-tenant leaks in queries or writes.
- **CLI JSON/help**: Commands stable, JSON schema versioned.
- **Audit/evidence**: Every mutation auditable; evidence linked.
- **Migration/restore**: Schema changes tested fresh and all upgrade paths; restore-in-isolation verification.
- **Failure-path tests**: Invalid inputs rejected; lock conflicts surfaced; external timeouts handled.

---

## 20. Open Research and User Review Checklist

### Architect-Tier Debates Pending

The following RECOMMENDED decisions in [architecture-decisions.md](discovery/architecture-decisions.md) remain provisional without architect-tier debate:

- **ARC-001** through **ARC-014** (core architecture).
- **CLI-001** through **CLI-007** (CLI contract).
- **SKL-001** through **SKL-005** (skills).
- **SEC-001, SEC-002** (security).
- **OBS-001** (observability).
- **CMP-001** through **CMP-009** (compliance).
- **STK-001** through **STK-006** (technology stack).
- **QA-001 through QA-003** (quality).

Architect debates must resolve or Sudhanshu must explicitly accept provisional recommendations before implementation.

### Five Provisional Owner Choices (Already Recommended)

1. **E-invoice transport** (CMP-006): IRP API + manual fallback; applicability rules **OPEN RESEARCH**.
2. **E-way bill transport** (CMP-007): API + state rules **OPEN RESEARCH**; no blind claim of mandatory-everywhere.
3. **GSTR-3B boundary** (CMP-005): Manual portal filing; direct GSP submission **OPEN RESEARCH**.
4. **Stale-rule fail closed** (CMP-002): Statutory operations fail if rule missing/ambiguous; drafts warn.
5. **CA bundle** (CMP-008): Immutable manifest with hashes; no credentials.

### Remaining High-Impact Choices (User May Override)

- **Shared multi-tenant database** vs. database-per-tenant (architecture deployed later; code-level change not needed).
- **Modular monolith** vs. initial microservices (monolith chosen; API adapter deferred).
- **Drizzle/Clipanion/Zod/decimal candidates** (proven by spikes before commit).
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
| Deterministic accounting | multiple | §7, §8, §9 |
| Immutable corrections (reversal+replacement) | data-model-requirements.md, ARC-004 | §6, §10 |
| Cash/accrual basis reporting | decisions.md, CLI-001 | §15 |
| Explicit bank match (not AI guess) | data-model-requirements.md, CLI, SKL | §10, §12, §16 |
| Locked periods prevent mutation | data-model-requirements.md, CLI-contract.md | §5, §8, §10 |
| E-invoice IRN before finalization | gst-compliance-matrix.md, CMP-006 | §11, §16 |
| GSTR-1 JSON + manual portal + ARN | decisions.md, gst-compliance-matrix.md, CMP-005 | §11, §16 |
| Payroll full model, no HRMS | decisions.md, payroll-compliance-matrix.md | §1, §9 |
| Bank export only, no auto-pay | decisions.md | §4, §9 |
| Versioned skill manifests | SKL-001 | §12 |
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

All of the following must be true before Phase 1 implementation begins:

1. ✅ **Sudhanshu review of architecture decisions**: SETTLED vs. RECOMMENDED docket reviewed; user confirms, adjusts, or overrides each RECOMMENDED entry.

2. ✅ **Architecture document contradiction review**: This document (`docs/architecture.md`) passes clean contradiction review—no statements conflict with discovery docs or each other.

3. ✅ **Proof spikes complete**: All STK-001 through STK-006 spikes pass on target platforms (macOS arm64, Linux x64/arm64); results documented and decisions confirmed.

4. ✅ **Official research closed**: Items in OPEN RESEARCH list researched with primary sources; decisions finalized or explicitly deferred with documented uncertainty.

5. ✅ **Implementation plan written**: Detailed Phase 1 acceptance tests, slice definitions, and team-assignment plan documented.

6. ✅ **No silent defaults in code**: Every architectural choice is explicit in code comments or decision IDs cited; no default implementation of unresolved decisions.

**No implementation is authorized by this document alone.** Sudhanshu's final sign-off on all reviews and gates is required before Phase 1 begins.

---

## Appendix: Quick Links to Discovery Documents

- [Decisions](discovery/decisions.md): Confirmed decisions and working defaults.
- [Provisional Architecture Decisions](discovery/architecture-decisions.md): SETTLED, RECOMMENDED, OPEN RESEARCH, DEFERRED.
- [Data Model Requirements](discovery/data-model-requirements.md): Entities, invariants, canonical records.
- [CLI Contract](discovery/cli-contract.md): Reports, reconciliation, period controls.
- [Skill Architecture](discovery/skill-architecture.md): Engine/CLI/skill/agent responsibilities.
- [GST Compliance Matrix](discovery/gst-compliance-matrix.md): Verified research baseline; GSTR-1, GSTR-3B, e-invoice, e-way bill.
- [Payroll Compliance Matrix](discovery/payroll-compliance-matrix.md): TDS, EPF, ESI, PT, LWF, wage records.
- [Expense Evidence Policy](discovery/expense-evidence-policy.md): Legal and product rules for evidence.
- [Roadmap](discovery/roadmap.md): Phases 1–9, cross-cutting milestones, gates.

---

**Document revision**: 2026-08-20
**Status**: Awaiting Sudhanshu review and architect-tier debate resolution.
