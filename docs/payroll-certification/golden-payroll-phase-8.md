# Golden payroll certification — Phase 8 daily and hourly statutory contributions

Phases 1–6 certify SSS, PhilHealth, Pag-IBIG and withholding only for **monthly-salaried** employees. Phase 8 runs **4 daily-paid and hourly-paid employee cases through the real PayrollPH payroll engine** (enqueue and drain against a disposable database), September 1–15, 2026 first cutoff, 50/50 contribution split. Every expected value is an immutable literal in `certification/golden-payroll-phase8.json`, derived by hand from the published rules and never with PayrollPH functions. Comparison is exact to the centavo, including the employer-side shares, and every case checks that the printed payslip adds up.

Run: `npx tsx scripts/golden-payroll-phase8.ts` against a disposable PostgreSQL (no npm script: `package.json` is byte-pinned by the tenant credit scripts).

The rule this suite pins: for a daily or hourly worker the **SSS and Pag-IBIG base is the pay actually earned in the cutoff** (projected to a month on the first cutoff), while **PhilHealth uses the fixed monthly equivalent** of the rate (daily rate × 22 days, or hourly rate × 8 hours × 22 days), so an absence lowers SSS but not PhilHealth.

| Case | Worker | What it proves |
| --- | --- | --- |
| `dailyTenDaysBaseline` | ₱800/day, 10 days (gross ₱8,000) | SSS MSC 16,000 → ₱400.00; PhilHealth on 17,600 → ₱220.00; Pag-IBIG ₱100.00; net ₱7,280.00 |
| `dailyAbsenceLowersSssNotPhilHealth` | ₱800/day, 9 days (gross ₱7,200) | SSS falls to MSC 14,500 → ₱362.50 and EC drops from ₱15 to ₱5; PhilHealth stays ₱220.00 |
| `hourlyEqualsDailyEquivalent` | ₱100/hour, 10 days | Every amount equals the ₱800/day worker (same 17,600 monthly equivalent) |
| `dailyHighRateCapsAndTaxes` | ₱2,000/day, 10 days (gross ₱20,000) | SSS capped at MSC 35,000 → ₱875.00; PhilHealth on 44,000 → ₱550.00; withholding ₱1,299.10 in the 20% bracket; net ₱17,175.90 |

## Mutation evidence

Three engine rules were each changed and confirmed to fail exactly the cases designed to catch them, before the files were restored: PhilHealth base switched from the fixed monthly equivalent to the cutoff's earned pay ×2 (all four cases), the SSS monthly projection ×2 → ×3 (the three cases below the SSS cap), and the SSS EC threshold 15,000 → 14,000 (`dailyAbsenceLowersSssNotPhilHealth` only). A Pag-IBIG projection mutation was tried and not kept: every case already sits above the ₱10,000 fund-salary cap, so it cannot distinguish that rule (Phase 2A covers the cap).

## Not covered

- Second-cutoff true-up to actual month-to-date pay for daily or hourly workers (certified for monthly workers in Phase 2B).
- Overtime, night differential, holiday and rest-day premiums, which change the SSS and Pag-IBIG bases (pay-rules suites).
- Minimum-wage screening: the 800/day and 100/hour fictional rates are below the NCR minimum-wage equivalent on purpose and are only flagged for review.
- **Practitioner review:** that SSS follows the cutoff's earned pay for a daily or hourly worker (rather than the monthly equivalent) is a position this suite pins, not a legal conclusion.
