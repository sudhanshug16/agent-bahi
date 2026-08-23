/** Neutral CA close pack V1 for deterministic period-end reporting. */
export const CLOSE_PACK_V9_MIGRATION_SQLITE = `
CREATE TABLE close_pack_manifests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  basis TEXT NOT NULL,
  manifest_format TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  period_close_state_hash TEXT NOT NULL,
  period_close_label TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  government_compatible INTEGER NOT NULL,
  submitted INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT uq_close_pack_manifest_request UNIQUE (tenant_id, book_set_id, request_id),
  CONSTRAINT uq_close_pack_manifest_scope_key UNIQUE (id, tenant_id, book_set_id),
  CONSTRAINT fk_close_pack_manifest_book_set FOREIGN KEY (book_set_id, tenant_id) REFERENCES book_sets(id, tenant_id),
  CONSTRAINT chk_close_pack_manifest_dates CHECK (length(period_start) = 10 AND length(period_end) = 10 AND length(as_of_date) = 10 AND period_start <= period_end),
  CONSTRAINT chk_close_pack_manifest_basis CHECK (basis = 'ACCRUAL'),
  CONSTRAINT chk_close_pack_manifest_format CHECK (manifest_format = 'NEUTRAL_CA_CLOSE_PACK_V1'),
  CONSTRAINT chk_close_pack_manifest_version CHECK (schema_version = 1),
  CONSTRAINT chk_close_pack_manifest_label CHECK (period_close_label IN ('OPEN', 'CLOSED', 'REOPENED')),
  CONSTRAINT chk_close_pack_manifest_hashes CHECK (length(period_close_state_hash) = 64 AND period_close_state_hash NOT GLOB '*[^0-9a-f]*' AND length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*' AND length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*' AND length(result_hash) = 64 AND result_hash NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT chk_close_pack_manifest_boolean CHECK (government_compatible IN (0, 1) AND submitted IN (0, 1))
);

CREATE TABLE close_pack_sections (
  id TEXT PRIMARY KEY,
  manifest_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  section_name TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  body_hash TEXT NOT NULL,
  body_size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT uq_close_pack_section_name UNIQUE (manifest_id, section_name),
  CONSTRAINT uq_close_pack_section_scope_key UNIQUE (id, manifest_id, tenant_id, book_set_id),
  CONSTRAINT fk_close_pack_section_manifest FOREIGN KEY (manifest_id, tenant_id, book_set_id) REFERENCES close_pack_manifests(id, tenant_id, book_set_id),
  CONSTRAINT chk_close_pack_section_counts CHECK (row_count >= 0 AND body_size_bytes >= 0),
  CONSTRAINT chk_close_pack_section_hash CHECK (length(body_hash) = 64 AND body_hash NOT GLOB '*[^0-9a-f]*')
);

CREATE TABLE close_pack_bodies (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  csv_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT uq_close_pack_body_section UNIQUE (section_id),
  CONSTRAINT uq_close_pack_body_scope_key UNIQUE (id, section_id, manifest_id, tenant_id, book_set_id),
  CONSTRAINT fk_close_pack_body_section FOREIGN KEY (section_id, manifest_id, tenant_id, book_set_id) REFERENCES close_pack_sections(id, manifest_id, tenant_id, book_set_id),
  CONSTRAINT chk_close_pack_body_nonempty CHECK (length(csv_body) > 0)
);

CREATE INDEX idx_close_pack_manifests_scope_period ON close_pack_manifests (tenant_id, book_set_id, period_start, period_end, created_at, id);
CREATE INDEX idx_close_pack_sections_manifest ON close_pack_sections (manifest_id, created_at, id);

CREATE TRIGGER close_pack_manifests_no_update BEFORE UPDATE ON close_pack_manifests BEGIN SELECT RAISE(ABORT, 'close pack manifests are immutable'); END;
CREATE TRIGGER close_pack_manifests_no_delete BEFORE DELETE ON close_pack_manifests BEGIN SELECT RAISE(ABORT, 'close pack manifests are immutable'); END;
CREATE TRIGGER close_pack_sections_no_update BEFORE UPDATE ON close_pack_sections BEGIN SELECT RAISE(ABORT, 'close pack sections are immutable'); END;
CREATE TRIGGER close_pack_sections_no_delete BEFORE DELETE ON close_pack_sections BEGIN SELECT RAISE(ABORT, 'close pack sections are immutable'); END;
CREATE TRIGGER close_pack_bodies_no_update BEFORE UPDATE ON close_pack_bodies BEGIN SELECT RAISE(ABORT, 'close pack bodies are immutable'); END;
CREATE TRIGGER close_pack_bodies_no_delete BEFORE DELETE ON close_pack_bodies BEGIN SELECT RAISE(ABORT, 'close pack bodies are immutable'); END;
`;

export const CLOSE_PACK_V9_MIGRATION = {
  id: "0009-close-pack",
  sqlite: CLOSE_PACK_V9_MIGRATION_SQLITE,
  manifest: {
    version: 1,
    dialect: "sqlite" as const,
    retrySafe: true,
    probes: [
      { id: "v9-close-pack-manifests", sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'close_pack_manifests' LIMIT 1", expectedRows: [{ table_count: "1" }] },
      { id: "v9-close-pack-sections", sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'close_pack_sections' LIMIT 1", expectedRows: [{ table_count: "1" }] },
      { id: "v9-close-pack-bodies", sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'close_pack_bodies' LIMIT 1", expectedRows: [{ table_count: "1" }] },
      { id: "v9-close-pack-immutability", sql: "SELECT CAST(COUNT(*) AS TEXT) AS trigger_count FROM sqlite_master WHERE type = 'trigger' AND name IN ('close_pack_manifests_no_update','close_pack_manifests_no_delete','close_pack_sections_no_update','close_pack_sections_no_delete','close_pack_bodies_no_update','close_pack_bodies_no_delete') LIMIT 6", expectedRows: [{ trigger_count: "6" }] },
    ],
  },
};
