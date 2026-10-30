# Hosted CSP nonce staging: cache, SEO and TTFB verification

**Current decision: NO-GO for production activation.** This PR creates a protected,
read-only **measurement harness**, not a hosted pass certificate and not a
deployment. `NEXT_CSP_ENABLED` remains **OFF** by default and in production.

## What is already verified

- [PR #1388](https://github.com/erwinmehehe/payrollph/pull/1388) implemented
  the opt-in Next.js nonce script CSP. Do not rebuild that implementation.
- [Local verification run 40849978543](https://github.com/erwinmehehe/payrollph/actions/runs/40849978543)
  passed real headless Chromium hydration, HTML header/script matching, 404/500
  CSP and local timing/SEO checks on fictional PG16.
- The OFF build prerendered **139** routes versus **14** with nonce mode ON.
  This is a reason to **measure real CDN/SSR impact**, not evidence of 90%
  higher CPU usage or any observed production billing increase.
- [The committed source-level report](csp-nonce-verification.md) records the
  previous passing evidence and its limitations.

## Hosted execution status

| Gate | Status | Why |
| --- | --- | --- |
| Identical code on two immutable hosted preview deployments | **UNVERIFIED** | No authorized OFF/ON hosted deployment pair has been attested |
| Production isolation and no private employer data | **CONFIGURED TO FAIL CLOSED** | Mandatory immutable-preview check, existing Preview/Production env-target audit, and separate live read-only synthetic DB marker attestation; no hosted proof yet |
| Repeated hosted nonces and CDN cache safety | **UNVERIFIED** | The protected manual workflow must execute |
| Public login hydration and browser CSP violations | **UNVERIFIED** | The protected manual workflow must execute |
| HTML metadata, TTFB p50/p95 and CDN cache comparison | **UNVERIFIED** | No valid hosted samples have been captured |
| Peak-hour SSR load, memory, CDN hit rate and actual Vercel cost | **NOT TESTED** | Deliberately out of scope for this bounded benchmark |

**Available deployment access at authoring:** the connected Vercel account could
identify the fictional project `payrollph-fictional-demo-qa` but returned
**403 Forbidden** when listing its deployments. The same project's direct
metadata lookup did not succeed. It would be incorrect to claim a hosted
benchmark ran or that its project credentials/preview URLs are available.

## Strictly authorized target

This harness allows ONLY the separately listed fictional QA Vercel project:

- Project: `payrollph-fictional-demo-qa`
- Project ID: `prj_fj1ezuD5LqXYRe9X2Lc9fwCHecpu`
- Team ID: `team_5oyNk06BhdkUCcPJLzHPRpvK`
- Forbidden production project:
  `prj_DCCuaGyRvRNJ7hOybLLdJq0jdGhh`
- Forbidden production origin: `https://erwinmehehe-payrollph.vercel.app`

Both **OFF and ON** origins must be **distinct immutable Vercel deployment
hostnames**, not aliases, with separate `dpl_...` identities. The **read-only**
Vercel deployment API must confirm both are `READY`, target `preview`,
belong to the fictional QA project, and have **the exact same 40-character Git
SHA as the dispatched reviewed `main` commit**. Unverifiable metadata,
redirects, protected login pages, stale commits, reused origins, or API
permission errors fail closed **before** sending application HTTP requests.

The separate QA project must use only synthetic data and independent,
nonproduction resources. The protected manual workflow reuses the existing
[`auditPreviewIsolationMetadata`](../../scripts/verify-preview-isolation.mjs)
to reject missing Preview-only credentials or any environment-variable
assignment shared between Preview and Production. It then **queries only**
`current_setting('payrollph.environment', true)`, `current_database()` and
`transaction_read_only` through the existing
[`verifyStagingDatabase`](../../scripts/verify-hcm-staging-isolation.mjs)
with a separately configured **read-only** staging database credential. This
second proof requires an explicit synthetic DB marker and a distinct
production-DB URL fingerprint; it never scans employee or payroll tables.

**Limit:** project-level env target metadata and one read-only DB connection
do not independently certify every historical deployment override. The
operator must also independently confirm that **both immutable preview
builds** use the attested synthetic backend. The repository's separate
[`preview isolation guard`](../../.github/workflows/preview-isolation-guard.yml)
remains active; no deployment hold is relaxed by this PR.

## Provisioning and protected manual run

**No Vercel deployments are created by this PR or its workflow.**
An authorized staging operator must separately provision and confirm the two
preview builds with `NEXT_CSP_ENABLED=false` and `true` respectively at
**both build AND runtime**, from identical source code and nonproduction
resources. Do not alter the main production Vercel project, production
environment variables, Git auto-deployment settings or `vercel.json`.
Repository `vercel.json` intentionally disables automatic `staging` and
`preview` deploys; it remains unchanged.

After a reviewed merge to `main`, configure GitHub's environment
`csp-hosted-staging` with required reviewers and these protected variables:

| Environment variable | Required content |
| --- | --- |
| `CSP_STAGE_PROJECT_ID` | The exact fictional QA project ID above |
| `CSP_STAGE_TEAM_ID` | The exact team ID above |
| `CSP_STAGE_SOURCE_SHA` | The 40-character SHA of the main commit to dispatch, matching both preview deployments |
| `CSP_STAGE_OFF_URL` | HTTPS immutable `.vercel.app` origin of the approved OFF deployment |
| `CSP_STAGE_ON_URL` | HTTPS immutable `.vercel.app` origin of the approved ON deployment |
| `CSP_STAGE_OFF_DEPLOYMENT_ID` | OFF deployment's Vercel `dpl_...` ID |
| `CSP_STAGE_ON_DEPLOYMENT_ID` | ON deployment's distinct Vercel `dpl_...` ID |
| `CSP_STAGE_DB_MARKER` | The explicitly configured, nonproduction marker returned by the synthetic DB's `payrollph.environment` setting |

And these protected secrets (never paste into code, PRs, reports or artifacts):

- `CSP_STAGE_READ_TOKEN`: least-privilege Vercel **metadata read** token
  able to `GET /v13/deployments/{id}` for the QA project. It is **only**
  exposed to the attestation step and never to Playwright.
- `CSP_STAGE_READONLY_DATABASE_URL`: independent synthetic-only PostgreSQL
  **read-only** login. The workflow makes only three metadata reads using the
  existing HCM staging attestation. The DB must return the expected marker.
- `CSP_STAGE_PRODUCTION_DATABASE_URL_SHA256`: independently supplied SHA-256
  fingerprint of the production URL for comparison **without using a
  production DB connection**. A different credential string alone is not
  definitive proof of separate physical data; review host, database and
  isolation out of band.
- `CSP_STAGE_BYPASS_SECRET` (optional): separate Vercel preview protection
  automation bypass token. The benchmark forwards it **only to the exact
  attested deployment origins**, never third-party hosts. If the preview does
  not need it, leave it unset.

Then manually dispatch
[`CSP hosted staging cache and TTFB verification (NO DEPLOY)`](../../.github/workflows/csp-hosted-staging-benchmark.yml)
on the reviewed **`main` branch**. Pull requests only run offline contract
tests, with **no secrets and no external application traffic**.

No automatic live benchmark, preview deployment, production
`NEXT_CSP_ENABLED` switch, database **writes**, payroll row reads/actions
or payment requests are part of this workflow. The mandatory metadata-only
read-only staging DB query is not a customer-data or production database test.

## Measurements and raw evidence on a successful hosted execution

The actual runner
[`scripts/qa/csp-hosted-stage-run.mjs`](../../scripts/qa/csp-hosted-stage-run.mjs)
performs **20 requests per mode and route, after two warmups**, alternates the
OFF/ON order, and uses only a single request at a time. Five paths:
`/`, `/hris`, `/pricing`, `/hcm`, `/login`.
Maximum main-document request budget: **220 GETs** across both previews,
plus normal public-page Chromium GET asset requests.

It records and compares:

- HTTP status 200, exact CSP `script-src`, per-response nonce and matching
  executable script attributes, rejecting reused nonces.
- `Cache-Control`, `Age`, `x-vercel-cache`, `x-nextjs-cache`, `Vary`
  and HTML bytes/SHA256. Nonce mode must be `private, no-store` and may
  **never** be a CDN `HIT`, `STALE` or `REVALIDATED`. Cache-hit counts
  on OFF pages are observed, not guaranteed, because some pages are
  already dynamic with CSP OFF.
- Local-to-staging `fetch` response-header TTFB and total time, with p50,
  p95 and absolute OFF→ON differences for each route. No randomized regional
  clients, origin CPU data, cold-start simulation or peak-hour scale load.
- Title, description, canonical URL, robots metadata and H1 parity; altered
  raw HTML hashes alone are not SEO failures because nonce values change.
- Real headless Chromium on the five public pages for both modes, actual
  CSP violation events and JS/page errors, screenshots, and React password
  visibility clicks to confirm login hydration. **No login is submitted.**
  Browser network requests other than GET/HEAD are explicitly blocked;
  a detected non-read request causes a fail-closed result.

The uploaded **14-day** GitHub Actions artifact contains
`qa-artifacts/csp-hosted-stage/attestation.json`,
`db-readonly-attestation.json`, `result.json`,
`report.md`, public-page screenshots and a source-SHA record. It does
**not** include full HTML, cookies, auth state, external credentials,
bypass secrets, customer records or private payroll.

If preflight fails, the artifact instead records an
`attestation-blocked.json` explanation and **NO HOSTED PROOF**.

## Hard limits and owner GO/NO-GO

| Review area | Technical status after successful manual benchmark | Production requirement |
| --- | --- | --- |
| Exact hosted preview identity and nonce/HTML correctness | Can pass or fail based on raw artifacts | Independent reviewer must inspect both deployment metadata records, sanitized Preview env targets, the read-only synthetic DB proof, matching nonces and cache values |
| Public-page hydration and SEO parity | Can pass or fail for the tested pages | Review third-party integrations, actual forms and physical iOS/Android browser coverage |
| Hosted TTFB/cache observations | Measured p50/p95 and cache state, **not a perf-budget approval** | Owners must define acceptable p95 latency and regression thresholds by route |
| Production-scale memory/CPU/hosting cost | **NOT TESTED** | Separate approved realistic synthetic-load rehearsal, real cache-hit rates, region/edge p95/p99 and cost budget |
| Authorization, HCM and payroll isolation | **NOT TESTED by this read-only benchmark** | Preserve all independent privacy, release and payroll gates |

**Owner recommendation stays NO-GO** until hosted results actually exist,
traffic/caching/cost are reviewed, independent Security/Web/SEO approval is
recorded, and a separate build-time feature-flag enablement/rollback plan is
authorized. Any technical **PASS** in this benchmark expressly means
*staging-only checks passed*, never permission to activate production CSP.
