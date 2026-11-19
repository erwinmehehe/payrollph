# Golden payroll Phase 18: imported de minimis and imported 13th month together

Phase 15 certified an imported **de minimis** excess in the shared PHP 90,000
pool; Phase 17 certified an imported **13th month**. Each was proven with the
other input at zero. Phase 18 certifies a worker whose previous provider
reported **both**: the engine's prior pool in the calculated cutoffs must be the
sum of the two (de minimis excess over its category ceiling + 13th month already
paid), so the payslip that pays a bonus or the 13th-month balance in December
taxes exactly the overflow of the combined pool. It also certifies that de
minimis **inside** its ceiling consumes no pool room, and the safe fallback:
when an imported row cannot be read, the engine assumes nothing.

- Catalog: `certification/golden-payroll-phase18.json` (hand-derived literals,
  zero centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase18.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase18-pg16.yml`, an empty disposable
  PG16 on GitHub Actions. The harness refuses to run anywhere else.

Test, catalog, doc and workflow only. **No engine, schema or runtime change.**

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

Same as Phase 17: every contribution is capped (SSS 875, PhilHealth 750,
Pag-IBIG 100 a cutoff), an ordinary cutoff withholds 3,259.10 on 28,275 taxable.
January to June are six imported monthly rows (withholding 6,518.20). The
imported rows now carry a `uniformClothing` de minimis breakdown every month and,
in June, the 13th month. The engine grants no de minimis in this phase, so the
only de minimis is the imported history. Pool benefits are paid only in
cutoff 23.

The uniform and clothing ceiling is 8,000 a year, so 6,000 a month for six
months (36,000) is 8,000 exempt and **28,000 excess that joins the pool**;
1,000 a month (6,000) is wholly inside the ceiling and joins nothing.

## Cases

| Case | Imported de minimis / 13th | Engine pays in cutoff 23 | Pool arithmetic | Cutoff 23 withholding |
|---|---|---|---|---|
| importedDeMinimisAndThirteenthShareRoom | 6,000 a month (28,000 excess) / 30,000 | 13th balance 30,000 + bonus 40,000 | prior 58,000, current 70,000, room 32,000: exempt 32,000, **taxable 38,000** | 12,506.20 |
| importedDeMinimisOnlyControl | 6,000 a month / 0 | 13th 60,000 + bonus 40,000 | prior 28,000, current 100,000, room 62,000: exempt 62,000, **taxable 38,000** | 12,506.20 |
| deMinimisInsideCeilingConsumesNoRoom | 1,000 a month (no excess) / 30,000 | 13th balance 30,000 + bonus 90,000 | prior 30,000, current 120,000, room 60,000: taxable 60,000 | 18,253.30 |
| unreadableBreakdownAssumesNothing | 6,000 a month / 30,000, but April names an unrecognised category | 13th balance 30,000 + bonus 40,000 | worker unverifiable: prior 0, all 70,000 exempt | 3,259.10 |

- **Case 1** is the headline. Taxable compensation is
  30,000 + 38,000 - 1,725 = 66,275, taxed at 4,270.70 + 0.25 x (66,275 - 33,333)
  = 12,506.20. An engine that counted only the 13th month would see room 60,000
  and tax 10,000; one that counted only the de minimis excess would see room
  62,000 and tax 8,000; neither matches.
- **Case 2** reaches the same 38,000 taxable overflow by a different route (the
  whole 60,000 13th month paid by the engine, nothing imported), so cases 1 and 2
  also end the year with the same totals: the same money reaches the same pool.
- **Case 3** is the boundary: 6,000 of de minimis inside the 8,000 ceiling is
  exempt on its own and must not take room from the 90,000 pool. Its December
  figures equal Phase 17's first case.
- **Case 4** is the fallback: a worker whose imported history cannot be verified
  gets the ordinary withholding and the run is held; the year-end settlement
  then still counts the imported rows.
- **Status and flags:** in cutoff 23 every case is `Exception` with the
  shared-pool flag, because the import has no field for bonuses or other pool
  benefits. Every other cutoff is `Ready` with no flag.

## Year end

Same convention as Phases 10, 13 and 17: `thirteenthMonth` is max(entitlement,
paid); gross compensation adds the accrued unpaid 13th month; a refund is a
negative adjustment. Entitlement is basic earned / 12 = 60,000.

| Case | Gross compensation | Non-taxable | Taxable | Tax due | Withheld | Result |
|---|---|---|---|---|---|---|
| importedDeMinimisAndThirteenthShareRoom | 856,000 | 139,400 | 716,600 | 85,820.00 | 87,465.50 | refund 1,645.50 |
| importedDeMinimisOnlyControl | 856,000 | 139,400 | 716,600 | 85,820.00 | 87,465.50 | refund 1,645.50 |
| deMinimisInsideCeilingConsumesNoRoom | 876,000 | 137,400 | 738,600 | 90,220.00 | 93,212.60 | refund 2,992.60 |
| unreadableBreakdownAssumesNothing | 856,000 | 139,400 | 716,600 | 85,820.00 | 78,218.40 | collect 7,601.60 |

Non-taxable is the exempt pool (at most 90,000) + de minimis inside its ceiling
(8,000, or 6,000 in case 3) + statutory contributions 41,400.

## Result

All four cases pass against the real engine. Mutation-checked by editing
`src/lib/imported-benefit-prior.ts` locally and restoring it:

| Mutation | Fails |
|---|---|
| ignore the imported 13th month | cases 1 and 3 |
| ignore the imported de minimis excess | cases 1 and 2 |
| count de minimis inside the ceiling as pool | cases 1, 2 and 3 |
| count an unreadable worker as known | case 4 |

## What this does not certify

- A calculated-cutoff de minimis **grant** on top of both imported inputs.
  Phase 15 covers a calculated grant with imported de minimis, Phase 17 an
  imported 13th month, and this phase both imported inputs; all three together
  remain uncertified.
- Bonuses or other pool benefits from the previous provider: the import has no
  field for them, so the prior pool is a verified lower bound and the run stays
  held.
- One de minimis category, one salary level (60,000, every contribution capped)
  and one tax year.
- Whether the refund or collection is paid out.

## Run locally

Needs an empty disposable PG16 on `127.0.0.1:5432` with database `app_db`,
UTF-8 encoding, and the environment the harness checks (`CI`,
`GITHUB_ACTIONS`, `GOLDEN_PHASE18_DISPOSABLE=github-actions-pg16-only`,
payment and worker flags false, no provider secrets). See the workflow for the
exact set.

```
npm run db:push
node scripts/qa/apply-isolated-baseline.mjs
npx tsx scripts/golden-payroll-phase18.ts
```
