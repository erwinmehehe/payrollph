# OIDC SSO release hold — default-off first pilot (review candidate)

**Decision:** The first controlled pilot excludes SSO/OIDC authentication. This PR
makes that exclusion enforceable instead of relying only on an unset encryption
key. It does not claim full tenant-isolation acceptance, production readiness, or
that enabled OIDC is certified safe.

## What changes

- `OIDC_SSO_RUNTIME_ENABLED` is an exact-true, server-side,
  release-critical flag. Missing/mistyped/false means **OFF**.
- `GET /api/auth/sso/start`, `GET /api/auth/sso/callback`, and
  `POST /api/auth/sso/resolve` reject uniformly with a private, non-cacheable
  503 before reading URL/body, provider IDs, cookies, login-state SQL or sessions.
- This also blocks previously configured OIDC providers when SSO is held.
  No client-visible navigation toggle is relied on as an authorization guard.
- Enabled behavior after the early guard is unchanged. Existing separate
  real-HTTP, fictional PostgreSQL 16 tests for browser state and tenant-bound
  discovery explicitly set the flag TRUE only in isolated CI.
- SAML remains separately disabled; SAML metadata and other identity
  integrations retain their independent review boundaries.

## Acceptance / provenance

- The new unit tests exercise the actual disabled route handlers with mocked
  dependencies that throw on any attempted read, plus gate/response checks.
- Dedicated disposable PG16 real HTTP proves uniformly blocked start, callback
  and discovery, with no tenant/identity/audit/payroll writes and no session
  cookies. External providers, workers, agency and payout flags are disabled.
- The master source-pinned method inventory is re-pinned only for these three
  method source hashes, and the existing source-review contract and workflow
  pins are updated. Do not rewrite historic original-route proofs.
- These three SSO methods remain **GAP / testedBy null / zero credits**.
  Overall method ledger remains 498 total: 456 COVERED (provisional),
  23 PUBLIC-BY-DESIGN, 12 TOKEN-ONLY, **7 GAP**.
- Independent security/identity review: **PENDING**. Real IdP, SSO account
  linking, cross-employer identity, and production release acceptance are not
  established by either OFF-mode tests or synthetic enabled-mode tests.

## Explicit non-goals and operational boundaries

No Neon/production SQL, deployment, feature activation, customer or real
employee records, money movement, bank action, filing, real identity-provider
calls, or PR merge. The repo owner must review final-head CI and security
conditions before approving and merging; keep the pilot SSO flag OFF.
