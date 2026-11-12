# Tenant isolation — billing manage and public careers page selectors

## Scope

This bounded page-route patch changes no payroll calculations, subscription
payments, API authorization, database migrations, published job data, feature
flags, or production configuration.

- `/billing/manage`: Authenticate the session, parse one canonical employer
  ID (or use the authenticated primary-company default only when absent),
  check the selected employer's active billing-admin permission and company-wide
  scope, and then issue a **temporary redirect to that exact employer's**
  `/billing/setup?organizationId=<id>`. A foreign, revoked, unit-scoped,
  group-HR, duplicate or malformed tenant context is denied before redirecting.
- `/careers`: The published job board stays public by design. Before any
  organization or requisition lookup, require a canonical employer ID. Keep
  the existing privacy activation, schema readiness, published-only and
  same-employer job/position SQL predicates unchanged.
- `src/lib/tenant-page-id.ts`: Shared pure parser rejects arrays, coerced
  values, exponent/decimal IDs, leading zeros, signs, whitespace, zero and
  integers outside the safe range.

## Verification

- `node --import tsx --test tests/tenant-page-id.test.ts` checks parser
  edge cases and source ordering: user session and role before billing
  redirect; public privacy and employer query guards before listing.
- `node --test tests/tenant-billing-setup-boundary.test.mjs` checks that the
  existing fictional PG16 HTTP runner and workflow cover the manage alias.
- Existing `tenant-billing-setup-page-qa.yml` runs production-mode **localhost
  only** against disposable PostgreSQL 16 with two authenticated independent
  owners, a higher-ID victim, invalid/duplicate/foreign selectors,
  non-billing roles, revoked membership, anonymous access, a shared A+B
  administrator and immutable billing/payroll/audit snapshots.
- For the A+B administrator, explicit B manage navigation must remain on B.
  A missing selector may intentionally choose A as the authorized default.
- Rejects all configured external payments, mail providers, production
  database URLs and background worker execution.

## Evidence and limits

Static tests are not proof of running production deployment. The PG16 CI
workflow must pass against the **exact PR head**, and an independent
authorization/privacy review is still required. The existing 21-page coverage
manifest and its unresolved page/action GAP counts are intentionally
**unchanged**; this patch awards zero new formal proof credits.

The public careers route is not a private tenant page. Public publication
policy and applicant privacy still require their own review; the selector
change does not make all recruiting pages private. Other pages and all API
methods remain out of scope.
