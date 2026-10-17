# P0-4 — Runtime schema writer source inventory

## October 17, 2026 source hardening (DRAFT; not a database migration)

`coreSchemaCompatibilityMode(undefined)` now returns `read-only`; the only
accepted explicit value is `read-only`. `legacy`, typos and empty strings
throw before the old DDL path, including when a previous in-process schema
readiness cache is set. Every audited compatibility helper delegates through
this parser and a catalog-only checker. The 2,600-line historical core SQL
and other legacy DDL text remain in source temporarily for forensic review,
but normal application requests cannot select their former write mode.
The strict whole-`src` source scan and the parser regression are required CI
checks; indirect/new SQL execution sites still require separate review.

**Do not merge or deploy solely because these source tests pass.** The
application must have its reviewed schema installed first. On an incomplete
target (see #1198), the preflight will reject a request instead of creating
missing objects. Development repair of fictional/test data may follow the
separate approved disposable-DB or reviewed migration workflow; this PR
does not connect to Neon, execute SQL, grant roles or apply any migrations.
The serving database identity, authentic migration receipts, restoration and
least-privilege roles remain independent operator verification tasks.

### Source-only table and lock review

- `src/lib/core-schema-compat.ts` contains 54 distinct historical
  `CREATE TABLE IF NOT EXISTS` targets. All 54 table **names** appear in
  `src/db/schema.ts`. This does **not** prove equality of columns,
  defaults, foreign keys, checks, indexes, backfill effects or history.
- `src/lib/marketing-leads.ts` creates `marketing_leads` under a
  transaction-scoped `pg_advisory_xact_lock`. Its old
  `created_at DESC NULLS LAST` index expressions differ from the canonical
  `schema.ts` and `drizzle/0024_marketing_leads.sql` expressions
  (`created_at DESC`). The read-only catalog index requirement now checks
  the canonical expressions. Existing drift must be reconciled by reviewed
  SQL, **not** by a request handler.
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
the legacy creator used to run by default. Current behavior is read-only and
fails on missing structure; an approved migration must precede its deployment.
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
