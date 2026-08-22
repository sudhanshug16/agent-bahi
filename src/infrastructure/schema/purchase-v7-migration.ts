/** SQLite-only vendor bills and vendor payment allocation slice. */
export const PURCHASE_V7_MIGRATION_SQLITE = `
ALTER TABLE parties ADD COLUMN party_role TEXT NOT NULL DEFAULT 'CUSTOMER'
  CHECK (party_role IN ('CUSTOMER', 'VENDOR', 'BOTH'));

CREATE INDEX idx_parties_scope_role_v7 ON parties(tenant_id, book_set_id, party_role, display_name);

CREATE TABLE vendor_bills (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  bill_number TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  bill_date TEXT NOT NULL,
  due_date TEXT,
  narration TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID')),
  total_minor INTEGER NOT NULL CHECK (typeof(total_minor) = 'integer' AND total_minor > 0),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (typeof(paid_minor) = 'integer' AND paid_minor >= 0 AND paid_minor <= total_minor),
  payable_account_id TEXT,
  posted_journal_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  posted_at TEXT,
  CONSTRAINT uq_vendor_bill_number_scope UNIQUE (tenant_id, book_set_id, bill_number),
  CONSTRAINT fk_vendor_bill_book_set FOREIGN KEY (book_set_id, tenant_id) REFERENCES book_sets(id, tenant_id),
  CONSTRAINT fk_vendor_bill_vendor FOREIGN KEY (vendor_id, tenant_id, book_set_id) REFERENCES parties(id, tenant_id, book_set_id),
  CONSTRAINT fk_vendor_bill_payable FOREIGN KEY (payable_account_id, tenant_id, book_set_id) REFERENCES accounts(id, tenant_id, book_set_id),
  CONSTRAINT fk_vendor_bill_journal FOREIGN KEY (posted_journal_id, tenant_id, book_set_id) REFERENCES journal_entries(id, tenant_id, book_set_id),
  CONSTRAINT chk_vendor_bill_status_fields CHECK (
    (status = 'DRAFT' AND payable_account_id IS NULL AND posted_journal_id IS NULL AND posted_at IS NULL AND paid_minor = 0)
    OR (status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') AND payable_account_id IS NOT NULL AND posted_journal_id IS NOT NULL AND posted_at IS NOT NULL)
  ),
  CONSTRAINT chk_vendor_bill_paid_status CHECK (
    (status = 'POSTED' AND paid_minor = 0)
    OR (status = 'PARTIALLY_PAID' AND paid_minor > 0 AND paid_minor < total_minor)
    OR (status = 'PAID' AND paid_minor = total_minor)
    OR status = 'DRAFT'
  )
);

CREATE TABLE vendor_bill_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (typeof(line_number) = 'integer' AND line_number > 0),
  description TEXT NOT NULL CHECK (length(description) > 0),
  expense_account_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor > 0),
  CONSTRAINT uq_vendor_bill_line_number UNIQUE (bill_id, line_number),
  CONSTRAINT fk_vendor_bill_line_bill FOREIGN KEY (bill_id, tenant_id, book_set_id) REFERENCES vendor_bills(id, tenant_id, book_set_id),
  CONSTRAINT fk_vendor_bill_line_expense FOREIGN KEY (expense_account_id, tenant_id, book_set_id) REFERENCES accounts(id, tenant_id, book_set_id)
);

CREATE UNIQUE INDEX uq_vendor_bills_id_tenant_book_set_v7 ON vendor_bills(id, tenant_id, book_set_id);
CREATE INDEX idx_vendor_bills_scope_status_v7 ON vendor_bills(tenant_id, book_set_id, status, bill_date, id);
CREATE INDEX idx_vendor_bill_lines_bill_v7 ON vendor_bill_lines(tenant_id, book_set_id, bill_id, line_number);

CREATE TRIGGER vendor_bills_no_delete_posted BEFORE DELETE ON vendor_bills
WHEN OLD.status <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'posted vendor bills are immutable');
END;

CREATE TRIGGER vendor_bills_posted_fields_immutable BEFORE UPDATE ON vendor_bills
WHEN OLD.status <> 'DRAFT' AND NOT (
  NEW.id IS OLD.id AND NEW.tenant_id IS OLD.tenant_id AND NEW.book_set_id IS OLD.book_set_id
  AND NEW.bill_number IS OLD.bill_number AND NEW.vendor_id IS OLD.vendor_id
  AND NEW.bill_date IS OLD.bill_date AND NEW.due_date IS OLD.due_date
  AND NEW.narration IS OLD.narration AND NEW.total_minor IS OLD.total_minor
  AND NEW.payable_account_id IS OLD.payable_account_id AND NEW.posted_journal_id IS OLD.posted_journal_id
  AND NEW.created_at IS OLD.created_at AND NEW.posted_at IS OLD.posted_at
  AND NEW.updated_at IS NOT OLD.updated_at AND NEW.paid_minor >= OLD.paid_minor
  AND NEW.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
)
BEGIN
  SELECT RAISE(ABORT, 'posted vendor bill financial fields are immutable');
END;

CREATE TRIGGER vendor_bill_lines_no_update BEFORE UPDATE ON vendor_bill_lines
BEGIN
  SELECT RAISE(ABORT, 'vendor bill lines are immutable');
END;

CREATE TRIGGER vendor_bill_lines_no_delete BEFORE DELETE ON vendor_bill_lines
BEGIN
  SELECT RAISE(ABORT, 'vendor bill lines are immutable');
END;

CREATE TABLE vendor_payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  reference TEXT,
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor > 0),
  journal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_vendor_payment_book_set FOREIGN KEY (book_set_id, tenant_id) REFERENCES book_sets(id, tenant_id),
  CONSTRAINT fk_vendor_payment_vendor FOREIGN KEY (vendor_id, tenant_id, book_set_id) REFERENCES parties(id, tenant_id, book_set_id),
  CONSTRAINT fk_vendor_payment_bank FOREIGN KEY (bank_account_id, tenant_id, book_set_id) REFERENCES accounts(id, tenant_id, book_set_id),
  CONSTRAINT fk_vendor_payment_journal FOREIGN KEY (journal_id, tenant_id, book_set_id) REFERENCES journal_entries(id, tenant_id, book_set_id)
);

CREATE TABLE vendor_payment_allocations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor > 0),
  CONSTRAINT uq_vendor_payment_allocation_bill UNIQUE (payment_id, bill_id),
  CONSTRAINT fk_vendor_payment_allocation_payment FOREIGN KEY (payment_id, tenant_id, book_set_id) REFERENCES vendor_payments(id, tenant_id, book_set_id),
  CONSTRAINT fk_vendor_payment_allocation_bill FOREIGN KEY (bill_id, tenant_id, book_set_id) REFERENCES vendor_bills(id, tenant_id, book_set_id)
);

CREATE UNIQUE INDEX uq_vendor_payments_id_tenant_book_set_v7 ON vendor_payments(id, tenant_id, book_set_id);
CREATE INDEX idx_vendor_payments_scope_date_v7 ON vendor_payments(tenant_id, book_set_id, payment_date, id);
CREATE INDEX idx_vendor_payment_allocations_bill_v7 ON vendor_payment_allocations(tenant_id, book_set_id, bill_id);

CREATE TRIGGER vendor_payments_no_update BEFORE UPDATE ON vendor_payments
BEGIN
  SELECT RAISE(ABORT, 'vendor payments are immutable');
END;

CREATE TRIGGER vendor_payments_no_delete BEFORE DELETE ON vendor_payments
BEGIN
  SELECT RAISE(ABORT, 'vendor payments are immutable');
END;

CREATE TRIGGER vendor_payment_allocations_no_update BEFORE UPDATE ON vendor_payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'vendor payment allocations are immutable');
END;

CREATE TRIGGER vendor_payment_allocations_no_delete BEFORE DELETE ON vendor_payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'vendor payment allocations are immutable');
END;
`;

export const PURCHASE_V7_MIGRATION = {
  id: "0007-purchase-bills-payments",
  sqlite: PURCHASE_V7_MIGRATION_SQLITE,
  manifest: {
    version: 1,
    dialect: "sqlite" as const,
    retrySafe: true,
    probes: [
      { id: "v7-party-role", sql: "SELECT CAST(COUNT(*) AS TEXT) AS column_count FROM pragma_table_info('parties') WHERE name = 'party_role' LIMIT 1", expectedRows: [{ column_count: "1" }] },
      { id: "v7-vendor-bills", sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'vendor_bills' LIMIT 1", expectedRows: [{ table_count: "1" }] },
      { id: "v7-vendor-payments", sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'vendor_payments' LIMIT 1", expectedRows: [{ table_count: "1" }] },
      { id: "v7-immutability", sql: "SELECT CAST(COUNT(*) AS TEXT) AS trigger_count FROM sqlite_master WHERE type = 'trigger' AND name IN ('vendor_bill_lines_no_update','vendor_payments_no_update','vendor_payment_allocations_no_update') LIMIT 3", expectedRows: [{ trigger_count: "3" }] },
    ],
  },
};
