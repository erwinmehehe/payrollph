# P0-1: always-on scheduler worker and independently monitored heartbeat

**Current status:** deployment blueprint and source tests only. The central
scheduler is **not production-activated**. A GitHub merge, ready Vercel web
deployment or healthy mock test is not evidence of running payroll jobs.

## Why a managed worker

The current PayrollPH Vercel project is on a plan that does not support the
required five-minute cron schedule. The existing `vercel.json` intentionally
has no cron entry. GitHub Actions scheduled workflows are not a reliable
substitute for a continuously operating payroll scheduler and may be delayed or
skipped. No scheduled GitHub Actions workflow is added in this change.

Use the existing `scripts/worker.ts` on a separately supervised, always-on
managed container host (for example a properly configured always-on container
service). The worker processes payroll jobs and calls the existing leased
`tickScheduler()` repeatedly; it uses the existing PostgreSQL fencing and
idempotency controls rather than inventing a second scheduler. The
`deploy/scheduler/worker.Dockerfile` and `worker.compose.yml` are examples
that an operator can deploy to an approved container provider.

This is **not** a claim that Docker Compose guarantees a host will never fail.
The operator must configure restart-on-crash/reboot, provider health
monitoring, network reachability, secure deployment credentials, and a second
independent watcher. The templates add no production cron or live trigger by
themselves.

## Deployment boundaries and secrets

1. Independently inspect the **actual** PayrollPH project, live application
   SHA, region and PostgreSQL host/database. Use distinct staging synthetic
   data and credentials; do not point staging at an employer production DB.
2. Build the worker image from an exact, independently approved Git SHA.
   Review and pin the Node base image digest before production use. Do not
   pass database or webhook secrets as build arguments, copy `.env` into an
   image, or upload them to CI logs.
3. Provision the worker host's private `deploy/scheduler/worker.env` or managed
   secret-store entries: `DATABASE_URL`, `NODE_ENV=production`,
   `WORKER_ENABLED`, `CENTRAL_SCHEDULER_ENABLED`, and optionally
   `WORKER_POLL_MS=3000`. The tracked example is deliberately **OFF**.
   `WORKER_ENABLED=true` permits processing already-queued **payroll jobs**.
   `CENTRAL_SCHEDULER_ENABLED=true` separately allows automated HR,
   compensation, statutory, retention and message workflows. Those switches
   require **separate** staging/payroll approvals; never enable one merely to
   test the other.
4. In an isolated synthetic staging deployment ONLY, after approval, enable
   both switches as appropriate and observe a payroll job run **without
   calling** `POST /api/jobs/tick` or `GET /api/jobs/cron` manually.
   Evidence must show job state, correct worker commit, successful scheduler
   completion receipt and only one active fenced lease despite a competing
   worker. Repeat after killing/restarting one process.
5. Configure `CENTRAL_SCHEDULER_ENABLED` independently on the staging **web
   application** so authenticated `GET /api/jobs/status` does not report
   scheduler-disabled. Do not override production flags on the way.
6. For real employers, independent security/DBA/payroll reviewers must sign
   off the staging test, bank and government-ID encryption, schema migration
   readiness, two-pay-month parallel reconciliation and application release
   provenance **before** enabling either worker switch. No money movement is
   authorized by this document.

## A separate external watchdog

The HTTP status endpoint is already authenticated and read-only. It returns
HTTP **503** on disabled, failed, missing, stale (>10 minutes) or invalid
scheduler completion. Merely publishing that endpoint does not notify anyone.

Deploy `deploy/scheduler/watchdog.Dockerfile` and
`watchdog.compose.yml` on a **different host/provider/failure domain** from
the worker and Next.js web application. Its private environment must contain:

- `SCHEDULER_WATCHDOG_STATUS_URL` — exact HTTPS production/staging
  `/api/jobs/status` URL, no query string or embedded credentials
- `SCHEDULER_WATCHDOG_STATUS_HOST` — hostname pinned to that URL
- `SCHEDULER_MONITOR_TOKEN` — unique 32-byte-or-longer token configured on
  the target application; never the worker or cron secret
- `SCHEDULER_WATCHDOG_ALERT_URL` — secret HTTPS Slack-compatible incoming
  webhook (in private credentials, not a committed file)
- `SCHEDULER_WATCHDOG_ALERT_HOST` — pinned webhook hostname
  (for Slack, `hooks.slack.com`)
- `SCHEDULER_WATCHDOG_LABEL` and optional poll interval
  `SCHEDULER_WATCHDOG_POLL_MS=60000` (allowed 30–120 seconds)

The watchdog uses GET only, never requests `/api/jobs/tick` or a payroll API,
and never receives a database URL. It requires a consistent JSON scheduler
health payload, verifies the **actual completion timestamp on its own clock**,
rejects redirects, invalid responses and non-HTTPS targets, and does not
consider HTTP 200 sufficient on its own.

After **two consecutive failed polls**, it POSTs one `DOWN` alert through the
separately pinned webhook; it retries a failed notification and prevents
repeated alerts after successful delivery. After **two healthy polls**, it
POSTs `RECOVERED`. Log output is limited to fixed result states; no
employee identifiers, job contents, bank accounts, monitor token, full
webhook URL or remote response body appear. With a ten-minute scheduler
staleness threshold plus a one-minute poll period, an unexpectedly stopped
worker may take roughly 10–12 minutes to trigger an alert. Any HTTP 503,
including a deliberately disabled scheduler, triggers faster.

**Critical:** The watchdog itself must be monitored by a *third-party uptime
service or provider process alert*. If the entire watchdog host disappears
there is no in-process mechanism left to deliver the alert. A webhook failure
also blocks notification delivery. Configure the alert destination, recipients,
acknowledgement/escalation policy and a backup contact channel outside
PayrollPH. Docker `restart: unless-stopped` is not a substitute for
independent monitoring of host failure or stalled tasks.

## Mandatory staging witness (not completed by this PR)

Record private, redacted run references, timestamps and witnesses for each:

1. **OFF:** `CENTRAL_SCHEDULER_ENABLED=false`; a valid independent monitor
   token receives 503 `scheduler-disabled` even with a recent old receipt.
2. **ON:** on isolated synthetic data only, start one worker and then two
   competing worker processes; verify exactly one owner, job completion
   without manual tick, and a recent fenced `delivery-drain` success.
3. **CRASH:** terminate a worker during/after a synthetic job and restart it.
   Observe lease behavior, durable retry/idempotency and no double payroll
   outcome. Do not create bank disbursements or agency filings.
4. **ALARM:** stop *all* scheduler triggers and wait until the independently
   hosted watchdog detects missing/stale completion; independently witness
   delivery of the external `DOWN` notification. Restart the worker,
   verify the completion and the `RECOVERED` notification.
5. **OFF AGAIN:** disable the scheduler and confirm a new 503 alert condition.
   Reconcile staging evidence against
   `docs/engineering/scheduler-liveness-monitor.md` and issue #637.
6. Confirm `npm test`, TypeScript, lint, real CI two-process fencing,
   regression suites and the four golden payroll suites on the **exact
   candidate SHA**. No source-only mock can replace the staging witness.

Do not close P0-1 until a service operator records **who runs the worker,
where it runs, how it restarts and alerts, whose credentials it uses**, and
real staging/production heartbeat evidence. Production activation additionally
needs a protected change-control reference and independent approval.

## Local/source-only tests

`node --test tests/scheduler-watchdog.test.mjs` tests a fully mocked
status/webhook sequence, including stopped-heartbeat alerts, notification
retries, recovery, credential isolation and deployment safety. No outbound
HTTP requests, database connections or payroll jobs are executed in these
tests. The dedicated CI workflow runs that suite automatically on a PR.
Existing `scheduler-process-recovery.test.ts` separately checks real fenced
PostgreSQL leases using an isolated synthetic CI database.
