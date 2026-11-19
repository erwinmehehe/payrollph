# Golden payroll Phase 22: overtime, night differential and holiday pay in a provider-switch year

Phase 3 certified the pay-rule premium families in an ordinary year, and Phase 20
listed overtime, night-differential and holiday premiums for a minimum wage earner
(MWE) as not exercised. Phase 22 certifies them in a provider-switch year.

In cutoff 23 two workers on the same salary and the same time records earn
statutory overtime, night differential and special-holiday pay. **The pay is
identical; the tax is not.** An MWE withholds 0; an ordinary taxpayer withholds
249.83. The premiums also lift the SSS base but not the PhilHealth or Pag-IBIG
base, and the SSS month is trued up in the second cutoff.

- Catalog: `certification/golden-payroll-phase22.json` (hand-derived literals,
  zero centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase22.ts` (real time punches and approved
  overtime requests, real engine, real `runYearEndAnnualization`, two employers)
- CI: `.github/workflows/golden-payroll-phase22-pg16.yml`, an empty disposable
  PG16 on GitHub Actions. The harness refuses to run anywhere else.

Test, catalog, doc and workflow only. **No engine, schema or runtime change.**

## Setup (tax year 2026, `split` timing, monthly salary 17,600)

Daily 800, hourly 100 (17,600 / 22 / 8), so a cutoff's basic pay is 8,800.
January to June are six imported monthly rows for the workers with imported
history (SSS 875, PhilHealth 440, Pag-IBIG 200, withholding 0); July to December
are cutoffs 13-24 calculated by the engine. An ordinary cutoff withholds 0 (taxable
8,042.50 is inside the exempt first bracket) and nets 8,042.50.

## Cutoff 23 time records (every worker)

Shift 09:00-18:00, break 12:00-13:00.

| Days | Out | Approved overtime | Pay |
|---|---|---|---|
| Dec 1, 3, 4, 7, 9, 10, 11, 14, 15 (nine weekdays) | 21:00 | 180 min | 3 h x 100 x 1.25 = 375.00 each, 3,375.00 |
| Dec 2 | 23:00 | 300 min | 5 h x 100 x 1.25 = 625.00 overtime, plus 22:00-23:00 night differential 1 h x 100 x 1.25 x 10% = 12.50 |
| Dec 8 (special non-working day) | 18:00 | none | 8 h x 100 x 30% = 240.00 holiday premium |

Overtime 4,000.00, night differential 12.50, holiday premium 240.00: gross
8,800 + 4,252.50 = **13,052.50**.

## The two workers with imported history

| | Gross | SSS | PhilHealth | Pag-IBIG | Withholding | Net |
|---|---|---|---|---|---|---|
| MWE, cutoff 23 | 13,052.50 | 650.00 | 220 | 100 | **0** | 12,082.50 |
| Ordinary, cutoff 23 | 13,052.50 | 650.00 | 220 | 100 | **249.83** | 11,832.67 |
| Either, cutoff 24 | 8,800 | 450.00 | 220 | 100 | 0 | 8,030.00 |

- **SSS** in cutoff 23 projects the contracted salary plus twice the extra
  remuneration: 17,600 + 2 x 4,252.50 = 26,105, credit 26,000, 5% = 1,300, half
  650.00. Cutoff 24 trues the month up: compensation 17,600 + 4,252.50 = 21,852.50,
  credit 22,000, 5% = 1,100, so 1,100 - 650 = **450.00**. PhilHealth and Pag-IBIG
  stay 220 and 100: their base is the fixed basic salary only.
- **Ordinary tax:** taxable 13,052.50 - 650 - 220 - 100 = 12,082.50;
  15% x (12,082.50 - 10,417) = 249.825 = 249.83.
- **MWE tax:** the statutory premiums are exempt, the taxable supplementary
  compensation is 0, so withholding is 0.

## Employer A year end: skip and report

- The **MWE with imported history is skipped and reported** (summary and audit
  event, no adjustment row), exactly as in Phase 20.
- The **ordinary worker settles**: entries imported 6 x 17,600 = 105,600 plus
  engine 11 x 8,800 + 13,052.50 = 109,852.50, so 215,452.50; entitlement
  (105,600 + 105,600) / 12 = 17,600 accrued unpaid, so gross compensation
  **233,052.50**; contributions imported 6 x 1,515 = 9,090 plus engine SSS
  5,475 + PhilHealth 2,640 + Pag-IBIG 1,200 = **18,405**; non-taxable
  17,600 + 18,405 = 36,005; taxable 197,047.50 is under the 250,000 exemption, tax
  due 0. The 249.83 withheld in cutoff 23 is **refunded**.

## Employer B: an MWE hired at the switch

Same time records, no imported rows, so year end runs: entries 109,852.50 plus the
accrued 13th month 8,800, gross compensation **118,652.50**; contributions
9,315; non-taxable 8,800 + 9,315 = 18,115; an MWE's taxable income is only its
taxable supplementary compensation less contributions, so **0**; tax due 0, nothing
withheld: **balanced**. The 4,252.50 of overtime, night and holiday pay never
becomes taxable.

## Result

All four cases pass against the real engine. Every expected value was derived by
hand and confirmed against an exploratory run before it was written into the
catalog. Mutation-checked by editing the engine or year end locally and restoring it:

| Mutation | Fails |
|---|---|
| treat an ordinary worker's overtime pay as exempt (`payroll-engine.ts`) | the ordinary worker |
| leave overtime pay out of the SSS base (`payroll-engine.ts`) | all three workers |
| force MWE status off in the engine (`payroll-engine.ts`) | both MWE workers (withholding 249.83 instead of 0) |
| year end ignores MWE status (`year-end.ts`) | the MWE hire |
| **count the MWE's overtime as taxable supplementary compensation** | **not caught** (see below) |

## What this does not certify

- **That each premium is exempt on its own.** At this salary the MWE's premiums
  less contributions stay inside the exempt first bracket, so counting the
  overtime as taxable supplementary compensation would still withhold 0, and a
  mutation that did exactly that passed. The phase proves MWE status removes the
  tax an ordinary worker owes on identical pay (0 against 249.83), not the
  isolation of each premium. A larger MWE premium would be needed and is not
  realistic at a statutory minimum wage.
- **Year-end MWE status comes only from the legacy `employees.mwe` flag**, never
  from the approved effective-dated classification the cutoffs use (observed in
  `src/lib/year-end.ts`). The fixtures set both, so this is not exercised, and at
  these salaries the annual tax is 0 either way.
- Pay-policy premiums (a collective bargaining or company rule) carry their own
  `taxable` flag, and for an MWE the engine counts only what the rule marks
  taxable; that is the policy author's declaration and is not exercised here.
- One salary, one cutoff of premiums, one special non-working day, one night hour.
  A regular holiday (200%), rest-day or holiday-and-rest-day combinations, a night
  shift crossing midnight and hazard pay are not exercised.
- Whether the refund or collection is paid out.

## Run locally

Needs an empty disposable PG16 on `127.0.0.1:5432` with database `app_db`,
UTF-8 encoding, and the environment the harness checks (`CI`,
`GITHUB_ACTIONS`, `GOLDEN_PHASE22_DISPOSABLE=github-actions-pg16-only`,
payment and worker flags false, no provider secrets). See the workflow for the
exact set.

```
npm run db:push
node scripts/qa/apply-isolated-baseline.mjs
npx tsx scripts/golden-payroll-phase22.ts
```
