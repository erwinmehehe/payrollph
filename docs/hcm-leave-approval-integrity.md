# HCM leave lifecycle and approval integrity

## Why this change is necessary

A new leave request affects payroll earning treatment, WFM coverage and
submitted/approved timesheets. Previously the generic approval handler
persisted the approval decision first, then updated its leave record and
staled timesheets using separate database operations. A failure between those
operations could leave an **Approved task with a Pending leave request** or
valid-looking payroll timesheets that no longer reflected approved leave.

The worker lifecycle also needs valid dates: approved ordinary leave must not
begin before the hire date or extend beyond a separating worker's last
employment day.

## New server-side checks

- A leave request and its schedule preview must use **real Gregorian
  YYYY-MM-DD dates** and at most **366 inclusive calendar days**; precise
  interval input is capped at 1,500 records.
- New leave days must be positive and may not exceed the calendar-date range.
- Active and On leave workers can request ordinary leave starting on/after
  the recorded employment start date.
- Separating workers require an actual, non-released separation record with a
  valid last day; ordinary leave must end no later than that day.
- Separated/Terminated or unknown-status workers cannot create, preview or
  approve *new ordinary leave*. Existing Approved leave is not retroactively
  invalidated. Historical paid-leave corrections belong to an independently
  reviewed HR/payroll correction, not the normal self-service leave form.

## Transactional behavior

- **Leave submission:** approval task, leave request, initial precise timing
  revision and submitter audit commit as one database transaction.
- **Timing revision:** row-lock Pending leave, re-evaluate current employee
  and last-day eligibility, assign a unique next timing revision, supersede
  the old timing, update overlapping submitted/approved timesheets to Stale,
  and commit the revision and audit **together**. Concurrent stale updates
  fail with a clear 409 rather than silently overwriting the approved timing.
- **Leave approval/decline:** lock the source leave record within the
  existing approval-task transaction. On approval recheck worker employment
  eligibility against a shared-lock employee snapshot. Commit leave status,
  overlapping timesheet staleness and an actor + interval-revision audit
  with the approval task. The reviewer must differ from the original
  requester's stable user ID captured in precise-leave revision 1; a
  display-name delegation cannot bypass this maker/checker check.
  Legacy leave with no source requester identity cannot be newly approved
  and must be resubmitted through the governed process. A missing, multiply
  linked or already decided leave blocks the whole decision transaction.
  Post-commit automation and
  webhook calls cannot rewrite the approved decision.
- Generic payroll approval and other HCM business-process decision paths
  remain unchanged by these leave-specific transaction branches.

## Rollout and exception handling

This changes ordinary leave intake behavior for formerly permissive legacy
workspaces. Do not use a fabricated employee hire date or ad-hoc employee
status override to get a blocked leave through. Verify HR employment history
and use the separately approved correction process when a historical absence
or paid-leave entitlement needs reconciliation.

**Review before merge:**

1. Run exact-head TypeScript, full Node/PostgreSQL tests, production build,
   CodeQL, payroll golden fixtures, and absence/WFM tests.
2. In staging submit overlapping full-day, half-day and timed requests,
   including overnight schedules and leave that spans a hire/separation date.
3. Verify two concurrent timing revisions: one winning revision with one
   current evidence set, no duplicate revision number, and correct stale
   timesheet IDs.
4. Simulate approval/revision races: never publish Approved task + Pending
   leave, never approve old timing, no incomplete audit; fault-inject the
   audit insert and verify transaction rollback.
5. Verify employee role, manager scope, delegated approver maker-checker,
   and cross-tenant protections for all three routes.
6. Reconcile final-pay and leave conversion cases with independent Philippine
   payroll/HR practitioners. Keep actual production payroll operations
   outside this code review.

This is a **draft release candidate**, not an assertion of completed
employer/HR or payroll compliance signoff.
