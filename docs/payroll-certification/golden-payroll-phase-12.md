# Golden payroll certification — Phase 12 prior-employer evidence in the year-end settlement

Phase 9 certified the year-end annualization for one employer. A worker hired part-way through the year usually brings earlier pay and tax from a previous employer. Without that, the new employer under-counts the worker's income and the worker's tax is wrong either way. The flag-gated prior-evidence flow (`YEAR_END_PRIOR_EVIDENCE_ENABLED`) lets a maker enter the previous employer's BIR Form 2316 figures and an optional PERA credit, requires a different checker to approve them, and then makes the year-end settlement tax the **combined** year and credit the previous employer's withholding.

Run: `npx tsx scripts/golden-payroll-phase12.ts` against the disposable PostgreSQL used by CI. Expected values are immutable hand-derived literals in `certification/golden-payroll-phase12.json`, never computed with PayrollPH functions. The suite is test-only: it changes no engine, schema or API code and enables the flag only inside its own process.

## What it certifies (36 cases)

**Part A, the calculator (10 cases)** — the real `annualizeWithPrior()` over the Phase 9 mid-year hire (PHP 30,000 a month from 2026-07-01; taxable 165,300; withheld 6,044.40):

| Case | Previous employer | Result |
| --- | --- | --- |
| Verified | taxable 165,000, withheld 1,500 | combined 330,300, tax 12,045.00, collect 4,500.60 |
| PERA credit | same, PERA 2,000 | credits 3,500, collect 2,500.60 |
| Shared PHP 90,000 exemption | exempt benefits 80,000 already used | 5,000 of the present pool becomes taxable, tax 12,795.00, collect 5,250.60 |
| Exemption exactly at the cap | exempt benefits 75,000 | nothing overflows, collect 4,500.60 |
| Nothing withheld | taxable 100,000, withheld 0 | tax 2,295.00, **refund** 3,749.40 |
| Bracket crossing | taxable 400,000, withheld 30,000 | combined enters the 20% bracket, tax 55,560.00, collect 19,515.60 |
| No previous employer | none-confirmed | identical to the single-employer result, refund 6,044.40 |
| PERA above tax due | PERA 3,000 on tax due 2,295 | refused: `PERA_EXCEEDS_TAX_DUE` |
| Credits above tax due | withheld 9,000 on tax due 2,295 | refused: `PRIOR_CREDITS_EXCEED_TAX_DUE_REVIEW_REQUIRED` |
| Minimum wage earner | any | refused: `PRIOR_MWE_REVIEW_DEFERRED` |

The previous employer's withholding and the PERA credit reduce the amount due; they never become withholding of the present employer, whose stored tax withheld stays 6,044.40.

**Part B, evidence validation (19 cases)** — the real `parsePriorEvidence()`: a complete record and a none-confirmed declaration are accepted; each of these is refused with its exact code: an unknown status, a missing source hash, exempt benefits above 90,000.00 (90,000.00 itself is accepted), money on a none-confirmed declaration, an employer on a none-confirmed declaration, a previous period that ends on or after the hire date, in another year, ending before it starts, a malformed TIN, an impossible date, a PERA credit without its statement (and the reverse), a negative amount, a three-decimal amount, a control character, and a tax year before 2023.

**Part C, the engine (6 cases)** — a real employer runs all 24 cutoffs of 2026 through the payroll engine for six workers (five mid-year hires and one full-year worker). Each worker's evidence is saved through the real `priorIntake()` by a maker, refused self-approval, approved by a different checker, stored encrypted, and used by the real `runYearEndAnnualization()`. Collect, refund, PERA, shared exemption and bracket-crossing results all match the hand-derived figures, the stored settlement records the digest of the approved evidence it used, and the full-year worker with a none-confirmed declaration reproduces the Phase 9 result exactly (collect 1.20).

**Part D, controls (1 case, eight checks)** — in a separate employer: no evidence blocks the settlement; saved but unapproved evidence blocks it; a stale digest blocks approval and a stale save; evidence approved for another **hire date** is refused by its fingerprint (a later date) and by the validation (a date inside the previous employment); each blocked settlement leaves no adjustment row; with the flag off, intake is closed and the settlement ignores the evidence (refund 503.70 for a single released cutoff).

## Mutation evidence

Six rules of the real code were each broken, the suite run, then the file restored. Every one was caught by the assertion meant to catch it: the previous employer's withholding not credited; the 90,000 exemption not shared; the previous employer's taxable income ignored; the maker allowed to approve their own evidence; unapproved evidence accepted for settlement; and the evidence fingerprint ignoring the hire date. The last one first survived because a second guard (the sequential-employment check) also rejected the changed date, so the control now tests the two layers separately.

## Not covered

- The flow is flag-gated and not active in production; one previous employer per year, a single legal entity, and the refusals for minimum wage earners and multi-entity organizations are certified, the missing support is not.
- Approval is shown with two fictional users. The role, MFA and HTTP gates of the intake routes are exercised by the tenant proofs, not here.
- Imported prior-provider history (a mid-year provider switch) and numbered-2316 reconciliation.
- The release approval workflow: runs are set to Released in the fixture.
- **Practitioner review:** the expected values follow the cited BIR rules and the repository's year-end treatment. They have not been reviewed by a qualified Philippine tax practitioner and must be before anyone relies on them for filing. The PERA credit rate and the treatment of a previous employer's exempt benefits are the points to put to the reviewer first.
