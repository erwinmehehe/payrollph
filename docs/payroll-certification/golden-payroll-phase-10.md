# Golden payroll certification — Phase 10 paid 13th month and the December binding

Phase 9 certified the year-end annualization with the 13th month **accrued** at year end, because a regular payroll run never pays it. In practice an employer pays the 13th month (and sometimes a bonus) inside a cutoff, and the year-end adjustment is then bound to the December 31 cutoff and collected or refunded on that payslip. Phase 10 certifies that real path. Every expected value is an immutable literal in `certification/golden-payroll-phase10.json`, derived by hand from the published rules and never with PayrollPH functions. Comparison is exact to the centavo.

Run: `npx tsx scripts/golden-payroll-phase10.ts` against a disposable PostgreSQL (no npm script: `package.json` is byte-pinned by the tenant credit scripts).

One organization, all 24 semi-monthly cutoffs of 2026, four monthly employees. The 13th month and bonus are approved supplementary earnings (`13th_month`, `bonus`). Cutoffs 1–23 are calculated by the real engine and set to Released; cutoff 24 (ending December 31) stays in Needs review, is annualized with that run **included and bound** by the real `runYearEndAnnualization`, requeued in the same transaction (as the year-end route does) and recalculated.

| Employee | What is paid | Cutoff 23 | Year end |
| --- | --- | --- | --- |
| `paidThirteenthWithinCap` | ₱30,000 13th month, ₱30,000 salary | Whole 30,000 exempt: taxable and withholding (₱503.70) are unchanged | Identical to the Phase 9 accrual case: collect ₱1.20, so paying versus accruing the 13th month changes nothing annually |
| `paidThirteenthAboveCap` | ₱120,000 13th month, ₱120,000 salary | 90,000 exempt, 30,000 taxable: taxable ₱87,775, withholding ₱18,103.30 | Refund ₱220.90: the cutoff table taxes the 30,000 excess at 30%, the annual table at 25% |
| `partialThirteenthPaid` | ₱30,000 of a ₱60,000 entitlement | Exempt in full, withholding ₱3,259.10 | The unpaid ₱30,000 is accrued into gross; collect ₱1.60 |
| `bonusThenThirteenthSharePool` | ₱60,000 bonus (cutoff 12) then ₱60,000 13th month (cutoff 23) | The bonus uses 60,000 of the pool, so only 30,000 of the 13th month is exempt: taxable ₱58,275, withholding ₱10,506.20 | Refund ₱1,245.50; shows the 90,000 pool is shared across cutoffs and with bonuses |

After the binding, each final payslip carries a `YE-TAX` line (collected as a deduction, refunded as a credit), its net equals the cutoff's own net adjusted by exactly the bound amount, and its own withholding is unchanged. The suite also asserts that every earlier payslip is correct, that no payslip before the binding carries a year-end line, that the annual `taxWithheld` equals the sum of the withholding lines the employee actually saw, and that every printed payslip adds up.

## Mutation evidence

Five source rules were each changed and confirmed to fail the suite before the files were restored: the prior-pool contribution ignored in the engine, the ₱90,000 cap raised to ₱900,000, the unpaid 13th-month accrual double-counted at year end, the sign of the year-end payslip line flipped, and the final cutoff left out of the annualization. The prior-pool mutation fails only `bonusThenThirteenthSharePool`; the cap mutation fails it and `paidThirteenthAboveCap`; the other three fail all four employees.

## Not covered

- Daily and hourly workers, attendance pay, loans, allowances and leave across a year; imported prior-provider history; prior-employer and PERA evidence; minimum wage earners; interaction with final pay (Phase 7).
- The year-end route's HTTP layer, role and MFA gates, and settlement after release; the library functions it calls are exercised.
- Release approval: cutoffs 1–23 are set to Released in the fixture.
- How SSS and Pag-IBIG treat a 13th month in a company's real benefit setup: the fixture excludes it from both bases.
- **Practitioner review:** the expected values follow the cited rules and the repository's year-end treatment. They have not been reviewed by a qualified Philippine tax practitioner and must be before anyone relies on them for filing.
