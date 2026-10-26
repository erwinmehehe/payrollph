# Current Manager Direct Reports — source-only read-only pilot (#725)

**State: proposed branch; default OFF. Not approved for live employer activation.**
This is a **separate manager-only feature** from the existing `/hcm/my-team`
authorized-unit directory. The latter's personnel listing and request counts
are **not** proof of manager/direct-report relationships.

## What the source uses

- `user_organizations.worker_employee_id`, on the **active** manager's
  membership for the explicitly selected employer. The worker record must
  itself belong to that employer and the manager's active assigned unit.
  No name/email matching, `users.employee_id` fallback, or company-wide
  manager fallback is permitted.
- Current effective-dated **primary** `position_assignments`, joined to
  `positions` and `employees` with explicit employer predicates.
- Current `positions.manager_employee_id` matches the actual linked manager.
  This pointer is a **current snapshot**, NOT evidence of historical
  reporting relationships.
- The employee must belong to the manager's exact authorized unit.
  A recorded `positions.supervisory_org_unit_id` must equal that unit;
  otherwise `positions.org_unit_id` must equal it.
  Child-unit inference and same-unit-only colleague inference are forbidden.
- A same-worker count of current employer-qualified primary assignments
  must equal **one**. Ambiguous overlapping assignments are **omitted, not
  guessed**. The source warning always discloses incomplete evidence.
- Page size is 20, fetched as SQL `LIMIT 21`, ordered and paged by
  ascending immutable position-assignment ID. It is a **page preview**, not a
  complete direct-report census or payroll/headcount certification.

## Routes, fields and rollout flags

- Read-only API:
  `GET /api/hcm/manager-direct-reports?organizationId=ID&cursor=ID`
- Semantic server-rendered page:
  `/hcm/manager-direct-reports?organizationId=ID`.
- Server requires `HCM_MANAGER_TEAM_ENABLED=true` **AND** a canonical
  employer ID in `HCM_MANAGER_TEAM_ORG_IDS`. Both are OFF/empty by default.
  The public `NEXT_PUBLIC_HCM_MANAGER_TEAM_ENABLED=true` flag gates only
  the selected-workspace navigation. It is **never** an authorization bypass.
- Both API and page revalidate active membership, SSO/session policy,
  deny-only `workforce.manage` permission and **manager-only** unit scope.
  HR, owner, checker, payroll, bookkeeper and employee roles cannot use this
  feature by inheriting broader workspace roles.
- An unlinked, inactive, foreign-tenant or mismatched-unit manager identity
  fails closed. A user can see only records for their selected legal employer.
- API responses are `private, no-store`; there are no POST/PATCH/PUT/DELETE
  endpoints, salary, bank, government ID, phone/email, leave request,
  discipline, free-text reason, HR note or payroll data selections.
- Each item contains the recorded employee number/name/status, current
  position code, verified reporting unit, primary assignment ID and dates.
  No employee ID or private manager identity is emitted.

## Tests / required checks

Added:
- `tests/hcm-manager-direct-reports.test.ts`: feature OFF/allowlist, manager
  scope, PH time boundary, SQL tenant and identity guards, no-mutation/static
  UI contracts.
- `tests/hcm-manager-direct-reports-tenant-integration.test.ts`: actual
  **disposable synthetic PostgreSQL** with two employers, manager linked
  to an employee worker record, 22 bounded direct-report assignments,
  same-unit peer with another manager, other-unit records, missing worker
  identity, foreign-tenant identity, HR negative role, custom `workforce.manage`
  deny overlay, 20+2 pagination, ambiguous overlap and future assignment
  rejection. Fixture data is fictional and cleaned up.

This document **does not assert the new tests have passed** until exact PR-head
CI reports the results. Request full TypeScript/Next build, all regression
shards, PostgreSQL integration, CodeQL/security, tenant isolation, payroll
golden and payout protections before source merge.

## Separate human/activation NO-GO gates

- [ ] Maintainer/backend/security reviews authorization, correlated SQL count,
      employer and scoped-unit joins, data minimization and keyset paging.
- [ ] DBA reviews index usage and performance against synthetic realistic
      manager-team sizes. Current query is bounded but may need indexing work.
- [ ] HR/manager persona reviews what an absent/overlapping primary assignment
      means, and that **current** manager assignment is not historical proof.
- [ ] Independent synthetic authenticated role/permission/browser validation:
      actual session, SSO policy, custom deny, downgrade, two selected
      employers, pages, no cross-tenant source fields, server feature OFF.
- [ ] Real mobile, keyboard, focus, zoom, screen-reader and responsive review.
- [ ] Release owner approves exact running SHA, employer allowlist, proof of
      disable/rollback (turn OFF server flag and redeploy) and independent HR
      and security sign-off **before any employer activation**.

These are separately tracked by open #725, #112 and relevant HR UAT #852.
Do not close #725 solely because the draft PR merges. No prod flags, migrations,
employee records, payroll or money movement are authorized.
