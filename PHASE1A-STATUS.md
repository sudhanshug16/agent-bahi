# Phase 1A Production Persistence - Status & Remaining Work

**Last Updated**: 2026-08-22 **Current HEAD**: 162ee22

## COMPLETED WORK ✅

### Architecture & Ports
- [x] UnitOfWork port + SQLite/PostgreSQL/MySQL implementations
- [x] Crash-safe SQLite advisory locking (uncommitted transaction approach)
- [x] Atomic idempotency: insert-first in same UoW (no silent failures)
- [x] Composite FK enforcement via triggers (cross-tenant isolation)
- [x] BookSet cardinality validation (COMPANY/INDIVIDUAL/PROPRIETORSHIP)
- [x] Account code archive mechanism (permanent code reservation)
- [x] GST effective-dated history support (no UNIQUE blocking)
- [x] Migration checksum verification

### Infrastructure
- [x] SQLite PRAGMA safety (FK, WAL, busy_timeout=0)
- [x] MySQL DELIMITER tokens removed
- [x] PostgreSQL/MySQL adapter structures
- [x] Schema migrations for all 3 dialects

### Testing
- [x] Phase 1A functional tests: 24/24 passing
- [x] Phase 1A defect tests: 13/13 passing (lock refactoring in progress)
- [x] Gate0 PostgreSQL integration: PASSING
- [x] Gate0 MySQL integration: PASSING
- [x] Typecheck: PASSING

---

## CRITICAL REMAINING WORK ❌ 
**These are NOT deferred - Phase 1A requires them**

### 1. Archive/Delete Guards (Database Layer)
**Status**: NOT STARTED
**Requirement**: BookSet cannot be archived if it's the current default
**Requirement**: Accounts cannot be deleted if active postings exist

**Work**:
- [ ] Add trigger to prevent default BookSet archival
- [ ] Add trigger/constraint to prevent active account deletion  
- [ ] Add negative tests proving guards work
- [ ] Test cross-dialect (SQLite/PG/MySQL)

**Files affected**:
- `src/infrastructure/schema/core-schema.ts` (add triggers)
- `tests/persistence/phase1a-defects.test.ts` (add negative tests)

### 2. Migration Recovery & Audit Trail
**Status**: NOT STARTED
**Requirement**: Manual recovery must validate dirty state + owner + be auditable
**Requirement**: clearDirty must hold the exact migration lease

**Work**:
- [ ] Implement recoverDirtyMigration with owner validation
- [ ] Add audit trail for recovery operations
- [ ] Ensure clearDirty acquires/holds migration lock
- [ ] Add tests: dirty recovery with owner mismatch, stale recovery

**Files affected**:
- `src/infrastructure/services/migration-service.ts`
- `tests/persistence/phase1a-defects.test.ts` (recovery tests)

### 3. Compatibility Service Fixes
**Status**: PARTIALLY BROKEN
**Requirement**: Must NOT create tables or use INSERT OR IGNORE
**Requirement**: Must inspect actual schema_migrations + data_format tables
**Requirement**: Fail if empty/dirty, never silent pass

**Work**:
- [ ] Remove table creation from checkCompatibility
- [ ] Read existing schema_migrations table (fail if missing)
- [ ] Check data_format version (new table or column)
- [ ] Fail closed on empty schema/dirty state
- [ ] Add negative tests: empty schema, dirty state, missing table

**Files affected**:
- `src/infrastructure/services/compatibility-service.ts`
- `tests/persistence/phase1a-defects.test.ts` (negative tests)

### 4. Real-Green Test Replacements
**Status**: FALSE POSITIVES EXIST
**Requirement**: Replace placeholder tests with real assertions

**Placeholders to replace**:
- [ ] SQLITE_BUSY test (currently just SELECT 1, not real contention)
- [ ] Symlink safety test (currently expect(true) placeholder)
- [ ] Dirty marker test (silently skips if no row exists)
- [ ] SQLITE_CONSTRAINT error classification test

**Files affected**:
- `tests/persistence/phase1a-defects.test.ts`

### 5. Evidence & PAN Validation
**Status**: SCHEMA ONLY, NO SERVICE TESTS
**Requirement**: PAN HMAC service with raw-absence checks
**Requirement**: Evidence FKs with real binding tests
**Requirement**: Backup service explicit UNAVAILABLE for Phase 1A

**Work**:
- [ ] Implement PAN HMAC fingerprint service
- [ ] Test: raw PAN absence (must fail)
- [ ] Test: missing encryption key (must fail)
- [ ] Add evidence FK binding tests (not just schema)
- [ ] Mark backup as UNAVAILABLE for PG/MySQL in Phase 1A
- [ ] SQLite backup may be fully implemented (verify)

**Files affected**:
- `src/infrastructure/services/pan-service.ts` (NEW)
- `src/infrastructure/services/backup-service.ts` (add UNAVAILABLE marker)
- `tests/persistence/phase1a-defects.test.ts`

### 6. Adapter Live Tests (Not Gate0 SQL)
**Status**: NOT STARTED
**Requirement**: Use production adapter code, not Gate0 proof SQL

**Work**:
- [ ] Add SQLite adapter live tests (core scenarios)
- [ ] Add PostgreSQL adapter live tests (connection management)
- [ ] Add MySQL adapter live tests (TLS + authentication)
- [ ] Test UnitOfWork + transaction semantics
- [ ] Test advisory lock durability across instances

**Files affected**:
- `tests/persistence/adapter-live.test.ts` (NEW)

---

## Test Status

```
Phase 1A Functional:       24/24 ✅
Phase 1A Defects:          13/13 ✅ (1 lock refactoring in progress)
Gate0 PostgreSQL:          ALL PROOFS PASS ✅
Gate0 MySQL:               ALL PROOFS PASS ✅
Typecheck:                 PASS ✅
Trailing whitespace:       Clean ✅

REMAINING:
- Archive/delete guard tests:      0/2
- Migration recovery tests:         0/3
- Compatibility tests:              0/3
- Evidence/PAN tests:              0/4
- Adapter live tests:              0/3
```

---

## Blocking Issues

1. **SQLite lock implementation refactoring** - Uncommented transaction approach working, but tests may need updates
2. **Archive/delete guards not enforced** - Can add guards but must also test them work
3. **Migration recovery not auditable** - Needs explicit owner validation + audit trail
4. **Compatibility service creates tables** - Must be fixed before live testing

---

## Acceptance Criteria (Phase 1A)

- [x] Zero red committed tests
- [x] All schema enforced via database (not just application)
- [ ] All guards protected by negative tests
- [ ] All recovery operations auditable + validated
- [ ] Live dialect tests for adapters (SQLite/PG/MySQL)
- [ ] `git diff --check` clean
- [ ] No false-green placeholders
- [ ] Typecheck passing
- [ ] No external credentials in tests

---

## Next Steps

1. Implement BookSet/Account archival guards (database level)
2. Add negative tests proving guards work
3. Fix compatibility service to inspect real schema
4. Implement auditable migration recovery
5. Add PAN HMAC + evidence validation
6. Run full suite with live adapter tests
7. Final diff check + commit

**Estimated remaining effort**: 4-6 hours (substantial database work + real tests required)
