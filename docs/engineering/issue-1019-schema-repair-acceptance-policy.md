# Owner decision — schema-only repair acceptance (2026-10-16)

**Release remains NO-GO. This policy relaxes one development tooling check only.** It authorizes no schema change, migration, production/Neon/real-database action, or feature flag activation.

Applies to #1019, #1085, #1101, #1110 and subsequent schema-only repair PRs.

## Known Drizzle limitation

The application's committed `drizzle-kit@0.31.11` (owner-verified latest npm stable on 2026-10-16) can propose a phantom `ALTER TABLE "documents" DROP CONSTRAINT "documents_org_employee_id_hr_cases_unique";` on an unchanged second push. PostgreSQL rejects it with SQLSTATE `2BP01` because `employee_hr_cases_coe_document_tenant_fk` depends on the tenant-scoped unique key. It reproduces on disposable PG16 and PG18 even without repair SQL. Matched 1.0 release candidates have separate no-op evidence but are not application-compatible or approved.

**Second drizzle-kit push: not used as a gate, see #1019.** Do not claim a stable second-push no-op.

## Mandatory repair acceptance

1. Fresh **disposable localhost PostgreSQL 16 and 18** baseline: first guarded pinned-stable schema push; then compare the repaired candidate with `src/db/schema.ts` via actual catalog metadata. Compare names, types, nullability, defaults, FK referenced columns and actions, UNIQUE/PK/check constraints, indexes and definitions. The repair must match exactly.
2. Deliberately change one candidate column type and require the catalog checker to detect and reject it.
3. Reject full repeat application and partial-target application without changing database objects.
4. Run `scripts/qa/coe-document-tenant-negative-proof.mjs` or an equivalent PostgreSQL transaction-based fixture and prove a cross-tenant COE document attachment is rejected by the exact named composite FK (`23503`). Roll back fictional test data.
5. Run full `npm test`; report actual passed/failed/skipped counts and links to the exact CI head.

A first fresh-bootstrap `npm run db:push` still uses `scripts/strict-db-push.mjs` with all fail-closed protections from #1077. Do not allowlist, retry, ignore or downgrade `2BP01`; never use `--force` or destructive DDL to create an apparent no-op. No application runtime, dependency version, lockfile, `src/db/schema.ts`, tenant constraints or historical `drizzle/` migration changes are authorized.

## CI and PR reporting

For schema-only repair PRs, use the disposable dual-major catalog and negative tests plus full `npm test`. The independent release-candidate second-push jobs in the #1101 IT-assets and #1110 HR-cases schema-only workflows are removed from **repair acceptance only**, not treated as a stable fix. Any other tooling investigation of #1019 is independent of schema repair sign-off.

Each repair PR must explicitly state:

> second drizzle-kit push: not used as a gate, see #1019

Report the catalog comparison, intentionally corrupt type, repeat and partial target rejection, tenant negative proof, and full test counts; mark unexecuted evidence pending. Passing these checks does **not** establish historical migration receipts, give DBA/security approval, or authorize real database activity.

## Revisit

Reopen the second-push gate only after an owner-approved toolchain change or a stable `drizzle-kit` newer than `0.31.11` becomes available. Require a genuine stable first+second-push no-op on disposable PG16 and PG18, deliberately introduced drift detection, and exact COE tenant negative evidence before adopting a new gate.
