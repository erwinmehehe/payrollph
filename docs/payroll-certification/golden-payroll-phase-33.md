# Golden payroll Phase 33: final pay reads de minimis pay the way year end does (proof-only)

Year end reads de minimis pay from the structured `DM-` line fields: the exempt part is the
amount less the line's other-benefits-pool excess, and the excess joins the shared 90,000 pool.
The Separation API reads the same two figures from the payslip instead: the paid amount from the
line and the pool excess by matching a text note, `other-benefits pool excess this period`
(`readBasicAndThirteenth` in `src/lib/final-pay.ts`). If that note ever stopped matching, final
pay would tax de minimis pay the cutoff exempted. Phase 33 proves the two readings agree through
the real engine.

- Catalog: `certification/golden-payroll-phase33.json` (hand-derived literals, zero
  centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase33.ts` (real engine, real
  `runYearEndAnnualization`, real `computeFinalPay` fed the year-to-date inputs exactly as the
  Separation API derives them from the released rows)
- CI: `.github/workflows/golden-payroll-phase33-pg16.yml`, an empty disposable PG16 on
  GitHub Actions. The harness refuses to run anywhere else.

**Proof-only.** No calculation, route, schema, migration or manifest file is changed. The one
source test added (`tests/final-pay-route-derivation-pin.test.ts`) only reads the route.

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

Four workers hired 2026-07-01, so only the 12 engine cutoffs exist. An ordinary cutoff: gross
30,000; SSS 875, PhilHealth 750, Pag-IBIG 100; withholding 3,259.10. A de minimis grant pays a
twelfth of its yearly total in every cutoff, on 12 `DM-` lines. The 13th month is accrued at year
end, so the cutoffs never see it in the shared pool and withholding is unchanged in every case.

## Cases

| Case | Grant | Exempt / excess | Year end | Final pay |
|---|---|---|---|---|
| noDeMinimisControl | none | none | tax 13,395.00, refund 25,714.20 | net 55,714.20 |
| riceSubsidyWithinCeiling | rice 2,000 a month (ceiling 2,500) | 12,000 / 0 | gross 402,000, non-taxable 62,700, tax 13,395.00, refund 25,714.20 | identical to the control |
| uniformAllowanceCrossesYearlyCeiling | uniform 2,000 a month (ceiling 8,000 a year) | 8,000 / 4,000 | non-taxable 62,700, tax 13,395.00 | identical to the control |
| uniformAllowanceOverflowsThePool | uniform 12,000 a month | 8,000 / 64,000 | pool 94,000: 90,000 exempt, 4,000 taxable; non-taxable 118,700, tax **13,995.00**, refund 25,114.20 | net **55,114.20** |

Hand derivation of the last case: gross 360,000 + 72,000 + 30,000 accrued 13th month = 462,000;
pool 30,000 + 64,000 = 94,000, of which 90,000 is exempt; non-taxable 90,000 + 8,000 + 20,700 =
118,700; taxable 343,300; tax 15% x 93,300 = 13,995.00; withheld 39,109.20; refund 25,114.20; net
final pay = the 30,000.00 unpaid 13th month + 25,114.20.

Each case also asserts the checked final-pay inputs (`deMinimisYtd` is paid less excess and
`deMinimisExcessYtd` is the excess), that all 12 `DM-` lines exist, and that final pay's tax
settlement equals the worker's own year-end settlement.

## Result

All four cases passed on the first run against `main`: the note parsing works end to end and
**no defect was found**. The phase is a regression guard.

## Mutation checks (run locally, `src/lib/final-pay.ts` restored afterwards)

| Mutation | Result |
|---|---|
| the pool-excess note no longer matched | `uniformAllowanceCrossesYearlyCeiling` fails on the checked inputs only (the pool is far from full, so the tax is unchanged); `uniformAllowanceOverflowsThePool` fails in money: tax 13,395.00 instead of 13,995.00, net 55,714.20 instead of 55,114.20, a 600.00 over-refund |
| the paid de minimis amount no longer read | both grant-within-ceiling cases fail (16 mismatches); the control passes |

The overflow case exists because the first three cases alone could not show the excess parsing
matters in money.

## Limitations

- Only a rice subsidy and a uniform allowance are exercised. A pool overflowing by 4,000.00 is
  exercised in final pay; one overflowing through a final leave monetisation, or one already
  partly used by imported history, is not.
- A year-end termination with no imported periods, other outstanding pay, loans, separation
  pay, final leave monetisation or prior-employer income, as in Phases 25 and 32.
- The route cannot be called from a harness (it needs a session); the pin test fails if the
  route expressions the harness reproduces change.

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data. Money,
payout, provider, CSP and calculation-history flags stay off. No method is credited or
re-credited.
