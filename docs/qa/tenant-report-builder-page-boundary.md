# Report Builder page tenant boundary, synthetic-only

**State:** draft / independent review required. **No new tenant-isolation credit.**
The authoritative tenant-isolation manifest keeps
`src/app/workspace/report-builder/page.tsx` as **GAP**. The global release
status remains **NO-GO**.

## Change

Previously, a signed-in caller could directly open the Report Builder *page*
with any supplied `organizationId`. Its private API still enforced employer
membership, role and company scope, so the default-off HTML 200 shell was
**not evidence of a private-data leak or successful authorization**.

This change validates a canonical positive employer ID and checks the **active
membership**, company-wide People/payroll role and deny-only custom permission
overlay before mounting the client report controls. It then displays the
persisted, authorized employer name so a real own-page positive is distinguishable
from a generic shell. Direct foreign, revoked, unit-only, duplicate and malformed
selectors return a not-found page. The API retains its independent gate and
report-data/legal-entity preflight.

## Disposable proof only

A dedicated, exact-head GitHub Actions job runs a feature-ON local Next server
against ephemeral PostgreSQL 16. The runner refuses to start unless the DB is
exactly `127.0.0.1:5432/app_db`, the only HTTP origin is
`http://127.0.0.1:3000`, synthetic mode is explicit, and all background
workers, payout integrations and provider credentials are disabled.

It seeds real ATTA and ATTB owners, then a higher-ID VICTIM with a distinct
persisted legal employer, unit and employee. Both owner cookies must render
their own employer's page and nonempty private report API field catalog, while
direct pages for the other employers must be 404 and API capability requests
must be 403. It also probes invalid selectors, unit-scoped HR, anonymous
requests and the **same still-valid owner session** after revoking its real
employer membership. SQL snapshots of employer, legal entities, unit, employee,
pay profile, payroll, membership and audit records must be unchanged by the
GETs. The intentional single-membership revocation is checked separately.

The workflow runs pure negative controls before application/database imports,
checks out the exact triggering SHA, and never writes response bodies or secrets
to artifacts. It changes no production flag, provider, migration, payroll
calculation, pay run, transfer or protected database.

## What still needs review

- [ ] Exact PR-head synthetic PG16 and standard CI pass.
- [ ] Independent security/privacy owner evaluates own/foreign/revoked HTTP results.
- [ ] Interactive client/browser controls, API POST/CSV, multi-legal-employer
      attribution and broader tenant switching require separate evidence.
- [ ] No page/method credit until a later source-pinned, reviewer-approved
      authorization and action acceptance decision.

**Zero promotions:** 17 outstanding page/action GAPs stay open until separately
reviewed. This is not production tenant-isolation certification.
