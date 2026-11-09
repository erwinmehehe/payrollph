# Golden payroll certification — Phase 9 cross-period withholding and year-end annualization

Phases 1–8 each certify **one cutoff**. The engine withholds every semi-monthly cutoff independently from the semi-monthly table; it keeps no year-to-date tax balance. The only mechanism that corrects a whole year (a mid-year hire, a mid-year raise, the ₱90,000 13th-month pool, bracket boundaries) is the **year-end annualization**, and Phase 4 explicitly takes its output as an approved input without recomputing it. Phase 9 certifies that mechanism in two parts. Every expected value is an immutable literal in `certification/golden-payroll-phase9.json`, derived by hand from the published rules and never with PayrollPH functions. Comparison is exact to the centavo.

Run: `npx tsx scripts/golden-payroll-phase9.ts` against a disposable PostgreSQL (no npm script: `package.json` is byte-pinned by the tenant credit scripts).

## Part A: `annualize()` (13 cases, no database)

| Case | What it proves |
| --- | --- |
| `taxableAtExemptionLimit` | Taxable exactly ₱250,000 is tax-free |
| `oneHundredPesosIntoFifteenPercentBracket` | ₱100 over the limit costs ₱15.00 |
| `taxableAtFourHundredThousand`, `taxableAtEightHundredThousand` | Bracket boundaries are continuous with the next bracket's base (₱22,500 and ₱102,500) |
| `taxableAboveTwoMillion` | The 30% bracket and a refund when over-withheld |
| `thirteenthMonthAtNinetyThousandCap` | A ₱90,000 13th month is fully exempt |
| `thirteenthMonthAboveCapTaxedOnce` | ₱30,000 above the cap is taxed exactly once (tax rises by 20% of it, not twice) |
| `thirteenthMonthSharesPoolWithOtherBenefits` | 13th month and other benefits share one ₱90,000 pool |
| `deMinimisExcessJoinsPool` | De minimis excess joins the pool; de minimis within ceilings stays exempt |
| `overWithheldEmployeeIsRefunded`, `contributionsLargerThanGrossFloorAtZero` | Refund direction; taxable income never goes below zero |
| `minimumWageEarnerOnlyTaxedOnSupplementary`, `minimumWageEarnerBenefitPoolExcessIsTaxable` | MWE: statutory wage exempt, supplementary pay and pool excess taxed |

## Part B: a full year through the real engine and year-end (4 employees, 24 cutoffs)

One organization, all 24 semi-monthly cutoffs of 2026, calculated by the real payroll engine, then released, then annualized by the real `runYearEndAnnualization`. Every cutoff of every employee is checked against its hand-derived segment (gross, SSS, PhilHealth, Pag-IBIG, taxable compensation, withholding) and its printed payslip must add up; the annual row is checked against annual literals.

| Employee | Year | Result |
| --- | --- | --- |
| `steadyThirty` | ₱30,000/month all year | Tax due ₱12,090.00 vs withheld ₱12,088.80: **collect ₱1.20** (the per-cutoff table and the annual table differ only by rounding) |
| `highEarner` | ₱80,000/month all year | Tax due ₱130,650.00 vs withheld ₱130,648.80 in the 25% bracket: **collect ₱1.20** |
| `midYearHire` | ₱30,000/month from July 1 | Taxable ₱165,300 is below ₱250,000, so tax due ₱0.00 and all ₱6,044.40 withheld is **refunded** |
| `midYearRaise` | ₱20,000 for Jan–Jun, ₱40,000 for Jul–Dec | 13th month uses basic actually earned (₱360,000 / 12 = ₱30,000), not 12 × the final salary; the table over-withholds ₱15,709.20 against ₱12,315.00 due: **refund ₱3,394.20** |

It also asserts that the annual `taxWithheld` equals the sum of the withholding lines the employee actually saw on every payslip.

## Mutation evidence

Five source rules were each changed and confirmed to fail the suite before the files were restored: the ₱90,000 exemption cap raised to ₱900,000 (fails the pool and de minimis cases and the MWE pool case), the 25% bracket rate changed to 24% (fails `highEarner`), statutory contributions dropped from non-taxable income (fails `midYearHire` and `midYearRaise` among others), the 13th-month divisor changed from 12 to 13 (fails all four employees), and the unpaid 13th-month accrual dropped from gross (fails all four employees).

## Not covered

- A 13th month actually **paid inside a cutoff** and the December-cutoff binding of the adjustment (`includePayrollRunId` / `bindToPayrollRunId`); regular runs do not pay 13th month, so the entitlement is the accrued one.
- Attendance deductions, supplementary pay, loans, allowances and leave across a year; daily and hourly workers (Phase 8) across a year.
- Imported prior-provider history, prior-employer and PERA evidence, and numbered-2316 reconciliation.
- The release approval workflow: runs are set to Released in the fixture.
- **Practitioner review:** the expected values follow the cited rules and the repository's year-end treatment (unpaid 13th month accrued into gross, one combined ₱90,000 pool). They have not been reviewed by a qualified Philippine tax practitioner and must be before anyone relies on them for filing.
