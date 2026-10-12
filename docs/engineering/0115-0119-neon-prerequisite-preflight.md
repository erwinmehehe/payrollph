# Pending PayrollPH 0115-0119: exact-source migration readiness (2026-10-12)

**Production: DO NOT APPLY.** Correct project: neon-almond-ridge, branch main, database neondb (PG18). Live catalog has 112 public application tables, no signed historical migration receipt journal and no approved cutover. The main Drizzle schema declares 253 tables; only 112 currently exist.

## Reproducible root causes

- 0117 Xendit uses ALTER TABLE on payout_batches, payout_transfers, payout_batch_transfers and payout_profiles, all **absent in actual main**.
- The missing base ledger exists as an *unnumbered* reviewed candidate in docs/sql/pending-payout-ledger.sql. Payout profiles were proposed in drizzle/0074_company_payout_profiles.sql but are absent in the live database. Their existence in GitHub DOES NOT mean either source SQL was applied.
- 0119 references missing payout tables and worker_employment_events (declared in 0050_hcm_core_worker_history.sql). The correct live database also lacks job_profiles, positions and position_assignments from 0022_job_architecture_positions.sql, which the 0050 worker-history migration requires. Reconcile 0022 -> 0050 -> 0119 in order. Never create a fake empty history table to bypass employee/payroll attribution.
- 0119 originally included BEGIN/COMMIT statements around historical payroll UPDATE ... SET backfills. This branch removes the outer BEGIN/COMMIT only; the reviewed executor in #867 must own a single atomic transaction. The separate draft #897 fixes its false rejection of ordinary UPDATE SET. No historical payroll backfills run in this PR.
- All numbered migrations and the underlying 124-file history require independently reviewed SHA-256 receipts, DBA-approved ordering and a restore rehearsal. Schema-name presence is insufficient.

## Implemented source-only controls

1. scripts/lib/pending-train-preflight.mjs checks named table dependencies for each step without querying payroll or sensitive data and **never returns permission to apply**.
2. tests/pending-train-preflight.test.mjs asserts fail-closed behavior for the five immediate missing SQL targets plus historical job-architecture prerequisites.
3. tests/pending-migration-release-train.test.mjs now explicitly rejects standalone BEGIN/COMMIT in 0119.
4. tests/pending-train-postgres-rehearsal.test.mjs runs only in GitHub Actions against the hard-coded disposable local PostgreSQL 16 database; it is skipped elsewhere. It reproduces absent payout prerequisites using a transaction-local DROP that is rolled back, then rehearses two preserved source candidates plus 0115-0119 in one transaction with a second rollback. It inspects idempotency guards, the Xendit check constraint and representative new tables. **No Neon branch or production SQL is altered by these tests.**
5. .github/workflows/ci.yml enables the guarded migration test within the existing disposable PG16 CI job after db:push. Failure blocks the draft and must not be bypassed.

## Neon isolated rehearsal — verified 2026-10-12

The owner explicitly authorized deleting `temporary-endpoint-parking-20261012` to free a test branch slot. After verifying its exact ID, parent, nondefault/unprotected status and no child branches, the branch was deleted and its removal confirmed.

Created a dedicated child of the correct `neon-almond-ridge/main`:
- Branch name: `payrollph-pr865-integrated-rehearsal-20261012`
- Branch ID: `br-weathered-term-b7ztb2ki`
- Parent: `br-lucky-sound-b79i56jw`
- Database: `neondb`, PostgreSQL 18.6
- Ephemeral expiry: **2026-10-19 06:00 UTC**
- Initial state: 112 public tables, 3 payroll runs, no journal and none of the proposed 0115/0116 tables

**Tested only the additive, source-identical 0115 and 0116 SQL on this child**. Every statement was verified as CREATE TABLE/CREATE INDEX IF NOT EXISTS before being executed as one atomic transaction. Both the initial and repeat execution succeeded (6 SQL statements each). The child then had 114 public tables, with `first_payroll_journey_progress`, `workforce_roster_rule_policies`, four planned indexes, two progress foreign keys and the WFM rule CHECK. Payroll-run count remained 3. Independently re-read `main`: 112 public tables, neither 0115/0116 table, 3 payroll runs. No employee, government ID, bank account, payroll row contents or photos were queried.

**Boundaries:** This is a database **compatibility rehearsal only**, not a release apply or approved historic receipt. The tests are not evidence that a reviewed migration executor/receipt journal was used. No 0117, 0118, 0119, 0120, payout, historical backfill, payment call, feature flag or production DDL was executed by this rehearsal. 0117 remains blocked by absent payout base tables; 0119 by its additional employment-history and payout prerequisites. Older experimental Neon branches were untouched.

Further PG18 rehearsal requires a reviewed dependency-complete train, verified receipt/cutover data, a restore witness and explicit agreement about financial/privacy-sensitive test data. Do not infer that 0115/0116 are production-approved solely because they were structurally compatible.

## Release acceptance order

1. Review/create full-path migration history receipts from actual DBA evidence, not inferred presence. Protect source main and back up/restore.
2. Reconcile the payout-ledger candidate and 0074 payout-profiles source with exact current Drizzle schema, immutability triggers, live payout history, encryption and maker/checker. Allocate a formally reviewed predecessor migration before attempting 0117.
3. Reconcile job_profiles/positions/position_assignments from 0022 and worker_employment_events from 0050 with real historical employee and legal-entity transfers before 0119.
4. Review the corrected 0119 source SHA, the #897 executor parser, and test branch snapshots. Never run payroll backfills until disputed history is explicitly resolved.
5. Rehearse all approved migrations on disposable PG16 and sanitized copy/clone of the correct Neon PG18 environment, checking row-level payroll differences <= PHP 0.01, tenant isolation, constraints and restoration.
6. Obtain independent DBA, payroll, treasury, privacy, security and release approval. No live payouts, bank writes, statutory submissions, biometric/photo collection or production flag changes.

**Current state:** All code commits in this PR are source-only; live production stays unchanged.
