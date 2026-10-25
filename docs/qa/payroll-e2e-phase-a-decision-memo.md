# #1280 Phase A: overlap evidence and decisions

2026-10-24. Based on fetched main `572740807628ac2a912e16b29a202dc31b7c89d7`.
**Phase A test preparation; Phase B BLOCKED on owner rulings. Not payroll certification.**
The historical [finding register](payroll-e2e-findings.md) and
[#1280 integration review](https://github.com/erwinmehehe/payrollph/pull/1280#issuecomment-6266237730)
remain the record of original findings. This memo does not retroactively close them.

## Current source versus original review

Main now has default-off `APPROVED_EXIT_PAYROLL_ENABLED` handling in
`src/lib/approved-exit-payroll.ts`, payroll preflight/worker/settlement and the Separation route.
With that feature active, separating workers need distinct recorded preparer/checker approval;
an approved unpaid-basic claim blocks ordinary wages. A released crossing cutoff needs the exact
engine-version/end-date/separation trace to enter final-pay YTD. A duplicate unpaid-basic request
then fails. Settlement revalidates exit evidence. Missing last-day wage handoff blocks final-pay release.
These guards are already present; this change neither enables the feature nor changes money rules.

This is narrower than proving no possible double payment: same-date multiple approved packages,
unrelated prior-period unpaid wages, real ordinary-payroll reviewer/MFA authorization, and all
release orderings are not established by these new tests. Do not treat a trace marker alone as
an independent signed reconciliation or an approval of wage/13th-month treatment.

## Phase A evidence

- [Pure overlap tests](../../tests/payroll-e2e-final-pay-overlap.test.ts): final-pay-first approved
  unpaid BASIC blocks ordinary pay (including one cent); absent/self approval and conflicting end
  dates block; zero unpaid BASIC allows the existing approved-exit handoff. The reader is a stub;
  this is **not** SQL tenant-isolation or HTTP lifecycle evidence.
- Ordinary-first arithmetic uses released BASIC 6,600 plus same-year retro +120/-24, excluding
  prior-year retro 500: annual BASIC 6,696; current software 13th-month entitlement 558;
  final-pay gross 558 with zero unpaid BASIC. Recompute is deterministic, already-paid 558
  leaves zero due, unknown retro attribution fails. These are fictional software expectations,
  not practitioner rulings on inclusion, eligibility or rates.
- [Existing connected HTTP batch, extended](../../scripts/qa/payroll-approved-exit-http.mjs): real
  draft initiation/Separating lifecycle, independent approval, ordinary calculation, synthetic
  settlement, final-pay reprepare and fresh approval. New fault injections remove the version
  marker, substitute another separation ID, or add conflicting end dates on the released crossing
  entry; each must refuse preparation and preserve the approved package. The trace is restored
  in `finally`. Only a guarded disposable CI fixture may execute these writes.
- [PG16/18 workflow](../../.github/workflows/payroll-e2e-fictional.yml) runs the new pure test
  and existing extended HTTP batch. Local pure results are recorded in the PR; connected results
  must be read at its exact head. Until then **HTTP/PG16/PG18: NOT RUN for this change**.

## Decisions required before Phase B

Local validation on 2026-10-24: 27 targeted overlap/final-pay/audit-role/sealer/operator tests
passed, plus 18 existing fictional pure payroll tests (45 total, no skips). The latter initially
refused import without `DATABASE_URL`; rerun used the fictional non-serving
`127.0.0.1:1/never_connect` input solely to construct the unused lazy pool, with no database query.
TypeScript no-emit, changed-file ESLint, HTTP script syntax and diff whitespace checks passed.
Whole-worktree lint failed on 28 hook errors in existing untracked generated `outputs/` bundles;
those outputs were preserved. There were 10 existing source warnings and no warning-baseline violations.
No connected acceptance or live audit checkpoint was executed locally.

Each answer needs the named approver, precise choice, rationale, applicable effective dates,
supporting reference and sign-off. No answer below has been supplied or inferred.

| Finding | Owner decision needed | Engineering recommendation for review, not approval |
| --- | --- | --- |
| F-01 / overlap | Payroll owner: final wages wholly in final pay, or identified ordinary source plus final-pay reconciliation? How handle prior-period unpaid wages and same-day multiple packages? | Retain current blockers; implement one source-matched wage ledger before broadening supported orderings. |
| F-02 | Finance/accountant: approved refund evidence, tax-year attribution, exact debit/credit account mapping and reversal rules when net exceeds gross? | Keep header-only journal rejection; any new exporter must reconcile signed worker entries and approved adjustment IDs to centavos. |
| F-04 | Payroll/audit owner: must reviewed-but-unreleased recalculation preserve immutable before/after registers, and what reviewer invalidation/retention is required? | Prefer immutable versions linked to a single current register; released records stay immutable. This is additional Phase B scope. |
| F-05 | Practitioner: accepted holiday eligibility/prior-day evidence, missing-proof resolution and employer-policy exceptions? | Keep exception/blocking behavior; do not infer entitlement from fixtures. |
| F-06 | Practitioner: effective holiday/rest/OT/ND combinations and compounding/rounding order? | Approve a dated matrix before rate changes. |
| F-07 | Practitioner: effective wage orders, worker categories, agency brackets/shares, historical corrections and rounding? | Require dated rule-pack evidence and scenario-specific approval. |
| F-08 | Practitioner/payroll owner: 13th-month inclusions, signed liabilities, permitted recoveries and exact-cent ties? | Keep negative disbursement blocked; expose recoveries separately pending approval. |
| F-09 | Payroll/finance owner: per-worker versus aggregate rounding and tie rule? | Run totals must equal persisted worker centavos; separately approve the chosen rounding convention. |

F-02 and F-04 remain OPEN; F-05–F-09 remain NEEDS-RULING / UNVERIFIED RATE.
Phase B starts only after the applicable answers are recorded. Phase A does not authorize
production SQL, migrations, activation, provider calls, employer payroll or money movement.
