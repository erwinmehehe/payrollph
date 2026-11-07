# Invitation bearer-token preview GET: isolated tenant evidence candidate

**Status: DRAFT / ZERO tenant coverage credits / NOT ACCEPTED / NO DEPLOYMENT.**

## Independent family and untouched work

This change verifies **only `GET /api/invitations/accept`**, the anonymous, token-authorized invitation preview. It does **not** edit the app route, token helper, existing acceptance POST proof, shared tenant-isolation method manifest, inventory, baseline, migrations, payroll computation, billing, year-end, migration imports, de minimis grants or provider configuration.

The four open PRs at selection (#1827, #1826, #1819, #1816) work in other families. This branch adds only four new files: one HTTP runner, one adversarial contract test, its standalone GitHub Actions workflow, and this review note.

This GET is marked **GAP / testedBy:null** in the main branch's 498-method manifest. The earlier invitation-acceptance HTTP proof covers **POST**; it is not automatically evidence for GET. No ledger count is changed.

## Threat model and exact evidence

An invitation token is a bearer credential: possessing the actual token grants access to a minimal preview containing the email, role and expiry of **that** invitation. A guessed employer ID, invitation ID, user ID, or role in the query must never select another employer's invitation. Missing, unknown, expired, or consumed tokens must receive the same generic not-found response and reveal no target marker. A GET must not consume an invitation, create a session or account, change membership, or append an audit.

The new runner is constrained by the existing pre-import disposable-environment guard to GitHub Actions, a fresh `postgresql://postgres:postgres@127.0.0.1:5432/app_db` PostgreSQL 16 database, a production-mode app bound only to `http://127.0.0.1:3000`, fictional `example.invalid` identities, and disabled mail, payroll, payout, worker and billing integrations. No production data, remote mail or payment provider is touched.

The runner seeds two independent attacker employers A/B and a populated higher-SQL-ID victim employer, including real owners, units, workers, sessions, invitations and audit state. The real victim invitation ID must exceed 6 and both attacker invitation IDs.

- **Two real positive HTTP reads:** each independent valid bearer token produces HTTP 200 with only its own exact persisted email, role and expiry. The two responses must differ.
- **Forged selector probes:** both positives carry the actual victim's employer, invitation and owner IDs plus a forged privileged role; no victim preview is chosen.
- **Six uniform negative HTTP reads:** missing token, unknown token, modified valid token, expired token, consumed token and empty token. All must return HTTP 404 with only `{ "valid": false }` and no victim marker in headers or payload.
- **SQL immutability:** before/after snapshots compare all three employers' invitations, memberships, staff, owners, units, audit and prospective new account/session rows. Neither legitimate preview consumes its token.
- **Negative-control unit tests:** reject false positive response codes, substituted victim emails or roles, extra internal fields, altered expiry, public caching, PII leakage in negative responses, DB mutation, unsafe target environments, or missing source/tracing anchors.
- **Exact-source policy:** the test pins the current runtime GET handler and token lookup Git blob IDs. Changed app source needs a fresh proof, not reuse of an old receipt.

## Acceptance and remaining work

The workflow must pass at the exact proposed PR head, including its real PostgreSQL 16 + Next.js HTTP run, source checks and any relevant security CI. Independent security/privacy and coverage-owner review is still required. No source or static unit test alone earns a COVERED classification.

The preview is deliberately **not an authenticated employer-scoped GET**: the invitation token itself is the intended authority. Further assessment must address bearer-token exposure through browser history/logging, GET cache policy, and token-claim race/atomic-audit correctness for the separate POST handler. No password acceptance, invitation activation, payroll access or production permissions are certified by this GET evidence.

**Proposed additional COVERED methods: 0.** Do not edit the shared ledger until evidence and the source-matched GET token protocol are independently accepted and reconciled against then-current main. This branch is safe to review in parallel because it does not overlap the four open PR file sets.
