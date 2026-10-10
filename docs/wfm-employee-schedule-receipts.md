# Employee schedule receipts

## Scope
One follow-up to the merged WFM consolidation (#702): employees explicitly acknowledge the exact current schedule snapshot they have seen. This is NOT an attendance punch, consent to contractual or pay changes, payroll approval, proof of message delivery or absence finding.

The authenticated employee may review the next seven Philippine dates, including complete recorded rest days and overnight/split shifts. Unassigned, malformed, duplicate-day or missing/foreign-worksite evidence cannot be acknowledged. Names, salaries, government IDs and raw source audit notes are not included in the receipt projection.

## Workflow
The existing Time workspace links to `/self/schedule-receipts` only behind the separate UI flag. The page and `/api/self/schedule-receipts` independently enforce the server flag and employer allowlist. GET returns seven projected snapshots and their receipt status. POST accepts only workDate, snapshotHash and acknowledged:true; all actor and employer IDs come from the authenticated employee session.

POST reacquires the shared organization roster lock (6107), rechecks the active user-to-employee membership, re-resolves authoritative source data and compares the exact content hash. Stale content returns 409 without a new receipt. Repeated identical acknowledgment returns the original timestamp. Receipt and audit event commit in the same transaction. Later changed content is shown as requiring review while previous receipts remain stored.

Hashes represent **content**, not an independently versioned publication counter. Restoring exactly the same content/source identifiers can match an earlier receipt for that same employee, user and work date. This is not asserted to acknowledge an intervening publication, policy notice or notification.

## Flags and schema
Default OFF. This PR does not apply production SQL or alter any environment setting.
- `WFM_SCHEDULE_RECEIPTS_ENABLED=true`: server endpoint/page gate.
- `WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS`: explicit comma-separated approved fictional pilot IDs, maximum 20, no duplicates or wildcard. This is separate from the bulk-publishing allowlist.
- `NEXT_PUBLIC_WFM_SCHEDULE_RECEIPTS_ENABLED=true`: employee navigation only; it cannot authorize the API.
- `drizzle/0108_wfm_employee_schedule_receipts.sql`: additive, application append-only receipts with unique actor/content/date constraint; included in isolated CI via drizzle.config.ts.

No manager impersonation, email/SMS, automatic schedule publication, timesheet invalidation, payroll change or payout is introduced. Existing scoped audit views can display the receipt event.

## Read-only People administrator review (next increment)

In the existing Team Roster, an authorized People administrator can select **one worker from their current authorized roster page** and open a seven-day schedule receipt status panel. The review does not depend on the historical roster week selector: it always evaluates the current seven Philippine work dates and the current version of the schedule.

`GET /api/workforce/schedule-receipt-review?organizationId=...&employeeId=...` is server-gated by the **same disabled-by-default receipt feature and employer allowlist**, People-admin role and custom permission, active membership, and department scope. It also reacquires the organization roster lock and rechecks the manager's role/unit membership and selected employee after the lock. Date overrides, arbitrary receipt IDs, and other query parameters are rejected.

For a single active employee self-service identity, the endpoint recomputes current content hashes from authoritative schedule/worksite evidence and checks current hashes against stored receipts for the **same employee and active employee-login identity**. It returns only the seven dates, current-version receipt state, optional matching acknowledgment time and aggregate counts:

- **Acknowledged**: a receipt exactly matches the currently projected content for that work date.
- **Changed**: a historical receipt exists but none matches the current content.
- **Pending**: a valid current schedule exists but the active employee login has no receipt for this date.
- **Unavailable**: current schedule evidence is incomplete or unsafe to interpret.
- **Not enrolled / identity review**: no unique active ESS identity; does **not** count as failure to acknowledge.

The manager endpoint never exports receipt hashes, historical snapshots, employee email, government IDs, bank/pay amounts, a company-wide absence list, or a second employee's records. It does not notify workers, infer noncompliance or create receipts. The first increment deliberately reviews **one selected employee at a time** rather than scanning entire employers or generating a bulk compliance score.

## Acceptance required
Run exact-head TypeScript, regression, PostgreSQL integration and production-build checks. Exercise two fictional employers, unauthorized user/employee reassignment, stale snapshots, simultaneous duplicate clicks, overnight/rest/split source, keyboard review/cancel, mobile layout and interrupted-response retry. Verify that a receipt never clears a payroll or attendance exception. For the manager inspector, test foreign-employer and out-of-unit IDs, expired People membership, two active employee identities, no employee account, stale schedule hashes, and the tab/worker scope-switch race.

Before enabling for an employer: independently review the additive migration, retention/access rules, source-field minimization, auth/session checks and human workflow. Shared roster locking coordinates the implemented schedule writers, not every possible HR/worksite/DB administrative change. A historical content receipt is not a guarantee that the schedule stays unchanged after commit. No human sign-off or statutory certification is implied by synthetic tests.
