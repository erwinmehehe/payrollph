# Golden payroll Phase 23: year end honours what the cutoff exempted

Year-end annualization must treat compensation the way the cutoff did. Two defects
in `src/lib/year-end.ts` broke that, and Phase 23 certifies the corrected behaviour.

- Catalog: `certification/golden-payroll-phase23.json` (hand-derived literals,
  zero centavo tolerance, never computed with PayrollPH functions)
- Harness: `scripts/golden-payroll-phase23.ts` (real engine, real
  `runYearEndAnnualization`)
- CI: `.github/workflows/golden-payroll-phase23-pg16.yml`, an empty disposable
  PG16 on GitHub Actions. The harness refuses to run anywhere else.

Unlike Phases 15-22 this phase ships with a **calculation change**
(`src/lib/year-end.ts`, `src/lib/annualization.ts`). It is a T3 payroll change.

## The two defects

1. **Exempt earnings were taxed at year end.** A non-taxable supplementary
   earning (a non-taxable allowance, a pay-policy premium marked non-taxable, an
   exempt leave conversion) is exempt at the cutoff, but year end counted it in gross
   compensation and in no non-taxable bucket, so it taxed what the cutoff had
   exempted.
2. **A label containing "tax" was summed as tax withheld.** Year end matched lines
   by label text, so an earning called "Non-taxable allowance" or "Taxable
   allowance" was added to tax withheld, whatever its sign. The same label match
   counted a positive earning such as "SSS anniversary bonus" as a contribution.

The fix adds an `otherNonTaxable` input to annualization and a recogniser for those
three line kinds, and requires a contribution or withholding line to be a deduction
(a negative line, which is how payroll always stores one).

## Setup (tax year 2026, `split` timing, monthly salary 60,000)

Three workers hired 2026-07-01, so only the 12 engine cutoffs exist and there are no
imported rows. An ordinary cutoff: gross 30,000; SSS 875, PhilHealth 750,
Pag-IBIG 100; withholding 3,259.10; net 25,015.90. The allowance is approved
supplementary compensation in cutoff 23 and outside the SSS and Pag-IBIG bases.

## Cases

| Case | Cutoff 23 | Year end |
|---|---|---|
| noAllowanceControl | ordinary | gross 390,000, non-taxable 50,700, taxable 339,300, tax 13,395.00, withheld 39,109.20, **refund 25,714.20** |
| nonTaxableAllowance (12,000, non-taxable) | gross 42,000, withholding 3,259.10, net 37,015.90 | gross 402,000, non-taxable **62,700**, taxable 339,300, tax 13,395.00, withheld **39,109.20**, **refund 25,714.20**, identical to the control |
| taxableAllowanceLabelledTaxable (12,000, taxable) | gross 42,000, withholding 6,006.20, net 34,268.80 | gross 402,000, non-taxable 50,700, taxable 351,300, tax 15,195.00, withheld **41,856.30**, **refund 26,661.30** |

- **The control** is the same year end without any allowance. The non-taxable
  allowance must change nothing about the tax settlement.
- **Hand derivation of the third case:** cutoff 23 taxable 30,000 + 12,000 - 1,725 =
  40,275; withholding 4,270.70 + 0.25 x (40,275 - 33,333) = 6,006.20. Year end tax
  15% x (351,300 - 250,000) = 15,195.00; withheld 11 x 3,259.10 + 6,006.20 = 41,856.30.

## What the original code did (observed, the phase fails on it)

Running this harness against the unchanged `year-end.ts` and `annualization.ts`:

| Case | Original result | Effect |
|---|---|---|
| nonTaxableAllowance | non-taxable 50,700, taxable **351,300**, tax **15,195.00** (1,800.00 too high), withheld **51,109.20** (12,000 phantom), refund **35,914.20** | refund **10,200.00 too large**: the phantom withholding outweighed the over-taxation |
| taxableAllowanceLabelledTaxable | withheld **53,856.30** | refund **38,661.30**, **12,000.00 too large** |

## Result

All three cases pass. Mutation-checked by editing the fix locally and restoring it:

| Mutation | Fails |
|---|---|
| revert to the original code (both files) | both allowance cases |
| keep the bare "tax" label match for withholding | both allowance cases |
| do not pass the exempt amount to annualization | the non-taxable allowance |
| ignore the exempt amount inside annualization | the non-taxable allowance |

`tests/year-end-line-treatment.test.ts` (8 tests, run first in the workflow) pins the
line parser: the three exempt kinds, the taxable counterparts, the lines that already
have their own bucket (reimbursements, de minimis, the 90,000 pool, the 13th month),
the year-end settlement sign convention, and a positive earning named after a
contribution.

## What this does not certify

- **A pay-policy premium marked non-taxable and an exempt leave conversion** are
  fixed by the same change and covered by the parser unit tests, but not by a
  real-engine case here.
- **Final pay (separation) is not fixed.** It builds its own year-to-date gross in the
  separation route from a different parser; that gross includes non-taxable earnings
  with no matching exempt amount, so it very likely has the first defect. It does not
  have the label defect (it matches the withholding line by code). The route is pinned
  in the tenant manifest, so fixing it needs a reviewed route change.
- **Rows already computed** under the old rule change only when year end is
  recomputed. The stored rule version string is unchanged (the separation route and
  tests pin it); the new `otherNonTaxable` key in the stored breakdown marks a row
  computed under the corrected rule.
- Reimbursements under the spend flow carry the `EXP-` code and are removed from
  gross by code, whether taxable or not. By reading the code (not tested here), a
  **taxable** reimbursement is therefore not taxed at year end. That is a separate
  question and is not changed here.
- One salary, `split` timing, a worker hired at the switch, one allowance amount.

## Run locally

Needs an empty disposable PG16 on `127.0.0.1:5432` with database `app_db`,
UTF-8 encoding, and the environment the harness checks (`CI`,
`GITHUB_ACTIONS`, `GOLDEN_PHASE23_DISPOSABLE=github-actions-pg16-only`,
payment and worker flags false, no provider secrets). See the workflow for the
exact set.

```
npm run db:push
node scripts/qa/apply-isolated-baseline.mjs
npx tsx scripts/golden-payroll-phase23.ts
```
