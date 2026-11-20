# Golden payroll Phase 38: a raise for a daily-paid or hourly-paid worker, with overtime (proof-only)

Phase 37 followed a monthly worker's raise through a year and found that an earlier cutoff calculated after the raise was entered paid the
new rate. A daily or hourly worker is priced differently: every punch is paid at the rate in force on its own date, SSS follows the pay
actually earned in the cutoff and is trued up to the month in the second cutoff, and PhilHealth follows the monthly equivalent of the rate
in force at the end of the cutoff (Phase 8). Seven fictional workers are paid by the real engine for the two September 2026 cutoffs on
disposable PG16, with full 09:00-18:00 punches, and every cutoff is compared with hand-derived centavo literals.

- Catalog: `certification/golden-payroll-phase38.json` (zero centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase38.ts` (real time punches, approved overtime requests, the raise recorded as the employees API
  writes it, real engine; the payslip is checked to add up for every entry)
- CI: `.github/workflows/golden-payroll-phase38-pg16.yml`, an empty disposable PG16 on GitHub Actions. The harness refuses to run
  anywhere else.

**Test, catalog, doc and workflow only. No engine, schema or runtime change.** All seven cases passed on the first run with Phase 37's fix
in place: the hand derivation matched the engine on every cutoff, so no new defect was found.

## Setup

Cutoff 1 is Sep 1-15 with 10 worked days; cutoff 2 is Sep 16-30 with 11 worked days. A day is a 09:00-18:00 punch with a 12:00-13:00
break (8 paid hours). Cutoff 1 at 800 a day (or 100 an hour) is Phase 8's baseline: gross 8,000, SSS 400, PhilHealth 220, Pag-IBIG 100,
net 7,280.

## Cases

| Case | Raise | Cutoff 2 gross | SSS | PhilHealth | Pag-IBIG | Net |
|---|---|---:|---:|---:|---:|---:|
| dailyNoRaise | none (control) | 8,800.00 | 450.00 | 220.00 | 100.00 | 8,030.00 |
| dailyRaiseInsideSecondCutoff | 800 to 900 a day from Sep 23 | 5 x 800 + 6 x 900 = 9,400.00 | 475.00 | 275.00 | 100.00 | 8,550.00 |
| hourlyRaiseInsideSecondCutoff | 100 to 115 an hour from Sep 23 | 5 x 800 + 6 x 920 = 9,520.00 | 475.00 | 286.00 | 100.00 | 8,659.00 |
| dailyRaiseOnCutoffBoundary | 800 to 900 a day from Sep 16 | 11 x 900 = 9,900.00 | 500.00 | 275.00 | 100.00 | 9,025.00 |
| dailyRaiseRecordedWhileEarlierCutoffOpen | the same Sep 16 raise, recorded while cutoff 1 is a draft | 9,900.00 (cutoff 1 still 8,000.00) | 500.00 | 275.00 | 100.00 | 9,025.00 |
| dailyRaiseWithOvertimeAroundIt | 800 to 900 from Sep 23, 2 h overtime on Sep 22 and Sep 24 | 9,400 + 250.00 + 281.25 = 9,931.25 | 500.00 | 275.00 | 100.00 | 9,056.25 |
| hourlyRaiseWithOvertimeAroundIt | 100 to 115 from Sep 23, 2 h overtime on Sep 22 and Sep 24 | 9,520 + 250.00 + 287.50 = 10,057.50 | 500.00 | 286.00 | 100.00 | 9,171.50 |

No case withholds tax: taxable pay stays under the 10,417 exempt cutoff band. Overtime is 1.25 x the hourly rate in force on its own date
(100 before the raise, 115 or 112.50 after), so a raise never reprices a day already worked.

## What this adds to Phase 37

- The Phase 37 correction (a cutoff that ends before a stored raise pays the rate in force then) holds for daily and hourly workers too:
  `dailyRaiseRecordedWhileEarlierCutoffOpen` pays cutoff 1 at 800, and without the correction it fails.
- Each punch and each overtime hour is priced at its own date's rate, so a raise inside a cutoff splits pay correctly.
- PhilHealth uses the monthly equivalent at the end of the cutoff (daily x 22; hourly x 8 x 22) while SSS follows earned pay, including
  overtime (credit 18,000 for 18,057.50 and for 17,931.25).

## Mutation checks (run locally, engine restored afterwards)

| Mutation | Result |
|---|---|
| Phase 37 correction removed | only dailyRaiseRecordedWhileEarlierCutoffOpen fails (6 mismatches) |
| a punch is paid at the rate in force at the end of the cutoff, not on its own date | the four raises inside cutoff 2 fail (12 mismatches); the control, the boundary raise and the recorded-early case pass |
| the monthly equivalent is taken from the start of the cutoff | the same four fail on PhilHealth and net pay (8 mismatches: 220.00 instead of 275.00 or 286.00); the control and boundary cases pass |

## Limitations

- One raise per worker; no night differential, holiday or rest-day premium, absence or leave on a worked date. Overtime is on ordinary
  weekdays only, two hours on one day before and one day after a raise. A premium multiplier on a day after a raise is the same rate x
  multiplier path, but a holiday or rest-day premium is not exercised.
- Only September 2026 is run, so year end and final pay for a daily or hourly worker are not exercised (Phase 37 does them for a monthly
  worker).
- The raise is written straight into the tables the employees API writes; the API's own checks and its retro-adjustment path for released
  cutoffs are not exercised.
- That SSS follows the earned pay of a daily or hourly worker is a position Phase 8 pins, not a legal conclusion.

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data. Money, payout, provider, CSP and calculation-history
flags stay off. No method is credited or re-credited.
