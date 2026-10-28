# Leave Preview POST — stronger tenant and employee boundary proof

**Target:** `POST /api/leave/preview` | Tenant-isolation manifest status: **GAP** | **Zero new credits**.

**Base:** `main@4f305e29a945d8dc48583a88b76b6d057b5bd289`. This builds upon the already-merged **provisional** Leave Preview proof. It does **not** repeat or touch the open HCM, Loans, ESS identifier, API v1 journal, WFM, or legal-entity administration PRs. The new branch alters only the existing dedicated Leave Preview proof, its existing CI/docs, and new separate source contract/tests.

## Exact production route and proof data

The route is a **calculation-only POST**, not a leave submission. It authenticates a real session, reads the selected employer membership, checks the employee belongs to that employer and its authorized unit, and validates an actual leave date/interval before loading the real persisted schedule.

The dedicated **Tenant Leave Preview HTTP** CI job runs a production-mode Next server against a disposable PostgreSQL **16** schema and the approved isolated baseline, with payment providers disabled and no production network target.

The script starts with **zero employer and audit rows**, then creates three distinct real fictional organizations, workers, legal employers and signed-in owners: attacker A, attacker B and a **higher-ID victim**. It inserts one genuinely persisted **shift definition and approved schedule override** for each employee, in increasing ID order, with distinct clock times, breaks, paid minutes and employee markers. A fourth, disjoint employee/schedule belongs to the *same employer as attacker A*. Two independent ESS accounts are created for A's worker and peer, respectively. There is also a separated-worker negative fixture.

All approved shift overrides are directly seeded **synthetic historical source fixtures**; the proof does not simulate independent real schedule approval or publish a roster.

## Required real HTTP scenarios

| Case | Expected evidence |
| --- | --- |
| A and B owners preview their real employees | **200**, exact own persisted worker name/no, real schedule override ID, shift definition ID/code/name, clock times, break duration, wall minutes and calculated paid minutes |
| Victim owner previews the real higher-ID victim | **200**, only victim data; establishes a genuine victim source exists |
| A's actual successful response is supplied to B's proof, and vice versa | **Rejected**; a generic/empty or swapped owner response cannot pass |
| A/B owner submits victim organization ID and actual victim worker ID | **403**, no victim schedule or marker |
| A/B owner submits its own employer and the victim or other attacker's real worker ID | **404**, no cross-tenant schedule |
| B owner submits A's same-employer peer ID within B's own organization | **404** |
| A's owner previews A's peer worker | **200**; distinct legitimate admin case |
| A employee session submits the peer or victim employeeId while naming A's organization | **200 for A's own employee and shift only**; the forged ID is ignored by the route |
| Peer employee session submits A's worker ID | **200 for the peer only** |
| Either ESS employee tries victim organization and victim worker | **403**, no victim source |
| Missing session or cross-site mutation | **401** or **403**, respectively |
| Empty, impossible-calendar, or backward timed intervals | **400**, no source mutation |
| Owner previews a genuinely separated worker | **409**, no ordinary new-leave eligibility |

The proof compares all three employers' actual PostgreSQL **employee, shift-definition, schedule-override, leave-request, leave-balance, employee pay-profile, payroll-run and audit** records from before the requests to after the requests. It also compares the shared richer victim organization/employee/unit/legal-entity/audit/recovery snapshot. **Every table must remain unchanged**: a leave preview cannot create a leave request, deduction, pay change or release. No sensitive marker may appear in denied responses.

## New and changed artifacts

- `scripts/qa/tenant-leave-preview-contract.mjs` — local-target guard, exact shift/paid-minute/employee-identity assertions and denial/immutability checks.
- `scripts/qa/tenant-leave-preview-http.mjs` — replaces the weaker owner-only proof with real cross-employer, same-employer employee spoof and immutable schedule/financial evidence.
- `tests/tenant-leave-preview-contract.test.mjs` — eight focused source tests, negative response mutation and swapped evidence.
- `.github/workflows/tenant-leave-preview-http.yml` — executes all source tests and node syntax checks at the exact PR head before the existing real PG16 production-mode HTTP test.
- This document — remains uncredited and clearly distinguishes directly seeded approved override fixtures from workflow approvals.

## Acceptance conditions

The prior exact-head CI run `40513383154` reached the real HTTP test but failed
before preview assertions: the shared victim snapshot queries the SQL-only
`hcm_work_item_events` table, which `db:push` does not create. The workflow now
runs the existing guarded, checksum-pinned 0104 fixture helper after the isolated
baseline and before build/seeding. A regression test checks this ordering and
the helper's GitHub Actions/empty-employer/empty-audit restrictions. No snapshot
is skipped, no application guard is changed, and no production SQL is run.
Fresh exact-head PG16 HTTP CI is still required; the failed run is not a proof pass.

- [ ] Exact-head `node --check` on both scripts/test and `node --test` on both the old guard and eight new adversarial contract tests; do not assume pass without a CI receipt.
- [ ] Existing **Leave preview tenant HTTP** workflow executes against real local PostgreSQL 16 and Next, with all scheduled own/foreign/forged source assertions.
- [ ] Full CI, CodeQL, security smoke, GAP batch factory and independent security review accept the **exact head** evidence.
- [ ] No changed payroll source, money movement, employee status, real leave decision or production API accepted from this PR.
- [ ] Independent coverage reconciliation before any method moves from GAP to COVERED.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO COVERAGE CREDITS.** This is not a certification of real schedule approval, any `POST leave`/`POST leave/conversion` mutation, legal payroll readiness or production launch.
