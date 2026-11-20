# Golden payroll Phase 37: a mid-year raise flows through every cutoff, year end and final pay (defect found and fixed)

A monthly worker on 30,000 gets a raise to 36,000 (or 40,000) during 2026. Six fictional workers are paid by the real engine for all 24
semi-monthly cutoffs on disposable PG16, then run through the real year-end annualization and the real final-pay calculation.

- Catalog: `certification/golden-payroll-phase37.json` (hand-derived literals for every cutoff, year end and final pay, zero centavo
  tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase37.ts` (the raise is recorded exactly as the employees API writes it: a pay revision plus the new
  stored rate; every cutoff's gross pay, contributions and withholding is compared, then `runYearEndAnnualization()` and
  `computeFinalPay()` fed the year-to-date inputs the way the Separation API derives them)
- CI: `.github/workflows/golden-payroll-phase37-pg16.yml`, an empty disposable PG16 on GitHub Actions. The harness refuses to run
  anywhere else.

## Cases (tax year 2026, `split` timing, every worker hired 2026-01-01 at 30,000)

| Case | Raise | Basic earned | Contributions | Withheld | Year-end tax | Result |
|---|---|---:|---:|---:|---:|---|
| steadyNoRaise | none (control) | 360,000 | 29,400.00 | 12,088.80 | 12,090.00 | collect 1.20 |
| raiseOnCutoffBoundary | 36,000 from Aug 16 | 387,000 | 31,300.00 | 15,853.80 | 15,855.00 | collect 1.20 |
| raiseInsideFirstCutoff | 36,000 from Aug 8 | 388,600 | 31,375.00 | 16,082.55 | 16,083.75 | collect 1.20 |
| raiseInsideSecondCutoff | 36,000 from Sep 23 | 379,600 | 30,825.00 | 14,815.05 | 14,816.25 | collect 1.20 |
| raiseIntoTwentyPercentBand | 40,000 from Aug 16 | 405,000 | 31,900.00 | 19,287.40 | 18,465.00 | **refund 822.40** |
| raiseRecordedWhileEarlierCutoffOpen | 36,000 from Aug 16, recorded early | 387,000 | 31,300.00 | 15,853.80 | 15,855.00 | collect 1.20 |

A raise inside a cutoff prorates by calendar days: Aug 8 gives 15,000 x 7/15 + 18,000 x 8/15 = 16,600.00 for Aug 1-15. SSS is estimated
at half in the first cutoff and trued up to the month's actual pay in the second; PhilHealth uses the rate in force at the end of the
cutoff. The 40,000 worker is taxed in the 20% band cutoff by cutoff, but the annual table leaves the year in its 15% band, so year end
refunds 822.40, and final pay returns the same refund.

## Defect (observed on `main`, fictional data, disposable PG16)

The first five cases passed on the first run: the cutoff arithmetic, the statutory true-ups, year end and final pay all agree with the
hand derivation. The sixth did not (20 mismatches). The employees API stores a raise as a pay revision **and overwrites the stored
rate with the new one at once**. The engine, with the approved-exit flag off, loaded only revisions up to the cutoff's end, so a
cutoff that ended before the raise took effect, but was calculated after the raise was entered, found no revision and paid the
**new** stored rate for days before it took effect.

| Case | Cutoff 15 (Aug 1-15) basic | Expected | Effect |
|---|---:|---:|---|
| raiseRecordedWhileEarlierCutoffOpen on `main` | 18,000.00 | 15,000.00 | 3,000.00 over-paid gross; withholding 923.70 instead of 503.70; the August true-up and year end follow the wrong figures (year-end tax 16,290.00 instead of 15,855.00) |

It is reachable in normal use: the API only requires the effective date not to be in the future, and it guards only released
payroll runs. A raise entered on Aug 17 with effect from Aug 16 while the Aug 1-15 draft is still unprocessed, or a draft recalculated
after a later raise, pays the new rate. With several unprocessed earlier cutoffs, every one is over-paid.

## Fix

`src/lib/payroll-engine.ts` loads, for each worker, the earliest pay revision that takes effect after the cutoff ends and uses that
revision's previous rate as the stored rate for the cutoff (the approved-exit path already does this for a leaving worker). With no
revision after the cutoff the behavior is exactly as before. Revisions up to the cutoff's end load as before, so a raise inside a
cutoff still prorates. `wage-registry-renewal-supersession.mjs` records the new engine blob; the wage credits it guards are zero-credit
holds on `main`, so no credit changes.

`tests/payroll-pay-revision-after-cutoff.test.ts` pins the correction with one and two later raises (22,000 before both, 24,000 between
them, 26,000 after, plus a prorated cutoff).

## Result and mutation checks (run locally, restored afterwards)

All six cases pass with the fix. Mutations:

| Mutation | Result |
|---|---|
| fix removed (the old behavior) | only raiseRecordedWhileEarlierCutoffOpen fails (20 mismatches); the five others pass; the new unit test fails (13,000 instead of 11,000) |
| proration drops one day | the five raise cases fail (95 mismatches); the control passes |
| monthly rate taken at the start of the cutoff instead of the end | only the two raise-inside-a-cutoff cases fail (14 mismatches: contributions 1,300 instead of 1,375 and 1,450) |

## Limitations

- One raise per worker, a monthly worker, no other earning, deduction, loan or leave. A daily or hourly worker, a pay cut, two raises in
  one month, and a raise combined with overtime or attendance pay are not exercised.
- Proration by calendar days is the product's definition; whether it matches an employer's own policy (working days) is an employer
  decision this certification does not make.
- A year-end termination with no other outstanding pay, as in Phases 25, 32, 33 and 34.
- The raise is written straight into the tables the employees API writes; the API's own checks and its retro-adjustment path for
  already released cutoffs are not exercised.
- The retro-adjustment case (a raise backdated into a cutoff that was already released) is Phase 2B's, not this one.

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data. Money, payout, provider, CSP and
calculation-history flags stay off. No method is credited or re-credited.
