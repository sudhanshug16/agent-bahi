# Discovery Roadmap

The current focus is the native core: building agent-bahi as a self-contained accounting system without external dependencies or importers in the active phase.

## Phase 1: Canonical Data Model and Invariants

**Goal**: Establish the authoritative schema and rules that all phases depend on.

**Scope**:
- Chart of accounts with account types, hierarchies, and India GL standards
- Entity structure with multi-entity support designed but inactive
- Document types (Invoice, Bill, Payment, Journal Entry, etc.)
- Ledger posting mechanics and invariant constraints

**Exit Conditions**:
- Core tables defined with primary/foreign key relationships
- Invariants codified and enforced (debit = credit, account balances, document state validity)
- Schema passes integration tests across all document workflows

## Phase 2: Document/Posting Lifecycle and Agent Safety Gates

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

## Phase 3: Daily Bookkeeping Workflows

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

## Phase 4: Bank Reconciliation, Close, and Financial Reporting

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

## Phase 5: Effective-Dated India Compliance Calculations, Calendars, Review Gates, and Official-Format Exports

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

## Phase 6: Multi-Entity Behavior and Database Adapters

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

## Phase 7: Zoho Books Import—Validated Against the Already Documented Private Fixture

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

**Note**: No importer implementation is in the current phase. The native core (Phases 1–6) must be complete and tested before any Zoho Books data is loaded. Import validation requirements are pre-specified in `zoho-backup-fixture.md` and will not be modified during development.
