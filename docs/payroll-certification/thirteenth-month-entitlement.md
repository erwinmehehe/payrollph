# 13th-month entitlement module (PD 851 minimum)

Status: pure library with a read-only DOLE-report screening integration and golden tests. Evidence label `SOLO_VERIFIED_DEV`. The report now detects exact-centavo entitlement shortfalls; granted amounts and report hashes are unchanged. Year-end, final-pay and payroll payment paths retain their separate implementations. No schema, route, tenant credit or feature-flag changes. Not a payroll certification.

Code: `src/lib/thirteenth-month-entitlement.ts`. Tests: `tests/thirteenth-month-entitlement.test.ts` (20 hand-derived, adversarial and boundary cases; the original 15 were mutation-checked with five deliberate bugs).

## Rule encoded

Entitlement = 1/12 of BASIC salary actually earned in the calendar year, rounded once to the centavo half-up (`floor((centavos + 6) / 12)`). Basic comes from released payroll lines:

| Counts as basic | Left out (reported in `excludedPay`) | Never pay |
| --- | --- | --- |
| `BASIC`, `LATE` and `UT` (negative), `LEAVE-*` paid leave, `RETRO-*` only when the ORIGINAL cutoff is in the tax year | `OT`, `ND`, `HOLIDAY`, `HOLIDAY_UNWORKED`, `OTPREM-*`, `NDPREM-*`, `LEAVE_CONV-*`, retro from another year | `SSS`, `PHIC`, `HDMF`, `WHT`, `DM-*`, `UNPAID_MANDATORY`, 13th-month payout lines |

An unknown code is excluded and flagged (`UNCLASSIFIED_LINE_EXCLUDED`); missing or unverifiable line amounts now block (`LINE_AMOUNT_INVALID`), and a retro line with an unknown source year blocks. Classification follows `readBasicAndThirteenth` in `final-pay.ts`, but the new module has stricter amount and overflow validation. The inclusion list was taken from that function, not re-derived from DOLE text.

## Negative liabilities (new behavior)

- A negative 13th-month payout line is a reversal and reduces what counts as granted.
- Each source (payroll, historical, final pay) is netted separately and floored at zero, so a data error in one cannot create credit against another.
- Overpayment is reported (`overpaidCentavos`, flag `OVERPAID_NOT_RECOVERED_NEEDS_POLICY`). Nothing is deducted or recovered.
- A net-negative basic base floors the entitlement at zero and is flagged.
- Any invalid amount, unsafe retro adjustment ID, accumulated centavo overflow or unsupported basic-centavo bound blocks with a named reason. The entitlement calculation returns zero monetary outputs when blocked, not partial payment instructions.
- If `sumBasicCentavos` returns any blockers, its basic and excluded-pay subtotals are **partial diagnostic values only**; callers must stop, not pass them on as earned salary. The new functions do not trigger payroll or authorize any payment.
- The 1/12 result is computed directly from integer centavos, without converting the centavo source to floating-point pesos and back.

## Recorded legacy divergences

1. **Rounding — report screening repaired.** The previous report builder computed `round2(basic / 12)` in floating point. `year-end.ts` still uses its exact centavo method only when the `exactThirteenthCentavos` flag is on. Over every basic amount from 100.00 to 600,000.00 the legacy report formula differed from the exact method in 518,758 of 59,990,001 cases (0.87%), always one centavo LOW, never high. Example: basic 100.02 gave 8.33 with the old formula and 8.34 exact. The report now uses the exact result for verifiable, supported centavo inputs; its legacy fallback remains for other inputs. Year-end rounding behavior is unchanged.
2. **Reversals ignored (latent, no producer found).** `readBasicAndThirteenth` (`final-pay.ts`) and the DOLE report apply `Math.max(0, amount)` per payout line or source, so a negative 13th-month line would be dropped and the original payout would still count as granted. The tests show 95,000.00 reported still due where 100,000.00 is. However, the only entry point for a 13th-month earning (the `payroll-earnings` route) rejects `amount <= 0`, and a search of the payroll engine, payslip and adjustment code found nothing that writes a negative 13th-month line. Today this is a defect in waiting, not a live one. It becomes live if a correction or clawback feature ever emits negative payout lines.
3. **Double count: not a double count by design (code reading, not database-reproduced).** Final pay stores `prorated13thMonth = thirteenthDue = max(0, entitlement - thirteenthPaidYtd)` (`final-pay.ts`), the incremental amount still owed, and the separation route writes no payroll entry. The DOLE report's sum of payroll-paid plus final-pay due therefore equals the entitlement, not twice it. A larger total would appear only if a normal payroll run pays a 13th month after the final pay was computed, and then the larger granted figure is correct. Sources read: `final-pay.ts`, `separation/route.ts`, `dole-thirteenth-month-report-server.ts`.

## SOURCE NOT VERIFIED

- The DOLE/PD 851 text itself was not re-read for this module. The inclusion and exclusion list is taken from existing code comments and behavior. Items to confirm against the primary text: treatment of paid leave and of HOLIDAY_UNWORKED when integrated into basic by agreement or practice (current code excludes it and says a reviewed policy is needed), and the exact coverage and the one-month-of-service condition.
- Overpayment recovery: not asserted. The module reports it and stops.
- Resignation and separation proration rules are not encoded here; final pay keeps its own path.

## Rewired so far

- `src/lib/dole-thirteenth-month-report.ts` (pure builder): the 1/12 screening figure now uses this module (exact centavo half-up). Effect: where basic is a whole-centavo amount, the screening entitlement can be 0.01 higher than before in 0.87% of cases, so a one-centavo shortfall the float path hid is now listed in `reviewRows`. The report's `amountGranted`, `totalBenefitsGranted` and `reportHash` are unchanged (they come from granted amounts, not the entitlement). An unverified but finite basic retains the legacy float screening figure **only as a diagnostic**, appears in `incompleteBasicRows`, and blocks recording a portal submission through `readyToSubmit = false`. Missing, non-finite, unsupported, negative or malformed basic input never becomes a verified shortfall or a clean screen (non-finite/malformed values have a null screening figure; a finite negative basic retains the legacy zero display for diagnosis but is marked unverified and blocks submission readiness). This is a pure-builder validation of the aggregated basic; the server's underlying source attribution and reversal handling still require separate work. The report's granted amounts, totals and SHA-256 hash remain untouched.
- Not changed: per-line reversal handling lives in the server reader (`readBasicAndThirteenth` in `final-pay.ts`), so reversals are still dropped there.

## Not built yet

- Rewiring `year-end.ts`, `final-pay.ts`, `dole-thirteenth-month-report-server.ts` and the routes that import them. Those files carry tenant-ledger pins and need blob repins and inventory rows, so each needs its own proof.

## Effect of `EXACT_THIRTEENTH_CENTAVOS_ENABLED` (measured, flag stays OFF)

Pure-function measurement, fictional amounts, `tests/exact-thirteenth-flag-impact.test.ts`. The flag is off unless the variable is exactly `true`. It switches final pay (`final-pay.ts`), year-end (`year-end.ts`) and the standalone helper (`ph-compliance.ts`) between the legacy float formula and exact centavo half-up, and adds a `thirteenthRoundingPolicy` marker to the frozen final-pay and year-end evidence.

- **Size:** over basic 100.00 to 60,000.00 (5,990,001 amounts) the two modes differ in 54,577 (0.91%), always by 0.01, always with the flag OFF one centavo LOW. Over 100.00 to 1,000.00 it is 831 of 90,001 (pinned in the test, recounted with the bare formulas).
- **Approvals:** turning it on or off changes the frozen final-pay source fingerprint in both directions, so an approval frozen under the other setting is rejected as stale (existing test `hcm-final-pay-source-transaction.test.ts`). Expect re-approval of any open final-pay package after a flip.
- **Settled records:** the separation route only recomputes for a new or still-open package; a `released` package starts a new separation, so a released record's stored `prorated13thMonth` is not rewritten by a flip (read from `separation/route.ts`, not exercised end to end here). Approved year-end adjustments are blocked from recompute (`year-end-atomicity.test.ts`).
- **Inconsistency while OFF:** the DOLE screening is exact regardless of the flag, but final pay and year-end are float while OFF. For basic 100.02 with 8.33 granted, final pay owes 0.00 while the DOLE screening lists a 0.01 shortfall that payroll can never clear. Turning the flag on removes the disagreement.
- **Not known:** the production value of the flag. It lives in deployment environment variables, which were not read.
- **Not decided here:** whether and when to enable it. That needs the flag's own approval evidence (tie/boundary tests, flag-off parity, stale-approval rejection, golden reconciliation).
