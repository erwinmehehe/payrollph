# HCM / Payroll — Independent Employee Loan Deduction Governance

## Why this change is necessary

The original employee loan screen created rows with **active** status and
immediately made them eligible for automatic payroll cutoff deductions. The
same API permitted broad People roles to record manual repayments, pause,
resume and close balances without financial maker-checker review or an atomic
ledger/audit transaction. A typed payment reference in that flow was generic,
not an actual bank/agency receipt.

This release candidate closes the direct activation bypass for **new**
company/agency loan schedules. It does **not** declare deductions legally
authorized merely because an operator types an evidence reference.

## New operation

1. A company-wide payroll maker with recent MFA records the employee, source
   loan/agency reference, exact principal, cutoff rate, dates and a traceable
   employee/agency deduction authorization reference.
2. The loan is created as **pending_approval**, not active. The payroll engine
   selects only status=`active`; there is no deduction at this point.
3. A **different**, company-wide payroll/tax checker independently validates
   the underlying source authority, pay-cycle applicability, protected wages
   and employee/agency consent where legally required. The checker enters a
   substantive rationale and separate source-evidence reference.
4. Approval atomically activates the loan and records the reviewer identity,
   timestamp, authorization and audit. Rejection permanently closes the
   pending request without making a payroll deduction.
5. Before activation, the route locks already existing affected payroll
   runs. If any non-Released overlapping payroll is already processing,
   calculated or beyond an empty Draft, activation is refused until that
   register is independently reconciled. The payroll engine continues
   respecting each loan's start/end eligibility dates.
6. An active deduction can be **paused** immediately by company-wide payroll
   operations with MFA/reason/audit. A paused new loan can only be
   **resumed after independent reviewer approval**, with a new evidence
   reference and verification that payroll has not progressed.
7. Verified repayments made **outside** calculated payroll require an
   8–120-character real bank/agency reference, positive centavo-exact amount,
   company-wide finance access, MFA and an atomic insert of payment history,
   new loan balance, state and audit. The operator cannot make repayments
   greater than the outstanding balance.
8. A loan cannot be marked paid off while an outstanding balance remains.
   A write-off, dispute or employer recovery is a separate governed workflow.

## Existing loans and employer rollout

The additive migration is
`drizzle/0103_independent_employee_loan_deductions.sql`. It changes the
default for **future new** loan records to `pending_approval`, stores the
stable preparer and checker IDs and inserts a DB constraint preventing a
newly prepared active/paused/paid-off loan from approving itself.

**Existing active and historical loans are NOT automatically paused, deleted,
backfilled with invented authorizations or marked illegitimate.** Their
requester IDs remain NULL, so they can continue under established employer
procedures; however, the organization should audit original deduction
authorization, outstanding balance and the prior repayment ledger before
claiming they meet the new independent-review standard. A legacy paused loan
with missing preparer ID cannot be resumed through this new route without an
independently approved migration/correction procedure.

Migration history in `drizzle/baseline.sql` stays untouched. Apply 0103 to
staging after verified backup and DBA approval, inspect payroll for already
active loan duplicates, and run a two-person employer pilot before rollout.

## Known limits

- An authorization **reference is metadata**, not proof of a signed employee
  agreement, legal deduction basis, agency instruction or actual disbursement.
  Do not convert an allegation of wage overpayment, missing equipment or
  disciplinary damage to an employee loan just to bypass recovery controls.
- This change does not introduce an arbitrary negative-payroll adjustment
  capability. Future alleged overpayment recovery requires explicit employee
  dispute and protected-wage handling, and must remain separated from this
  governed loan schedule.
- The source API still has other loan/payment writers in settlement/import
  modules. Existing payroll release uses conditional remaining-balance
  updates; staged concurrency and independently reconciled source records
  remain required. All new code paths are not automatically proven safe by
  static tests alone.
- Existing organization-role permissions do not constitute external
  verification of bank receipts. A field labelled verified needs supporting
  independent evidence and reconciliation.

## Required verification

- [ ] Full exact-commit TypeScript, Node/PostgreSQL integration tests,
  payroll golden reconciliation, CodeQL and Next build.
- [ ] Apply the additive migration to a backup-restored staging DB; confirm
  historical active loan statuses and balances are unchanged.
- [ ] Prove requester cannot approve/reapprove the same loan, company-wide
  checker can decide, department-scoped HR cannot activate, and fresh MFA is
  required under production policy.
- [ ] Verify pending/rejected/paused new loans never get deducted by
  `processNextPayrollJob`. Verify approved loan schedules respect the
  intended date window and voluntary/government payment-order rules.
- [ ] Attempt duplicate source reference, concurrent approval, pause/resume
  while a payroll run is preparing, double external repayment, excessive
  repayment, and a nonzero balance write-off. Every blocked request should
  leave the ledger and employee payslip unchanged.
- [ ] Fault-inject audit insertion failure; neither the payment record nor
  loan balance must survive.
- [ ] Independent employer payroll, statutory/legal, security/privacy and
  database reviewers must sign off on the actual source documents before
  any real deduction schedule is enabled.

No bank, payroll release, employee record, live deduction, or government
filing was initiated by this code PR. Keep it draft until operational proofs
and human approvals are complete.
