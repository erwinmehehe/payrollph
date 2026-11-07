# WRK-01 — POS demand four-method tenant isolation candidate

## Exact method scope

- GET /api/workforce/demand-observations/loyverse
- POST /api/workforce/demand-observations/loyverse
- GET /api/workforce/demand-observations/square-sandbox
- POST /api/workforce/demand-observations/square-sandbox

No issued-demand, forecasting, staffing, import or outlook credit is duplicated. All four methods were unclaimed in the #1740 closure queue when this branch was started.

## Important dependency

These are **not provider-independent endpoints**. Both GET paths require an employer/worksite-specific configured merchant connection, although they read only local database receipts. Both POST paths call the vendor source. In the live application each source is intentionally pinned to **one merchant employer/worksite**. A cross-tenant positive test cannot simply enable all three employers on one Next process.

The dedicated CI proof therefore restarts a **localhost production-mode Next server** three times, once per fictional employer A, employer B and genuinely higher-ID victim. Each local server receives a **synthetic, one-employer merchant binding**. An explicit NODE_OPTIONS preload intercepts only the exact Loyverse stores/receipts and Square sandbox payments GET calls with fixed synthetic aggregate data. It blocks every other outbound fetch; no real merchant, webhook, API or provider interaction is authorized. The parent fixture has no POS tokens; child tokens are synthetic CI tokens and do not confer provider access.

## SQL and HTTP assertions

The job uses a fresh throwaway PostgreSQL 16 app_db, existing reviewed local schema/bootstrap and three independently authenticated owners (two attackers and the higher-ID victim) plus a fourth excluded employer. No real sessions, payroll money, or workers/scheduler are used.

For each exact GET and POST method, A, B and victim must all achieve their own tenant-bound success. GET must report a **real populated SQL import batch** and the expected bound employer/worksite/provider source. POST dry-run must return real synthetic aggregate data with **no SQL/audit change**, followed by a real HTTP applied POST that persists **24 interval revisions and one import batch** for the actor's exact employer, source and worksite. Source/audit actors and response IDs are checked. The subsequent GET must reflect the real persisted batch.

For both A and B, the exact method must deny real higher-ID victim employer selectors, stolen victim worksites, excluded employers, anonymous requests and invalid input. All denials must preserve snapshots for all four employers, including demand import batches, observations, forecasts/scores, audits, organization memberships, staff, payroll, time punches and schedules. Successful own writes may change only their own aggregate source and audit rows. Cross-employer response swaps must fail the own-source assertion. A strict proof-count ratchet fails the run if any required scenario is missing.

## Gates — **zero new credits in this PR until accepted**

This branch adds an executable evidence **candidate**, not an accepted tenant-isolation finding. The four manifest entries remain GAP and testedBy:null; no manifest/metrics/ledger edits are made in this PR. Record four method credits **only after**:

1. Exact-final-PR-head CI (disposable PostgreSQL 16 + true localhost production handler HTTP) passes without skipped required jobs; check source route/blob identities.
2. The owner verifies each distinct method's successful own path, real foreign denial, unchanged victim/audit, forged-selector rejection, and negative controls. Check all supported POST branches, especially repeat scans, MFA and provider failure handling, before treating method coverage as complete.
3. Source SHA, runner SHA, job/run ID, proof-line pins, method-specific testedBy, frozen-batch metrics and merged ledger are reconciled. On any failure or queued job, stay GAP, zero credits.
4. No overlapping PR method ownership appears, and exact merged-head checks are re-run if main changes.

Sole repository owner may use SOLO_VERIFIED_DEV_RECOVERY after actual review; this is not an independent security certification. The existing global tenant-isolation NO-GO and page/action gaps remain separate.

## Safety, activation and rollback

Synthetic QA, test-only local POS intercept and CI workflow only. **No changes** to route behavior, DB schema, migrations, feature flag defaults, provider libraries, payroll calculations, payment, release, source-credential storage, documentation claims of complete tenant-wide coverage, or external systems. Live merchant consent/source completeness, financial acceptance, production deployment and payroll release remain independently unauthorized.

Rollback: revert this QA-only PR. A CI failure does not grant a route fix or a manifest credit.
