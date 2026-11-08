# WPS-01 — workforce-planning scenario POST tenant-isolation family

## Independent scope

This is a **new, separate verification family** for `POST /api/workforce-planning/scenarios`, a method currently marked **GAP** in the canonical tenant-isolation coverage manifest. It is distinct from the shared tenant-table WFM row suite, the Careers public GET proof, the billing/subscription and year-end evidence, performance HR, document-ID protections, and payroll/tax work.

The following WPS-01 files are new and isolated:

- `scripts/qa/tenant-wps01-scenarios-contract.mjs` — pure localhost/PG16 refusal, HTTP proof and non-mutation assertions.
- `scripts/qa/tenant-wps01-scenarios-http.mjs` — new real HTTP and persisted PostgreSQL 16 proof.
- `tests/tenant-wps01-scenarios-contract.test.mjs` — strict negative environment controls, source SHA pin, coverage GAP preservation and proof-anchor review.
- `.github/workflows/tenant-wps01-scenarios-http.yml` — separate, path-scoped, source-controlled GitHub Actions job with its own PostgreSQL service and dependency graph.

This does **not** modify existing QA receipts, shared runners, application routes, migrations, payroll calculations, dashboards, flags, payment/filing integrations or the canonical coverage manifest.

## What the independent exact-head run must prove

1. Refuse any non-GitHub, non-CI, remote, non-empty or non-PostgreSQL-16 target. Disable all external provider credentials, payout/billing flags and workers. Use a production-mode Next.js server **only** on `127.0.0.1:3000` and the disposable `app_db`.
2. Insert three actual fictional employers with independent owner sessions. Require that the victim's organization, user, unit, worker and linked-plan IDs exceed both attacker's IDs; no invented victim-only object IDs are accepted as successful proof.
3. Create genuine employer-owned planning scenarios through HTTP, verify each is persisted under the authenticated employer, references the employer's real plan, has an immutable draft version and a matching atomic audit receipt, and leaves other employers' records untouched.
4. Verify with **both** attackers that submitting the victim's real `organizationId` is rejected, the victim's real higher-ID `planId` and a nonexistent `planId` produce indistinguishable 404s, and the victim's real `scopeOrgUnitId` and a missing unit produce indistinguishable 403s. Every refused request must leave scenario, audit, membership, payroll, employee and planning records unchanged.
5. Verify each attacker's actual own-unit scoped scenario creation succeeds and saves the correct scope; repeated scenario names create immutable version 2 rows without overwriting version 1.
6. Revoke one attacker's actual employer membership and prove the old session cannot submit a scenario. Assert that the victim's scenario exists at a genuine higher ID than both initial attacker-owned scenarios.
7. Prove exactly **seven** positive HTTP writes and **twelve** refused HTTP attempts, never substituting a source-only grep or mocked successful response for a real PostgreSQL state change.

The executor prints a non-sensitive `WPS01_REAL_HTTP` receipt with counts and the explicit designation `newCoverageCredits: 0`. A failed assertion fails the job.

## Non-goals, release boundary and review

**No new method coverage is claimed.** `POST workforce-planning/scenarios` remains `GAP`; the existing GET/PATCH receipts and route blobs are unchanged. A passing dedicated runner is *candidate evidence only*, not an authorization for production feature activation, financial actions, production schemas, or tenant-wide acceptance.

Before reconsidering the GAP, independent reviewers must inspect the real exact-head workflow result, SQL state and audit integrity, absence of foreign leakage, revoked-grant behavior, source SHA changes, and any remaining race conditions (including concurrent scenario-version writes and injected audit-failure rollback, which the existing shared WFM row exercise covers separately). No merge to `main` should occur on this test's strength alone without normal code review and repository policy checks.

**Safety:** the only database used is a fresh fictional GitHub Actions PostgreSQL 16 service. The runner never touches a real employer, payroll run, production database, bank account, webhook provider or cash movement system.
