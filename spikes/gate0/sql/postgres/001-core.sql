-- Gate0 Core Schema — PostgreSQL 17.11
-- Logical ID: gate0-001-core-postgres
-- Hand-reviewed; migration checksum enforced at application layer

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
  debit_minor_units BIGINT NOT NULL DEFAULT 0,
  credit_minor_units BIGINT NOT NULL DEFAULT 0,
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
  tenant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, request_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

-- PostgreSQL function for balance validation before posting
CREATE OR REPLACE FUNCTION validate_journal_balance() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'POSTED' AND OLD.status = 'DRAFT' THEN
    IF (
      SELECT COUNT(*) FROM postings
      WHERE tenant_id = NEW.tenant_id
        AND book_set_id = NEW.book_set_id
        AND journal_entry_id = NEW.id
    ) = 0 THEN
      RAISE EXCEPTION 'cannot post journal entry with no postings';
    END IF;

    IF (
      SELECT COALESCE(SUM(debit_minor_units), 0) FROM postings
      WHERE tenant_id = NEW.tenant_id
        AND book_set_id = NEW.book_set_id
        AND journal_entry_id = NEW.id
    ) != (
      SELECT COALESCE(SUM(credit_minor_units), 0) FROM postings
      WHERE tenant_id = NEW.tenant_id
        AND book_set_id = NEW.book_set_id
        AND journal_entry_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'cannot post journal entry with unbalanced postings';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_validate_balance_on_post
BEFORE UPDATE OF status ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION validate_journal_balance();

-- PostgreSQL function to prevent inserts to posted entries
CREATE OR REPLACE FUNCTION prevent_posting_insert() RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT status FROM journal_entries
    WHERE tenant_id = NEW.tenant_id
      AND book_set_id = NEW.book_set_id
      AND id = NEW.journal_entry_id
  ) = 'POSTED' THEN
    RAISE EXCEPTION 'cannot insert postings for posted journal entry';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER postings_no_insert_when_posted
BEFORE INSERT ON postings
FOR EACH ROW
EXECUTE FUNCTION prevent_posting_insert();

-- PostgreSQL function to prevent updates to postings
CREATE OR REPLACE FUNCTION prevent_posting_update() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'postings are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER postings_no_update
BEFORE UPDATE ON postings
FOR EACH ROW
EXECUTE FUNCTION prevent_posting_update();

-- PostgreSQL function to prevent deletes from postings
CREATE OR REPLACE FUNCTION prevent_posting_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'postings are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER postings_no_delete
BEFORE DELETE ON postings
FOR EACH ROW
EXECUTE FUNCTION prevent_posting_delete();

-- PostgreSQL function to prevent audit log updates
CREATE OR REPLACE FUNCTION prevent_audit_update() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_update();

-- PostgreSQL function to prevent audit log deletes
CREATE OR REPLACE FUNCTION prevent_audit_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_delete();

-- PostgreSQL function to prevent reverting from POSTED to DRAFT
CREATE OR REPLACE FUNCTION prevent_journal_revert() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'DRAFT' AND OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'posted journal entry cannot revert to draft';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_no_revert_from_posted
BEFORE UPDATE OF status ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION prevent_journal_revert();

-- PostgreSQL function to prevent changes to posted entries
CREATE OR REPLACE FUNCTION prevent_journal_change_when_posted() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    IF NEW.tenant_id != OLD.tenant_id THEN
      RAISE EXCEPTION 'posted journal entry tenant_id is immutable';
    END IF;
    IF NEW.book_set_id != OLD.book_set_id THEN
      RAISE EXCEPTION 'posted journal entry book_set_id is immutable';
    END IF;
    IF NEW.id != OLD.id THEN
      RAISE EXCEPTION 'posted journal entry id is immutable';
    END IF;
    IF NEW.idempotency_key != OLD.idempotency_key THEN
      RAISE EXCEPTION 'posted journal entry idempotency_key is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_no_change_when_posted
BEFORE UPDATE ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION prevent_journal_change_when_posted();

-- PostgreSQL function to prevent deletes of posted entries
CREATE OR REPLACE FUNCTION prevent_journal_delete_when_posted() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'posted journal entry cannot be deleted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_no_delete_when_posted
BEFORE DELETE ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION prevent_journal_delete_when_posted();

-- PostgreSQL function to enforce draft status on creation
CREATE OR REPLACE FUNCTION enforce_draft_status_on_insert() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status != 'DRAFT' THEN
    RAISE EXCEPTION 'new journal entry must start with status=DRAFT';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_must_start_as_draft
BEFORE INSERT ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION enforce_draft_status_on_insert();
