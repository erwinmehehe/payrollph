# Tenant isolation — billing manage redirect-only alias

## Scope and behavior

This bounded fix changes no payroll calculations, payment or subscription
APIs, migrations, provider configuration, public Careers page, or feature flags.

- `/billing/manage` now authenticates and checks the live billing role,
  company-wide employer membership and deny-only permission policy.
- One explicitly selected `organizationId` must be a canonical positive
  safe integer. Invalid, duplicate, foreign, revoked, group-HR or unit-only
  scope is denied before redirect. If the ID is truly absent, use the
  authenticated primary-company default.
- Authorized users get a **temporary, same-origin** redirect to
  `/billing/setup?organizationId=<authorized employer ID>` and the setup
  page independently rechecks permissions. The selected employer is never
  silently changed to the default employer.
- `src/lib/tenant-page-id.ts` is a pure, fail-closed selector parser. It
  rejects arrays, numeric coercions, leading zeros, signs, exponents,
  decimals, whitespace, zero and unsafe integers.

## Inventory and evidence

The new endpoint is a redirect-only alias, not an SSR data page or API
resource. Its source hash, business-ID/guard line pins, 0-credit GAP status,
and CI proof references are recorded in
`scripts/qa/tenant-isolation-coverage-manifest.json` under
`scopedRedirectAliases`. The original **21 data-bearing page/action entries**
and the remaining **16 formal page/action GAPs** are unchanged. The redirect
alias itself is also **unaccepted** and cannot claim a newly covered page.

`tests/tenant-isolation-coverage-inventory.test.mjs` requires exactly this
one source-pinned redirect-only alias, verifies that authorization precedes
the scoped redirect, disallows direct SQL/data reads, and checks the
dedicated fictional PG16 HTTP proof. All other new or changed scoped pages
still require review and their own manifest entries.

## Verification and non-production limits

- `node --import tsx --test tests/tenant-page-id.test.ts`: strict selector,
  session/role/scope ordering and redirect-target checks.
- `node --test tests/tenant-billing-setup-boundary.test.mjs`: exact proof
  markers and workflow trigger checks.
- `node --test tests/tenant-isolation-coverage-inventory.test.mjs`:
  source-pinned inventory drift guard.
- The dedicated `tenant-billing-setup-page-qa.yml` executes a production
  Next build against **disposable localhost PostgreSQL 16 only** with two
  independently authenticated owners, a third victim employer, shared A+B
  administrator, role/unit/revocation/anonymous/invalid-selector refusals
  and immutable victim billing/payroll/audit SQL snapshots.
- No external payment processors, email delivery, money, public application
  data, background workers or live database may be used in the test runner.

Prior static and synthetic evidence is not a production guarantee. Require
an exact-head green CI run and an independent security review before
promoting the change. No broad tenant-security certification or new page
coverage credit is asserted.

## Rollback

Revert only the route/parser/tests/alias inventory/workflow changes in this
PR. The underlying `/billing/setup` authorization and API gates remain
independent and unchanged.
