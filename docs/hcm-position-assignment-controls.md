# HCM position assignment and lifecycle transition governance

## What is changing

The workforce-planning API exposes a legacy manual assignment path and a
position lifecycle status editor. The governed HCM business process is the
source of approval authority for new hires, transfers, promotions and job
changes. Simply having an approved vacant position must **not** authorize a
manager to overwrite a worker's role or legal-employer assignment.

### Direct assignment (legacy only)

- The organization must have **no** stored HCM Hire, Change Job, Promotion or
  Transfer business-process definitions or matching process instances.
  Disabled or future-dated definitions still count as configured governance.
- An operator needs company-wide People administration rights, MFA, a
  distributed rate-limit allowance, and today's Philippine calendar date.
- The transaction rechecks the policy under its existing position lock and
  requires the position to be approved/open, vacant, without an active
  requisition and without an employee's existing primary position or pending
  effective-dated change.
- Employee job/legal-employer state, primary assignment, position status,
  worker history and the actor audit now commit in one database transaction.
  Failure to write audit rolls the mutation back.

### Position lifecycle PATCH

- Planned → Approved and permissible → Closed still require HCM
  business-process reviews, not instant edits.
- Direct status transitions are limited to **Approved/Open → Frozen** by a
  company-wide People administrator using MFA. This may cancel an active
  recruitment requisition under the existing business logic.
- Frozen → Approved, Closed → Approved/Open, arbitrary Planned or Filled
  changes and other manual status rewrites return HTTP 409 with
  `HCM_POSITION_TRANSITION_REQUIRES_WORKFLOW`. Reopening or filling must use
  the appropriate recruitment/assignment/approved plan process.
- Status transitions recheck current state under the position lock and write
  their audit record in the same transaction, or roll back.

### What does not change

- Approved Recruitment > Hire & onboard continues to create workers and fill
  positions atomically, using the independent Hire BP.
- Scheduled transfers/promotions continue through effective-dated HCM and
  frozen position controls.
- Workforce plan position-execution may create or update approved structures
  from a separately published baseline; it remains a distinct controlled
  operation, not a manual status toggle.
- Existing tenant data and production position state are not touched.

## Review / release requirements

- Exact-head TypeScript/Node tests/build, security checks, payroll golden
  regression and connected HCM/WFM tests.
- Synthetic staging verification of grandfathered legacy primary assignment,
  tenant configured Hire/Transfer denial, department manager denial, MFA,
  concurrent assignment attempt, auditable frozen vacancy, and no reopening
  of closed/frozen positions outside an approved process.
- Independent HR/legal-employer, finance, privacy and DBA signoff. An existing
  employer's legitimate historical position reclassification needs a separate
  authorized migration/correction workflow rather than a hidden API bypass.
- **Concurrency limitation:** the position advisory lock is not an
  organization-wide governance lock. Approval-policy creation across another
  route might still race with a position assignment. Complete tenant-wide
  serialization and rollback/fault-injection tests before claiming full HCM
  governance under issue #610.

The HCM compensation PR #638 and historical migration PRs #633/#636 are
separate and should be reviewed in their own right.
