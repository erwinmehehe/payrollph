# Web Bundy employee photo-consent POST: tenant proof candidate

## Cross-origin probe data boundary

The authenticated cross-origin probe uses a literal localhost destination and a
new in-memory session minted for the first synthetic employee selected directly
from PostgreSQL. It first verifies `/api/auth/me` and an unchanged same-origin
consent receipt for that identity. Its cookie and POST body are not read from the
private fixture file. This removes the two file-to-network flows flagged by
CodeQL without suppressing alerts or replacing the authenticated origin control
with an anonymous request. Two new tests verify the network inputs and refusal
before sending when authentication or the same-origin positive control fails.
Fresh exact-head CodeQL and disposable PG16 HTTP results remain required.

**Exact method:** POST web-bundy/consent. **Coverage status: GAP.**
Independent of the open Careers, ESS documents, payroll overpayment, HMO,
invitations, performance and Automation Studio pull requests.

## Safety and scope

The employee-only photo-consent POST stores explicit, versioned consent.
Acceptance to withdrawal must purge **only non-held photo evidence** in the
same transaction, preserving legal holds. Declined to accepted requires a
separate reviewed privacy process; it must not silently re-enable capture.
No consent decision is an authoritative punch or a payroll change.

The pilot flag stays default-OFF in production. The isolated GitHub Actions
job enables WFM_PUNCH_EVIDENCE_ENABLED=true against disposable PostgreSQL 16
and a production-mode **localhost-only** Next server. It uses synthetic
accounts, photos as fictional text markers and no real employee data.

Before the Next server starts, a bootstrap inserts two distinct attacker
employers (A and B), a genuine higher-ID victim and a fourth even higher-ID
excluded employer. Exactly the three authorized employer IDs come from
PostgreSQL inserts and are passed through GITHUB_ENV to the CI-only server.
No hard-coded company ID or wildcard allowlist is used. Synthetic cookie
values are held in a random private 0700 /tmp folder, in a single 0600
file. Cookies and private fixture contents never appear in logs or artifacts.

## PostgreSQL 16 plus actual authenticated HTTP acceptance

1. A, B and the victim have real distinct employee users, owner users and
   own employee rows. Each has two real fictional photo-evidence rows,
   one with legalHold false and one with legalHold true.
2. All three employees POST accepted to their own employer. Each requires
   HTTP 200, an exact minimal receipt and a non-cacheable response. The
   matching employee, versioned consent and one actor-bound audit must be
   read back from the actual database; another employer's data cannot pass.
3. Attacker A and B each POST against the genuine higher-ID victim and
   the other attacker's employer. Both foreign selectors require 403,
   no victim markers and absolutely no source writes.
4. A fourth actual employer is excluded from the pilot and must get 404,
   including with its own valid signed-in employee account. Owners,
   unauthenticated callers, invalid input and cross-site requests must
   fail with their correct denial status and no business-data mutation.
5. A mismatched employee login with **actual membership in A** but
   user.employeeId pointing to the victim's real employee must be rejected
   by the independent organization-to-employee binding. A selector gets
   404 and a forged victim selector gets 403, with no disclosure.
6. Actual consent withdrawals by A and B must change the existing
   consent record to declined, add exactly one withdrawal audit, purge
   the non-held synthetic sealed photo to null with a real purgedAt,
   and keep the legal-hold photo byte-identical. Repeating the same
   decision is idempotent; re-accepting after decline requires 409.
7. Every victim employee, photo, consent, payroll-profile and audit
   record remains unchanged during both attackers' requests and own
   withdrawals. The excluded employer is unchanged as well.
8. The complete fictional database's authoritative time punches,
   staged punch submissions, attendance corrections, payroll runs,
   payroll entries and payout batches must be byte-identical before
   and after all consent calls. No real payroll, attendance, payout
   or provider action may occur.
9. A and B each have a separate genuine same-employer employee who has
   **never accepted** photo capture and has no stored photographs. A freshly
   minted in-memory synthetic session (not a fixture-file cookie) must first
   POST `declined` and persist one employee-bound versioned consent and
   audit event, with no employee, payroll, photo, or punch mutation. A second
   `declined` is an unchanged/no-audit replay, and attempted reacceptance
   returns 409 without any write. This exercises the initial-decline action
   separately from accepted-to-declined withdrawal; it does **not** establish
   what should happen to legacy photos if they exist before consent.
10. Sixteen focused source-contract tests check environment guards, tenant
    IDs, minimal receipts, cache directives, private denied responses, route
    authorization checks, workflow ordering, first-decline source assertions,
    **employee-scoped withdrawal when a separate same-employer refusal exists**,
    exact audit immutability/actor attribution, and still-GAP manifest status.

No existing tenant-table helper, receipt, application route, schema, feature
registry, migration, live provider or payroll method is edited by this PR.

## Independent acceptance gates

- [ ] All sixteen source-contract tests and syntax checks pass at the **new final head**.
- [ ] Actual PostgreSQL 16 and authenticated localhost HTTP proof passes
      for both independent attackers and genuinely higher-ID victim.
- [ ] Legal hold, audit, no-leak, employee mismatch and full source
      immutability assertions pass.
- [ ] Full CI, security checks, CodeQL and an independent security/privacy
      review pass.
- [ ] Independent coverage-manifest method reconciliation after acceptance,
      with no automatic GAP to COVERED change in this source PR.

## Verified predecessor and outstanding independent review

Before the new first-refusal scenario, [exact-head focused run 40612407574](https://github.com/erwinmehehe/payrollph/actions/runs/40612407574) passed all 12 existing source tests and real fictional PG16/localhost HTTP acceptance. **That predecessor run is not proof for the new commit.** Rerun the dedicated job after this change, then verify current-head CI and CodeQL. Two previously raised CodeQL file-to-network threads are outdated but unresolved; the underlying security alert status requires authorized security-team disposition, not an inferred dismissal. An independent privacy reviewer must decide the legal-hold, legacy-photo-before-first-refusal and consent-notice requirements. No production consent behavior or release flag is changed in this proof PR.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO METHOD CREDITS.**
Synthetic data is not real employer UAT, legally sufficient consent or DPO
approval. Privacy notice, retention, lawful withdrawal and photo-capture
rollout require separate governance and independent review.

## Focused PG16 failure repaired on 2026-10-28

The predecessor head `c36c97beb11c20a46c10cec8800306306f82098d`
completed full CI, CodeQL and Security HTTP Smoke successfully, but its
[focused PG16+HTTP run 40619413634](https://github.com/erwinmehehe/payrollph/actions/runs/40619413634)
failed during the primary employee's accepted-to-declined withdrawal. The
original assertion at `scripts/qa/tenant-photo-consent-http.mjs:426`
required `after.consent.length === 1`. Earlier in the very same test, a
second **legitimate** employee belonging to that employer had already
recorded an initial **declined** consent, so the real database correctly
contained **two** consent records. The assertion incorrectly counted all
employees in the organization rather than only the withdrawing employee.

The repair uses independent pure source contracts to verify that the
targeted actor's exact employee+employer+version consent row transitions
from accepted to declined, keeps its primary key and all unrelated fields,
and leaves **all other employee consent rows**, including the previously
declining same-employer peer, **byte-identical**. The withdrawal must append
exactly one authenticated actor-bound audit row whose metadata matches the
actual employee, version, decision and purge status. Negative-control tests
reject missing/altered peer rows, changed owners, forged audit actors, row
identity substitution, absent audit and unauthorized source mutations.

The original legal-hold photo byte-equality, real non-held image purge,
cross-employer denials, whole-company snapshots and ledger immutability
remain unchanged. The production route, schema, release flags, coverage
manifest and existing shared test runner were not edited.

**The focused job must be rerun on the new final SHA; the previous 2-versus-1
failure does not imply a real privacy leak, and no method credit is awarded
without passing PG16 HTTP and independent security/privacy review.**
