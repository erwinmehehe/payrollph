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

See the new dedicated contract, test and exact-head workflow:
- scripts/qa/tenant-hcm-org-explorer-page-contract.mjs
- scripts/qa/tenant-hcm-org-explorer-page-http.mjs
- tests/tenant-hcm-org-explorer-page-contract.test.mjs
- .github/workflows/tenant-hcm-org-explorer-page-qa.yml

## Not included / review holds

- **ZERO credits**: this PR does not change the tenant isolation coverage
  manifest, page/action GAP status, API method status, route implementation or
  acceptance ledger. A passing job remains engineering evidence only.
- The page is a client-rendered graph shell. **This runner does not prove
  hydrated Chromium interactions**, rapid employer switching or selection
  of a position by a browser user. These need a separate browser acceptance.
- Graph/history API duplicate query parameters currently use first-value
  parsing. This runner does **not** accept duplicate API-selector normalization
  as secure or complete; a separately reviewed source fix and exact-source
  API reproving is required before page promotion.
- No cross-employer access from users legitimately authorized to *both*
  employers is adjudicated by this proof; those users must be reviewed
  against the intended multi-employer access policy.
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
