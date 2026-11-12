# Golden payroll certification — Phase 13 imported prior-provider history in the year-end settlement

Phase 9 certified the year-end annualization from payroll runs the engine calculated itself. A company that switches payroll provider part-way through the year brings the earlier months as **imported history**: source-of-truth totals that join the annualization without being recalculated under PayrollPH's rule tables. Phase 13 certifies that join.

Run: `npx tsx scripts/golden-payroll-phase13.ts` against the disposable PostgreSQL used by CI. Expected values are immutable hand-derived literals in `certification/golden-payroll-phase13.json`, never computed with PayrollPH functions. The suite is test-only: it changes no engine, schema or API code.

## What it certifies (8 cases)

The company switched provider on 2026-07-01. January to June are six imported monthly rows per worker (stored as the migration importer stores them); July to December are the engine's own cutoffs 13–24 (Phase 9's PHP 30,000 a month worker: gross 15,000, SSS 750, PhilHealth 375, Pag-IBIG 100, withholding 503.70). The real `runYearEndAnnualization()` then settles the year.

| Case | Imported history | Result |
| --- | --- | --- |
| Same figures as one employer | six months identical to calculated ones | the Phase 9 steady worker: gross 390,000 with the accrued 13th month, contributions 29,400, taxable 330,600, tax 12,090.00, withheld 12,088.80, collect 1.20 |
| Previous provider over-withheld | 1,200.00 a month instead of 1,007.40 | tax due unchanged; withheld 13,244.40; **refund 1,154.40** |
| 13th month paid by the previous provider | 30,000 paid in the June row | counted once: 13th month 30,000, nothing accrued again, collect 1.20 |
| De minimis inside its ceiling | rice subsidy 2,500 a month in each imported row (gross 32,500) | 15,000 exempt, nothing in the benefit pool: gross 405,000, non-taxable 74,400, taxable 330,600, tax 12,090.00, collect 1.20 |
| De minimis above its monthly ceiling | rice subsidy 3,000 a month | 2,500 a month exempt (15,000), 500 a month (3,000) into the shared 90,000 pool: non-taxable 77,400, taxable 330,600, collect 1.20 |
| Annual ceiling across months | uniform allowance 2,000 a month against the 8,000 yearly ceiling | 8,000 exempt, 4,000 into the pool however the months fall: non-taxable 71,400, taxable 330,600, collect 1.20 |
| Rows outside the tax year | the same six months plus rows dated 2025-12-31 and 2027-01-01 | both ignored; identical to the first case |
| Controls (separate employer) | a row without basic salary; a repeated source reference; imported monetized leave days; an unknown de minimis category; de minimis above the row's gross; a minimum wage earner with imported history; none | refused with the exact reasons, a refused settlement leaves no adjustment rows, and the clean settlement is the single-cutoff result (refund 503.70, 0 imported rows recorded) |

Each worker's stored breakdown is also checked: imported rows 6, periods included 18, runs included 12, basic salary earned 360,000, 13th month entitlement 30,000, already paid, still due.

## Mutation evidence

Seven rules of the real year-end code were each broken, the suite run, then the file restored. Every one was caught by the assertion meant to catch it: imported withholding not counted; imported contributions not counted; a 13th month paid by the previous provider not counted as paid; imported rows of other years not excluded; imported basic salary not counted toward the 13th month; an imported row without basic salary accepted; and a minimum wage earner with imported history accepted.

Five more cover imported de minimis: the breakdown not used (the worker is then over-collected 2,250.00: tax due 14,340.00 instead of 12,090.00); the statutory ceiling not applied; the ceiling applied per row instead of per statutory period; de minimis above the row's gross accepted; and monetized leave days accepted. All five are caught.

## Fix — imported de minimis is now applied

The importer stores an optional `deMinimisBreakdown` per imported row (amount by statutory category). Year-end annualization used to ignore it, so imported pay was treated as fully taxable while the engine's own de minimis benefits were exempt; a worker whose previous provider paid, for example, a rice subsidy was over-collected (2,250.00 in the first de minimis case above). `importedDeMinimisTreatment()` in `src/lib/year-end.ts` now caps each category at its RR 29-2025 ceiling per statutory period (month, semester or year by pay date): the part inside the ceiling is exempt and the excess joins the shared 90,000 pool, as for the engine's own lines. Cases it cannot prove are refused, not guessed: monetized leave days and the daily overtime meal allowance (their ceilings are not peso amounts per period), unknown categories, and de minimis larger than the row's gross pay.

Imported de minimis is not combined with de minimis grants the engine calculates for the same worker; the payroll run already flags that combination for review.

## Not covered

- The importer's parsing, mapping and approval, and the HTTP, role and MFA gates of the migration routes.
- Semi-monthly imported rows (they aggregate the same way but are not separately exercised); imported de minimis (see the finding); a minimum wage earner with imported history is refused (certified), not supported.
- The release approval workflow: runs are set to Released in the fixture.
- **Practitioner review:** the expected values follow the cited BIR rules and the repository's year-end treatment. They have not been reviewed by a qualified Philippine tax practitioner and must be before anyone relies on them for filing.
