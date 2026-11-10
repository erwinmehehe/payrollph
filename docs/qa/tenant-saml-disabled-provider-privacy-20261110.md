# SAML-01: Disabled-provider privacy boundary (2026-11-10)

**Status:** DRAFT / SECURITY REVIEW PENDING / ZERO NEW TENANT-COVERAGE CREDITS.

## Source-identified issue

SAML assertion verification is not installed (`samlRuntimeReady()` is false). Nevertheless, three anonymous SAML endpoints on the reviewed `main` source used caller-supplied provider IDs to read employer identity-provider rows:

- `GET /api/auth/saml/start/[providerId]` returned 404 for unknown providers but 503 plus `configured` and `enabled` for configured providers.
- `POST /api/auth/saml/acs/[providerId]` returned 404 or 503 depending on configuration.
- `GET /api/auth/saml/metadata/[providerId]` returned 404 for unknown providers or 200 XML for configured providers.

Those distinctions disclosed whether a configured SAML provider ID existed without proving employer authorization. This is **source-identified tenant configuration enumeration**, **not a demonstrated exploitable production incident**.

## Bounded fix

While the SAML verifier remains disabled, all three routes now return the identical 503 JSON `SAML_RUNTIME_NOT_READY` refusal, with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. No provider row, employer ID, enablement state or XML metadata is queried or returned. A shared, deliberately non-database helper produces the refusal. No OIDC discovery, OIDC authentication, provider credential, SQL migration or live feature flag is changed.

**Compatibility caveat:** The former GET metadata endpoint could have been used to obtain XML during preconfiguration, even though SAML sign-in was disabled. This change intentionally blocks that anonymous path. An identity/security owner must decide whether preconfiguration requires a separately authenticated metadata export before merging.

## Evidence and acceptance

- Source + tests: `tests/tenant-saml-disabled-boundary.test.ts` requires identical responses across IDs and across start/metadata/ACS; no provider lookup; no XML; no caching; exact route blob pins and **all three methods remain GAP** in the tenant ledger.
- Manifest entries are source-reconciled with a narrow zero-credit exception in the inventory drift guard, preventing unrelated changed GAPs from being silently admitted.
- `498` methods, `450 COVERED`, `22 GAP`, `15 PUBLIC-BY-DESIGN`, `11 PRIVILEGED-OPERATIONS-TOKEN-ONLY` and `17` scoped page/action GAPs remain **unchanged on this proposal**.
- New complete-method credits: **0**. Deliberately disabled SAML cannot supply legitimate own-employer SAML success or real foreign-employer rejection. Do not mark the three methods COVERED from refusal-only tests.
- Pending: exact final-head typecheck, tests, lint/security CI; independent identity/security review; maintainer confirmation of SAML metadata preconfiguration compatibility.
- If SAML is later enabled, require its **own** independently reviewed fixture with two legitimate employers, a higher-ID foreign victim, forged/missing-provider denials, replay/tamper checks, and unchanged private DB state. No reuse of an OIDC or disabled-state receipt.

## Separation and merge order

This family starts at `main@e6dcc76783ed5346574d21489c66dd64184fd7c6`, not at any open PR head. It does not modify Worker 360, hire-to-payroll, BIR, filing validations, or the active OIDC discovery code in PR #1894. Shared `scripts/qa/tenant-isolation-coverage-manifest.json` and `tests/tenant-isolation-coverage-inventory.test.mjs` **also change in other open PRs**; synchronize and retain every independently evidenced entry before integration. Re-run exact integrated-head CI and source pins after the last merge.

**Not authorized:** independent security acceptance, SAML sign-in, deployment, production operation, credentials, provider activation, payroll/payment/payout/filing, or any tenant-wide security certification.
