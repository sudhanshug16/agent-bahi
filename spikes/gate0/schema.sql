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
  id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TABLE IF NOT EXISTS postings (
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  debit_minor_units INTEGER NOT NULL DEFAULT 0,
  credit_minor_units INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, journal_entry_id, line_no),
  CHECK (
    (debit_minor_units > 0 AND credit_minor_units = 0)
    OR (credit_minor_units > 0 AND debit_minor_units = 0)
  ),
  FOREIGN KEY (tenant_id, book_set_id)
    REFERENCES book_sets (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id)
    REFERENCES journal_entries (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  tenant_id TEXT NOT NULL,
  event_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL
);

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
