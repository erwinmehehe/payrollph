# HCM loan ledger integrity: negative deduction and repayment safeguards

## Why this change is needed

Loan schedules in Linaw feed directly into payroll net-pay calculations. The
legacy loan API accepted unvalidated cutoff amounts, allowed HR-scoped users to
create automatic deductions, wrote manual payments/balances/audit as separate
transactions, and could mark an outstanding loan `paid_off` without settling
its money. A manual payment had a fabricated generic reference. These are
payroll-integrity issues, not cosmetic form problems.

This is **not** a new overpayment-recovery or wage-clawback workflow.
An employee's historical overpayment, disputed wage recovery, tax reassessment
or final-pay offset cannot be entered as an arbitrary loan type.

## Loan registration

- Only an authorized **company-wide payroll/finance operator** with recent MFA
  and a rate-limit allowance can create a loan that may deduct from wages.
- Only the seven existing SSS, Pag-IBIG and documented company-loan categories
  are accepted; free-text/overpayment-recovery loan types are rejected.
- Reference numbers and an independent **loan authorization/government notice
  evidence reference** are required. The operator attests to that evidence;
  entering a string does **not** independently verify employee consent.
- All principal, monthly amortization and per-cutoff deduction amounts require
  exact positive centavos, field precision, and a cutoff amount not exceeding
  the monthly installment or loan principal.
- Start/end dates are validated as actual calendar dates. The existing payroll
  engine already respects those dates when selecting loan deductions.
- Separating/separated workers cannot be registered for a new automatic
  deduction; any unresolved final-pay debt needs its own review.
- Concurrent registrations are serialized per employer. The same worker,
  loan category and reference cannot be registered twice, including if a
  previous loan has already been marked paid.
- Loan and actor audit insert commit in one database transaction.

## Direct repayments

- Only company-wide finance/payroll with MFA may record an external loan
  repayment. It requires an exact positive centavo amount and an **8-120
  character unique actual receipt/bank transaction reference**.
- The loan row is locked inside the transaction. After rechecking the current
  balance, status and prior payment reference, the payment, balance update,
  paid-off decision and actor audit all commit together or roll back.
- A balance cannot go below zero, a paid-off loan cannot receive another
  payment, and repeating the same receipt cannot double-credit the ledger.
  The ledger treats references case-insensitively for this loan.
- A manually entered receipt reference remains **human-attested**, not proof
  that a bank or employee actually sent funds. External settlement must be
  reconciled before recording the payment.

## Pause, resume and close

- These payroll-impacting transitions now require company-wide payroll/finance
  authorization, MFA, rate limiting, and an atomic actor audit.
- A paused loan can resume automatic deductions only for an Active or
  On-leave worker with money still outstanding.
- "Close" cannot erase debt: if money remains due, use Pause while initiating
  an approved write-off or recovery case. Only a fully paid loan can become
  `paid_off`.

## Release gates

1. Run exact-head TypeScript, full Node/PostgreSQL tests, Next production build,
   CodeQL, payroll golden test, payout-isolation smoke and backup/restore tests.
2. Stage two identical loan-creation requests and prove exactly one loan
   becomes active. Exercise scoped HR denial, MFA, negative cutoff input, fake
   start dates and unknown `overpayment` types.
3. Stage two concurrent manual repayment attempts against one loan (same and
   different receipts) and a concurrent payroll release. Verify conservation
   of principal, remaining balance and totalPaid and exact one-time payments.
4. Inject failure at audit insertion and confirm every preceding payment and
   balance update rolls back. An isolated PostgreSQL test covers this.
5. Independently verify government loan notices, company-loan borrower
   authorization, payroll cutoff deduction dates, minimum take-home safeguards
   and employer-specific consent requirements with qualified HR/payroll/legal
   reviewers. CI cannot provide legal authorization.
6. Before merging: review any employers relying on scoped HR to manage loans
   or default generic payment references. Their operators must be moved to
   appropriate finance roles and historical receipts reconciled.

**Remaining work:** negative overpayment recovery proposals, employee
objection/appeal, discretionary loan forgiveness and independently reviewed
write-offs must be designed as distinct maker-checker processes. They are not
new loan types and must not be implemented as unaudited negative earnings.

No schema migration was introduced; this PR changes API authorization and
financial integrity only. It does not authorize live money transfers, bank
disbursements, historical wage recovery or a production deployment.
