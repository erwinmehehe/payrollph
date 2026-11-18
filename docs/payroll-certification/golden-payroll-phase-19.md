# Golden payroll Phase 19: all three pool inputs at once

Phase 15 certified a calculated-cutoff de minimis grant with an imported de
minimis history, Phase 17 an imported 13th month, Phase 18 both imported
inputs. Phase 19 certifies **all three together**: a worker whose previous
provider reported a de minimis history and a 13th month, and whose employer
**also grants de minimis in the engine's own cutoffs**. The shared PHP 90,000
pool then fills from three sources at once, and the December payslip must tax
exactly what overflows. It also certifies that the de minimis ceiling is shared
across the two providers, and the safe fallback when an imported row cannot be
read.

- Catalog: `certification/golden-payroll-phase19.json` (hand-derived literals,
  zero centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase19.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase19-pg16.yml`, an empty disposable
  PG16 on GitHub Actions. The harness refuses to run anywhere else.

Test, catalog, doc and workflow only. **No engine, schema or runtime change.**

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

At 60,000 a month every contribution is at its cap with or without de minimis
(SSS 875, PhilHealth 750, Pag-IBIG 100 a cutoff, 1,725). January to June are
six imported monthly rows (withholding 6,518.20) with a `uniformClothing`
breakdown and, in June, the 13th month. The calculated grant is uniform and
clothing 6,000 a month from 2026-07-01 = 3,000 a cutoff in cutoffs 13-24
(36,000 in total). The 8,000 ceiling is shared across both providers.

An ordinary calculated cutoff: gross 33,000, taxable compensation 28,275,
withholding 3,259.10, net 28,015.90. The engine's pool before a cutoff is the
verified imported pool plus the pool of every earlier calculated cutoff.

## Cases

| Case | Imported de minimis / 13th | Calculated pool | December (cutoff 23) |
|---|---|---|---|
| allThreePoolInputsOverflowInDecember | 6,000 a month (28,000 excess) / 30,000 | grant excess 3,000 a cutoff: pool 58,000 grows to 88,000 by cutoff 22 | 13th balance 30,000 + grant 3,000 against room 2,000: **taxable 31,000**, withholding 10,756.20; cutoff 24 prior 121,000, grant fully taxable, withholding 3,859.10 |
| noImportedThirteenthControl | 6,000 a month / 0 | same grant | engine pays the whole 60,000 13th month: room 32,000, **taxable 31,000**, withholding 10,756.20, same cutoff 24 and same year end |
| ceilingSharedAcrossProviders | 1,000 a month (2,000 of the ceiling left) / 30,000 | cutoff 13: 2,000 exempt + 1,000 excess, then 3,000 excess a cutoff: pool 58,000 by cutoff 22 | 13th balance + grant 33,000 against room 32,000: **taxable 1,000**, withholding 3,459.10; cutoff 24 withholding 3,859.10 |
| unreadableImportAssumesNothing | as case 1, April names an unrecognised category | prior 0 and the ceiling untouched: exempt 3,000, 3,000, 2,000 then excess | nothing overflows: withholding stays 3,259.10 in every cutoff |

- **Case 1** is the headline: the pool is filled by all three sources and the
  overflow lands in December. Cutoff 23 taxable compensation is
  30,000 + 31,000 - 1,725 = 59,275, taxed at 4,270.70 + 0.25 x (59,275 - 33,333)
  = 10,756.20.
- **Case 2** reaches the same overflow with nothing imported but the
  de minimis, so cases 1 and 2 end the year with identical totals: the same
  money reaches the same pool by different routes.
- **Case 3** shows the ceiling is one ceiling: of the first calculated grant
  only the 2,000 the previous provider left is exempt, the rest is excess.
- **Case 4** is the fallback: the engine assumes nothing it cannot prove, so
  every payslip is withheld at the ordinary 3,259.10 and the run is held. Every
  cutoff carries the no-breakdown flag and the shared-pool flag starts in cutoff
  15 when the first excess appears. The year-end settlement reads the imported
  rows and recovers the difference.
- **Status and flags:** every calculated cutoff is `Exception` (the import has
  no field for bonuses or other pool benefits, so the pool is a verified lower
  bound). The shared-pool flag is on from cutoff 13 in cases 1-3 because the
  first grant already adds pool to an imported history.

## Year end

Same convention as Phases 10, 13, 17 and 18: `thirteenthMonth` is max(entitlement,
paid); a refund is a negative adjustment. Entitlement is 60,000, equal to what
was paid in every case, so nothing is accrued.

| Case | Gross compensation | Non-taxable | Taxable | Tax due | Withheld | Result |
|---|---|---|---|---|---|---|
| allThreePoolInputsOverflowInDecember | 852,000 | 139,400 | 712,600 | 85,020.00 | 86,315.50 | refund 1,295.50 |
| noImportedThirteenthControl | 852,000 | 139,400 | 712,600 | 85,020.00 | 86,315.50 | refund 1,295.50 |
| ceilingSharedAcrossProviders | 822,000 | 139,400 | 682,600 | 79,020.00 | 79,018.40 | collect 1.60 |
| unreadableImportAssumesNothing | 852,000 | 139,400 | 712,600 | 85,020.00 | 78,218.40 | collect 6,801.60 |

In case 3 the pool is 94,000 (13th month 60,000 + 34,000 grant excess), so 4,000
is taxable, which is exactly the 1,000 + 3,000 already withheld on in cutoffs 23
and 24. The settlement's tax due and the sum withheld differ only by the
1.60 collection.

## Result

All four cases pass against the real engine. Mutation-checked by editing
`src/lib/imported-benefit-prior.ts` or `src/lib/payroll-engine.ts` locally and
restoring it:

| Mutation | Fails |
|---|---|
| ignore the imported 13th month | cases 1 and 3 |
| ignore the imported de minimis excess | cases 1 and 2 |
| forget the excess of earlier calculated grants | cases 1, 2 and 3 |
| do not share the ceiling with the imported history | cases 1, 2 and 3 |
| count an unreadable worker as known | case 4 |

## What this does not certify

- Bonuses or other pool benefits from the previous provider: the import has no
  field for them, so the prior pool is a verified lower bound and the run stays
  held.
- One de minimis category, one grant level, one salary level (60,000, every
  contribution capped) and one tax year.
- Whether a held run can be released, or the refund or collection paid out.

## Run locally

Needs an empty disposable PG16 on `127.0.0.1:5432` with database `app_db`,
UTF-8 encoding, and the environment the harness checks (`CI`,
`GITHUB_ACTIONS`, `GOLDEN_PHASE19_DISPOSABLE=github-actions-pg16-only`,
payment and worker flags false, no provider secrets). See the workflow for the
exact set.

```
npm run db:push
node scripts/qa/apply-isolated-baseline.mjs
npx tsx scripts/golden-payroll-phase19.ts
```
