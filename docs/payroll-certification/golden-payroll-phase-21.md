# Golden payroll Phase 21: a bonus paid on top of imported history

Phases 15-18 certified the imported de minimis excess and the imported 13th month
in the shared PHP 90,000 pool. The import has **no field for bonuses or other pool
benefits**, so the engine's prior pool is a verified lower bound. Phase 21
certifies what that means in practice when the engine pays a bonus on top of
imported history: the hold, the 90,000 cap, the carry-forward between cutoffs, the
exact year-end settlement when the previous provider's bonus is invisible, and
that a worker with no imported history is not held.

- Catalog: `certification/golden-payroll-phase21.json` (hand-derived literals,
  zero centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase21.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase21-pg16.yml`, an empty disposable
  PG16 on GitHub Actions. The harness refuses to run anywhere else.

Test, catalog, doc and workflow only. **No engine, schema or runtime change.**

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

Same as Phases 17 and 18: every contribution is capped (SSS 875, PhilHealth 750,
Pag-IBIG 100 a cutoff, 1,725), an ordinary cutoff withholds 3,259.10 on 28,275
taxable. January to June are six imported monthly rows (withholding 6,518.20).
Here the imported rows carry **no** 13th month and a readable all-zero de minimis
breakdown, so the history is verifiable but contains no pool item the engine can
read. Bonuses are approved supplementary earnings of type `bonus`.

## Cases

| Case | Imported | Engine pays | Cutoff 23 pool arithmetic | Cutoff 23 |
|---|---|---|---|---|
| bonusInsideRoomStillHeld | nothing | bonus 30,000 in cutoff 23 | prior 0, room 90,000: exempt 30,000, taxable 0 | withholding 3,259.10, **Exception + flag** |
| bonusOverflowHeld | nothing | bonus 100,000 in cutoff 23 | exempt 90,000, **taxable 10,000** | withholding 5,506.20, Exception + flag |
| bonusSplitAcrossTwoCutoffs | nothing | bonus 60,000 in cutoff 21 and 60,000 in 23 | cutoff 21: exempt 60,000; cutoff 23: **prior 60,000**, room 30,000, taxable 30,000 | 21: 3,259.10; 23: 10,506.20; both Exception + flag |
| importedBonusInvisibleToEngine | a 50,000 bonus inside the June gross, with no field for it | bonus 90,000 in cutoff 23 | engine sees prior 0: exempt 90,000, taxable 0 | withholding 3,259.10 (under-withholds), Exception + flag |
| noImportedHistoryControl | no imported rows (hired 2026-07-01) | bonus 50,000 in cutoff 23 | exempt 50,000, taxable 0 | withholding 3,259.10, **Ready, no flag** |

- **Case 1** is the hold even when nothing is taxable. The 30,000 bonus is fully
  exempt, yet the run is held, because the import cannot prove the prior pool is empty.
- **Case 3** is the carry-forward. The engine adds cutoff 21's bonus to the prior
  pool in cutoff 23, so the room is 30,000 and the cutoff taxes 30,000. An engine
  that forgot cutoff 21 would see room 90,000 and tax nothing.
- **Case 4** is the honest limit. The cutoff under-withholds against the true pool
  (50,000 + 90,000); the hold is the only protection at that point. Year end settles it.
- **Case 5** isolates the cause: the same style of bonus on a worker with no imported
  history is `Ready`, so the hold comes from the import gap and not from the amount.

## Year end

Same convention as Phases 10, 13, 17 and 18: the accrued unpaid 13th month
(entitlement 60,000, or 30,000 for the half-year worker) joins gross compensation
and the pool; an imported amount that is not a recognised exempt item stays taxable.

| Case | Gross compensation | Non-taxable | Taxable | Tax due | Withheld | Result |
|---|---|---|---|---|---|---|
| bonusInsideRoomStillHeld | 810,000 | 131,400 | 678,600 | 78,220.00 | 78,218.40 | collect 1.60 |
| bonusOverflowHeld | 880,000 | 131,400 | 748,600 | 92,220.00 | 80,465.50 | collect 11,754.50 |
| bonusSplitAcrossTwoCutoffs | 900,000 | 131,400 | 768,600 | 96,220.00 | 85,465.50 | collect 10,754.50 |
| importedBonusInvisibleToEngine | 920,000 | 131,400 | 788,600 | 100,220.00 | 78,218.40 | collect 22,001.60 |
| noImportedHistoryControl | 440,000 | 100,700 | 339,300 | 13,395.00 | 39,109.20 | refund 25,714.20 |

Case 4 closes exactly: the true pool (13th 60,000 + 50,000 + 90,000 = 200,000, exempt
90,000) gives the same taxable income as the engine's year end, which keeps the
imported 50,000 taxable and exempts only the recognised pool.

## Result

All five cases pass against the real engine. Every expected value was derived by hand
before the first run and matched on that run. Mutation-checked by editing the engine
locally and restoring it:

| Mutation | Fails |
|---|---|
| drop the carry-forward of an earlier engine cutoff's bonus (`payroll-engine.ts`) | case 3 |
| never raise the hold flag (`payroll-engine.ts`) | cases 1, 2, 3 and 4 |
| raise the flag without imported history (`payroll-engine.ts`) | case 5 |
| remove the 90,000 cap (`annualization.ts`) | cases 2 and 3 |
| leave the imported bonus out of year-end gross (`year-end.ts`) | case 4 |

## What this does not certify

- **Reading a previous provider's bonus.** It is not read at all: the import has no
  field for it, so the prior pool stays a lower bound and the run stays held. This
  phase certifies the hold and the exact year-end settlement, not the amount.
- The cutoff withholding is an **estimate** for a worker whose import hides a pool
  benefit. Case 4's cutoff 23 under-withholds; only year end settles the difference.
  An owner must treat a held run as unfinished until it is reviewed.
- One salary level (60,000, every contribution capped), the `bonus` earning type
  only, one tax year. Other pool benefits are not exercised.
- Whether the collection or refund is paid out.

## Run locally

Needs an empty disposable PG16 on `127.0.0.1:5432` with database `app_db`,
UTF-8 encoding, and the environment the harness checks (`CI`,
`GITHUB_ACTIONS`, `GOLDEN_PHASE21_DISPOSABLE=github-actions-pg16-only`,
payment and worker flags false, no provider secrets). See the workflow for the
exact set.

```
npm run db:push
node scripts/qa/apply-isolated-baseline.mjs
npx tsx scripts/golden-payroll-phase21.ts
```
