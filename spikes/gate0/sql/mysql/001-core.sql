-- Gate0 Core Schema — MySQL 8.4
-- Logical ID: gate0-001-core-mysql
-- Hand-reviewed; migration checksum enforced at application layer

CREATE TABLE IF NOT EXISTS schema_migrations (
  logical_id VARCHAR(255) PRIMARY KEY,
  checksum VARCHAR(255) NOT NULL,
  applied_at VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS book_sets (
  tenant_id VARCHAR(255) NOT NULL,
  id VARCHAR(255) NOT NULL,
  kind VARCHAR(255) NOT NULL CHECK (kind IN ('personal', 'proprietorship')),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  tenant_id VARCHAR(255) NOT NULL,
  book_set_id VARCHAR(255) NOT NULL,
  id VARCHAR(255) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
  PRIMARY KEY (tenant_id, book_set_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, book_set_id) REFERENCES book_sets (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS postings (
  tenant_id VARCHAR(255) NOT NULL,
  book_set_id VARCHAR(255) NOT NULL,
  journal_entry_id VARCHAR(255) NOT NULL,
  line_no INT NOT NULL CHECK (line_no > 0),
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
  tenant_id VARCHAR(255) NOT NULL,
  event_id VARCHAR(255) PRIMARY KEY,
  entity_type VARCHAR(255) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  action VARCHAR(255) NOT NULL,
  payload TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  tenant_id VARCHAR(255) NOT NULL,
  request_id VARCHAR(255) NOT NULL,
  request_hash VARCHAR(255) NOT NULL,
  result_json LONGTEXT NOT NULL,
  result_hash VARCHAR(255) NOT NULL,
  PRIMARY KEY (tenant_id, request_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

DELIMITER //

-- MySQL trigger for balance validation before posting
CREATE TRIGGER journal_entries_validate_balance_on_post
BEFORE UPDATE ON journal_entries
FOR EACH ROW
BEGIN
  IF NEW.status = 'POSTED' AND OLD.status = 'DRAFT' THEN
    IF (
      SELECT COUNT(*) FROM postings
      WHERE tenant_id = NEW.tenant_id
        AND book_set_id = NEW.book_set_id
        AND journal_entry_id = NEW.id
    ) = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cannot post journal entry with no postings';
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
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cannot post journal entry with unbalanced postings';
    END IF;
  END IF;
END//

-- MySQL trigger to prevent inserts to posted entries
CREATE TRIGGER postings_no_insert_when_posted
BEFORE INSERT ON postings
FOR EACH ROW
BEGIN
  IF (
    SELECT status FROM journal_entries
    WHERE tenant_id = NEW.tenant_id
      AND book_set_id = NEW.book_set_id
      AND id = NEW.journal_entry_id
  ) = 'POSTED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cannot insert postings for posted journal entry';
  END IF;
END//

-- MySQL trigger to prevent updates to postings
CREATE TRIGGER postings_no_update
BEFORE UPDATE ON postings
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'postings are append-only';
END//

-- MySQL trigger to prevent deletes from postings
CREATE TRIGGER postings_no_delete
BEFORE DELETE ON postings
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'postings are append-only';
END//

-- MySQL trigger to prevent audit log updates
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit log is append-only';
END//

-- MySQL trigger to prevent audit log deletes
CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit log is append-only';
END//

-- MySQL trigger to prevent reverting from POSTED to DRAFT
CREATE TRIGGER journal_entries_no_revert_from_posted
BEFORE UPDATE ON journal_entries
FOR EACH ROW
BEGIN
  IF NEW.status = 'DRAFT' AND OLD.status = 'POSTED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'posted journal entry cannot revert to draft';
  END IF;
END//

-- MySQL trigger to prevent changes to posted entries
CREATE TRIGGER journal_entries_no_change_when_posted
BEFORE UPDATE ON journal_entries
FOR EACH ROW
BEGIN
  IF OLD.status = 'POSTED' THEN
    IF NEW.tenant_id != OLD.tenant_id THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'posted journal entry tenant_id is immutable';
    END IF;
    IF NEW.book_set_id != OLD.book_set_id THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'posted journal entry book_set_id is immutable';
    END IF;
    IF NEW.id != OLD.id THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'posted journal entry id is immutable';
    END IF;
    IF NEW.idempotency_key != OLD.idempotency_key THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'posted journal entry idempotency_key is immutable';
    END IF;
  END IF;
END//

-- MySQL trigger to prevent deletes of posted entries
CREATE TRIGGER journal_entries_no_delete_when_posted
BEFORE DELETE ON journal_entries
FOR EACH ROW
BEGIN
  IF OLD.status = 'POSTED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'posted journal entry cannot be deleted';
  END IF;
END//

DELIMITER ;
