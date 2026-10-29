# Nonce CSP verification evidence, PR #1388 follow-up

**Production decision: NO-GO. Keep `NEXT_CSP_ENABLED` OFF.** A completed exact-head local CI run now provides **PASS for all five scoped verification checks**, but it does **not** certify production traffic, third-party integrations, real devices, or hosting cost.

## Verified exact-commit evidence, October 29, 2026

- **Original implementation:** [PR #1388](https://github.com/erwinmehehe/payrollph/pull/1388), already merged, introduced the opt-in nonce CSP, preserved the flag-OFF static policy, and explicitly deferred browser, nonce matching, errors, SEO and hosting proof.
- **Verification PR:** [#1587](https://github.com/erwinmehehe/payrollph/pull/1587), merged as a verification-only change. This follow-up updates the documentation, **not** the CSP implementation or flag.
- **Successful executed run:** [Nonce CSP served Chromium and SEO evidence, run 40849978543](https://github.com/erwinmehehe/payrollph/actions/runs/40849978543), **completed success**, 2026-10-29 10:24 UTC, for exact tested commit `21c48fe417ad9dd789081f50bfc03e84ce4a6ba9`.
- **Raw proof artifact:** `csp-nonce-verification-21c48fe417ad9dd789081f50bfc03e84ce4a6ba9`; artifact ID `12890330739`; archive SHA-256 `6311ad06c10cbe3975045368fdfaf50d8771c507774a0a77456c7c0015ba3d50`. Download from the successful Actions run **before artifact expiration on November 12, 2026**.
- **Superseded attempt:** [40842039109](https://github.com/erwinmehehe/payrollph/actions/runs/40842039109) was **cancelled** and had no artifact. Its cancellation must not be mistaken for the outcome of the later, successful exact-head run.

The successful workflow checked out the exact commit, executed `git fetch origin main`, and recorded the then-current `origin/main=5a3c209dffb2198e8944d0781025c42b117024b0` in `git-fetch-main.log`. Its isolated runner used Ubuntu, local PostgreSQL 16 `app_db`, a **fictional HCM employer fixture**, pinned headless Chromium, and **two independent Next.js production builds** with `NEXT_CSP_ENABLED=false` and `NEXT_CSP_ENABLED=true` respectively at **both build and serve time**. No deployment, real employer data, production database or money flow was accessed.

## Required acceptance results

| Requirement | Executed result | Evidence in run 40849978543 |
| --- | --- | --- |
| 1. Real browser, login, Payroll and HCM hydration | **PASS, local scope** | Six real Chromium pages returned HTTP 200 in both builds: marketing, login, public HCM, authenticated Payroll workspace, HCM People Home/command center and action center. Actual console errors, page errors and `securitypolicyviolation` event counts were **0** for all 12 page checks. Harness also exercised the React login password visibility button, Payroll tab navigation, and HCM navigation. See `off/raw-evidence.json`, `on/raw-evidence.json` and PNG screenshots. |
| 2. CSP header nonce equals rendered executable script nonces | **PASS, local scope** | `htmlCheck: true` in both harness runs. Two independent served HTML responses per route were compared; the ON build required matching header/script nonces and a fresh nonce per response without production `script-src` `unsafe-inline` or `unsafe-eval`. See raw JSON header values, script counts and nonce comparisons. |
| 3. 404 and 500/error boundary CSP | **PASS, tested server errors** | Real HTTP **404/404** on a missing route and **500/500** on an intentionally thrown temporary SSR error route, both with the expected CSP and nonce check. The 500 fixture existed **only in the disposable CI checkout**; it was never committed or deployed. See raw HTTP evidence and server logs. |
| 4. SEO, HTML and TTFB OFF versus ON | **PASS for measurement and metadata parity; further performance review required** | Seven GET requests per route per mode after one warmup, median timing to response headers, raw HTML bytes and SHA-256, HTTP status, SEO title, description, canonical and H1. Reported SEO fields were identical between modes on tested pages. See measured table below and `off/on/raw-evidence.json`. |
| 5. Hosting-load review | **PASS for build evidence and scenario estimate; NOT scale-tested** | Prerendered route counts changed from **139 OFF to 14 ON** (125 fewer). Two build logs/manifests, local timings, and scenario math support a material potential increase in server rendering. They do **not** demonstrate production-scale capacity or actual billing cost. |

### Observed local TTFB and HTML size

Milliseconds are median **response-header arrival times** from a local loopback Node fetch, not real-user Core Web Vitals or Lighthouse TTFB. Each mode was an independent production build on the same runner; its seven requests followed one warmup. A positive delta means the nonce-mode response was slower in these observations.

| Route | HTTP OFF/ON | TTFB OFF | TTFB ON | Change | HTML bytes OFF | HTML bytes ON | SEO fields match |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `/` | 200 / 200 | 14.95 ms | 15.41 ms | **+0.46 ms** | 87,781 | 90,091 | Yes |
| `/login` | 200 / 200 | 5.97 ms | 7.45 ms | **+1.48 ms** | 33,144 | 35,039 | Yes |
| `/hcm` | 200 / 200 | 2.77 ms | 8.91 ms | **+6.14 ms** | 60,085 | 61,938 | Yes |
| `/__csp_qa_not_found` | 404 / 404 | 1.91 ms | 4.73 ms | **+2.82 ms** | 12,439 | 13,941 | Yes |
| `/csp-qa-expected-500` | 500 / 500 | 5.75 ms | 7.01 ms | **+1.26 ms** | 10,072 | 11,370 | Yes |

**Interpretation:** This single-run local timing suggests no functional/hydration regression on these pages but shows some latency cost, especially for `/hcm`. Do not project the millisecond differences to customers: sequential runs, warmed caches, host CPU, DB performance and network geography all affect measurements. Raw per-request samples and response/HTML hashes are provided in the artifact.

### Hosting and caching impact

The prerendered route inventory decreased from **139 to 14**, a drop of **125 routes (about 90% of the OFF inventory)**. This is a build-classification change, **not** evidence that 125 routes receive real traffic or that server CPU rose by 90%. Some pages were already dynamically rendered when CSP was OFF.

For *additional* HTML requests that would previously be served from a static/ISR cache, an **illustrative, unmeasured** 100 ms of CPU per new SSR render yields:

| Extra HTML requests/sec | Extra HTML renders/day | Illustrative continuous CPU at 100 ms/request |
| ---: | ---: | ---: |
| 10 | 864,000 | 1 vCPU |
| 100 | 8,640,000 | 10 vCPU |
| 500 | 43,200,000 | 50 vCPU |

This is scenario math only, **not production load testing**, observed compute usage, or a cost quote. A real rollout requires measured production-like cache hit rate, incremental render CPU, peak concurrency, response p95/p99, origin request volume and cost against the owner's budgets. Route-specific CDN behavior must be measured on the proposed hosting configuration.

## Reproducible raw evidence index

The run's uploaded artifact contains:

- `off/raw-evidence.json`, `on/raw-evidence.json`: actual HTTP response headers/CSP, per-response script nonce matching, raw browser errors/CSP violation events, authentication, script counts, timestamps, HTML hash/size, all measured samples and per-page PASS/FAIL.
- `off/*.png`, `on/*.png`: actual headless Chromium screenshots of public pages and fictional authenticated payroll/HCM pages.
- `off/build.log`, `on/build.log`, `off/build-routes.json`, `on/build-routes.json`: build behavior and prerendered-route inventory.
- `off/server.log`, `on/server.log`: production-mode localhost server output and expected synthetic error route.
- `off/harness.log`, `on/harness.log`, `comparison.json`, `verification-report.md`, `summary.log` and `git-fetch-main.log`: actual executable evidence and comparison output.

**Verification sources:** [workflow](../../.github/workflows/nonce-csp-verification.yml), [Chromium/HTTP collector](../../scripts/qa/csp-nonce-browser-verification.mjs), [summary generator](../../scripts/qa/csp-nonce-evidence-summary.mjs). The one-off fixture page for HTTP 500 exists only in CI, not in this repository's runtime routes.

## Remaining gates and owner recommendation

**NO-GO for production enablement.** The five scoped verification items passed on a synthetic localhost runner, but PR #1388's rollout acceptance also calls for further hosted/browser compatibility and approval. Complete these before any separate production flag change:

1. **Independent review of the exact raw artifact** and the nonce/HTML invariants, especially error responses, redirected/authenticated requests and first-load/client transitions.
2. **Production-like hosted staging** with real CDN behavior, representative marketing SEO/Lighthouse checks, cache-hit ratio and peak-hour SSR latency/memory/cost measurement. A single runner's TTFB medians do not clear this gate.
3. **Third-party script, font, analytics, login/form and mobile browser compatibility** on actual staging integrations, including at least physical iOS/Android browser checks.
4. **Owner, Security and Web/SEO signoff**, rollback through a distinct flag-OFF build (not only toggling an environment variable at runtime), and documented cost/security thresholds.

`NEXT_CSP_ENABLED` stays **OFF**. This documentation records already-run evidence; it does not change `src/proxy.ts`, `next.config.ts`, `src/app/layout.tsx`, feature defaults, CI security settings, production hosting, bank/payroll logic, or any user data. The project remains subject to all independent privacy/launch gates.

## Historical authoring-container limitation

Before #1587 was opened, the authoring container tried `git fetch origin main` and got `Could not resolve host: github.com` (exit 128). The verification branch was instead created from the then-current confirmed `main` SHA `790e5de49523e31807495e1495dcd3483588d4ce` using the connected GitHub API. The subsequent **successful GitHub Actions run did execute** `git fetch origin main`. These are distinct environments; do not call the earlier failed local fetch a success.
