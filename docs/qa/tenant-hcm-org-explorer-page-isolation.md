# Tenant Isolation — HCM Organization Explorer SSR and read APIs

**DRAFT — ZERO credits — NOT ACCEPTED for security, production or tenant-wide isolation.**

## Scope and owner

One previously uncredited page/action GAP:
- src/app/hcm/org-explorer/page.tsx — /hcm/org-explorer?organizationId=...

The browser component requests two existing, independently credited but provisionally
reviewed read-only APIs:
- GET /api/hcm/org-explorer?organizationId=...
- GET /api/hcm/position-history?organizationId=...&positionId=...

This is a page-focused independent proof candidate, not a new API method
credit. It does not overlap the pending Studio or classification PR scopes.

## What the fictional PostgreSQL 16 job checks

1. Start only under a hard-coded local 127.0.0.1 app and an empty, disposable
   app_db PostgreSQL 16 instance; demand exact PR-head checkout, no provider,
   external database or worker credentials, and all money/worker flags OFF.
2. Populate seven distinct filler employers, two independent signed-in company
   owners and a higher-ID victim employer. Every employer has a real HR unit,
   employee, position, assignment and isolated bank/tax markers.
3. For each owner, assert the server-rendered page returns an employer-bound
   navigation shell and the graph/history APIs return **nonempty, persisted,
   employer-specific** unit, position and employee-assignment records.
   Also check a separate company-wide HR user succeeds.
4. Exercise foreign-employer SSR 404, graph/history API 403, forged victim
   position under the attacker's valid employer 404, malformed and duplicate
   SSR selectors, anonymous redirects/401s, bookkeeper and unit HR denial,
   and employer membership revocation with the session still valid.
5. Compare protected PostgreSQL organization, HR, employee, position,
   payroll and audit rows for **all ten employers** before and after GETs;
   only a deliberate fixture membership revocation is permitted.
6. Inspect returned bodies and headers for victim/own private marker leakage,
   reject result-only success and preserve the source Git blob identity of
   the page, both API handlers, scope/plan guards, SQL loader, auth and client.

The follow-up workflow also **attempts actual hydrated Chromium behavior**:
an explicitly dual-granted HR session visits employer A, selects a persisted
position and its worker assignment history, switches to employer B and does
the same, then returns to A. The same browser session must receive HTTP 404
for the unrelated higher-ID victim. Browser navigations recheck all ten
employers' protected business and audit rows for read-only behavior.

See the dedicated proof, browser extension, contract tests and exact-head workflow:
- scripts/qa/tenant-hcm-org-explorer-page-contract.mjs
- scripts/qa/tenant-hcm-org-explorer-page-http.mjs
- scripts/qa/tenant-hcm-org-explorer-browser.mjs
- tests/tenant-hcm-org-explorer-page-contract.test.mjs
- tests/tenant-hcm-org-explorer-browser-contract.test.mjs
- .github/workflows/tenant-hcm-org-explorer-page-qa.yml

## Client-scope regression guard (2026-11-14)

The follow-up adds `tests/tenant-hcm-org-explorer-client-scope.test.mjs` to
the existing exact-PR-head Org Explorer PG16 workflow. This **static source
contract** ensures that:

- The server authenticates and authorizes the explicit employer before
  mounting the client, including rejection of duplicated employer selectors.
- Both client fetches bind the current employer, and position history binds
  the currently selected position. Response validators check those IDs.
- Graph, unit selection, position selection and history remain keyed to
  their current scope; late or aborted responses cannot display prior-employer
  or prior-position data.
- Both requests use no-store reads, abort in-flight work on scope changes,
  and clear stale data when a scoped read fails.

**Evidence limit:** The static regression alone cannot prove user behavior.
The same exact-head workflow now contains a separate **real Chromium
A → B → A / position-history / higher-ID victim denial stage**, pending actual
successful execution. It does not yet prove an in-flight delayed A response
cannot race a within-page navigation, or establish a deployment-specific
privacy acceptance. **ZERO credits**: the Org Explorer page remains
**GAP / NOT ACCEPTED** pending passing exact-head CI, review of real browser
evidence, any remaining stale-response race proof and independent HR/privacy/
security signoff.

## Not included / review holds

- **ZERO credits**: this PR does not change the tenant isolation coverage
  manifest, page/action GAP status, API method status, route implementation or
  acceptance ledger. A passing job remains engineering evidence only.
- The follow-up adds a hydrated Chromium A → B → A and position-click
  candidate on the same fictional PG16 fixture. Its **result is not presumed
  passing** until the exact-head job finishes; within-page delayed-response
  races and independent review remain open.
- Graph/history APIs now reject repeated organizationId/positionId selectors
  instead of choosing a first value. The dedicated real-HTTP runner exercises
  duplicate same/foreign employer and foreign-position requests as HTTP 400.
  Any new handler edits require refreshed exact-head tests before review.
- The explicit operator granted access to A and B is exercised in Chromium
  while the unrelated higher-ID victim stays denied. This does not establish
  every multi-employer grant, switching policy or source-revocation behavior.
- No production employer, HR, tax, bank, payroll, provider, migration, real
  worker process, feature activation, deployment, payouts or money used.
- An independent HR/privacy/security reviewer must check own/foreign,
  forged-selector and SQL immutability evidence, including unit-scoped role
  and private-field handling, before any page/action status change.

## Merge conditions

- [ ] Exact final-head PG16 SSR/HTTP job and negative controls PASS.
- [ ] Full CI, CodeQL and relevant security/isolation guards PASS on that head.
- [ ] Maintainer reviews source SHA pins and independently assesses browser
      and API-selector omissions; page GAP remains until separately closed.
- [ ] No runtime release, production flag enablement or tenant-wide acceptance.

No prior passing job, draft PR or source documentation is sufficient to claim
this page's full tenant isolation or authorize production launch.
