# SSO discovery: public-contract decision packet (owner decision required)

Target: `POST /api/auth/sso/resolve` only. It stays **GAP** until the owner approves, in writing, one of the options below. This packet changes no runtime source, no manifest row and no credit. It exists so that the approval, when given, names exactly what an anonymous caller can learn, the way `docs/qa/tenant-saml-metadata-owner-approval.json` did for SAML metadata.

Source reviewed: route blob `d9366bd1fe6cb4bf00e33b166969cd1dfc8b0299`, helper `src/lib/tenant-sso-discovery.ts` blob `713b25dd4afad7a58afc5a01b69e55012d1b7613`. The existing fictional PG16 production-mode HTTP proof (`tenant-sso-discovery-http.yml`, `OIDC_SSO_RUNTIME_MODE=enabled` in CI only) already passes on every pull request.

## What an anonymous caller can send and learn

Request: a JSON body with an `email`. Everything else is ignored (organization, provider and role selectors are never authorization inputs).

| Disclosed | When | Notes |
| --- | --- | --- |
| `available: false` | email malformed, domain unknown, domain not verified, no enabled OIDC provider | one identical body for all of these cases |
| `available: true` | the email's domain is a **verified** domain of an **enabled OIDC** provider in the **same employer** | this is the enumeration signal: it tells the caller that some employer uses SSO for that domain |
| `providerId` | `available: true` | numeric, sequential; needed to build the start URL; reveals roughly how many providers exist |
| `providerName` | `available: true` | free text chosen by the employer admin; **it can contain the employer's name** |
| `startUrl` | `available: true` | `/api/auth/sso/start?providerId=…&loginHint=…`; the hint is the caller's own email echoed back |

Not disclosed: employer identity or ID, worker or membership data, client IDs or secrets, IdP entity or certificate data, session, bank, payroll or audit data.

Protective behavior already in the route (all proven by the existing HTTP proof): exact-true runtime flag (the endpoint answers a disabled response and discloses nothing while SSO is off, which is the production default); same-origin mutation check; distributed rate limit of 30 requests a minute per client IP, with a 503 when the limiter is not distributed; the domain and provider must belong to the same employer; a response never varies with caller-supplied employer or provider IDs.

## Options

1. **Keep held (current state).** No change. One API GAP remains by design.
2. **Approve as PUBLIC-BY-DESIGN, as is.** Accepts all five rows above, including `providerName`. Zero COVERED credits, like SAML. The ledger would read 461 COVERED / 0 GAP / 25 PUBLIC / 12 TOKEN.
3. **Approve as PUBLIC-BY-DESIGN after removing `providerName`** (recommended if you lift the hold). The login page can show a generic "Continue with single sign-on". This closes the one field that can name an employer to an anonymous caller. It is a small source change to the route, so the route blob changes and the discovery proof must rerun on the exact head before the label is applied; no credit is lost because the method is GAP today.

Under either approval the enumeration signal (`available: true`) is an accepted, deliberate disclosure: it tells anyone that a given email domain uses single sign-on. That is normal for SSO discovery (users must find their IdP before they can sign in), and it is bounded by the rate limit above, but it is a disclosure and it must be accepted knowingly.

## What I need from the owner

Reply with one of: `keep held`, `approve option 2`, or `approve option 3`. An approval is recorded in `docs/qa/tenant-sso-resolve-owner-approval.json` using your own words as the `authorization.response`, pins the route blob, and names the public and excluded fields above. Independent identity/security review stays PENDING in every case; this is not a certification of SSO.

## Accounting

No change today: 461 COVERED / 1 GAP / 24 PUBLIC / 12 TOKEN, 498 methods.
