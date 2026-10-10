# HCM People Operations Inbox — Cross-module read-only worklist

**Status: DRAFT / NOT DEPLOYED.** This layer is a company-wide, People-administrator triage screen, not a new employee database, approval queue, payroll calculator, task creator or labor-compliance certification.

## What was implemented

On **People**, eligible company-wide People administrators can see a searchable/paginated **People Operations Inbox** *above* the existing expanded Employee Administration area. Existing **Lifecycle Action Center** and **Lifecycle Notification Inbox** remain available for detailed employment-term decisions, notification ownership, acknowledgement and snooze. The new inbox combines additional nonfinancial source work in one review order:

| Source | What appears | What does not appear |
| --- | --- | --- |
| Employment terms | Active decision pending approval, failure, due milestone, scheduled action or missing governance, based on existing lifecycle-readiness rules | Free-text decision failures, automatic regularization, implied termination |
| Onboarding | Open onboarding checklist tasks; optional source verification for a recent hire with no linked checklist | Requirement to retroactively invent historic onboarding records |
| Position planning | No current effective primary assignment, or approved-looking future assignment awaiting its actual date | Any automatic assignment or claim a future position is current |
| Performance | Latest non-completed, non-cancelled review | Performance scores, feedback text, salary recommendation or pay action |
| Separation | Draft/approved package, clearance gaps after release, outstanding exit tasks or unreturned assets, and neutral review of unlinked historical exits | Final-pay figures, automatic release, claim of bank settlement or legal validity |

All rows link to **existing** People, Planning, Performance or Separation modules. No arbitrary workflow action is allowed via this inbox. If an employee is not in the current People directory, the View Worker button falls back to the People module instead of doing nothing.

## Access boundaries

The read-only endpoint is **GET /api/hcm/people-operations-inbox**, with strictly validated `organizationId`, `page`, `pageSize` (1–50), `priority`, `category`, `dueWindow`, allowlisted `team`, and employee search (max 80 characters). It:

1. Authenticates the session.
2. Calls **assertOrganizationRole(..., PEOPLE_ADMIN_ROLES)**, which validates current organization membership, server session policy and deny-only custom People permission set/dynamic group.
3. Requires **companyWide** access; unit-scoped users, nonmembers, employees, managers without People role, and payroll-only members do not receive the list.
4. Reads only tenant-scoped source columns using a fixed batch of queries plus the existing employment lifecycle readiness loader. There is **no per-employee API read**.
5. Drops any orphaned source records whose employee ID is not present in the authorized tenant's employee list.
6. Returns names, employee number, source-grounded static follow-up text, priority and due date only. No salary, performance rating, medical details, TIN, bank account, statutory number, payroll result, loan or compensation record is selected.
7. Uses `Cache-Control: private, no-store`, aborts stale frontend requests, and hides previous-tenant cached results immediately on organization switch.

## Priority and pagination

Review required → follow up → optional source check, then earliest due date, employee name and stable category ID. This is an **operational sorting order**, not a legal-compliance risk model. The summary counts all source-linked current follow-ups across the organization, including those outside the current page/filter. The API applies filtering and paginates to 20 items/page by default, max 50. It does not show false "all requirements complete" messages for an empty filtered set.

To prevent duplicate Separation follow-ups, existing lifecycle start/continue handoffs are not echoed when an authoritative Separation package is already linked to that employee.

## Daily HR triage and source-date watch

The same native People Operations Inbox now includes a **read-only daily triage layer**. It does not create a second dashboard or change the authoritative source modules:

- Whole-tenant counters for **past source date**, **due today**, **1–7 days after today**, **8–30 days after today**, and **no source date**. Beyond-30-day work remains present in the inbox but is not labeled urgent.
- Interactive date filters: overdue; today; today plus next 7 days; today plus next 30 days; or missing source date. Next-7 and next-30 filters include today, **not overdue** entries.
- Source-team workload breakdown with totals, items needing review, past source date and items due within 7 days. Selecting a team drills into the existing list.
- Validated `dueWindow` and `team` GET parameters, with a fixed allowlist of known source-team labels. All filtering runs **after** the existing company-wide People role and tenant checks, using the exact existing tenant-scoped projections.
- Summary and team counts remain **whole-tenant counts**, even when filtered or paginated. A user may clear filters to return to the full view.
- The reference date is the Philippine business date; calculations use exact Gregorian `YYYY-MM-DD` UTC-midnight intervals to avoid browser timezone/daylight-saving drift.

**Meaning matters:** An item past a source date is an HR *review prompt*, not a proven breach of statute, payroll obligation or an assigned SLA. Missing dates may be normal for legacy, externally documented or unconfigured work. The stored operational-case SLA controls under separate draft #673 remain independent and are **not** silently mapped to these source-team labels. No owner assignment is fabricated here. This project phase requires no SQL migration, payroll recalculation, employment decision, notification sending, employee status update or new persistence.

Automated `tests/hcm-people-ops-daily-triage.test.ts` covers date boundaries, disjoint workloads, rolling horizons, missing dates, team filtering, global-vs-filtered counts, denied authorization, read-only API and source navigation. Staging still needs cross-tenant/org-switch, HR-role, source-workflow reconciliation and realistic workload testing. This triage layer stacks on #670, which depends on #669 → #640. Do not merge or deploy it independently of that dependency chain.

## Testing and staged acceptance

Automated `tests/hcm-people-operations-inbox.test.ts` covers source priority, overdue dates, neutral legacy onboarding/exits, future-effective positions, latest performance, released Separation clearance/asset gaps, no duplicate handoff, paging, search, orphan source exclusion, privacy boundaries and UI integration. The route is read-only and has **no POST/PATCH endpoints or DB writes**.

Before making this operational in production:

- Verify **two real staging tenants** with similarly named employees and overlapping numeric IDs; confirm all direct API and UI requests are tenant-isolated.
- Test owner, company-wide HR, payroll-only, manager, unit-scoped HR, invalid org ID and custom permission-set/dynamic-group denial.
- Confirm recently hired workers with no import history and older migrated workers are labeled as source checks, not legal violations.
- Complete an overdue probation decision, pending performance review, future position transfer, offboarding asset return and post-release clearance scenario through existing governed modules; refresh and confirm work items change accurately.
- Verify no salary, gross/net pay, performance scores, bank or statutory identifier crosses the inbox endpoint.
- Test at representative tenant sizes and profile query volume; this version batches all six source categories and paginates output but loads tenant-side source projections before ranking.
- Reconcile with dependent **#669** (journey actions) and **#640** (employee/hire/payout maker-checker) on the exact final integration commit. Their financial controls must not be bypassed. Full GitHub checks plus independent HR/privacy/payroll staging signoff remain release gates.

**No migrations, persistent work-item table, employment decisions, salary changes or financial approvals are added by this feature.** Missing records are neutral evidence flags, not compliance determinations.
