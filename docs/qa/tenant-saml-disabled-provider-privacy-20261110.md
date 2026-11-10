# SAML-01: Disabled SAML login provider-enumeration boundary (2026-11-10)

**Status:** DRAFT / ZERO NEW TENANT-COVERAGE CREDITS / INDEPENDENT SECURITY REVIEW PENDING.

## Source-identified issue

The SAML assertion verifier is not installed (`samlRuntimeReady()` returns false), but two unauthenticated login endpoints on the audited `main` path use caller-selected provider IDs to read employer identity-provider rows:

- `GET /api/auth/saml/start/[providerId]`: a known SAML provider returned 503 with `configured` and `enabled`, while an unknown provider returned 404.
- `POST /api/auth/saml/acs/[providerId]`: a known SAML provider returned 503 while an unknown provider returned 404.

A caller could therefore distinguish configured from missing providers without having employer authorization. This is a **source-identified configuration-enumeration boundary**, not proof of an exploited production incident.

## Bounded change: start + ACS only

Both disabled login endpoints now return an identical, non-cacheable `503 SAML_RUNTIME_NOT_READY` response for all provider IDs, without querying the employer/provider database. The shared response adds `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. No provider configuration, enabled state or credentials are returned.

**Preserved deliberately:** `GET /api/auth/saml/metadata/[providerId]` remains untouched. The repository already contains a dedicated fictional-PG16 real-HTTP proof and source contract from merged PR #1771 for its anonymous XML metadata behavior. That separate **PUBLIC-BY-DESIGN candidate is unaccepted** and carries an explicit `PENDING_IDENTITY_SECURITY_OWNER_DECISION` policy hold; this PR does **not** reinterpret or silently break that proof. The public metadata existence/disclosure policy requires a separate identity/security decision, not this login-response repair.

No active OIDC discovery, OIDC login, SQL schema, feature flag, SAML verifier, credentials, money or production routes are enabled or modified.

## Checks and review gates

- `tests/tenant-saml-disabled-boundary.test.ts`: identical start/ACS responses over varied IDs, no provider disclosure, no caching and no DB/metadata lookup, with exact route SHA pins.
- Existing `tests/tenant-saml-metadata-public.test.mjs` and `.github/workflows/tenant-saml-metadata-public-http.yml`: preserved without modification; their existing anonymous XML proof and policy hold remain operative.
- `scripts/qa/tenant-isolation-coverage-manifest.json`: only two SAML login handler source SHA records updated. Both remain `GAP`, with `testedBy: null` and a separate exact-source zero-credit review hold.
- `tests/tenant-isolation-coverage-inventory.test.mjs`: narrowly permits this source-pinned, two-route-only change without weakening the unchanged-GAP policy for any other route.
- Ledger on this draft remains **498 methods: 451 COVERED / 21 GAP / 15 PUBLIC-BY-DESIGN / 11 TOKEN-ONLY**, plus **17 page/action GAPs**. **New method credits: 0.**
- **Pending:** exact final-head tests, typecheck, lint/security CI, independent identity and security review, current-main reconciliation retaining disjoint coverage credits and approved metadata policy.
- If SAML login is later enabled, require independent real own-employer success, foreign higher-ID victim and forged selector denial, immutable cross-tenant database state, and a separately reviewed acceptance decision. A disabled refusal cannot be credited as tenant-wide method proof.

## Branch separation

This work began at `main@e6dcc76783ed5346574d21489c66dd64184fd7c6`, with no open PR head as a parent. It does not modify OIDC #1894, Worker 360 #1887, hire-to-payroll #1888, filing validations #1893 or BIR #1895. The manifest and global inventory test are shared change hotspots; reconcile them before merge and rerun exact integrated-head CI.

**No tenant-isolation certification, production release, SAML enablement, payroll/payout/provider action, or security acceptance is granted.**

Ledger note: 451/21 includes the pre-existing BIR annual-employer candidate POST proof merged from #1895. This SAML draft earns zero method credits and does not review that separate BIR claim.
