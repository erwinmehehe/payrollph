# Golden payroll Phase 20: a minimum wage earner in a provider-switch year

Phases 15-19 certified a non-MWE worker. Phase 20 certifies a **minimum wage
earner (MWE)** in a provider-switch year, and in doing so documents a behavior
that matters for launch: year-end annualization **refuses** an MWE whose
employer has imported history, and the refusal **aborts the whole employer's
year end**, not just that worker.

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

## Employer B: the refusal

An MWE with imported history and a non-MWE colleague, both ordinary in every
cutoff. Year-end annualization throws
"...does not contain the statutory-wage versus taxable-supplementary breakdown
required for safe annualization..." and **persists no adjustment row for
anyone**: the colleague, who has nothing wrong with their records, gets no
year-end settlement either.

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
| remove the MWE year-end refusal | the refusal case |
| treat the MWE as an ordinary taxpayer in the engine | cases 1, 2 and 3 |
| drop the legacy-classification hold | case 5 |
| annualize the MWE as an ordinary taxpayer | the July-hire case |

## What this does not certify

- **That refusing the whole employer is the right product behavior.** It is the
  current behavior and this phase locks it in; an MWE with imported history has
  no certified annualization at all. Whether one such worker should block the
  employer's year end for everyone else is a product and compliance decision.
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
