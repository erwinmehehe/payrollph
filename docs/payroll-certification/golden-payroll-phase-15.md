# Golden payroll certification — Phase 15 withholding and review holds in a provider-switch year

Phase 14 certified the **year-end settlement** of a company that switched payroll provider part-way through the year and said, under "Not covered": *withholding in the calculated cutoffs is not asserted*. Phase 15 closes that gap. It runs the real engine for cutoffs 13–24 after six imported months and checks, for every calculated cutoff, the withholding on the payslip, the payroll entry status and the review flags, and then that the real `runYearEndAnnualization()` closes the year exactly.

Run: `npx tsx scripts/golden-payroll-phase15.ts` against the disposable PostgreSQL used by CI. Expected values are immutable hand-derived literals in `certification/golden-payroll-phase15.json`, never computed with PayrollPH functions.

## What it certifies (4 cases, 12 calculated cutoffs each)

Every worker earns 30,000 basic a month; the previous provider's months are imported (withholding 1,007.40 each, 6,044.40 in total).

| Case | De minimis | Per-cutoff withholding | Entry status / flags | Year-end |
| --- | --- | --- | --- | --- |
| Pool exhausted before year-end | previous 6,000 a month, engine 15,000 a month | 484.95 every cutoff (taxable 13,650) | Exception; both review flags (pool flag from cutoff 14) | gross 516,000, taxable 387,100, tax due 20,565.00, withheld 11,863.80, **collect 8,701.20** |
| Ceiling exhausted by both | 6,000 + 6,000 a month | 484.95 | Exception; pool flag from cutoff 15 | tax due 12,465.00, collect 601.20 |
| History without de minimis | none, engine 6,000 a month | 484.95 | Exception; pool flag from cutoff 15 | tax due 11,865.00, collect 1.20 |
| Control, no grant | none | 503.70 (taxable 13,775) | Ready, no flags | tax due 12,090.00, collect 1.20 |

Derivations: semi-monthly BIR table 0.15 × (taxable − 10,417); a 15,000 basic cutoff less SSS 875 (credit capped at 35,000) / PhilHealth 375 / Pag-IBIG 100 gives 13,650 and 484.95; with no grant SSS is 750 and the taxable is 13,775 (503.70). The settlement is the Phase 14 method: gross + 13th month 30,000, non-taxable = exempt de minimis 8,000 + the 90,000 pool (or the smaller pool) + all contributions, tax on the annual table, then tax due − (6,044.40 + 12 cutoffs).

The engine holds each of these cutoffs for review (status `Exception`) whenever imported history and a de minimis grant coexist, and adds a second flag once the engine's own cutoffs put an excess into the 90,000 pool. The suite asserts the exact cutoff where each flag starts.

## Finding pinned by this suite

In "Pool exhausted before year-end" the engine never taxes the overflow of the 90,000 pool inside the calculated cutoffs, because it does not count what the previous provider already consumed; the settlement collects all of it in December. Counting the union, the pool's room runs out after eight engine cutoffs (28,000 + 8 × 7,500 = 88,000), so hand-derived withholding would be 1,434.10 at cutoff 21 (overflow 5,500, taxable 19,150) and 1,834.10 at cutoffs 22–24 (overflow 7,500, taxable 21,150), against 484.95 today: **4,996.60 under-withheld** across four cutoffs. The run is safe in the sense that it is held for review, and the settlement corrects the year, but the payslips are wrong. The catalog pins today's engine values and carries the hand-derived ones in `knownFinding`; once the engine is fixed the suite fails and the pinned values must be replaced.

A second, smaller observation: the "no de minimis category breakdown" flag fires even when the importer **did** store a category breakdown (it only tests that imported history exists), so its wording is inaccurate for the first two cases.

## Mutation evidence

The engine was broken two ways, the suite run, then the file restored: the entry status never `Exception` (36 failures across the three flagged cases) and the pool review flag disabled (31 failures). Both are caught.

## Not covered

- One de minimis category per worker, monthly imported rows, 'split' timing; the release approval workflow and HTTP gates are not exercised.
- The fix for the pool-overflow finding is not part of this change (it changes payroll withholding and needs its own review).
- SSS is computed on gross including de minimis, as in Phase 14.
