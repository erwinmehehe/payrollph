# Web Bundy employee photo-consent POST: tenant proof candidate

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
9. Ten source-contract tests check environment guards, tenant IDs,
   minimal receipts, cache directives, private denied responses, route
   authorization checks, workflow ordering and still-GAP manifest status.

No existing tenant-table helper, receipt, application route, schema, feature
registry, migration, live provider or payroll method is edited by this PR.

## Independent acceptance gates

- [ ] All ten source-contract tests and syntax checks pass at the exact head.
- [ ] Actual PostgreSQL 16 and authenticated localhost HTTP proof passes
      for both independent attackers and genuinely higher-ID victim.
- [ ] Legal hold, audit, no-leak, employee mismatch and full source
      immutability assertions pass.
- [ ] Full CI, security checks, CodeQL and an independent security/privacy
      review pass.
- [ ] Independent coverage-manifest method reconciliation after acceptance,
      with no automatic GAP to COVERED change in this source PR.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO METHOD CREDITS.**
Synthetic data is not real employer UAT, legally sufficient consent or DPO
approval. Privacy notice, retention, lawful withdrawal and photo-capture
rollout require separate governance and independent review.
