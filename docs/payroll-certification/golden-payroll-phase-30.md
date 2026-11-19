# Golden payroll Phase 30: the deduction waterfall (proof-only)

When pay runs out the engine does not take everything. It takes statutory and tax amounts
first, then voluntary Pag-IBIG, benefit plan employee shares, an earned wage advance and
finally loans. Each optional deduction is taken in full if it fits in what is left; a
benefit share or an advance that does not fit is deferred whole, and only a loan is limited
to whatever remains. Phase 30 proves that order and those limits through the real engine.

- Catalog: `certification/golden-payroll-phase30.json` (hand-derived literals, zero
  centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase30.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase30-pg16.yml`, an empty disposable PG16 on
  GitHub Actions. The harness refuses to run anywhere else.

**Proof-only.** No calculation, route, schema, migration or manifest file is changed. The
priority order is the product's own money-integrity rule, not a statute; the phase
certifies the implementation against that rule.

## Setup (tax year 2026, `split` timing, monthly salary 20,000)

Three workers hired 2026-07-01, so only the 12 engine cutoffs exist. An ordinary cutoff:
gross 10,000; SSS 500, PhilHealth 250, Pag-IBIG 100 (850); taxable 9,150, inside the exempt
bracket, so withholding is 0.00. Disposable pay before optional deductions: 9,150.00.

## Cases

| Case | Requested a cutoff | Taken | Net | Status |
|---|---|---|---|---|
| noDeductionControl | none | none | 9,150.00 | Ready |
| loanLimitedToWhatIsLeft | voluntary 500, benefit 2,000, advance 3,100 (3,000 + 100 fee), loan 5,000 | 500, 2,000, 3,100, **loan 3,550** (limited) | 0.00 | Exception |
| advanceDeferredLoanTakesRemainder | voluntary 500, benefit 2,500, advance 7,000, loan 5,000 | 500, 2,500, **advance 0** (deferred whole), loan 5,000 | 1,150.00 | Exception |

Waterfall on 9,150.00. Case 2: 500 leaves 8,650; 2,000 leaves 6,650; 3,100 leaves 3,550; the
loan asks 5,000 and gets 3,550. Case 3: 500 leaves 8,650; 2,500 leaves 6,150; the advance
needs 7,000 and is deferred; the loan fits (5,000) and leaves 1,150. The loan is not held
back for the advance.

Year end is the control's for every worker: gross 130,000 (120,000 + 10,000 accrued 13th
month), non-taxable 20,200, contributions 10,200, taxable 109,800, tax 0.00, withheld 0.00,
adjustment 0.00, outcome balanced. Optional deductions, limited or deferred, never move it.

## Mutation checks (run locally, file restored afterwards)

| Mutation in `src/lib/payroll-engine.ts` | Result |
|---|---|
| loan no longer limited to what is left | `loanLimitedToWhatIsLeft` fails (24 mismatches); the others pass |
| advance taken partially instead of all-or-nothing | `advanceDeferredLoanTakesRemainder` fails (36 mismatches); the others pass |

## Limitations

- One low salary, one benefit plan, one loan and one advance per worker. Several loans
  competing for the remainder, a benefit share that does not fit and partial loan balances
  are not exercised.
- Release settlement (loan balance, repaid status) is not exercised; the harness marks runs
  Released directly.
- Withholding is zero at this salary, so the waterfall's interaction with a withholding
  amount is not exercised.
- Final pay (separation) is not exercised (see Phase 25).

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data.
Money, payout, provider, CSP and calculation-history flags stay off. No method is
credited or re-credited.
