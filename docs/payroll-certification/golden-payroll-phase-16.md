# Golden payroll Phase 16: a hire that starts inside a cutoff

Phase 9 certified a mid-year hire that starts exactly on a cutoff boundary
(2026-07-01). Phase 16 certifies the hire that starts **inside** a cutoff, which
no earlier phase covered: the earned fraction of the semi-monthly salary, the
provisional first-cutoff statutory deductions, the month-final true-up in the
second cutoff of the month, the withholding on each payslip, and the year-end
refund.

- Catalog: `certification/golden-payroll-phase16.json` (hand-derived literals,
  zero centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase16.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase16-pg16.yml`, an empty disposable
  PG16 on GitHub Actions. The harness refuses to run anywhere else.

## Cases (monthly salary 30,000, `split` statutory timing, tax year 2026)

| Case | Starts | Cutoff 13 (Jul 1-15) | Cutoff 14 (Jul 16-31) |
|---|---|---|---|
| hiredMidFirstCutoff | Thu 2026-07-09 | basic 15,000 x 7/15 = 7,000.00; SSS 350, PhilHealth 375, Pag-IBIG 100; withholding 0.00; net 6,175.00 | basic 15,000; SSS 750, PhilHealth 375, Pag-IBIG 100; withholding 503.70; net 13,271.30 |
| hiredOnSecondCutoffStart | Thu 2026-07-16 | no payslip (not yet employed) | basic 15,000; SSS 750, PhilHealth 750, Pag-IBIG 200; withholding 432.45; net 12,867.55 |

From cutoff 15 both workers are on a full month: withholding 503.70, net 13,271.30.

### Derivations

- **Proration.** The semi-monthly salary times calendar days employed over
  calendar days in the cutoff. This is the engine's contract, not a statutory
  formula; the case pins it so any change is deliberate.
- **Provisional first cutoff (H1).** SSS and Pag-IBIG are on twice the cutoff
  pay (14,000): SSS credit 14,000, 700 a month, 350 in the cutoff; Pag-IBIG
  2% of 14,000 is capped at 200 a month, 100 in the cutoff. PhilHealth is 5%
  of the full monthly basic, 750 a month, 375 a cutoff. Taxable
  7,000 - 825 = 6,175, below 10,417, so no tax.
- **Month-final true-up (H1, cutoff 14).** Actual July pay is 22,000: SSS credit
  22,000, 1,100 for the month, less 350 collected = 750. PhilHealth 750 - 375 =
  375. Pag-IBIG 200 - 100 = 100. Taxable 15,000 - 1,225 = 13,775; tax
  0.15 x (13,775 - 10,417) = 503.70.
- **Hire on the second cutoff (H2, cutoff 14).** The whole actual month is
  settled in the one cutoff: July pay 15,000, SSS credit 15,000 = 750;
  PhilHealth 750 (not prorated for a part-month); Pag-IBIG 2% of 15,000 capped
  at 10,000 = 200. Taxable 15,000 - 1,700 = 13,300; tax
  0.15 x (13,300 - 10,417) = 432.45.

### Year end

Same convention as Phase 9: gross compensation includes the accrued 13th month
(basic earned / 12), exempt under the 90,000 ceiling; non-taxable = 13th month
plus statutory contributions; a refund is a negative adjustment.

| Case | Gross compensation | 13th month | Contributions | Taxable | Withheld | Result |
|---|---|---|---|---|---|---|
| hiredMidFirstCutoff | 186,333.33 | 14,333.33 | 14,300.00 | 157,700.00 | 5,540.70 | refund 5,540.70 |
| hiredOnSecondCutoffStart | 178,750.00 | 13,750.00 | 13,950.00 | 151,050.00 | 5,469.45 | refund 5,469.45 |

Both are below the 250,000 annual exemption, so tax due is 0.00 and everything
withheld is refunded.

## Result

Both cases pass against the engine on `main` on the first run: no engine
discrepancy was found in this path. The harness was mutation-checked:
- proration off by one day: 25 mismatches;
- first-cutoff SSS estimate halved: 7 mismatches (also shows the true-up in
  cutoff 14 compensating, SSS 925 instead of 750).

## What this does not certify

- Fixed monthly pay only. Daily and hourly workers are Phase 8; separation is
  Phase 7.
- Calendar-day proration is a policy, not a statutory formula.
- The provisional first-cutoff SSS estimate is the engine's documented method;
  the month-final total, which is what SSS bills, is what the true-up certifies.
- One tax year (2026) and one salary level (30,000).

## Run locally

Needs an empty disposable PG16 on `127.0.0.1:5432` with database `app_db`, UTF-8
encoding, and the environment the harness checks (`CI`, `GITHUB_ACTIONS`,
`GOLDEN_PHASE16_DISPOSABLE=github-actions-pg16-only`, payment and worker flags
false, no provider secrets). See the workflow for the exact set.

```
npm run db:push
node scripts/qa/apply-isolated-baseline.mjs
npx tsx scripts/golden-payroll-phase16.ts
```
