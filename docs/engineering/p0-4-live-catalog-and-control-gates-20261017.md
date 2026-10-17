# P0-4: October 17, 2026 catalog-only reconciliation and fail-closed journal gate

**Disposition: PRODUCTION NO-GO; engineering source proposal, not migration execution.**
This note describes a read-only production-catalog observation and a new
synthetic-testable guard. It does not authorize a DBA adoption, employee
data access, data export, live migration, storage purchase or payroll pilot.

## Observed target and scope

A read-only Neon catalog call explicitly selected project
`calm-wave-70219564`, original default branch `br-lucky-sound-b79i56jw`
and database `neondb`. PostgreSQL identified version 18.6 and returned
expected in-session project/branch/database equality predicates. **This
Neon branch reported protected=false**; GitHub's separate main-branch
protection does not protect the Neon production database.

**Important limitation:** These checks were made with the connected Neon
account's database owner role, NOT the approved restricted production catalog
auditor; no private Vercel application connection was inspected. No employee,
payroll, banking, authentication or audit-event rows were queried. Identity of
the deployed runtime database credentials remains independently unproven.

At observation, `public` contained **136** base tables. The exact GitHub
`main` `src/db/schema.ts` source at this review defined **271** literal
`pgTable` names: **133** were present in `public`, **138** were absent.
Three existing `public` names not in `schema.ts`
(`ess_employee_photos`, `ess_identifier_requests`,
`ess_other_identifiers`) are defined in separate ESS schema modules; their
presence is not a drop recommendation. This is a **table-name comparison only**,
not a complete column/default/index/FK/data/schema parity assertion.

Individually checked **absent** production relations:
- `payrollph_release_migration_receipts`;
- `payrollph_migration_cutover`;
- `payrollph_schema_migrations`;
- `attendance_exception_events`;
- all six `compensation_bands`, `compensation_cycles`,
  `compensation_proposals`, `compensation_components`,
  `employee_compensation_components`, `compensation_events`.

Previously missing `permission_sets`, `user_permission_assignments`,
`dynamic_worker_groups`, `job_profiles` and `positions` are now present
by name. Their presence is not a historical migration receipt or complete
tenant/RBAC acceptance.

## Narrow source implementation in this review

`scripts/lib/reviewed-migration-control-ledger.mjs` adds a PostgreSQL
`pg_catalog`-only, fail-closed contract for the **existing three DBA
control-plane tables** before any PLAN or APPLY can read purported cutover
history. The standard reviewed-migration runner calls the guard after its
existing target, modern-lineage, journal presence and PK/UNIQUE guards.

The guard independently checks:
1. Three regular relations with **exactly 6 source-template columns each**;
   all 18 attributes must have their expected PostgreSQL type, typmod and
   NOT NULL contract.
2. The existing DBA-reviewed templates' validated CHECK counts (5/5/6),
   including the named migration-number/path check; malformed or partially
   restored tables are rejected.
3. The invoking role **does not own any control relation**. It cannot
   UPDATE/DELETE/TRUNCATE existing receipts, cutover or journal records, or
   INSERT historic receipts/cutover; the separately authorized forward
   writer can INSERT only its own execution journal.

The checker reads NO migration receipt *rows*, app data or secrets. It
deliberately defaults to denial on unexpected structure or privilege bits.
A matching ledger schema still does not verify actual historic executions,
independent DBA approval or backup/restore acceptance.

Unit tests must cover all five fail-closed structural/privilege predicates in
both PLAN and APPLY; the existing isolated PostgreSQL 16 rehearsal additionally
tests the actual SQL under a synthetic least-privilege catalog role, a
transactionally rolled-back malformed column and an unauthorized UPDATE grant.

**This proposed change does not create any table, run a migration,
provision a role, alter a production setting or enable payroll.**

## Required operator handoff (before any protected migration)

1. Privately bind the **deployed** Vercel app/worker/database writer login,
   production Neon endpoint, branch and database identity. Resolve #899
   snapshot-restore incident/write impact and #908 least-privilege auditor.
2. Obtain actual retained encrypted backup plus independently witnessed
   offline restore and recovery credentials (#907). An isolated Neon branch
   rehearsal is useful but is **not** proof of off-provider recovery.
3. Reconstruct **every** historical full-path SHA-256, legitimate
   application/baseline receipt, schema lineage, duplicate numeric prefix,
   real data transformation and cutover boundary with independent DBA
   evidence. Never backfill fake receipts from table existence or a green CI.
4. Rehearse exact source SQL, prerequisites, privileges, tenant/RBAC negative
   checks, full schema diff and financial-row preservation on a protected
   production-equivalent sanitized clone (or independently approved isolated
   rehearsal). Do not directly replay archived 0042/0054/0067/0088.
5. Independently approve a discrete forward release sequence and checksum;
   only then use `production-reviewed-sql-migration.yml` on protected exact
   main, with manually approved DBA change refs, contiguous transactions
   and real journal receipts. Remove runtime DDL only after source checks,
   migration acceptance and deployment readiness.
6. Re-test actual post-migration authenticated WFM, compensation, payroll,
   payout and cross-tenant denial paths. Preserve #1015/#1061/#744 NO-GO until
   genuine acceptance is recorded.

**Stop conditions:** any absent control journal or history evidence, wrong
runtime credentials/endpoint, incomplete backup/restore, malformed FK or audit
role, unexplained drift, missing human sign-off or unreviewed SQL. Do not
switch to `db:push`, direct ad-hoc production DDL or permissive fallbacks.
