# HCM Team Leave Calendar: independent tenant-isolation evidence family

**DRAFT / NOT ACCEPTED. Zero API method credits; zero page/action credits.**

This independent family examines only the read-only HCM Team Leave Calendar
`GET /hcm/team-leave-calendar` (SSR) and `GET /api/hcm/team-leave-calendar`
with the real server feature gate enabled in an isolated, synthetic-only build.
It does not change either handler, the team leave data loader, any business
logic, or any shared tenant coverage/security inventory.

## Isolated from currently open PRs

Exactly five new, uniquely named files are introduced: this runbook, the
dedicated GitHub Actions workflow, an environment/source/response contract,
a real-HTTP PG16 evidence runner, and unit tests. None overlaps with tenant
operations token classification (#1869), HR Work Queue server gating (#1875),
or Automation Studio operational-case triage (#1878). No executable app source,
shared manifest, source-pin inventory, credit ledger, global CI configuration,
production database, feature-default or release setting is changed.

## Reviewable evidence

The dedicated workflow checks out the exact PR head, starts a fresh local
PostgreSQL **16** in `app_db`, provisions the fictional schema, and launches a
production-mode Next.js server bound to `127.0.0.1`. Only three newly seeded
fictional employers (IDs 1, 2 and 3) are allowed by the calendar's default-OFF
server feature gate, strictly inside that job. The job refuses unsafe database
URLs, real credentials, and worker/provider/payroll release flags.

The runner independently authenticates two owners, and creates a third
higher-ID employer and victim-only leave requests. Each employer has a real,
nonempty Pending and Approved leave request for different units, plus a
Cancelled case that must not be returned. Every own SSR must render the actual
calendar. Every own API GET must return both exact owned request IDs,
consistent status and summary values, and no private leave reasons/types or
other employer's source markers. It also requires an assigned-unit manager to
see only the worker in that unit, excluding a different unit in the same
employer.

Negative controls cover foreign employer SSR and API, higher-ID victim
selectors, noncanonical and repeated SSR selectors, unsupported months,
bookkeeper access, anonymous requests, and revocation of the real employer
membership without logging out the session. Every HTTP read and denial is
checked against immutable employer-scoped SQL snapshots for organizations,
legal entities, units, memberships, employees, pay profiles, leave requests
and audit events. Only the fixture's explicit membership revocation may change
the snapshots; that new baseline is then frozen before subsequent HTTP probes.

The unchanged page, API route, employer-filtered loader, team-leave contract,
access/permission/session gates, and test fixture loader are **Git-blob-pinned**.
Any future edit to one of these sources fails the candidate until a separate
source review and renewed real-HTTP proof. The unit tests explicitly reject
fake empty 200s, wrong request IDs, data leakage, mutated SQL, stale source
pins and unsafe proof environments.

## Explicit limitations and gates

- [ ] Dedicated exact-head PostgreSQL 16 + real HTTP job passes with populated own
      and actual third-employer foreign denials.
- [ ] Existing CI and security checks pass on the final branch head.
- [ ] Independent reviewer confirms the source pins, session and role/permission
      boundaries, same-employer unit filtering and SQL immutability.
- [ ] Any future page/API credit is handled separately through the shared
      manifest and page acceptance framework, with its own reviewed receipts.

This job provides **engineering evidence only**. It does not grant full-page,
whole-API, organization-wide or production security acceptance. It never
executes leave approvals, payroll calculation, statutory filings, providers,
external automation, outbox workers, real tenant data, migrations or deployment.
The server feature remains OFF outside this disposable GitHub Actions job.
