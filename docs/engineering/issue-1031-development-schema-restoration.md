# Issue #1031 — development-only schema repair (15 October 2026)

**Deployment classification:** User confirmed the current PayrollPH environment contains fictional test data only and is in development. This is not certification for payroll production. The Neon default branch happens to be called `main` and is wired to the public dev deployment; branch naming does not authorize live employer payroll.

## Observed cause and review

`/api/bi-exports`, `/api/workforce-planning` and `/api/workforce-planning/allocations` fail with PostgreSQL 42P01: `user_permission_assignments` does not exist. Separate catalog review confirms missing `permission_sets`, `dynamic_worker_groups`, job-family/level/grade/profile tables, `positions`, `position_assignments` and `workforce_timesheets`.

The dev-only additive SQL file `docs/sql/issue-1031-dev-workforce-bi-repair.sql` uses definitions from 0022, 0040, 0044, 0051, 0082, 0095 and current `src/db/schema.ts`; it adds nullable requisition links and fields, partial unique indexes, FKs, the assignment group-pair CHECK, and no seed data. The guard rejects incompatible base catalogs or partially applied earlier repair. It never rewrites `employees`, `payroll_runs`, `user_organizations` or existing payroll figures.

**Do not replay original numbered migrations**, infer historic applied receipts, use `db:push` against Neon, or enable actual payroll, payout, agency filing or bank controls based on this development repair.

## Isolated PostgreSQL 18 rehearsal

- Original branch: `br-lucky-sound-b79i56jw` (`main`, default).
- Preserved isolated point-in-time branch: `br-green-hat-b77qj8fs` / `payrollph-issue1031-dev-rehearsal-20261015`. It is not default and was created by normal clone (no endpoint changes, no restore/finalize).
- Neon manual snapshot creation was attempted, but denied due to the account's snapshot quota. The pre-existing October 12 manual snapshot was not deleted or restored.
- The dev repair's statements were run on the isolated branch inside one PostgreSQL `DO` statement (transactional). First dry-run wrapper had a dollar-quote parsing error and made no changes; corrected execution succeeded.
- Catalog comparison against the current Drizzle source showed **no missing columns across 23 relevant models** after rehearsal.
- Before/after aggregate evidence on the cloned dev database: 8 fictional employee rows, 3 fictional payroll runs, 6 organization memberships; permission assignments, sets, positions and profiles were empty after addition.
- A successful PostgreSQL schema rehearsal is **not** authenticated HTTP acceptance, authorization review, production readiness or backup/restore certification.

## Dev apply/acceptance

1. Confirm connected Neon project/branch/database and the latest GitHub source migration checksum, and retain the preserved clone for recovery. Ensure the branch remains non-default and no Vercel connection is switched.
2. Apply the reviewed **exact dev-only source** on the development default using only additive DDL, transactionally, while avoiding independent ad-hoc snippets. Reject any catalog mismatch; do not construct history receipts.
3. Check all required tables and Drizzle columns, indexes, FK constraints, 8/3/6 aggregate invariants and no default permission assignments.
4. Authenticated dev checks: all three GETs should return 200 with correctly tenant-scoped shape for an authorized test admin; 403 for unauthorized test role; no new 42P01 or 42703 Vercel errors. Main planning supplementary endpoints should not return 500.
5. Run relevant automated tests / CI, verify the UI PR #1033, and capture the deployed commit. Inability to run authenticated UI checks is a documented remaining test, not a pass.

Do not apply this dev repair to an actual employer or production financial environment without separately completing P0-4 controls in `docs/engineering/production-migration-receipt-runbook.md` and #899 restore incident review.
