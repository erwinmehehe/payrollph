# Fresh PostgreSQL 18 development rebuild — reproducibility gate

**Scope:** fictional, disposable, localhost GitHub Actions. **No AWS subscription, paid services, live Neon writes, real payroll, government filing, or money movement.**

## Why this is the next development priority

Payroll PH has no paying customers. The pre-customer development milestone is to verify that a new developer environment can be reconstructed from the checked-in Drizzle schema and execute a single, source-connected Hire → Onboard → Schedule → Clock In → Approve Time → Run Payroll → Review → Release Payroll Records → Prepare Filing Evidence flow using fictional data.

The historical `drizzle/baseline.sql` is older than the modern schema. The 0001–0123 numbered SQL archive includes duplicate identifiers and unverified applied history. **Never blindly replay those SQL files, infer an applied receipt, or use this workflow to migrate real Neon.** This is a **fresh developer bootstrap test**, not a proof of production migration-history reconciliation.

## New PG18 acceptance

`.github/workflows/nine-stage-connected-acceptance.yml` now has three separately isolated matrix cases:

- PostgreSQL 16 + direct Hire, preserving the existing regression.
- PostgreSQL 16 + governed Hire, preserving the existing regression.
- PostgreSQL **18 + governed Hire** as a fresh-start reproducibility test.

The PG18 case:

1. Confirms a GitHub CI disposable PostgreSQL 18 service is connected at the **exact** loopback `127.0.0.1:5432/app_db`, with the one-off synthetic password, no application database URLs, no provider credentials and money movement disabled.
2. Checks `public` is **empty** before running any schema tool. An accidental connection to a populated database fails immediately.
3. Executes `npm run db:push`, which is already guarded to reject Neon and all remote targets.
4. Checks for critical employer, employee, attendance, timekeeping, payroll, approvals and filing tables plus broad table/column/constraint/index coverage. Captures a **catalog-only** SHA-256 fingerprint without querying application rows.
5. Executes the exact same schema push again, then verifies identical catalog content. This blocks silent no-op bootstrap and non-idempotent push drift.
6. Runs the existing synthetic audit setup and session-clock fixture on PG18, with distinct fictional encryption keys, then runs the real localhost API journey, strict same-worker lineage checks, tenant-boundary negatives, both 375px/390px Chromium layouts and governed candidate-to-worker sidecar.
7. Uploads only sanitized fictional evidence and catalog-only fingerprints. No customer records exist in the isolated CI service. `SOLO_DEV_REBUILD_ACCEPTANCE` is possible only if all PG18 workflow steps actually pass at the reviewed SHA.

## Verification and evidence limitations

The new test module `tests/fresh-pg18-development-schema.test.mjs` checks that a bogus localhost, Neon hostname, non-empty initial database, missing schema or wrong-money-provider flags fail closed.

`scripts/qa/fresh-pg18-development-schema.mjs` has modes `preflight`, `capture`, `compare`. The helper never executes DDL or DML; only the already-guarded `npm run db:push` runs DDL on disposable CI. The catalog-only fingerprint is not an applied-migration journal and cannot establish parity against an existing deployed database.

The connected journey still uses a guarded **virtual Manila month-end**, fictional employees and a local browser. No physical mobile-device UAT, real employer zero-difference payroll comparison, external statutory import acceptance or real banking settlement is claimed. The separate source-only migration and launch gates remain open.

## Next after a green exact-head PG18 job

Use the nine-stage evidence to fix any genuine development schema or flow failures. Then expand realistic acceptance around cross-tenant restrictions, two mobile roles, WFM 14-scenario manual UAT and centavo-by-centavo *fictional* expected-value comparison. Revisit production backups and historic SQL adoption **when there is a real customer and resources for a protected release**, without confusing disposable Drizzle bootstrap with a supported forward-only production migration plan.
