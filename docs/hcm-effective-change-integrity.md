# HCM effective-dated worker changes — source-version integrity

## What this change fixes

An independently approved promotion, transfer, manager reassignment, job
change or legal-employer move may be scheduled days or months before it
becomes effective. The worker's original job, assignment, manager or status
might change in the meantime. The scheduler must not overwrite that newer
record using an obsolete approval. The former application code revalidated
the destination but did **not** compare the complete original source.

The former implementation also committed the employee/position/worker-event
change and only then attempted to append an audit event. An audit failure
was converted into a warning instead of rolling back a financially and legally
meaningful employment change.

## Implemented controls

- **Frozen source and destination comparison:** The originally reviewed
  worker/primary assignment/current position are compared with authoritative
  live org unit, legal employer, title, status, manager, cost center, job and
  assignment. The *approved destination vacancy* must also retain its
  originally reviewed employer, manager, organization and job fields; only
  ordinary vacancy approval → reservation status is permitted to change.
  Missing source/destination evidence and legacy untraceable snapshots fail
  closed.
- **Two-stage concurrency protection:** Application locks both relevant
  positions in stable ID order, then checks frozen source/destination evidence
  under the existing worker advisory lock before mutation. The original
  primary assignment must still be open before closing it, and the employee
  UPDATE compares live org/employer/title/type/status with reviewed values.
  Changes from nonparticipating direct writers cannot silently overwrite
  reviewed state. Full cross-route locking remains a broader HCM #610
  follow-up.
- **All-or-nothing financial/HR audit:** The worker, position assignment,
  employment event, status `applied`, and actor audit row commit inside the
  *same* PostgreSQL transaction. An audit storage failure rolls back the
  entire move; the failed scheduled item remains recoverable, not applied.
- **Request/decision auditing:** New requests, business-process initiation,
  approval with reserved vacancy, decline, cancellation with position
  restoration, and retry state each write the actor decision inside their
  respective database transactions. These sensitive requests and decisions
  require fresh MFA and distributed throttling. A durable HCM approval must
  not exist without its corresponding auditor evidence.
- **Safe retry:** A failed change can be retried only with known, distinct
  requester and approver IDs, an approved linked HCM business process, an
  unchanged original worker/position/assignment snapshot and the same
  reserved target vacancy. The review and new `scheduled` state commit in
  one row-locked, audited transaction. Stale or legacy approvals must be
  cancelled and submitted afresh for independent review.
- **Post-commit failure honesty:** A failed document obligation sync,
  lifecycle notification, promotion workflow or employee-field automation
  is reported as a **post-apply warning**, not a failed source mutation.
  These delivery warnings must be reconciled separately.

## Operator experience

1. Plan the effective-dated job change and complete the ordinary independent
   HCM approval chain, including a prospective vacancy reservation if needed.
2. On the effective date, the worker source is rechecked before any job,
   manager, cost center or employing entity changes.
3. If the source changed: leave the change **failed**, preserve the current
   worker state, inspect the mismatch, cancel the stale request (releasing
   its vacancy reservation), and submit a new change with current evidence.
4. If an external notification fails after a committed move: do not manually
   reapply the move. Review the audit and employment event once, then
   reconcile the warning through an approved delivery/outbox process.
5. Older scheduled moves with incomplete snapshots should be reviewed and
   recreated rather than auto-applied. Never fabricate a legacy reviewer ID.

## Pre-merge and production requirements

- Exact-head TypeScript, full Node tests, PostgreSQL tests, Next build,
  payroll golden regression, CodeQL and security checks.
- Synthetic staging: old approved snapshot vs newer legal employer, status,
  title, manager, primary assignment, reserved vacancy and effective date.
- Two-worker concurrent application and retry attempts; confirm exactly one
  applied event, employee update and audit row.
- Fault-inject audit persistence failure to verify rollback of every worker,
  position and event mutation; then retry under independently reviewed terms.
- Fault-inject post-commit automation failures and check application is
  correctly reported as applied with separately actionable warnings.
- Sign-off from independent Philippine HR, payroll, database and privacy
  reviewers for employer-specific transfer/legal-entity rules before any
  production rollout.

This PR changes only HCM source verification, decision auditing, retry
governance and nonfinancial post-commit error reporting. It creates no new
SQL migration or payroll/bank payout function and changes no production data.
Keep the broader HCM #610 issue open for cross-route policy/locking, external
review and controlled-pilot certification.
