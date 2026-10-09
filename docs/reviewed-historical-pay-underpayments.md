# Independently reviewed historical basic-pay underpayments

This is a **narrow, high-control workflow**, not a generic retroactive salary
editor, loan recovery, negative payroll clawback, income-tax amendment, or
government remittance correction.

## What it does

An authorized company-wide payroll maker can submit an **unpaid positive
basic-salary amount** from an already **Released** source payroll run and its
exact employee register entry. The request captures its positive centavo
amount, future/open-cutoff date, HR/finance evidence reference, calculation
rationale and SHA-256 fingerprint of the immutable source register.

A different, company-wide payroll/tax approver with fresh MFA must compare the
source, rationale, statutory treatment and sign-off reference. Reject creates
no posting. Approve atomically writes:

- an approved, one-time **other_taxable** supplementary earning with statutory
  SSS and Pag-IBIG inclusion flags enabled;
- a link back to the exact independently reviewed correction;
- the reviewer identity, decision and append-only actor audit evidence.

The payroll engine already calculates supplementary earnings into the selected
cutoff's gross, tax and statutory bases and the payroll settlement process
marks each earning **settled once** upon the actual released payroll. The
generic supplementary earning void API now rejects approved corrections linked
to this reviewer ledger. The original payroll, base pay profile, employee
salary revisions and original government filings stay unchanged.

## Deliberate limitations

- Only **positive basic-pay underpayments up to PHP 1,000,000**. Do not use it
  for tax-only differences, statutory contribution corrections, offboarding,
  negative recovery, terminated employees, or a promotion effective in the past.
  Those require distinct, legally reviewed workflows.
- **Posting is not payment.** The adjustment must be calculated, independently
  checked, explicitly released and settled via the standard payroll workflow.
- Only an empty **Draft** payroll cutoff may receive a correction. The
  request/approval transaction row-locks existing applicable payroll runs and
  fails if one has already progressed; other payroll jobs cannot update those
  rows until the correction commits. A run already processed, released, queued
  or otherwise progressed must be left untouched; request a new correction
  for a later cutoff. Concurrent *new* run creation still needs staging tests.
- The review reference is **evidence metadata**, not proof that a CPA, tax
  specialist or employer has actually signed off. The reviewer must compare
  documented wage and statutory treatment outside this automated approval
  before approving a real adjustment.
- The route requires an immutable source register, worker currently eligible
  for ordinary payroll and a current or future effective date.
- The Released source must contain **exactly one** entry for that worker/run
  with an actual BASIC earnings line. Missing, duplicated or unrelated
  source records block the correction. The SHA-256 fingerprint includes the
  released entry's gross/net/deductions, line items, status and calculation
  trace, not just its employee ID; payroll officers must reconcile broken
  source evidence before posting.
- One pending/posted correction for a given organization, employee and released
  source run is permitted. Multi-correction or reversal scenarios need
  separate approval/evidence design.
- A generic supplementary earnings POST still supports unrelated earnings.
  That feature is a different controlled workflow. This PR does not certify
  all supplemental pay sources or historical salary adjustment pathways.

## Rollout and high-stakes verification

1. Apply `drizzle/0101_reviewed_payroll_underpayments.sql` to a staging clone
   with full backup/migration rehearsal. The historical `drizzle/baseline.sql`
   must remain immutable; for a fresh DB, `db:push` creates the current full
   schema, or apply the historical baseline followed by the new additive
   migration. No production migration should run automatically.
2. Run exact-head CI with PostgreSQL 16, the full TypeScript/Node/build checks,
   revenue/tax/payroll goldens, dependency security checks and backup rehearsal.
3. Test maker/checker separation with two separate accounts, independent MFA,
   cross-tenant and department-scoped denials and an attempted concurrent
   double approval.
4. Simulate a Released source payroll and open later Draft. Check original
   payroll gross/net/entries and base salary are byte-for-byte identical after
   review; only the approved one-time earning is new.
5. Calculate the later payroll and verify its earned pay, SSS, PhilHealth,
   Pag-IBIG, withholding, payslip line, payroll approval snapshot, register
   and settlement against independent Philippine payroll/accounting reference.
6. Attempt repeat settlement, generic supplementary-earning void, late editing,
   stale fingerprint, approval after cutoff process, and an audit-insert fault.
   No partial or duplicate wage changes may survive.
7. Obtain independent Philippine payroll, HR and tax/compliance reviewer
   signoffs on classification; require documented customer approval and
   privacy/security review before enabling any real-money rollout.

This is a **draft code release candidate** and does not satisfy external BIR,
SSS, PhilHealth or Pag-IBIG acceptance gates. No code changes alone constitute
independent tax or legal sign-off.
