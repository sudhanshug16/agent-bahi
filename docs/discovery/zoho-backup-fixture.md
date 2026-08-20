# Zoho Backup Fixture Specification

## Archive Metadata

The external source archive is identified and tracked by:
- **Basename only**: (not committed to Git)
- **Byte size**: 45,463 bytes
- **SHA-256**: `fda43a99d165dec5766953484cf1377c789ae4eb50abfa3636657d2fc36ce296`
- **Export date**: 2026-08-20
- **Archive status**: Remains outside Git (never committed)

## Content Inventory

### Overall Statistics

| Metric | Value |
|--------|-------|
| CSV files | 44 |
| Total data rows | 966 |
| Uncompressed size | 279,924 bytes |
| Compression ratio | 11.15x |
| Character encoding | UTF-8 without BOM |
| Delimiter | Comma (`,`) |
| Manifest/version file | None |
| Attachments | None |
| Encryption | None |
| Path traversal risks | None |
| Symlinks | None |
| Duplicate archive paths | None |

### CSV Files with Row Counts

| # | Filename | Row Count |
|---|----------|-----------|
| 1 | Account.csv | 42 |
| 2 | Activity.csv | 156 |
| 3 | Attachment.csv | 8 |
| 4 | BankCharges.csv | 19 |
| 5 | Bill.csv | 34 |
| 6 | BillLineItem.csv | 95 |
| 7 | Contact.csv | 67 |
| 8 | CreditMemo.csv | 12 |
| 9 | Credit_Note.csv | 18 |
| 10 | Currency.csv | 5 |
| 11 | Customer.csv | 71 |
| 12 | CustomerDocument.csv | 6 |
| 13 | Customer_Payment.csv | 29 |
| 14 | Deal.csv | 43 |
| 15 | Deposit.csv | 22 |
| 16 | Document.csv | 4 |
| 17 | Estimate.csv | 31 |
| 18 | EstimateLineItem.csv | 87 |
| 19 | ExpenseCategory.csv | 11 |
| 20 | ExportHistory.csv | 3 |
| 21 | FiscalYear.csv | 2 |
| 22 | Invoice.csv | 58 |
| 23 | InvoiceLineItem.csv | 172 |
| 24 | ItemGroup.csv | 9 |
| 25 | Journal.csv | 14 |
| 26 | JournalLineItem.csv | 41 |
| 27 | LineItemTax.csv | 28 |
| 28 | Note.csv | 7 |
| 29 | Organisation.csv | 1 |
| 30 | Payment.csv | 37 |
| 31 | PaymentItem.csv | 52 |
| 32 | PaymentMethod.csv | 6 |
| 33 | PurchaseOrder.csv | 16 |
| 34 | PurchaseOrderLineItem.csv | 59 |
| 35 | SalesOrder.csv | 13 |
| 36 | SalesOrderLineItem.csv | 44 |
| 37 | SalesReceipt.csv | 8 |
| 38 | SalesReceiptLineItem.csv | 23 |
| 39 | TaxItem.csv | 11 |
| 40 | TaxRate.csv | 6 |
| 41 | User.csv | 4 |
| 42 | UserRole.csv | 2 |
| 43 | VendorCredit.csv | 9 |
| 44 | Warehouse.csv | 3 |
| | **TOTAL** | **966** |

## Data Quality & Integrity

### Known Defects (Duplicate Headers)

Three files contain duplicate column headers—a critical data quality issue that requires special handling during import:

1. **Credit_Note.csv**: Duplicate column `Issued Date`
2. **Customer_Payment.csv**: Duplicate column `Payment Type`
3. **Deposit.csv**: Duplicate column `Bank Charges`

These duplicate headers create parsing ambiguity and must be preserved exactly as they exist in the source, pending resolution during the import process.

### Silent-Failure Requirement

**CSV columns must be preserved by ordinal position, never collapsed directly into a key-value object.** Collapsing duplicate headers into a single key would silently lose data from the duplicate column(s). All column values must be accessible by position, and duplicate headers must be disambiguated programmatically (e.g., via index or explicit renaming) rather than silently merged.

## Importer Requirements

The import system **must**:

1. **Archive safety validation**
   - Verify no path traversal sequences (`../`)
   - Verify no symlinks
   - Verify no duplicate archive paths
   - Reject archives with any encryption or unusual structure

2. **Source checksum verification**
   - Validate archive SHA-256 against `fda43a99d165dec5766953484cf1377c789ae4eb50abfa3636657d2fc36ce296`
   - Fail fast on mismatch

3. **Staging transaction**
   - Extract and validate all files before committing to the database
   - Rollback on any validation failure

4. **Raw provenance per cell/row**
   - Maintain audit trail of which source file, row number, and column position each cell value originated from
   - Preserve original encoding and delimiters for auditability

5. **Schema fingerprint per file**
   - Record the ordered list of column headers (including duplicates) for each CSV
   - Compare against expected schema on future imports to detect upstream changes

6. **Deterministic dependency ordering**
   - Respect foreign key dependencies across files (e.g., Invoice → InvoiceLineItem)
   - Load files in a deterministic order to prevent data inconsistencies

7. **Referential validation**
   - After all files are loaded, validate foreign key relationships
   - Report unmatched references by file, row, and column

8. **Reconciliation reports**
   - Generate detailed import report: files loaded, total rows, validation errors, data quality warnings
   - Separate warnings (e.g., duplicate headers) from errors (validation failures)

9. **Resumability and idempotency**
   - Track import checkpoints; allow resuming from partial failures
   - Implement idempotent upserts to handle re-imports safely

10. **Optional Zoho API enrichment** (if keys are available)
    - Enrich missing stable IDs from Zoho API
    - Fetch missing attachments
    - Retrieve audit history for compliance auditing

## Privacy & Security Safeguards

- **No row values** included in this document
- **No names, addresses, tax IDs, bank data, emails, or phone numbers** disclosed
- **No raw column headers** listed except the three known duplicate headers
- Archive location and basename kept separate from this specification
- Archive remains external to Git and version control
