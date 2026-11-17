# Golden payroll certification — Phase 15 withholding and review holds in a provider-switch year

Phase 14 certified the **year-end settlement** of a company that switched payroll provider part-way through the year and said, under "Not covered": *withholding in the calculated cutoffs is not asserted*. Phase 15 closes that gap. It runs the real engine for cutoffs 13–24 after six imported months and checks, for every calculated cutoff, the withholding on the payslip, the payroll entry status and the review flags, and then that the real `runYearEndAnnualization()` closes the year exactly.

Run: `npx tsx scripts/golden-payroll-phase15.ts` against the disposable PostgreSQL used by CI. Expected values are immutable hand-derived literals in `certification/golden-payroll-phase15.json`, never computed with PayrollPH functions.

## What it certifies (4 cases, 12 calculated cutoffs each)

Every worker earns 30,000 basic a month; the previous provider's months are imported (withholding 1,007.40 each, 6,044.40 in total).

| Case | De minimis | Per-cutoff withholding | Entry status / flags | Year-end |
| --- | --- | --- | --- | --- |
| Pool exhausted before year-end | previous 6,000 a month, engine 15,000 a month | 484.95 in cutoffs 13-20, **1,434.10 in cutoff 21, 1,834.10 in cutoffs 22-24** | Ready, no flags (the previous provider's category breakdown is counted) | gross 516,000, taxable 387,100, tax due 20,565.00, withheld 16,860.40, **collect 3,704.60** |
| Ceiling exhausted by both | 6,000 + 6,000 a month | 484.95 (the pool is only 64,000 used before the 13th month) | Ready, no flags | tax due 12,465.00, withheld 11,863.80, collect 601.20 |
| History without de minimis | none, engine 6,000 a month | 484.95 | Exception; pool flag from cutoff 15 | tax due 11,865.00, collect 1.20 |
| Control, no grant | none | 503.70 (taxable 13,775) | Ready, no flags | tax due 12,090.00, collect 1.20 |

Derivations: semi-monthly BIR table 0.15 × (taxable − 10,417); a 15,000 basic cutoff less SSS 875 (credit capped at 35,000) / PhilHealth 375 / Pag-IBIG 100 gives 13,650 and 484.95; with no grant SSS is 750 and the taxable is 13,775 (503.70). The settlement is the Phase 14 method: gross + 13th month 30,000, non-taxable = exempt de minimis 8,000 + the 90,000 pool (or the smaller pool) + all contributions, tax on the annual table, then tax due − (6,044.40 + 12 cutoffs).

A worker whose imported rows carry no readable category breakdown (the third case) keeps the review hold: status `Exception`, the "no de minimis category breakdown" flag from cutoff 13 and the pool flag from cutoff 15, and withholding is unadjusted because nothing is assumed about what the previous provider paid.

## Fix certified by this suite

Before the fix the engine ignored the previous provider's de minimis and 13th-month consumption when it withheld, so in "Pool exhausted before year-end" it never taxed the overflow of the 90,000 pool inside the calculated cutoffs (484.95 in cutoffs 21-24 instead of 1,434.10 / 1,834.10 / 1,834.10 / 1,834.10: 4,996.60 under-withheld, collected in December). `src/lib/imported-benefit-prior.ts` now reads each worker's imported rows: when every row has a readable category breakdown of fixed-peso-ceiling categories, the amounts count toward the statutory-period ceilings (one ceiling per category and period across both sources, as year-end already treats the union) and the imported excess plus the 13th month already paid count toward the pool. Any missing, unreadable, unknown or non-peso-ceiling row leaves that worker unverifiable and keeps the existing review hold. Pool room used up: 28,000 imported + 8 x 7,500 = 88,000 after eight engine cutoffs, so cutoff 21 has overflow 5,500 (taxable 19,150) and cutoffs 22-24 overflow 7,500 (taxable 21,150).

## Mutation evidence

Against the unfixed engine the suite fails at cutoffs 21-24 of the pool-exhausted case (expected 1,434.10 / 1,834.10, got 484.95). Earlier the engine was also broken two ways with the suite run each time and the file restored: the entry status never `Exception` (36 failures) and the pool review flag disabled (31 failures); both are caught. `tests/imported-benefit-prior.test.ts` adds six hand-derived unit cases for the helper.

## Not covered

- One de minimis category per worker, monthly imported rows, 'split' timing; the release approval workflow and HTTP gates are not exercised.
- Tenant-isolation ledger: `src/lib/payroll-engine.ts` is a pinned dependency of sealed proof receipts, so this change invalidates them until renewed from a fresh exact-head proof (the same effect as #2006); this PR does not renew or credit anything.
- SSS is computed on gross including de minimis, as in Phase 14.
