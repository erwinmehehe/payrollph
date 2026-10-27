# Employee self-service workforce: session-bound tenant isolation

**Draft evidence only. No credits or production acceptance.** The authoritative tenant
manifest currently labels both GET /api/self/workforce and POST /api/self/workforce
**GAP**. This family covers those two exact methods without editing the manifest,
application routes, employee access, database schema or payroll calculations.

## Isolated execution

The dedicated GitHub Actions job uses **fictional PostgreSQL 16** on
127.0.0.1:5432/app_db, a freshly built production-mode **localhost** Next.js server
and ephemeral credentials. The runner refuses non-disposable hosts, unexpected
database identity, live payment flags and outbound mail/provider secrets before
importing database code. Tests assert that the database initially has no
organizations. Financial providers and payout actions are never invoked.

It creates two independent authenticated **employee** sessions belonging to
different attacker employers, a real higher-ID victim employer, and a second
different employee within each employer. Every employer receives real saved
attendance punches; peers also have saved pending corrections. The victim has
both a private punch and a correction, independently readable via its own
employee session. No fabricated foreign IDs or empty positive bodies qualify.

## HTTP and persisted evidence

- **GET positive:** Each employee's genuine session returns HTTP 200 with their
  exact own employee number, one saved punch and one-day schedule. Another
  employee's punch/correction (even in the same organization) never appears.
- **GET forged selectors:** Supplying victim organization/employee IDs in the
  query must not change the effective identity. The route intentionally ignores
  these extra query keys and still returns the **actual session employee's**
  records, rather than returning foreign data or requiring an artificial 403.
- **POST positive:** An employee requests an earlier time-in against their own
  saved punch; expect HTTP 201, an exact persisted **pending-only** request and
  one actor-bound audit event. Existing punch timestamps, coworker requests,
  payroll runs, employees, rosters and overrides must stay unchanged.
- **POST foreign/peer denial:** Real saved higher-ID victim punch and real
  same-employer coworker punch both return HTTP 404 to the attacker, including when
  body organizationId/employeeId are forged; no other tenant or coworker
  mutation, audit event or sensitive marker is permitted.
- **Other denials:** Anonymous GET/POST return 401; a company owner without
  the linked employee role receives 403; an already-pending correction cannot
  be resubmitted (409).
- **Database invariant:** The victim's full core organization/worker/entity
  state and workforce punches, corrections, business audit and payroll rows are
  identical before and after the attempts. Source/negative-control tests fail
  if any no-op own write, wrong worker, forged success, altered punch, extra
  correction, peer mutation, payroll change, missing audit or foreign marker is
  mistakenly accepted.

## Acceptance boundary

This is a focused synthetic proof for a **pending attendance-correction
request**, not manager approval, punch application, payroll recalculation,
statutory filing, employee identity enrollment, or production-readiness.
The script avoids payment/communication providers, doesn't run against
production and never changes a real payroll record. Shared employee self-service
endpoints, including availability, schedules and identifiers, are not claimed.

Run the source and negative-control tests, the **exact PR-head PG16/localhost
HTTP workflow**, broad CI/security checks and independent security review.
Do not promote either GAP status or certify the family without a separate
method-level evidence reconciliation. Keep the PR **DRAFT / NOT ACCEPTED /
DO NOT MERGE** until those gates are met.
