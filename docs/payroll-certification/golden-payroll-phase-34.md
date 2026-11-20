# Golden payroll Phase 34: final pay honours a previous provider's imported de minimis pay (defect found and fixed)

Year end applies each imported payroll row's `deMinimisBreakdown`: every category is capped at its
statutory ceiling per period, the part inside the ceiling is exempt and the part above joins the
shared 90,000 pool, with one ceiling shared between the imported months and the engine's own `DM-`
lines (`importedDeMinimisTreatment` in `src/lib/year-end.ts`). The Separation API loads the same
imported rows for final pay but took its de minimis totals only from the released engine payslips,
so imported de minimis pay sat inside imported gross pay with no exemption and was taxed in full.

- Catalog: `certification/golden-payroll-phase34.json` (hand-derived literals, zero centavo
  tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase34.ts` (real engine for cutoffs 13-24, imported rows for
  January to June as the importer stores them, real `runYearEndAnnualization`, real
  `computeFinalPay` fed the year-to-date inputs exactly as the Separation API derives them)
- CI: `.github/workflows/golden-payroll-phase34-pg16.yml`, an empty disposable PG16 on GitHub
  Actions. The harness refuses to run anywhere else.

## Setup (tax year 2026, `split` timing)

Workers employed all year: six imported months (pay date = month end), then 12 engine cutoffs, then
separated on 2026-12-31. Steady worker on 30,000 a month: imported month basic 30,000, contributions
2,450, withholding 1,007.40; engine cutoff gross 15,000, contributions 1,225, withholding 503.70.
Contributions 29,400, withheld 12,088.80, 13th month 30,000, year-end tax on a no-grant worker
12,090.00 (collect 1.20).

## Defect (observed on `main`, fictional data, disposable PG16)

Year end was correct in every case; final pay was not (35 mismatches before the fix):

| Case | Imported de minimis | Year-end tax | Final-pay tax | Net final pay | Under-paid |
|---|---|---|---|---|---|
| noDeMinimisControl | none | 12,090.00 | 12,090.00 | 29,998.80 | none |
| importedRiceSubsidyWithinCeiling | rice 2,500 x 6 | 12,090.00 | **14,340.00** | 27,748.80 | **2,250.00** |
| importedRiceSubsidyAboveMonthlyCeiling | rice 3,000 x 6 (15,000 / 3,000) | 12,090.00 | **14,790.00** | 27,298.80 | **2,700.00** |
| importedUniformAllowanceAcrossMonths | uniform 2,000 x 6 (8,000 / 4,000) | 12,090.00 | **13,890.00** | 28,198.80 | **1,800.00** |
| importedUniformAllowanceOverflowsThePool | uniform 12,000 x 6 (8,000 / 64,000) | 12,690.00 | **23,020.00** | 19,068.80 | **10,330.00** |
| importedAndEngineUniformShareOneCeiling | uniform in both sources, 60,000 salary (8,000 / 76,000) | 87,420.00 | passes only with the shared ceiling | 50,798.40 | 1,600.00 over-refund if added instead of shared |

## Fix

`src/lib/final-pay-imported-de-minimis.ts` (new) computes the imported de minimis delta exactly as
year end does and the Separation API adds it to the exempt and excess totals it already read from
the released rows. The delta replaces the engine's separately capped figures for the same
categories, so the ceiling is applied once to the union of both sources. Unreadable, invalid,
unknown, leave-day and over-gross breakdowns are refused (the same refusals as year end), never
guessed. The frozen final-pay source now includes a row's `deMinimisBreakdown` when present, so a
changed breakdown invalidates an approved package; an absent or null breakdown leaves the stored
shape unchanged. `src/lib/year-end.ts` is not changed.

Packages computed under the old rule must be recomputed before approval or release.

## Result and mutation checks (run locally, helper restored afterwards)

All six cases pass with the fix. Mutations of the helper:

| Mutation | Result |
|---|---|
| no adjustment (the old behaviour) | five grant cases fail (44 mismatches); the control passes |
| imported excess dropped | four cases fail (25): within-ceiling passes, every excess-bearing case fails |
| engine lines left out of the shared ceiling | only the shared-ceiling case fails (8) |
| the engine's own figures not subtracted | only the shared-ceiling case fails (1: the double count) |

## Limitations

- Only a rice subsidy and a uniform allowance are imported. The shared-ceiling case covers the
  uniform allowance with the shared pool full; a monthly-ceiling category shared across the switch
  month, and meal allowance, are not exercised.
- The engine flags every cutoff of the shared-ceiling worker as an Exception (the shared 90,000
  pool cannot be fully identified from imported history); the harness accepts exactly that one flag
  and only for that worker. That reconcile-before-release gate is not changed.
- A year-end termination with no other outstanding pay, loans, separation pay, final leave
  monetisation or prior-employer income, as in Phases 25, 32 and 33.
- The route cannot be called from a harness (it needs a session); `tests/final-pay-route-derivation-pin.test.ts`
  fails if the route expressions the harness reproduces change.

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data. Money,
payout, provider, CSP and calculation-history flags stay off. No method is credited or re-credited.
