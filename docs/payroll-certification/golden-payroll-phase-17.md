# Golden payroll Phase 17: a 13th month the previous provider already paid

Phase 15 certified how the previous provider's imported **de minimis** shrinks
the shared PHP 90,000 pool in the calculated cutoffs of a provider-switch year,
but every imported row carried `thirteenthMonth: 0`. Phase 17 certifies the
other imported pool input: a 13th month the previous provider **already paid**.
It counts toward the exemption room the engine has left when it pays a bonus or
the 13th-month balance in December, so that payslip taxes the overflow instead
of leaving it to the year-end settlement. It also certifies the safe fallback:
when an imported row cannot be read, the engine assumes nothing.

This phase exercises the code added by #2013 (`src/lib/imported-benefit-prior.ts`
and its loader in `payroll-engine.ts`), so it is stacked on that PR.

- Catalog: `certification/golden-payroll-phase17.json` (hand-derived literals,
  zero centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase17.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase17-pg16.yml`, an empty disposable
  PG16 on GitHub Actions. The harness refuses to run anywhere else.

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

At 60,000 a month every contribution is at its cap, so a bonus or 13th month
does not change them: SSS 875, PhilHealth 750, Pag-IBIG 100 a cutoff (1,725).
An ordinary cutoff: gross 30,000, taxable 28,275, withholding
937.50 + 0.20 x (28,275 - 16,667) = 3,259.10, net 25,015.90.

January to June are six imported monthly rows per worker (withholding 6,518.20,
an empty de minimis breakdown `{}`, which is a readable known zero). July to
December are cutoffs 13-24 calculated by the engine. Pool benefits are paid
only in cutoff 23.

## Cases

| Case | Imported 13th (June) | Engine pays in cutoff 23 | Pool arithmetic in cutoff 23 | Cutoff 23 withholding |
|---|---|---|---|---|
| importedThirteenthShrinksRoom | 30,000 | 13th balance 30,000 + bonus 90,000 | prior 30,000, current 120,000, room 60,000: exempt 60,000, **taxable 60,000** | 18,253.30 |
| importedThirteenthLeavesRoom | 30,000 | bonus 50,000 | prior 30,000, current 50,000, room 60,000: all exempt | 3,259.10 |
| controlNoImportedThirteenth | 0 | 13th 60,000 + bonus 60,000 | prior 0, room 90,000: exempt 90,000, taxable 30,000 | 10,506.20 |
| unreadableHistoryAssumesNothing | 30,000, but the April row has no breakdown | 13th balance 30,000 + bonus 90,000 | worker unverifiable: prior 0, taxable 30,000 | 10,506.20 |

- **Case 1** is the headline. 88,275 taxable compensation is
  30,000 + 60,000 - 1,725, taxed at 16,770.70 + 0.30 x (88,275 - 83,333) =
  18,253.30. Without the imported 13th month in the pool the engine would
  withhold 10,506.20 and under-withhold 7,746.90 in that payslip.
- **Case 3** is the control and reproduces Phase 10's `bonusThenThirteenthSharePool`
  cutoff 23 (10,506.20) with the same year-end figures, so the only variable in
  case 1 is the imported 13th month.
- **Case 4** is the fallback: a worker whose imported history cannot be
  verified gets the unadjusted withholding (the same 10,506.20) and the run is
  held; the year-end settlement then still counts the imported 13th month.
- **Status and flags:** in cutoff 23 every case is `Exception` with the
  shared-pool flag ("does not identify the shared PHP 90,000"), because the
  import has no field for bonuses or other pool benefits, so the pool is only a
  verified lower bound. Every other cutoff is `Ready` with no flag. There is no
  de minimis grant, so the separate no-breakdown flag does not apply.

## Year end

Same convention as Phases 10 and 13: `thirteenthMonth` is max(entitlement,
paid); gross compensation adds the accrued unpaid 13th month; a refund is a
negative adjustment. Entitlement is basic earned / 12 = 60,000.

| Case | Gross compensation | Taxable | Tax due | Withheld | Result |
|---|---|---|---|---|---|
| importedThirteenthShrinksRoom | 870,000 | 738,600 | 90,220.00 | 93,212.60 | refund 2,992.60 |
| importedThirteenthLeavesRoom | 830,000 | 698,600 | 82,220.00 | 78,218.40 | collect 4,001.60 |
| controlNoImportedThirteenth | 840,000 | 708,600 | 84,220.00 | 85,465.50 | refund 1,245.50 |
| unreadableHistoryAssumesNothing | 870,000 | 738,600 | 90,220.00 | 85,465.50 | collect 4,754.50 |

Case 2 shows a design property worth knowing: the unpaid balance of the 13th
month is accrued only at year end, so the December payslip treats the 50,000
bonus as fully exempt, and the settlement collects 4,001.60 that the payslip
could not know.

## Result

All four cases pass against the engine with #2013. The harness was
mutation-checked, each mutation failing exactly one targeted case:
- the engine ignores the imported pool (pre-#2013 behavior): case 1 fails with
  withholding 10,506.20 instead of 18,253.30;
- the loader counts an unreadable worker as known: case 4 fails with
  withholding 18,253.30 instead of 10,506.20.

## What this does not certify

- Only the 13th month the previous provider reports in `thirteenthMonth` is
  counted. The import has no field for bonuses or other pool benefits.
- One salary level (60,000, every contribution capped) and one tax year.
- An imported 13th month combined with calculated-cutoff de minimis (Phase 15
  covers de minimis on its own).
- Whether the refund or collection is paid out.

## Run locally

Needs an empty disposable PG16 on `127.0.0.1:5432` with database `app_db`,
UTF-8 encoding, and the environment the harness checks (`CI`,
`GITHUB_ACTIONS`, `GOLDEN_PHASE17_DISPOSABLE=github-actions-pg16-only`,
payment and worker flags false, no provider secrets). See the workflow for the
exact set.

```
npm run db:push
node scripts/qa/apply-isolated-baseline.mjs
npx tsx scripts/golden-payroll-phase17.ts
```
