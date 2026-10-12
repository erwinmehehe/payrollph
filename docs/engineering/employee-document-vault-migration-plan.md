# A-5: Historical file-to-object migration plan (NOT EXECUTED)

**Source checkpoint:** main `bd5ce9b63483529f48e92bd8e3b17a30124fd758`. This is a design/rehearsal artifact only. Reserve a new, unique numbered migration through the canonical #865 DBA train before merge. No Neon production DDL or destructive retention cleanup is authorized.

## Source inventory and boundaries

| Record / column | Existing representation | Ownership / minimum safety |
| --- | --- | --- |
| `documents.content` | base64 text (NOT NULL) | HR-generated and employee-uploaded files; versioned SHA-256, employee ACLs, COEs and compliance links |
| `statutory_remittance_payment_evidence.file_data_base64` | base64 text (NOT NULL) | Payroll statutory evidence; agency/tax minimum + hold, outside A-5 auto-purge |
| `statutory_posting_evidence_artifacts.file_data_base64` | optional base64 text | Agency posting proof; payroll statutory evidence and legal hold, never silently deleted |

Other `content` columns include policies/audit evidence containing text, not necessarily file bytes. Do **not** migrate or erase them by name matching. Enumerate actual SQL column owners/row counts and live bytes only with an approved least-privilege read role; do not export content to GitHub or CI artifacts.

## Safe reversible stages

1. DBA verifies production schema, historical migration journal, existing object-store contractual region/privacy obligations, DPA, envelope encryption, retention and legal holds. Reconcile proposed A-5 SQL with outstanding #865 / #899. Keep `EMPLOYEE_DOCUMENT_VAULT_ENABLED=false`.
2. Deploy additive `documents.object_storage_key` and the HR-alert ledger only on a disposable or isolated QA database. Leave `documents.content` as NOT NULL for legacy compatibility. New vault uploads use object storage plus `content = ''` (never base64). No in-place replacement and no deleting old bytes.
3. In a separately reviewed backfill job, page tenant-by-tenant and document-by-document. Read **one authorized row**; decode legacy bytes in memory; recompute and compare `sha256`; reject malformed/failed scans; write to an SSE-protected private bucket with key `private-documents/{organizationId}/{employeeId|company}/{randomUUID}`. Store expected SHA-256, byte length, MIME and object key only after write confirmation, audited with document ID and no personal contents.
4. Re-download every object through server-side credentials, verify byte-for-byte hash and content-length, record independently signed, privacy-minimized audit receipts; test tenant A/B, unit scope, time-bounded signed URLs, 404/malware and object-store outage.
5. Only after independent Privacy/DBA approval, back up immutable historic bytes and set `content = ''` in governed batches if there is no legal hold, while retaining SHA and object key. Preserve a safe rollback path until explicit cutover. **Never** do an auto-purge during ordinary payroll or document-expiry scheduler ticks.
6. Move statutory `file_data_base64` columns in a **separate payroll/tax migration**, preserving mandatory 5-year minimums and holds; their owner must approve dual-read/hash and archival evidence. Do not conflate with the employee 201 file.
7. Once all records are verified and all readers migrated, the DBA may propose a later constraint change to remove the legacy column, not in this PR. Disabling the flag must keep signed-object reads/reconciled legacy reads safe; do not strand migrated documents.

## Gates

Flag defaults OFF; object store credentials and malware scanner must be server-only, HTTPS, least-privilege, private, and verified by independent reviewers. Issued URL expiration 60 seconds; every employee document view must produce tenant-bound audit evidence before responding. Scheduler alerts at 30/14/7 calendar-day thresholds must remain private to People admins. Retention is **review-only**, not automatic deletion.
