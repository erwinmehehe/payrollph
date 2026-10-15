# Issue #1061 — Production compensation schema repair gate

**Status: guarded forward SQL and isolated tests only — NOT APPLIED TO PRODUCTION.**
Related: #1046 (source confidentiality fix), #1031 (schema drift), #899
(restore incident), #1015 and #1054 (preceding schema candidates).

## Reproduced cause

On October 15, 2026, human-approved PR #1055 deployed at SHA
7169490071bf09cf91ceea7d3d5081673ce4be7e. Live RBAC Sandbox Smoke
#38699491376 passed all six standard fictional personas, but the
unit-scoped HR compensation test returned HTTP 503. Vercel logs prove
PostgreSQL 42P01, missing relation compensation_cycles.
No scoped-versus-global compensation GET comparison happened.

Direct read-only Neon catalog at inspection: project calm-wave-70219564,
main branch br-lucky-sound-b79i56jw, endpoint ep-cool-hat-b7e7gpoo,
database neondb. These six final-source relations are ABSENT:
compensation_bands, compensation_cycles, compensation_proposals,
compensation_components, employee_compensation_components,
compensation_events. Eight expected referenced parent relations have
integer, single-column primary keys. Other compensation GET prerequisites
are present (employee_pay_profiles, hcm_business_process_instances,
positions, position_assignments, org_units).

**The application deployment target must still be independently
verified** against Vercel's effective production database secret/role.
The connected Neon catalog identity alone does not prove app routing.
No salary, employee, banking or payroll data was read.

**The Neon primary currently lacks the historical migration adoption
ledger, cutover row and forward journal:** payrollph_release_migration_receipts,
payrollph_migration_cutover and payrollph_schema_migrations. Never create
fabricated receipts just to satisfy a migration guard.

## Candidate and ordering

The proposed forward-only SQL, at
drizzle/0126_compensation_governance_forward_repair.sql, represents the
CURRENT src/db/schema.ts final state: six tables, 97 columns, 30 foreign
keys and 23 indexes including six primary keys.

This does NOT replay historical 0042 and 0054 SQL. It checks all six
targets are wholly absent, validates eight parent integer PKs and rejects
orphaned expected index/sequence names. Postflight validates schema
object counts. No backfills, row reads/updates, permission broadening,
salary approvals, transactions or money actions occur within the SQL.
A separately reviewed migration runner must own BEGIN/COMMIT and the
immutable checksum receipt.

The repository's reserved forward sequence is:
- PR #1057: 0124 attendance exceptions
- PR #1058: 0125 WFM availability and open shifts
- Issue #1061: 0126 compensation governance

Source merging does not apply any of them. Do not skip or reorder
prefixes to force a plan to pass. Independently approved resequencing
would require fresh SQL hash, reviewed source and test evidence.

## Required operator/DBA acceptance

1. Independently attest exact current Vercel database host, Neon project,
   branch, endpoint, database, role, TLS mode and protected main SHA,
   without exposing credentials.
2. Obtain backup/PITR and independently witness a privacy-approved
   sanitized isolated restore; respect the #899 restore incident.
   Never reset/delete a Neon branch simply to make capacity.
3. Reconcile historical baseline, full-path source checksums and
   real applied/baseline receipts; adopt a DBA-approved cutover and
   immutable execution journal following
   docs/engineering/reviewed-migration-runner.md.
4. Verify all prior forward release receipts and their contiguous
   numbering before this candidate. Confirm full database catalog,
   constraints, indexes and dependency compatibility.
5. Obtain independent DBA/security approval for the exact file SHA,
   protected target, rehearsal and rollback/forward-repair procedure.
6. Use the existing protected workflow
   .github/workflows/production-reviewed-sql-migration.yml in **plan**
   mode with catalog-only least-privilege credentials. Any missing
   adoption, mismatch, wrong role/branch or drift is an immediate STOP.
7. Only separately authorized, protected **apply** mode may run DDL
   and atomically journal the exact file checksum. Never run
   db:push, replay archived numbers or apply DDL through demo login.
8. Run independent pg_catalog-only postflight: six tables, column counts
   16/12/19/13/20/17; FK counts 5/2/8/2/6/7; index counts
   6/3/3/4/4/3, with named keys, defaults, uniqueness, targets and
   delete actions all matching the current source.
9. After applying and verifying, rerun exact deployed-SHA production
   Live RBAC Sandbox Smoke. Require company-wide HR 200 and legitimate
   fictional budget, unit HR 200 with budgetPool null and no other-unit
   pay/proposals/bands, anonymous 401, cross-org 403. Record only
   sanitized HTTP status/predicates, no session cookies or salary bodies.
10. Review Vercel compensation runtime errors and place independently
    approved migration/acceptance receipts on issue #1061. Do not
    claim #1046 live confidentiality acceptance while the new run fails.

The CI PG16/18 synthetic rollback rehearsal is an engineering check,
NOT independent DBA sign-off or a production migration receipt.
No employer pay, payout, bank account or government filing action
is authorized by these changes.
