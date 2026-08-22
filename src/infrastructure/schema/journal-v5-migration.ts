/**
 * BookSet V4->V5 migration for the first usable ledger slice.
 *
 * Journal rows are posted on insertion and immutable thereafter. The
 * application validates a complete balanced posting before inserting the
 * parent and its lines in one BusinessSession.
 */
export const JOURNAL_V5_MIGRATION_SQLITE = `
CREATE UNIQUE INDEX uq_accounts_id_tenant_book_set_v5
  ON accounts(id, tenant_id, book_set_id);

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  posting_date TEXT NOT NULL CHECK (
    length(posting_date) = 10
    AND substr(posting_date, 5, 1) = '-'
    AND substr(posting_date, 8, 1) = '-'
  ),
  reference TEXT,
  narration TEXT,
  status TEXT NOT NULL CHECK (status = 'POSTED'),
  created_at TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  CONSTRAINT fk_journal_entry_book_set
    FOREIGN KEY (book_set_id, tenant_id) REFERENCES book_sets(id, tenant_id)
);

CREATE UNIQUE INDEX uq_journal_entries_id_tenant_book_set_v5
  ON journal_entries(id, tenant_id, book_set_id);

CREATE TABLE journal_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  description TEXT,
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK (typeof(debit_minor) = 'integer' AND debit_minor >= 0),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (typeof(credit_minor) = 'integer' AND credit_minor >= 0),
  CONSTRAINT chk_journal_line_one_side CHECK (
    (debit_minor > 0 AND credit_minor = 0)
    OR (credit_minor > 0 AND debit_minor = 0)
  ),
  CONSTRAINT fk_journal_line_entry
    FOREIGN KEY (journal_entry_id, tenant_id, book_set_id)
    REFERENCES journal_entries(id, tenant_id, book_set_id),
  CONSTRAINT fk_journal_line_account
    FOREIGN KEY (account_id, tenant_id, book_set_id)
    REFERENCES accounts(id, tenant_id, book_set_id)
);

CREATE INDEX idx_journal_entries_scope_date
  ON journal_entries(tenant_id, book_set_id, posting_date, id);
CREATE INDEX idx_journal_lines_entry
  ON journal_lines(tenant_id, book_set_id, journal_entry_id);
CREATE INDEX idx_journal_lines_account
  ON journal_lines(tenant_id, book_set_id, account_id);

CREATE TRIGGER journal_entries_no_update BEFORE UPDATE ON journal_entries
BEGIN
  SELECT RAISE(ABORT, 'posted journal entries are immutable');
END;

CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON journal_entries
BEGIN
  SELECT RAISE(ABORT, 'posted journal entries are immutable');
END;

CREATE TRIGGER journal_lines_no_update BEFORE UPDATE ON journal_lines
BEGIN
  SELECT RAISE(ABORT, 'posted journal lines are immutable');
END;

CREATE TRIGGER journal_lines_no_delete BEFORE DELETE ON journal_lines
BEGIN
  SELECT RAISE(ABORT, 'posted journal lines are immutable');
END;
`;

export const JOURNAL_V5_MIGRATION = {
  id: "0005-journal-ledger",
  sqlite: JOURNAL_V5_MIGRATION_SQLITE,
  manifest: {
    version: 1,
    dialect: "sqlite" as const,
    retrySafe: true,
    probes: [
      {
        id: "v5-journal-entry-table",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'journal_entries' LIMIT 1",
        expectedRows: [{ table_count: "1" }],
      },
      {
        id: "v5-journal-line-table",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'journal_lines' LIMIT 1",
        expectedRows: [{ table_count: "1" }],
      },
      {
        id: "v5-journal-line-account-binding",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS fk_count FROM pragma_foreign_key_list('journal_lines') WHERE [table] = 'accounts' LIMIT 1",
        expectedRows: [{ fk_count: "3" }],
      },
      {
        id: "v5-journal-immutability",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS trigger_count FROM sqlite_master WHERE type = 'trigger' AND name IN ('journal_entries_no_update','journal_lines_no_update') LIMIT 2",
        expectedRows: [{ trigger_count: "2" }],
      },
    ],
  },
};
