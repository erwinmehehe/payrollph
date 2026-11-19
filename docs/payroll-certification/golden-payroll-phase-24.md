# Golden payroll Phase 24: a loan repayment is not a statutory contribution

Year-end annualization must not treat an employee's loan repayment as a SSS,
PhilHealth or Pag-IBIG contribution. The line parser did, by label text, and Phase 24
certifies the corrected behaviour.

- Catalog: `certification/golden-payroll-phase24.json` (hand-derived literals,
  zero centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase24.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase24-pg16.yml`, an empty disposable
  PG16 on GitHub Actions. The harness refuses to run anywhere else.

Like Phase 23 this phase ships with a **calculation change**
(`src/lib/year-end.ts`). It is a T3 payroll change.

## The defect

The engine writes a loan repayment as the line `LOAN-<id>` labelled
`Loan, <loan type>`, and the loan type is free text whose own examples are
"SSS Salary Loan" and "Pag-IBIG Multi-Purpose Loan". `sumContributionsAndTax` in
`src/lib/year-end.ts` counted any negative line whose label contained "sss",
"philhealth" or "pag-ibig" as an employee contribution. A repayment on a government
loan was therefore added to `statutoryContributions`, which is a non-taxable bucket:
taxable income fell by the repayments and the year-end refund grew by 15% (or more) of
them. The same label match would catch an earned wage advance recovery (`EWA-`) or a
benefit plan deduction (`BEN-`) whose label names an agency.

The cutoff itself was right: loan repayments are taken from net pay after tax and never
changed withholding. Only year end was wrong.

The fix excludes the `LOAN-`, `EWA-` and `BEN-` code families before the label is read.
SSS, PHIC and HDMF are unchanged, and a line with no code or an older code still falls
back to the label, so imported or legacy lines keep working.

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

Three workers hired 2026-07-01, so only the 12 engine cutoffs exist. An ordinary
cutoff: gross 30,000; SSS 875, PhilHealth 750, Pag-IBIG 100; withholding 3,259.10.
Each loan is active with a balance of twelve repayments.

## Cases

| Case | Loan repayments | Cutoff net pay | Year end |
|---|---|---|---|
| noLoanControl | none | 25,015.90 | contributions 20,700, taxable 339,300, tax 13,395.00, withheld 39,109.20, **refund 25,714.20** |
| sssSalaryLoan | 500.00 a cutoff (6,000.00) | 24,515.90 | identical to the control |
| pagibigAndCompanyLoans | Pag-IBIG MPL 400.00 + company loan 250.00 a cutoff | 24,365.90 | identical to the control |

Hand derivation: a loan does not change gross, contributions or withholding, so each
loan worker's year end is the control's: gross 360,000 + 30,000 accrued 13th month =
390,000; non-taxable 30,000 + 20,700 = 50,700; taxable 339,300; tax
15% x 89,300 = 13,395.00; refund 39,109.20 - 13,395.00 = 25,714.20.

## What the original code did (observed, the phase fails on it)

Running this harness against the original `year-end.ts`:

| Case | Original result | Effect |
|---|---|---|
| sssSalaryLoan | contributions **26,700**, non-taxable 56,700, taxable 333,300, tax **12,495.00**, refund **26,614.20** | refund **900.00 too large** (15% of 6,000.00) |
| pagibigAndCompanyLoans | contributions **25,500**, non-taxable 55,500, taxable 334,500, tax **12,675.00**, refund **26,434.20** | refund **720.00 too large** (15% of 4,800.00); the company loan never matched |

These are exactly the values derived by hand before the run.

## Result

All three cases pass. `tests/year-end-line-treatment.test.ts` gained two tests: the
three excluded families (it fails on the original code, counting 3,925 where 1,725 is
right) and the fallback for a contribution line with no or an older code.

## What this does not certify

- **Earned wage advance and benefit plan deductions** are excluded by the same change
  and covered by the parser unit test, not by a real-engine case.
- **Final pay (separation)** reads contributions by exact code, so it does not have
  this defect. It does very likely have the Phase 23 defect (non-taxable earnings
  counted in the year-to-date gross), which needs a pinned-route change and is not
  fixed here.
- **Rows already computed** under the old rule change only when year end is
  recomputed. The stored rule version string is unchanged.
- One salary, `split` timing, a worker hired at the switch, loans never limited by
  disposable pay.

## Run locally

Needs an empty disposable PG16 on `127.0.0.1:5432` with database `app_db`, UTF-8
encoding, and the environment the harness checks (`CI`, `GITHUB_ACTIONS`,
`GOLDEN_PHASE24_DISPOSABLE=github-actions-pg16-only`, payment and worker flags false,
no provider secrets). See the workflow for the exact set.

```
npm run db:push
node scripts/qa/apply-isolated-baseline.mjs
npx tsx scripts/golden-payroll-phase24.ts
```
