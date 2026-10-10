# HCM Employment-Term Decision Integrity

This change hardens an existing employee lifecycle workflow. It does not
invent an automated termination, change approved salary, run payroll or
initiate a bank or government submission.

## Why the change is necessary

Core 3 HCM supports probation confirmation, renewal, extension, conversion,
non-renewal and continuation of current terms. The previous endpoints saved
the authoritative decision separately from the employment evidence event and
audit entry. An evidence/audit write failure could therefore leave a decision
created, cancelled, retried or approved without its corresponding trace.

The cancellation endpoint also used a stale preflight status without a row
lock, potentially conflicting with an application scheduler or a
non-renewal handoff.

## What changes

- **Create:** Confirm exact Gregorian dates, require an actual last day on
  non-renewal, lock the employee and active employment term, recheck lifecycle
  state and eligibility, then write the request, evidence event and audit in
  one transaction. Duplicate open decisions return an actionable 409.
- **Approve:** Require a known requester distinct from the checker. Recheck
  active source terms and eligible worker status. Sealed review evidence,
  approval event and actor audit commit atomically in the approval transaction.
- **Cancel:** Serialize with scheduled application using a decision-row lock.
  Cancel only pending/scheduled/failed decisions with no prepared successor
  term or started/linked Separation handoff; preserve an immutable, audited
  cancellation record in the same transaction.
- **Retry:** Only a previously approved failed decision with sealed evidence,
  no prepared successor and no started Separation handoff can be retried. The
  rescheduling, immutable event and audit commit atomically. Automatic
  application still validates the current terms and effective date.
- **Apply:** The scheduler first locks the decision row, preventing a
  concurrent cancellation from racing with a started application. Once the
  scheduler prepares successor terms, it saves the successor term ID in the
  decision **in the same transaction**, before attempting activation. This
  prevents a cancelled decision from orphaning approved successor terms.

- **Post-approval failures:** Approval and retry are committed independently of
  later same-day activation. If activation fails, the API returns HTTP 202 with
  the current persisted decision and an explicit reconciliation warning, not a
  misleading 409 that implies the decision was rolled back. The People
  interface displays that warning.

## Explicit limitations

- A prepared successor that later fails activation requires reconciliation
  of its existing HCM term record. It cannot be restarted by an unreviewed
  retry or cancellation.
- The approved non-renewal action creates an evidence-backed **handoff** to
  the independent Separation workflow. It never itself marks the worker
  Separated, pays final wages or confirms legal termination.
- Legacy approvals lacking accountable requester/evidence cannot be silently
  approved or retried. Employers must create a new reviewed decision after
  reconciling historical HR evidence.
- This PR does not certify external notice requirements, statutory dismissal
  grounds or final-pay timing. HR/legal review remains necessary for actual
  employment decisions.

## Mandatory release QA

Run exact-head TypeScript, DB tests, application build, HCM regression and
security workflows. In a staging clone with synthetic worker history:

1. Create two simultaneous decisions against one active term; only one must
   exist and each successfully created record must have an evidence event and
   audit entry.
2. Fault-inject an audit insert exception in create/approve/cancel/retry and
   verify the authoritative decision and evidence event also roll back.
3. Try Gregorian-invalid dates (including February 30), active-term replacement
   during request and a worker entering Separation during approval.
4. Interleave scheduled activation with a user cancellation; no successor
   term, employee status or Separation handoff may be orphaned.
5. Fail successor activation after preparation; require manual reconciliation
   rather than duplicating or silently cancelling the successor.
6. Verify approved non-renewal still hands off to the Separation system and
   never creates a final-pay release or bank activity.
7. Obtain independent HR/People, privacy/security and database reviewer signoff
   before merging into the controlled employer pilot.

No production employee, compensation or payroll data is changed by this PR.
