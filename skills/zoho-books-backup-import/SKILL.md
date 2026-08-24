<!-- agent-bahi-skill id="zoho-books-backup-import" version="1" -->
<!-- operation: company.status -->
<!-- operation: zoho-backup.preview -->
<!-- operation: zoho-backup.import -->
<!-- operation: zoho-backup.status -->
<!-- status-focus: source-import -->
<!-- step: zoho-backup.preview kind="OPERATION" operation="zoho-backup.preview" -->
<!-- step: zoho-backup.import kind="OPERATION" operation="zoho-backup.import" -->
<!-- step: zoho-backup.status kind="OPERATION" operation="zoho-backup.status" -->

# Zoho Books backup import

Inspect `company.status` first for the explicit tenant and BookSet scope. Preview the operator-owned Zoho directory or ZIP with `zoho-backup.preview`; retain the archive hash, per-file schema fingerprints, duplicate-header warnings, and every accepted, rejected, staged, and unsupported outcome. Preview never mutates the database.

Import only after a human reviews the exact preview and sends `zoho-backup.import` with `confirm=true`. V1 stages supported source rows when account, tax, relationship, or posting semantics are not proven; it does not infer classifications, post a journal, or mark a filing submitted. Unsupported objects and attachments remain explicit coverage rows.

Use `zoho-backup.status` to inspect the immutable report. Cross-entity evidence, malformed CSV, unsupported statuses, incomplete relationships, rejected rows, unsafe paths, and stale evidence are blockers: preview again after correction and preserve the prior report. The result is not a government submission.
