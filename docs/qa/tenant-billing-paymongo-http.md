# Tenant isolation: legacy PayMongo checkout POST (disposable PG16)

**Status: DRAFT — NO COVERAGE CREDIT; NO INDEPENDENT ACCEPTANCE.**

This work targets one existing method-level GAP: `POST /api/billing`.
It does not overlap the separately evidenced Xendit subscription start/cancel
POST methods. The legacy PayMongo route, billing tables, production feature
flags, third-party integrations, and existing tenant coverage manifest are
unchanged.

## Method boundary

The API accepts a caller-selected `organizationId` and a plan/cycle.
The existing route requires a signed-in session, same-origin request,
an owner/admin/bookkeeper grant for the selected employer, **company-wide**
access, and recent privileged MFA before creating an invoice or starting a
hosted checkout. A checkout is *not* a payment receipt or active subscription.

The source path has an existing-subscription update branch and a
new-subscription insertion branch. Both need distinct legitimate own
positives, not merely a successful 403 response.

## Fictional proof fixture

The dedicated `.github/workflows/tenant-billing-paymongo-http.yml`
runs with an empty localhost PostgreSQL 16 `app_db`, reviewed isolated
schema baseline, `NODE_ENV=production`, and two independent fictional
owners A and B plus a third **real higher-id fictional victim**. Every
identity has a separate signed-in cookie and nonempty employee and
membership rows.

- A, with an existing pending subscription, obtains an owned **201**
  checkout; B, without a subscription, obtains a distinct owned **201**.
  Their persisted invoices, subscription state, provider reference,
  audit event, price and owning organization are checked in PostgreSQL.
- A and B each submit the victim employer ID and forged victim
  subscription/invoice/legal-entity selectors. Both must receive **403**
  before the provider transport is invoked. The real victim's
  organization, subscriptions, invoices, employees, pay profiles,
  payroll runs, audit, outbox, and memberships remain byte-identical.
- Anonymous/invalid sessions, a unit-limited administrator, and an owner
  without recent MFA are denied; all are checked before a provider call.
- The only PayMongo network destination is intercepted with a
  fail-closed fictional in-process response. All non-local outbound
  requests are blocked. No real checkout, payment, charge, payout, email,
  webhook, or external bank/government action occurs.
- The receipt reports **zero earned method credits**. An exact-head
  successful CI run plus source/runner/contract/workflow pin review is
  required before changing the ledger, and any credit would remain
  provisional pending independent security and billing review.

## Usage and guardrails

The fixture **must not be run** with production/Neon database credentials,
real customer records, genuine PayMongo/Xendit keys, live providers, or
deployment jobs. Its environment guard requires GitHub Actions, a
fictional fixed PayMongo key, a fixed local server, `app_db` on
`127.0.0.1:5432`, disabled money workers, and
`https://payroll.example.test` as the app origin. It refuses unsafe
conditions before importing the database.

Core test:
`node --test tests/tenant-billing-paymongo-contract.test.mjs`

Dedicated end-to-end CI:
`Tenant legacy PayMongo checkout POST (fictional PG16 real HTTP)`

## Required post-CI evaluation

1. Confirm the exact PR head and that the environment guard, static
   contract, production-mode Next build, and PG16 HTTP proof all passed.
2. Review the two independent successful own billing writes, two denied
   real foreign selectors, nonempty high-ID victim, full victim DB/audit
   immutability, all action branches, and blocked external egress.
3. Check for stale source blobs or PR conflicts before separately
   proposing a manifest/coverage credit. The manifest stays **GAP**
   in this PR, even if CI is green.
4. Obtain independent identity/security/billing review and an explicit
   release decision before treating the method as accepted. This does
   **not** certify tenant isolation of the other methods or any
   page/action surface.

No merge, deployment, production migration, operational money movement, or
tenant-wide acceptance is authorized by this proof.
