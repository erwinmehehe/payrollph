# Tenant isolation — annual tax review pages (candidate, unaccepted)

Scope: `/workspace/2316` and `/workspace/prior-employer` SSR entrypoints.
No API method credit, page/action credit or production authorization is claimed.

## Runtime change

An explicitly supplied employer must be a single canonical positive safe integer.
A missing employer retains the guidance text; malformed and duplicate selectors
return 404 rather than selecting a different account membership. Authorized owner,
admin, bookkeeper or payroll membership must pass `assertOrganizationRole`
(including organization session policy and custom permission denies) and be
company-wide before a client tax-evidence form mounts. Foreign, unit-only,
revoked and group-HR sessions return 404. The successful form visibly identifies
only the authorized employer ID.

The underlying 2316 source/PDF and prior-evidence GET/POST APIs retain their own
authorization, employee, legal-entity and audit controls. This does not grant
new entitlements or change tax calculation and settlement logic.

## Independent candidate proof

`.github/workflows/tenant-payroll-review-pages-qa.yml` runs on the proposed
PR SHA with disposable local PostgreSQL 16, deliberately fictional employers,
two independently signed-in attackers, a higher-ID third victim, feature-ON
page positives, foreign and forged selector denials, role/unit/revocation
checks, and byte-equivalent SQL snapshots for employer, employee, payroll,
prior-evidence and audit rows.

The runner refuses production URLs, non-loopback database targets, money
workers, provider credentials, multi-entity activation, or flag-OFF positives.
The test itself does not submit tax evidence, change payroll, call providers,
issue forms, move money, deploy, merge, or contact any real employee.

**Status: PROPOSED / NOT ACCEPTED.** A green exact-final-head job is required
before counting this as executed candidate evidence. Independent privacy,
security and payroll/tax review, separate browser/action tests and release
approval remain outstanding. Do not edit the shared 498-method manifest or
21-page ledger, or claim tenant-wide certification from this patch.
