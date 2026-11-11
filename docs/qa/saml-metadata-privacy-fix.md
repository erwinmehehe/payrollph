# SAML metadata privacy fix - draft implementation

Evidence label: **SOLO_VERIFIED_DEV_RECOVERY**. No coverage or production acceptance.

## Owner decision and scope

The owner's 2026-11-11 decision requires disabled SAML providers to be indistinguishable from nonexistent providers. This draft changes only `src/app/api/auth/saml/metadata/[providerId]/route.ts` among production routes. It does not activate SAML/SSO, contact a provider, implement signup, change a classification or edit a migration.

Base inspected: `main@6b8a924b9d668f78084d32778ddb8626d8c6f83d`.
Old route Git blob: `589fb64376d807f03245a12c6aca1de7c3bfa08f`.
Fixed route Git blob: `de3f3100952c534ba0795018273fa49ff28eb743`.

The query now requires the requested ID, the SAML protocol and `enabled = true`. Disabled, null-enabled, OIDC and missing records receive the same generic 404. The hidden response and enabled metadata use `Cache-Control: no-store`, preventing new response caching from preserving metadata after later disablement. This is response-content/header equivalence, not a constant-time guarantee. Previously cached responses are not remotely invalidated by this code change.

Enabled-provider metadata retains its canonical HTTPS entity ID and ACS URL and its original restricted projection. No provider login or account creation occurs.

## Executed failing-then-passing regression

`node --test tests/tenant-saml-metadata-privacy-route.test.mjs` was run with Node 22.16.0 against the exact old route above, then the fixed route, using the same six tests:

| Source | Tests | Passed | Failed | Exit |
| --- | ---: | ---: | ---: | ---: |
| Old reviewed main route | 6 | 1 | 5 | 1 |
| Fixed route | 6 | 6 | 0 | 0 |

The tests execute the actual GET handler after TypeScript stripping, with isolated in-memory adapters for Drizzle, the database, the canonical-origin helper and the XML builder. They check disabled/missing parity, enabled positives, OIDC/null-enabled refusal, forged selectors, invalid IDs before reads, and enabled-to-disabled transitions. This is **unit regression evidence**, not PostgreSQL, Next-server or provider acceptance. The separate read-only CI workflow reproduces the pinned old-route failure and requires the exact submitted route to pass. It installs no application dependencies and connects to no database.

## Explicit merge blockers - do not bypass

1. Renew `scripts/qa/tenant-saml-metadata-public-http.mjs`, its contract and tests for the approved privacy-first behavior. Its historical assertions deliberately expect disabled-provider XML and therefore cannot certify the new handler. Keep PR #1771's old execution historical, not silently relabeled as a passing new-source result.
2. Execute real production-Next/empty-disposable-PG16 proof for disabled-vs-nonexistent status/body/security-header parity for anonymous callers and separate fictional employers, enabled metadata positives, forged selectors and unchanged provider/employer/user/session/payroll/audit SQL. No IdP or email traffic.
3. Reconcile this route's manifest source pin and exact-source guard while retaining `GAP` and `testedBy: null`. The manifest still records the old route SHA in this draft. The guard must continue rejecting that drift until the reviewed source/proof integration is committed; no skip, blanket exception or invented classification is supplied here.
4. Run the full tenant guard suite, manifest repin and credit reconciliation on the final integrated head, plus applicable CI/security checks. These were **NOT RUN locally**. A green standalone regression workflow does not satisfy these gates.

The current manifest and classification system are untouched: **498 methods = 455 COVERED + 15 PUBLIC-BY-DESIGN + 11 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 17 GAP**, before and after. Sixteen page/action GAPs remain. No disabled-response credit is claimed.

## Deferred identity flows

SAML ACS POST and SAML start GET: **deferred until SAML is offered**. Real future proof needs trusted signatures, issuer/audience/destination, replay/expiry and exact employer/account binding with an authorized test IdP. A 503 is not a working-login proof.

SSO start GET and callback GET: **deferred until SSO is offered**. Real future proof needs browser-bound state, PKCE, nonce, issuer/audience, token verification, replay/expiry, concurrent callbacks, membership/MFA and unchanged foreign identity state. No fake IdP is added here.

These are documentation-only deferrals, not manifest edits. This draft does not resolve the marketing attribution/privacy/schema blockers or the signup enumeration/squatting findings.

Rebase against current main and rerun source/proof reconciliation when an earlier PR merges. Keep all payroll/provider/worker/CSP activation flags OFF. No merge, deployment, production SQL, Neon operation or real-user acceptance is authorized.
