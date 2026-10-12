# PayrollPH — Correct Neon production schema and migration release hold

**Verified:** 2026-10-12. **Status:** live database inspected READ ONLY; no SQL applied.

## Correction of the prior Neon identification

The earlier investigation referenced a different connected account and incorrectly identified a legacy UUID/client schema as the PayrollPH production database. **That conclusion has been withdrawn.** The account owner reconnected the correct Neon workspace, and the current read-only findings are for:

- Neon project: neon-almond-ridge (calm-wave-70219564), AWS us-east-1.
- Branch: main (br-lucky-sound-b79i56jw), default/primary. Independent QA/rehearsal branches also exist; none were created or modified by this read-only assessment.
- Database: neondb, PostgreSQL 18.6.
- No Neon branch, database, schema, records, runtime flags or payments changed in this audit.

## Correct schema fingerprint

The actual current database has 112 public application base tables (plus 9 neon_auth service tables). Main's four Drizzle schema source files define 253 distinct application tables; all 112 live public table names are declared in main, while 141 other declared tables are absent. These numbers describe a source-vs-live catalog gap, not a proven count of migrations to run.

The live schema **does** contain organizations, users, user_organizations, legal_entities, employees, payroll_runs, payroll_entries, payroll_jobs, payslips, employee_schedule_assignments, employee_worksite_assignments, worksites and time_punches. Organization, employee and payroll-run IDs are integers, consistent with current PayrollPH source. The earlier claim that production requires a UUID-to-integer full replatform is invalid and must not be used for planning.

No matching live PostgreSQL tables were found for the source-only migration receipt journal, reviewed migration executor journal or source cutover manifest:
- public.payrollph_release_migration_receipts
- public.payrollph_schema_migrations
- public.payrollph_migration_cutover

Missing key source-declared prerequisite objects include payout_batches, payout_transfers, payout_batch_transfers, payout_profiles, worker_employment_events, provider_events, audit_chain_heads, compensation_automation_intents and the SaaS billing state tables. None of the four documented critical release indexes were present, and the public seal_audit_events() audit-chain function was not found. These findings concern catalog existence only; no table row data or banking fields were read.

## Why numbered SQL 0115-0120 must NOT run yet

PR #865 proposes five ordered source migrations:
- 0115 first-payroll progress: referenced organizations and users exist, but history/receipt confirmation and application readiness are still missing.
- 0116 WFM roster scaling: referenced employee schedule/worksite assignment tables exist, but constraints, indexes, policy review and sequencing require rehearsal.
- 0117 Xendit provider: ALTER TABLE targets payout_batches, payout_transfers, payout_batch_transfers and payout_profiles. **All four targets are ABSENT.** Running it now would fail and must never be treated as a standalone migration.
- 0118 WFM punch evidence: tenant, worksite, employee and time-punch tables exist, but explicit privacy/consent/schema integration and tested rollback are still required.
- 0119 multi-entity transfer: references payout tables and worker_employment_events that are absent; it also uses explicit BEGIN/COMMIT and normal UPDATE ... SET constructs incompatible with the currently proposed #867 reviewed-executor guard. It contains historical payroll attribution/backfills, so it needs isolated clone rehearsal and independent payroll authorization.
- 0120 module disclosure from #874: source-only dependent on #865; must not jump over rejected predecessors.

The repository contains historical duplicate filename numbers. Presence of an object alone does not prove its original SQL was applied. Do **not** run db:push, drizzle migrate, replay baseline.sql, or write artificial receipts against the main branch.

## Safe engineering sequence

1. **Reconcile GitHub to the correct Neon target.** Confirm runtime host and database identity from protected deployment configuration without posting connection strings. Perform a metadata-only object inventory, capture the expected source commit SHA, and establish a nonprivileged audit role.
2. **Discover historical provenance.** Collect DBA evidence for which migrations and runtime compatibility DDL actually executed. Maintain full-path SHA-256 source identities, an independently reviewed receipt ledger, and the pre-existing 13 duplicate-prefix groups as historical evidence. Never guess applied status by table existence.
3. **Identify intermediate missing dependencies.** Source main declares 141 tables absent in the correct database. Determine which are required to safely stage payout provider, audit chain, billing and worker-employment prerequisites. Write explicit additive forward scripts with a reviewed dependency DAG. No production db:push shortcut.
4. **Resolve policy conflicts.** Reconcile parallel roster-policy and punch-photo/consent designs, and the overlapping HR case and engagement-survey drafts. One schema contract per feature; one reserved numbered migration per approved change.
5. **Rehearse on a disposable copy of the correct database** (only after explicit branch authorization). Restore/check backup and data protection; apply verified missing prerequisites and each migration in order; test idempotency, transactional rollback, cross-tenant restrictions, money-related golden suites and historical reconciliation. Avoid moving or exposing bank identifiers; payouts remain OFF.
6. **Stage approvals.** Independently signed DBA/security/payroll/privacy/release evidence, reviewed hashes, exact-head CI and successful preflight are needed before any production migration can be considered. Source merges never authorize production DDL.

## Added read-only operator guard

The source-only script scripts/audit-neon-schema-generation.mjs uses a separately scoped PRODUCTION_SCHEMA_AUDIT_DATABASE_URL. Its query inspects information_schema and to_regclass() only under a REPEATABLE READ READ ONLY transaction, then rolls back. It explicitly distinguishes the actual organization/integer generation from the unrelated UUID/client generation and detects missing 0117/0119 prerequisite tables. It emits no employee, payroll or banking row values. The current correct database is **NOT eligible for the numbered train**.

The script is an independent diagnostic and is not yet automatically wired into the migration executor. Passing a catalog fingerprint can never by itself authorize DDL or payroll release. Exact-head CI and human review remain outstanding.

## Direct connected-Neon verification (2026-10-12)

Read-only checks through the authorized Neon connector targeted `calm-wave-70219564` / `br-lucky-sound-b79i56jw` / `neondb` (PostgreSQL 18.6). **112 public base tables**. No SQL writes, production migration, or feature activation.

The new `scripts/lib/canonical-migration-base-tables.mjs` distinguishes source-declared **base table existence only** for the five numbered migrations:

| Canonical SQL | Referenced base tables absent in live Neon | Assessment |
| --- | --- | --- |
| 0115 first payroll journey | None | Base table names present; NOT approved |
| 0116 WFM roster rules | None | Base table names and checked effective-window columns present; NOT approved |
| 0117 Xendit payout | payout_batches, payout_transfers, payout_batch_transfers, payout_profiles | BLOCKED |
| 0118 WFM punch/photo evidence | None | Base table names present; NOT approved |
| 0119 multi-entity historical transfer | payout_batches, payout_transfers, worker_employment_events | BLOCKED |

The three migration-receipt / journal / cutover tables remain absent. The 0117/0119 prerequisites must be reconciled with **source history**, not fabricated using placeholder tables or false applied receipts. The 0119 cross-entity and payroll-history backfill remains review gated.

`scripts/audit-neon-schema-generation.mjs` now produces a separate `canonicalTrain` structural target assessment in addition to the original fail-closed generation fingerprint, within the same read-only transaction. **Passing any structural preflight does not imply successful DDL application, tenant isolation, DBA acceptance, or approval to merge or deploy.**

## Backup and clone safeguards verified in connected Neon

Read-only snapshot inventory initially returned no manual snapshots and no configured automated snapshot schedule. The default branch is currently unprotected; project history retention was reported as six hours. **No source/DDL migration was attempted.**

A **manual, time-limited safety snapshot** was created on the same project, without changing tables or records:

- Snapshot ID: `snap-red-sound-b798wnli`
- Name: `payrollph-pre-865-readonly-audit-20261012`
- Source: production/main `br-lucky-sound-b79i56jw`
- Created: 2026-10-12 05:16:34 UTC
- Expiry: 2026-10-19 00:00:00 UTC

The snapshot was confirmed by a subsequent read-only list. It is a **temporary restore point**, not proof of a successful restoration, independent backup, recovery policy, or approval to run migrations. Validate recovery on a separately authorized isolated clone before cutover, and establish a sustainable schedule/branch protection with the infrastructure owner.

An existing branch named `payrollph-db-migration-lab-20261012` is **not schema-identical** to current main: it lists 124 public tables against main's 112, including audit-chain, worker-position and demand tables absent on main. It must not be represented as an unmodified production clone or used as release evidence without reconciling those differences.


## Isolated Neon restoration, migration rollback and incident — 2026-10-12

This is additional connected-Neon evidence **after** the initial catalog audit. The correct source branch remains `br-lucky-sound-b79i56jw` (default `main`), database `neondb`. Original Neon compute hostname `ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech` was reverified at the end. Do not treat this section as production release approval.

- A prior normal copy-on-write lab branch `br-aged-mouse-b7tipaw5` received additive test rehearsals of historical `0022` plus `0109–0114`, with missing `job_profiles` dependency resolved only in lab. The 0109 initial behavior test omitted `DROP TRIGGER IF EXISTS`; it did not claim an exact-file receipt.
- A production snapshot `snap-red-sound-b798wnli` was restored to a separate branch, now `br-damp-grass-b7yyv0y3`, named `payrollph-snapshot-restore-lab-20261012`. The restore inadvertently **finalized with a default-branch and compute-endpoint swap**. The original default branch ID, its `main` name and original endpoint were restored, re-queried and verified, but a brief application disruption or routing to the snapshot is possible. See #744 incident log. This is **not** a clean independent-disaster-recovery sign-off. Future restore rehearsals must use an operator-reviewed nonfinalizing procedure in an isolated account/project.
- On the restored QA branch, the **exact three SQL statements** of `drizzle/0110_provider_events_inbox.sql` were run with an intentionally failing fourth statement in one transaction; PostgreSQL rolled back the new table completely. The exact source then applied successfully; its primary key, two foreign keys and two named indexes were verified.
- The **complete 11-statement** `drizzle/0109_tamper_evident_audit_chain.sql` was then executed on the restored QA branch, including its original `DROP TRIGGER IF EXISTS` (safe only because this is isolated QA). Three copied audit events were sealed; independent hash/link/sequence verification found **zero** mismatches; the second sealer run processed zero new rows. Neither 0109 nor 0110 was applied to production.
- The restored branch and temporary no-compute endpoint-parking branch expire `2026-10-13T06:00:00Z`. The original production endpoint has been restored; no source migration SQL ran on original `main`. Temporary infrastructure route changes **did** occur and require operator incident review. Compare request/error/SQL connection logs around `2026-10-12T05:20–05:22Z`.

### New source-side foundation catalog gate

`scripts/lib/foundation-migration-objects.mjs` adds a SELECT-only, full-filename check for expected **objects** from `0022` and `0109–0114`. The CLI `scripts/audit-neon-schema-generation.mjs` now returns this evidence with canonical `0115–0119` preflight and fails closed when foundation objects are missing. It does **not** infer applied historical SQL, reconcile 13 duplicate legacy prefixes, compare DDL definitions/constraints, or authorize production. No original database mutation or fake migration receipts were created.

### Release hold and next operator requirements

1. Verify serving Vercel connection/endpoint identity and independently investigate possible impact from the temporary restore swap.
2. Establish a longer-lived independently verified restore route, protected production `main` branch, and an approved backup/snapshot schedule; a time-limited snapshot is insufficient.
3. Independently review every historical SQL path+SHA-256 and request-time DDL/backfill evidence; adopt authoritative receipts without inventing applied history. Prepare #867's reviewed forward executor only after this.
4. Verify complete live schema and safe dependency order, not just 21 selected foundation objects. Payout ledger and worker employment history are still missing prerequisites for 0117/0119. Do not deploy train #865 yet.
5. Reconcile employee-by-employee payroll to the centavo, test privileges/privacy/encryption, complete new code CI and independent DBA/security/payroll/release sign-off. Do not activate payouts or filing.


### Audit endpoint pinning and least-privilege role preflight

Before running `scripts/audit-neon-schema-generation.mjs` from an operator environment, set **all three** environment variables:
- `PRODUCTION_SCHEMA_AUDIT_DATABASE_URL` — a dedicated catalog-only, non-elevated, SELECT-only audit principal, not the Neon owner connection.
- `PRODUCTION_SCHEMA_AUDIT_EXPECTED_HOST` — the independently verified Neon endpoint hostname (the production hostname after the October 12 incident was `ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech`).
- `PRODUCTION_SCHEMA_AUDIT_EXPECTED_DATABASE_NAME` — `neondb`.

The CLI refuses a mismatched connection-string host/db and a privileged/write-capable account. Inside a READ ONLY transaction it verifies the session DB, role's elevated/write privileges and read access to sensitive HR/payroll tables before metadata queries. These controls **cannot** independently verify the endpoint's live branch routing: an operator must also confirm endpoint-to-branch ID through Neon API and compare the serving Vercel deployment's actual connection. Do not print credentials or use a production writer/owner URL. This is a **new source guard in PR #892**, not evidence a dedicated read-only audit account has been provisioned.
