# Golden payroll Phase 26: benefit plan and wage advance deductions are not contributions

Phase 24 fixed year end counting a loan repayment as a statutory contribution and
excluded the `BEN-` (benefit plan) and `EWA-` (earned wage advance) line families by
code at the same time, but proved only loans end to end. Phase 26 proves the other two
families through the real engine.

- Catalog: `certification/golden-payroll-phase26.json` (hand-derived literals, zero
  centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase26.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase26-pg16.yml`, an empty disposable PG16 on
  GitHub Actions. The harness refuses to run anywhere else.

**Proof-only.** No calculation, route, schema, migration or manifest file is changed.

## Why it matters

A voluntary savings plan is written as the line `BEN-<plan id>` labelled
`Benefit, <plan name>`. A plan named after an agency ("Pag-IBIG MP2 Savings", "SSS WISP
Flexi-Fund") matched the contribution label test, so before the Phase 24 exclusion its
deductions were summed as contributions, a non-taxable bucket, and inflated the refund.
The exclusion is now a guard against a regression with no real-engine case behind it.

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

Three workers hired 2026-07-01, so only the 12 engine cutoffs exist. An ordinary
cutoff: gross 30,000; SSS 875, PhilHealth 750, Pag-IBIG 100; withholding 3,259.10.

## Cases

| Case | Deduction | Cutoff net pay | Year end |
|---|---|---|---|
| noDeductionControl | none | 25,015.90 | contributions 20,700, taxable 339,300, tax 13,395.00, withheld 39,109.20, **refund 25,714.20** |
| agencyNamedSavingsPlans | "Pag-IBIG MP2 Savings" 500.00 + "SSS WISP Flexi-Fund" 300.00 a cutoff | 24,215.90 | identical to the control |
| wageAdvanceEveryCutoff | advance 2,000.00 + fee 50.00 recovered every cutoff | 22,965.90 | identical to the control |

Each cutoff also asserts the right number of `BEN-` and `EWA-` lines, so a deduction
that silently went inert cannot certify.

Hand derivation: none of these changes gross, contributions or withholding, so every
worker's year end is the control's: gross 360,000 + 30,000 accrued 13th month =
390,000; non-taxable 30,000 + 20,700 = 50,700; taxable 339,300; tax
15% x 89,300 = 13,395.00; refund 39,109.20 - 13,395.00 = 25,714.20.

If the savings deductions were counted as contributions (the pre-Phase-24 behaviour):
9,600.00 more non-taxable, taxable 329,700, tax 11,955.00 and a refund 1,440.00 too
large. The advance recovery label carries no agency name, so it would not have matched
even then; it is included because it is the other family the exclusion names.

## Limitations

- Plans are exercised only as voluntary employee-share deductions without dependants or
  an employer share. HMO, insurance and pool-crediting benefits are not exercised.
- An advance is exercised only as a full recovery in every cutoff; deferral and the
  release settlement transaction are not.
- One salary, `split` timing, a worker hired at the switch, deductions never limited by
  disposable pay.
- Final pay (separation) is not exercised.

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data.
Money, payout, provider, CSP and calculation-history flags stay off. No method is
credited or re-credited.
