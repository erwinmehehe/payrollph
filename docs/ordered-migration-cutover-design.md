# Fix C: ordered migration cutover plan for review

Status: DESIGN FOR REVIEW. Baseline main `4d816361` (12 October 2026). No runtime-schema code deletion or migration execution in this PR.

The attached build list requires a reviewed written plan before Fix C implementation and explicitly says not to delete core-schema-compat.ts in the same PR. Preserve that boundary.

## Existing evidence to reuse

`src/lib/core-schema-compat.ts` and lifecycle schema helpers perform runtime compatibility work. `docs/engineering/runtime-schema-writer-audit.md`, `scripts/audit-runtime-schema-writers.mjs`, `scripts/check-sql-migration-history.mjs`, `scripts/audit-production-migration-receipts.mjs` and `docs/engineering/production-migration-receipt-journal-template.sql` already exist. Receipt templates are read-only evidence tooling, not proof of an applied production history. `drizzle/meta` is absent on the inspected baseline. Historical SQL filenames include repeated ordinals; lexical filename sorting cannot be assumed to be dependency order.

## Stage 1: establish an independently reviewed baseline

Inventory all SQL files, checksums, dependency edges, schema objects and every runtime writer. Obtain read-only PostgreSQL catalog evidence and DBA-reviewed applied/baseline/not-applied receipts for the actual target. Never synthesize receipts from filename presence. Resolve duplicate ordinals, partial migrations, compat-created objects and data backfills by explicit manifest entries. Do not rename or rewrite already applied SQL. Unknown history blocks cutover.

Restore a sanitized production-like backup to an isolated database. Record schema fingerprint, encryption prerequisites, row counts, constraint/index state and representative payroll/filing relationships. No raw tokens, account numbers or government IDs in evidence. Add a separately reviewed baseline migration plus append-only ordered manifest mapping legacy paths and SHA256s; subsequent migrations use unique sequence IDs. Keep historical receipts and the runner's applied journal as separate records.

## Stage 2: deployment-only migration runner

After review, add default-off `ORDERED_RELEASE_MIGRATIONS_ENABLED`. Build a deployment CLI using a dedicated DDL-capable credential; web and worker roles remain data-only. Acquire a PostgreSQL advisory deployment lock. Compare committed manifest, checksums and database journal; reject missing dependencies, checksum drift, unrecognized applied rows or unexpected target identity. Execute each transactional migration and its journal receipt atomically. Explicit nontransactional operations require their own resumable, observable procedure. A retry must recognize completed work without reapplying effects. Never execute migration files from an HTTP request, app import, health check or CI against production.

Use separate stages for additive columns, bounded backfills, validation, index creation and eventual NOT NULL tightening. Bound batch work and document lock/time budgets. A failed stage must produce sanitized receipt evidence and leave a safe retry path. Credentials never enter source, URLs or logs.

## Stage 3: read-only compatibility preflights

Retain core-schema-compat.ts and existing helpers. For tenants adopting the reviewed cutover, requests perform fail-closed catalog/data prerequisite checks and never CREATE/ALTER/DROP/backfill. Missing prerequisites return an actionable 503/maintenance error, with an admin screen showing release ID and missing prerequisite names only. Test web/worker roles with CREATE and ALTER revoked. Preserve the exact legacy path for nonadopting/flag-off deployments until the baseline is independently accepted. Do not use the flag to claim a production migration has run.

## Stage 4: remove runtime writers in later PRs

After deployed journal parity, restore rehearsal, flag-off verification and a monitored adoption window, remove individual runtime writes in separate reviewed PRs. Each helper receives behavioral tests proving read-only success and fail-closed missing schema. Delete compat code only after all callers and nested writers have parity evidence. Maintain payroll-engine math and money evidence throughout.

## UI, testing and rollback

Add an owner/admin-only maintenance/readiness panel showing pending/applied release IDs and last successful preflight, never credentials, personal data or arbitrary SQL. Empty journal, loading, unavailable/blocked catalog and checksum mismatch have explicit states. Phone screenshots at 390px and desktop before/after; employee and unit-scoped roles must not see migration administration. No button executes DDL in the browser.

Disposable PostgreSQL tests execute baseline adoption, repeated apply, mid-transaction failure, resume, concurrent deployers, duplicate ordinal manifest, checksum tamper, unknown production receipt, restricted runtime-role requests and flag-off compatibility. Run all Manila-timezone tests and every golden suite against both fresh and sanitized upgraded schemas. Independently review restoration time and backup evidence.

Rollback means revert application/cutover flags to the compatible application release and preserve additive schema and evidence. Never auto-drop payroll columns or undo irreversible data backfills. If legacy runtime DDL is unsafe with the target schema, use maintenance mode and restore the reviewed backup rather than automatically reenabling writers. Destructive cleanup requires a later change review.

## Review decisions requested

Approve explicit legacy baseline/manifest adoption rather than blind replay; approve deployment-only DDL with restricted runtime roles; approve staged additive/backfill/validation work and evidence preservation; approve maintenance-mode rollback when reverting legacy writers is unsafe. Runtime implementation waits for review and actual DBA baseline evidence.
