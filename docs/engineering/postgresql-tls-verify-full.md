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


## Read-only protected TLS operator acceptance command (not yet executed)

The committed tool `scripts/verify-postgresql-tls-operator.ts` provides a credential-redacted check against the **actual intended protected database/pooler endpoint**, without writing data. It is **not** an automatic production check and must **never** run from a publicly triggered PR or an unreviewed secret-bearing CI job.

1. A Vercel/database operator first confirms the secret's `sslmode` privately and, if needed, updates the protected `DATABASE_URL` to explicit `sslmode=verify-full` via the authorized secret manager. The tool deliberately rejects legacy aliases even though the runtime compatibility guard converts them in memory. **Do not paste the URL into a shell command, GitHub issue, CI output, or assistant chat.**
2. In an approved, isolated operator environment with `DATABASE_URL` already injected securely (never on the command line), run:

   ```sh
   PG_TLS_OPERATOR_ACK=authorized-readonly-tls-acceptance npx tsx scripts/verify-postgresql-tls-operator.ts
   ```

3. It must return **five PASS lines**: strict secret mode; real provider certificate and hostname; wrong-host certificate rejection; untrusted-CA rejection; strict `pg` read-only `SELECT 1` success. Failures print no credentials, hostnames, CA contents, or raw error messages. A PostgreSQL pooler can terminate frontend TLS, so this probe validates the **frontend PostgreSQL SSLRequest/TLS handshake directly** instead of relying on `pg_stat_ssl` from the backend.
4. Keep redacted PASS/FAIL, approved operator identity, environment, date, source SHA, endpoint type (direct or pooler), and rollback record in restricted release evidence; never upload secrets or endpoints into public GitHub/CI. Do not infer real-provider proof from the disposable local handshake regression test.
5. Run source CI on the exact head, obtain independent release approval, then deploy through the protected workflow and verify the released SHA, health, and warning groups. **Do not merge this PR merely because the operator tool was added or synthetic CI succeeded.**

The script does not alter the environment secret or release a deployment. Test-only certificates are generated ephemerally by OpenSSL in isolated CI and are not committed.
