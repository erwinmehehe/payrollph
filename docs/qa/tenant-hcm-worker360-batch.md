# Independent tenant isolation: HCM Worker 360 read-only page + GET

**Status: DRAFT, zero coverage credits, no production certification.**

Family: `GET /hcm/worker-360?organizationId=...&employeeId=...` and
`GET /api/hcm/worker-360?organizationId=...&employeeId=...`.
These routes are not owned by the open payroll review PR #1882 or the
employee schedule receipt PR #1883. This PR creates only five new QA files,
does not change their branches and does not modify production routes,
authorization policy, schema, shared manifest, metrics, payroll or release
flags.

## Boundary under test

The existing SSR page renders a **scoped shell** and client-side Worker 360
component. It does **not** independently prove populated worker data. The
API's actual, authorized response supplies the employee identity, current
title/status, dated primary position assignment, and bounded recorded
employment events. Employee bank accounts, TIN, pay rate, sensitive event
reason and private notes must remain absent.

A dedicated exact-head GitHub Actions workflow uses PostgreSQL **16**, a
new empty disposable `app_db`, real session cookies and a localhost-only
production-mode Next server. The only feature activation is
`HCM_WORKER_360_ENABLED=true` inside this isolated CI job.
The optional Enterprise plan gate stays disabled and **is not claimed as
tested here**. No real user data, remote database, provider, malware
scanner, payout or payroll worker may be accessed.

Source-pinned proof fixtures create three real fictional employers and
independent owner accounts: two legitimate attacker organizations and an
actual higher-ID victim. Each has a populated employee record, a
position, a dated primary assignment, actual employment events, and a
second same-employer employee with no assignment. The victim owns
strictly higher organization/worker/position/assignment/event IDs.
The following cases must be proved against real server HTTP and SQL:

- Both owners can load **only their own requested employee** on the
  SSR page and API. API body must match exact persisted employee, position,
  assignment and event row IDs and status values, never a static 200 stub.
- Legitimate same-employer second-employee lookup must yield that second
  employee with `not_recorded` history, never reuse the first worker's
  history, pay or position details.
- Use another employer's real employee ID with an otherwise valid own
  employer selector: **404** with no worker object or private data.
  Select the third employer directly: **403** API and **404** SSR.
- Dated as-of filtering excludes future sources, and real dated
  `beforeDate`/`beforeId` cursors permit only older authorized events.
- Malformed, missing, noncanonical, negative/unsafe employee IDs,
  invalid historical dates and incomplete or future event cursors fail
  closed. Duplicate query parameters cannot move the result out of its
  first bounded, authorized tenant/worker scope.
- Other roles: approved company-wide HR can load authorized worker
  history; bookkeeper, unit-scoped HR, manager and anonymous sessions
  cannot; a revoked owner no longer can.
- Snapshot **organization, legal entity, unit, membership, employee,
  pay profile, profile, position, assignment, employment event and audit
  tables** before HTTP; every GET and denied request must leave all
  protected scoped business SQL unchanged. Only the intentionally
  fixture-controlled member revocation may alter its baseline.
- Negative-control contract tests reject fake empty-success bodies,
  mismatched tenant/worker/assignment/event IDs, private source markers,
  writable SQL evidence and unsafe environment settings.

## Acceptance limits

- [ ] Dedicated exact-commit PG16 production-mode localhost HTTP workflow
- [ ] Full normal CI, security HTTP smoke, CodeQL and advisory checks
- [ ] Independent Security/HR privacy review at final source hashes
- [ ] Separate, reviewed decision if any page-level credit is ever proposed

The client-side UI hydration and interaction, Enterprise subscription
enablement, independent source-to-user identity chain, complete
historical correctness and production feature rollout are **not**
certified by this batch.

This family is a **zero-credit, isolated proof candidate**. No deployment,
real employer data, schema migration, pay calculation, external
integration, live permission change or merge is authorized.
