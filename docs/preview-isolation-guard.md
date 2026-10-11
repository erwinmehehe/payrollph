# Vercel Preview isolation guard (read-only; no deploy)

This guard checks only Vercel environment-variable **target assignments**. It cannot prove that a Preview-only database is different from Production or that employee data is synthetic. Those require an independent DBA/security attestation and protected staging testing.

## Last-known blocker

Metadata inspection identified two environment variables still assigned to **both Preview and Production**: PGUSER and DATABASE_URL_UNPOOLED. The connector's attempt to remove their Preview assignments was blocked by platform safety checks; do not bypass that restriction. The other previously shared database/Neon/encryption assignments were changed to Production-only. Preview still has no verified independent synthetic database and no suitable Preview-only encryption credentials.

**NO-GO:** Do not deploy authenticated HCM/ESS/WFM to Preview until those assignments are corrected by an authorized project administrator, and independent synthetic-only credentials are provisioned.

## Automated verification

The ordinary repository `npm test` command picks up `tests/verify-preview-isolation.test.mjs`. This workflow also runs the seven synthetic unit tests when the guard files are edited in a pull request. No Vercel token or customer data is available to pull-request jobs.

For live Vercel metadata verification, a GitHub administrator must first configure a protected Actions environment named **preview-isolation**, with reviewer restrictions, and add:

- Environment variable `VERCEL_PREVIEW_AUDIT_PROJECT_ID`: correct `prj_...` Vercel project ID.
- Environment variable `VERCEL_PREVIEW_AUDIT_TEAM_ID`: correct `team_...` Vercel team ID.
- Environment secret `VERCEL_METADATA_READ_TOKEN`: dedicated least-privilege credential for reading project environment metadata.

An authorized maintainer then manually dispatches **Preview DB Target Isolation Guard (No Deploy)** from `main`. The script issues only a GET request to Vercel's environment metadata endpoint; it does not print or persist returned secret values. It fails if a variable is assigned to both Preview and Production, if required Preview-only database/encryption assignments are missing, or if metadata is invalid or incomplete.

Run the offline tests from the repository root with:

    node --test tests/verify-preview-isolation.test.mjs

An offline check against a sanitized, non-secret metadata fixture is also available:

    node scripts/verify-preview-isolation.mjs --fixture sanitized-env-targets.json

**Do not make this manual token-backed workflow a universal required PR check**: it is deliberately restricted to manual runs on `main`.

## Release prerequisites remain separate

The owner/admin must remove Preview targeting from the final shared variables **without removing or changing the Production values**, create an isolated synthetic-only Preview PostgreSQL/Neon database and independent Preview-only secrets, and prove database identity and role/network separation out of band. Only then should authorized operators deploy to protected staging for an exact-SHA, two-tenant attendance/role/cutoff/mobile/rollback rehearsal with HR and security witnesses. This safeguard does not authorize a real employee clock-in, payroll release, bank transfer, live migration, or production feature activation.

Track environment setup in issue #733, WFM acceptance in #691, main protection in #737, and employee Web Bundy work in PR #763.
