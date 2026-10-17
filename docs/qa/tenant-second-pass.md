# Tenant isolation — second-pass skipped-route closure (fictional CI only)

## What actually runs in the PayrollPH repository

The existing [Security HTTP Smoke workflow](../../.github/workflows/security-http-smoke.yml) starts a real production-mode Next.js server on 127.0.0.1:3000 backed by **fresh, disposable PostgreSQL 16**. After the original test, it runs:

    npx tsx scripts/qa/tenant-second-pass-http.mjs

The script **hard-refuses execution** without CI=true, TENANT_SECOND_PASS_MODE=isolated-ci-only, loopback HTTP, loopback PG at /app_db and no enabled PayMongo/Xendit payouts. There is no production deployment, external provider webhook receipt, bank movement, statutory filing or live account. Only this isolated server process temporarily enables the two default-OFF v1 read gates and dummy provider verifier secrets. No repository/runtime release-flag defaults change.

## Route inventory and test categories

The independent Node inventory regression is [tests/tenant-second-pass-inventory.test.mjs](../../tests/tenant-second-pass-inventory.test.mjs), using the explicit [42-file / 50-method registry](../../scripts/qa/tenant-second-pass-manifest.mjs).

| Previously skipped surface | Engineering tests |
| --- | --- |
| Auth (13 files) | Anonymous method probes; signed-in /auth/me returns each actual principal; invalid login/SSO/SAML/TOTP/demo branches cannot create a victim principal |
| Webhooks (5 files) | Every POST submitted with forged victim IDs and invalid/no provider signature; dummy verifier secrets, no real provider calls; no accepted victim event receipt |
| SCIM (3 files) | Three live bearer tokens; own identity GET/list succeed; two attackers GET/PATCH/DELETE the real victim-only SCIM ID and get 404; victim identity still exists unchanged |
| /v1 (10 files) | Three real scoped API keys, own employee/payslip positive reads; higher-than-six victim-only IDs denied to both attackers; client-supplied organizationId ignored on reads and employee POST; journal foreign legal employer denied |
| Jobs (5 files) | Actual signed-in owner may read own admin status but cannot select the victim org; uncredentialed worker/cron/status/tick/drain requests must not run jobs |
| Account (6 files) | Distinct session identities; own account and sessions positive; both attackers cannot revoke the existing victim-only high-ID session; spoofed profile organizationId/userId changes only the attacker |

Anonymous HTTP probes are **credential/availability checks, not proof of tenant authorization**; positive and negative three-org tests are separate and must also pass. SAML and external IdP callbacks are **not** an independently signed provider end-to-end acceptance; invalid-state/disabled controls are all that the localhost synthetic test can attest.

## Victim-only IDs and anti-false-pass assertions

A real database fixture seeds **three separate organization memberships**, a separate SCIM token and API key for each, plus eight victim-exclusive employees, SCIM identities, org units, payroll runs, payslips and a high-numbered victim session. For each victim object selected, the test asserts the actual row exists, belongs solely to the victim, and its ID is greater than 6. Both attackers must prove own-key/session/SCIM success **before** their attempted victim-only GET or mutation can count as a denial.

After cross-org PATCH/DELETE, the test checks the victim employee, SCIM identity, user, session revocation and provider events against the real database. A 404 on an invented record, 401 on an invalid attacker key, an empty collection or HTTP 429 is **not** a tenant-isolation PASS.

## Run/evidence

Security HTTP Smoke is triggered on each PR, with an exact-head Actions URL. The console prints a machine-readable SYNTHETIC_REAL_HTTP_ONLY summary. The endpoint matrix is deliberately strict: source route/method additions fail Node tests until inventoried, and an unexpected HTTP status fails the live run.

This does **not** complete independent #853 human UAT, real-payroll centavo reconciliation, provider staging, or #1146 vault physical-device/security acceptance. Neither user data nor release approvals are inferred from green synthetic checks.
