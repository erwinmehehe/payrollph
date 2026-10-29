# Tenant-isolated default benefit catalogue PUT

**State: DRAFT / UNREVIEWED / ZERO COVERAGE CREDITS**

## Exact boundary

The legacy `PUT /api/benefits` let any currently authorized company-wide workspace administrator initialize five `benefit_plans` rows with `organization_id = NULL`, and checked whether **any** benefit plan existed across **all employers** before deciding if bootstrap should run. This meant a tenant-scoped actor could initialize shared global data and a plan belonging only to another tenant could suppress the current employer's catalogue bootstrap. This is a source-level cross-employer ownership concern; it is **not** a demonstrated live exploit.

## Proposed fix

- Accept only canonical positive Postgres-int employer IDs, as numeric JSON or unsigned decimal strings; reject booleans, lists, objects, exponent/hex text, whitespace, negatives, zero, and overflow.
- Retain preexisting same-origin, authenticated organization administrator permission and company-wide access checks.
- In a single PostgreSQL transaction, lock the actor's **active membership for the exact employer** with `FOR SHARE`, requiring an allowed administrator role and company-wide scope. A membership revoked before the lock is denied.
- Take an employer-keyed advisory transaction lock before checking or seeding. Two simultaneous first-time PUTs cannot duplicate defaults.
- Consider only plans belonging to the authenticated employer or legacy global templates. Plans belonging to another employer never change the current employer's seed outcome.
- Insert the **same five existing default benefit plans** with the exact requesting `organizationId` instead of `NULL`; write a same-employer actor audit in that transaction.
- Preserve legacy `organization_id = NULL` plans as **read-only shared templates**. Existing authenticated GET, POST enrollment and DELETE enrollment bodies remain byte-identical and keep their separate preexisting provisional method proofs.

The old original route blob is `679de68b5e7aac870a534eee8dd2376c18db2873`. The unchanged GET/POST/DELETE handler-body Git blob is `0b7ff73dd8aa2532d1c333b7b43991286e86d202`. Future drift of the route/helper/contract/runner/workflow reopens strict QA review.

## Executable acceptance candidate

The dedicated new workflow `tenant-benefit-catalog-put.yml` checks out the **exact PR head** and uses disposable PostgreSQL 16 on localhost with provider, billing, worker and payout operations off. The proof refuses external or production database/URL/provider settings **before** database imports. It exercises:

- Independently signed-in fictional employers ATTA, ATTB, and a **populated higher-SQL-ID VICTIM**.
- Real first-time same-employer HTTP PUT 200 with **five actual employer-owned SQL plan rows and one actor-bound audit**.
- Concurrent first-time PUTs for ATTB with exactly one seed, followed by replay without duplicate plans or audit.
- Both attackers' requests naming the actual VICTIM employer yielding 403, with per-employer SQL snapshots for plans, enrolments, memberships, workers, payroll, audit and outbox unchanged for every denial.
- Typed/forged selectors, anonymous requests, a unit-scoped administrator, and a membership revoked while the same account session stays authenticated.
- Populated own GET responses without another employer's private plan IDs or employee markers.
- An isolated fourth employer with a synthetic legacy global template that remains readable and is never altered by PUT.

The candidate tests are **not** an accepted certification. The workflow has not passed at the draft's initial creation; exact-head CI and independent security/coverage-owner review must pass. No new method may be promoted while the PUT is still `GAP`.

## Guardrails

The authoritative tenant ledger stays at **341 COVERED / 10 PUBLIC-BY-DESIGN / 147 GAP** out of 498 methods, with PUT benefits **GAP**, `testedBy: null`, zero credits. No production data, migrations, billing, pay runs, third-party providers, government filing, release-flag activation or deployment changes. Do not merge or deploy based on source review alone. Existing #1554 receipt isolation and other draft PRs are independent, although their shared manifest/source guard changes may need conflict reconciliation before any eventual merge.
