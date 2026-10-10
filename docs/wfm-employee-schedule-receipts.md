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

No manager impersonation endpoint, email/SMS, automatic schedule publication, timesheet invalidation, payroll change or payout is introduced. Existing scoped audit views can display the receipt event. A dedicated manager outstanding-receipt dashboard is not part of this increment.

## Acceptance required
Run exact-head TypeScript, regression, PostgreSQL integration and production-build checks. Exercise two fictional employers, unauthorized user/employee reassignment, stale snapshots, simultaneous duplicate clicks, overnight/rest/split source, keyboard review/cancel, mobile layout and interrupted-response retry. Verify that a receipt never clears a payroll or attendance exception.

Before enabling for an employer: independently review the additive migration, retention/access rules, source-field minimization, auth/session checks and human workflow. Shared roster locking coordinates the implemented schedule writers, not every possible HR/worksite/DB administrative change. A historical content receipt is not a guarantee that the schedule stays unchanged after commit. No human sign-off or statutory certification is implied by synthetic tests.
