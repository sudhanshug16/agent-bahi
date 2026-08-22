/** SQLite-only customer, sales invoice, and bank receipt slice. */
export const SALES_V6_MIGRATION_SQLITE = `
CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) > 0 AND display_name = trim(display_name)),
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT fk_party_book_set FOREIGN KEY (book_set_id, tenant_id) REFERENCES book_sets(id, tenant_id)
);
CREATE UNIQUE INDEX uq_parties_id_tenant_book_set_v6 ON parties(id, tenant_id, book_set_id);
CREATE INDEX idx_parties_scope_name_v6 ON parties(tenant_id, book_set_id, display_name);

CREATE TABLE sales_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  narration TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID')),
  total_minor INTEGER NOT NULL CHECK (typeof(total_minor) = 'integer' AND total_minor > 0),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (typeof(paid_minor) = 'integer' AND paid_minor >= 0 AND paid_minor <= total_minor),
  receivable_account_id TEXT,
  posted_journal_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  posted_at TEXT,
  CONSTRAINT uq_sales_invoice_number_scope UNIQUE (tenant_id, book_set_id, invoice_number),
  CONSTRAINT fk_sales_invoice_book_set FOREIGN KEY (book_set_id, tenant_id) REFERENCES book_sets(id, tenant_id),
  CONSTRAINT fk_sales_invoice_customer FOREIGN KEY (customer_id, tenant_id, book_set_id) REFERENCES parties(id, tenant_id, book_set_id),
  CONSTRAINT fk_sales_invoice_receivable FOREIGN KEY (receivable_account_id, tenant_id, book_set_id) REFERENCES accounts(id, tenant_id, book_set_id),
  CONSTRAINT fk_sales_invoice_journal FOREIGN KEY (posted_journal_id, tenant_id, book_set_id) REFERENCES journal_entries(id, tenant_id, book_set_id),
  CONSTRAINT chk_sales_invoice_status_fields CHECK (
    (status = 'DRAFT' AND receivable_account_id IS NULL AND posted_journal_id IS NULL AND posted_at IS NULL AND paid_minor = 0)
    OR (status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') AND receivable_account_id IS NOT NULL AND posted_journal_id IS NOT NULL AND posted_at IS NOT NULL)
  ),
  CONSTRAINT chk_sales_invoice_paid_status CHECK (
    (status = 'POSTED' AND paid_minor = 0)
    OR (status = 'PARTIALLY_PAID' AND paid_minor > 0 AND paid_minor < total_minor)
    OR (status = 'PAID' AND paid_minor = total_minor)
    OR status = 'DRAFT'
  )
);

CREATE TABLE sales_invoice_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (typeof(line_number) = 'integer' AND line_number > 0),
  description TEXT NOT NULL CHECK (length(description) > 0),
  revenue_account_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor > 0),
  CONSTRAINT uq_sales_invoice_line_number UNIQUE (invoice_id, line_number),
  CONSTRAINT fk_sales_invoice_line_invoice FOREIGN KEY (invoice_id, tenant_id, book_set_id) REFERENCES sales_invoices(id, tenant_id, book_set_id),
  CONSTRAINT fk_sales_invoice_line_revenue FOREIGN KEY (revenue_account_id, tenant_id, book_set_id) REFERENCES accounts(id, tenant_id, book_set_id)
);
CREATE UNIQUE INDEX uq_sales_invoices_id_tenant_book_set_v6 ON sales_invoices(id, tenant_id, book_set_id);
CREATE INDEX idx_sales_invoice_scope_status_v6 ON sales_invoices(tenant_id, book_set_id, status, issue_date, id);
CREATE INDEX idx_sales_invoice_lines_invoice_v6 ON sales_invoice_lines(tenant_id, book_set_id, invoice_id, line_number);

CREATE TRIGGER sales_invoices_no_delete_posted BEFORE DELETE ON sales_invoices
WHEN OLD.status <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'posted sales invoices are immutable');
END;
CREATE TRIGGER sales_invoices_posted_fields_immutable BEFORE UPDATE ON sales_invoices
WHEN OLD.status <> 'DRAFT' AND NOT (
  NEW.id IS OLD.id AND NEW.tenant_id IS OLD.tenant_id AND NEW.book_set_id IS OLD.book_set_id
  AND NEW.invoice_number IS OLD.invoice_number AND NEW.customer_id IS OLD.customer_id
  AND NEW.issue_date IS OLD.issue_date AND NEW.due_date IS OLD.due_date
  AND NEW.narration IS OLD.narration AND NEW.total_minor IS OLD.total_minor
  AND NEW.receivable_account_id IS OLD.receivable_account_id AND NEW.posted_journal_id IS OLD.posted_journal_id
  AND NEW.created_at IS OLD.created_at AND NEW.posted_at IS OLD.posted_at
  AND NEW.updated_at IS NOT OLD.updated_at AND NEW.paid_minor >= OLD.paid_minor
  AND NEW.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
)
BEGIN
  SELECT RAISE(ABORT, 'posted sales invoice financial fields are immutable');
END;
CREATE TRIGGER sales_invoice_lines_no_update BEFORE UPDATE ON sales_invoice_lines
BEGIN
  SELECT RAISE(ABORT, 'sales invoice lines are immutable');
END;
CREATE TRIGGER sales_invoice_lines_no_delete BEFORE DELETE ON sales_invoice_lines
BEGIN
  SELECT RAISE(ABORT, 'sales invoice lines are immutable');
END;

CREATE TABLE bank_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  receipt_date TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  reference TEXT,
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor > 0),
  journal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_bank_receipt_book_set FOREIGN KEY (book_set_id, tenant_id) REFERENCES book_sets(id, tenant_id),
  CONSTRAINT fk_bank_receipt_customer FOREIGN KEY (customer_id, tenant_id, book_set_id) REFERENCES parties(id, tenant_id, book_set_id),
  CONSTRAINT fk_bank_receipt_bank FOREIGN KEY (bank_account_id, tenant_id, book_set_id) REFERENCES accounts(id, tenant_id, book_set_id),
  CONSTRAINT fk_bank_receipt_journal FOREIGN KEY (journal_id, tenant_id, book_set_id) REFERENCES journal_entries(id, tenant_id, book_set_id)
);
CREATE TABLE bank_receipt_allocations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor > 0),
  CONSTRAINT uq_bank_receipt_allocation_invoice UNIQUE (receipt_id, invoice_id),
  CONSTRAINT fk_bank_receipt_allocation_receipt FOREIGN KEY (receipt_id, tenant_id, book_set_id) REFERENCES bank_receipts(id, tenant_id, book_set_id),
  CONSTRAINT fk_bank_receipt_allocation_invoice FOREIGN KEY (invoice_id, tenant_id, book_set_id) REFERENCES sales_invoices(id, tenant_id, book_set_id)
);
CREATE UNIQUE INDEX uq_bank_receipts_id_tenant_book_set_v6 ON bank_receipts(id, tenant_id, book_set_id);
CREATE INDEX idx_bank_receipts_scope_date_v6 ON bank_receipts(tenant_id, book_set_id, receipt_date, id);
CREATE INDEX idx_bank_receipt_allocations_invoice_v6 ON bank_receipt_allocations(tenant_id, book_set_id, invoice_id);
CREATE TRIGGER bank_receipts_no_update BEFORE UPDATE ON bank_receipts
BEGIN
  SELECT RAISE(ABORT, 'bank receipts are immutable');
END;
CREATE TRIGGER bank_receipts_no_delete BEFORE DELETE ON bank_receipts
BEGIN
  SELECT RAISE(ABORT, 'bank receipts are immutable');
END;
CREATE TRIGGER bank_receipt_allocations_no_update BEFORE UPDATE ON bank_receipt_allocations
BEGIN
  SELECT RAISE(ABORT, 'bank receipt allocations are immutable');
END;
CREATE TRIGGER bank_receipt_allocations_no_delete BEFORE DELETE ON bank_receipt_allocations
BEGIN
  SELECT RAISE(ABORT, 'bank receipt allocations are immutable');
END;
`;

export const SALES_V6_MIGRATION = {
  id: "0006-sales-receipts",
  sqlite: SALES_V6_MIGRATION_SQLITE,
  manifest: {
    version: 1,
    dialect: "sqlite" as const,
    retrySafe: true,
    probes: [
      { id: "v6-parties", sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'parties' LIMIT 1", expectedRows: [{ table_count: "1" }] },
      { id: "v6-sales-invoices", sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'sales_invoices' LIMIT 1", expectedRows: [{ table_count: "1" }] },
      { id: "v6-receipts", sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'bank_receipts' LIMIT 1", expectedRows: [{ table_count: "1" }] },
      { id: "v6-immutability", sql: "SELECT CAST(COUNT(*) AS TEXT) AS trigger_count FROM sqlite_master WHERE type = 'trigger' AND name IN ('sales_invoice_lines_no_update','bank_receipts_no_update') LIMIT 2", expectedRows: [{ trigger_count: "2" }] },
    ],
  },
};
