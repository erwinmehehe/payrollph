# Monetary acceptance regression coverage (2026-10-10)

The separation endpoint now calls `calculateLeaveMonetizationPay` in
`src/lib/final-pay.ts`. Numeric tests execute that same function with
real Philippine peso amounts and validate invalid input handling.

The monthly pay timeline's actual `fixedMonthlyBasicForTimeline` is tested
numerically against a resignation on day 7 of a 15-day cutoff and a
mid-cutoff raise followed by resignation; no change to the payroll engine's
proration formula was necessary. The tests guard against a future regression
causing post-employment wages.

Annualization-to-final-pay now has exact tax refund and tax-collection
examples instead of relying only on finite-number assertions.

The common rounding helper `src/lib/round.ts` is used by annualization
and final-pay to eliminate duplicated rounding code.

## Not declared certified
Numeric unit coverage is additional evidence, not proof of all final-pay
taxes, service incentive leave eligibility, employer workday divisor,
retroactive labor agreements, 2316 filing or BIR accepted export formats.
Philippine HR/payroll SMEs should witness synthetic offboarding staging and
compare results to independent, legally reviewed employee records.

For MWE taxable supplementary compensation, a zero tax base after lawful
mandatory employee contributions does NOT inherently mean a payroll
over-deduction. Do not turn the zero-base clamp into a blocking warning for
every MWE worker; the existing gross-vs-core-deductions warning remains a
separate actual net-pay safeguard pending BIR specialist review.
