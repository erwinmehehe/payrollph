# P0-1: independent payroll queue worker heartbeat — source-only gate

Status: **DRAFT source safeguard / NO production activation**. This is not proof that a worker has been deployed.

## Problem
`POST /api/jobs/tick` and the five-minute GitHub Actions dispatcher operate the **central scheduler**. They do not by themselves drain `payroll_jobs`. Only the separate `scripts/worker.ts` process with `WORKER_ENABLED=true` runs `processNextPayrollJob()`. A completed `delivery-drain` receipt therefore cannot prove queued payroll completion.

## Proposed fail-closed design
- A running dedicated worker publishes a sanitized `payroll-queue-worker-heartbeat` row in the existing `scheduler_state` table, throttled to one write per 15 seconds. No employee, account, job, payroll amount, host token or worker ID is recorded.
- A separate read-only guard checks the most recent row. Missing, future-dated, stale (over ten minutes), invalid or database-unavailable receipts fail.
- In Vercel `production`, the scheduler's **authenticated external dispatch preflight** and native `/api/jobs/cron` refuse work unless `PAYROLL_WORKER_HEARTBEAT_REQUIRED=true` and the worker is fresh. Unknown flag values fail closed. The independently authenticated `GET /api/jobs/status` also fails with HTTP 503 when this mandatory proof is absent.
- In disposable localhost CI, the additional gate is optional. The existing #949 scheduler-then-worker acceptance flow remains possible, while the gate itself receives negative coverage. Neither flag enables scheduling, payroll release or payouts.

**What this cannot do:** provision a long-lived worker, guarantee GitHub Actions schedule delivery, prove a heartbeat alert notification was received, demonstrate lease recovery on real infrastructure, or authorize bank/agency actions. A process can continue heartbeating while a particular payroll job fails; queue depth, failed-job inspection and exact employer payroll reconciliation are separate tests.

## Required operational release checklist
1. Keep `CENTRAL_SCHEDULER_ENABLED=false`, GitHub `PAYROLL_SCHEDULER_DISPATCH_ENABLED` unset/false, `WORKER_ENABLED=false` in web hosting, and all payment/provider flags OFF while source tests run.
2. Deploy a supervised **separate** worker with `WORKER_ENABLED=true` and the reviewed runtime/database/key configuration; restrict its secret manager, process logs and restart controls. Do not run on the shared live employee/payroll database before a signed release decision.
3. In isolated synthetic staging, demonstrate worker heartbeat while idle, a queued payroll job completing without any manual tick, multiple-worker lease competition, crash/restart takeover and an intentional stopped-worker condition producing HTTP 503 within ten minutes. Require no money transmission.
4. Deploy the independent `scripts/scheduler-watchdog.mjs` on a host different from GitHub Actions, the app and the worker. Configure its distinct read-only monitor token and alert destination; prove a DOWN alert and RECOVERED alert with timestamps. Monitor the watchdog itself.
5. Confirm the **exact** deployed SHA, a protected schedule caller, secret/environment separation, branch protection, finance/security/ops approval and working rollback. Then separately configure `PAYROLL_WORKER_HEARTBEAT_REQUIRED=true` for the production-targeted app, and only later authorize `CENTRAL_SCHEDULER_ENABLED=true` and GitHub dispatch. Real payroll, payment and filing gates remain closed.
6. Rollback: disable GitHub dispatch and central scheduler without changing bank or payroll records. Preserve worker heartbeat evidence and monitor events for review.

Related: #637, #949, #934, #579, #899.
