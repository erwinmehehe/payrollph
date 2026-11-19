# Golden payroll Phases 24-29: mutation checks

Phases 24, 26, 27, 28 and 29 each prove that year-end annualization
(`sumContributionsAndTax` in `src/lib/year-end.ts`) treats a payslip line the way the
cutoff did. A proof that cannot fail proves nothing, so each guarded rule was removed in
turn and the matching phase was run against it.

## Method

Local empty disposable PG16 (`db:push`, then `scripts/qa/apply-isolated-baseline.mjs`), the
unmodified harnesses first, then one temporary one-line change to `src/lib/year-end.ts` at
a time, run with the matching `GOLDEN_PHASENN_DISPOSABLE` guard. The file was restored with
`git checkout` after each mutation and the working tree was clean afterwards. Nothing in
the repository was changed by the mutations.

Unmodified code: Phase 26 3/3, Phase 27 4/4, Phase 28 3/3, Phase 29 3/3 (Phase 24 3/3 in
the same session).

## Results

| Mutation (one rule removed) | Phase | Result |
|---|---|---|
| `LOAN-`/`EWA-`/`BEN-` codes no longer excluded from contributions | 24 | `sssSalaryLoan` and `pagibigAndCompanyLoans` fail (10 mismatches); control passes |
| same | 26 | `agencyNamedSavingsPlans` fails (5 mismatches); control and `wageAdvanceEveryCutoff` pass |
| same | 29 | all pass (it does not touch `HDMF_VOL`) |
| `HDMF_VOL` no longer excluded from contributions | 29 | `voluntary400` and `voluntary1000` fail (10 mismatches); control passes |
| same | 24 | all pass (loans are not `HDMF_VOL`) |
| exempt `LEAVE_CONV-` no longer counted as non-taxable | 27 | `exemptConversion` and `exemptThenTaxableConversion` fail (8 mismatches); control and `taxableConversion` pass |
| non-taxable `PREM-` family no longer counted as non-taxable | 28 | `nonTaxablePremium` fails (4 mismatches); control and `taxablePremium` pass |

Each mutation fails exactly the cases that depend on the removed rule and leaves the others
alone, so the phases are specific as well as sensitive.

## Not covered

- Phase 25 is a proof-only test of an open defect and has its own pin test; it is not a
  mutation target here.
- One mutation per rule. Mutations of the cutoff engine itself, and combinations, were not
  run.
- `EWA-` alone is not separated from `BEN-` and `LOAN-` by this mutation (one regex covers
  all three), and the wage advance label carries no agency name, so Phase 26's advance case
  passes under it by design.

Fictional data only. No production SQL, migrations, Neon, secrets or real employer data.
