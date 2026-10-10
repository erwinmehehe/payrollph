# Linaw HCM — Team Leave Calendar pilot acceptance

**Status: draft code only, read-only, default OFF, not a staffing or payroll source.**

## Operator experience

This is a Workday-inspired manager view built from the existing leave_requests and employees tables. It shows **approved** and **pending** request date spans for a current member's authorized organizational unit or employer. The operator chooses a month (current Philippine month plus up to six months forward), then selects a date to inspect overlapping request records.

This calendar does **not** show leave type, leave reason, precise start/end clock times, leave duration in hours, leave policy treatment, paid/unpaid leave classification, identity numbers, payroll amounts or personal medical information. It has no mutation actions and does not duplicate the leave master, approval route or shift scheduler.

**Critical interpretation:** The stored startDate/endDate span can contain half-day/timed leave or other precise intervals. A date marked here is NOT proof the employee is absent for the full day, that leave affects payroll for an entire day, or that a shift is uncovered. Use existing leave timing and workforce schedule evidence before acting. Pending is a submitted source request and is not approved absence.

## Permissions and flags

- Server-only HCM_TEAM_LEAVE_CALENDAR_ENABLED=true gates both GET /api/hcm/team-leave-calendar and /hcm/team-leave-calendar. When absent the endpoint is 404.
- NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ENABLED=true controls an optional navigation link in the existing Approvals workspace. It cannot authorize any request.
- Both flags default OFF. No production changes or deployment are made in this PR. Disabling server flag and redeploying is the security rollback; hiding a link alone is not.
- Authenticated user and explicit positive organizationId are required. No default employer is inferred from the session.
- Membership, organization session policy and deny-only workforce.manage permission are rechecked through the existing WORKFORCE_MANAGER_ROLES gate before reading source records.
- Manager requires a **specific, currently active/effective organizational unit**. Unitless or company-wide manager access is denied. Owner/admin/hr members use only their explicitly assigned company-wide/exact-unit scope. Bookkeeper, payroll, checker and employee roles are denied.
- Unit scope is verified against org_units.organization_id, active=true, and effective dates on current Asia/Manila business date. Scoped managers only see employees whose current orgUnitId is exactly this verified unit ID. Do not infer child units or historical manager relationships.
- Both leave_requests.organization_id and employees.organization_id must match the requested employer. Foreign-tenant leave/employee cross-references are excluded before any row is projected.

## Pagination, date and source safety

- GET /api/hcm/team-leave-calendar?organizationId=POSITIVE_ID&month=YYYY-MM. Month defaults to current Philippine month when absent.
- Window is only **the current Philippine month through six calendar months ahead**. Historical months are denied because the pilot uses current manager-unit evidence, not a historical manager-of-record authorization chain.
- Statuses: Approved and Pending only. Declined, canceled or other states are excluded. Date overlaps are inclusive using source startDate/endDate and the actual YYYY-MM window.
- At most 400 matching source records in the requested month. SQL reads at most 401; an overflow returns HTTP 409 **without returning a partial calendar**. No simulated total workforce headcount or "everyone available" signal.
- The month grid is ISO date-only and Monday-first. No browser timezone reinterpretation of dates. Month source records are read-only snapshots and may change after a status decision.
- Cards summarize **unique request records within that month**, not unique employees or days of absence. Day cells show overlapping request-record counts, not staffing levels.

## Protected staging witness: precise half-day and timed leave

The repository's isolated PostgreSQL regression fixture stores authentic current
`leave_request_interval_sets` and `leave_request_intervals` evidence (not guessed
days), while the Team Leave Calendar intentionally returns only the **request span**.
A green test does not substitute for a protected browser session and an independent
HR reviewer.

| Synthetic staging case | Expected calendar observation | Forbidden inference |
| --- | --- | --- |
| Approved first-half interval on 2026-10-14 | Approved **request span** for that date; no first-half clock detail | Absent all day, or half of a payroll shift without schedule evidence |
| Pending 09:00–11:00 timed interval on 2026-10-15 | Pending **request span** for that date; times never returned to the calendar | Approved absence, shift gap, payroll minutes, or capacity loss |
| Approved request crossing September 30–October 2 | Overlap in October for October 1 and 2, labeled request span | Certified absence on both dates without precise interval evidence |
| Pending request crossing October 11–November 2 | October and November source views show corresponding span; no duplicate leave object is created | More than one independent approval |
| Declined leave on October 4 | No record in this Approved/Pending-only calendar | Employee available or an absence reversal proven |
| Manager switched to a different company or deactivated unit | No previous employer's request text after navigation; direct API returns denial | First-company fallback access |
| 401 matching leave source records | 409, no partial calendar or misleading zero counts | All employees available |
| Server flag OFF after staging rehearsal | Direct URL and GET return 404; navigation alone cannot authorize | Successful rollout or production activation |

Witness protocol (authorized staging operator, isolated synthetic employees only):
1. Inspect the actual staged **commit SHA** and deployed server/client flags; both are normally OFF. Obtain environment-owner approval before turning either flag ON in a protected staging preview.
2. Seed the exact synthetic current interval-set fixtures, including a first-half interval and a timed interval. Keep private dates and time details only in protected test fixtures; never export real employee identifiers, reasons, notes, or staging cookies into PR artifacts.
3. Use two separately authenticated test company memberships: a scoped manager for the synthetic unit and an HR company-wide viewer. Test cross-employer request IDs and foreign-unit assignments through the direct API as well as through the calendar.
4. With server flag ON in staging, inspect October day 14 and 15, compare recorded source-status and interval kinds to the request-span presentation, and confirm clock times/leave reasons are absent from the calendar API. Check mobile keyboard and screen-reader announcements.
5. Turn **server flag OFF again**, reload the direct API and server page, verify 404, and confirm no stale personally identified records persist after scope downgrade.
6. Independently record CI run and exact commit, protected staging deployment identity, fixture provenance, screenshots with no sensitive data, rollback result and HR/security reviewer signatures in the **private** evidence register.

**Current evidence gap:** Only synthetic CI and source review are represented by this PR.
No staging deployment identity, actual UI witness, flag rehearsal, or human HR/security
signoff is supplied; **none may be inferred from a successful CI run**.

## Release NO-GO checklist

- [ ] Exact-head TypeScript, Node tests, synthetic two-employer PostgreSQL fixtures, build, CodeQL, security HTTP, payroll isolation and DR checks pass.
- [ ] Independent HR verifies request status and real half-day/timed leave representation; the UI must not imply staffing availability or absence hour totals.
- [ ] Security tests company-wide manager, unitless manager, inactive/suspended member, scoped HR, deny-only permission, manager reassignment, inactive org unit, broken foreign-tenant reference, direct URL guessing and session-policy downgrade.
- [ ] Two-employer fixtures with overlapping employee numbers, mixed Approved/Pending/Declined, crossing-month requests, precise leave and 401-record overflow.
- [ ] DBA validates indices/query plans for organization, status, end/start overlap, org unit and 401 row limit; stress-test larger tenants.
- [ ] Mobile and desktop QA: keyboard tab order, weekday labels, day buttons with counts, screen-reader date announcements, empty/error/loading states, current-next month boundaries and rapid month/tenant changes.
- [ ] Release owner signs off the server flag rollback and privacy language; no real-employee activation before signoff.

## Independent planned work

- Use authoritative leave interval sets to render exact partial-day coverage after HR signoff, never approximating hours from the request span.
- Team staffing capacity, shift coverage and actual staffing gaps must connect governed WFM schedules, absences and skill/role constraints. No inference from this calendar.
- Manager decisions must remain in the existing leave approval source. Any new approval UI requires fresh maker-checker/delegation review and is a separate release.
