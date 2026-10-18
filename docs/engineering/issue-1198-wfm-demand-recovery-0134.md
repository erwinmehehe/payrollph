# #1198 — six-table Workforce Demand forward recovery (0134)

**Recovery candidate is now implemented as reviewed SQL source. Actual production
tables restored by this PR: 0. Release: NO-GO until independent approvals,
protected rollout, and a verified production postflight.**

The October 17 catalog recorded 124 absent source tables, including the six
Workforce Demand objects below. It **did not** list `permission_sets`,
`user_permission_assignments`, or `dynamic_worker_groups` as absent. The
October 15 permissions incident must not be acted upon using stale membership
or table-absence assumptions. Neither snapshot independently attests the exact
serving Vercel web/worker/scheduler database.

## What has been implemented

`drizzle/0134_wfm_demand_missing_foundation_forward.sql` reconstructs these
six **empty** application tables and their original key/index/CHECK shapes
from the source SQL, without executing or claiming historical 0112–0114
receipts:

1. `workforce_demand_import_batches` (0112)
2. `workforce_demand_observation_revisions` (0112)
3. `workforce_demand_forecast_issues` (0113)
4. `workforce_demand_forecast_scores` (0113)
5. `workforce_demand_staffing_policies` (0114)
6. `workforce_demand_staffing_policy_events` (0114)

The forward repair makes the documented single-ID FKs and indexes, and adds
**nine composite tenant-consistency FKs** against the actual worksite,
job-profile, batch, issue and policy parent identities. New parent composite
unique indexes are needed for those FKs; they touch existing `worksites`
and `job_profiles` and therefore require DBA index/locking review.

The migration refuses a missing parent or *any* already-existing target
table before creating one object. It does not assume a historical migration
was never applied based on missing journals. No `IF NOT EXISTS` suppression
of a partially restored table is permitted. The reviewed migration runner
owns the transaction and exact source SHA. The new SQL has no receipt
backfill, historical or employer-row INSERT/UPDATE/DELETE, feature toggles,
role changes, grants, data backfill, payout logic, or production execution.

**Important:** This restores *structure*, not real demand observations,
forecast histories, approvals, application feature activation or authorization
evidence. Do not fabricate any of those.

## Disposable database acceptance

The repository contains a new PR-scoped workflow,
`.github/workflows/issue-1198-wfm-demand-forward-recovery.yml`, that runs
on synthetic localhost **PostgreSQL 16 and 18** with no real credentials.

The tests execute the new exact SQL in a transaction using two fictional
organizations. They prove all six tables and nine extra composite FKs are
created; reject cross-organization worksite, revision batch, forecast score,
and optional job-profile references; reject a second replay and a missing
parent; and **ROLLBACK every object and synthetic row**.

The test refuses any URL other than the isolated `postgres` role on
`127.0.0.1:5432/app_db` under CI-only flags. The workflow does not have
access to Neon or production credentials.

Source-only test:
`node --test tests/issue-1198-wfm-demand-forward-source.test.mjs`

Disposable PostgreSQL test (only under the guarded CI service):
`node --test tests/issue-1198-wfm-demand-forward-postgres.test.mjs`

A green disposable CI job is useful acceptance evidence for SQL syntax and
constraints. It **cannot approve a Neon deployment**, establish legacy
migration receipts, or prove an app route is working.

## Protected DBA/operator release gates — all unfulfilled

- [ ] Independent web/worker/scheduler connection attestation to the actual
      production DB, endpoint and role using the protected target-attestation
      workflow. Do not disclose URLs or credentials.
- [ ] Use an approved least-privileged catalog-only reader; the old
      `neondb_owner` and `payrollph_schema_auditor` are too privileged.
      Query fresh catalog metadata and establish that *all six* tables are
      truly absent in that exact target. If even one is now present,
      **0134 must fail**; stop and obtain a new reviewed partial-repair
      design. Do not DROP/overwrite an existing table.
- [ ] Resolve the missing historical journal/cutover proofs and 13 duplicate
      migration prefix groups, independently record the exact 0134 SHA,
      source branch, reviewers and protected release approval. Never fake
      a receipt or mark 0112–0114 as applied.
- [ ] Confirm existing worksite/job-profile identity types, parent keys,
      table ownership, nonproduction backup and recovery controls, parent
      index size and lock-timeout suitability; explicitly review tenant FK
      changes versus canonical Drizzle declarations.
- [ ] Rehearse the exact reviewed SQL against an authorized, protected
      nonproduction PG18 clone (separate from synthetic CI). Verify
      data preservation, tenant isolation, application permission gates and
      rollback without activating features.
- [ ] Receive independent DBA/security/release approvals before any
      execution through `scripts/run-reviewed-migration.mjs` under the
      protected exact-main workflow. Never use `db:push`, a generic
      production SQL console, or an automatic historical replay.
- [ ] After the approved transaction commits, verify all six exact table
      shapes, nine tenant FKs and source SHA/real execution receipt.
      Exercise authorized demand APIs and cross-tenant negative cases.
      Separately retest `GET /api/bi-exports`,
      `GET /api/workforce-planning`, and
      `GET /api/workforce-planning/allocations`, since the October 15
      failures were in the separate permission gate.
- [ ] Record *verified new recovery count* from the exact serving catalog,
      before/after counts, any still-missing application tables and
      error-rate evidence. A 124-to-118 change must **not** be asserted
      without fresh, same-target measurements and an execution receipt.

## Rollback / incident policy

Before commit, the protected reviewed runner's entire migration transaction
must rollback on any preflight, shape, FK, index or lock failure. Never
attempt destructive post-commit DROP of application tables containing
legitimate new demand rows. For a post-commit incident, suspend optional
demand features and use a separately reviewed, additive corrective
migration or approved restore/recovery playbook. Follow #899's endpoint
swap warning: restoring a Neon snapshot can promote a different branch
unless the protected procedure explicitly prevents it.

Related: #1198, #1031, #910, #899, #1078 and draft #1221.
