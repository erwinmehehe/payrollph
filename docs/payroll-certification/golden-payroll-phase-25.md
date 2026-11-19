# Golden payroll Phase 25: final pay against year end (proof-only)

Year end and final pay must agree on the tax of the same worker in the same year.
Phase 25 shows they do not when the worker had an allowance the cutoff exempted, and
records the size of the difference. **It changes no calculation and no route.**

- Catalog: `certification/golden-payroll-phase25.json` (hand-derived literals,
  zero centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase25.ts` (real engine, real
  `runYearEndAnnualization`, real `computeFinalPay`)
- Route pin: `tests/final-pay-route-derivation-pin.test.ts`
- CI: `.github/workflows/golden-payroll-phase25-pg16.yml`, an empty disposable PG16
  on GitHub Actions. The harness refuses to run anywhere else.

## The discrepancy

The Separation API (`src/app/api/separation/route.ts`) builds its year-to-date gross
as the sum, over the released payroll rows, of `gross pay - 13th month paid`, and
passes it to `computeFinalPay` as `grossCompensationYtd`. That sum includes a
non-taxable allowance the cutoff exempted, and neither the route nor
`computeFinalPay` has an input that exempts it again. Year end had the same flaw until
#2033 (Phase 23). Final pay still has it.

Final pay does not have the other Phase 23 defect (a label read as withholding): it
matches the withholding line by code, so the withheld figure is right. Only the
taxable income is overstated, so the employee is **under-paid**, where year end used
to over-pay.

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

Two workers hired 2026-07-01, so only the 12 engine cutoffs exist: a control, and a
worker with a 12,000 non-taxable allowance in cutoff 23 (gross 42,000, withholding
still 3,259.10). Final pay is for a last day of 2026-12-31 with nothing unpaid, so it
is the year-end settlement plus the unpaid 13th month.

## Cases

| Case | Year end (real) | Final pay, route-derived inputs | Final pay, exempt amount removed |
|---|---|---|---|
| noAllowanceControl | tax 13,395.00, refund 25,714.20 | tax 13,395.00, adjustment +25,714.20, net 55,714.20 | same |
| nonTaxableAllowance (12,000) | non-taxable 62,700, taxable 339,300, tax 13,395.00, refund 25,714.20 | grossCompensationYtd 372,000, taxable 351,300, **tax 15,195.00**, adjustment **+23,914.20**, net **53,914.20** | tax 13,395.00, adjustment +25,714.20, net 55,714.20 |

Hand derivation of the allowance worker's final pay: grossCompensationYtd =
360,000 + 12,000 = 372,000; 13th month due = 360,000 / 12 = 30,000; gross for
annualization 402,000; non-taxable = 30,000 pool + 20,700 contributions = 50,700;
taxable 351,300; tax 15% x 101,300 = 15,195.00; withheld 12 x 3,259.10 = 39,109.20;
adjustment 39,109.20 - 15,195.00 = +23,914.20 refund. With the allowance exempt, tax
is 13,395.00 and the refund 25,714.20, exactly the year-end settlement. **The
employee is under-paid by 1,800.00** (15% of 12,000).

## What the phase asserts

- The real engine's cutoffs match hand-derived slips.
- Year end, after #2033, exempts the allowance (a regression guard for Phase 23).
- The year-to-date inputs the harness derives equal the literals.
- `computeFinalPay` on the route-derived inputs gives the documented figures, and on
  inputs with the exempt amount removed gives the year-end settlement.

## Mutation checks

| Mutation | Result |
|---|---|
| final pay silently exempts the allowance | the allowance case fails (tax 13,395.00 where 15,195.00 is documented) |
| the "correct" side forgets the exemption | the allowance case fails |
| year end reverted to count the allowance as taxable | the allowance case fails (non-taxable 50,700) |

## Why the route derivation is reproduced and pinned

The Separation API cannot be called from a harness (it needs a signed-in session and
request checks), so the harness reproduces its derivation using the same helper
(`readBasicAndThirteenth`) and the same expression. `final-pay-route-derivation-pin`
asserts that expression is still in the route and that no exempt-earnings input
reaches `computeFinalPay`. If the route changes, that test fails and the phase must
be re-run: **the proof cannot silently go stale, and a fix to the route is expected to
make it fail on purpose.**

## What fixing it takes (not done here)

`computeFinalPay` would need an exempt-earnings input (as `annualize` now has) and the
route would need to compute it with the year-end recogniser. That edits a pinned
route: `tenant-route-edit-impact` reports 3 methods with provisional credit at stake
and a repin across the sealed receipts and tests. It is a reviewed decision for the
owner and the independent security reviewer, not a golden-phase change.

## What this does not certify

- A pay-policy premium marked non-taxable and an exempt leave conversion reach the
  same derivation and are expected to be affected the same way; they are not exercised.
- One salary, `split` timing, a worker hired at the switch, nothing unpaid.
- Prior-employer evidence, imported history, leave monetization, separation pay and
  loans in final pay (Phase 7 covers `computeFinalPay` with direct inputs).

## Run locally

Needs an empty disposable PG16 on `127.0.0.1:5432` with database `app_db`, UTF-8
encoding, and the environment the harness checks (`CI`, `GITHUB_ACTIONS`,
`GOLDEN_PHASE25_DISPOSABLE=github-actions-pg16-only`, payment and worker flags false,
no provider secrets). See the workflow for the exact set.

```
npm run db:push
node scripts/qa/apply-isolated-baseline.mjs
npx tsx scripts/golden-payroll-phase25.ts
```
