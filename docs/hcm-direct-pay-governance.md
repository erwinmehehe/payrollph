# HCM compensation governance: direct salary edit controls

The legacy `PATCH /api/employees` financial fields (pay basis, pay rate,
standard days/month and hours/day) are not an alternative to formal employer
compensation approvals. This release hardens that direct route without editing
the approved compensation implementation in PR #626.

## Rules

- **Governed employer:** A compensation-change business-process definition
  (including disabled or expired), HCM compensation process instance, draft
  compensation cycle or proposal closes the direct pay-edit route for the
  entire employer. It returns HTTP 409 and
  `HCM_GOVERNED_COMPENSATION_REQUIRED`. API input cannot override this.
- **Legacy employer without compensation governance:** Direct, effective-dated
  payroll corrections remain available to company-wide owner/admin/bookkeeper
  users with MFA, a rate limit and an explicit 8-240 character reason.
- **Concurrent changes:** Financial edits share advisory lock (4221,employeeId)
  with the governed compensation operations, and recheck compensation policy,
  pay profile version, and latest effective-dated pay revision inside the
  same database transaction. A stale proposal fails instead of overwriting
  a newer change.
- **Financial audit:** Direct payroll profile update, pay revision, any
  generated retro adjustment and the actor audit commit atomically. Audit
  insertion failure rolls back the financial writes.
- **Released payroll:** Existing legacy monthly-pay correction mechanics
  still preserve finalized payroll and generate separate retro adjustment
  entries for subsequent payroll, rather than rewriting a released register.

## Important product boundary

This PR does **not** add a governed, maker-checker-approved retroactive salary
correction workflow for enterprises already using compensation business
processes. Such employers must not relabel a historical correction as a new
current raise or bypass the governed route through the legacy UI. Legitimate
past-period corrections require a separately implemented and independently
reviewed finance/payroll correction workflow with frozen source evidence,
checker approval, no released-register rewriting, and reconciliation. PR #626
does not independently certify that new correction path.

## Release checks

- Exact-head CI, database tests, golden payroll reconciliation, CodeQL, build.
- Synthetic end-to-end validation of disabled/future compensation BP, draft
  cycle, no-governance correction, scoped HR denial, MFA, maker/checker rights.
- Two concurrent salary edits: second receives 409 stale profile/revision,
  does not overwrite or duplicate retro and audit rows.
- Fault injection: audit database insert failure rolls back the salary and
  retro-pay changes.
- Independent employer/payroll and DBA/security review before staging signoff
  and any production use.

Remaining HCM issue #610 includes position assignment, separation, and worker
lifecycle operations; those are separate release candidates.
