# #1282 — Private runtime database-target diagnosis (fail closed)

**Status: hosted six-role authentication NOT_RUN; production release NO-GO.**
This document is an operator handoff, not a migration, role-provisioning, or deployment authorization.

## Observed evidence (2026-10-20)

- Production SHA `826d563da539405911f1a6921d31e2d2a8ed1e72` reported its exact SHA through the protected deployment-readiness endpoint.
- [Live RBAC Sandbox Smoke #39445598112](https://github.com/erwinmehehe/payrollph/actions/runs/39445598112) received 200 from the private database-target endpoint, but its client rejected the response as `PRODUCTION_COMPENSATION_PREFLIGHT_WRONG_DATABASE_TARGET` **before** evaluating the demo provisioning boundary or running any hosted persona.
- A separate *read-only* Neon connection to the documented default production branch matched the project's pinned project/branch/endpoint/database identifiers. It found **six of six** source-defined compensation catalog tables but **zero of three** required migration-ledger catalog tables. **This does not establish what Vercel's deployed runtime actually connects to.**
- Vercel production's `DATABASE_URL` is a protected sensitive setting. Its value was not exposed by the authenticated environment-metadata inspection and has **not** been changed.
- Disposable localhost/PostgreSQL six-role QA passed 66/66 at the report-builder PR head; that is not hosted production acceptance.

## Required operator sequence

1. **No secret disclosure:** Use only the protected production readiness endpoint and the approved trusted runner with the existing private token. Retain the full response inside the runner's disposable file and do not log DB identifiers, URLs, passwords, role names, tenant rows, or response bodies.
2. **Diagnose before changing anything:** The amended `verify-production-compensation-preflight.mjs` prints a static *mismatched field label* (project, branch, endpoint, database, role format, recovery status, expected SHA), never the observed value. The mismatch remains an unconditional failure. If the runtime is pointed at an unexpected target, stop and obtain operator review; do not simply edit the expected pins to match it.
3. **Reconcile migration history:** Even if the deployed runtime identity is repaired, the separately inspected default branch lacks the three required ledger tables. The release/cutover receipt history must be independently reconciled, backed up and approved through the existing guarded migration workflow. Do not create empty placeholder receipts, run `db:push` on production, or treat table presence as a migration certificate.
4. **Keep hosted demo isolated:** A different *branch* inside the customer-serving Neon project is **not** an independently attested demo. Hosted public six-role login requires a separate approved Neon **project**, distinct role/database/endpoint, exact SHA, and separately secured HTTPS QA deployment. Do not bypass the production 404 guard to generate demonstration users.
5. **Accept only complete evidence:** On the approved fictional QA origin, verify actual Owner, HR, Payroll, Checker, Bookkeeper and Employee sessions, own-tenant 200, denied foreign employer/ID 403, anonymous denial, wrong-token denial, and privacy-safe logs. Hosted `NOT_RUN` stays `NOT_RUN` until then.

## Change scope

The associated diagnostics PR changes **only a source-side GitHub Actions preflight verifier and its synthetic tests**; it does not modify Vercel settings, Neon SQL/schema/data, the protected API, CI ordering, payroll/payout functionality, or default-OFF feature flags.

**Rollback:** Revert the small source diagnostics commit if necessary; all existing runtime authorization and schema-readiness checks remain intact.
