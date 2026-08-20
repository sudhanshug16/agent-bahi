# Discovery Roadmap

The current focus is the native core and its first automation baseline: building agent-bahi as a self-contained accounting system without external dependencies or importers in the active phase. Every tenant remains independent; no cross-tenant relationship feature is planned.

## Cross-cutting discovery milestone: verified GST baseline (2026-08-20)

The [GST Compliance Matrix — Verified Research Baseline](gst-compliance-matrix.md)
records the researched regular-taxpayer GST baseline, the GSTR-1-specific
output boundary, effective-dated model requirements, silent failure gates, and
open research. This documentation milestone does not approve implementation or
submission transport.

Explicit follow-ups before GST implementation decisions:

- research the composition taxpayer path (CMP-08, GSTR-4, and related rules);
- confirm whether a stable official GSTR-3B artifact comparable to GSTR-1
  exists;
- confirm the FY 2025-26 GSTR-9 exemption notification;
- decide e-invoice transport (direct IRP API versus export/upload/import-
  response); and
- decide e-way-bill transport and research effective-dated state rules and
  exceptions.

## Phase 1: Canonical Data Model and CLI Safety Foundation

**Goal**: Establish the authoritative schema, rules, and explicit safe command surface that all phases depend on.

**Scope**:
- Chart of accounts with account types, hierarchies, and India GL standards
- Tenant-scoped entity and account boundaries with no tenant relationship or intercompany model
- Document types (Invoice, Bill, Payment, Journal Entry, etc.)
- Ledger posting mechanics and invariant constraints
- Explicit CLI commands with deterministic validation and engine-owned permission/gate checks
- Optional tenant-defined reporting dimensions (tags) attached at transaction or line level; allocations use explicit split document lines with one tag per split line and totals that reconcile to the source amount; tags are orthogonal to accounting and do not affect posting, balance, tax, or compliance

**Exit Conditions**:
- Core tables defined with primary/foreign key relationships
- Invariants codified and enforced (debit = credit, account balances, document state validity)
- CLI operations are explicit, deterministic, and reject invalid changes before state mutation
- Schema passes integration tests across all document workflows

## Phase 2: Agent Skills Layer

**Goal**: Add versioned agent job skills that orchestrate and verify engine workflows.

**Scope**:
- Define and version the skill contract in `skill-architecture.md`
- Establish the initial job-skill catalog without embedding accounting rules in skills
- Require skills to use explicit CLI commands and return evidence, validation results, and audit metadata
- Automate routine, high-confidence work; route ambiguity to an explicit exception
- Use Zoho Books automation parity as the minimum initial automation baseline

**Exit Conditions**:
- The initial skill catalog is represented by versioned contracts with prerequisites, command boundaries, validation, and exception routes
- Skills can prove what they observed and what they changed through evidence and audit metadata
- Zoho Books automation parity is met as the minimum initial automation baseline

## Phase 3: Document/Posting Lifecycle and Agent Safety Gates

**Goal**: Implement document creation, posting, reversal, and agent-driven edits with safety boundaries.

**Scope**:
- Document state machine (Draft → Posted → Closed)
- Posting pipeline with audit trail
- Reversal and correction patterns
- Agent safety gates: what edits agents can make and when

**Exit Conditions**:
- Documents post deterministically with locked history
- Reversals and corrections produce clean audit trails
- Agent operations validated against permission gates

## Phase 4: Daily Bookkeeping Workflows

**Goal**: Support routine daily accounting operations natively.

**Scope**:
- Invoice and bill creation, aging tracking
- Payment matching and clearing
- Expense recording and categorization, including native evidence, employee claims, advances, reimbursements, and corporate-card workflows
- Manual journal entries

**Exit Conditions**:
- All daily workflows automated and tested
- User can book a typical day's transactions end-to-end
- No Zoho Books reference needed for daily work

## Phase 5: Payroll and Employee Compliance

**Goal**: Implement full India payroll as a deterministic, first-class workstream after the core ledger foundations.

**Scope**:
- Employee statutory profiles, salary structures/components/formulas, and effective-dated rules
- Pay schedules, payroll periods, and approved summarized payroll inputs such as payable days, LOP days, and overtime amounts/hours; no attendance, leave, shift, HRMS, or attendance-import domain
- Regular, bonus, arrears, correction, and off-cycle runs with draft, approval, posting, and locking
- Reimbursements, perquisites, loans, advances, payslips, wage/overtime/deduction reports, and requested employee outputs for secure external delivery; no employee self-service portal
- Payroll TDS, declarations/proofs, Form 16, quarterly TDS statements, PF, ESI, PT, LWF, and statutory filing/remittance references
- Deterministic bank-import CSV export using versioned bank presets; no bank transfer initiation or auto-pay
- Full-and-final settlement and auditable reversal/correction lineage

**Exit Conditions**:
- Pay runs are balanced and reproducible from frozen inputs and effective-dated jurisdiction rules
- Every payroll output, payable, remittance, filing, and bank export artifact has an auditable source link
- Bank export, upload, bank acceptance, debit, and reconciliation are distinct states; only export is in scope, and a generated file is not proof of payment
- Unresolved statutory ambiguity blocks or routes to explicit review; no skill invents amounts or silently posts

## Phase 6: Bank Reconciliation, Close, and Financial Reporting

**Goal**: Enable month/quarter/year-end close and basic financial statements.

**Scope**:
- Bank statement import and reconciliation, including evidence of actual salary payment after export
- Period close procedures and freeze
- Trial balance, P&L, and balance sheet generation
- Variance analysis and close checklists

**Exit Conditions**:
- Month-end close is repeatable and documented
- Reconciliation identifies uncleared items
- Financial reports match manual verification

## Phase 7: Effective-Dated India Compliance Calculations, Calendars, Review Gates, and Official-Format Exports

**Goal**: Implement India-specific compliance and statutory reporting with time-aware calculations.

**Scope**:
- Effective-dated calculations for tax, withholding, and filing compliance
- GST/TDS/TCS computation and reconciliation
- Compliance calendars and filing deadlines
- Filing-specific statutory output formats (GST, CMA, income tax, etc.)
- Filing-specific review and submission decisions; no global government-submission policy
- GST-specific predecessor gates, portal evidence, and effective-dated rule
  selection after the research follow-ups above are separately settled

**Exit Conditions**:
- Statutory reports match compliance software output
- Effective-dated rules handle retroactive adjustments
- Filing outputs can be generated and validated; submission is not implied until its filing-specific decision is explicitly settled

## Phase 8: Database Adapters and Tenant Isolation

**Goal**: Support pluggable storage backends while preserving independent tenant operation.

**Scope**:
- PostgreSQL and MySQL adapters (SQLite remains default)
- Tenant-scoped data isolation and audit trails
- Explicit single-tenant command validation across adapters

**Exit Conditions**:
- Each tenant operates independently with correct isolation
- Database adapter tests pass on all supported backends

## Phase 9: Zoho Books Import—Validated Against the Already Documented Private Fixture

**Goal**: Safely migrate historical data from Zoho Books as a final step.

**Scope**:
- Archive validation, checksums, and integrity checks
- CSV parsing with duplicate column handling
- Foreign key ordering and referential validation
- Idempotent upserts and resumability
- Detailed reconciliation and audit reports

**Exit Conditions**:
- All 966 rows from the fixture archive import cleanly
- Reconciliation report confirms no data loss
- Post-import balances match source
- System operates normally with imported data

**Note**: No importer implementation is in the current phase. The native core and skills layer (Phases 1–8) must be complete and tested before any Zoho Books data is loaded. Import validation requirements are pre-specified in `zoho-backup-fixture.md` and will not be modified during development.

## Deferred / Future

### Inventory Accounting (Deferred)

No inventory accounting in v1; products/services and document lines may carry description, quantity, unit, rate, tax treatment, and configured ledger account, but the system will not implement stock movements, warehouses, stock valuation, automated COGS, batches, serial numbers, or manufacturing.

Future inventory support should be enabled by stable item/document-line references and modular extension boundaries, not by speculative placeholder inventory tables now.
