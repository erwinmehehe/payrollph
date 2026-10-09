# HCM Governance Readiness — Read-Only Exception Inventory

This adds a deliberately **non-mutating** HCM control summary to the
**Configure governed HCM transactions** screen. It is built on the current
database schema, requires **no SQL migration**, and does not enable any
money-bearing salary, payroll or separation workflow.

## Deployment gate (default OFF)

To prevent unreviewed auto-deployment of a new production HCM query/UI when
`main` is merged, **both** of the following environment settings must be
explicitly enabled in the chosen staging or approved production environment:

- Server: `HCM_GOVERNANCE_READINESS_ENABLED=true`
- Next.js client build: `NEXT_PUBLIC_HCM_GOVERNANCE_READINESS_ENABLED=true`

The UI stays hidden without the client build-time flag. The backend returns
`404 HCM_GOVERNANCE_READINESS_DISABLED` without running its database report
unless the server flag is set. An API caller cannot override either flag.
Enable these only after a staged two-employer privacy and response check.
A new Next.js build is needed after changing a `NEXT_PUBLIC_` build flag.

## What administrators can inspect

A company-wide People administrator can refresh tenant-scoped aggregate
counts, without exposing employee names, ID numbers, payslip amounts,
government IDs or bank accounts.

- Current and inactive/future-dated HCM Business Process definitions by
  process type (Hire, Change Job, Promotion, Transfer, Compensation Change,
  Termination, Create/Close Position).
- High-priority exception counts: wage-region codes not supported by the
  current region catalog, duplicate employee numbers within a tenant,
  approved/released final-pay records missing department clearance, released
  final-pay without a reference, and released final-pay that does not match
  the current employee lifecycle state.
- Other review counts: separated workers still assigned to an active primary
  position, employees recorded as Active/On leave/Separating with a *future*
  start date, missing payroll pay profiles, and missing explicit rest days.
- Count of HCM Business Process instances still in progress.

The endpoint is `GET /api/hcm/governance-readiness?organizationId=N`,
with company-wide People-admin authorization, no response caching, and
database-side counts. It has **no mutation methods** and never creates,
approves, pays, or modifies employee records.

## Scope and safe interpretation

- "Active" policy means *at least one active effective definition*; it
  does **not** prove that every supervisory organization and worker has an
  applicable approval workflow. The application may fall back to a system
  workflow where none is configured.
- Counts are **diagnostic leads, not established errors**. For instance,
  an employee can legitimately lack an active position after certain HR
  events, and a payout reference typed in the system is not bank evidence.
  Investigate documents rather than auto-updating any worker record.
- Counts are a refreshable snapshot, not a consistent serialized payroll
  certification across independently queried tables.
- This does **not** sign off on compensation PR #626, reviewed payroll
  underpayments PR #642 or final-pay PR #644. Their migration order is
  explicitly blocked pending independent DBA, security, employer and payroll
  reviews. Do not interpret this dashboard's findings or lack of findings
  as approval to merge or deploy those changes.

## Review and testing

- Pure unit tests cover date-effective policies, aggregation, error
  handling, privacy boundaries and non-certification language.
- API contract checks enforce GET-only, scoped company authorization, no
  state-changing database operations and no-store responses.
- Verify in staging with at least two organizations, company-wide vs
  scoped HR access, a deleted/disabled policy, a final-pay mismatch and
  invalid regional data. Confirm that only the intended employer's counts
  appear and no personally identifying information is returned.
- CI/TypeScript and an independent code review should precede merge.
  If main auto-deploys, merging must be treated as a production deployment
  decision even for read-only user-facing changes.

## Deliberate exclusions

No edit buttons, backfill scripts, auto-repair action, bank integration,
API exposure of individual flagged employees, financial correction, or
new SQL migration is part of this change. Findings point HR/payroll to a
documented, independently governed correction workflow.
