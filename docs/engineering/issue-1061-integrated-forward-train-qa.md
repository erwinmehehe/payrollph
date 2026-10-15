# #1061 / P0-4 — 0115–0123 exact-source integration rehearsal

**Disposition: SOURCE-ONLY; NOT APPLIED TO NEON OR PRODUCTION.** This test does **not** clear #1061, approve the historical migration cutover, establish original production schema parity, attest bank or payroll correctness, or authorize money movement.

## Purpose

The existing `consolidated-migration-train-ci.yml` tested the 0115–0121 source train on PostgreSQL 16 and 18. The existing #910 workflow tested 0123 alone. Neither demonstrated that the *same transaction* could execute **0115 → 0116 → 0117 → 0118 → 0119 → 0120 → 0121 → 0122 → 0123** with the final 0123 tenant constraints and the earlier 0121 historical backfill.

`tests/issue-1061-integrated-forward-train-postgres.test.mjs` closes that *synthetic integration* gap. The test imports the repo's established `assertIsolatedMigrationTarget` guard. It can connect only to `postgresql://postgres:...@127.0.0.1:5432/app_db` when `CI=true`, `GITHUB_ACTIONS=true`, and `PENDING_TRAIN_REHEARSAL_MODE=isolated-ci-only`. GitHub Actions provisions a **disposable local PostgreSQL 16 or 18 service** and initializes it with `npm run db:push`. No Neon URL, production secret, snapshot, real worker or money movement is used.

## Acceptance evidence checked in each PG version

1. Read the **exact nine numbered SQL source files** from the checked-out commit; print the nine source-only SHA-256s (never claim they are applied receipts). Reject embedded source-level `BEGIN`, `COMMIT` or `ROLLBACK`.
2. Verify 0121 is an actual historical-data migration (`INSERT`/`UPDATE`) and 0123 remains additive schema-only, without historical payroll attribution. The runner, not either SQL source, owns the transaction.
3. Begin one transaction. Within it, remove the synthetic payout foundations, seven predecessor/provider/demand tables, and four entity-scope target tables that `db:push` generated. These **test-only DDL changes always roll back**.
4. Before 0115/0116, attempt **the exact 0123 source** and require PostgreSQL `P0001 ISSUE910_MISSING_SCHEMA_PREREQUISITES`. Compare complete public catalog fingerprints after savepoint rollback: tables, columns, constraints, indexes, routines and non-internal triggers.
5. Create **two fictional tenant organizations**, two employers in tenant A, and one employer in tenant B. Create a fictional employee currently attached to **employer A2** whose previous payroll run was for **employer A1**, with a separate unrelated tenant-B employee. Record counts and exact gross/deduction/net amounts.
6. Execute **all nine numbered SQL files in order**, without substitutions or skipping. Confirm payout foundations, Xendit expansion constraint, multi-entity tables, newly created provider/WFM demand tables, and the 0123 tenant/employer foreign keys.
7. Confirm the 0121 linked payroll-entry backfill uses the **immutable parent payroll run (A1)**, not the employee's current employer (A2). The conflicting payroll history must also prevent an invented employee-entity assignment. Verify the six-digit/centavo amounts and worker/payroll counts remain identical after 0121, after 0123, and after a second 0123 application.
8. Send **illegal cross-tenant/cross-employer inserts and updates** to authorization tables and payroll metadata; require PostgreSQL FK rejection, without accepting silent cross-tenant writes. Confirm legacy `NOT VALID` tenant/employer constraints remain unvalidated pending a separate DBA history investigation.
9. Verify 0122 does not rewrite existing-employer navigation settings. End with **ROLLBACK** and require identical before/after catalog fingerprints and fictional payroll aggregates, including the prior database state.
10. All provider transfer, multi-entity activation, and punch evidence feature flags remain **false** in the CI job.

## Known limits — deliberate STOP / NO-GO

- `npm run db:push` is permitted **only on the disposable localhost CI instance** to build a fictional schema fixture. It is **never** a production migration mechanism. The synthetic fixtures do not model all live Neon drift, row volume, current bank/provider roles, or production data conflicts.
- A passing source test is not proof that PostgreSQL changes were historically applied in production. Migration prefix collisions require **full path + SHA-256 receipts** and an independently reviewed historical cutover, both absent on production.
- 0121 writes historical employer data and grants in its actual SQL. This CI run does not attest the correctness of any real employer's historical attribution. Before production APPLY, DBA/payroll/privacy reviewers must reconcile imported payroll and prior employment records, review backfill decisions, prepare a current durable independent backup, witness a private sanitized restore, and sign off.
- The live Neon `main` database currently lacks 0115/0116 payout foundations, 0123's remaining prerequisites, and 0124–0126 target tables. Do **not** advance directly to 0124–0126, run direct SQL, fabricate receipts, enable money-out, or delete the retained production recovery evidence.
- No CI job in this PR requires Neon credentials, Vercel credits, or any production environment. No branch/snapshot is created in Neon.

## Execution

The existing `.github/workflows/consolidated-migration-train-ci.yml` is extended to run this test **sequentially after** `tests/complete-pending-train-postgres.test.mjs` for both PostgreSQL 16 and 18. The two node:test files run in separate processes so their independent transaction-local `DROP ... CASCADE` test setups cannot race.

All acceptance evidence applies only to the **exact tested PR commit SHA**. Check job logs for actual test assertions and failures; workflow green is not DBA or launch approval.