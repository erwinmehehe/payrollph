# Performance & HR: unit-scope and revoked-manager tenant isolation

**Draft / NOT ACCEPTED.** This is an independent, zero-credit security-regression family for two performance-management POST methods. Existing supplemental proofs already exercise the ordinary company-owner cases for feedback and development plans; this batch does **not** promote or recertify their provisional method statuses.

## Exact surface and four actions

| Method | Independently exercised actions |
| --- | --- |
| POST /api/performance/continuous | one_on_one; feedback (including manager-private, goal-linked feedback) |
| POST /api/performance/development-plans | plan (two persisted completed low-scoring review cycles); milestone (linked to newly created owned plan) |

The runner creates **two independent signed-in, unit-scoped managers** in fictional employers A and B, plus a third genuinely persisted higher-ID victim employer. Each employer has its own active unit, an unrelated second unit and real peer worker, a verified HR skill, two completed review cycles, linked review items, goal references, and a persisted peer-unit development plan.

For every action and manager, the dedicated PostgreSQL 16 / real localhost HTTP job requires:

- Genuine **201** with exact returned and persisted employer/worker/plan row, expected audit or plan event.
- Foreign employer selector denied **403**. A real higher-ID foreign employee/plan/skill under the caller's own employer produces **404** (where applicable), matching an absent ID.
- **403** for the same employer's *different organizational unit* worker or plan; company membership does not override unit scope.
- **401** for anonymous POST. Responses and headers must not contain victim markers.
- The same session is refused on all four actions after its active manager membership is revoked, without further HR or payroll mutations.
- Snapshots of all organization-bound performance tables, employees, memberships, skills, employer payroll runs/pay profiles and audit events ensure victim immutability before and after every request.

Contract tests reject fake success, missing persisted rows, non-discriminating proof, victim leaks, wrong 403/404 parity and unsafe targets. The action inventory guard fails if a new POST branch is added without a fixture.

## Separation from parallel payroll and other PRs

**This PR creates only five independent new files:** scripts/qa/tenant-performance-hr-edge-contract.mjs, scripts/qa/tenant-performance-hr-edge-http.mjs, tests/tenant-performance-hr-edge.test.mjs, .github/workflows/tenant-performance-hr-edge-http.yml, and docs/qa/tenant-performance-hr-edge.md.

No existing runtime route, schema, payroll calculation, parallel-payroll workflow, provider integration, release flag, shared tenant manifest, coverage inventory, historical proof, or file from another open PR is modified. The workflow uses only disposable PostgreSQL 16 app_db, localhost 127.0.0.1:3000, synthetic actors and disabled providers/workers. No real employee data, real notifications, salary calculation, tax filing, payouts or deployments.

## Merge gates

- [ ] Dedicated workflow passes at the **exact final head**, including all four actions, two manager positives per action, peer-unit refusals, revoked sessions and unchanged victim SQL/audit.
- [ ] Full CI, typecheck, CodeQL and applicable source/security checks pass.
- [ ] Independent HR, security and privacy review accepts actual behavior and proof.
- [ ] Reconcile concurrent main changes before merge; **zero coverage credits in this PR**.

Source-only tests do not establish HTTP execution, acceptance or production readiness.
