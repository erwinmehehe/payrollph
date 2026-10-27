# Employee self-service development plans: independent tenant-isolation batch

**State: original preparation retained; extended local execution and provisional
credit reconciliation are documented in [the recovery proof](tenant-self-development-proof.md).
Exact-head PostgreSQL 16 CI and reviewer acceptance remain pending.**

The existing workflow now runs `tenant-self-development-http.mjs`, which retains
the original own/foreign/peer/stolen-link boundaries and adds private/closed
plans, exact full-record checks, both milestone transitions, membership
revocation and real no-op mutation rejection. The older seed/prove script below
remains available for historical replay; no second workflow/build was added.

## GAP methods on main at selection
- GET `self/performance/development-plans`
- POST `self/performance/development-plans`
- PATCH `self/performance/development-plans`

These are **session-linked** employee endpoints, not arbitrary
`organizationId` selectors. A 200 with an empty list is not proof.
An attacker-provided GET query attempting to name the real victim's
`organizationId`, `employeeId` and `planId` must return only the
attacker's populated plan. A signed-in account linked to a genuine
victim worker without active victim-employer membership must be denied 403.

## Separate three-employer proof contract
Only a fresh disposable PostgreSQL 16 at `127.0.0.1:5432/app_db`
and a production-mode Next server on `127.0.0.1:3000` are allowed.
A preflight refuses non-local targets, workers/schedulers, providers
and non-disposable modes **before importing database/app modules**.
The proof uses a private 0600 synthetic fixture, not live data.

Fictional employers A and B have distinct employee logins, a real own
skill, visible development plan, milestone and progress note, plus a
different employee's private-by-identity plan and milestone in the same
employer. Employer C is a populated higher-ID victim, independently
signed in for positive controls.

- GET: three populated own 200s. Nested skills, plans, initial progress,
  milestones, employee IDs and distinct markers must identify each
  account. The second employer's own assertion must reject the first
  employer's genuine HTTP data, and both forged GET selectors must
  leave session-derived scope intact.
- POST: both attackers' foreign-victim plan IDs and same-employer
  peer plan IDs return 404. A forged employee account linked to the
  victim worker but with only attacker-employer membership is denied
  403. All three employers can append real progress rows to their
  own plans (201) with exactly one actor-bound audit per write.
- PATCH: both attackers' foreign-victim milestone IDs and own-employer
  peer milestone IDs return 404. The forged victim-employee link is
  denied 403. All three employers can complete only their own
  milestone, with a persisted actor, timestamp and audit event.
- After every denied request and every accepted mutation, compare
  employees, skills, plans, milestones, progress, plan events, payroll
  and all audit business fields for the other employers. Audit-chain
  cryptographic seal fields are the only snapshot normalization.

The workflow exercises actual HTTP with DB-backed cookies and real
persisted IDs, not simulated route permission results or static mocks.
Source-only negative-control unit tests deliberately reject empty
GETs, cross-employer matches, no-op writes, wrong actors and missing
audits, but **do not count as real HTTP evidence**.

## Boundaries and merge gates
This is limited to these three ESS development plan methods. It does
not certify all ESS or Performance capabilities, manager operations,
production auth/rollout, regulatory compliance or financial behavior.
No migrations, shared runner, global tenant manifest, reservation
ledger, production flags, salary/payroll actions or provider calls
are changed.

- [ ] Exact-head disposable PG16 / real localhost HTTP workflow passed
- [ ] Exact-head CI/security checks passed
- [ ] Independent security/maintainer review of own, peer, foreign
      membership, victim-unchanged and audit evidence
- [ ] Coverage reconciliation in a separate reviewed follow-up, not this PR

**Keep draft and unmerged. No automatic credit or production activation.**
