# Calculate a draft before collecting payout destinations

The owner browser journey reached Create & process but returned
PAYOUT_DETAILS_REQUIRED before creating any run. A bank account is not an input
to wage calculation. Requiring one at that point encourages fictional accounts
just to inspect payroll.

PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED defaults off in the critical-release
registry. When explicitly enabled, the existing authorized create route can
create and calculate a draft without payout destinations. Its response explains
that payout setup is deferred, and the creation audit records the missing count.
The workspace notification identifies the result as a draft requiring payout
details and assurance remediation before approval/release.

With the flag absent or false, **Create & process** with missing destinations
still returns the same payout 422, message and employee IDs, and creates no run.
**Draft-only** creation (`processNow: false`) remains possible even with
incomplete destinations and never calculates or sends money.
Complete-destination success
responses and audit metadata retain their existing shape.

The route still resolves employer, organization-unit scope, subscription,
employment cohort, period conflicts and attendance/timesheet policies before
creation. No reviewer identity is fabricated, no payment account is added, and
no payroll engine arithmetic is changed. MISSING_BANK_DETAILS remains a blocking
assurance finding; checker submission and the release checklist remain blocked.
An owner cannot submit to themselves as checker.

## Verification

- tests/payroll-draft-payout-readiness.test.ts: exact default-off behavior,
  incomplete cohort, complete payout parity and blocking assurance behavior.
- tests/payroll-draft-payout-postgres.test.ts: actual create/calculation routes
  and disposable PostgreSQL; one authorized fictional worker produces a stored
  register, foreign employer and unauthenticated requests are denied, review
  remains blocked, victim employee/run state is unchanged, audit binds deferral.
- The PostgreSQL test uses an explicit in-process authentication fixture and
  does not claim HTTP, browser login, or real employer acceptance. The connected
  workflow runs it on disposable PostgreSQL 16 and 18 with providers disabled.

Local verification on October 24, 2026: 35 focused tests and 13 release-flag
guard tests passed; the integration test passed on a dedicated PostgreSQL 18
database named payroll_draft_test_20261024, initialized from the current Drizzle
schema plus the existing 0109 audit-chain and baseline-supplement SQL. TypeScript
passed. Scoped ESLint had zero errors and two existing navigation warnings in
linaw-workspace.tsx. These observations do not substitute for pending PR CI or
a deployed browser rerun.

Production activation and a browser rerun are separate. Until the source is
reviewed, merged, deployed and explicitly enabled, the deployed guard remains.
Real employer reconciliation and bank/provider settlement are not demonstrated
by this work.

## PR #1350 pre-calculation source gate

Before any calculation is created or queued, the new statutory-source,
pay-profile and attendance checks must pass. Enabling payout deferral never
waives missing official-source verification. As of this integration,
SSS/PhilHealth/Pag-IBIG/BIR source reviews are unrecorded, so a calculation
remains blocked with HTTP 422. Separate official agency and independent
financial approvals are required before positive payroll acceptance.
