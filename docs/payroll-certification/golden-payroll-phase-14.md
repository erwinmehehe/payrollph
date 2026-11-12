# Golden payroll certification — Phase 14 one de minimis ceiling for imported and calculated pay

Phase 13 certified imported prior-provider history in the year-end settlement, including imported de minimis capped at its statutory ceilings. A company that switches payroll provider part-way through the year can then have the **same de minimis category from both sources**: the previous provider's months (imported, with the category totals the migration importer stores) and the months PayrollPH calculated. The ceiling in RR 29-2025 applies once per category and statutory period to the worker, not once per source. Phase 14 certifies that the year-end settlement applies it to the union.

Run: `npx tsx scripts/golden-payroll-phase14.ts` against the disposable PostgreSQL used by CI. Expected values are immutable hand-derived literals in `certification/golden-payroll-phase14.json`, never computed with PayrollPH functions.

## What was wrong

Found while writing this suite. Year-end annualization capped the imported months on their own and took the engine's calculated de minimis lines as the engine had accounted them (the engine only sees its own earlier cutoffs). A worker with, for example, a uniform allowance of 6,000 a month from the previous provider and 6,000 a month from PayrollPH was treated as exempt for 8,000 in each source: 16,000 exempt instead of 8,000, and the 90,000 benefit pool absorbed the rest. In that case taxable income was 329,100 instead of 333,100 and the tax due **600.00 too low**.

## Fix

`importedDeMinimisTreatment()` now accepts the engine's own fixed-ceiling de minimis lines for the same worker and counts them in the same category-and-statutory-period totals as the imported amounts. `runYearEndAnnualization()` removes the engine's separately capped figures for those categories and uses the combined result, only for workers who have imported de minimis. The daily overtime/night meal allowance (a wage-order based ceiling) and monetized leave days stay exactly as the engine accounted them.

## What it certifies (4 cases)

The company switched provider on 2026-07-01. January to June are six imported monthly rows per worker; July to December are the engine's own cutoffs 13–24 with an active de minimis grant. Every worker earns 30,000 basic a month.

| Case | Previous provider | PayrollPH grant | Result |
| --- | --- | --- | --- |
| Ceiling partly used | uniform allowance 1,000 a month | 2,000 a month | 18,000 paid against the 8,000 yearly ceiling: exempt 8,000, excess 10,000; gross 408,000, non-taxable 78,000, taxable 330,000, tax 12,000.00 |
| Ceiling exhausted by both | 6,000 a month | 6,000 a month | 72,000 paid: exempt 8,000, excess 64,000; the pool takes 90,000 of 94,000; gross 462,000, non-taxable 128,900, taxable 333,100, tax 12,465.00 (the separately capped result is 600.00 lower) |
| Monthly ceiling, separate periods | rice subsidy 3,000 a month, January–June | 3,000 a month, July–December | months never overlap, so each keeps its own 2,500 ceiling: exempt 30,000, excess 6,000; gross 426,000, taxable 329,700, tax 11,955.00 |
| History without de minimis | none | uniform allowance 6,000 a month | nothing to share: the engine's own accounting stands, exempt 8,000, excess 28,000; gross 426,000, taxable 329,100, tax 11,865.00 |

Each worker's breakdown is also checked: de minimis exempt and excess, benefit pool, exempt and taxable pool, imported rows 6, runs included 12.

## Mutation evidence

The year-end code was broken six ways, the suite run, then the file restored. Five are caught: no sharing at all (the code before the fix: the two shared-ceiling cases fail); the engine's own figures not removed when the union replaces them (double counted); the statutory periods merged into one per category (the monthly case fails); the engine lines left out of the union; the ceiling not applied to the union. One mutation is **not** caught and is equivalent: pulling a worker with no imported de minimis into the union gives exactly the engine's own accounting, so no input can tell the two apart.

## Not covered

- Only the year-end settlement is certified. The engine still applies the ceiling to its own earlier cutoffs only, so in a provider-switch year its payslip lines for the calculated months can show more of a category as exempt than the settlement finally allows, and its withholding in those cutoffs follows. The payroll run flags that combination for review and the settlement corrects the year. Withholding in the calculated cutoffs is not asserted here.
- Only fixed-peso ceiling categories are shared. The meal allowance and leave days are left as the engine accounted them.
- Monthly imported rows and one category per worker. Month and year periods are exercised; the semester period uses the same rule.
- SSS is computed by the engine on the month's gross, de minimis included; whether SSS compensation should include de minimis is a rule question for a practitioner and the expected values follow the engine's current treatment.
- The release approval workflow and the HTTP, role and MFA gates are not exercised; the importer is covered by its own tests.
- The expected values follow the cited BIR rules and the repository's year-end treatment. They have **not** been reviewed by a qualified Philippine tax practitioner and must be before anyone relies on them for filing.

## Ledger effect

`src/lib/year-end.ts` is a pinned dependency of the `GET` and `POST /api/year-end` tenant-isolation credit, so this change withdraws that provisional credit to an exact zero-credit hold (ledger 454 COVERED / 9 GAP) until a fresh exact-head PG16 proof on main renews it, exactly as after Phase 13's fix. The hold is not a security finding.
