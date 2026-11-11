# OIDC login-state browser binding — SSO tenant isolation

**Draft security fix. No API method COVERED credit; no identity, security or production acceptance.**

## Concrete boundary defect and fix

Previous OIDC callback behavior accepted any still-unconsumed `oidc_login_states` row selected by a request's `state`, subject to later provider/token/account validation. The initiating browser was **not** checked. A login redirect created for one browser could therefore be presented to another browser and reach the token exchange/account-linking flow (login CSRF / session confusion). This is a source-level security gap, **not** a claim that production users were exploited.

The change protects the SSO login boundary in production code:

- `GET /api/auth/sso/start`: on a valid provider and verified email domain, mint the existing random OIDC state, persist its hash in the database, and set an **HttpOnly, host-only, callback-path-scoped, 600-second, SameSite=Lax cookie** holding that exact random state. It is `Secure` under `NODE_ENV=production` and the redirect is `no-store`. Lax permits a legitimate top-level IdP GET redirect.
- `GET /api/auth/sso/callback`: require a **strict, constant-time comparison** between the submitted state and that browser's cookie **before any DB lookup or claim**. A mismatched or missing cookie returns a generic `403`, with no database changes and no session or provider exchange.
- After an authorized browser consumes its one-use DB state, expire the callback cookie, including if subsequent provider/account checks fail. Keep all existing PKCE, nonce, issuer/audience/signature, verified-domain, active membership, SSO policy, MFA, session and audit gates.
- The cookie is short-lived and single-current-attempt per browser. A second SSO start in the same browser supersedes the previous attempt. This fails closed; overlapping sign-in attempts may need to be restarted.

The state is generated with `randomToken(32)` (32 random bytes encoded as 64 lowercase hex characters); the validator rejects noncanonical/ambiguous state values.

## Real fictional PG16 HTTP evidence required

The dedicated workflow checks out the **exact PR head**, performs source-pin and negative-control checks, creates a fresh empty disposable PostgreSQL 16 database, installs the reviewed isolated schema baseline, builds production-mode Next, and starts it **only on 127.0.0.1**.

With two independent fictional employer providers and a higher-ID victim employer, the HTTP runner must show:

1. Each real employer's verified-domain `start` returns 302 and a `Secure; HttpOnly; SameSite=Lax`, 600-second, callback-only state cookie; the real saved state hash and provider match SQL.
2. A forged provider/domain pairing is refused without a cookie or a new DB state.
3. Missing and mismatched browser cookies for **real persisted valid states**, including switching cookies between two browsers, return 403. The original state remains unconsumed and all employer/session/audit/account-linking SQL snapshots remain unchanged.
4. Each browser's correctly bound state passes the new gate and consumes **only its own** DB state. A deliberately incomplete synthetic provider then returns 409 **before any external network exchange**. This is a browser-state acceptance check, **not a successful SSO sign-in**.
5. Replayed consumed state is denied and account/session/audit rows remain unchanged.

The proof **never calls a real IdP**, creates a live SSO session, writes a provider account, deploys, changes payroll, or communicates with customers. Test-only providers are deliberately missing token exchange configuration. The workflow refuses production/hosted database URLs, production credentials, workers, payouts and other live operations.

## Independent review and release checklist

- [ ] Dedicated exact-head source/negative-control and disposable PG16 HTTP workflow passes.
- [ ] Standard CI, typecheck, CodeQL and security smoke pass on the final head; investigate and resolve any real failures instead of bypassing assertions.
- [ ] Identity/security reviewer confirms SameSite=Lax/HttpOnly/Secure settings, host-only cookie, initiating-browser binding, state-consumption ordering, one-tab concurrency limitation and no provider/network activation.
- [ ] Full successful paired OIDC start/callback sign-in, IdP trust and account-linking isolation remain separate GAP-method evidence requirements; no promotion to COVERED based on these refusals and incomplete-provider 409.
- [ ] Any changed source SHA must trigger source review and honest evidence reconciliation.
- [ ] Product/identity sign-off is needed before staging or production use, especially for organizations that rely on SSO. No automatic merge or deploy.

No real employee data, secrets, Neon/production SQL, hosted providers, financial activity or release flag activation. This work is a real **runtime security boundary fix**, not another ledger-only classification.
