# Connected Employee Journey — HCM Release Slice

Status: **draft, additive, read-only**.
Baseline: existing `GET /api/hcm/worker-profile` and the People → Connected Worker Profile panel.

## User experience

An authorized People administrator opens an employee in **People** and sees seven source-linked milestones in one place:

| Milestone | Authoritative source | What counts as recorded |
| --- | --- | --- |
| Recruitment and hire | Applicant linked by `hired_employee_id` to a same-tenant requisition | The linked applicant's current stage is `hired` |
| Position and organization | Same-tenant primary `position_assignments` + `positions` already read by worker profile | Primary position is effective on the Philippine business date; future-dated assignments are in progress, and exited workers can show effective historical assignments |
| Onboarding | Same-tenant `provisioning_tasks`, `kind=onboarding` | At least one task exists and all are marked done |
| Performance | Same-tenant latest `performance_reviews` | Latest review has status `completed` (no scores in journey) |
| Compensation decisions | Same-tenant latest `compensation_proposals` | Only `applied` is a recorded pay-decision milestone; the module remains the authority |
| Released payroll evidence | Same-tenant `payroll_entries` joined to `payroll_runs` | At least one entry belongs to a `Released` run; **NOT bank settlement** |
| Offboarding | Same-tenant `separation_records` plus offboarding tasks and assigned assets | A released Separation package, at least one checklist task, all exit tasks done and no assets still assigned |

States are `recorded`, `in_progress`, `attention`, `not_recorded`, `not_applicable`, `restricted`. The UI avoids a misleading readiness percentage. `not_recorded` is **not** a claim of non-compliance or an absent legitimate hiring, pay, or employment event: legacy imports and direct hires may not have linked records.

Each nonrestricted stage opens its existing governed module. **This feature creates no second employee ledger or state machine, performs no write, and grants no approvals.** Source data and actual business-process controls remain authoritative.

## Security and privacy boundary

- The endpoint is the **existing** People-admin worker profile. Its server-side membership, People role/permission-set and target employee org-unit checks run **before** querying milestone evidence.
- Every new query includes `organizationId`, and every employee-specific query includes `employeeId`. Recruitment joins are tenant-qualified on *both* applicant and requisition.
- Compensation milestones are hidden unless the user has **company-wide People** access. No salary-band values, proposed/current salary, review rating, merit budget, or salary figure is returned in the journey.
- Payroll milestones are hidden unless the member's **base role permits payroll.view AND** the assigned permission-set/dynamic-group overlay allows `payroll.view`. Unauthorized users receive only `restricted`, without source IDs or existence indicators. No gross/net/withholding figures are returned.
- The People card remains inside the existing `canManage` worker-drawer gate; clients cannot override server filtering with a query parameter.
- The source includes ID and status evidence only; do not use it as proof of bank payout, statutory remittance, valid termination, signed labor consent, or privacy compliance.

## Regression and staging acceptance

Automated: `tests/hcm-worker-journey-evidence.test.ts` covers unlinked legacy hiring, complete milestones, deliberately mismatched applicant status, incomplete checklists, out-of-scope financial data, and released final-pay/asset gaps. It also asserts all cross-source tenant filters and the People UI read-only integration.

Staged verification before rollout:

1. Create two isolated tenant fixtures with colliding employee IDs where feasible; ensure no cross-tenant candidate, performance, compensation or released-payroll evidence appears.
2. Test company-wide HR (compensation status visible; payroll **restricted**), company-wide owner (both gated by custom permission set), unit-scoped HR (no company-wide compensation; no payroll) and unrelated nonmember (403).
3. Test real recruitment hire → created employee and assigned position → provisioning checklist completion → performance completion → governed compensation proposal → released payroll entry. Verify all statuses and links follow the actual source decisions without changing pay.
4. Test separation drafted and released with pending asset/offboarding tasks. No false “complete” stage; a released package never asserts money was deposited.
5. Repeat with a historical direct/CSV hire missing an applicant and with a worker who has no payroll entry; show `not_recorded` neutrally, never “unpaid” or “unauthorized”.
6. Verify inactive/failed or pending permission-set overlay cannot retrieve payroll milestone evidence, including by tampering with employeeId and organizationId.
7. Retest the combined People card with open HCM PR #640 before its eventual merge; this new feature should be rebased onto the canonical hire and payout controls rather than overwriting their worker drawer.

## Release boundaries

This is useful HR **journey evidence**, not a finished end-to-end Workday-style transaction orchestration engine or a payroll certification. It does not introduce schema migrations, bank templates, dynamic payroll rules, new job architecture or uncontrolled write paths. Pilot and production still require independent privacy/security, employer HR and Philippine payroll acceptance on the final integrated code head. Financial HCM PRs #666/#667/#668 and their release restrictions remain separate.
