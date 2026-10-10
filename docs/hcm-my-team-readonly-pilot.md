# Linaw HCM My Team — read-only manager/HR pilot

**Status: draft implementation. No production enablement, payroll certification, or human pilot sign-off.**

## Purpose and source of truth

This is the Sprint 4 Manager My Team experience from the enterprise HCM blueprint. It is an original, Workday-inspired view, not a second HR master. Its current source records are employees, org_units, leave_requests and overtime_requests.

The view includes current employee identity/name, employee number, title, employment type/status, source-validated active unit name, and page-local counts of pending leave/overtime requests. It does NOT expose salary, government ID, bank account, request reasons, approval notes, disciplinary cases or sensitive documents. A pending request is not a decision assigned to this viewer.

All employee and request writes, approvals, schedules, salary changes and payroll release continue through the original governing workflows.

## Authorization and employer boundaries

- Both /hcm/my-team and GET /api/hcm/my-team are blocked by default. Enable the server-only HCM_MY_TEAM_ENABLED=true flag only after protected staging approval.
- NEXT_PUBLIC_HCM_MY_TEAM_ENABLED=true is a navigation gate only and cannot authorize records. Keep both OFF in production until independent review.
- The organizationId query is an explicitly requested positive safe integer. Never silently choose the viewer's first company or use a staff ID as an employer selector.
- The API and page require authenticated membership, organization session policy, and deny-only workforce.manage permission through WORKFORCE_MANAGER_ROLES.
- Owner/admin/hr with company-wide membership may see only records of that employer. Owner/admin/hr with unit-specific membership may see only their assigned unit.
- **Manager** requires a concrete unit-specific membership. Manager with null/invalid org-unit assignment is denied, never interpreted as company-wide authority. Bookkeepers, checkers, payroll and employee roles are denied.
- Unit-scoped access additionally validates that the requested unit exists, belongs to the employer and is active/effective on the current Philippine business date.
- An employee with a foreign or inactive source unit never receives the foreign unit's name. A missing/foreign unit link is flagged, not silently treated as a verified department.
- This MVP intentionally limits scoped managers to their **exact assigned unit**; child-unit supervision is not inferred from org-unit ancestry, and is not a historical manager-of-record claim.

## API and correctness

GET /api/hcm/my-team?organizationId=POSITIVE_INTEGER&cursor=NONNEGATIVE_INTEGER&q=QUERY&status=all.

- Uses ascending, source employee-id keyset pagination at 25 per page. Query and status filter are applied in SQL before the LIMIT.
- Up to 25 staff records and one overflow sentinel are read for each response.
- Only IDs on that authorized page are used to count pending leave (status Pending) and pending overtime (status pending) in separate tenant-restricted aggregate SQL queries.
- Totals in cards are explicitly page-local, never headcount/vacancy/staffing/certified compliance metrics.
- No unbounded per-employee queries or payroll calculations. A stale request is aborted and hidden unless the response matches employer, query, filter and cursor.
- All errors fail closed with private/no-store responses. Missing source evidence never means all work is approved.
- Current unit and request status are only a source snapshot; open requests can change between pages and this is not a transactionally consistent census.

## Release NO-GO verification matrix

- [ ] Exact-head TypeScript, unit and two-tenant synthetic PostgreSQL tests, lint, build, CodeQL, security HTTP, payout/payroll isolation, and DR checks pass.
- [ ] Independent HR reviewer validates expected unit assignment vs true supervisory scope; do not conflate administrative org-unit membership with actual direct reports.
- [ ] Independent security review: company-wide manager denied, bookkeeper denied, custom permission deny, scoped HR, inactive unit, foreign tenant/employee IDs, and session-policy behavior.
- [ ] Synthetic 2-company fixtures with overlapping employee numbers and mismatched org-unit links verify no foreign name or request counts leak.
- [ ] Staging tests for search match on page 2, status filter, exact cursor advancement, source failures, rapid employer switch, and downgrade while open.
- [ ] Keyboard, screen reader, responsive mobile, error/loading and refresh states reviewed; no hidden mutation actions.
- [ ] DBA verifies employee/org-unit filter and leave/overtime aggregate query indexes, bounded plan and latency.
- [ ] Release owner performs rollback: disable server flag and redeploy, verify direct API/page both unavailable. Navigation-only rollback is insufficient.
- [ ] Separate written approval for any later manager decision actions; this release is read-only.

## Next phase

Build actual **My Team decision links** only after confirming authoritative manager-of-record and workflow assignment evidence; do not turn a pending request count into an approval shortcut. Candidate later work: manager-owned approvals list (source-linked and assigned-to-user), team leave calendar, supervisory child-unit authorization and workforce variance reporting, all separately gated and source verified.
