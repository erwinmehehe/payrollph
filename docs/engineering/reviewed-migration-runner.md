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

**Limitations:** A checked commit is not necessarily the live deployed commit. The DBA/release owner must coordinate pre-deploy schema rollout and verify the deployed application SHA separately. Arbitrary SQL can mutate business tables. The executor is not a replacement for security and DBA review of each statement, data backfill, lock-time risk, maintenance window, rollback/forward repair and backup. Its 90-second statement timeout is a protective default, not a production performance certification. Historical adoption receipts describe only the adopted boundary; forward files are recorded in the separate execution journal. A historical receipt outside that boundary blocks execution rather than being silently ignored.

## Synthetic testing and hard stops

`node --test tests/reviewed-migration-runner.test.mjs` exercises full-path duplicate history, tampering, missing receipts, skipped prefixes, SQL transaction-escape rejection, plan rollback and one-time apply semantics without a database. The dedicated `reviewed-migration-rehearsal.yml` workflow also executes `tests/reviewed-migration-postgres.test.mjs` against **Postgres 16 on a disposable localhost CI database only**, including concurrent attempts and a deliberately failing multi-statement migration. It neither contacts nor reproduces production.

The following are **still P0-4 blockers** after this source work: DBA adoption on a real environment, migration receipts reconciled, a witnessed sanitized production-clone/fresh-database schema-parity rehearsal, independent migration review, a verified live deployment, and retirement of **all** request/runtime DDL writers. The optional `CORE_SCHEMA_COMPATIBILITY_MODE=read-only` is an incomplete subset preflight today. Do not enable it or remove legacy compatibility behavior on real employers until the separate complete schema audit and cutover tests pass.

## Separate security and payroll gates

Bank encryption is verified by the existing protected **Production Bank Encryption** workflow in dry-run and independently approved apply mode, including all four bank stores and current-key envelope verification. Do not access secrets or run bank backfills as part of the migration executor. Actual first-pilot signoff still requires scheduler liveness, independent payroll reconciliation, tax/agency acceptance, bank UAT and a witnessed restore. A clean migration plan or journal is not permission to release pay.


## Required modern schema-lineage fingerprint (legacy Neon safety)

The reviewed forward runner now executes a **catalog-only PostgreSQL
fingerprint before reading any migration journal or applying SQL**.
`scripts/lib/schema-lineage-preflight.mjs` requires contemporary
`organizations`, `employees`, `payroll_runs`, `payroll_entries`,
`payout_transfers`, and `provider_events` identifiers with expected
`integer` columns. It does not inspect employees, payroll lines or
bank-account values. Missing tables, UUID IDs, missing
`organization_id`, ambiguous PostgreSQL catalog output or any unexpected
column type fail with a non-sensitive release-blocking error.

A historical `clients` / UUID / `client_id` application schema is **not**
a database merely waiting for a few numbered `drizzle/` files: it is
a distinct schema lineage. Do **not** adopt or invent historical
migration receipts for it. Do not run `db:push` or apply current-model
Drizzle SQL to a legacy database, even if the existing tables have the
same names (`employees`, `payroll_runs`). The two models have different
tenant and primary/foreign key identities.

A separate conversion requires a signed, tested plan covering:
- A fresh empty database with a clean current-schema baseline **or** an
  explicitly designed, reversible staged transformation, not automatic
  in-place changes to UUID primary keys.
- Demonstrable backups and verified restoration of the legacy branch before
  any transfer, with privacy controls and environment-scoped access.
- Stable mapping tables for client UUID to organization integer and
  employee/payroll UUID to integer references; referential integrity,
  user membership, approvals, time and payroll history reconciled.
- Explicit independent checks of payroll centavos and bank encryption with
  **no plaintext account data in logs, exports, or issue comments**.
- A protected schema cutover transaction and an application commit that
  understands the target schema. A modern-schema migration journal is
  established only after the clean baseline is verified, not fabricated
  to make a legacy database look up-to-date.

These requirements are not met by this source-only PR. An all-zero
legacy-demo flag would not prove bank fields synthetic. The production
release flag remains closed, and the legacy database remains unchanged.


### Verified correct Neon source (October 12, 2026)
The correct Neon project is `calm-wave-70219564` / `neon-almond-ridge`, default `main` branch. Its core `organizations`, `employees`, `payroll_runs` and `payroll_entries` use contemporary integer IDs and organization scoping; the old `ddbb` connection was unrelated and must not inform migration decisions. The migration lineage check now covers seven **existing core schema** column identifiers. `provider_events` and `payout_transfers` are **missing feature migrations**, not disqualifying baseline lineage fields. They need staged, independently reviewed deployment after actual historical SQL receipts and a proven restore. No migration journal was found, and zero of 112 public tables have RLS enabled. The database was not modified.


## Neon branch and endpoint identity protection

The reviewed migration runner now **requires** protected GitHub `production` environment variables `PRODUCTION_NEON_PROJECT_ID`, `PRODUCTION_NEON_BRANCH_ID` and `PRODUCTION_NEON_ENDPOINT_ID`, alongside the previously reviewed `expected_database_name`. For the verified PayrollPH deployment on 2026-10-12, the expected project is `calm-wave-70219564`, branch `br-lucky-sound-b79i56jw`, and endpoint `ep-cool-hat-b7e7gpoo`. These are not credentials; the DBA must independently reverify against Neon's current project endpoint routing before configuring them.

**No automatic fallback.** Missing variables, pooled hostnames, mismatched endpoint or database in either the read-only planning or migration writer URLs fail before connecting. Within the same PostgreSQL transaction that would otherwise apply SQL, the runner independently queries `current_setting('neon.project_id', true)`, `neon.branch_id`, and `neon.endpoint_id`, and rolls back if any differ. This mitigates the October 12 snapshot-restore incident in which a familiar hostname temporarily pointed to a different Neon branch. A matching `neondb` name alone no longer authorizes writes.

The isolated localhost CI PostgreSQL tests retain an explicit `allowElevatedRoleForIsolatedTest` bypass only through the in-process test API; the protected CLI never accepts that bypass. These checks are **defense in depth** and do not replace migration checksums, source manifests, historical receipts, deployment integrity, bank-key review or independent DBA/change approval. Variables and protected GitHub environment/branch controls must be configured by an authorized operator before running manual plan/apply. Production SQL remains BLOCKED.

### GitHub main branch protection is mandatory for APPLY

The `--apply` command additionally rejects unprotected refs using GitHub's
system-provided `GITHUB_REF_PROTECTED=true` alongside
`GITHUB_REF=refs/heads/main` and the exact reviewed SHA check. The protected
manual Actions workflow runs this preflight before fetching migration secrets
and again in the Node CLI before opening any database connection. The
read-only `--plan` option remains available on `main` during protection setup.

As of October 12, 2026, GitHub reports `main.protected=false`, so APPLY must
remain **blocked** even if a person supplies a plausible approval reference.
A repository administrator must configure and verify actual GitHub branch
rules and independent approval requirements, including the separate protected
production Actions environment. This source guard does not itself enable
branch protection, approve DBA receipts or permit production migration.


## Approved Stage 1–2 boundary and default-off proof

The companion baseline diagnostic now reads column types, column presence and table counts from `pg_catalog`, which exposes structure without granting the audit role SELECT on sensitive application rows. `information_schema` privilege filtering previously hid that evidence. A view cannot satisfy a foundation table requirement. Overall review eligibility also requires every external canonical predecessor, not only selected historical foundations. The same real PostgreSQL restricted-role rehearsal executes these catalog queries and negative controls; it remains synthetic and never authorizes the live train.

Written decisions for #870 authorize source implementation only. `ORDERED_RELEASE_MIGRATIONS_ENABLED` defaults OFF; only exact `true` permits APPLY. Both the CLI (before constructing a client) and transaction executor enforce it. Protected environment variables supply it; no PR input can enable it. Source manifest generation and read-only PLAN remain available. No runtime compatibility helper is removed or changed.

The PostgreSQL rehearsal now uses actual restricted audit and writer roles rather than bypassing privilege checks. It executes denial of runtime CREATE/ALTER, sensitive-row reads by audit, and writer UPDATE/DELETE of evidence; concurrent apply and failure rollback remain behavioral. Synthetic Neon identity settings are fixtures, not real endpoint evidence. A separate disposable backup/restore drill checks hashes, constraints and rollback. It does not certify a production-like employer restore or production RTO.

NOT done: actual independently adopted target baseline/manifest and dependency review, production-like sanitized restore, protected environment/credential provisioning, runtime writer retirement (Stages 3–4), backfills, UI/readiness panel, production DDL or activation. UI screenshots are not applicable to Stage 1–2 because this PR introduces no UI. `core-schema-compat.ts` and `payroll-engine.ts` remain unchanged. If legacy writers are unsafe during rollback, keep maintenance mode and preserve additive schema/journals; never automatically reenable them.
