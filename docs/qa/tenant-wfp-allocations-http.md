# Workforce Planning allocation and manager-decision tenant isolation

**Status:** DRAFT / NOT ACCEPTED / 0 new coverage credits / do not auto-merge.

**Coverage:** This is defense-in-depth for the `POST` and `PATCH` methods of
`/api/workforce-planning/allocations`. The formal WRK-02 batch and the
authoritative tenant-coverage manifest remain separately review-gated.
No new `COVERED` classification is claimed in this PR.

## Independence and change boundary

The work is limited to Workforce Planning allocation and manager-submission
decisions. It does not touch any open PR's People Home, HCM delegation,
first-payroll onboarding, treasury, statutory filing or tenant-credit
reconciliation files. It modifies the existing allocation handler, its dedicated
PG16/HTTP runner, its contract tests and this QA note. No migrations, payment
providers, payouts, deployment flags, global tenant catalog, coverage manifest
or real worker/payroll data are changed.

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

## Limitations and gates

This is **not** complete WRK-02 coverage. The allocation `POST` method's
existing-allocation update branch and certain concurrent budget/race
scenarios are not fully exercised by this runner. The separate batch
closure contract requires complete method and batch proof and precise
source/CI line receipts before any coverage promotion. No actual
PG16/HTTP result is claimed until the new PR head's workflow executes.

- [ ] New PR head's source-contract tests pass
- [ ] New PR head's disposable PostgreSQL 16 + real Next HTTP workflow passes
- [ ] New PR head's required typecheck, CI and security checks pass
- [ ] Independent maintainer/security review accepts the source changes
- [ ] Any future method-credit reconciliation is reviewed separately

No production acceptance, external employer activation, bank transfer,
statutory filing, payout authorization or deployment is requested.
