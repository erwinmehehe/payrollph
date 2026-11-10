# Golden payroll certification — Phase 11: loans and deductions

Phase 11 adds an independent **test-only** certification suite for the first-cutoff money waterfall and the existing employee-loan rules. It follows the merged Phase 10 suite and does not edit the payroll engine, schema, payroll APIs, loan authorization logic, release behavior, payout configuration or feature flags.

Run: `npx tsx scripts/golden-payroll-phase11.ts` against the same **disposable PostgreSQL** used by CI. Expected pesos and centavos in `certification/golden-payroll-phase11.json` are independent, hand-derived literals. An exact reconciliation artifact is written to `qa-artifacts/golden-payroll-phase11-reconciliation.json`; any one-cent difference fails CI.

## Engine-backed scenarios

- Ordinary statutory/withholding baseline and an active company loan.
- An SSS salary loan, a last installment capped at outstanding principal, pending/paused/paid-off loans, future/expired loans and inclusive effective-date boundaries.
- Optional Pag-IBIG savings of PHP 200 in a first cutoff. These savings and loan repayments do **not** change the taxable base or withholding.
- Combined company plus government loans with sufficient funds.
- A low-pay case where the company loan was **inserted first**, yet the government loan receives priority after mandatory and voluntary deductions. PHP 4,025 remains for loans; SSS receives PHP 4,000, company receives PHP 25, and net pay stays PHP 0. The unpaid company installment raises an Exception instead of silently disappearing.
- An invalid legacy loan schedule (zero installment) must fail closed with an Exception, no applied loan line and no accidental wage credit.

Every engine-backed case creates a fictional employer, worker, pay profile and optional loan rows; runs the **real enqueue/drain pipeline**; compares statutory, taxable, withholding, voluntary, loan-requested, loan-applied, deductions and net values; checks the actual per-loan payslip lines and printed gross-to-net reconciliation; verifies calculations do not post loan payments or alter balances; and deletes its employer fixture.

## Exact settlement helper checks

Separate pure helper checks pin a PHP 125.25 payoff to a zero balance, a PHP 300.10 partial repayment, refusal of a one-cent overpayment, malformed subcent input, zero repayment, and one-cent replay mismatches. They **do not** invoke a real payroll release or post a loan payment.

## Safety and acceptance

- CI step and retained artifact added in `.github/workflows/ci.yml`; the fail-closed required-check regression also requires Phase 11. `package.json` stays untouched because existing source-pin checks cover it.
- No schema migration, new feature flag, live company data, payment provider, fund movement or release/approval authorization.
- This is a **draft certification candidate**. The exact-head CI result, mutation sensitivity and independent payroll/tax/legal review remain prerequisites before claiming acceptance or relying on these values for live deductions.
- Loan-repayment end-to-end release posting, authorization evidence, wage advances, benefits enrollments, final pay, annualization, second-cutoff true-up, daily/hourly workers and real-world lawful deduction limits are deliberately excluded.

Source rules: `src/lib/payroll-engine.ts`, `src/lib/payroll-loan-approval.ts`, `src/lib/payroll-loan-settlement.ts`. The statutory baseline aligns with earlier golden Phase 6/8/10 catalogs.
