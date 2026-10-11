# Linaw HRIS: BambooHR-style surface, Workday-grade foundations

Status: **surface implementation proposal and measurement contract**. This is not a third-party UI clone, formal BambooHR/Workday parity certification, or real-employer usability acceptance.

## Product contract

Make the default HR experience obvious to a first-time administrator. Keep the underlying employee, job, position, supervisory-organization, effective-date and approval sources authoritative. Do not duplicate or replace those records to achieve simpler navigation. Preserve tenant and actor scope in both the simple view and advanced workspaces.

### Default, task-first surface

- HR Home: employee quick-find; people directory; hiring/onboarding; leave/time; assigned approvals and documents. Actions route to existing source workspaces.
- Employee Self-Service: Home, Pay, Time, Leave; secondary Documents, Performance and Profile. Worker data belongs only to the linked employee.
- Manager: scoped My Team, source-linked requests and approvals; no salary, bank, government ID, or employee-wide access by implication.
- HR advanced: job families, levels, positions, supervisory organizations, governed employment changes, headcount plans, compensation and workflow monitoring remain in the existing role-authorized advanced workspaces.
- **Plan lock is not yet an implemented enterprise entitlement for every HCM module.** UI filtering is not authorization. Any later plan switch must be enforced by the server and billing entitlement as well as role and company context.

### October 11 slice: HR Home quick-find

HR administrators can search the *already loaded, server-authorized, selected-employer employee roster* by employee name, employee number or job title. Up to six matching workers are displayed. Choosing one opens the current People drawer/Employee 360. Enter selects the top ranked match, Escape clears the query, and results are tab-reachable. Remount on employer switch removes query/results from the previous employer.

No new API or schema; no additional source fields (bank, pay, government identifier or personal contact), no role expansion, and no approval/payroll mutation. This does not expose employee records from another tenant merely because an employee number collides.

## Operator usability acceptance still required

Observe at least three untrained HR users, each in an authorized staging employer:

| Scenario | Target | Evidence |
| --- | --- | --- |
| Find one employee and open their details | Within 20 seconds from HR Home, without guidance | Video or observed task timing and whether wrong worker was opened |
| Find a recent onboarding checklist and task | Within 45 seconds | Click count, task completion and source refresh |
| Locate a leave request and assigned approval | Within 45 seconds | Distinguish pending request from actual assigned authority |
| Find current worker's role, manager and position | Within 45 seconds | Correct employer/worker, sourced field, no invented value |
| Employee finds latest *released* payslip | Within 30 seconds | Time and comprehension; no unreleased pay exposed |
| Mobile at 375 px | No horizontal overflow, complete keyboard route | Screenshots, focus order and task success |
| Switch employers mid-search | Previous employer's results vanish | Wrong-tenant negative recording |
| Manager lacking valid unit | Access denied | Staging 403/no employee payload |

Treat these as **acceptance targets**, not achieved metrics. Run with novice users and record actual times/failures before claiming BambooHR-level ease.

## Depth sequencing

- Keep existing job families/profiles, position assignments, effective-dated employment records, versioned multi-step approval definitions and maker-checker checks.
- Improve supervised send-back/rescind/correction, owner-of-record rules and as-of history before claiming Workday process parity.
- Gate advanced interface discovery by existing role and verified employer plan entitlement **after** server-side plan enforcement is designed and tested.
- Synthetic Chromium/CI are engineering proof only. Staging operator walkthrough and the separate pilot/payroll/production evidence gates remain open.

Rollback: revert the quick-find source commit. No database backfill, provider action or production feature activation is needed.
