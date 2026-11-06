# Golden payroll certification — Phase 5 attendance pay

Issue: #192

Phase 5 runs **5 employee-level cases through the real PayrollPH payroll engine** (enqueue and drain against a disposable database) for attendance-driven pay that Phases 1–4 do not exercise. Phase 2A uses monthly-salaried workers with no attendance, and Phase 2B and the Phase 3 pay rules only cover premiums. Every expected value is an immutable literal in `certification/golden-payroll-phase5.json`, computed by hand from the cited rules and never with PayrollPH functions. Comparison is exact to the centavo.

Every worker uses a 09:00–18:00 shift with a 60-minute meal break, 8 standard hours and 22 standard days, over 10 workdays in the September 1–15, 2026 cutoff.

| Case | What it proves |
| --- | --- |
| `dailyFullAttendance` | A ₱800/day worker with 10 full days is paid 80 h / 8 × ₱800 = ₱8,000.00 |
| `dailyLateArrivalNoDock` | Arriving 09:45 is paid for the 435 minutes actually worked (₱7,925.00). The lateness is recorded (40 min) but a daily worker is not docked a second time |
| `dailyHalfDayNoBreak` | A 09:00–13:00 half day with no break punch is paid all 240 punched minutes (₱7,600.00); no meal break is presumed on a span of at most half the scheduled day (fixed in #1788) |
| `monthlyTardinessUndertime` | A ₱30,000/month worker keeps the full ₱15,000.00 cutoff basic. 40 late minutes cost ₱113.64 and 30 undertime minutes cost ₱85.23 at the ₱170.4545 hourly rate. Stored gross stays ₱15,000.00 |
| `monthlyGraceBoundary` | 09:05 is within the 5-minute grace (no deduction). 09:06 costs exactly 1 minute (₱2.84) |

Every case also proves that the printed payslip lines add up to the stored gross, deductions and net, using the shared payslip classifier.

## Resolved finding: half day with no break punch

Phase 5 first showed that a daily worker who punched 09:00–13:00 with no break pair was paid 3 hours (₱7,500.00) because the engine always deducted the scheduled 60-minute break. #1788 fixed this: a punched span of at most half the scheduled working day is not presumed to contain a meal break, the worker is paid the punched time, and a reviewer flag asks to confirm no meal break was taken. The case now asserts the lawful ₱7,600.00.

## Positions that need owner or practitioner review

1. **Grace policy.** The engine subtracts the 5-minute grace from lateness: 09:45 counts as 40 minutes, not 45. DOLE prescribes no grace period, so this is a company-policy default. Please confirm it is intended. Some employers count full lateness from shift start once grace is exceeded.
2. **No double penalty for daily workers.** Daily-paid workers are paid only for regular minutes worked and receive no separate LATE/UT deduction.

## Also recorded, not exercised here

- **Leave monetization exemption.** `src/app/api/leave/conversion/route.ts` sets `taxExempt = daysConverted <= 12` for each request, but the 12-day exemption is an annual limit. Two 10-day conversions in one year are both marked exempt (20 days). A single 13-day conversion is marked wholly taxable instead of 12 exempt + 1 taxable. The engine only follows the stored flag, so this needs a route change after tax-practitioner confirmation.
- **Regular 13th-month pay** is not computed by regular payroll runs (only final pay and year-end), so it is not covered here.
- Statutory contributions and withholding for daily-paid workers are not asserted.

## Mutation evidence

Setting the engine's grace to 0 minutes was confirmed to fail three cases (`dailyLateArrivalNoDock`, `monthlyTardinessUndertime`, `monthlyGraceBoundary`) before the engine was restored.

## Run

```bash
npm run payroll:golden:phase5
```

The reconciliation evidence is written to `qa-artifacts/golden-payroll-phase5-reconciliation.json`. CI runs the suite after Phase 4 and uploads that file.
