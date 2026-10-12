# Pending PayrollPH 0115-0119: exact-source migration readiness (2026-10-12)

**Production: DO NOT APPLY.** Correct project: neon-almond-ridge, branch main, database neondb (PG18). Live catalog has 112 public application tables, no signed historical migration receipt journal and no approved cutover. The main Drizzle schema declares 253 tables; only 112 currently exist.

## Reproducible root causes

- 0117 Xendit uses ALTER TABLE on payout_batches, payout_transfers, payout_batch_transfers and payout_profiles, all **absent in actual main**.
- The missing base ledger exists as an *unnumbered* reviewed candidate in docs/sql/pending-payout-ledger.sql. Payout profiles were proposed in drizzle/0074_company_payout_profiles.sql but are absent in the live database. Their existence in GitHub DOES NOT mean either source SQL was applied.
- 0119 references missing payout tables and worker_employment_events (the latter is declared in drizzle/0050_hcm_core_worker_history.sql, also not present live). Never create a fake empty worker-history table merely to bypass historical payroll attribution.
- 0119 originally included BEGIN/COMMIT statements around historical payroll UPDATE ... SET backfills. This branch removes the outer BEGIN/COMMIT only; the reviewed executor in #867 must own a single atomic transaction. The separate draft #897 fixes its false rejection of ordinary UPDATE SET. No historical payroll backfills run in this PR.
- All numbered migrations and the underlying 124-file history require independently reviewed SHA-256 receipts, DBA-approved ordering and a restore rehearsal. Schema-name presence is insufficient.

## Implemented source-only controls

1. scripts/lib/pending-train-preflight.mjs checks named table dependencies for each step without querying payroll or sensitive data and **never returns permission to apply**.
2. tests/pending-train-preflight.test.mjs asserts fail-closed behavior for the five missing live tables.
3. tests/pending-migration-release-train.test.mjs now explicitly rejects standalone BEGIN/COMMIT in 0119.
4. tests/pending-train-postgres-rehearsal.test.mjs runs only in GitHub Actions against the hard-coded disposable local PostgreSQL 16 database; it is skipped elsewhere. It reproduces absent payout prerequisites using a transaction-local DROP that is rolled back, then rehearses two preserved source candidates plus 0115-0119 in one transaction with a second rollback. It inspects idempotency guards, the Xendit check constraint and representative new tables. **No Neon branch or production SQL is altered by these tests.**
5. .github/workflows/ci.yml enables the guarded migration test within the existing disposable PG16 CI job after db:push. Failure blocks the draft and must not be bypassed.

## Neon capacity blocker and next review

Neon now reports 10 branches in a project capped at 10. A new attempt returned HTTP 422 BRANCH LIMIT EXCEEDED. Earlier attempts returned HTTP 401; current catalog reads work. Existing branches include payrollph-pr865-rehearsal-20261012, which has the 0115 first-payroll progress object, but is independently owned; do not delete, reset or rewrite it without authorization. An isolated PG18 branch rehearsal remains incomplete until a truly available, approved branch exists.

## Release acceptance order

1. Review/create full-path migration history receipts from actual DBA evidence, not inferred presence. Protect source main and back up/restore.
2. Reconcile the payout-ledger candidate and 0074 payout-profiles source with exact current Drizzle schema, immutability triggers, live payout history, encryption and maker/checker. Allocate a formally reviewed predecessor migration before attempting 0117.
3. Reconcile worker_employment_events from 0050 with real historical employee and legal-entity transfers before 0119.
4. Review the corrected 0119 source SHA, the #897 executor parser, and test branch snapshots. Never run payroll backfills until disputed history is explicitly resolved.
5. Rehearse all approved migrations on disposable PG16 and sanitized copy/clone of the correct Neon PG18 environment, checking row-level payroll differences <= PHP 0.01, tenant isolation, constraints and restoration.
6. Obtain independent DBA, payroll, treasury, privacy, security and release approval. No live payouts, bank writes, statutory submissions, biometric/photo collection or production flag changes.

**Current state:** All code commits in this PR are source-only; live production stays unchanged.
