# Optional remote HCM staging reference (not a release requirement)

**Policy (October 11, 2026):** During pre-client HCM development, a standalone Vercel staging project, remote PostgreSQL staging instance, protected remote UAT and the manual HCM staging attestation are **OPTIONAL**. None is a prerequisite for HCM pull-request review, source merge or local synthetic acceptance.

## Default pre-client workflow

Use GitHub Actions with disposable localhost PostgreSQL 16, fictional employers, isolated feature flags, browser-based role and tenant tests, TypeScript, CodeQL/security and payroll isolation. Review each PR's exact commit and source diff. Retain default-off production flags unless the owner explicitly authorizes an internal configuration change. Do not use live employer information, a shared remote database or payment services to seed test fixtures.

The existing `.github/workflows/hcm-staging-isolation.yml` stays available as an **opt-in** diagnostic. It is not a required branch check, merge gate or feature-enablement prerequisite. No user action or Vercel project creation is needed for the normal HCM development workflow.

## Only if a remote synthetic test environment is intentionally created later

The current Vercel project's `DATABASE_URL` and `DATABASE_URL_UNPOOLED` environment entries target both Preview and Production, so that project's preview URLs are **not suitable** for populating synthetic fixtures without an independently isolated DB.

An authorized environment owner can optionally:
1. Create an independent protected Vercel project with no inherited production secrets, plus a new disposable PostgreSQL database containing no real employer data.
2. Configure a database-side synthetic marker, a read-only verifier, and GitHub's `hcm-staging` environment for the existing optional attestation workflow.
3. Run the manual attestation from protected main. It verifies project identity, configured production-URL fingerprint mismatch, marker and read-only login; it does not deploy, migrate, seed or enable anything.
4. Restrict the remote test URL, review the exact tested source SHA and shut down the environment after use.

These instructions describe a future **choice**, not a to-do list blocking PR #773 or other pre-client HCM integration work. Never print credentials or use the production database for fixtures.

## Separate live-operation controls

Code merge and local synthetic QA do not authorize migrating historical bank data, introducing live worker records, executing payroll or payouts, or bypassing maker/checker/release controls. Such actions must follow their domain-specific requirements when actual employers are onboarded.

See `docs/hcm-connected-navigation-acceptance.md` and `docs/engineering/change-risk-policy.md`.
