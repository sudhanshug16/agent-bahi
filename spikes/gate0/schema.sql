CREATE TABLE IF NOT EXISTS schema_migrations (
  logical_id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_sets (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'proprietorship')),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
  PRIMARY KEY (tenant_id, book_set_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, book_set_id) REFERENCES book_sets (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS postings (
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  debit_minor_units INTEGER NOT NULL DEFAULT 0,
  credit_minor_units INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, book_set_id, journal_entry_id, line_no),
  CHECK (
    (debit_minor_units > 0 AND credit_minor_units = 0)
    OR (credit_minor_units > 0 AND debit_minor_units = 0)
  ),
  FOREIGN KEY (tenant_id, book_set_id)
    REFERENCES book_sets (tenant_id, id),
  FOREIGN KEY (tenant_id, book_set_id, journal_entry_id)
    REFERENCES journal_entries (tenant_id, book_set_id, id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  tenant_id TEXT NOT NULL,
  event_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, request_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TRIGGER IF NOT EXISTS journal_entries_validate_balance_on_post
BEFORE UPDATE OF status ON journal_entries
WHEN NEW.status = 'POSTED' AND OLD.status = 'DRAFT'
BEGIN
  SELECT CASE
    WHEN (
      SELECT COUNT(*) FROM postings
      WHERE tenant_id = NEW.tenant_id
        AND book_set_id = NEW.book_set_id
        AND journal_entry_id = NEW.id
    ) = 0 THEN RAISE(ABORT, 'cannot post journal entry with no postings')
    WHEN (
      SELECT COALESCE(SUM(debit_minor_units), 0) FROM postings
      WHERE tenant_id = NEW.tenant_id
        AND book_set_id = NEW.book_set_id
        AND journal_entry_id = NEW.id
    ) != (
      SELECT COALESCE(SUM(credit_minor_units), 0) FROM postings
      WHERE tenant_id = NEW.tenant_id
        AND book_set_id = NEW.book_set_id
        AND journal_entry_id = NEW.id
    ) THEN RAISE(ABORT, 'cannot post journal entry with unbalanced postings')
  END;
END;

CREATE TRIGGER IF NOT EXISTS postings_no_insert_when_posted
BEFORE INSERT ON postings
BEGIN
  SELECT CASE
    WHEN (
      SELECT status FROM journal_entries
      WHERE tenant_id = NEW.tenant_id
        AND book_set_id = NEW.book_set_id
        AND id = NEW.journal_entry_id
    ) = 'POSTED' THEN RAISE(ABORT, 'cannot insert postings for posted journal entry')
  END;
END;

CREATE TRIGGER IF NOT EXISTS postings_no_update
BEFORE UPDATE ON postings
BEGIN
  SELECT RAISE(ABORT, 'postings are append-only');
END;

CREATE TRIGGER IF NOT EXISTS postings_no_delete
BEFORE DELETE ON postings
BEGIN
  SELECT RAISE(ABORT, 'postings are append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS journal_entries_must_start_as_draft
BEFORE INSERT ON journal_entries
BEGIN
  SELECT CASE
    WHEN NEW.status != 'DRAFT' THEN RAISE(ABORT, 'new journal entry must start with status=DRAFT')
  END;
END;

CREATE TRIGGER IF NOT EXISTS journal_entries_no_revert_from_posted
BEFORE UPDATE ON journal_entries
WHEN NEW.status = 'DRAFT' AND OLD.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'posted journal entry cannot revert to draft');
END;

CREATE TRIGGER IF NOT EXISTS journal_entries_no_change_when_posted
BEFORE UPDATE ON journal_entries
WHEN OLD.status = 'POSTED'
BEGIN
  SELECT CASE
    WHEN NEW.tenant_id != OLD.tenant_id THEN RAISE(ABORT, 'posted journal entry tenant_id is immutable')
    WHEN NEW.book_set_id != OLD.book_set_id THEN RAISE(ABORT, 'posted journal entry book_set_id is immutable')
    WHEN NEW.id != OLD.id THEN RAISE(ABORT, 'posted journal entry id is immutable')
    WHEN NEW.idempotency_key != OLD.idempotency_key THEN RAISE(ABORT, 'posted journal entry idempotency_key is immutable')
  END;
END;

CREATE TRIGGER IF NOT EXISTS journal_entries_no_delete_when_posted
BEFORE DELETE ON journal_entries
WHEN OLD.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'posted journal entry cannot be deleted');
END;
