# Issue #1054: WFM availability and open shifts — production schema gate

**Decision: BLOCKED for production apply and feature activation.** This document is a source and catalog-evidence record, **not** a production database change request or a migration receipt.

## Confirmed read-only catalog observations (2026-10-15, Asia/Manila)

Inspected Neon project `calm-wave-70219564`, branch `br-lucky-sound-b79i56jw`, database `neondb`. These identifiers are **not** independent proof of the Vercel runtime `DATABASE_URL` role or connection mapping. No connection strings, personnel records, payroll values, or credentials were retrieved.

- Present: `organizations`, `employees`, `users`, `worksites`, `shift_definitions`, `job_profiles`, `staffing_requirements`, `staffing_requirement_role_unique`.
- Absent: `employee_availability_rules`, `open_shifts`, `open_shift_claims`, historical `staffing_requirement_unique`.
- Present **now**: `permission_sets`, `user_permission_assignments`, `dynamic_worker_groups`. Earlier #1031 issue-body observations should not be treated as current for these names. This does not close #1031, prove permission behavior, or prove the full schema is sound.
- Absent: `payrollph_schema_migrations`, `payrollph_release_migration_receipts`, and `payrollph_migration_cutover`. This is an **absence of visible ledger tables**, not proof that historical files did not run. It means the current reviewed-migration runner cannot lawfully report successful protected application.
- A name-only comparison found **270** `pgTable` declarations in `src/db/schema.ts` and **136** public base tables in this branch: **134 declared names were absent** and **3 public tables did not appear in the current `pgTable` declarations**. This is *not* a classification of all 134 as required now, a full column-level diff, or authorization to create missing tables. Resolve with the deployment owner and schema drift incidents #1015 and #1031.

Read-only catalog query for targeted objects:

~~~sql
SELECT name, to_regclass('public.' || name) IS NOT NULL AS exists_now
FROM (VALUES
 ('employee_availability_rules'), ('open_shifts'), ('open_shift_claims'),
 ('job_profiles'), ('staffing_requirements'),
 ('staffing_requirement_role_unique'), ('staffing_requirement_unique'),
 ('payrollph_migration_cutover'), ('payrollph_schema_migrations'),
 ('payrollph_release_migration_receipts')
) AS target(name)
ORDER BY name;
~~~

## Forward-only candidate and executable engineering verification

**Integration sequencing (2026-10-15):** PR #1057 was merged into `main` as commit `e1e47324c8d5523a6a01c851c4f3b8d738e858d0` and reserves `0124_attendance_exception_forward_repair.sql`. This #1054 candidate is numbered `0125` and #1058 now targets `main`. The branch must pass fresh exact-head checks before any source merge. This is source ordering only, **never database migration or release authorization**.

`drizzle/0125_wfm_availability_open_shifts_forward_repair.sql` creates **only** the three WFM tables and the current `src/db/schema.ts` indexes/FKs. It includes `open_shifts.job_profile_id` and `open_shifts_role_idx`. It does not add the incompatible legacy staffing uniqueness index or replay `0039`.

Its preflight fails closed when prerequisites, role index, or target-table state differ from the reviewed expected starting state. A repeat application intentionally **rejects** the existing-table state rather than claiming success via `IF NOT EXISTS`. True retry safety is provided by the protected runner's atomic, recorded, checksum-pinned application, **once** the independent ledger is valid.

`.github/workflows/issue-1054-forward-schema-rehearsal.yml` uses **disposable, localhost-only PostgreSQL 16 and 18**. It:
1. Bootstraps the complete synthetic schema from current Drizzle source via guarded `db:push` (never Neon).
2. Removes only the three target tables **inside a transaction** to mimic the narrow missing-table state.
3. Checks missing role-index, legacy-index and partially-present-table fail-closed preflights.
4. Applies the exact source 0125 inside that rollback-only transaction and compares columns, indexes and FK/PK definitions to the current Drizzle bootstrap.
5. Confirms replay refuses change, injects an intentional SQL error, rolls back, and verifies untouched synthetic employer/payroll counts and original table schema.
6. Records a SQL SHA-256 and sanitized synthetic run artifact. This is **not** a production receipt, independent tenant acceptance, or external-device witness.

Passing these checks does **not** demonstrate that the current Neon branch meets all schema and role/tenant constraints. Especially, the source schema has single-column foreign keys for these WFM relations; independently verify cross-tenant authorization end-to-end before operational release rather than assuming database FKs alone provide tenant isolation.

## Release blocker order (independent operator/QA sign-off required)

1. **Protect target:** DBA/security reviewer privately maps actual running Vercel/worker `DATABASE_URL` branch, endpoint, database and role to approved intended environment; checks #899 restore incident impact, approved recovery and change window. No secrets in GitHub.
2. **Reconcile lineage:** Retrieve genuine historical ordered migration and deployment receipts. Perform comprehensive column/index/constraint diff on the exact target. Coordinate #1015 and #1031; do not blindly execute absent-table lists, `db:push`, `0039`, or full historical SQL.
3. **Rehearse:** Resolve dependencies, review exact 0125 SHA and protected runner's ledgers, run independent synthetic or privacy-approved isolated rehearsal. Confirm no mutation to staffing uniqueness, payroll rows, automatic roster, historical employee assignments, or financial data.
4. **Authorize and apply separately:** Named DBA/security operator must approve protected exact-main forward-only plan, review checksums and failure/restore evidence, run an approved release pipeline, and retain authentic committed receipt. No live Neon mutation from this issue, PR or chat.
5. **Witness outcomes:** Verify exact live schema and no-500 logs, employee/manager authorization, cross-tenant A/B denial, overlapping and overnight preferences, remove/history/audit, mobile/desktop ESS, and unchanged payroll. Complete independent WFM pilot #691 as a **separate** acceptance gate.
6. **Enable last:** Keep `WFM_EMPLOYEE_AVAILABILITY_ENABLED` and `NEXT_PUBLIC_WFM_EMPLOYEE_AVAILABILITY_ENABLED` OFF until the independent operator grants an explicit GO at the deployed SHA. Otherwise show unavailable state truthfully.

**Do not close issue #1054** until authentic schema release receipts, independent acceptance and post-change no-500 evidence are attached.

## 2026-10-16 immutable-history compliant correction (engineering draft)

**Numbered SQL `drizzle/0125_wfm_availability_open_shifts_forward_repair.sql` remains exactly as already merged:** SHA-256 `3f51ca8ed1ea2cb8a04e071f567be1b5281425ab26677af4d5a539bdaeeee20b`. The repository SQL-history policy forbids in-place edits; the historic file's unsafe preflight is NOT represented as fixed.

Instead `scripts/lib/issue-1054-protected-preflight.mjs` contains strict catalog-only SQL. The protected reviewed migration runner executes it in the same identity-checked, bounded PLAN/APPLY transaction **before** authorized 0125 DDL; failure aborts before any DDL or immutable release-ledger receipt. It validates seven single integer parent PKs; an exact full, valid/ready, nonpartial five-key staffing role unique index; absence of legacy staffing index; no orphan/reserved sequence or index; absent target relations; and no reserved FK-constraint-name collision. Explicit `P0001` prefixes identify denial cases. No DML, grant or replay of 0039.

The original 0125 **remains unsafe if applied outside this reviewed runner**. An independently approved DBA-only procedure must execute the exact preflight and 0125 in the same transaction; ad-hoc SQL apply is prohibited. Isolated PG16/18 tests intentionally reproduce original orphan acceptance under a rollback SAVEPOINT, then prove the companion rejects it and performs a clean synthetic create/replay/rollback. Production identity, receipts, #899, #907/#908, independent DBA, protected PLAN/APPLY and post-apply smoke gates remain unsatisfied. **Production NO-GO**.

**Protected runner `search_path` safety:** In the APPLY transaction, the runner now uses `public, pg_temp` without explicitly listing `pg_catalog`. PostgreSQL therefore resolves built-in functions from the implicitly first `pg_catalog`, creates unqualified target tables in `public`, and resolves public parent relations before session-temporary relations. Synthetic PostgreSQL 16/18 tests inject a shadowing `public.now()` function and temporary `employees` table under a rollback-only SAVEPOINT. The immutable 0125 SQL and release authorization gates remain unchanged; this is not a production receipt or approval.
