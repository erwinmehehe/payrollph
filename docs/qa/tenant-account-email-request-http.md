# POST account/email: isolated account ownership and email existence guard

Status: **draft security proof candidate; zero tenant-isolation manifest credits**. Independent review remains PENDING. Not production tested or approved.

## Scope and independent family

- Endpoint: POST /api/account/email. **Separate** from GET /api/account, POST /api/account/password, and POST /api/account/email/verify.
- This PR changes only the account-email request route and adds a path-scoped test, runner, contract, workflow and documentation. No payroll or payout logic, existing shared tenant manifest, baseline helper, invitation-preview proof or other open PR's files are changed.
- Explicit runtime hardening: authenticate the current password **before** querying globally unique user email addresses. Otherwise a signed-in account can distinguish a foreign user's email by posting an invalid password. This change intentionally returns 422 (incorrect current password) instead of 409 (email already taken) when the password is wrong. A valid current password still receives the existing 409 for an occupied address.

## Real HTTP PG16 proof

The dedicated GitHub Actions workflow uses the exact pull request source, a production-mode Next.js build on 127.0.0.1:3000, and freshly empty, disposable PostgreSQL 16 on 127.0.0.1:5432/app_db. The job has read-only repository permissions and no secrets, workers, schedulers, payout services or external mail providers.

Three fictional employers are seeded: two independently authenticated owners and a persisted higher-ID victim owner, with a fourth account as a same-employer peer. Each independent owner must demonstrate:

1. Anonymous or invalid-session requests return 401; wrong current password, a real victim password supplied to an attacker session, invalid email and unchanged own email return 422. The victim email is **not** reported as already taken before re-authentication. Correct-password/occupied-email remains 409.
2. None of these denials creates a verification token, audit, outbox message or delivery; the victim, other employer and same-employer peer account, session, grants, token, worker and audit state remains unchanged.
3. The own valid request succeeds over real HTTP while forged victim identifiers are ignored. The caller's sign-in email, password, sessions, memberships and employees remain unchanged.
4. Exactly one newly generated pending token is persisted for the authenticated user. The pre-existing token is consumed only for that user. The mail goes to the actor's exact selected address, with its real raw token matching only the persisted SHA-256 hash.
5. Exactly one own-employer audit record and one tenant-scoped outbox message are written; the sensitive verification link is removed from the stored outbox body after delivery. Other employers and the same-employer peer remain unchanged.
6. A second own request supersedes the previously pending token without affecting the other employers' token rows. This exercises pending-link supersession, **not** token verification replay. The token-consumption verification endpoint is exercised independently by the existing dedicated proof.

The proof resets only the disposable emailchange rate-limit counters between calls. It does **not** claim to test the five-per-minute throttle, concurrent requests, the complete verification journey, production SMTP configuration, delivery failure recovery, or real customer environments.

## Mail safety

To prove the success path under production-mode route checks, the job enables **only** an in-process, non-relaying SMTP receiver bound to 127.0.0.1:2525. It refuses any non-example.invalid recipient and stores the received message only in test memory. The fail-closed guard requires the SMTP_URL to equal smtp://127.0.0.1:2525 and rejects any other provider credentials, remote application or database URL, non-GitHub CI mode, or enabled workers/payouts. This is not permission to deliver a message outside disposable CI.

## Acceptance limitations

- No shared manifest edits or provisional credits from this PR; POST account/email remains GAP until review explicitly verifies the current exact source, PG16 workflow evidence, independent accounts, negative controls and approval receipts.
- Automated proof passing demonstrates this specific route and threat model. It is not a blanket tenant-isolation, email-delivery, identity-management, payroll-safety or production readiness certification.
- A source change to the route invalidates the exact Git blob SHA pin until the new code receives a fresh review and rerun.
- Do not merge or promote coverage based solely on this document; security reviewer should inspect actual workflow logs and behavior.
