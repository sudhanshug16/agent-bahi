/** SQLite-only normalized bank statement import and human-confirmed matching slice. */
export const BANK_RECONCILIATION_V8_MIGRATION_SQLITE = `
CREATE TABLE bank_statements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  external_statement_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  opening_balance_minor INTEGER NOT NULL CHECK (typeof(opening_balance_minor) = 'integer'),
  closing_balance_minor INTEGER NOT NULL CHECK (typeof(closing_balance_minor) = 'integer'),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  CONSTRAINT uq_bank_statement_external UNIQUE (tenant_id, book_set_id, bank_account_id, external_statement_id),
  CONSTRAINT uq_bank_statement_scope_key UNIQUE (id, tenant_id, book_set_id),
  CONSTRAINT uq_bank_statement_account_key UNIQUE (id, tenant_id, book_set_id, bank_account_id),
  CONSTRAINT fk_bank_statement_book_set FOREIGN KEY (book_set_id, tenant_id) REFERENCES book_sets(id, tenant_id),
  CONSTRAINT fk_bank_statement_bank_account FOREIGN KEY (bank_account_id, tenant_id, book_set_id) REFERENCES accounts(id, tenant_id, book_set_id),
  CONSTRAINT chk_bank_statement_period CHECK (length(period_start) = 10 AND length(period_end) = 10 AND period_start <= period_end)
);

CREATE TABLE bank_statement_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  statement_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (typeof(line_number) = 'integer' AND line_number > 0),
  transaction_date TEXT NOT NULL,
  description TEXT NOT NULL CHECK (length(description) > 0),
  reference TEXT,
  signed_amount_minor INTEGER NOT NULL CHECK (typeof(signed_amount_minor) = 'integer' AND signed_amount_minor <> 0),
  CONSTRAINT uq_bank_statement_line_number UNIQUE (statement_id, line_number),
  CONSTRAINT uq_bank_statement_line_scope_key UNIQUE (id, tenant_id, book_set_id, statement_id),
  CONSTRAINT fk_bank_statement_line_statement FOREIGN KEY (statement_id, tenant_id, book_set_id) REFERENCES bank_statements(id, tenant_id, book_set_id)
);

CREATE TABLE bank_matches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  statement_id TEXT NOT NULL,
  statement_line_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'UNDONE')),
  confirmed_at TEXT NOT NULL,
  undone_at TEXT,
  undo_reason TEXT,
  CONSTRAINT uq_bank_match_scope_key UNIQUE (id, tenant_id, book_set_id),
  CONSTRAINT fk_bank_match_statement FOREIGN KEY (statement_id, tenant_id, book_set_id, bank_account_id) REFERENCES bank_statements(id, tenant_id, book_set_id, bank_account_id),
  CONSTRAINT fk_bank_match_line FOREIGN KEY (statement_line_id, tenant_id, book_set_id, statement_id) REFERENCES bank_statement_lines(id, tenant_id, book_set_id, statement_id),
  CONSTRAINT fk_bank_match_journal FOREIGN KEY (journal_entry_id, tenant_id, book_set_id) REFERENCES journal_entries(id, tenant_id, book_set_id),
  CONSTRAINT chk_bank_match_lifecycle CHECK (
    (status = 'ACTIVE' AND undone_at IS NULL AND undo_reason IS NULL)
    OR (status = 'UNDONE' AND undone_at IS NOT NULL AND undo_reason IS NOT NULL AND length(trim(undo_reason)) > 0)
  )
);

CREATE UNIQUE INDEX uq_bank_match_active_line
  ON bank_matches(statement_line_id, tenant_id, book_set_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_bank_match_active_journal_account
  ON bank_matches(journal_entry_id, bank_account_id, tenant_id, book_set_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_bank_statements_scope_period
  ON bank_statements(tenant_id, book_set_id, period_start, period_end, id);
CREATE INDEX idx_bank_statement_lines_scope_date
  ON bank_statement_lines(tenant_id, book_set_id, statement_id, transaction_date, line_number);
CREATE INDEX idx_bank_matches_scope_status
  ON bank_matches(tenant_id, book_set_id, status, statement_id, statement_line_id);

CREATE TRIGGER bank_statements_no_update BEFORE UPDATE ON bank_statements
BEGIN
  SELECT RAISE(ABORT, 'bank statements are immutable');
END;
CREATE TRIGGER bank_statements_no_delete BEFORE DELETE ON bank_statements
BEGIN
  SELECT RAISE(ABORT, 'bank statements are immutable');
END;
CREATE TRIGGER bank_statement_lines_no_update BEFORE UPDATE ON bank_statement_lines
BEGIN
  SELECT RAISE(ABORT, 'bank statement lines are immutable');
END;
CREATE TRIGGER bank_statement_lines_no_delete BEFORE DELETE ON bank_statement_lines
BEGIN
  SELECT RAISE(ABORT, 'bank statement lines are immutable');
END;
CREATE TRIGGER bank_matches_no_delete BEFORE DELETE ON bank_matches
BEGIN
  SELECT RAISE(ABORT, 'bank matches are historical and cannot be deleted');
END;
CREATE TRIGGER bank_matches_lifecycle_guard BEFORE UPDATE ON bank_matches
WHEN NOT (
  OLD.status = 'ACTIVE' AND NEW.status = 'UNDONE'
  AND NEW.id IS OLD.id
  AND NEW.tenant_id IS OLD.tenant_id
  AND NEW.book_set_id IS OLD.book_set_id
  AND NEW.statement_id IS OLD.statement_id
  AND NEW.statement_line_id IS OLD.statement_line_id
  AND NEW.bank_account_id IS OLD.bank_account_id
  AND NEW.journal_entry_id IS OLD.journal_entry_id
  AND NEW.confirmed_at IS OLD.confirmed_at
  AND NEW.undone_at IS NOT NULL
  AND NEW.undo_reason IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'bank match lifecycle is append-only');
END;
`;

export const BANK_RECONCILIATION_V8_MIGRATION = {
  id: "0008-bank-reconciliation",
  sqlite: BANK_RECONCILIATION_V8_MIGRATION_SQLITE,
  manifest: {
    version: 1,
    dialect: "sqlite" as const,
    retrySafe: true,
    probes: [
      { id: "v8-bank-statements", sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'bank_statements' LIMIT 1", expectedRows: [{ table_count: "1" }] },
      { id: "v8-bank-statement-lines", sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'bank_statement_lines' LIMIT 1", expectedRows: [{ table_count: "1" }] },
      { id: "v8-bank-matches", sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'bank_matches' LIMIT 1", expectedRows: [{ table_count: "1" }] },
      { id: "v8-bank-match-guards", sql: "SELECT CAST(COUNT(*) AS TEXT) AS trigger_count FROM sqlite_master WHERE type = 'trigger' AND name IN ('bank_matches_no_delete','bank_matches_lifecycle_guard') LIMIT 2", expectedRows: [{ trigger_count: "2" }] },
    ],
  },
};
