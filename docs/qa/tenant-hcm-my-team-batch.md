# HCM My Team: independent tenant-boundary evidence

**DRAFT / ZERO CREDITS / NOT ACCEPTED.** This is a standalone evidence family for:
- `GET /hcm/my-team` (server-rendered permission-gated shell)
- `GET /api/hcm/my-team` (populated, authoritative employer-scoped read)

Both remain at their existing page and API acceptance statuses. A successful test
run would not confer full-browser page coverage or independent security approval.
The page is client-driven; its server-rendered HTML only proves the initial
server authorization and scoped shell. The separate real HTTP API proof must
show populated employer-owned data.

## Isolation from other pull requests

This family adds five files with a unique `tenant-hcm-my-team` prefix:
one dedicated GitHub Actions job, one fixture-only real HTTP PG16 proof runner,
one negative-control contract test, one verifier module, and this runbook.
Nothing is changed in existing My Team page/API source, authorization, access
control, shared tenant manifests, inventory counts, approval rules, other QA
families, database schemas, feature defaults or deployment configurations.

The presently open HR Work Queue PR #1875 and Team Leave Calendar PR #1879
remain independent; recently merged Studio and token-only operations work
is inherited only from the main branch.

## Exact-head fictional PostgreSQL 16 HTTP proof

An explicit GitHub Actions job starts an **empty disposable** local
`postgresql://postgres:postgres@127.0.0.1:5432/app_db`, applies the reviewed
isolated schema baseline, builds a production-mode Next.js app with
`HCM_MY_TEAM_ENABLED=true` **inside CI only**, then binds the app strictly to
`127.0.0.1:3000`. The proof runner refuses non-CI modes, remote databases,
external-provider credentials, worker/scheduler activity, payout/billing
activation or payroll release flags before importing application or DB code.

Three distinct fictional employers are created. Two independent signed-in
owners have real seeded employee records in two distinct units; a third employer
has genuinely higher organization, employee and source request IDs. Each
employer has real pending leave records, excluded private leave reasons,
fictional bank/tax markers and distinct employee names. The runner requires:
- Own authenticated 200 SSR shell with correct employer selector, and populated
  GET 200 results from both independent owner sessions, with **exact SQL
  employee IDs**, names, units, status, record counters and no foreign marker.
- An assigned-unit manager obtains only the employee from their own unit, not
  the other unit within that very same employer.
- Strict foreign-employer (including real third-employer victim) 404 SSR and
  403 API responses, plus invalid selector, cursor, query, status, anonymous,
  company bookkeeper, unassigned manager and revoked owner gates.
- Server search/status/cursor rules stay within the previously authorized
  employer; a cursor must advance strictly past the real owned employee ID.
- No real private leave reason, synthetic bank account or tax marker in any
  successful or denied HTTP response.
- **Byte-equivalent structured SQL snapshots** for organization, legal entity,
  units, memberships, employees, pay profiles, leaves, overtime, attendance
  corrections, time punches and audit events after each HTTP request. The one
  fixture-authorized membership revocation is captured as a new baseline.
- Strict Git blob pins for the SSR page, API route, SQL loader, client contract
  and renderer, runtime response validator, access/auth/permission gates and
  shared test fixture. A source change requires a new review and proof run.

Negative-control unit tests reject fake empty HTTP 200s, wrong employee IDs,
incorrect scope/counts, leaked employer markers, private pay/tax data, SQL
writes and unexpected environment settings.

## Decision boundary

- [ ] Dedicated exact-PR-head PG16 real HTTP job succeeds.
- [ ] All normal regression, build and security checks pass on the final head.
- [ ] Independent security reviewer checks the live session, unit scope,
      employee and aggregate-source filters, source pins, and SQL invariants.
- [ ] Any eventual page or method credit is issued through a **separate**
      reviewed tenant-coverage process, not silently in this PR.

**Not authorized:** production DB access, real employer data, HCM feature
activation, payroll calculation or disbursement, permissions changes,
external integrations, provider calls, data migrations, deploy or merge.
