# Discovery Roadmap

The current focus is the native core and its first automation baseline: building agent-bahi as a self-contained accounting system without external dependencies or importers in the active phase.

## Phase 1: Canonical Data Model and CLI Safety Foundation

**Goal**: Establish the authoritative schema, rules, and explicit safe command surface that all phases depend on.

**Scope**:
- Chart of accounts with account types, hierarchies, and India GL standards
- Entity structure with multi-entity support designed but inactive
- Document types (Invoice, Bill, Payment, Journal Entry, etc.)
- Ledger posting mechanics and invariant constraints
- Explicit CLI commands with deterministic validation and engine-owned permission/gate checks
- Optional tenant-defined reporting dimensions (tags) attached at transaction or line level; tags are orthogonal to accounting and do not affect posting, balance, tax, or compliance

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
- Expense recording and categorization
- Manual journal entries

**Exit Conditions**:
- All daily workflows automated and tested
- User can book a typical day's transactions end-to-end
- No Zoho Books reference needed for daily work

## Phase 5: Bank Reconciliation, Close, and Financial Reporting

**Goal**: Enable month/quarter/year-end close and basic financial statements.

**Scope**:
- Bank statement import and reconciliation
- Period close procedures and freeze
- Trial balance, P&L, and balance sheet generation
- Variance analysis and close checklists

**Exit Conditions**:
- Month-end close is repeatable and documented
- Reconciliation identifies uncleared items
- Financial reports match manual verification

## Phase 6: Effective-Dated India Compliance Calculations, Calendars, Review Gates, and Official-Format Exports

**Goal**: Implement India-specific compliance and statutory reporting with time-aware calculations.

**Scope**:
- Effective-dated calculations for tax, withholding, and filing compliance
- GST/TDS/TCS computation and reconciliation
- Compliance calendars and filing deadlines
- Statutory export formats (GST, CMA, income tax, etc.)
- Review gates for compliance before submission

**Exit Conditions**:
- Statutory reports match compliance software output
- Effective-dated rules handle retroactive adjustments
- All required filings can be generated and validated

## Phase 7: Multi-Entity Behavior and Database Adapters

**Goal**: Support multi-entity operations and pluggable storage backends.

**Scope**:
- Consolidation and inter-entity transactions
- PostgreSQL and MySQL adapters (SQLite remains default)
- Cross-entity reporting and reconciliation
- Data isolation and audit trails per entity

**Exit Conditions**:
- All three legal entities operate in a single system with correct isolation
- Consolidation reports are accurate
- Database adapter tests pass on all supported backends

## Phase 8: Zoho Books Import—Validated Against the Already Documented Private Fixture

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

**Note**: No importer implementation is in the current phase. The native core and skills layer (Phases 1–7) must be complete and tested before any Zoho Books data is loaded. Import validation requirements are pre-specified in `zoho-backup-fixture.md` and will not be modified during development.

## Deferred / Future

### Inventory Accounting (Deferred)

No inventory accounting in v1; products/services and document lines may carry description, quantity, unit, rate, tax treatment, and configured ledger account, but the system will not implement stock movements, warehouses, stock valuation, automated COGS, batches, serial numbers, or manufacturing.

Future inventory support should be enabled by stable item/document-line references and modular extension boundaries, not by speculative placeholder inventory tables now.
