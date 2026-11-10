# Prior-employer review: worker and legal-employer SSR boundary (2026-11-10)

**Status:** DRAFT / NOT SECURITY ACCEPTED / **ZERO new coverage credits**. Separate from Worker 360 (#1887), Hire-to-Payroll (#1888), SSO (#1894), and credit-only PRs.

## Narrow source change
The feature-gated `/workspace/prior-employer` page already checks the signed-in user's selected employer, custom payroll role permission and company-wide scope. It previously forwarded any single-string `employeeId` directly into the private client field, even where the selected worker belonged to a different employer or legal entity. That behavior is a page-boundary defect; **the underlying prior-evidence API already enforces employer and legal-entity ownership**, so this PR does **not** claim a confirmed API data leak.

The page now rejects duplicate, noncanonical or unsafe selected worker IDs, and verifies `employees.organizationId` **and** `employees.id` with a read-only, minimized SQL query before rendering the client. With multi-entity enabled, the page first resolves the authenticated operator's legal-employer grants, denies group-level contexts, then requires `assertEntityResource` against the worker's persisted `legalEntityId`. No employee selected continues to render the authorized empty form. SQL or entity-context errors fail closed, not through a fallback.

## Required exact-PR-head proof
The dedicated `.github/workflows/tenant-prior-review-worker-ssr-qa.yml` runs a PostgreSQL 16 **disposable** database and localhost-only production-mode Next server, seeded with fictional employer A, employer B and a genuine later-ID victim, plus a second legal entity under A without an actor grant. The runner verifies:
- Two separate signed-in owners: genuine own worker and second own worker produce populated server-rendered form and bound employer context.
- A real foreign worker ID under the *authorized* employer, a foreign employer/worker pair, an ungranted same-tenant legal employer worker, missing IDs and malformed or duplicated selectors produce hard 404s.
- A unit-scoped bookkeeper, anonymous caller and revoked membership are denied.
- No employee, legal-employer grant, prior tax evidence, payroll run or audit SQL mutations result from the GETs.
- A deliberately unavailable employee source cannot render a success page.
- The source contract pins the specific page, employee selector, multi-entity boundary, prior-evidence API and fictional fixture; any unreviewed drift requires fresh proof.

**Pending until Actions completes:** final-head CI/TypeScript/security tests; this PG16 real-HTTP job; and independent payroll-tax/security/privacy review. Do not count historic page-only receipts as proof of the new worker-selection path. Existing `/workspace/2316`, tax evidence GET/POST routes, payroll calculations and approvals are not changed.

No Neon or production database, real employee information, payment processor, money movement, payroll release, filing, schema migration or feature activation is authorized. All tenant coverage classifications and release holds remain unchanged.
