# A-5 and A-6 architecture review — decision record, NOT implementation

**Date:** 2026-10-13  
**Status:** REVIEW REQUIRED. Neither plan is approved for migration or runtime activation.  
**Sources:** docs/security/file-object-storage-review-plan.md; docs/security/tenant-rls-review-plan.md; current main Drizzle schema, documents API, payroll engine and scheduler routes.

This document reviews the two *architecture tickets* named A-5 and A-6 in audit #744. Other drafts use the same labels for unrelated employee document-vault and offboarding features. Those proposals must be coordinated but are not approvals for this work.

## A-5 — move stored file bytes out of PostgreSQL

### Findings from source inspection

- The original plan must cover **three** binary storage families, not just fields named fileDataBase64:
  1. `statutory_remittance_payment_evidence.file_data_base64` is required (NOT NULL).
  2. `statutory_posting_evidence_artifacts.file_data_base64` is nullable.
  3. `documents.content` is required (NOT NULL) and `src/app/api/documents/route.ts` writes uploaded base64 bytes there. The route explicitly says it currently stores the file in Postgres.
- `documents` has file size, MIME, checksum, malware result and employee/tenant links. Reuse these facts when designing an object pointer; do not silently change their meaning.
- `payslips.content` and `hcm_policy_versions.content` are text documents, not confirmed base64 file blobs. Do **not** migrate these without separate content classification and a consumer inventory.
- Inventory every writer, reader, export, delete, backup and email reference for the three file families. Include generated documents and pending related PR #902 (private HR vault). Do not let two storage adapters become independent sources of truth.

### Recommended target (proposed, not purchased)

Use one operator-approved **private S3-compatible object store**, tentatively AWS S3 with SSE-KMS; a dedicated restricted bucket and versioning are strongly preferred. Before fixing provider and region, require a documented Philippine Data Privacy Act/processor-residency and DPA review, retention/legal-hold review, KMS key custody and recovery ownership, egress cost estimate and service availability design. No public CDN, public bucket or provider-generated anonymous permanent link.

A pointer should refer to an immutable **object version**, not merely a mutable key: provider, bucket, opaque key, version identifier, state, plaintext SHA-256, byte count, content type, encryption key/version identifier, tenant ID, originating table/record ID, created/verified timestamps and retention class. Keep government IDs, employee names and original filenames OUT of object keys. Retain original row identity and evidence chain.

### Data-access and migration invariants for later PRs

1. Authorize tenant, employee and evidence purpose **before** generating a short-lived signed GET. Decide and document token TTL (proposal: <=60 seconds), download headers/content disposition, cache-control and audit. An application-envelope-encrypted object must be streamed through an authorized decryption proxy rather than giving the browser undecipherable ciphertext.
2. Only store a usable pointer after size/type validation, malware scan, immutable upload confirmation, a verified SHA-256 of the downloaded object and a compare-and-swap against the unchanged source row. Object writing and database commit are separate failure domains: explicitly handle orphans and retries.
3. Stage a nullable pointer first behind a default-OFF release gate. Because documents.content and statutory_remittance_payment_evidence.file_data_base64 are NOT NULL, **do not** flip those writers to pointer-only until separate reviewed DDL and compatibility handling exist.
4. Dual-read must prefer the verified pointer and deliberately fall back to inline bytes only during an approved transition. Corrupt pointer, wrong checksum, missing object version, scanner failure and wrong tenant MUST fail closed or fall back only under a documented safe rule. Never hide corruption as an empty file.
5. Implement a resumable, tenant- and primary-key-cursor backfill with bounded memory: source rows, source bytes, uploaded, downloaded/verified, CAS-updated, conflicted, failed, retried and orphaned counts, plus hashes and version identifiers. Retry idempotently; do not overwrite concurrent document edits or legal-hold state.
6. Verify restored database pointers **against actual restored object versions and KMS keys**, including a point-in-time recovery rehearsal. Keep inline bytes until mismatch counts are zero, rollback is proven and retention/legal policy permits deletion. The final removal of base64 columns is a separate approved migration.

### A-5 negative acceptance

Cross-tenant download/URL denial; revoked membership and expired signed URL; wrong MIME and malware rejection; overwritten/superseded evidence; interrupted multipart upload; missing bucket/KMS permission; duplicate retry, backfill crash/restart and concurrent modification; missing object version, mismatched content SHA and length; S3/KMS/Pg restore mismatch; legal hold and retention conflict; rollback to retained inline content with byte-for-byte equivalence.

**Owner/DPO/DBA decisions before implementation:** provider + region + processing terms; KMS/envelope strategy; TTL; explicit three-family inventory; immutable/versioned storage semantics; retention and legal holds; dual-read duration; migration/restoration owner. Until then: **NO BUCKET, MIGRATION OR BYTES TRANSFER**.

## A-6 — database tenant isolation via RLS

### Design assessment

The existing plan correctly prefers a **single non-owner, NO BYPASSRLS runtime role** and transaction-local tenant context over one database login per customer. PostgreSQL RLS is an additional backstop, NOT a replacement for the application's membership/RBAC/maker-checker checks. Tenant-level SQL context is useful against accidentally missing tenant filters, but a custom session variable is not an injection-proof signed claim: a compromised runtime SQL executor can issue SET commands. Preserve parameterization, allowlisted SQL and strong DB privileges.

### Table ordering and source-specific concerns

**Wave 0, evidence only:** catalog actual runtime roles and grants, migrations, ownership, existing constraints, NULL tenants, child-table references, and expected behavior for global users, identity/membership, pricing and statutory reference rows. Identify all direct `db`/raw pool call sites; background jobs, migrations and webhook handlers must not silently bypass the transaction wrapper.

**Wave 1:** `employees` and bank-related tenant-owned data (including payout destination change requests and bank templates/configuration). Prove role/employee/tenant masking and denied inserts/updates as well as reads. Preserve maker/checker separation.

**Wave 2:** `payroll_runs`, `payroll_entries`, `payslips` and payout ledgers. **Important:** `payroll_entries` has run_id and employee_id but NO organization_id. Policy joins through parent run/employee can be correct but expensive and create inconsistent tenant-parent risks. Evaluate adding organization_id and composite, tenant-consistent foreign keys in a later *separate* DBA-reviewed migration rather than joining on every row; preserve frozen historical employer attribution. Payslips contain organization_id but also reference entries and employees: all three relationships must agree. Historical cross-entity payroll cannot be reassigned using the current employee's employer.

**Wave 3:** `separation_records`, final-pay evidence, review packages and other salary-sensitive financial child tables, with explicit owner/maker/checker/releaser negative tests. Future HR document RLS is additional scope, not implied by these three waves.

### Transaction and identity contract

- After authenticating the account and independently verifying active tenant membership + applicable entity/department access, open a transaction and use parameterized `set_config('app.tenant_id', tenantId, true)` (SET LOCAL semantics) **inside the same transaction that executes all tenant-owned ORM/SQL statements**.
- Define RLS USING for existing-row visibility and WITH CHECK for new/changed rows. Missing/malformed tenant ID must deny by default. Ensure runtime role cannot alter policies, own protected tables or bypass RLS; separation between migration-owner role and runtime role is mandatory.
- Test pooled connection reuse, errors/rollback, cancellation, idle timeouts, nested transactions, multi-query read flows and serverless PgBouncer transaction pooling. Never set tenant context in an earlier pooled statement outside the transaction.
- Audit raw `pg` clients and modules that create independent transactions. Without a transaction-bound abstraction, even correct policy SQL can unexpectedly block or misattribute reads.
- Global or multi-tenant queries need explicitly designed views/functions under narrowly privileged roles, not general BYPASSRLS on the web application role.

### Schedulers, workers and webhooks

The central scheduler claims due work through an audited, narrowly privileged selector/service function, then processes each tenant in its own tenant-context transaction while preserving PostgreSQL lease fencing. Do not leak a global worker role into routine tenant writes. Provider webhooks must first validate signature/replay and map trusted provider-event records to a tenant; never derive context solely from an unsigned organizationId in a payload. After resolution, switch to the ordinary tenant-bound database path.

### Performance, rollout and rollback

Benchmark EXPLAIN (ANALYZE, BUFFERS), query plans and p95 timings against a representative multi-tenant synthetic database, including employee listing, timesheets, 1,000+ employee payroll runs, joins to payroll_entries/payslips, bank change approvals and final-pay review. Record the real baseline and accept/reject thresholds before defining a rollout SLO. Add composite indexes where policy filters/joins require them; check RLS policy recursion and locks under concurrency.

The rollout requires a **new default-OFF flag plus a separate RLS-capable runtime role and transaction wrapper**. Do not enable RLS on tables still queried by a contextless, flag-off role. Rehearse isolated clone and blue/green credentials: flag-off legacy behavior, flag-on single synthetic tenant, two-tenant cross-read/write rejection, privileged worker/webhook processing, rollback without losing tenant filtering, and an explicit stop state if neither path is safe. The flag is not permission to turn RLS off for all tenants. Runtime DB credentials must never be superuser, table owner or BYPASSRLS.

### A-6 negative acceptance

Two simultaneous tenants using the same pool; malicious/disallowed tenant context; direct SQL cross-tenant select/insert/update/delete; child row whose parent belongs to another tenant; pooled connection after error/rollback; worker job tenant mismatch; unsigned/wrongly signed webhook; stale membership revoked during work; same person trying maker/checker; historical move after released payroll; per-tenant and global query performance regression.

**Owner/DBA/security decisions before implementation:** role topology, policy ownership, source-wide transaction abstraction, first table set, payroll_entries tenancy strategy, worker claim boundary, measurable performance gate, exact cutover/rollback. **NO RLS DDL, GRANTS, RUNTIME FLAG OR MIGRATION IN THIS REVIEW PR**.

## Approval record

| Item | Decision | Current state |
| --- | --- | --- |
| A-5 provider, region, DPA, encryption and retention | Owner + DPO | **Not approved** |
| A-5 exact source tables, dual-read, restore, rollback | DBA + app owners | **Not approved** |
| A-6 database roles, RLS policy ownership and tenant context | DBA + security | **Not approved** |
| A-6 worker/webhook privileges, performance and rollback | DBA + payroll/ops | **Not approved** |

A future implementation must not be merged with P0-1 scheduler acceptance or other payroll/payout changes. Preserve currently default-OFF activation and separately approved production migrations.
