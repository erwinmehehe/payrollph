# Golden payroll certification — Phase 7 separation (final) pay

Regular payroll runs do not compute 13th-month pay (the Phase 6 note says so). Final pay and year-end are the only paths that do, and until now neither had hand-derived golden values. Phase 7 runs **10 final-pay cases plus leave-monetization and due-date checks (19 checks in total)** through the real `computeFinalPay`, `calculateLeaveMonetizationPay` and `finalPayDueDate`. Every expected value is an immutable literal in `certification/golden-payroll-phase7.json`, derived by hand from PD 851, the TRAIN ₱90,000 exemption and the 2023 annual rates, and never with PayrollPH functions. Comparison is exact to the centavo.

Run: `npx tsx scripts/golden-payroll-phase7.ts` (no npm script: `package.json` is byte-pinned by the tenant credit scripts) (no database needed — these are pure functions).

| Case | What it proves |
| --- | --- |
| `resignationNoTax` | Mid-year resignation: 13th month = basic earned / 12 (₱10,833.33), leave 5 × ₱1,000, no tax |
| `yearEndSeparationCollectsTax` | Annual tax ₱60,300 less ₱20,000 withheld: ₱40,300 collected from the payout |
| `yearEndSeparationRefundsTax` | ₱80,000 withheld against ₱60,300 due: ₱19,700 refunded and added to the payout |
| `thirteenthAlreadyPartlyPaid` | Only the unpaid part of the 13th month is due; tax is unchanged because the paid part is still compensation |
| `thirteenthOverNinetyThousandPool` | ₱200,000 13th month: only ₱90,000 exempt, the rest taxed in the 30% bracket |
| `taxCollectionExceedsPayout` | Tax owed (₱60,300) exceeds the payout (₱2,000): ₱58,300 is reported as unpaid, net is 0 |
| `loanCappedByRemainingPay` | A ₱70,000 loan against ₱59,700 left: ₱10,300 is deferred, never over-deducted |
| `separationPayExemptWhenTaxableAmountIsZero` | Exempt separation pay does not move the tax |
| `separationPayTaxableWhenNoExemptionStated` | The same pay with no stated exemption is fully taxable (₱100,300 due) |
| `minimumWageEarnerRefundsWithholding` | MWE: only leave monetization is taxable, 13th month sits in the pool, wrongly withheld ₱500 is refunded |

Also checked: leave monetization (7.5 × ₱1,234.56 = ₱9,259.20; invalid days or rates throw), and the 30-day final-pay due date across a month end, a year end and a leap February. Every case also asserts the net payout reconciles to gross + refund − tax collected − statutory − loans.

## Mutation evidence

Four rules were each changed and confirmed to fail the cases designed to catch them, before the files were restored: the ₱90,000 pool cap → ₱80,000 (`thirteenthOverNinetyThousandPool` only), the 13th month divisor 12 → 13 (every case that pays a 13th month), the 30-day due date → 31 (all three date checks), and applying the full tax collection instead of capping it at the payout (`taxCollectionExceedsPayout` only).

## Not covered

- The Separation API route, its approval workflow and payslip rendering: this suite certifies the arithmetic, not the HTTP path.
- Sub-centavo 13th-month rounding. That belongs to the `exactThirteenthCentavos` release flag, which is off by default; no amount here sits on a half-centavo.
- Whether a given leave monetization or separation payment is taxable is a practitioner call. The suite takes it as an input and certifies what the engine does with it. **The two positions the engine takes by default (leave monetization taxable; separation pay taxable unless a taxable amount is stated) are flagged for practitioner review.**
- Retirement pay, other benefits, and de minimis within final pay.
