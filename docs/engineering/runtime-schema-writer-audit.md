# P0-4 — Runtime schema writer source inventory

## October 22, 2026: sibling helpers retired

The eleven sibling helpers (`dole-reporting`, `leave-payroll`, `migration`,
`outbox`, `pay-basis`, `payroll-month-close`, `separation`,
`statutory-remittance-correction`, `statutory-remittance-month-close`,
`workforce-attendance-control` and `marketing-leads`) no longer contain any
request-time DDL, advisory locks or backfills. Each keeps its exported name and
only runs its catalog check (`cachedRequestSchemaVerifier` or
`verifyRequestSchemaReadOnlyFromPool`) in every mode. The source audit drops
from 251 to 192 findings, all in `core-schema-compat.ts`, which is retired
separately. Missing pay profiles are no longer invented from the legacy monthly
rate; they need a reviewed data backfill.

Marketing index contract: flag-on accepts only the canonical DESC (NULLS FIRST)
definition. Flag-off now accepts either the canonical definition or the
historical runtime-created DESC NULLS LAST one, because nothing can create or
repair these indexes at runtime any more; any other definition fails closed.
Synthetic PostgreSQL tests exercise both definitions and both modes.

## October 18, 2026: default-off read-only rollout

PR #1210 adds the registered REQUEST_SCHEMA_READONLY_ENABLED gate. An unset
flag, false, empty or invalid value preserves main's existing mode contract:
unset or legacy selects the historical compatibility path; explicit read-only
selects catalog verification; invalid modes are refused. This source merge does
not activate the cutover or repair the production database.

Only the exact flag value true enables the new default: unset mode becomes
read-only and explicit legacy is refused before request DDL/backfills. There is
no CI/environment-based exception once enabled. Disposable fixture setup remains
on the historical path with the flag off until it moves to an offline runner.
The source audit detects early catalog exits, not actual database permissions.

The core preflight accepts the legacy guard only when no v2 artifacts exist.
For 0133 it requires all three exact, enabled, unconditional, zero-argument v2
triggers with the expected timing/events and invoker functions pinned to
pg_catalog. Partial v2 installation cannot fall back to the legacy trigger.
This is structural subset evidence, not function-body attestation, applied
migration receipts, a least-privilege proof or payroll release approval.

Enable the flag only after approved schema remediation, actual runtime/sealer
role checks, and rollout acceptance. The owner has authorized source-only work;
no additional independent source approval is requested. Production SQL, role,
credential and flag changes remain separate operations. No live changes occur
in this PR. With the default-off flag, the former merge-before-migration outage
risk no longer requires holding the source merge itself.

### Source-only table and lock review

- `src/lib/core-schema-compat.ts` contains 54 distinct historical
  `CREATE TABLE IF NOT EXISTS` targets. All 54 table **names** appear in
  `src/db/schema.ts`. This does **not** prove equality of columns,
  defaults, foreign keys, checks, indexes, backfill effects or history.
- `src/lib/marketing-leads.ts` formerly created `marketing_leads`
  under a transaction-scoped advisory lock. The old runtime index used
  `created_at DESC NULLS LAST`, while the numbered
  `drizzle/0024_marketing_leads.sql` migration uses `DESC`.
  In Drizzle 0.45, `.desc()` on an index implicitly uses `NULLS LAST`,
  unlike PostgreSQL's default `DESC NULLS FIRST`. Both marketing indexes
  now explicitly use `.desc().nullsFirst()` in `schema.ts` to match the
  numbered migration and the read-only catalog check. Existing drift
  requires a reviewed migration, not ad hoc request SQL.
- Core's compatibility DDL also uses a transaction-scoped advisory lock.
  Advisory locks serialize *cooperating callers of the same lock key* only;
  they do not stop unrelated schema writers or prevent heavyweight table
  locks from delaying application traffic. The legacy DDL transactions
  do not establish a bounded lock-wait/statement-timeout policy. Retiring
  their invocation removes this request-path lock risk; it is **not** an
  audit of actual deployed DB role grants.
- Canonical numbered SQL and `schema.ts` are the review sources, not the
  legacy `IF NOT EXISTS` creator; that clause never validates the shape
  of an existing relation. The migration-table coverage test still documents
  historical objects without numbered creators.

This is a conservative static source audit for PayrollPH. It does not connect
to PostgreSQL, Vercel, a payment provider, or any employer. It does not run
migrations or authorize a production payroll release.

## What the checker does

The TypeScript AST scanner detects executable SQL CREATE/ALTER/DROP/TRUNCATE
statements, implicit INSERT/UPDATE/DELETE backfills inside lifecycle helpers,
and computed SQL queries in lifecycle helpers that cannot be safely classified.
It checks files in src and reports the exact file, line, enclosing function
and type of potentially dangerous call site.

An early read-only branch is classified as "early-readonly-exit" only when a
strict CORE_SCHEMA_COMPATIBILITY_MODE parser is visibly invoked before the
mutation and the read-only path returns. This is a source-level heuristic,
not a proof that all nested callees are side-effect-free.

Run locally (no database connection):

- npm ci
- node --test tests/runtime-schema-audit.test.mjs
- node scripts/audit-runtime-schema-writers.mjs src
- node scripts/audit-runtime-schema-writers.mjs --strict src

The strict check exits nonzero when *any* unguarded mutation or unknown dynamic
lifecycle SQL remains. PR CI runs both parser tests and the strict whole-src
scan. The job logs report counts and source locations, not SQL values or
employer data. A nonzero strict exit is a REAL source release blocker, not a
reason to suppress the scanner, whitelist a module or mark it advisory.

## Known existing gaps on main (October 11, 2026)

Source inspection found request-time DDL writers in:

- src/lib/migration-schema.ts
- src/lib/outbox-schema.ts
- src/lib/separation-schema.ts
- src/lib/statutory-remittance-correction-schema.ts
- src/lib/statutory-remittance-month-close-schema.ts
- src/lib/workforce-attendance-control-schema.ts
- src/lib/leave-payroll-schema.ts
- src/lib/pay-basis-schema.ts
- src/lib/payroll-month-close-schema.ts
- src/lib/dole-reporting-schema.ts

This is not an exhaustive list. The full source scan may find additional DDL
or lifecycle queries. PR #805 proposes optional read-only guards for some
of these helpers but remains a draft, and source presence does not prove that
the guards or the underlying database satisfy release requirements.

Work through the strict findings by introducing an independently verified,
fail-closed catalog or data-read preflight **before** each legacy schema writer.
Historical policy (superseded by the October 17 source-only change):
the legacy creator used to run by default. The registered flag is default-off; when enabled, requests use read-only
checks and fail on missing structure. An approved migration precedes activation.
Do not silently auto-repair the missing database structure.

## Limitations and production gates

Static inspection can miss stored procedure side effects, SQL assembled through
complex helper calls, indirect service APIs or code outside src. A source-level
early exit does not prove correct PostgreSQL catalog semantics, migration
history, roles, data integrity, encryption, or user-facing failure handling.

P0-4 remains open until a DBA verifies the actual production host, the full
historical applied migration receipt/checksum chain, and an approved migration
and rollback rehearsal against a sanitized isolated production-like restore.
A source audit cannot substitute for that review. It cannot close P0-2 bank
encryption, certify payroll calculations, or authorize a production deployment.

Related: #744 master remediation, draft #805 migration receipt/cutover,
draft #811 synthetic isolated migration rehearsal, #112 release safety.
