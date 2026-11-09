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

**Status: PROVISIONAL / NOT ACCEPTED.** The dedicated two-attacker, feature-ON
PostgreSQL 16 job passed on prior PR head
[`13e7728` (run 42622354364, job 129177441243)](https://github.com/erwinmehehe/payrollph/actions/runs/42622354364/job/129177441243).
The subsequent inventory reconciliation has its own changed PR SHA and must
pass again as part of full security HTTP acceptance on that exact final head.
Independent privacy, security and payroll/tax review, separate browser/action
tests and release approval remain outstanding.

The 498-method/21-page ledger keeps both annual tax-review pages at **GAP**
with `testedBy` unset and zero new coverage credits. Their old and current
page source SHAs, proof/contract/source hashes, exact proof lines and prior
green run are pinned under `reviewedUncertified`. The inventory CI asserts
these values, the actual feature-ON own/foreign/unchanged-DB assertions, and
the access-check ordering; an unreviewed changed page must fail, not be
reclassified as covered. No tenant-wide certification is claimed.
