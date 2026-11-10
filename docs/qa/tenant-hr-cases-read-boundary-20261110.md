# HR case queue read boundary — distinct tenant family (2026-11-10)

This branch is independent of open Worker 360 SSR PR #1887 and workspace readiness PR #1886. It touches only the HR-case GET/SSR selection and staff roster SQL, the tenant helper, focused tests, and this note. It does **not** change payroll, approvals, document issuance, COE/PATCH writes, migrations, provider communication, runtime flags or live data.

## Scope
- Staff GET requires exactly one canonical positive `organizationId`. Duplicate query keys, coercible numeric forms and unsafe IDs fail before staff/case queries.
- Employee self-service GET still succeeds without a selector, scoped to the session-linked employee. A foreign employer selector returns generic 404; malformed/duplicate selectors return 400.
- After active employer membership, People/payroll role, session policy and custom-deny gates, the staff roster is selected with **employer + authorized org unit SQL predicates** instead of loading the entire employer and filtering in JavaScript. Authorized company-wide staff retain company-wide scope. Invalid scoped-unit values fail closed.
- The SSR staff inbox shares the strict employer selector parser and still authorizes the role before client mount.
- Protected GET responses and the new rejections remain private/no-store.

## Tests, proof and acceptance hold
`tests/hr-case-tenant-scope.test.ts` adds canonical/duplicate parser cases, Postgres SQL predicate checks and page/GET source contract assertions. These are **unit/source tests**, not actual PostgreSQL + real HTTP tenant isolation proof.

Before any coverage credit, run a dedicated isolated, fictional PostgreSQL 16 + real production-mode Next.js HTTP test for two independently authenticated employers and a populated higher-ID victim. Require nonempty owned staff/case positives, foreign-employer and forged/duplicate selector denials, unit-scope and revoked/custom-deny negatives, employee no-selector success with foreign-selector refusal, and unchanged victim employee/HR-case/message/audit SQL snapshots. Obtain independent HR privacy/security review of the exact final head, fresh CI and an explicit maintainer merge decision.

The canonical tenant-isolation manifest is unchanged; there are **zero new credits** in this PR. No production database, deployment or live company data were touched. **DRAFT — do not merge or deploy without review.**
