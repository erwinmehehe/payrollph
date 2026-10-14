# PostgreSQL TLS verify-full rollout (issue #1011)

## Why

`pg@8` / `pg-connection-string@2` have treated `sslmode=prefer`, `require` and `verify-ca` as strict `verify-full` aliases. The next major parser adopts weaker libpq meanings for these older names. Explicit `verify-full` checks the provider CA chain **and** hostname. Do not use `rejectUnauthorized: false`, `sslmode=no-verify`, `disable` or SSL fallback.

## Implemented source guard

`src/lib/pg-tls-policy.ts` is invoked by `src/db/index.ts` *before* `new Pool` and applies to non-loopback `DATABASE_URL` when `NODE_ENV=production` (including production-mode preview/staging runtimes, not just the Vercel production target). It preserves already-canonical `sslmode=verify-full`, upgrades the three historically strict aliases to `verify-full` **in memory**, rejects missing hostnames, duplicate/missing/insecure modes and ambiguous `ssl` URL options, and never logs credentials. Isolated loopback PostgreSQL and nonproduction connections retain existing behavior.

The guard preserves the current strict semantics; it does **not** prove the actual deployed server certificate or validate network connectivity. It does not edit deployment secrets or Neon. Do not remove this protection during a `pg` major upgrade.

## Operator change gate (not yet performed)

1. Authorized Vercel/DB operator privately inspect **only** the configured `sslmode` and any conflicting `ssl` options in each protected environment. Do **not** paste URLs, passwords, endpoints or certificate contents in GitHub or CI logs.
2. Confirm the intended provider's official CA bundle and hostname/SNI verification, including any pooler endpoint. If currently using `require`, `prefer` or `verify-ca`, prepare a secret-manager update to explicitly select `sslmode=verify-full`; remove ambiguous `ssl` options. An absent mode must also be made explicit before deploying this guard.
3. In an authorized isolated environment, attempt a genuine TLS connection / read-only health query with the candidate secret, and a negative test of a wrong server hostname or untrusted certificate. Record only redacted PASS/FAIL, deployment SHA and reviewer evidence in the restricted vault.
4. Authorize protected release with rollback and current-head CI/CodeQL/security checks. Only then update protected secrets and deploy through the standard process; do not run migrations or enable payout/filing.
5. Confirm actual deployed SHA, health and absence of alias warnings. A warning's absence alone is not proof of hostname verification. If connection fails, rollback via the authorized secret/deployment process; never weaken TLS to recover service.

## Verification

`npx tsx --test tests/pg-tls-policy.test.ts` (pure synthetic URLs, no database access); full `npm run typecheck`, `npm run lint`, `npm test` and security/production-readiness checks on the exact PR head. This source PR alone does **not** close issue #1011; operator certificate/connectivity evidence and protected post-release log review remain open.
