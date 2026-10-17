# Linaw — One Signup Route, No-Payment Pilot

## Canonical entry and modes
New company owners use only **/signup**. Legacy **/trial** and **/register** redirect there. The same owner form and `/api/signup` endpoint handle either a development pilot or a paid signup; no separate lead-request form is shown as a substitute for account creation.

`PUBLIC_SIGNUP_MODE` is the single registration control:
- `pilot`: 14-day Core evaluation, 10 seats, 0 PHP subscription amount, provider=`pilot`, no checkout or automatic payment.
- `paid`: existing plan/seat selection and verified Xendit recurring authorization **after** email verification; launch approvals still apply.
- missing/other: signup unavailable. No fallback to another registration form.

Both modes require a real configured email provider (`RESEND_API_KEY`, `POSTMARK_SERVER_TOKEN`, or `SMTP_URL`), a canonical production HTTPS `APP_BASE_URL`, and the reviewed `drizzle/0106_saas_selfserve_recurring_billing.sql` schema migration.

## Pilot acceptance and boundaries
This pilot is strictly for **fictional/test data**, not real employee IDs, payroll, bank details, live disbursements, statutory filing, or real-customer production operations. The UI and verification email say so. Account approval is not invitation-based: the owner registers once, proves email ownership through a single-use link, and then opens their empty company workspace. Inactive or expired links cannot create a session; duplicate email requests have generic responses. Standard origin, proof-of-intake, rate-limit, password, role, and tenant boundaries remain in force.

An email-verified pilot owner gets a subscription `trialing` with `provider=pilot` and `trialEndsAt=created + 14 days`; the workspace starts with 0 employees, no demo payroll records and only 10 employee seats. The app write gate uses `getEntitlements`: pilot writes stop at expiration, while existing protected read/export access is preserved. A pilot is *not* a paid Xendit subscription; converting an expired pilot to a paid plan is not automated by this release.

## Database rollout
1. Confirm the correct Neon project, database and branch, and record pre-change schema and row counts.
2. Rehearse `drizzle/0106_saas_selfserve_recurring_billing.sql` in an isolated Neon branch from the intended database. Inspect foreign keys, unique constraints and indexes.
3. Apply the reviewed **additive** migration on the intended database after checks pass. Do not use `db:push`, drop or reset tables, or modify existing user/company rows.
4. Verify the exact four tables exist and match their SQL definitions; inspect whether the mail outbox `outbox` and pricing `pricing_plans` exist. Record the result.

## Vercel activation
1. Deploy the reviewed code and confirm exact SHA and full applicable CI (TypeScript, unit, browser, security, tenancy/payroll regression).
2. Confirm production mail provider is configured and verified with the real sender domain. Do not paste provider credentials into chat or GitHub.
3. Set `APP_BASE_URL=https://payrollsoftware.ph` if absent; set **`PUBLIC_SIGNUP_MODE=pilot`** for the intended Vercel Production environment. Keep Xendit billing disabled; do not set `SELF_SERVE_SIGNUP_ENABLED` to bypass checks.
4. Redeploy because Vercel env changes apply to new deployments.
5. On `https://payrollsoftware.ph/signup`, verify exactly one registration form. Register a fictional company and a disposable test email. Confirm one email, one active owner after verification, empty tenant, Core 10-seat trial, no checkout/charges, and successful sign-in. Verify rate-limits, duplicate-email masking, wrong/expired token rejection, sign out and log back in. Check request/runtime logs for errors.
6. Test the end of the trial (with test clock/fixture in a sandbox), tenant isolation, zero-employees first run, no money movement, and rollback of the flag to disabled.

## Live paid signup remains a separate release
Paid enrollment additionally requires `SELF_SERVE_SIGNUP_ENABLED=true` and `XENDIT_BILLING_ENABLED=true` alongside `PUBLIC_SIGNUP_MODE=paid`; neither billing flag is needed for pilots. Do not choose paid mode until the separate Xendit merchant, webhook, reconciliation, cancellation, disclosures, company isolation and financial release gates in [self-service-billing-runbook.md](./self-service-billing-runbook.md) and [issue #687](https://github.com/erwinmehehe/payrollph/issues/687) have passed. There is still just one signup path regardless of later mode.
