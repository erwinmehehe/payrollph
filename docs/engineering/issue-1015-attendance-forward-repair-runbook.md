# #1015 — attendance exception final-schema repair: protected operator packet

**Status: SOURCE CANDIDATE ONLY. This document does not approve or execute a database migration.**
The Vercel target is named `production` even though the connected sample workspace is classified as fictional development. Treat this as the protected deployment environment until a designated DBA independently proves its identity and authorization. No real payroll release, payments, filing, bank or employee-data writes are permitted from this work.

## Verified evidence (2026-10-15)

- Connected Neon project: `calm-wave-70219564`, primary/default branch `br-lucky-sound-b79i56jw`, database `neondb`, compute `ep-cool-hat-b7e7gpoo`. Its database-side Neon identity settings matched those identifiers on a metadata-only SELECT.
- The canonical #1015 pg_catalog preflight returned **36/36 MISSING**: `public.attendance_exception_events` plus its 23 columns, five indexes, five foreign-key relationships and two CHECK constraints.
- All four parents `public.organizations`, `public.employees`, `public.users` and `public.time_punches` exist with single-column integer primary keys, as inspected via pg_catalog.
- This database has no visible `public.payrollph_release_migration_receipts` or `public.payrollph_migration_cutover` objects or forward SQL ledger; **past migration adoption is unproved**.
- The Vercel project has a sensitive production-targeted `DATABASE_URL` but the connected reader could not reveal its identity. **Vercel-to-Neon endpoint/role equivalence is not independently verified.**
- Neon returned an **empty automatic snapshot schedule**, one existing snapshot expiring **2026-10-19**, and project PITR/history of **21,600 seconds (6h)**; none is a signed backup/restore receipt. Prior incident [#899](https://github.com/erwinmehehe/payrollph/issues/899) documents why changing the default branch/endpoint by snapshot restore is prohibited without independent authorization.

## Candidate source and exact behavior

`drizzle/0124_attendance_exception_forward_repair.sql` is an **append-only numbered source file**, not an ad hoc replay of archived `0067` and `0088`. It creates the current Drizzle final-state relation **only if the target relation is completely absent**:

- Requires four existing public parent tables with integer primary keys, otherwise fails before any DDL.
- Refuses orphaned SERIAL sequence, primary-key/index names or an existing target relation; partial historical DDL requires separate DBA diagnosis rather than an unguarded retry.
- Explicit, schema-qualified public table with the 23 expected columns, defaults, ownership/SLA/resolution fields, five FKs and two named CHECK constraints.
- Creates exactly five required indexes, including the four-key tenant/employee/date/fingerprint uniqueness constraint.
- Before the protected runner's journal commit, an in-transaction **catalog-only postflight** requires 23 columns, the five named valid indexes, five validated foreign keys, two named validated CHECKs and one primary key. This guards against an incomplete DDL result but does **not** replace the separate 36-point independent read-only schema audit.
- Performs **no application row reads, writes, historical SLA backfill, payroll mutations, grants, runtime DDL, or journal writes in the SQL body**. The existing reviewed runner must own its transaction, advisory lock, and atomic execution receipt.
- Refuses an existing table or incompatible parent, rather than `IF NOT EXISTS` masking drift. DBA must review any partial/other-schema existing state separately.

The repository test `tests/issue-1015-attendance-forward-repair.test.mjs` rehearses the **exact file** in a random, disposable localhost CI PostgreSQL 16 database. It checks missing, wrongly typed and non-PK parent prerequisites, orphaned sequence/index names and existing-table replay refusal; on valid parents it checks all 36 catalog objects, tenant-scoped uniqueness, both CHECK constraints and all FK deletion policies on synthetic data. It **rolls back and deletes the scratch database**. This test must PASS before source approval.

## Required human DBA/security gates — STOP if any fail

1. **Target identity:** DBA privately verify Vercel's effective deployment `DATABASE_URL` host, db, role, Neon project, branch and endpoint against exact application SHA and verified server identity. Do not paste passwords or the URL in GitHub/chat.
2. **Source/receipt adoption:** Reconcile every historical numbered migration by full path and exact SHA and establish independently reviewed `payrollph_release_migration_receipts`, `payrollph_migration_cutover` and protected journal adoption. Do not fabricate receipts. The existing protected forward runner **WILL and SHOULD refuse** this candidate without valid history.
3. **Sequence:** The new number is **0124**. The existing forward migration runner must have a verified historical boundary and applied/receipted **every preceding post-cutover migration through 0123**. Do not skip, renumber, auto-replay, or force this repair to bypass failed prerequisites.
4. **Backup/restore:** Document approved retention, private encrypted offsite backup hash/version, a **witnessed isolated offline restore**, independent recovery approval and #899 follow-up. No default-Neon-branch restore/swap as a test.
5. **Role and schema:** DBA validate ownership, app role's least-privilege table and sequence access, unique constraint/index signatures, FK behavior and tenant authorization, plus lock and change-window risk. No broad grants should be inferred from the current `neondb_owner` connector context.
6. **Reviewed protected workflow:** From a protected, exact reviewed `main` SHA and an approved GitHub `production` environment, run **Production Reviewed SQL Migration (Manual, Protected)** with `mode=plan` first, filename `drizzle/0124_attendance_exception_forward_repair.sql`, and the **exact byte SHA-256** of the reviewed file. Only after a separate DBA/security approval reference and a passing plan/rollback may an authorized operator choose `mode=apply` with the workflow's explicit confirmation. Do not execute `db:push`, ad hoc `psql`, old `0067/0088`, or startup compatibility DDL on the live branch.
7. **Receipt and postflight:** Record the immutable protected runner receipt, approved change and reviewed exact SHA. Re-run `docs/sql/issue-1015-attendance-exception-catalog-preflight.sql` in a read-only, independently authorized account; require **36/36 PASS** on the *same verified live database*. Confirm authorized/denied `GET /api/workforce/attendance-exception-events` responses and Owner/HR/Payroll interface behavior with fictional accounts; inspect real post-test request logs for 500s. Validate independent human UAT.

## Go/no-go statement

Until all gates above are documented, status is **NO-GO: SCHEMA_MISSING / MIGRATION_HISTORY_UNRECONCILED / RESTORE_UNAPPROVED / DEPLOYMENT_IDENTITY_NOT_PROVED**. Merging this source-only candidate must never be described as an applied database repair.

### Evidence references

- [Attendance incident #1015](https://github.com/erwinmehehe/payrollph/issues/1015)
- [Snapshot and routing incident #899](https://github.com/erwinmehehe/payrollph/issues/899)
- [Protected release runner](../../.github/workflows/production-reviewed-sql-migration.yml)
- [Existing catalog-only preflight](../sql/issue-1015-attendance-exception-catalog-preflight.sql)
- [Historical adoption and receipt runbook](production-migration-receipt-runbook.md)
