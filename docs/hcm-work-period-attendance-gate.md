# HCM × Workforce — verified employment-period evidence gate

This change adds an **opt-in, controlled-pilot safety gate** between employee
lifecycle records and new overtime/timesheet financial evidence. It is not a
salary engine change, retroactive pay adjustment or final-pay amendment.

## Default state and authorization

The server flag `HCM_WORK_PERIOD_GUARD_ENABLED` defaults to **OFF**.
A code merge must not unexpectedly stop legacy employers from processing
historical wage claims. Enable it only on a synthetic-data staging tenant
after an independent People/Philippine payroll reviewer has reconciled
employment dates, separation state and any lawful backdated wage cases.

Existing organization/unit RBAC, maker/checker approvals, attendance locks,
OT budget limits, immutable payroll releases and statutory checks remain
in force. No request body, HTTP header or browser checkbox can turn the
server flag on.

## Enforcement when enabled

- **New overtime request:** Employee must have a verified real employment
  start date on/before the requested work date. Current status must be
  Active, On leave or Separating; no new request for Separated, Inactive,
  Terminated or other unrecognized statuses.
- **Overtime approval:** The same employment check is repeated for each
  selected worker inside the existing approval transaction. The employee
  row is locked while making the decision, so a concurrent worker status
  update cannot interleave with that authorization.
- **Timesheet submit/approval:** Every day of the submitted period must fit
  within the verified employment window. The worker record is checked
  both before calculation and inside the database transaction, with a
  row lock on final submit/approve. Rejecting erroneous submissions
  remains possible even when a worker has left the employer.
- **Separating employee:** HCM must contain a current organization-scoped
  separation record with a real `lastDay`. A request or timesheet crossing
  that day returns 409 rather than silently splitting the valid/invalid
  period, inventing an exit date or altering final pay.
- **Conflicting lifecycle state:** An apparently Active/On leave worker
  with an overlapping draft/approved/released separation, or a Separating
  worker whose final-pay record was already Released, is flagged for HR
  reconciliation rather than presumed employed without review.
- **Rehire:** A documented later employment `startDate` excludes old
  separation records whose last day predates the new hire. Previously
  terminated workers do not automatically inherit old exit caps once
  HR has correctly updated the same worker record for an authorized rehire.
- **Dates:** Strict real Gregorian `YYYY-MM-DD`, not just regex matching.
  The gate checks **work dates**, not exact overnight shift clock instants.

HTTP 409 outcomes have stable codes: `HCM_WORK_BEFORE_HIRE`,
`HCM_WORK_AFTER_LAST_DAY`, `HCM_WORKER_NOT_ACTIVE`,
`HCM_SEPARATION_END_DATE_UNVERIFIED`,
`HCM_WORKER_EXIT_STATE_CONFLICT`, `HCM_WORK_PERIOD_INVALID_DATE`.
The current WFM interface can show the returned message rather than
claiming a payroll/cutoff success.

## Important compliance and payroll boundary

**Preventing a new WFM authorization is not permission to withhold earned
wages.** Work actually performed before or after an incorrectly documented
separation may be legally payable. People/Payroll must independently
investigate factual work, contract terms, time evidence, payroll tax and
statutory deductions, final-pay settlement and applicable Philippine law.

Do not 'fix' a work-period 409 by altering the employee start date,
falsifying a rehire, entering a fake shift date, or reopening a Released
final-pay register. Use the existing governed HR correction and, where
eligible and approved, the independently reviewed payroll adjustment
path. The separate positive-shortfall PR #642 and final-pay PR #644
have their own release gates and must not be bypassed.

The new gate is not a time-clock capture endpoint and does not
retroactively delete or invalidate already-paid work evidence.

## Staging and release acceptance

- Review each active role and effective source: Active, On leave,
  Separating, Separated, Inactive, Terminated, and a worker rehired
  after an older Released separation.
- Synthetic tests for hire-day, final-day, next-day, leap-day,
  full-cutoff crossing last day, no source separation and employee
  status/separation mismatch.
- Validate a pre-existing submitted timesheet with a worker who exits
  while it awaits approval; approve should fail closed (but rejection
  must still be possible). Independently determine the route by which
  truly earned hours should enter a final-pay correction.
- Run at least two tenants with separate employee and separation IDs;
  verify no cross-tenant/department evidence leakage and no personal
  information in error messages.
- Race an overtime approval against final-pay separation and a
  timesheet submit against rehire/state updates. Worker row locks limit
  status changes but **do not prove that separate HCM policy/separation
  insertion routes share the same lock**.
- Run exact-head TypeScript, Node/PostgreSQL tests, Next build,
  CodeQL, payroll-golden reconciliation and isolated backup/restore.
- **Remaining gap:** OT approval and timesheet approval still inherit
  the existing WFM route's broader source snapshot and audit behaviors.
  This change does not claim atomicity for all downstream automations
  or complete serialization against all HCM separation creation paths.
- Obtain independent HR, labor/payroll, privacy/security and employer
  acceptance, then enable `HCM_WORK_PERIOD_GUARD_ENABLED=true`
  only for the approved controlled-pilot environment.

No production payroll writes, bank transfers or government filing
changes were made by this PR.
