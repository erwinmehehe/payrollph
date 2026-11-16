# 13th-month entitlement module (PD 851 minimum)

Status: pure library and golden tests only. Evidence label `SOLO_VERIFIED_DEV`. **Nothing calls this module yet**: no route, schema, payroll run, year-end, final-pay or DOLE-report behavior changes, no tenant-ledger pin moves, nothing is activated. Not a payroll certification.

Code: `src/lib/thirteenth-month-entitlement.ts`. Tests: `tests/thirteenth-month-entitlement.test.ts` (20 hand-derived, adversarial and boundary cases; the original 15 were mutation-checked with five deliberate bugs).

## Rule encoded

Entitlement = 1/12 of BASIC salary actually earned in the calendar year, rounded once to the centavo half-up (`floor((centavos + 6) / 12)`). Basic comes from released payroll lines:

| Counts as basic | Left out (reported in `excludedPay`) | Never pay |
| --- | --- | --- |
| `BASIC`, `LATE` and `UT` (negative), `LEAVE-*` paid leave, `RETRO-*` only when the ORIGINAL cutoff is in the tax year | `OT`, `ND`, `HOLIDAY`, `HOLIDAY_UNWORKED`, `OTPREM-*`, `NDPREM-*`, `LEAVE_CONV-*`, retro from another year | `SSS`, `PHIC`, `HDMF`, `WHT`, `DM-*`, `UNPAID_MANDATORY`, 13th-month payout lines |

An unknown code is excluded and flagged (`UNCLASSIFIED_LINE_EXCLUDED`); missing or unverifiable line amounts now block (`LINE_AMOUNT_INVALID`), and a retro line with an unknown source year blocks. These match the behavior of `readBasicAndThirteenth` in `final-pay.ts`, which this module is meant to replace; the inclusion list was taken from that function, not re-derived from DOLE text.

## Negative liabilities (new behavior)

- A negative 13th-month payout line is a reversal and reduces what counts as granted.
- Each source (payroll, historical, final pay) is netted separately and floored at zero, so a data error in one cannot create credit against another.
- Overpayment is reported (`overpaidCentavos`, flag `OVERPAID_NOT_RECOVERED_NEEDS_POLICY`). Nothing is deducted or recovered.
- A net-negative basic base floors the entitlement at zero and is flagged.
- Any invalid amount, unsafe retro adjustment ID, accumulated centavo overflow or unsupported basic-centavo bound blocks with a named reason. The entitlement calculation returns zero monetary outputs when blocked, not partial payment instructions.
- If `sumBasicCentavos` returns any blockers, its basic and excluded-pay subtotals are **partial diagnostic values only**; callers must stop, not pass them on as earned salary. The new functions do not trigger payroll or authorize any payment.
- The 1/12 result is computed directly from integer centavos, without converting the centavo source to floating-point pesos and back.

## Divergences in the current code (measured, not yet fixed)

1. **Rounding.** `src/lib/dole-thirteenth-month-report.ts:37` computes `round2(basic / 12)` in floating point. `year-end.ts:480` uses the exact centavo method only when the `exactThirteenthCentavos` flag is on. Over every basic amount from 100.00 to 600,000.00 the report differs from the exact method in 518,758 of 59,990,001 cases (0.87%), always one centavo LOW, never high. Example: basic 100.02 gives 8.33 in the report and 8.34 exact. Effect: the report can miss a one-centavo shortfall. It cannot create a false one.
2. **Reversals ignored.** `readBasicAndThirteenth` (`final-pay.ts`) and the DOLE report apply `Math.max(0, amount)` per payout line, so a reversal is dropped and the original payout still counts as granted. The tests show 95,000.00 reported still due where 100,000.00 is.
3. **Possible double count, NOT reproduced.** The DOLE report adds payroll, historical and final-pay 13th amounts. If one payout is recorded both as a payroll line and in the separation record it would count twice. This was read from the code path only; it needs a database-backed reproduction before anyone relies on it.

## SOURCE NOT VERIFIED

- The DOLE/PD 851 text itself was not re-read for this module. The inclusion and exclusion list is taken from existing code comments and behavior. Items to confirm against the primary text: treatment of paid leave and of HOLIDAY_UNWORKED when integrated into basic by agreement or practice (current code excludes it and says a reviewed policy is needed), and the exact coverage and the one-month-of-service condition.
- Overpayment recovery: not asserted. The module reports it and stops.
- Resignation and separation proration rules are not encoded here; final pay keeps its own path.

## Not built yet

- Rewiring `year-end.ts`, `final-pay.ts`, `dole-thirteenth-month-report*.ts` and the routes that import them. Those files carry tenant-ledger pins and need blob repins and inventory rows, so each needs its own proof.
- The `KNOWN DIVERGENCE` test in the suite asserts today's floating-point value; it must be updated when the report is rewired.
- A database-backed reproduction of the possible double count (item 3 above).
