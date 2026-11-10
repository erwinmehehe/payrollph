# Pre-login tenant boundary harness

Six API methods have no signed-in employer, so the usual proof shape (own success, foreign denial, unchanged victim) does not apply to them:

| Method | What it does |
| --- | --- |
| `GET setup` | Reports whether the instance has no users yet |
| `POST setup` | Creates the first employer and owner, once, with a setup token |
| `POST intake-challenge` | Issues a signed proof-of-work challenge bound to an email address |
| `POST signup` | Registers a new employer and an inactive owner, and mails a verification link |
| `POST signup/resend` | Mails a fresh verification link for a registration still pending |
| `POST signup/verify` | Activates the owner a one-time link belongs to and signs them in |

This harness (`scripts/qa/tenant-prelogin-http.mjs`, workflow `.github/workflows/tenant-prelogin-http.yml`) restates the boundary for routes like these: **a caller may create or activate only the workspace its own request describes, and nothing it sends may read, change or activate any existing employer.**

## What it runs

Production-mode Next on localhost against a fresh disposable PostgreSQL 16, with the pilot signup mode and the intake proof on, every payment provider and worker off, and email delivered **only** to a loopback SMTP sink (`tenant-prelogin-smtp-sink.mjs`) that the harness hosts inside its own process and that hands each message to the harness in memory. Verification links are read from the mail sent to each address, exactly as the recipient would, and never from the database or through a file. Each logical caller uses its own verified client address (`TRUSTED_PROXY_HOPS=1` plus `X-Forwarded-For`), so rate limits do not collide.

1. **First-run setup.** Refused without the token (body, header, wrong value), across sites, without a same-origin header, with a weak password, and when one address exceeds five attempts an hour (even with the genuine token). Then the real setup: forged `organizationId`, `role`, `plan` and `totpEnabled` are ignored, exactly one employer, owner, membership and session exist, and the session belongs to the new owner. A second setup, even with the genuine token, is refused with 409 and issues no session.
2. **Fixtures.** Six filler employers, then applicant A registers **before** the victim exists, then a populated higher-ID victim is created (its organization, owner and employee IDs all exceed A's and six), then applicant B registers.
3. **Intake challenge and signup.** A proof is bound to its address (another address's proof, a forged proof, no proof, a cross-site request and missing terms are all refused with nothing created and no mail sent). Each real registration carries forged `organizationId`, `userId`, `role`, `active`, `plan`, `seats`, `totpEnabled` and `legalEntityId`; each creates exactly one employer, one inactive owner, one membership, one pilot subscription (10 seats, zero amount, Core) and one pending verification, issues no session, and cannot be replayed with the same proof. The unverified owner cannot sign in.
4. **Protected addresses.** Registering the victim owner's address, the bootstrap owner's address, or an address whose verification is still pending creates nothing, mails nothing, changes no password and issues no session. Four registrations an hour per client address are allowed, then 429.
5. **Resend.** An unknown, a verified, a foreign and a malformed address all get the identical answer and no mail; a forged `organizationId`/`userId` is ignored; a pending applicant's resend delivers one new link to that applicant only and invalidates the old one.
6. **Verify.** Malformed, wrong, unknown and superseded tokens are refused with no session even when the body names the victim's user and organization; a cross-site request is refused. Each real activation activates only the token's own owner, signs that owner in (never a forged user), cannot be repeated, and gives a session that reads its own employer and is refused the victim's and the bootstrap employer's.

After every group of refused or foreign-aimed requests the bootstrap employer, the victim and the other applicant are compared **table by table** (every organization-scoped table, the organization row, its owner and the owner's sessions) with their state before.

## Mutation evidence

Five rules of the real application were each broken, the app rebuilt and the harness run, then the file restored. Every one was caught by the assertion meant to catch it: setup no longer single-use (a second setup answered 201 instead of 409); verification signing in the body's user instead of the token's owner (the session belonged to the victim); signup honoring a forged plan (the employer got `Enterprise`, not `Core`); resend mailing a verified address (one mail more than expected); and the intake proof no longer bound to its email (another address's proof was accepted, 202 instead of 422). The unmutated run passes from an empty database.

## What it does not prove

- It is a proof, not a credit: `coverageCredits: 0`. The ledger keeps the six methods GAP. Whether they become COVERED, or PUBLIC-BY-DESIGN, is for review to decide.
- **Recorded findings it does not close.** An unverified registration is never replaced or expired, so a stranger can hold an email address (the AI-assisted review's finding 1). The signup answer differs for a new and a registered address (finding 2). The harness pins the invariants that hold today (no takeover of a pending account, no mail to it), not the squatting itself.
- Not exercised: the invited-pilot path that skips email verification (deliberately off), paid enrollment, the intake proof being disabled, real email delivery, the in-memory rate-limit fallback, concurrent registrations (the unique-email race) and header spoofing outside the one trusted proxy.
- Independent security review stays PENDING.

## Running it locally

Needs a disposable PostgreSQL 16 on `127.0.0.1:5432` with the reviewed baseline applied (`node scripts/qa/local-tenant-proof-db.mjs --reset`), a production build, and the environment the workflow exports. The workflow is the reference; the proof refuses to run unless every one of those conditions holds.
