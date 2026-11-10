# Questions for a Philippine payroll/tax practitioner (2026-11-10)

**Purpose:** the golden payroll suites (Phases 1-10) and the final-pay tax logic (#1842) each pin a position the software takes. An AI assistant prepared this list so a qualified practitioner can confirm or correct each position in one sitting. The assistant is not a licensed practitioner and none of these positions is certified. Nothing here authorizes filing or live payroll.

**How to answer:** for each question write **Confirm**, or **Change to …** with the rule you rely on. A changed answer becomes a code change plus a corrected golden value.

All figures are fictional. Amounts are pesos.

## A. Withholding tax across the year

**A1. Per-cutoff withholding with a year-end true-up.**
The software withholds each semi-monthly cutoff from the semi-monthly table on that cutoff's taxable pay alone. It keeps no year-to-date tax. Differences are settled once, at year end. Consequences pinned in Phase 9: an employee hired July 1 at 30,000/month has 6,044.40 withheld and refunded in full in December; a raise from 20,000 to 40,000 in July produces a 3,394.20 December refund.
*Is non-cumulative semi-monthly withholding acceptable, or must withholding be cumulative/annualized during the year for mid-year hires and pay changes?*

**A2. Where the year-end difference is settled.**
The adjustment is bound to the cutoff ending December 31 and collected or refunded on that payslip (Phase 10).
*Confirm this meets the employer's year-end adjustment duty, including the refund deadline.*

**A3. Bracket tables in use.**
Annual: 0 to 250,000 exempt; 15% over 250,000; 22,500 + 20% over 400,000; 102,500 + 25% over 800,000; 402,500 + 30% over 2,000,000; 2,202,500 + 35% over 8,000,000. Semi-monthly: exempt to 10,417; 15% over 10,417; 937.50 + 20% over 16,667; 4,270.70 + 25% over 33,333; 16,770.70 + 30% over 83,333; 91,770.70 + 35% over 333,333.
*Confirm both tables for 2026 pay dates.*

## B. 13th month and the 90,000 exemption

**B1. One shared pool.** 13th-month pay, bonuses, other benefits and de minimis excess share one 90,000 exemption per year; a June bonus of 60,000 leaves only 30,000 of exemption for the December 13th month (Phase 10). *Confirm.*

**B2. Excess taxed in the cutoff that pays it.** The amount above 90,000 is added to that cutoff's taxable pay and taxed from the semi-monthly table; any over-withholding is refunded at year end. *Confirm.*

**B3. Unpaid 13th month is accrued at year end.** If the 13th month (basic salary actually earned ÷ 12) was not paid, or only partly paid, by the last payroll, the year-end computation adds the unpaid part to gross compensation and treats it as 13th month for the exemption (Phases 9 and 10).
*Is accrual right, or is it recognized only in the year it is actually paid (for example if paid in January)?*

**B4. Basis of the 13th month.** Basic salary actually earned in the calendar year, so a mid-year raise uses the pay earned in each half, not 12 × the latest salary. *Confirm.*

## C. Statutory contributions

**C1. Rates and caps for 2026 pay dates.** SSS employee 5% and employer 10% of the monthly salary credit (5,000 to 35,000 in steps of 500; EC 10 below MSC 15,000 and 30 from 15,000). PhilHealth 5% shared equally on a monthly basic salary of 10,000 to 100,000. Pag-IBIG 2% each on a fund salary capped at 10,000. *Confirm each.*

**C2. Daily-paid and hourly-paid workers (Phase 8).** SSS and Pag-IBIG follow the pay actually earned in the cutoff; PhilHealth uses the fixed monthly equivalent (daily rate × 22). One absence therefore lowers SSS but not PhilHealth. *Confirm both halves.*

**C3. SSS base (Phase 4).** De minimis benefits and monetized leave count toward SSS compensation, up to the 35,000 cap; PhilHealth stays on basic salary. *Confirm.*

**C4. 13th month and bonuses in the SSS and Pag-IBIG base.** The suites exclude them from both bases. *Is that the correct default?*

**C5. Split timing.** Each semi-monthly cutoff collects half the monthly contribution. *Confirm this is acceptable (versus collecting all on one cutoff).*

## D. Minimum wage earners

**D1.** A minimum wage earner's statutory minimum wage, holiday pay, overtime, night differential and hazard pay are exempt; other pay (for example a taxable allowance) and benefit-pool excess are taxable after deducting employee contributions (Phases 4 and 9). *Confirm, in particular deducting contributions from the taxable supplementary pay.*

## E. De minimis and leave

**E1. Rice subsidy ceiling.** 2,500 a month under RR 29-2025; the excess goes to the 90,000 pool (Phase 4). *Confirm the ceiling and effectivity.*

**E2. Monetized unused vacation leave.** Private sector: up to 12 days a year exempt as de minimis from January 6, 2026 (10 before), counted per employee per tax year by the pay date of the payroll that paid it; excess goes to the 90,000 pool; sick leave and service incentive leave are not treated as exempt under this rule (#1842). *Confirm the limit, the annual counting and which leave types qualify.*

**E3. Cross-year leave payout.** A leave payout whose reviewed tax date and actual payment fall in different years is held for recalculation (#1842). *Confirm the year of recognition is the year of payment.*

## F. Separation (final) pay

**F1. Separation pay exemption.** Exempt only for an authorized (involuntary) cause with a supporting document reference; the reviewer must enter the taxable portion as a number. Resignation, just-cause termination and unsupported cases default to fully taxable (#1842). *Confirm, and state the documents you would require.*

**F2. Final-pay tax.** Final pay is annualized: tax due on the year's taxable income less tax already withheld, with the pro-rated 13th month under the 90,000 pool (Phase 7). *Confirm.*

**F3. Release deadline.** Due date is 30 days after the last day of work (Phase 7). *Confirm.*

## G. Company policy, not tax (for the employer to decide)

**G1.** A 5-minute grace period is subtracted from lateness (arriving 09:45 counts as 40 minutes late), and daily-paid workers get no separate late deduction because they are paid only for time worked (Phase 5).

## Where each position is pinned

`certification/golden-payroll-phase4.json` to `phase10.json`, `docs/payroll-certification/golden-payroll-phase-4.md` to `-10.md`, and `src/lib/final-pay-tax-classification.ts` with `tests/final-pay-tax-classification.test.ts`.
