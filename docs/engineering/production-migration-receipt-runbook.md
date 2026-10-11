# P0-4 — Production SQL migration receipt inventory

**Status: source-only, not production-accepted.** This is a read-only evidence check. It does not migrate a database, create the live journal, attest that SQL was run, disable runtime migrations or authorize a payroll release.

## Scope and assumptions

On October 11, 2026 the repository contained 124 numbered SQL files and 13 legacy duplicate-prefix groups. Prefixes are **not unique identities** and cannot establish historical application order. Each historical migration is identified by its **full path plus exact-byte SHA-256**; `drizzle/baseline.sql` is an older, unnumbered snapshot excluded from the numbered-file count. Source presence never establishes what ran in production.

Run `node scripts/audit-production-migration-receipts.mjs --inventory` to obtain a local source manifest digest and duplicate-prefix inventory without a database connection. Do not replay the entire folder in filename order or rename legacy collisions.

## Protected operator process

1. The DBA independently identifies the actual production **host and database**, reconciles historical source changes and any prior `db:push` state, and attaches object/SQL evidence, change references, independently reviewed receipts and a restored backup reference. A table's existence alone does not prove a specific migration ran.
2. `docs/engineering/production-migration-receipt-journal-template.sql` is **DBA-only source documentation**, not an executable CI step. A qualified DBA may adopt that reviewed table in a separate authorized change. The DBA enters individual full-path receipts only after independent validation. A `baseline-included` disposition needs documented proof that the SQL's intended state is already in an adopted baseline; `not-applied` always blocks reconciliation.
3. Provision `PRODUCTION_MIGRATION_AUDIT_DATABASE_URL` in the protected GitHub **production** environment. It must be a distinct database account with `SELECT` on the receipt journal only, not a writer, not Preview, and without access to employee/payroll/bank tables. Do not print secrets in chat or log files.
4. Manually dispatch **Production Migration Receipts Audit (Read Only)** on reviewed `main`, supplying the exact 40-character commit SHA and the independently confirmed target database name. The workflow validates the SHA before checkout and dependency installation. The password/URL is made available only to the final verification step.
5. The verification opens a bounded **REPEATABLE READ, READ ONLY** transaction; checks database name, nonprivileged account permissions and journal existence; matches every numbered path and byte hash to an evidence-backed receipt; then rolls back. Any missing, changed, unknown or duplicate receipt, missing evidence, invalid recorded date or unapplied migration fails.

Every output contains `productionReleaseApproved: false`. A clean receipt review does **not** prove complete schema or function equivalence, all applied data transformations, backup restoration, isolation, compliance, bank protection or payroll readiness. Same-named databases can exist on different hosts: a DBA must verify **host identity separately**.

## Open P0-4 work

- Design and approve one migration executor and independently verified per-file journal after the live adoption plan. Rehearse a **fresh disposable database** and a **sanitized isolated production clone** before applying anything to live data. Do not blindly replay all 124 SQL files; `baseline.sql` and legacy colliding numbers require historical reconciliation.
- `src/lib/core-schema-compat.ts` currently executes runtime compatibility DDL and data backfills from application paths. Those writers must be retired under a separate, DBA-approved, regression-tested change **after** confirming target schema readiness. This PR deliberately does not alter them.
- CI `db:push` is acceptable **only** against its disposable Postgres 16 fixture and does not certify the production migration sequence.
- Coordinate with the merged read-only schema preflight PR #784 and the still-draft P0-2 bank-encryption review PR #800. These source controls do not authorize a production deployment, bank write or real payroll release.


## Staged removal of core runtime DDL (source gate only)

This branch also includes the optional `CORE_SCHEMA_COMPATIBILITY_MODE=read-only` setting in `ensureCoreCompatibilitySchema()`. This is a **migration cutover switch**, not approval to deploy. The default remains `legacy` to avoid breaking the currently unreconciled production database. Unsupported/typo modes fail closed rather than selecting legacy implicitly.

After the DBA completes the journal, original-host identification, a restored-clone rehearsal, critical schema inventory (PR #784), encryption checks and an approved release plan, test read-only mode against the isolated clone. It opens a **REPEATABLE READ, READ ONLY** transaction and checks release-critical tables, columns, unique index signatures, audit function and audit mutation trigger. Missing structures throw `CORE_SCHEMA_READONLY_PRECONDITION_FAILED`: dashboard/demo traffic fails instead of issuing any compatibility DDL or automatic bank/government-ID backfill. It then rolls back without persistent writes.

**Limitations:** This structural check covers only the explicit critical-object subset in `src/lib/production-schema-inventory.ts`; it does not certify the complete application schema, historical migrations or other runtime schema helpers (`ensureLeavePayrollSchema()`, etc.). Do not enable this mode on real production until those independent mutation paths, operational fallbacks and user-facing failure behavior have been reviewed. Flipping back to `legacy` may resume database writes and requires its own change approval. This source PR does not change Vercel environment variables, operate on live data, or retire the legacy code.


## Leave timing and pay-profile request-path cutover

The same opt-in `CORE_SCHEMA_COMPATIBILITY_MODE=read-only` now also covers
`ensureLeavePayrollSchema()` and `ensureEmployeePayProfileSchema()`. Both
check PostgreSQL catalog metadata inside a rollback-only read-only
transaction, including critical typed columns, expected indexes/uniqueness,
leave status/timing and financial profile foreign-key constraints. Failed
preflight discards the pooled connection rather than returning an
untrusted transaction to the pool. The prior automatic table creation and
column upgrades remain the legacy default only.

`ensureEmployeePayProfiles(organizationId)` is a separate data backfill:
in read-only mode it does **not** insert missing employee pay profiles.
It instead uses a tenant-scoped, read-only existence query and fails with
`READONLY_PAY_PROFILES_REQUIRE_REVIEWED_BACKFILL` if any employee lacks a
profile. A DBA-approved conversion, with payroll reconciliation and
appropriate employer authorization, must address such rows before switching.

These guards are **structural subset preflights**, not a complete schema
or migration proof, and they do not disable other legacy request-time DDL
helpers (e.g. payroll month-close, DOLE reporting). The release flag must
remain unset in production until all remaining writers have been
enumerated and retired or independently guarded. Do not use this setting
to avoid migrating an incompatible or unverified production database.
