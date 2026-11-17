# Staging scenario: provider-switch year, calculated-cutoff withholding

Verifies PR #2013 on a staging tenant. The expected values are the hand-derived
Phase 15 catalog values (`certification/golden-payroll-phase15.json`); staging
must reproduce them to the centavo. The engine harness
(`scripts/golden-payroll-phase15.ts`) is the ground truth for how each fixture
row is built.

## Safety rules

- Staging only, on a disposable tenant with fictional employees. Never run this
  on a production tenant or with real employee data.
- Payment rails off: `PAYMONGO_DISBURSEMENTS_ENABLED=false`,
  `XENDIT_PAYOUTS_ENABLED=false`, `XENDIT_BILLING_ENABLED=false`,
  `WORKER_ENABLED=false`, `CENTRAL_SCHEDULER_ENABLED=false`. No payout, no
  disbursement, no emails.
- `EXACT_THIRTEENTH_CENTAVOS_ENABLED` stays off. This scenario does not test it.
- The deployed build must contain #2013 (check the build SHA against the merge
  commit or PR head).

## Setup

Tax year 2026, 24 semi-monthly cutoffs, `split` statutory timing, Asia/Manila.
Four fictional employees, each with basic salary 30,000 a month (15,000 a
cutoff). The provider switch is 2026-07-01.

**Imported history (January to June, six monthly rows per employee):**

| Employee | Imported rows |
|---|---|
| A. poolExhaustedBeforeYearEnd | gross 36,000, basic 30,000, SSS 1,500, PhilHealth 750, Pag-IBIG 200, tax withheld 1,007.40, 13th month 0, de minimis breakdown `{ uniformClothing: 6000 }` |
| B. ceilingExhaustedByBothSources | same as A |
| C. historyWithoutDeMinimis | gross 30,000, same contributions and tax, **no** de minimis breakdown field |
| D. controlNoGrant | gross 30,000, same contributions and tax, no breakdown field, no grant |

(Net pay on the imported rows: 32,542.60 for A and B, 26,542.60 for C and D.)

**Engine de minimis grants (uniform and clothing allowance, effective 2026-07-01):**

| Employee | Grant |
|---|---|
| A | 15,000 a month (7,500 a cutoff) |
| B | 6,000 a month (3,000 a cutoff) |
| C | 6,000 a month (3,000 a cutoff) |
| D | none |

**Runs:** calculate cutoffs 13 to 24 (July to December) in order. Set each
calculated run to Released before the year-end settlement, because year-end
reads Released runs.

## Expected result per cutoff (withholding tax on the payslip)

| Employee | Cutoffs 13-20 | Cutoff 21 | Cutoffs 22-24 |
|---|---|---|---|
| A | 484.95 | **1,434.10** | **1,834.10** |
| B | 484.95 | 484.95 | 484.95 |
| C | 484.95 | 484.95 | 484.95 |
| D | 503.70 | 503.70 | 503.70 |

The headline check is A at cutoffs 21 to 24. Before #2013 the engine returned
484.95 there (4,996.60 under-withheld across the four cutoffs).

## Expected entry status and review flags

| Employee | Status | Review flags |
|---|---|---|
| A | Exception, every cutoff 13-24 | shared PHP 90,000 pool flag from cutoff 13; no "no de minimis category breakdown" flag |
| B | Exception, every cutoff 13-24 | shared pool flag from cutoff 13; no "no breakdown" flag |
| C | Exception, every cutoff 13-24 | "has no de minimis category breakdown" flag from cutoff 13; shared pool flag from cutoff 15 |
| D | Ready | none |

Flag text to look for: "has no de minimis category breakdown" and "does not
identify the shared PHP 90,000". A and B keep the pool hold on purpose: the
import schema cannot capture prior other pool benefits, so the hold remains
until complete year-to-date evidence is reconciled. This is the conservative
behavior, not a defect.

## Expected year-end settlement (after cutoff 24 is Released)

| Employee | Gross compensation | Non-taxable | Taxable income | Tax due | Tax withheld | Adjustment |
|---|---|---|---|---|---|---|
| A | 516,000 | 128,900 | 387,100 | 20,565.00 | 16,860.40 | collect 3,704.60 |
| B | 462,000 | 128,900 | 333,100 | 12,465.00 | 11,863.80 | collect 601.20 |
| C | 426,000 | 96,900 | 329,100 | 11,865.00 | 11,863.80 | collect 1.20 |
| D | 390,000 | 59,400 | 330,600 | 12,090.00 | 12,088.80 | collect 1.20 |

13th-month pay in every case is 30,000. Statutory contributions: 30,900 for A,
B and C; 29,400 for D.

Arithmetic check for A: tax withheld = 6,044.40 imported + 8 x 484.95 + 1,434.10
+ 3 x 1,834.10 = 16,860.40; collect = 20,565.00 - 16,860.40 = 3,704.60.

## Pass criteria

All of the following, to the centavo:

1. A's withholding at cutoffs 13-20, 21 and 22-24 matches the table.
2. B, C and D withhold the same amount at every cutoff.
3. Entry statuses and review flags match the table, including the absence of
   flags on D.
4. Year-end figures match for all four employees.
5. No payout, disbursement or email was created.

## Fail and stop conditions

- A withholds 484.95 at cutoff 21 or later: the fix is not active on the
  deployed build. Stop and confirm the build SHA.
- D is anything but Ready, or any employee shows a different amount to the
  centavo: capture the payslip and run id, and do not merge.
- Any unexpected status flip to Ready on A, B or C: the review hold was
  lost. Stop and do not merge.

## Evidence to attach to the PR

Build SHA, the four run ids, a per-cutoff table of observed withholding and
status for each employee, the year-end figures, and confirmation that all
payment rails were off.
