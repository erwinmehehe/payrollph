# Workforce Planning allocation and manager-decision tenant isolation

**Status:** DRAFT / NOT ACCEPTED / 0 new coverage credits / do not auto-merge.

**Coverage:** This is defense-in-depth for the `POST` and `PATCH` methods of
`/api/workforce-planning/allocations`. The formal WRK-02 batch and the
authoritative tenant-coverage manifest remain separately review-gated.
No new `COVERED` classification is claimed in this PR. The updated handler's
source SHA is now recorded in the inventory with an exact, tested-but-uncertified
POST/PATCH exception. This is re-inventory, **not** coverage promotion.

## Independence and change boundary

The work is limited to Workforce Planning allocation and manager-submission
decisions. It does not touch any open PR's People Home, HCM delegation,
first-payroll onboarding, treasury, statutory filing or tenant-credit
reconciliation files. It modifies the existing allocation handler, its dedicated
PG16/HTTP runner, its contract tests and this QA note. The shared coverage
manifest and its source-review validator are also updated solely to pin the
changed handler SHA and zero-credit provisional evidence. Other concurrent PRs
may modify that manifest and require ordinary merge reconciliation. No
migrations, payment providers, payouts, deployment flags, global tenant
catalog, recorded method counts or real worker/payroll data are changed.

## Production handler hardening

- Require `organizationId` and the authorized plan/unit relationship in
  workforce-allocation row updates, locked allocation reads and manager-draft
  version discovery. Return a conflict instead of using a stale or
  cross-employer allocation.
- Scope submission `PATCH` linked allocation and plan reads to the
  submission's authorized employer, plan and unit.
- Hold employer-scoped allocation and manager-submission row locks inside
  the approval transaction. Both the accepted-request supersede update
  and the final decision update retain the employer predicate.
- Preserve distinct creator/submitter and independent checker identities.
  Apply the same Enterprise planning opt-in denial to all manager-decision
  actions, rather than only `submit`.
- Avoid exposing private row details in rejection responses. A different
  employer's submission remains a `403` for an unauthorized caller,
  with no foreign marker in response bytes.

## Disposable PG16 / real HTTP evidence

The existing PR-only GitHub Actions workflow uses an empty PostgreSQL 16
database at `127.0.0.1:5432/app_db` and a production-mode Next server on
`127.0.0.1:3000`. It runs fail-closed preflight **before importing DB or
application modules**, with workers and scheduler OFF, payout providers
disabled, no live provider credentials and only fictional records.

Three employers are seeded. Two distinct authenticated attacker owners A/B
have lower actual stored IDs than victim employer C. Every employer has
a real plan, department, owned allocation, manager draft, non-admin employee
and a separate authenticated company-wide checker.

The existing runner still requires real populated owned `GET` responses,
foreign `GET`/ `POST` denials, forged plan/unit/allocation ID denials,
legitimate persisted allocation and draft `POST` writes, exact actor-bound
audit events and unchanged PostgreSQL snapshots for all other employers.

The new `PATCH` acceptance cases require:

1. Each attacker A/B attempts `submit`, `accept` and `reject` with
   victim C's **real persisted higher-ID** manager-submission ID while
   forging their own `organizationId`. All return the actual expected 403,
   without the victim marker or plan name in the body.
2. Separate checker identities for A/B are also denied foreign victim
   submissions (403). Non-admin employees are denied their employer's
   manager submission mutations (403).
3. All employer planning, staff, payroll, attendance and audit snapshots
   remain unchanged following cross-employer and role denials.
4. Real own-employer manager submit `PATCH` succeeds, persists the submitted
   status and one actor-scoped audit event. The maker cannot accept their
   own submitted request (409, unchanged DB).
5. Independent checkers accept A/B's requests and reject C's request;
   each action returns 200, mutates only its own persisted submission,
   writes exactly one employer-scoped audit row, and leaves every other
   employer's real PostgreSQL rows unchanged.

The contract test pins the tenant predicates, real HTTP invocation,
snapshot comparisons, independent checker identities and `newCredits: 0`.

**Executed proof:** The PR's original reviewed head
`3b548203726254c18f4ad4fb201a609c96f5e25a` passed the dedicated
[PG16 real-HTTP WFP allocations job](https://github.com/erwinmehehe/payrollph/actions/runs/40684903960/job/122804642868).
The re-inventory source guard pins the identical handler, runner, contract and
workflow blobs, verifies both method-specific positive and foreign-denial
lines, and leaves `POST` and `PATCH` at `GAP`. Fresh CI on the new review head
is needed, as are human security and owner decisions.

## Limitations and gates

This is **not** complete WRK-02 coverage. The allocation `POST` method's
existing-allocation update branch and certain concurrent budget/race
scenarios are not fully exercised by this runner. The separate batch
closure contract requires complete method and batch proof and precise
source/CI line receipts before any coverage promotion. The earlier passing
job is source-identical, but fresh CI on the final PR head and independent
review remain necessary. Decision-race and opt-in combinations remain outside
the presently credited method scope.

- [x] Source-identical original head's dedicated PostgreSQL 16 HTTP proof passed
- [ ] Updated PR head's source-contract and inventory drift-guard tests pass
- [ ] Updated PR head's disposable PostgreSQL 16 + real Next HTTP workflow passes
- [ ] New PR head's required typecheck, CI and security checks pass
- [ ] Independent maintainer/security review accepts the source changes
- [ ] Any future method-credit reconciliation is reviewed separately

No production acceptance, external employer activation, bank transfer,
statutory filing, payout authorization or deployment is requested.


## Batch 4 expanded proof candidate — 2026-10-31 (NOT ACCEPTED)

The dedicated disposable PostgreSQL 16 + real localhost HTTP runner now proposes
additional *method-level* adversarial evidence for both GAP methods, without
changing their classifications or production behavior:

- POST existing allocation update: unchanged ID and creator, precise saved budget,
  headcount, notes, editor, single real audit, no second insertion and unchanged
  unrelated employer/worker/payroll rows.
- POST rejects an update below an accepted manager request, cross-tenant plan/unit
  references and total annual budget greater than the plan, with unchanged DB/audit.
- Two simultaneous new manager draft POSTs on the same allocation: one version-2
  creation, one 409; no duplicate version or audit. This exercises the row lock.
- Two simultaneous PATCH submits for the same draft: one submit and one 409.
- Independent-checker PATCH accept/reject race: one decision and one 409, exact
  deciding actor and audit; earlier accepted version is superseded iff accept wins.
- Concurrent allocation POST update and creation against two units that each fit
  the 100,000 fictional budget individually but not together: exactly one 201,
  one 409, at most one changed allocation and no overspend.
- Repeat all new flows with two independent attacker employers and confirm all
  other employers, including the higher-ID victim, are byte-identical afterward.

The existing workflow remains the **only** dedicated live PG16 runner for this
family. Exact-head CI is required for this changed runner. Prior receipts from
#1536 do **not** validate these new cases. The old reviewed source evidence is
historical, not a green result for this candidate.

**Both POST and PATCH remain GAP and newCredits remains 0** until valid fresh
full-method evidence, budget/decision race behavior, security-owner review,
source pins and CI are accepted. No bank, payroll, payout, customer, provider,
feature-flag or production actions are performed by this QA change.
