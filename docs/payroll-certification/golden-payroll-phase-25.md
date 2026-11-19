# Golden payroll Phase 25 — final pay and year-end reconciliation

Two fictional workers earned ₱60,000 per month from July through December 2026. One received an additional ₱12,000 exempt supplementary allowance in cutoff 23. The harness calculates and releases cutoffs 13–24 and compares the resulting year-end settlement with the final-pay calculator using the Separation API’s released-row inputs. Tolerance is zero centavos.

| Worker | Gross including 13th month | Non-taxable | Taxable | Annual tax | Withheld | Refund | Net final pay |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Control | 390,000.00 | 50,700.00 | 339,300.00 | 13,395.00 | 39,109.20 | 25,714.20 | 55,714.20 |
| Exempt allowance | 402,000.00 | 62,700.00 | 339,300.00 | 13,395.00 | 39,109.20 | 25,714.20 | 55,714.20 |

Before this correction the allowance worker received ₱53,914.20. The fix carries the explicitly exempt released allowance into annualization while retaining gross compensation for reporting. The ₱30,000 of unpaid 13th-month pay accounts for the difference between the refund and net final pay. An affected pending package computed under the old rule has a different source fingerprint and requires recomputation before approval or release.

The PG16 case exercises the real engine, year-end settlement and final-pay calculation. A separate source test checks the route passes the loaded released rows. This case covers a year-end termination with no imported periods, other outstanding pay, loans, or prior-employer income.

The GitHub workflow provisions disposable PG16. Local execution also requires an empty loopback PG16, `GOLDEN_PHASE25_DISPOSABLE=local-disposable-pg16-only`, `GOLDEN_PHASE25_LOCAL_CONFIRM=fresh-empty-fictional-database`, and the shared payroll QA safety checks. Run `node --import tsx scripts/golden-payroll-phase25.ts`. Results are written to `qa-artifacts/golden-payroll-phase25-reconciliation.json`.
