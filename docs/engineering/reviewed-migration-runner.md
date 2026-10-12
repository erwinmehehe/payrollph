# P0-4: DBA-adopted, forward-only SQL migration executor

**Status: source implementation for independent review; not an approved live migration.**
This does not assert that production is migrated, that historic SQL ran, or that PayrollPH is launchable. It does not run from a Next.js request, worker, app startup, CI schema push, or ordinary deploy.

## Why the old folder cannot be replayed

The retained `drizzle/` history contains duplicate numeric prefixes, and `baseline.sql` represents an older, incomplete snapshot. Neither alphabetical order nor a table's existence proves applied history. The existing read-only historical receipt checker remains the authority for **independently reviewed adoption evidence**; do not alter or infer its receipts. Never rename an old SQL migration merely to resolve a collision.

The new runner only executes **new migrations after an explicit DBA cutover boundary**. Every source file is keyed by full path and exact-byte SHA-256. New version numbers must be unique and contiguous after the adopted boundary. Only one selected migration is applied per invocation, in a PostgreSQL transaction protected by a transaction-scoped advisory lock. Its immutable execution-ledger receipt is inserted in the same transaction as its SQL; any SQL failure rolls both back.

## Required adoption, done by a human DBA

1. Verify the actual target **host, database, account and environment**, along with backups, PITR and a witnessed restoration of an encrypted sanitized clone. A database-name match by itself does not prove host identity.
2. Reconcile the real SQL history, legacy `db:push` state and all prior full-path receipts under `docs/engineering/production-migration-receipt-runbook.md`. For every numbered historical SQL file, obtain a separately approved `applied` or `baseline-included` receipt with source hash, reviewer, change reference and supporting SQL/object evidence. Any missing, mismatched or `not-applied` historical row is a blocker.
3. Establish the last historical prefix that has truly been reconciled. For example, on the October 12 source baseline ending at 0114, run the **local, no-DB** command:

   `node scripts/run-reviewed-migration.mjs --manifest --through 0114`

   Independently verify its `historicalManifestSha256` and historic collision count. Do **not** use this command to create or claim migration receipts.
4. Under separate change approval, have the DBA create the two infrastructure tables described in `docs/engineering/reviewed-migration-cutover-template.sql` and insert exactly one reviewed `payrollph_migration_cutover` row. It stores the verified historical through-prefix, exact manifest SHA-256, approval reference, reviewer and adoption date. This SQL template is not an auto-applied migration.
5. Provision a **SELECT-only** planning role for these two tables and the existing historic receipt journal. Provision a distinct least-privilege SQL migration role with **SELECT/INSERT only** on the forward ledger and only the necessary reviewed DDL privileges. No journal UPDATE/DELETE grants; neither role should be superuser or have BYPASSRLS, CREATEROLE or CREATEDB. The DBA separately verifies roles and grants before release.
6. Configure the protected GitHub `production` environment with required DBA/security approvers and independently verified secrets `PRODUCTION_MIGRATION_AUDIT_DATABASE_URL` and `PRODUCTION_MIGRATION_WRITER_DATABASE_URL`. Keep Preview and production separated. The repo currently has no confirmed branch protection or independently approved production environment; **do not run apply until those are configured and reviewed.**

## Manual migration workflow

Run **Production Reviewed SQL Migration (Manual, Protected)** on the reviewed main commit with:

- `mode=plan` initially; later `mode=apply` only after signed authorization
- `reviewed_sha`: exact checked-out, DBA-reviewed 40-character main SHA
- `expected_database_name`: verified database name, never its connection URL
- `migration_file`: one reviewed *post-cutover* filename, e.g. `drizzle/0115_new_change.sql`
- `migration_sha256`: exact 64-character hash of that file
- For apply, `approval_ref` and `apply_confirmation=APPLY_APPROVED_SCHEMA_MIGRATION`

The protected workflow checks its SHA and inputs **before installing dependencies**. No production credentials are available during `npm ci`. Both modes first run a read-only receipt/journal/source check; apply then acquires a database advisory lock, checks the exact same source again with the writer, executes one approved SQL file, and inserts the forward journal row atomically. Plan opens a repeatable-read **READ ONLY** transaction and always rolls it back.

**Limitations:** A checked commit is not necessarily the live deployed commit. The DBA/release owner must coordinate pre-deploy schema rollout and verify the deployed application SHA separately. Arbitrary SQL can mutate business tables. The executor is not a replacement for security and DBA review of each statement, data backfill, lock-time risk, maintenance window, rollback/forward repair and backup. Its 90-second statement timeout is a protective default, not a production performance certification. A successfully applied post-cutover SQL still needs separate independently verified receipt evidence in the historical release journal so the read-only source inventory can reconcile that new file.

## Synthetic testing and hard stops

`node --test tests/reviewed-migration-runner.test.mjs` exercises full-path duplicate history, tampering, missing receipts, skipped prefixes, SQL transaction-escape rejection, plan rollback and one-time apply semantics without a database. The dedicated `reviewed-migration-rehearsal.yml` workflow also executes `tests/reviewed-migration-postgres.test.mjs` against **Postgres 16 on a disposable localhost CI database only**, including concurrent attempts and a deliberately failing multi-statement migration. It neither contacts nor reproduces production.

The following are **still P0-4 blockers** after this source work: DBA adoption on a real environment, migration receipts reconciled, a witnessed sanitized production-clone/fresh-database schema-parity rehearsal, independent migration review, a verified live deployment, and retirement of **all** request/runtime DDL writers. The optional `CORE_SCHEMA_COMPATIBILITY_MODE=read-only` is an incomplete subset preflight today. Do not enable it or remove legacy compatibility behavior on real employers until the separate complete schema audit and cutover tests pass.

## Separate security and payroll gates

Bank encryption is verified by the existing protected **Production Bank Encryption** workflow in dry-run and independently approved apply mode, including all four bank stores and current-key envelope verification. Do not access secrets or run bank backfills as part of the migration executor. Actual first-pilot signoff still requires scheduler liveness, independent payroll reconciliation, tax/agency acceptance, bank UAT and a witnessed restore. A clean migration plan or journal is not permission to release pay.
