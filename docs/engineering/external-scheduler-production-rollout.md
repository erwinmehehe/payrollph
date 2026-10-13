# P0-1 scheduler — development-stage validation and later live activation

## Confirmed project status (October 13, 2026)

PayrollPH is **in development, and the owner confirms it has no employee records**. The Vercel team is `payrollph` (Hobby), with application project `erwinmehehe-payrollph` linked to `erwinmehehe/payrollph`. **A second Vercel project or a separately provisioned Neon project is NOT a precondition** for continuing source development and synthetic tests. No production payroll, bank disbursements or statutory submissions are authorized by this code change.

Vercel calls the project's main target `production`; that technical environment label **does not** mean PayrollPH has launched commercially.

On October 11, the Vercel project's ignored-build-step was configured to `exit 0`, which canceled every subsequent main deployment. On October 13 the ignore-build override was **removed** so eligible Git builds can run again. This only fixes the build gate; it does not establish current-head deployment success. Inspect the exact target SHA and build logs before treating anything as deployed.

The production-targeted **development** app now has explicit flags `CENTRAL_SCHEDULER_ENABLED=false` and `WORKER_ENABLED=false`. Leave both false during scheduler implementation. Also verify any payment/provider submission flags stay disabled until separately tested.

## Already implemented in this PR

- A five-minute GitHub Actions schedule on `main` calling the existing `POST /api/jobs/tick` endpoint with a dedicated server-side worker credential, gated by `PAYROLL_SCHEDULER_DISPATCH_ENABLED` (unset or anything other than exact `true` means no network call).
- Exact HTTPS target host validation; read-only authenticated preflight at `/api/jobs/dispatch-readiness` verifies `CENTRAL_SCHEDULER_ENABLED` and the live Vercel Git commit SHA. GitHub pins the expected main commit to `github.sha`. A stale, unknown, unauthorized or disabled app blocks the mutating request; the POST rechecks SHA to fence alias races.
- No automatic POST replay after uncertain outcomes. The database's existing PostgreSQL `scheduler_state` lease, fencing and completion receipt remain authoritative; no duplicate heartbeat table is needed.
- An owner/admin-only, organization-membership-protected `/api/jobs/admin-status` endpoint and Overview banner reading **Scheduler last ran N minutes ago**, plus unhealthy/disabled/never-ran states.
- Offline regression tests for release/host/SHA fencing, defaults, one POST per accepted preflight, acknowledgment validity and admin banner authorization.

## Validation now — NO new staging project required

1. Run the focused, **offline** tests on the PR source, then full current-head typecheck, Next.js build and applicable payroll golden/security suites. Existing repository tests include scheduler lease, cross-process recovery, watchdog and staging-evidence assertions. Running only static string checks is **not** equivalent to a pass.
2. Run competing-worker, failed/restarted lease and heartbeat assertions on a **disposable local PostgreSQL database** in CI, with synthetic employers and pay runs created by tests only. Use an existing localhost-guarded harness; never run destructive reset/seed scripts against a remote connection. No new Neon project or Vercel project is required for these tests.
3. Use the current Vercel project's **preview deployment** to test rendering and session-protected API behavior if a safe preview database is configured. Do not point destructive tests at the shared development database; no additional hosting project is necessary. A build/compile smoke may run without a connected preview DB.
4. On the existing deployed development application, verify `CENTRAL_SCHEDULER_ENABLED=false` and `WORKER_ENABLED=false` remain enforced. The GitHub scheduled workflow must continue producing `dispatch-disabled` until explicitly activated. Confirm that admin-status reports disabled without triggering jobs.
5. Reconcile PR #934 against the moving `main` branch, review current-head GitHub CI, and verify the deployed application SHA. GitHub Actions schedules are **best-effort** and can be delayed/dropped; use independent alerting when actual unattended execution becomes an acceptance requirement.

**Runner allocation gate:** The scheduled job is skipped unless the **repository-scoped** configuration variable `PAYROLL_SCHEDULER_DISPATCH_ENABLED` is exactly `true`. Environment-scoped variables alone do not satisfy this job-level gate. The dispatcher repeats its exact-true check after runner allocation and the deployed application requires `CENTRAL_SCHEDULER_ENABLED=true` before any work. Keep the repository flag OFF/unset for source integration; activation is a separately authorized, monitored change.

## Eventual development-only scheduler exercise

A full automatic tick is **not** safe to test by simply turning the scheduler on against the app's shared database: the scheduler runs more than payroll (retention cleanup, notifications, reminders and other background tasks). Even with zero employee records, unrelated development test data, mail or external integrations could be affected.

To test a mutating tick, use a disposable CI PostgreSQL service populated with synthetic records and stub all external providers/notifications. Exercise OFF → ON → OFF, a completed leased tick, competing workers, crash/restart/recovery, admin banner age and overdue monitoring. Confirm no external bank, mail or statutory submission happened. Keep the Vercel project's actual settings OFF throughout this exercise.

## Future deployment activation (not yet approved)

Only after synthetic acceptance and a specific deployment SHA have been reviewed:

- Configure the GitHub Environment `payroll-scheduler-production` with branch restriction to main; limit secret/variable write access. **Do not require a human approval on every scheduled five-minute tick** or it will cease to be unattended.
- Set `PAYROLL_SCHEDULER_ORIGIN` to the verified actual custom domain `https://payrollsoftware.ph`, `PAYROLL_SCHEDULER_EXPECTED_HOST` to `payrollsoftware.ph`, and `PAYROLL_SCHEDULER_WORKER_TOKEN` as a dedicated 32+ byte GitHub secret whose value matches the deployed server-side worker token. Never expose the secret in logs or URLs. The GitHub `github.sha` provides the expected release SHA automatically.
- Verify the actual app provides `VERCEL_GIT_COMMIT_SHA`. Keep `WORKER_ENABLED=false` until the dedicated payroll worker has its own acceptance.
- Prepare a separate **read-only** `SCHEDULER_MONITOR_TOKEN` and independently hosted overdue/error alert. Set `CENTRAL_SCHEDULER_ENABLED=true` and `PAYROLL_SCHEDULER_DISPATCH_ENABLED=true` only as an intentional activation step, with a documented rollback: set both false again. GitHub Actions is not a hard-real-time guarantee.
- Do not interpret an authenticated 200 as money-movement authorization. Leave real payment and statutory-filing releases disabled until independent business acceptance.

## Other items

Fix A (prior-year retro and year-specific 13th-month final-pay base) is already merged in #791. Fix C's ordered Drizzle cutover design was merged in #870 and related migration work in #867 remains a separate acceptance stream. Keep `core-schema-compat.ts` until the migration history has been reconciled; **do not perform live cutover as part of this scheduler PR**.

Previously attempted second-project provisioning was rejected (Vercel HTTP 403; Vercel-managed Neon organization denied direct project creation). This is **not a blocker to this development-stage workflow**. Revisit only if realistic environment isolation becomes needed before launch.

Related: #637, #744, #112, #579, #630.


## P0-1 unattended synthetic payroll acceptance (CI only)

The new automatic workflow .github/workflows/unattended-scheduler-payroll-acceptance.yml is triggered by relevant pull requests and main pushes, not workflow_dispatch. It requires no human-sent HTTP request. Its Postgres 16 service and localhost Next.js server are disposable: this is not a Vercel/Neon production test or a separate staging project.

### Executed acceptance requirements

1. The harness refuses a remote database, missing explicit CI test mode, manually dispatched GitHub events, and any payment/mail/AI provider key. It generates separate ephemeral PII, bank, TOTP and worker secrets.
2. Seed exactly one fictional employee, punches and an unreleased queued payroll job. Assert there are no payroll entries or scheduler completion receipts yet.
3. Execute the SAME dispatchSchedulerTick client used by the GitHub scheduled dispatcher, using a test-only in-memory transport adapter that maps a synthetic HTTPS host to the isolated localhost server. Real Next.js preflight and tick HTTP handlers must authorize the worker, verify the exact synthetic deployment SHA, and commit a PostgreSQL scheduler lease/completion receipt. Demand exactly one authenticated mutating POST and zero retries.
4. Confirm the central scheduler has NOT processed the queued payroll. Start the existing dedicated payroll worker automatically as a background process with WORKER_ENABLED=true and CENTRAL_SCHEDULER_ENABLED=false in that child only. The proof runner never calls drainPayrollQueue, processNextPayrollJob or any manual payroll API.
5. Poll for payroll_jobs.status=completed, payroll_runs.status=Needs review, one matching payroll entry, a fresh scheduler_state completion and a released lease. Any failed job, missing heartbeat, invalid auth, unexpected worker exit or timeout fails CI.
6. Collect sanitized JSON in qa-artifacts/p0-1-unattended-scheduler-proof.json. A completed green GitHub run at the exact PR head is necessary before claiming synthetic acceptance.

### What this cannot certify

This PR/push automation tests the real scheduler *code path* and independent payroll worker using localhost transport. It does NOT establish that GitHub's real five-minute schedule has triggered the deployed Vercel target, that an always-on remote payroll worker is hosted, or that a third-party missed-tick monitor has fired. Keep production deployment, GitHub dispatch and all banking/statutory provider switches OFF until separate time-separated schedule-run provenance, hosted liveness/alert tests, and operator review are recorded. No payroll release, money movement, or agency filing is authorized.
