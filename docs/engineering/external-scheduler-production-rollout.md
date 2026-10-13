# P0-1: external scheduler trigger and admin heartbeat — release checklist

Source-only implementation. This PR does not start production jobs, deploy a worker, or authorize payroll/filing tasks.

## Existing infrastructure

- `scheduler_state` is already a durable PostgreSQL state/lease and last-completed-run receipt table. Do **not** create a duplicate heartbeat table.
- `POST /api/jobs/tick` checks the worker credential and `CENTRAL_SCHEDULER_ENABLED`; lease acquisition and completion fencing remain in `src/lib/scheduler-lease.ts`.
- The separately authenticated `GET /api/jobs/status` remains the external monitoring/alert endpoint. The new session-protected `GET /api/jobs/admin-status` is **only** for company-wide owner/admin UI and has independent access checks.
- The banner says "Scheduler last ran N minutes ago" using the latest successful completed run; it explicitly calls out disabled, overdue, unavailable and never-run states.

## External GitHub Actions schedule

`.github/workflows/production-scheduler-tick.yml` schedules a single guarded HTTPS POST to `/api/jobs/tick` every five minutes. It runs on main only, targets the repository `erwinmehehe/payrollph`, uses a protected `payroll-scheduler-production` GitHub Environment, pins its checkout and Node setup actions, denies PR-triggered execution, sets least-privileged repository access and serializes its own invocations. GitHub cron is best-effort and may be late or dropped: no claim of hard delivery guarantee is appropriate. Continue to monitor the **database completion receipt**, not just GitHub's successful HTTP response.

Create the **protected** GitHub environment with restricted main-only branch access and reviewer approvals. Leave `PAYROLL_SCHEDULER_DISPATCH_ENABLED=false` or unset, even after merging this code. After staged acceptance, configure:

| GitHub Environment setting | Meaning |
|---|---|
| variable `PAYROLL_SCHEDULER_DISPATCH_ENABLED` | Exact `true` enables dispatch, otherwise no network call |
| variable `PAYROLL_SCHEDULER_ORIGIN` | Exact HTTPS production origin, no path/query/port |
| variable `PAYROLL_SCHEDULER_EXPECTED_HOST` | Exact approved hostname |
| secret `PAYROLL_SCHEDULER_WORKER_TOKEN` | Dedicated 32+ byte server-side token, matching the deployed worker-token configuration |

In the web deployment, configure and verify `CENTRAL_SCHEDULER_ENABLED=true` only after the staged operator approvals. Keep `WORKER_ENABLED=false` until its separate queued-payroll execution authority is accepted. `SCHEDULER_MONITOR_TOKEN` must be a distinct read-only secret and external monitoring must alert when `/api/jobs/status` returns 503 or a completed tick becomes stale. Never place worker tokens in URLs, public monitoring, source, screenshots or job output.

## Required acceptance before turning on

1. Identify exact actual PayrollPH web deployment/host, Git SHA, tenant environment and dedicated database. Do not assume this GitHub repository is linked to the correct Vercel project.
2. On isolated synthetic staging, exercise OFF → ON → OFF, one completed tick without manual API calls, and verify the owner/admin banner increments its completed-run age.
3. Test 401/403 on the owner/admin route, cross-tenant access rejection, employee-only and scoped-admin denial, 375px/mobile rendering and employer switch.
4. Confirm two-worker and API concurrency: exactly one lease owner; restart, failed tick, stale lease, takeover, delayed GitHub run, no duplicate salary/statutory side effects.
5. Verify `GET /api/jobs/status` reports 200 for a recent completion and 503 for disabled, absent, overdue, failed or unavailable state; verify **actual** external alert delivery when scheduling stops.
6. Check GitHub run provenance, exact deployed SHA, CI, full payroll golden suites, TypeScript/build and separate security/payroll/DBA/operator signoff. Do not treat simulated/CI evidence as live acceptance.
7. Keep incident rollback simple: set GitHub dispatch flag false and `CENTRAL_SCHEDULER_ENABLED=false`, alert operators and reconcile any partial jobs. Do not truncate scheduler_state or replay uncertain financial side effects.

Fix A is already merged under PR #791 with source-year retro attribution and regression tests. Fix C has the merged plan `docs/ordered-migration-cutover-design.md` (PR #870) and ongoing adopted-journal work (PR #867); `core-schema-compat.ts` remains intact. Production migration receipts, DBA validation and cutover are distinct outstanding approvals.

Related: #637, #744, #112, #579, #630.
