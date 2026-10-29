# Nonce CSP verification evidence, PR #1388 follow-up

**Decision: NOT READY / keep `NEXT_CSP_ENABLED` OFF.**

This is a **verification-only** change from `origin/main`, not a
new CSP implementation, migration or production deployment. It reuses
the `src/proxy.ts`, `src/lib/nonce-csp.ts`, root `connection()` and existing
`tests/nonce-csp.test.ts` from merged PR
[#1388](https://github.com/erwinmehehe/payrollph/pull/1388).
The existing source/unit tests are NOT credited as actual browser or TTFB proof.

## Baseline / source review, completed October 29, 2026

- Original PR #1388 explicitly left served Next.js 16 browser/hydration,
  nonce-to-script matching, error-page headers, caching/SEO/TTFB, and hosting
  capacity as outstanding acceptance gates.
- `src/proxy.ts` generates a per-request nonce for matching non-API HTML
  and forwards the CSP and x-nonce header to rendering and the response.
  The HCM multi-entity embargo and API handling remain independent.
- `next.config.ts` retains the legacy static CSP when the flag is not
  `true`. The root layout uses `connection()` only when it is explicitly
  enabled at build and runtime.
- Local authoring-container command `git fetch origin main` was **attempted**
  but exited 128: `Could not resolve host: github.com`. The GitHub connector
  confirmed the then-current `main` SHA as
  `790e5de49523e31807495e1495dcd3483588d4ce`;
  this verification branch was created from that exact commit SHA. The
  disposable GitHub Actions acceptance job performs a fresh
  `git fetch origin main` and records the actual HEAD, origin/main and
  merge-base values. Do not describe the author's local fetch as successful.

## Required acceptance and exact evidence

These statuses are **unverified until an Actions run produces raw artifacts**.
The workflow fails closed if it cannot complete the two independent
production builds and actual Chromium checks; it does not turn the flag on
outside its disposable localhost runner.

| Gate | Initial status | Required raw evidence |
| --- | --- | --- |
| 1. Real browser and hydration | **UNVERIFIED** | Screenshot PNGs for marketing/login, authenticated payroll workspace and HCM command/action centers. Captured console errors, page errors and `securitypolicyviolation` events. Real React password visibility and Payroll tab clicks. |
| 2. CSP header and HTML script nonce | **UNVERIFIED** | Exact `script-src`, nonce parsed from header, counts of executable scripts whose `nonce` matches, two independent nonces on the same route, strict no-`unsafe-inline`/no-`unsafe-eval` in production-mode ON. |
| 3. 404/500/error pages | **UNVERIFIED** | Actual HTTP 404 for missing route and actual HTTP 500 from a **temporary CI-only SSR error route**, twice per build, with valid CSP. The error route is never committed or deployed. |
| 4. SEO, TTFB and HTML | **UNVERIFIED** | Two independent production builds with flag OFF and ON, seven measured GET samples per page after warmup, HTTP status, response header timing, content length, SHA256 and SEO title/description/canonical/H1. |
| 5. Hosting-load review | **UNVERIFIED** | Both build route/prerender manifests, route classifications, timing differences and scenario-based SSR demand estimate. This is not a production load test. |

### Executable evidence

The verification-only workflow is
[`.github/workflows/nonce-csp-verification.yml`](../../.github/workflows/nonce-csp-verification.yml).

Its real-browser/HTTP collector is
[`scripts/qa/csp-nonce-browser-verification.mjs`](../../scripts/qa/csp-nonce-browser-verification.mjs)
and its comparison/report generator is
[`scripts/qa/csp-nonce-evidence-summary.mjs`](../../scripts/qa/csp-nonce-evidence-summary.mjs).

The **actual evidence report for each run** is generated as
`qa-artifacts/csp-verification/verification-report.md` and uploaded along
with all raw evidence JSON, screenshots, build route manifests, stdout and
server logs in the Actions artifact named
`csp-nonce-verification-<exact-commit-SHA>`. This committed document is the
review gate / evidence index, **not a substitute for a run result**.
After a run, transcribe only observed PASS/FAIL evidence and the run link
before asking the owner to authorize any production change.

### Method / constraints

Both builds use the same GitHub runner and disposable PostgreSQL 16
`app_db`, reusing the repository's fictional
`hcm-people-home-synthetic-fixture.ts`. The flag is explicitly set OFF
at the first **build and runtime**, then ON at the independent second
**build and runtime**. Servers bind only `127.0.0.1:3000` and are
stopped between builds. The workflow does not reference Vercel deployments,
Neon databases, customer payroll data or external payment APIs.

For fairness, TTFB is measured locally to **response headers** in milliseconds
using Node fetch, with 7 samples after 1 warm-up. Results are not
geographically distributed real-user TTFB or Lighthouse Core Web Vitals.
A change in generated HTML SHA256 is expected from nonce replacement; the
SEO title, description, canonical and H1 must be compared independently.
Some marketing routes are already dynamic with the flag OFF.

### Hosting cost estimation, not production-scale load proof

Additional requests that previously hit a static/ISR CDN cache can become
per-request HTML renders under nonce mode. For assumed additional HTML traffic
of 10, 100 and 500 requests/second respectively, the extra daily SSR volume
is approximately 864,000; 8,640,000; and 43,200,000 HTML renders/day.
Using a **hypothetical, unmeasured** 100ms CPU per additional request,
that would occupy roughly 1, 10 or 50 vCPU continuously. These are
scenario calculations, NOT observed usage or billing. Routes already
dynamic cannot be counted again. The actual hosting decision needs
origin cache hit ratios, CPU/SSR time and p95/p99 latency by route from a
production-like environment.

### Owner recommendation and limits

**Remain OFF.** Only after exact-commit build parity, actual browser/hydration,
404/500 nonce behavior, marketing SEO/TTFB, third-party/physical-device
compatibility and hosting cost are reviewed should the owner and security lead
consider a **separate** approved production rollout. A CI PASS is not itself
permission to flip the flag.

No changed application CSP default, no production flag, no security-policy
weakening, no new runtime route in the submitted PR, no money actions,
no real personal data. Verification scope does not certify all app routes or
physical mobile devices.
