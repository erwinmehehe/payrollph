# Golden payroll Phase 27: leave conversion pay is taxed at year end as the cutoff taxed it

Monetised leave is paid in a cutoff as a `LEAVE_CONV-<id>` line marked
`Tax treatment: exempt` or `Tax treatment: taxable`. The cutoff withholds accordingly.
Year-end annualization (`otherNonTaxable` in `src/lib/year-end.ts`, added with #2033) must
reach the same answer. Phase 27 proves it through the real engine.

- Catalog: `certification/golden-payroll-phase27.json` (hand-derived literals, zero
  centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase27.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase27-pg16.yml`, an empty disposable PG16 on
  GitHub Actions. The harness refuses to run anywhere else.

**Proof-only.** No calculation, route, schema, migration or manifest file is changed.

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

Four workers hired 2026-07-01, so only the 12 engine cutoffs exist. An ordinary cutoff:
gross 30,000; SSS 875, PhilHealth 750, Pag-IBIG 100; withholding 3,259.10; net 25,015.90.
A conversion is 5 days of Vacation Leave at 2,000.00 = 10,000.00. Contributions do not move
because 60,000 is already at the SSS and Pag-IBIG ceilings and PhilHealth uses basic only.

## Cutoff slips

| Conversion in the cutoff | Gross | Withholding | Net |
|---|---|---|---|
| none | 30,000 | 3,259.10 | 25,015.90 |
| exempt 10,000 | 40,000 | 3,259.10 (taxable 28,275) | 35,015.90 |
| taxable 10,000 | 40,000 | 5,506.20 (taxable 38,275: 4,270.70 + 25% x 4,942) | 32,768.80 |

## Cases and year end

| Case | Conversions | Year end |
|---|---|---|
| noConversionControl | none | gross 390,000, non-taxable 50,700, tax 13,395.00, **refund 25,714.20** |
| exemptConversion | exempt in cutoff 13 | gross 400,000, non-taxable 60,700, taxable 339,300, tax 13,395.00, **refund 25,714.20 (equals control)** |
| taxableConversion | taxable in cutoff 13 | gross 400,000, non-taxable 50,700, taxable 349,300, tax 14,895.00, withheld 41,356.30, **refund 26,461.30** |
| exemptThenTaxableConversion | exempt in 13, taxable in 14 | gross 410,000, non-taxable 60,700, taxable 349,300, tax 14,895.00, withheld 41,356.30, **refund 26,461.30** |

Each cutoff also asserts the number of `LEAVE_CONV-` lines, so a conversion that was never
picked up cannot certify. If year end taxed the exempt conversion the first refund would be
1,500.00 too small.

## Limitations

- Only 5-day Vacation Leave conversions in cutoffs 13 and 14. The exempt day limit is a
  policy input chosen at approval and is not tested.
- Company premium lines (`PREM-`, `OTPREM-`, `NDPREM-`, `DAYPREM-`) at year end are not
  exercised; they need pay policy setup.
- Final pay (separation) derives year-to-date gross from released gross pay (see Phase
  25) and is not exercised.

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data.
Money, payout, provider, CSP and calculation-history flags stay off. No method is
credited or re-credited.
