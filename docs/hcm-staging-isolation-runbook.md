# HCM isolated staging — operator runbook

**Status (October 11, 2026): NO-GO for deployed staging.**

## Observed blocker

The connected Vercel project erwinmehehe-payrollph has DATABASE_URL and DATABASE_URL_UNPOOLED configured with both Preview and Production targets; no branch-specific DB override was visible. Vercel Authentication protection exists, but does not prove database isolation.

An attempt to create a separate, protected Vercel staging project under the payrollph team was rejected with HTTP 403 (insufficient create-project permission). No project or live environment was created or modified.

## Operator setup (requires an authorized team owner)

1. Create a *separate* Vercel project named payrollph-hcm-isolated-staging with Vercel Authentication protection, previews disabled until review and NO copied/inherited production environment variables. Use synthetic data only.
2. Create a *new empty* PostgreSQL staging database with independent ownership, users, credentials, network access, and backups. Do NOT use the current production project database, a replica with real employee data, or inherited environment credentials.
3. As staging DB owner, set a persistent database-side environment marker using SQL:

    ALTER DATABASE hcm_synthetic SET "payrollph.environment" = 'payrollph_hcm_qa';

   Create a dedicated read-only verifier role. Restrict it to CONNECT on the staging database; its default_transaction_read_only setting must be on. No table write permissions should be granted. Verify this configuration independently from app-controlled flags. This marker is not sufficient by itself to prove network separation.
4. In GitHub, create protected environment **hcm-staging**, require an independent reviewer and restrict it to the protected main branch. Supply environment variables HCM_STAGING_PROJECT_ID, EXPECTED_HCM_STAGING_PROJECT_ID (both set to the real, separately created Vercel project ID), and HCM_STAGING_EXPECTED_DB_MARKER=payrollph_hcm_qa.
5. Supply protected environment secrets HCM_STAGING_READONLY_DATABASE_URL (dedicated staging verifier) and PRODUCTION_DATABASE_URL_SHA256 (SHA-256 fingerprint of the *exact* production URL, computed by an approved credential owner without printing or committing the URL). Protect these separately; do not expose URL values in PRs, logs or artifacts.
6. After this PR is reviewed and its offline tests pass, merge the isolation-only workflow. Then manually run **HCM Staging Isolation Attestation (No Deploy)** from protected main. The approved job checks project ID, production URL fingerprint mismatch, database-side marker and read-only DB login. It does not deploy, migrate, seed or enable any feature.
7. Only after an independently approved isolation attestation, configure a protected staging deployment with separately scoped synthetic application credentials. Verify deployment SHA, protected access, staging-only DB identity, authorized roles, keyboard/mobile/screen-reader behavior, source errors and independent HR/security sign-off.

## Hard blockers and prohibited shortcuts

- No production secrets are necessary to run the offline contract tests.
- The isolation test is *not* a deployment or a substitute for two-person staging and HR/security approval.
- Do not enable HCM People Home, WFM bulk writes, bank/payout functions or payroll releases from this change.
- Do not silently reuse Preview variables from the production Vercel project.
- Do not run a synthetic fixture against an external or production database.
- Do not claim issue #695, #112, #744 or the WFM pilot accepted based only on synthetic browser tests.

## Evidence

Successful offline tests demonstrate that missing staging identity, reused production URL, missing database marker, feature enablement, or write-capable verifier all fail closed. The manual attestation returns only pass/fail values and truncated hashes of database host and name. No credentials or employee data are included.

Related: draft PR #755, issues #695, #112, #744, #691.
