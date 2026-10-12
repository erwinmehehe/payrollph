# #910: multi-entity 0121 migration prerequisite repair — review gate

**Status: BLOCKED / SOURCE-ONLY.** This branch creates *no* numbered migration, applies *no* SQL, and does not authorize historical backfill or production execution. Existing `drizzle/0121_multi_entity_v2_scope_transfer.sql` and all historical SQL are untouched. Required source `main` baseline: `fdf2793d05e0f27372e2c8f22347879b1cf2034c`. Re-fetch latest branch/SQL hashes before any review or use.

## Observed live catalog — October 12, 2026 (read-only)

Correct Neon: project `calm-wave-70219564` (`neon-almond-ridge`), existing default branch `br-lucky-sound-b79i56jw` (`main`), DB `neondb`, PostgreSQL 18.6. A **read-only** catalog query returned **113 public tables** at inspection. The earlier 112-table baseline has one additional main-only table: `statutory_remittance_correction_requests`. A read-only table-name set comparison against three existing nondefault branches (`br-wandering-river-b7fbp572`, `br-weathered-term-b7ztb2ki`, and `br-aged-mouse-b7tipaw5`) identified this specific relation; those older branches have separate, unrelated proposed-schema additions. `drizzle/0026_statutory_remittance_corrections.sql` defines the newly observed table. A read-only COUNT query observed 0 rows in it and unchanged core counts of 8 employees, 3 payroll runs, and 18 payroll entries. **This resolves only the identity of the 112-to-113 catalog difference**, not an authentic 0026 migration receipt, deploy/change timestamp, or #899 request-impact evidence; no live writes were made. No rows or SQL writes were made in this audit.

**Absent:** `job_profiles`, `positions`, `position_assignments` (historical 0022); `worker_employment_events` (0050); `worker_effective_changes` (0052); `provider_events` (0110); WFM observation/forecast/policy tables (0112–0114); `payout_profiles`, `payout_batches`, `payout_transfers` (proposed 0115–0116); `user_legal_entity_grants`, `employee_entity_assignments` (0121). `legal_entities`, `employees`, `payroll_runs`, `payroll_entries`, `payslips`, `payroll_jobs`, `bank_file_validations`, `historical_payroll_entries`, `year_end_adjustments`, and `separation_records` are present. No authentic `payrollph_release_migration_receipts` / `payrollph_schema_migrations` / `payrollph_migration_cutover` journal is present. **Presence is not execution evidence, and absence is not permission to replay an old migration.**

## Aggregate-only attribution preflight — October 12, 2026

A read-only, aggregate-only live query found **1 tenant, 1 legal entity, 1 PRIMARY entity, 8 employees, 3 payroll runs, and 18 payroll entries**. It also found **0** employees missing current legal-entity attribution; **0** payroll runs or child entries whose run has a missing employer; **0** cross-tenant employee/payroll-run links; and **0** observed mismatches between run employer and the worker's *current* employer. These are structural counts, not a historical transfer, tax or released-payroll certification. The absence of `worker_employment_events` cannot be construed as evidence that no real historical transfers happened. Independently reconcile documents, transfer approvals, statutory allocations and payroll centavos before any backfill.

## Historical production request-log retention blocker

Vercel project `erwinmehehe-payrollph` (project ID `prj_DCCuaGyRvRNJ7hOybLLdJq0jdGhh`) refused a read-only production runtime-log query for October 12, 2026, 05:25–05:37 UTC with HTTP 400: **Hobby plan does not retain runtime logs for the requested historical window**. This cannot establish zero errors, uninterrupted service or absence of lost retries during the 05:30–05:32 incident #899. Recover request/WFM worker evidence from independently retained, privacy-reviewed drains, edge request analytics, application traces or customer-reported evidence if available. **Do not close #899 based solely on snapshot parity or absent expired logs.**

## Five independent, review-only source extracts

Every file in `docs/sql/issue-910-review-only-0121-*.sql` was copied from the original 0121 source, without semantic rewrites. None is in the executable `drizzle/` directory:

1. `bootstrap` — INSERT default PRIMARY entity for tenants without one. Row mutation; DBA data decision required.
2. `schema` — ADD COLUMN, CREATE TABLE/INDEX and composite-FK control block. Has no data INSERT/UPDATE/DELETE; **not** yet validated against the actual prerequisite table/column types and constraints.
3. `linked-payroll-attribution` — UPDATE child entities only from immutable payroll-run employer. Requires cross-tenant FK, parent consistency, counts and centavo reconciliation.
4. `initial-entity-grants` — INSERT scope grants. Requires explicit reviewed role/enrolment policy; `group_hr` must not acquire payout/approval rights.
5. `employment-interval-attribution` — INSERT one employee assignment only after filtering transfer history and cross-employer payroll. Blocked by missing `worker_employment_events` and unresolved historical service/liability evidence.

The original 0121 mixes these steps in one file. The extracts are *review artifacts only*, not a five-migration train. `tests/issue-910-0121-review.test.mjs` checks content reconstruction, schema/DML partition and fail-closed historical references. Do not copy extracts into `drizzle/` or execute them without a separate approved forward migration design, immutable SQL checksums and independent release controls.

## Ordered DBA decision / cutover prerequisites (all incomplete)

- [ ] Reconstruct historical 0022/0050/0052/0110/0112/0113/0114 source hashes, deployment activity, DDL fragments, app compatibility writes and release receipts. No fabricated `applied` records; record `unproven` when provenance is missing.
- [ ] Reconcile #899 snapshot-restore default/endpoint switch and the 113-vs-112 live table-count drift; verify independent request/write impact. Do not use an automatic `finalize:true` restore.
- [ ] Obtain independent DBA approval for a **minimal additive forward-only predecessor repair**. Do not blindly replay 0022 or 0050, recreate history as fake events, `db:push`, change historical migration files or invent `worker_employment_events` records.
- [ ] Confirm actual `organizations`, `employees`, `legal_entities`, `payroll_runs`, `payroll_entries`, `payslips`, `user_organizations`, jobs and payout constraints on a protected isolated clone. Prove same-tenant composite FK and no dangling IDs.
- [ ] Approve 0121 bootstrap data/PRIMARY employer eligibility. Perform tenant-by-tenant proofs before assigning old workers or payroll to PRIMARY; ambiguously sourced history stays NULL and blocked.
- [ ] Approve each payroll/filing/13th/leave/final-pay/loan allocation against frozen historical employer, not the employee's current entity; obtain named Philippine HR/payroll/legal reviewers and independent financial reconciliation in centavos.
- [ ] Rehearse predecessor + schema-only changes on disposable PG16/18; then protected isolated Neon clone. Rehearse schema re-execution, transaction rollback, pre/post row counts, foreign keys and two-tenant/two-entity negative tests **without** enabling payout/transfer flags or contacting providers.
- [ ] Backfill only after separate explicit payroll/legal approval. Evidence includes attributable/unattributable exception counts, centavo totals, idempotent retry, concurrency, and no mutation of released payroll/BIR/file snapshots.
- [ ] Confirm independent DBA approval, exact SHA-256 source and path journal, authorized operator, protected migration executor, staging receipts, rollback/restore evidence, change record and release owner.
- [ ] Re-test flag-off parity, four golden payroll suites, TypeScript, lint, all tenant/entity API/worker/export isolation and real-device UAT.


## Source-backed missing-predecessor candidate — review-only

A separate, **unnumbered** SQL candidate now exists at `docs/sql/issue-910-review-only-forward-predecessor.sql`. It consists of the original additive statements from exact existing source files, ordered:

`0022_job_architecture_positions.sql` → `0050_hcm_core_worker_history.sql` (**DDL only**) → `0052_hcm_effective_dated_changes.sql` → `0110_provider_events_inbox.sql` → `0112_wfm_operational_demand_observations.sql` → `0113_wfm_issued_demand_forecasts.sql` → `0114_wfm_demand_staffing_policies.sql`.

**Material exclusion:** The original 0050 SQL ends with an `UPDATE positions SET legal_entity_id = employees.legal_entity_id` sourced through active position assignments. This is *not* historically valid when an employee may have changed employers. The candidate **omits this DML entirely**. It neither invents worker events nor assigns historical position ownership. A separate DBA/payroll legal-entity attribution decision must handle those positions, if any, only from trustworthy effective-dated evidence.

Production read-only table/column/index evidence establishes **12 source target tables missing**: job profiles, positions and assignments; worker employment events; worker effective-dated changes; provider inbox; operational demand imports/revisions; issued-demand issues/scores; staffing policies/events. `workforce_plans` is **present**, with the expected 11 columns and both historical 0022 indexes, so it must **not be dropped or recreated**. The proposed `CREATE TABLE IF NOT EXISTS workforce_plans` does not recreate it; the DBA must independently compare existing constraints, ownership, rows and external dependencies before considering execution.

`tests/issue-910-forward-predecessor-postgres.test.mjs` is restricted to disposable, synthetic PostgreSQL 16/18 only. It drops the 12 synthetic source targets inside a transaction, **preserves the existing workforce-plans structure and a seeded plan**, tests a worker/payroll-centavo record, rebuilds the 12 objects in dependency order, checks idempotent replay, rejects a duplicate active primary assignment, verifies historic position employer stays `NULL` even if current employee employer is set, and rolls back the entire transaction. No external database, live Neon branch or real employer copy is connected.

**Release position:** Successful tests can approve *source candidate quality*, not authentic applied history, database authorization or production deployment. The DBA must reconcile source-path/sha256 against signed external release records; review each CREATE/ALTER/index/DO statement against current live catalog; assign a noncolliding forward migration number in an independent PR; obtain immutable backup/restore evidence; rehearse on a newly approved isolated protected clone; validate payroll and filing attribution; then obtain independent DBA, HR/payroll/legal, security and operations sign-off. `0121` remains a separate later authorization requiring its own backfill decisions. Do not merge a review-only candidate into the executable `drizzle/` train or bypass `ORDERED_RELEASE_MIGRATIONS_ENABLED`.

## Rollback / operational hold

Feature flags stay OFF: `MULTI_ENTITY_ENABLED`, `MULTI_ENTITY_TRANSFERS_ENABLED`, `MULTI_ENTITY_REGISTRATIONS_ENABLED` and money movement. No migration is authorized by successful CI or a draft PR. For additive schema, application rollback disables the feature while preserving immutable history; an in-transaction clone rehearsal must demonstrate complete DDL/DML rollback. Never rollback by deleting historical employer evidence, changing filing ownership or restoring the production default branch. **Issue #910 stays OPEN until independently signed review and clone/live receipt evidence.**

## Non-authorizing scope integrity candidate (new)

`docs/sql/issue-910-review-only-post-0121-tenant-integrity.sql` proposes **13 composite tenant/employer foreign keys** and narrowly scoped unique reference indexes. Its use is demonstrated only in fictional, disposable PostgreSQL 16/18 tests. This candidate is **not** a new numbered migration and has **not** been approved by DBA/security; do not apply it to a real Neon branch or production. It does not claim that source migration `0121` alone provides a complete authorization boundary.

The proposal closes *potential new-write* ambiguity for:
- employee/current employer, payroll-run employer, person-to-assignment, and source/target transfer person-to-tenant matches;
- user entity grants/preferences tied to an active tenant membership;
- entry/run, payslip/entry, payroll job/run, payout batch/run, payout transfer/run, bank-file/run and year-end run/employer snapshots.

These FKs are deliberately **NOT VALID**: PostgreSQL enforces them on new writes/updated keys but does not scan/rewrite existing historical rows. A named DBA must reconcile preexisting bad rows and separately run `VALIDATE CONSTRAINT` after every row is attributable; do not treat `NOT VALID` as a complete historical-isolation certificate. Nullable historical filing, bank and year-end scope remains blocked under the RFC until separately attributed.

Existing pending PR #860 proposes overlapping employee/transfer tenant FKs. Reconcile duplicate names and exact current-head migration ordering before assigning a new SQL number. This review candidate must not be independently applied or mixed into 0121 without a forward-release plan and signed SQL hash.

## Current-turn independent catalog recheck — 2026-10-12 15:11 UTC

**Source:** connected Neon project `calm-wave-70219564`, production default branch `br-lucky-sound-b79i56jw`, database `neondb`, PostgreSQL `18.6 (c021049)`, current role `neondb_owner`. This is **live read-only catalog evidence**, not a statement that a migration was run or a proof that its historic SQL hash was applied.

| Observed catalog fact | Main/default | Existing nondefault migration lab `br-aged-mouse-b7tipaw5` | Provenance meaning |
|---|---:|---:|---|
| `public` table count | 113 | 125 | Divergent schemas, not an applied migration journal |
| `public.worker_employment_events` | absent | present | Source 0050 target cannot be certified as applied on main |
| `public.provider_events` | absent | present | Source 0110 target cannot be certified as applied on main |
| `public.drizzle_migrations` | absent | absent | Not an authentic receipt source |

A separate read-only `pg_class`/namespace search of **main** for migration, migration history, journal or Drizzle-named relations returned no rows. PostgreSQL catalog state proves presence/absence **now**, not which release SHA ran previously; a branch snapshot with a table proves that branch state, not production deployment.

**Inspection SQL** (SELECT-only; no credential values, employee rows, bank accounts or PII):

```sql
SELECT current_database() AS database_name,
       current_user AS db_role,
       current_setting('server_version') AS pg_version,
       now() AT TIME ZONE 'UTC' AS observed_utc,
       (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public') AS public_tables,
       to_regclass('public.worker_employment_events')::text AS worker_employment_events,
       to_regclass('public.provider_events')::text AS provider_events,
       to_regclass('public.drizzle_migrations')::text AS drizzle_migrations;
```

**Operational history:** Neon project operations are compute/branch operations and do **not** expose the complete SQL text, executor identity, Git source SHA or per-migration transaction receipt needed to authenticate applied history. The retained manual snapshot `snap-red-sound-b798wnli` from 2026-10-12 is a point-in-time schema/data witness, **not** a migration execution journal. The #899 default-branch routing incident further means the database identity and application write window must be reconciled separately.

**Strict resolution state:** `0022`, `0050`, `0052`, `0110`, `0112`–`0116` and `0121` are **UNPROVEN / BLOCKED** on production until externally retained deployment/DB audit records identify executor, timestamp, exact source SHA-256, target branch/database, transaction success and postconditions. Never insert retrospective `applied` journal rows from the presence of copied source files or the lab branch. Next is the independently authorized forward-only predecessor **with a newly recorded execution receipt**, and then separately approved 0121 schema/backfill; historical `applied` dates cannot be invented.
