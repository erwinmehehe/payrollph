# Salary-correction preview legal-employer isolation

**Status:** proposed source-identified authorization fix. Exact-head disposable PG16 HTTP **passed** on commit `151470b` ([run 40864201403](https://github.com/erwinmehehe/payrollph/actions/runs/40864201403)); full CI and independent security/release acceptance remain pending.

## Defect and scope

The default-OFF salary-correction preview POST route checked organization roles,
MFA and that the stored employee legal-employer ID matched the caller-selected ID.
It did not check the caller's active legal-employer grant when multi-entity mode
was on. A company-wide People administrator with access to employer A could
supply another legal employer B in the same tenant and reach individual salary
revision and payroll-period metadata. This is a source-level gap, not a
confirmed live exploit.

## Proposed fix

- Keep feature-OFF, same-origin, authenticated employer, company-wide role,
  MFA, rate limits and the read-only projected response.
- Reconcile raw body legalEntityId with the header and any URL selectors via
  resolveMultiEntityContext before any employee or salary SQL.
- Explicitly require the requested employer to be within the user's grants and
  recheck the actual stored employee employer with assertEntityResource.
- Refuse individual salary preview for group-wide identities. Preserve
  unmatched employee 404 behavior and no-cache responses.
- With multi-entity OFF, do not query optional legal-employer grants; preserve
  existing single-employer behavior.

## Proof and release boundary

A new disposable PostgreSQL 16 real-HTTP candidate uses two independent
authenticated owner attackers. Each owns one legal-employer grant and a real,
nonempty salary-revision-backed employee. Their organization also includes an
ungranted sibling legal employer with a real worker and pay revision.
The higher-ID third tenant is a genuine persisted victim. It tests two
independent owned 200 responses, sibling employer and object denials,
real cross-tenant denial, conflicting body/header/query, noncanonical IDs,
same-session grant revocation, and exact unchanged employee, pay, payroll and
audit source snapshots.

No remote services, financial writes or live records are involved.
The candidate is not independent approval.

**Tenant POST stays GAP, testedBy null, zero new coverage credits.**
The API ledger remains 341 COVERED / 10 PUBLIC-BY-DESIGN / 147 GAP
across 498 methods. This route must not merge or activate until exact-head
CI and independent security/release-owner review. No database migration,
production feature activation, payout, salary write or payroll posting is in
this proposal.

## Global HCM freeze and disposable-only proof exception

The proxy's original `ENTITY_HCM_DEFERRED` embargo blocked even a legitimate
salary-preview POST before its authorization checks. The test runner now
reaches that exact POST only with the isolated GitHub Actions PG16 fixture:
explicit preview flag, exact CI-only markers and local PostgreSQL URL, no
external provider keys or payment flags. Other HCM routes, other methods,
and ordinary deployment environments remain blocked when multi-entity is ON.

`STRIPE_SECRET_KEY` is a **guard-only credential marker** here, not a supported
Stripe integration. The disposable salary-preview exception refuses requests
if this provider secret is configured. Never configure a Stripe credential to
run this proof and do not add money-moving provider credentials to the generic
environment example. Its documentation belongs in this security proof runbook.

The current-head PG18 post-cutover and DL-01 full-suite checks each failed
`tests/env-secrets-documented.test.mjs` because the new guard-only variable was
not documented. The security-owned, source-read secret inventory now includes
this runbook as the required documentation; the hold and HTTP handler are
unchanged by that documentation fix.

This is **not production enablement**. The feature remains default OFF;
the dedicated PG16 proof has passed, while all other required CI checks and
independent security/release approval are still required before merging or
considering activation.
