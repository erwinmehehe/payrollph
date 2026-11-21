# Golden Payroll Phase 39 — multiple rate revisions and ordinary overtime

Phase 38 passed 7 synthetic cases with one raise. This **proof-only** follow-on covers 8 cases with two changes in the *same* September 2026 cutoff: two raises, a raise followed by a pay cut, and approved overtime before, between and after both changes. It also catches an earlier draft calculated after both future revisions are stored.

- Oracle: `certification/golden-payroll-phase39.json` — hand-derived literal centavos, zero tolerance.
- Real-engine harness: `scripts/golden-payroll-phase39.ts` — dated punches, approved overtime, both cutoffs, payslip line-bucket reconciliation.
- Isolated CI: `.github/workflows/golden-payroll-phase39-pg16.yml` — exact PR-head with empty disposable PostgreSQL 16, no Neon or payment providers.
- Changes are limited to these three new artifacts and this document. No engine, schema, API, secrets, production data or migration change.

## Fixed independent expectations

All workers' Sep 1–15 cutoff is **gross ₱8,000**, SSS ₱400, PhilHealth ₱220, Pag-IBIG ₱100, withholding ₱0, net **₱7,280**. In Sep 16–30, five workdays precede Sep 23, three follow Sep 23, and three follow Sep 28.

| Test case | Sep 16–30 gross | SSS | PhilHealth | Net |
| --- | ---: | ---: | ---: | ---: |
| dailyOvertimeNoRevisionControl | 9,550.00 | 475.00 | 220.00 | 8,755.00 |
| dailyTwoRaises | 9,340.00 | 475.00 | 286.00 | 8,479.00 |
| hourlyTwoRaises | 9,460.00 | 475.00 | 297.00 | 8,588.00 |
| dailyTwoRaisesWithOvertime | 10,146.25 | 500.00 | 286.00 | 9,260.25 |
| hourlyTwoRaisesWithOvertime | 10,278.75 | 525.00 | 297.00 | 9,356.75 |
| dailyRaiseThenCutWithOvertime | 10,146.25 | 500.00 | 242.00 | 9,304.25 |
| hourlyRaiseThenCutWithOvertime | 10,212.50 | 500.00 | 242.00 | 9,370.50 |
| dailyTwoRaisesRecordedEarly | 9,340.00 | 475.00 | 286.00 | 8,479.00 |

Every second cutoff also has Pag-IBIG **₱100**, withholding **₱0**. The highest net and taxable cutoff compensation is ₱9,370.50, below ₱10,417. The daily two-raises case is 5×800+3×860+3×920 = ₱9,340. Adding overtime (2×100×1.25)+(2×107.50×1.25)+(2×115×1.25) = ₱806.25, total gross ₱10,146.25. September earned ₱18,146.25 gives SSS credit ₱18,000 → monthly employee ₱900, less first cutoff ₱400 = **₱500**. End-rate PhilHealth (920×22×2.5%)−220 = **₱286**.

The raise-then-cut daily worker has the **same gross ₱10,146.25** but a lower final rate, so its second PhilHealth is **₱242**, proving the rule uses the cutoff-end effective rate rather than the highest rate. The recorded-early case must still pay the earlier ten September days at 800/day despite both later rates already being stored.

## Status and safety

Status **pending exact-head CI execution**; no pass is claimed by creating this PR. The workflow requires 8/8 actual engine cases with exact centavo amounts and earnings/deductions/net payslip reconciliation; failed-case artifacts are retained. Do not tune the oracle to match a failing engine. Independent tax/security review, employer parallel runs, money/payout activation and production launch remain **NO-GO**.

**Phase 4 clarification:** Refund rendering's source bug was fixed by merged [PR #1783](https://github.com/erwinmehehe/payrollph/pull/1783). The Phase 4 harness asserts refund-as-deduction-credit and reconciles all nine cases. Browser/PDF rendered-signoff evidence is still open and **not certified by this Phase 39 test**. No retroactive released-cutoff governance, holiday/night/rest premiums or daily/hourly year-end/final-pay is exercised.
