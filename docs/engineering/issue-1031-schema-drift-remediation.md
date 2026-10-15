# #1031 — P0 schema drift: controlled remediation

**Status: source-only. No production SQL applied; no migration release approved.**

This work is deliberately separate from open attendance PR #1052 and open issues
#1015, #1031 and #899. The financial schema preflight is metadata-only and the
filing SQL is a **non-executable proposal pending independent DBA approval**.

## Verified findings, 2026-10-15

- Source commit 82365aa28e9aaf1c154fdcb38dc46e9a2d6c120a defined 270 public
  Drizzle table names; the Neon project calm-wave-70219564, default branch
  br-lucky-sound-b79i56jw, database neondb contained 136 public tables.
  A name-only diff found **137 source-defined tables absent** and three legacy
  public tables not defined by current source. This is not a full column, FK,
  constraint, index, receipt or data-provenance diff.
- The verified catalog contains permissions assignments, permission sets,
  dynamic worker groups, job profiles, positions and workforce timesheets.
  Historical errors saying these tables did not exist have stale timestamps.
  Their presence does not establish correct authenticated tenant role behavior.
- Still absent: attendance_exception_events, compensation_bands,
  compensation_components, compensation_cycles, compensation_proposals,
  employee_compensation_components and employee_payout_change_requests.
- Existing government_filing_validations table still lacks three nullable
  fields: applicable_month, employee_count and reported_total.
  The archived drizzle/0026_filing_remittance_snapshot.sql defines precisely
  these columns and the monthly lookup index.
- Read-only zero-row probes reproduced missing-relation/column SQL errors on
  the Neon branch. Historical Vercel 42P01/42703 groups correlate with
  affected compliance, attendance, compensation and payout API routes.
  A healthy /api/health proves connectivity only. Do not trigger sensitive
  payroll/payment write endpoints to collect probe evidence.

## Non-production deliverables

1. docs/sql/issue-1031-financial-schema-catalog-preflight.sql: one SELECT
   over pg_catalog only. Results classify priority tables and column types
   PASS, MISSING or DRIFT, without employee or customer data access.
2. docs/sql/issue-1031-filing-snapshot-additive-candidate.sql: exact archived
   additive SQL statements for the filing table, preserved as a **proposal**.
   Do not run on Neon production or mark historical migration 0026 applied.
3. tests/issue-1031-financial-schema-preflight.test.mjs: source-only checks
   and a disposable localhost GitHub Actions PostgreSQL rehearsal that
   executes the proposed SQL twice on a fictional fixture and rolls back.
4. docs/sql/issue-1031-dev-compensation-attendance-payout-repair.sql:
   additive-only reconstruction of the 7 tables listed as "still absent"
   above (compensation_bands/_cycles/_proposals/_components,
   employee_compensation_components, attendance_exception_events,
   employee_payout_change_requests), in their current final schema.ts shape
   rather than a replay of the superseded intermediate migrations. Same
   guard-and-reject pattern as docs/sql/issue-1031-dev-workforce-followups.sql.
   Locally rehearsed against disposable PostgreSQL 16: full current schema
   pushed, the 7 tables dropped to simulate this absent state, the repair
   applied, then a second `drizzle-kit push` and a direct `pg_attribute`/
   `pg_indexes` comparison confirmed zero further column, nullability, FK or
   index drift. **Not yet applied to the connected dev branch** — that still
   needs the same per-table rehearse-on-isolated-clone-then-apply treatment
   already used for stages 1-2 in
   docs/engineering/issue-1031-development-schema-restoration.md, performed
   by whoever holds that Neon connection. tests/issue-1031-dev-compensation-attendance-repair.test.mjs
   covers it with the same source-only checks as the stage 1/2 tests.

## Required DBA-controlled release procedure — currently NO-GO

1. Independently confirm the actual Vercel production database URL's project,
   branch, endpoint, database and role **without revealing secret values**.
   The Neon project/branch inventory alone cannot establish that the Vercel
   connection actually targets it.
2. Reconcile every historical migration file and real receipt, including
   duplicate numeric prefixes and runtime compatibility DDL. Inspect all
   schema columns, check constraints, FK actions, indexes and migration
   prerequisites. Never fabricate receipts or infer historic application from
   filenames or present tables.
3. Witness a protected, encrypted backup and restore using a separately
   privacy-approved sanitized test environment. See #899: a prior restore
   unexpectedly swapped the default Neon branch and production endpoint.
   Never use restore with implicit finalize/default behavior.
4. Plan dependency-ordered, **forward-only** migrations separately:
   existing government filing nullable fields and index; attendance events
   plus ownership/SLA governance (#1015); compensation architecture;
   payout-destination dual control. Do not invent migrated employees, payment
   approvals or authorization assignments. No unreviewed backfills.
5. Rehearse exact source/hashes and negative employer+role isolation under
   disposable PG16/18 and a separately approved isolated clone. Reconcile
   any existing business records. Prove failure recovery, lock behavior,
   unchanged payroll/bank totals and valid constraints.
6. Obtain independent DBA/security approval and use only the protected
   manually triggered reviewed-migration pipeline at a pinned exact main SHA
   and approved Neon branch/endpoint. Its historical cutover, receipts and
   protected environment are currently not verified, so it must fail closed.
   Do not use db:push, raw Neon Console DDL, replay old SQL ad hoc, weaken
   authorization checks, or enable runtime auto-migrations to force success.
7. Verify authenticated, scoped, read-only route acceptance and no 500s for
   compliance remittances, attendance exception events, compensation,
   payout change approvals, BI exports and Workforce Planning. Confirm
   unauthorized roles still get 403 and other employer data is inaccessible.
   Do not perform pay runs, filings, bank actions or real transfers as smoke
   tests.

**Release decision:** No production SQL changes until all above conditions
are demonstrated with migration receipts, independent operational approval,
a safe change window and post-deployment acceptance. A passing PR/CI alone
does not close #1031 or #1015 and does not imply the features are repaired.
