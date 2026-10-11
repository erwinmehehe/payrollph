# Connected PH employer journey — synthetic rehearsal

This milestone extends the existing isolated PostgreSQL 16 pilot. It proves
software behavior with fictional workers and separate synthetic actors. It is
not employer acceptance, professional payroll certification, actual bank
settlement, agency submission or permission to enable production services.

## Verified journey and failure cases

The existing `pilot-payroll-qa.ts` creates a non-demo fictional employer and
workers through application APIs, assigns effective schedules, resolves employee
self-service schedules, records synthetic attendance, requests and independently
approves a correction, resolves exception ownership/SLA evidence, blocks payroll
until timesheets are independently approved, reconciles schedule/payable-time
trace into payroll, and exercises checker approval and employee payslip access.
Its released ledger is synthetic; the actual provider remains unconfigured and
the live payout request is expected to fail.

The new post-approval scenario moves a fictional break by five minutes while
preserving its duration. It verifies that:

- The corrected worker's approved timesheet becomes stale while the other
  worker's approval remains intact.
- Payroll creation is blocked and the obsolete timesheet cannot be reapproved.
- Employee resubmission creates a new version/hash, and a different actor
  approves that version before payroll proceeds.
- Once the synthetic run is released, another correction cannot rewrite the
  attendance used by immutable payroll; the punch and approval remain intact.

The WFM request-lifecycle browser workflow mounts the actual guardrail,
overtime and schedule-swap components in React StrictMode. Deferred fictional
fetches deliberately ignore abort. Tests cover employer/access changes, old
policy reads, late policy saves, draft ownership, retry, worker defaults,
overtime selection ownership and refresh failures. This component harness
does not replace authenticated server or real mobile/device acceptance.

## Evidence and remaining rollout work

Run the pilot workflow on the candidate commit and retain its sanitized
`pilot-payroll-report.json`, including `postApprovalCorrection` and
`immutableAttendance`. Run WFM Request Lifecycle Browser QA plus the full
suite, golden payroll checks, security/isolation checks and production build.
Record exact-head results on the delivery PR; this document alone is not a
test receipt.

Continue hardening remaining WFM loaders and drafts. Then exercise the complete
manager/employee/HR/payroll journey with representative synthetic workloads,
mobile accessibility, coverage recovery, notifications and device scenarios.
Actual employer shadow payroll, private employee-by-employee reconciliation,
production bank-store verification, recovery and agency/provider acceptance
remain separate gates in #579, #691 and #112. Keep live money movement and
new deployed capabilities gated until their authorized evidence exists.

Rollback this milestone by reverting its source PR. No schema, real-data
migration, payroll formula or production flag change is part of this work.
