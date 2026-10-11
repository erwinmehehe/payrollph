# P0-4 — Critical Release Migration Bundle: Isolated PostgreSQL 16 Rehearsal

**Status: CI-only synthetic regression test. Not a production-like restore or migration acceptance.**

The standalone GitHub Actions workflow **Critical Release Schema Migration Rehearsal (Synthetic CI)** verifies that a carefully selected late migration bundle can be replayed together without breaking release-critical catalog objects and synthetic relationships.

It executes four checked-in files, **in explicit reviewed order only**:

- `0100_compensation_automation_intents.sql` — automation outbox
- `0106_saas_selfserve_recurring_billing.sql` — verified signup and recurring billing
- `0109_tamper_evident_audit_chain.sql` — append-only audit chain
- `0110_provider_events_inbox.sql` — provider-event deduplication

The test starts with a minimal **fictional** predecessor schema: organizations, users, employees, compensation events, subscriptions, payroll runs/entries and audit events. It seeds two fictional employers, a dummy bank-field marker that **is not an actual account**, and pre-migration audit history. It applies the four SQL files twice inside a single PostgreSQL transaction and checks:

- Required tables, columns, functions, enabled mutation trigger and correct unique-index table/key/predicate/validity/readiness signatures.
- Idempotent replay, same-employer billing uniqueness while retaining independent employer rows, compensation automation event-key uniqueness, global provider-event deduplication and foreign-key rejection.
- Sealing of audit records written **before** and after the migration, hash-chain integrity, and rejection of unauthorized audit edits.
- Original fictional bank-field preservation.
- Full transaction **ROLLBACK**, followed by a PostgreSQL catalog query verifying the rehearsal schema no longer exists.

The runner refuses connections unless `CI=true`, `GITHUB_ACTIONS=true`, `MIGRATION_REHEARSAL_MODE=isolated-ci-only`, and `DATABASE_URL` points to the exact local `postgres` role on the disposable `app_db` at port 5432. The workflow uses its own PostgreSQL 16 service and passes **no production credentials or GitHub secrets**. It does not run `db:push`, migrate an environment, or deploy code.

Successful CI emits `qa-artifacts/release-schema-rehearsal.json` with **synthetic-only proof**. Its `productionCloneRehearsed`, `appliedMigrationReceiptsVerified`, `databaseChangesCommitted`, and `productionReleaseApproved` flags are always `false`.

## What this does *not* verify

This is **not** a rehearsal of all 124 legacy SQL files, **not** a sanitized production copy, and **not** evidence that production applied any migration. The minimal fixture does not reproduce all historical constraints, legacy data types, existing tenant volumes, Vercel runtime request paths, payroll exports, government filings or key history. In particular, it cannot certify that the opt-in read-only compatibility mode in draft PR #805 can replace every runtime schema writer.

Before changing production, a DBA must independently acquire and restore an appropriately sanitized production-like copy into an isolated, access-controlled environment, inventory the real applied migration receipts and hashes, execute the **separately approved** adoption plan on that copy, and witness backup/rollback and security isolation. Any production restore must stay outside public GitHub CI and this test. A clean synthetic rehearsal does not waive P0-2 bank-encryption, P0-4 migrations or payroll/release approvals.

Related: master audit #744; draft migration receipts/read-only cutover #805; read-only production schema inventory #784 (merged).
