# Careers admin publishing, isolated tenant proof (provisional)

**Exact current GAP:** `PATCH /api/careers/admin` (`careers/admin` in the manifest).

**Status:** DRAFT / NOT ACCEPTED / ZERO COVERAGE CREDITS / DO NOT AUTO-MERGE.

This batch is independent of currently open HCM skills, employee self-service,
Leave Preview, attendance offline claims, Performance Governance, Benefits HMO,
Loans, and API v1 payroll journal PRs. It introduces only dedicated QA tests,
a dedicated GitHub Actions workflow and this document.

## Boundary and scope

Only an authorized company's administrative **publish and unpublish** action
is tested. The public `GET /api/careers?organizationId=...` is exercised
as a read-only positive and negative disclosure cross-check. **Public applicant
POST intake, consent, retention, eligibility, DPO review and the overall
Careers family are not certified or credited.**

The actual server runs in production mode bound to 127.0.0.1:3000 with a fresh,
empty **PostgreSQL 16** at 127.0.0.1:5432/app_db under GitHub Actions.
The runner refuses nonlocal DB/server targets, live provider secrets,
workers, scheduler, payouts, multi-entity mode, absent mandatory synthetic
feature flags, or non-disposable context *before importing any app/DB module*.

The source-only, unnumbered `careers-published.sql` proposal is compared
byte-for-byte against the reviewed source and applied **only inside the
new, empty, disposable CI database**, in a transaction. This is neither an
approved production migration nor approval to enable public recruitment.

## Actual synthetic evidence

Each of three independent fictional employers (ATTA, ATTB, VICTIM) receives:
a separate owner and verified local-MFA session, a real employee, a job profile,
an open eligible position, a genuine unpublished requisition, and a separate
closed-position requisition. Additionally the owner has no need to impersonate
a manager: each employer has a real bookkeeper account and unit-scoped HR
account. Victim employer, employee, position and requisition IDs are all
**actual higher IDs** returned by PostgreSQL.

Required real HTTP and database assertions:

- Two independent owner attackers are denied publishing the higher-ID
  victim employer's real requisition (403). A forged request that supplies
  an attacker's own employer but the real victim's requisition ID must
  fail compare-and-swap (409) without exposing victim markers.
- Publishing a requisition with a *filled linked position* must be refused
  (409), irrespective of a valid company-owner session.
- A company-wide bookkeeper and a unit-scoped HR identity each fail a
  publish request to their **own** organization (403); owner access is not
  imputed to those sessions.
- Three legitimate owner publish actions return HTTP 200, change exactly
  the real tenant's SQL-only `careers_published` flag to true, append one
  actor- and requisition-bound audit event, preserve the other requisitions
  and all nonpublishing fields, and expose exactly that employer's newly
  published public job without PII, salary, or other employers' markers.
- All three independently unpublish their own requisition (HTTP 200,
  saved false, exact unpublish audit). Stale duplicate publish and
  unpublish requests fail 409 without extra audit or state changes.
- After denials and every successful mutation, snapshots compare all
  employers' organization, employee, membership, job profile, position,
  requisition, applicant, privacy-evidence, payroll and audit fields.
  Only sealer-managed audit-chain hash/sequence fields are normalized.

Negative-control unit tests intentionally reject an empty public success,
another employer's job, an accidental salary disclosure, a no-op 200,
wrong actor/tenant, missing audit, a change to another same-tenant job,
a payroll change and a changed employer membership.

## Not proved / acceptance gates

- [ ] Exact-head syntax and adversarial contracts PASS.
- [ ] Dedicated exact-head disposable PG16 + localhost HTTP proof PASS.
- [ ] Exact-head full CI, CodeQL and security smoke PASS.
- [ ] Independent HR/security/DBA review of authorization, audit and schema
      evidence, without any real applicant or employee data.
- [ ] Separate approved canonical migration, privacy, consent and recruitment
      release gates before production feature activation.
- [ ] Separate reviewed proof for public Careers GET/POST and reconciliation
      before **any** method-level manifest coverage credit.

The `PATCH careers/admin` method remains GAP until its evidence is
independently accepted. No source-level permission, schema, migration,
production flag, financial service, coverage ledger or manifest is changed
by this draft.
