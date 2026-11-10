# PII-02 — employee schedule receipts SSR tenant-boundary candidate

**Status: DRAFT, UNACCEPTED, ZERO new API or page/action credits.**

## Disjoint from open PRs

This is the employee self-service receipt **page** `/self/schedule-receipts`,
in the PII-02 workforce/self-service surface. It is separate from the open
payroll-tax page (#1882), People/engagement privacy (#1880), and HR work-queue
(#1875) changes. The shared tenant coverage manifest and source guard are
necessarily updated to record the new proof, which may require a rebase if one
of those drafts merges first. Runtime page code is disjoint.

## Page boundary change

The old page accepted any active membership for a session with the global
`employee` role. That can mount the receipt component even when the
per-organization membership is no longer an `employee` membership; the
unchanged receipt API already rejects that mismatch in its
transaction-scoped `assertBoundIdentity` check.

The page now requires, in order:

- Feature-on status and a signed-in employee with a safe persisted employee ID.
- No caller-supplied employer, employee, user, unit or work-date selector.
- Exactly the employee record assigned by the authenticated user, with
  `status = Active`.
- An active `employee`-role membership for that employee's organization,
  plus the existing organization session-policy check.
- The already-required exact employer pilot allowlist.

Only then may the private client component mount. The successful server HTML
carries the *authorized own-employer ID* as a testable binding. Forged,
wrong-role, inactive and revoked requests return 404 without mounting
the component. Unauthorized people are never redirected into a different
employer as a fallback. No API endpoints or receipt-write logic are changed.

## Independent disposable HTTP evidence

`.github/workflows/tenant-self-schedule-page-http.yml` checks out the exact
PR head and runs against a new empty local PostgreSQL 16 database and local
production-mode Next app. It reuses the **existing** fail-closed fictional
schedule receipt environment guard; no provider credentials, payout flags,
workforce scheduler, Neon, real accounts or production host are accepted.

`scripts/qa/tenant-self-schedule-page-http.mjs` creates independently
authenticated Alpha, Beta and last-seeded higher-ID victim employee sessions.
It asserts actual feature-on SSR 200 for each legitimate employee; denial
for forged employer/employee/user/unit selectors, duplicate selectors, owner
role, employee-global-role with wrong organization membership role,
cross-linked victim worker with only attacker membership, an inactive
employee, and a membership revoked while the same session retains a
separate active employer membership. It compares protected employee,
membership, payroll and audit snapshots before and after every denied read.

The page proof is **GET-only**: it does not acknowledge a schedule, submit
a form, initiate payroll or contact providers. Existing separately
source-pinned `GET/POST /api/self/schedule-receipts` receipts from #1520
remain unchanged and cannot be counted again. The central coverage guard
now verifies exact page, test, workflow, source-line and existing API hashes.
The PII-02 page stays `GAP` and `testedBy` is unset. The 498-method / 21-page
ledger and its totals do not change.

## Hold conditions

The new workflow must pass on the final proposed commit along with all
repository security and build checks; independent security/privacy/workforce
review and browser/action acceptance remain outstanding. No merge,
deployment, production rollout, paid operation, employee account mutation
outside fictional CI, payroll, attendance or notification is authorized
by this candidate.
