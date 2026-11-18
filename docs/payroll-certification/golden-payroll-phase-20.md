# Golden payroll Phase 20: a minimum wage earner in a provider-switch year

Phases 15-19 certified a non-MWE worker. Phase 20 certifies a **minimum wage
earner (MWE)** in a provider-switch year. It first documented a launch problem
and now certifies its fix: year-end annualization could not annualize an MWE
whose employer has imported history, and it used to **throw for the whole
employer**, so one such worker blocked everyone's year end. It now **skips and
reports only that worker** while every other worker settles.

- Catalog: `certification/golden-payroll-phase20.json` (hand-derived literals,
  zero centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase20.ts` (real engine, real
  `runYearEndAnnualization`, three separate employers)
- CI: `.github/workflows/golden-payroll-phase20-pg16.yml`, an empty disposable
  PG16 on GitHub Actions. The harness refuses to run anywhere else.

Test, catalog, doc and workflow only. **No engine, schema or runtime change.**

## Setup (tax year 2026, `split` timing)

The MWE earns 17,000 a month (8,500 a cutoff, fixtures). Contributions are
SSS 425 + PhilHealth 212.50 + Pag-IBIG 100 = 737.50 a cutoff. January to June are
six imported monthly rows (withholding 0); July to December are cutoffs 13-24
calculated by the engine. Pool benefits are paid only in cutoff 23. An MWE's
taxable compensation is only its taxable supplementary compensation (here the
overflow of the shared PHP 90,000 pool) less contributions, floored at 0.

## Employer A: cutoffs of an MWE with imported history

| Case | Imported 13th (June) | Engine pays in cutoff 23 | Pool arithmetic | Cutoff 23 |
|---|---|---|---|---|
| mweImportedThirteenthShrinksRoom | 17,000 | bonus 100,000 | prior 17,000, room 73,000: **taxable 27,000** | taxable 26,262.50, withholding **2,856.60**, Exception |
| mweNoImportedThirteenthControl | 0 | 13th 17,000 + bonus 100,000 | prior 0, room 90,000: **taxable 27,000** | same 2,856.60, same overflow by another route |
| mweUnreadableHistoryAssumesNothing | 17,000, April unreadable | bonus 100,000 | prior 0, room 90,000: taxable 10,000 | taxable 9,262.50 is inside the exempt bracket: withholding **0**, Exception |
| mweOrdinaryCutoffsPayNoTax | 0 | nothing | none | every cutoff gross 8,500, withholding 0, net 7,762.50, Ready |
| mweLegacyFlagHeldForGovernance | 0 | nothing | none | same tax, but every cutoff is Exception with the legacy-classification flag |

- **Case 1** is the headline: the imported 13th month shrinks the room, and the
  December payslip withholds 937.50 + 0.20 x (26,262.50 - 16,667) = 2,856.60.
  The first two cases reach the same overflow by different routes.
- **Case 3** is the fallback and shows why the hold matters: nothing is assumed
  about what the previous provider paid, so the payslip under-withholds
  2,856.60 against case 1.
- **Case 4 is an honest limit.** At 17,000 a month the ordinary cutoff's
  7,762.50 sits inside the exempt first bracket (to 10,417), so an ordinary
  taxpayer would also withhold 0. This case certifies the ordinary payslip and
  the Ready state; the MWE status is discriminated by the December overflow
  cases.
- **Case 5** is the legacy path: an employee who is an MWE only by the legacy
  flag has no approved wage-order classification, so the tax is the same but the
  run is held for governance.

## Employer B: skip and report

An MWE with imported history and a non-MWE colleague, both ordinary in every
cutoff. Year-end annualization cannot annualize the MWE (the import has no
statutory-wage versus taxable-supplementary breakdown), so it:

- returns the worker in `summary.skippedEmployees` with the reason and the
  "...does not contain the statutory-wage versus taxable-supplementary
  breakdown..." message, and records the skipped ids in the
  "Year-end annualization computed" audit event;
- produces **no adjustment row** for them, so no refund, collection, 2316 draft
  or payroll line, and does not count them in `summary.employees`;
- **still settles the colleague**: collect 1.60 on taxable 678,600, exactly as
  if the MWE were not there.

The summary also carries a `warning` naming the skipped employee numbers and
saying they must be annualized outside Linaw before the year end is treated as
complete. The year-end route already spreads the summary into its response, so
the warning and `skippedEmployees` reach the caller without a route change (the
route is pinned by blob in the tenant proof manifest, so editing it would
withdraw its receipts). One gap: if every worker is skipped, the route's own
"no payroll runs eligible" warning replaces this one; `skippedEmployees` is still
in the response.

## Employer C: an MWE hired after the switch

An MWE hired on 2026-07-01 has no imported rows, so annualization runs.
Entries 12 x 8,500 = 102,000; the unpaid 13th month (102,000 / 12 = 8,500) is
accrued and exempt, so gross compensation is 110,500; contributions
12 x 737.50 = 8,850; non-taxable 17,350; an MWE's taxable income is 0, tax due 0,
nothing withheld: **balanced**. The non-MWE colleague beside them settles
(collect 1.60 on taxable 678,600, tax 78,220.00 against 78,218.40 withheld).

## Result

All ten cases pass against the real engine. Mutation-checked by editing
`src/lib/imported-benefit-prior.ts`, `src/lib/payroll-engine.ts` or
`src/lib/year-end.ts` locally and restoring it:

| Mutation | Fails |
|---|---|
| ignore the imported 13th month | case 1 |
| count an unreadable worker as known | case 3 |
| skip without leaving the loop (the MWE is annualized anyway) | the MWE has an adjustment row |
| skip without reporting the worker | the skip-reported case |
| omit the skipped ids from the audit event | the skip-reported case |
| treat the MWE as an ordinary taxpayer in the engine | cases 1, 2 and 3 |
| drop the legacy-classification hold | case 5 |
| annualize the MWE as an ordinary taxpayer | the July-hire case |

## What this does not certify

- **Any annualization of an MWE with imported history.** None exists: the
  worker is skipped and must be annualized outside Linaw. Nothing in the product
  forces that to happen; the warning and the audit event are the only trail, so
  an owner must not treat the year end as complete while a skipped worker is
  reported.
- Persisting the skipped worker (for example a "needs manual annualization" row)
  would need a schema change and is not part of this fix.
- One MWE salary (17,000 a month, fixtures) and one region. Holiday, overtime,
  night-differential and hazard premiums, which are also exempt for an MWE, are
  not exercised, and neither is a taxable supplementary allowance other than
  the pool.
- Because 17,000 a month is inside the exempt first bracket, the ordinary
  cutoffs do not discriminate MWE status.
- The MWE classification rows are fixtures inserted as approved; the approval
  workflow and the rule that the evidenced daily wage must equal the statutory
  minimum wage are not exercised.
- Whether the refund or collection is paid out.

## Run locally

Needs an empty disposable PG16 on `127.0.0.1:5432` with database `app_db`,
UTF-8 encoding, and the environment the harness checks (`CI`,
`GITHUB_ACTIONS`, `GOLDEN_PHASE20_DISPOSABLE=github-actions-pg16-only`,
payment and worker flags false, no provider secrets). See the workflow for the
exact set.

```
npm run db:push
node scripts/qa/apply-isolated-baseline.mjs
npx tsx scripts/golden-payroll-phase20.ts
```
