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
- The original 19 Phase 7 arithmetic cases deliberately retain their prior inputs; they are not evidence of automatic tax-exemption eligibility. Focused accounting cases in `tests/final-pay-tax-classification.test.ts` cover the reviewed allocations.
- Retirement pay, other benefits beyond the covered leave split, government leave exemptions, historical unrecorded conversions, actual authenticity/issuance of CTE documents and taxable-year changes when final payment crosses years require separate qualified review.

## Phase 7 practitioner classification — implemented follow-up

`src/lib/final-pay-tax-classification.ts` and the Separation API/UI now use **documented, partial tax allocations**, rather than trusting a blanket "tax-exempt" checkbox. This changes the accounting inputs to `computeFinalPay` while preserving its 13th-month, loan, tax-first shortfall and maker/checker controls.

- **Private-sector unused vacation leave:** BIR RR 29-2025 raised the annual de minimis ceiling from **10 to 12 days on January 6, 2026**. The reviewed `private_vacation_de_minimis` option requires an expected tax-recognition/payment date on or after separation in the **same tax year** (cross-year payments are held for review), authorized vacation type, the existing employee's annual previously exempt leave-conversion ledger and an evidence reference. Up to the available day limit is recorded as exempt de minimis. The excess enters the combined **PHP 90,000 13th-month/other-benefits exemption pool** under BIR RMC 50-2018; the portion above the pool becomes taxable. No government/sick/SIL category is auto-treated as private vacation leave.
- **Gross and Form 2316 accounting basis:** Full reviewed gross monetization enters annual gross compensation once; de minimis and shared-pool portions are removed once using the existing `annualize()` buckets. MWE supplementary tax does not double count the same benefit-pool excess. `annualization` contains the audit allocation; this does **not** certify the downstream 2316 submission.
- **Separation pay:** NIRC section 32(B)(6)(b), BIR RMO 26-2011 and RMO 66-2016 permit exclusion of documented qualifying involuntary separation benefits. The API requires an `authorized_cause` separation, a recognized cause, an 8-200-character supporting document reference and a **numeric taxable portion** for any partial/full exemption. Voluntary, just-cause, retirement, and unsubstantiated cases are not automatically exempt. An unchanged legacy boolean exemption request without a numeric allocation is rejected.
- The form collects leave category/evidence and separation taxable portion/cause/evidence; the computation JSON snapshot records reviewed amounts and the authenticated reviewer ID. Existing special-pay/leave review flags, independent maker/checker, leave entitlement, immutable ledger-source fingerprint, mandatory-shortfall and final-release holds remain intact.
- **Conservative default:** If no qualifying exemption is documented, the amount remains fully taxable as a **reviewable fallback**, not a representation that every payment is legally taxable. Missing evidence is not replaced with a fabricated exemption. Genuine cases still need the company's accountant to verify employer class, cash receipt year, source-ledger completeness and required BIR documentation before approval.

**Primary sources:** BIR RR 29-2025 (December 22, 2025, effective January 6, 2026), BIR RMC 50-2018, section 32(B)(6)(b) of the National Internal Revenue Code, BIR RMOs 26-2011 and 66-2016. This is a code implementation with synthetic tests, **not** an independent Philippine CPA attestation or production payroll authorization.
