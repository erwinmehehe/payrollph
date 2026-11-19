# Golden payroll Phase 28: company premium pay is taxed at year end as the cutoff taxed it

A company premium comes from an employee-scoped pay policy and is paid as a `PREM-<rule id>`
line whose notes say `Taxable: yes` or `Taxable: no`. The cutoff withholds accordingly. Year-end
annualization (`nonTaxablePolicyPremium` in `src/lib/year-end.ts`, added with #2033) must reach
the same answer. Phase 28 proves it through the real engine.

- Catalog: `certification/golden-payroll-phase28.json` (hand-derived literals, zero
  centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase28.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase28-pg16.yml`, an empty disposable PG16 on
  GitHub Actions. The harness refuses to run anywhere else.

**Proof-only.** No calculation, route, schema, migration or manifest file is changed.

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

Three workers hired 2026-07-01, so only the 12 engine cutoffs exist. Each has one complete
09:00-18:00 punch (480 worked minutes) on a plain Monday in every cutoff. The premium is a
worked-time rule of 25.00 an hour: 8 x 25.00 = 200.00 a cutoff, 2,400.00 in all. An
ordinary cutoff: gross 30,000; SSS 875, PhilHealth 750, Pag-IBIG 100; withholding 3,259.10.
Contributions do not move because 60,000 is already at the SSS and Pag-IBIG ceilings.

## Cases

| Case | Premium | Cutoff gross / WHT / net | Year end |
|---|---|---|---|
| noPolicyControl | none | 30,000 / 3,259.10 / 25,015.90 | tax 13,395.00, **refund 25,714.20** |
| taxablePremium | 200.00 taxable | 30,200 / 3,299.10 / 25,175.90 | gross 392,400, non-taxable 50,700, taxable 341,700, tax 13,755.00, withheld 39,589.20, **refund 25,834.20** |
| nonTaxablePremium | 200.00 non-taxable | 30,200 / 3,259.10 / 25,215.90 | gross 392,400, non-taxable 53,100, taxable 339,300, tax 13,395.00, **refund 25,714.20 (equals control)** |

Each cutoff also asserts that a `PREM-` line is present (or absent for the control), so a
policy that never applied cannot certify. If year end taxed the non-taxable premium the
refund would be 360.00 too small.

## Limitations

- Only the worked-time family (`PREM-`) with a flat hourly amount. Holiday and rest-day
  (`DAYPREM-`), overtime (`OTPREM-`) and night differential (`NDPREM-`) lines reach the same
  year-end rule by code prefix and are not exercised separately.
- One employee-scoped policy, one worked day per cutoff, a premium never limited by pay.
  Percent-of-rate premiums, rate-table tiers and stacked policies are not exercised.
- Final pay (separation) is not exercised (see Phase 25).

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data.
Money, payout, provider, CSP and calculation-history flags stay off. No method is
credited or re-credited.
