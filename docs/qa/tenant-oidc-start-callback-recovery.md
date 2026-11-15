# OIDC start / callback recovery

Scope: exact-source, fictional PG16 and real locally routed HTTPS IdP proof of
`GET auth/sso/start` and `GET auth/sso/callback`. This reuses the reviewed RSA,
JWKS, TLS and PKCE fixture without modifying the historical callback harness,
its immutable receipts, production routes or release flags.

The user explicitly chose to **keep anonymous discovery and hold its credit**.
`POST auth/sso/resolve` remains GAP. It is neither relabelled PUBLIC-BY-DESIGN
nor counted as a tenant-private method. Existing discovery behavior is unchanged.
SAML metadata, marketing, final pay and the scoped-page PRs are out of scope.

## Required executed proof

- Two fictional attacker employers and a genuine higher-ID victim each start a real
  HTTPS authorization flow. Their persisted one-use state, nonce, encrypted
  verifier, PKCE challenge, callback URI and initiating-browser cookie must bind
  to exactly the selected verified-domain provider. Forged employer/account
  selectors cannot switch that binding. Start must not authenticate a session,
  change an identity link or alter protected victim SQL/audit.
- Both attackers pair their own email with the real victim provider, and their
  own provider with the victim email. Every request must deny without redirect,
  browser/auth cookie, IdP contact or changed SQL/state.
- Genuine RSA-signed HTTPS callbacks authenticate only their own provisioned
  account, active employer membership and appropriate MFA session. Two actual
  authenticated own API reads and victim-denied reads discriminate the result.
- A genuine victim state/code cannot be consumed by either attacker browser;
  the same victim flow must still succeed with its own cookie. Captured state
  and code cannot replay. Wrong issuer/audience/nonce, invalid signature/PKCE,
  expired state, foreign email, inactive/revoked accounts, missing MFA, disabled
  providers, unverified domains and corrupt cross-employer identity links deny.
- Each refusal snapshots identity, user, membership, session, audit and every
  victim organization-owned table. Only the addressed one-use attempt may be
  consumed. No fake transport, disabled TLS or real provider is allowed.

## Acceptance and accounting

Source tests and a redirect alone earn no credit. Both methods remain GAP until
the new real HTTP/PG16 job succeeds and a restricted credit writer records its
actual job, source closure and unique own/foreign/unchanged-SQL anchors. A final
credit proposal must be reviewed and pass current-head CI before any merge.
Evidence is SOLO_VERIFIED_DEV_RECOVERY, never independent acceptance.

Only the disposable CI server enables the existing SSO runtime mode. The
deployed default-OFF policy and all money/provider/history/CSP flags remain
unchanged. No production database, real identities, email or provider credentials.

## Executed result and credit proposal

[Run 43553920124, job 132322353286](https://github.com/erwinmehehe/payrollph/actions/runs/43553920124/job/132322353286)
passed on source `92309ae90163d8e2fdd8a0578cb20933ae8730d3`:
3 genuine starts, 4 cross-provider refusals, 16 malformed-start refusals,
2 own logins, 43 callback refusals, 2 authenticated foreign-read refusals,
a successful genuine victim comparator and 9 default-OFF controls.
TLS/RSA/JWKS/PKCE were real; no real provider was contacted.

The sealed receipt pins 214 execution inputs, including all 152 numbered SQL
baseline files. The restricted writer promotes only the two GET methods:
458 COVERED / 5 GAP becomes 460 COVERED / 3 GAP on this branch's base.
Anonymous resolve stays GAP by owner decision. These are provisional
SOLO_VERIFIED_DEV_RECOVERY credits, with independent review and production
acceptance pending. The historical GAP records and prior receipts are retained.
The final PR head must retain every execution pin and pass CI; changes to an
executed input require renewing the proof. No production activation is granted.
