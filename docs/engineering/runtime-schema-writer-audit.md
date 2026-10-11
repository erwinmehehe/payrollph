# P0-4 — Runtime schema writer source inventory

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
Retain legacy behavior by default until independently approved DBA adoption.
Do not silently disable or auto-repair the missing database structure.

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
