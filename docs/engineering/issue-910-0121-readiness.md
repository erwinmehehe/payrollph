# #910: multi-entity 0121 migration prerequisite repair — review gate

**Status: BLOCKED / SOURCE-ONLY.** This branch creates *no* numbered migration, applies *no* SQL, and does not authorize historical backfill or production execution. Existing `drizzle/0121_multi_entity_v2_scope_transfer.sql` and all historical SQL are untouched. Required source `main` baseline: `fdf2793d05e0f27372e2c8f22347879b1cf2034c`. Re-fetch latest branch/SQL hashes before any review or use.

## Observed live catalog — October 12, 2026 (read-only)

Correct Neon: project `calm-wave-70219564` (`neon-almond-ridge`), existing default branch `br-lucky-sound-b79i56jw` (`main`), DB `neondb`, PostgreSQL 18.6. A **read-only** catalog query returned **113 public tables** at inspection. The count was 112 in the earlier evidence; determine the additional object's identity and effects before asserting schema parity. No rows or SQL writes were made in this audit.

**Absent:** `job_profiles`, `positions`, `position_assignments` (historical 0022); `worker_employment_events` (0050); `worker_effective_changes` (0052); `provider_events` (0110); WFM observation/forecast/policy tables (0112–0114); `payout_profiles`, `payout_batches`, `payout_transfers` (proposed 0115–0116); `user_legal_entity_grants`, `employee_entity_assignments` (0121). `legal_entities`, `employees`, `payroll_runs`, `payroll_entries`, `payslips`, `payroll_jobs`, `bank_file_validations`, `historical_payroll_entries`, `year_end_adjustments`, and `separation_records` are present. No authentic `payrollph_release_migration_receipts` / `payrollph_schema_migrations` / `payrollph_migration_cutover` journal is present. **Presence is not execution evidence, and absence is not permission to replay an old migration.**

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

## Rollback / operational hold

Feature flags stay OFF: `MULTI_ENTITY_ENABLED`, `MULTI_ENTITY_TRANSFERS_ENABLED`, `MULTI_ENTITY_REGISTRATIONS_ENABLED` and money movement. No migration is authorized by successful CI or a draft PR. For additive schema, application rollback disables the feature while preserving immutable history; an in-transaction clone rehearsal must demonstrate complete DDL/DML rollback. Never rollback by deleting historical employer evidence, changing filing ownership or restoring the production default branch. **Issue #910 stays OPEN until independently signed review and clone/live receipt evidence.**
