# P0-4 DBA handoff — read-only historic SQL and Neon catalog evidence

**Status: PREPARATION ONLY. Production migration release remains blocked.**

This report closes an evidence-collection gap, **not** the missing
historical migration receipts. The latest owner-confirmed production
branch is `br-lucky-sound-b79i56jw` in Neon
`calm-wave-70219564`, database `neondb`. The original production
endpoint is `ep-cool-hat-b7e7gpoo`.

## What the evidence job can establish

`scripts/audit-historical-dba-evidence.mjs --inventory` hashes
**exact checked-in file bytes** for six merged historical sources:

- `0022_job_architecture_positions.sql` — job architecture
- `0050_hcm_core_worker_history.sql` — worker event history
- `0110_provider_events_inbox.sql` — provider idempotency
- `0112_wfm_operational_demand_observations.sql` — demand import
- `0113_wfm_issued_demand_forecasts.sql` — forecast issues
- `0114_wfm_demand_staffing_policies.sql` — governed staffing

The source manifest has full paths and SHA-256 digests; legacy
migration number collisions elsewhere in the project must not be
renamed or inferred from the prefix.

The separate manually dispatched `--verify` operation reads only
`pg_catalog` metadata, within a **REPEATABLE READ, READ ONLY**
transaction with time/lock limits. It inspects required table presence,
the expected types of selected columns, and validity/uniqueness of
critical indexes. All evidence rows are checked for completeness.
It verifies the server's current Neon project, branch and endpoint
GUCs, confirms database name and rejects elevated/privileged catalog
readers. It rolls back even after a successful audit.

**No** SELECT runs against employee, payroll, bank, tax-ID or
tenant business tables. No actual row values, personally identifying
data, or backup files are exported. Output is limited to six
source file hashes, manifest digest, schema object counts and gaps.

An all-present result means *structural prerequisites only*. It
does not mean a particular SQL file was executed, historic positions
were populated correctly, government filings reconciled, or a
release is approved. Output always has
`historicalSQLExecutionProven:false`,
`authenticHistoricalReceiptsObserved:false`,
and `productionMigrationAuthorized:false`.

## Correct-Neon inventory known before this work

A separate read-only Neon inspection on October 12 confirmed
the critical **12 historic tables** were 1/12 present on `main`
(only `workforce_plans`). On an existing isolated lab that
safely rehearsed source 0050, 12/12 were present, but the event
history table was empty, not a recovered record of past employment.
The live employee/payroll aggregate counts at last check were
8 employees, 3 payroll runs, 18 payroll entries. Such counts cannot
prove employer legal-entity transfer history or zero discrepancies.

Neon original branch/endpoint, restored snapshot and aggregate state
were rechecked in the separate incident investigation #899.
This job does not invoke restore APIs or change endpoint mappings.

## Source-only CI

The pull-request workflow
`.github/workflows/historical-dba-evidence.yml`
runs the real Git source manifest and missing/invalid catalog
negative tests **without Neon credentials**. A second job runs the
catalog query on **disposable PostgreSQL18**, and transactionally
tests missing-table detection/rollback; it never connects to Neon.

## Operator setup for actual read-only audit

The production operator configures and reviews the following,
in the existing protected GitHub `production` environment:

1. `PRODUCTION_NEON_PROJECT_ID`,
   `PRODUCTION_NEON_BRANCH_ID` and
   `PRODUCTION_NEON_ENDPOINT_ID`: exact current IDs above.
2. `P0_4_AUDIT_ALLOWED_ACTORS`: explicit comma-separated GitHub
   usernames with permission to request this evidence; do not
   rely on merely naming a protected environment.
3. `PRODUCTION_MIGRATION_AUDIT_DATABASE_URL`: a direct
   `postgresql://` URL to exact
   `ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech:5432/neondb`
   with `sslmode=verify-full`. Use a **dedicated catalog-only** role,
   not an owner or full-row-reading backup role.
   SELECT on nonjournal business tables, DML, DDL, role admin and
   BYPASSRLS permissions must all be absent.
4. Manual `workflow_dispatch` from the **actual reviewed** `main`
   commit SHA with a `P0-4-...` change reference. Check the
   `production` environment reviewer rules before invoking.
5. Inspect the emitted SHA/source/object summary as **non-authorizing**
   evidence and reconcile it independently with DBA change logs,
   actual applied migration records, historical transformations,
   runtime DDL/ad-hoc changes and retained backup/restore evidence.

If any pinned Neon identity is missing, the reader is elevated, the
connection host is pooled/wrong, or a catalog row is omitted,
the job rejects the evidence rather than producing a partial pass.
It does not create or update a migration journal.

## Still required after evidence capture

The DBA documents each historic source's real disposition, any
unrecorded runtime database changes, and the provenance and date
of the employer data (including worker employment events).
A qualified reviewer must validate complete foreign keys, indexes,
legacy prefix collisions, accurate employee centavo reconciliation
and a restored backup. Only then may a separately reviewed
**forward-only** repair and adopted cutover be considered.

The proposed 0115–0121 migration train (#865) and protected
reviewed executor (#867) remain independent production gates.
External encrypted backup activation and witnessed restore remain
tracked in #907; incident availability review remains #899.

**Do not run `db:push` or historical numbered files against
production. No bank account modification or payout is authorized.**

## Issue #1198 repository-owned migration forensics

The dated read-only findings, evidence classification and next authorized DBA steps live in [issue-1198-migration-forensics-20261017.md](issue-1198-migration-forensics-20261017.md). The matching [catalog-only SQL worksheet](issue-1198-catalog-only-inspection.sql) is **review-only** and never runs in CI or against production by default; the offline source guard is `tests/issue-1198-migration-forensics.test.mjs` in the existing historical DBA evidence PR workflow. Use the existing protected role/target verification workflows instead of executing the worksheet with `neondb_owner` or the overprivileged `payrollph_schema_auditor`. Historical migrations remain **UNPROVEN** until authentic target-specific execution receipts are recovered; no journal backfill or production SQL is authorized by this documentation.
