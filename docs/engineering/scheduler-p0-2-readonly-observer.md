# P0-2: Scheduled-run provenance and heartbeat readiness (read-only)

## Purpose and source of evidence

Merged #956 verified PostgreSQL lease recovery, and merged #949 verified synthetic dispatch to a disposable PostgreSQL 16 service. Neither establishes that the real GitHub `schedule` event has reached a deployed service. This observer counts actual GitHub schedule-event workflow runs by reading GitHub's Actions API, **never** by calling the deployed payroll application or connecting to PostgreSQL.

The watcher workflow `.github/workflows/scheduler-scheduled-run-observer.yml` runs offline tests on relevant PRs and `main` pushes. On a reviewed `main` push, its own hourly GitHub schedule, or an explicit operator workflow_dispatch, it additionally reads production-scheduler-tick workflow metadata with the default read-only GitHub token, classifies the latest three distinct schedule events within 24 hours, and uploads a sanitized JSON report. It never modifies repository variables, Vercel project settings, scheduler flags or production data.

A green observer CI job means the GET-only collector executed safely. **Never treat its green status as approval to activate the scheduler.** The JSON `state` and boolean proof fields are authoritative. Zero runs produce `no-scheduled-runs-in-window`; one or two produce `fewer-than-three-scheduled-runs`. Three skipped tick jobs prove schedule event delivery with the dispatch gate OFF, not actual scheduler execution. Three successful dispatch steps would still need independently verified deployed heartbeat and worker evidence.

## Heartbeat and deployment guard

The existing `/api/jobs/status` API requires a distinct 32+ character monitor-only token and returns 503 for a deliberately disabled scheduler. Existing staging verifier `scripts/check-scheduler-staging-health.mjs` first checks the exact SHA and nonproduction deployment environment without a secret, then sends its read-only monitor token to the approved host only. The observer runs its state/missed-heartbeat regression tests offline. It **never** uses the worker token or tries to reach a production hostname.

Until a genuinely isolated preview/staging deployment and monitor token are authorized, `deploymentHeartbeatProven`, `hostedWorkerHeartbeatProven`, `independentMissedTickAlertProven`, and `productionSchedulerActivationAuthorized` remain `false`. A GitHub-hosted observer is not an independent third-party overdue alert: if GitHub schedules fail, the observer schedule might fail too.

## Operational gate before any future activation

1. Read the artifact from an actual read-only observer scheduled run; verify three genuine schedule-triggered `production-scheduler-tick.yml` runs and their actual `tick` job conclusions. Do not substitute `workflow_dispatch`, PR or push runs.
2. Verify a deployment's exact Git SHA and environment using the Vercel connection, and verify `CENTRAL_SCHEDULER_ENABLED=false` and `WORKER_ENABLED=false` while testing is offline.
3. Provision *only if separately authorized* a truly isolated preview environment with a disposable database and monitor-only token; exercise authenticated GET status OFF, independent configured heartbeat/worker state, expired/failure cases and three time-separated observations. Never run a mutating scheduler tick against the current shared development database.
4. Independently test an out-of-GitHub overdue notification and record a delivered alert. The current observer alone is insufficient.
5. Require reviewed operational approval for subsequent real dispatch. The repository-level dispatch gate and application scheduler gate remain OFF until then. Payment, email, filings and external providers remain disabled.

No second Vercel project or employer data is required for this read-only source milestone.
