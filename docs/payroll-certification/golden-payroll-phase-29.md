# Golden payroll Phase 29: voluntary Pag-IBIG savings are not a contribution

Voluntary Pag-IBIG savings are paid as the line `HDMF_VOL`, labelled "Pag-IBIG voluntary
contribution". The label names the agency, so it would match the year-end contribution label
test; `sumContributionsAndTax` in `src/lib/year-end.ts` keeps it out only by its code. The
cutoff never lets it reduce taxable pay, and year end must agree. This was proved by unit
test only; Phase 29 proves it through the real engine.

- Catalog: `certification/golden-payroll-phase29.json` (hand-derived literals, zero
  centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase29.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase29-pg16.yml`, an empty disposable PG16 on
  GitHub Actions. The harness refuses to run anywhere else.

**Proof-only.** No calculation, route, schema, migration or manifest file is changed.

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

Three workers hired 2026-07-01, so only the 12 engine cutoffs exist. An ordinary cutoff:
gross 30,000; SSS 875, PhilHealth 750, mandatory Pag-IBIG 100; withholding 3,259.10.
Voluntary savings are split evenly over a month's two cutoffs and taken from net pay.

## Cases

| Case | Voluntary savings | `HDMF_VOL` a cutoff | Cutoff net | Year end |
|---|---|---|---|---|
| noVoluntaryControl | none | none | 25,015.90 | contributions 20,700, taxable 339,300, tax 13,395.00, **refund 25,714.20** |
| voluntary400 | 400.00 a month | 200.00 | 24,815.90 | identical to the control |
| voluntary1000 | 1,000.00 a month | 500.00 | 24,515.90 | identical to the control |

Each cutoff asserts the exact `HDMF_VOL` amount, so savings that silently never applied
cannot certify. If year end counted the savings as contributions the refunds would be 360.00
and 900.00 too large (15% of 2,400.00 and 6,000.00).

## Limitations

- Only a non-minimum-wage monthly-paid worker; a minimum wage earner is not exercised.
- Savings never limited by disposable pay and never changed mid-year.
- Final pay (separation) is not exercised (see Phase 25).

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data.
Money, payout, provider, CSP and calculation-history flags stay off. No method is
credited or re-credited.
