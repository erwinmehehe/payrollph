# Privileged operations token-only owner classification — 2026-11-09

Evidence: **SOLO_VERIFIED_DEV_RECOVERY** candidate. This is a distinct non-session status, **not COVERED tenant proof**. A passing exact-head production-mode localhost HTTP run with disposable PostgreSQL 16 and a separate independent security review are pending. No job/tick/drain or provider is invoked: the shared harness uses **only invalid credentials**.

| Route | Required source credential | Denied HTTP |
|---|---|---|
| GET jobs/cron | Authorization: Bearer CRON_SECRET | 401 |
| GET jobs/dispatch-readiness | x-worker-token: WORKER_TOKEN | 401 |
| GET jobs/status | x-scheduler-monitor-token: SCHEDULER_MONITOR_TOKEN | 401 |
| POST jobs/tick | x-worker-token: WORKER_TOKEN | 401 |
| POST webhooks/drain | x-worker-token: WORKER_TOKEN | 401 |
| GET capabilities | x-readiness-token: READINESS_TOKEN | 404 |
| GET readiness | x-readiness-token: READINESS_TOKEN | 401 |
| GET readiness/billing | x-health-token: HEALTH_TOKEN | 404 |
| GET readiness/database-target | x-readiness-token: READINESS_TOKEN | 404 |
| GET readiness/deployment | x-readiness-token: READINESS_TOKEN | 404 |
| GET readiness/pilot-status | x-readiness-token: READINESS_TOKEN | 404 |

**Source mismatch to exclusive-header expectation:** `GET readiness` reads `x-readiness-token ?? x-worker-token`, and expects the readiness credential when configured. That alternate header must not be reported as absent or blocked; a worker credential under its own header is denied when separate readiness and worker credentials are configured. The test only sends incorrect tokens, including wrong token types. No successful operational report is requested.

**Workspace remains GAP.** `GET readiness/workspace` uses `getSessionUser`, explicit `organizationId`, organization administrator/finance authorization, then the intentional `tenantReadinessUnavailable(organizationId)` response. Anonymous 401, foreign tenant 403 and own tenant 503 are tracked by existing `workspace-readiness-http.mjs`, but 503 own is not an operator-only or tenant-readable positive. No reclassification until separate actual tenant-scoped readiness functionality and corresponding four-part PG16 proof are reviewed.

All release/financial/payment/CSP flags OFF; no production SQL, migrations, Neon, provider, scheduler execution, worker action or independent acceptance.
