# Worker 360 page: exact employer+employee binding, provisional closure review

**Security review required / PR draft / not production-certified.** This change
closes a narrowly defined missing server-side check in the **server-rendered
`GET /hcm/worker-360` shell**. It does not change the already-COVERED
`GET /api/hcm/worker-360` method, payroll logic, worker writes, document-vault
APIs, employee entitlement policy, or production feature flag.

## Verified background (not a substitute for this PR's tests)

Merged PR [#1884](https://github.com/erwinmehehe/payrollph/pull/1884)
passed its source-pinned, fictional PostgreSQL 16 Worker 360 real HTTP
proof in [GitHub Actions run 42639535495](https://github.com/erwinmehehe/payrollph/actions/runs/42639535495).
CI, CodeQL and security smoke also passed. That earlier evidence proved
own-employer Worker 360 API reads, foreign-employer denial and SSR shells,
but the **SSR page did not select the requested employee from SQL before
rendering**. An otherwise authorized company owner could request a
different employer's worker ID and still receive the page shell.
The downstream API refused its history; the missing SSR binding remained a
recorded **page-level GAP**, not a proven private-data leak.

## Narrow change

The server-rendered page still requires feature flag, login, canonical
explicit employer+employee selectors, employer membership, People role,
company-wide authorization, and the applicable Enterprise plan check.
Only **after** all those checks, a minimal, non-PII query must find
`employees.id = requestedEmployeeId AND employees.organization_id =
requestedOrganizationId`. If no matching real worker exists, the page
returns 404 **before mounting the Worker 360 client or linked vault panel**.

The client remains separate and the actual sensitive source API continues to
authorize and filter all reads independently. No worker names, pay profiles,
private event notes or account information are fetched by this new page check.

## Fresh exact-head proof required

The existing local-only PostgreSQL **16** workflow has been renewed and
pinned to the new page blob. It performs real production-mode localhost
HTTP on three entirely synthetic employers, two independent owner sessions,
real own workers and other own workers, real third-employer higher IDs, and
actual position assignment/history sources.

New specific negative controls include for **each of two owners**:
- Own first and second worker page SSR must be HTTP 200.
- Foreign first and second employer's **real** worker ID under an otherwise
  authorized own organization selector must be HTTP 404.
- A foreign worker selector followed by a duplicate own employee ID must
  fail 404, not choose the second selector.
- A duplicate own and foreign organization ID must fail 404.
- Previously proven foreign organization 404 SSR and 403 API, anonymous,
  manager, bookkeeper, unit-scoped HR, revoked owner, malformed dates,
  historical keyset cursor and fake-success checks stay enforced.
- All requests preserve the SQL snapshots for 13 business source tables
  in all three employers (except deliberate fixture membership revocation).

The submitted manifest entry proposes **`COVERED` for the bounded SSR
page only**, marks the status **provisional** with
`independentSecurityReview: PENDING`, links the new proof and exact page
blob, and updates the page inventory. The existing API method counts remain
unchanged: 498 routes' methods, 450 COVERED and 22 API GAPs. There are now
**16 proposed remaining page/action GAPs** instead of 17.

## Release and review gates

- [ ] Fresh exact-commit Worker 360 PG16 real-HTTP check passes
- [ ] Full CI, CodeQL, security smoke and other final-head checks pass
- [ ] Independent security/HR reviewer validates positive and foreign
      worker proof, auth ordering, source pins, and immutable SQL
- [ ] Maintainer approves the **bounded page-only** ledger change and merges

**This draft is not an independent security approval.** Do not merge or
deploy without acceptance; the Enterprise paywall, document-vault writes,
client-side UI hydration, complete employment history, production access,
and all other GAPs are outside this closure.
