# Manual staging scheduler health verification

A manual-only GitHub Actions workflow, **Payroll Scheduler Staging Health (Manual)**, is provided for operators after PR #632 has been deployed in an **isolated staging** environment with synthetic employer data.

## Configure a protected GitHub environment
Create an environment named `payroll-staging` with independent required reviewers before storing a dedicated monitor-only credential. Configure GitHub environment variables `PAYROLL_STAGING_URL` (HTTPS staging origin with trailing slash), `PAYROLL_STAGING_EXPECTED_HOST` (exact nonproduction hostname), `PAYROLL_STAGING_EXPECTED_COMMIT_SHA` (40-character SHA of the **actual verified staging backend deployment**) and `PAYROLL_PRODUCTION_HOST` (production hostname, to prevent accidentally targeting it). Store a dedicated, rotated **read-only scheduler monitor token** in the **environment secret** `PAYROLL_STAGING_MONITOR_TOKEN`; never paste it into the workflow YAML, CLI args, issue comments or repository files.

Run the secret-bearing job **only from the protected default `main` branch**, after validating the stage deployment commit in the deployment provider. An attempted manual dispatch from a different ref skips the secret-bearing job, even if a reviewer approves the environment. This monitor token must differ from the privileged worker credential and is accepted by `GET /api/jobs/status` only; it must not be usable to trigger scheduler work. It performs an authenticated, timeout-bounded, read-only GET to `/api/jobs/status`. An unexpected host, missing secret, HTTP 401/403/503, malformed evidence, stale scheduler age or failed lease fails closed. The raw HTTP response and token are not logged.

This workflow cannot prove that a worker is really configured or that employment/compensation work is correct. It checks only recent scheduler liveness in the **operator-selected** staging runtime. A connected, independent two-worker plus `/api/jobs/tick` concurrency/restart rehearsal, checked job idempotency and actual staging evidence remain necessary in issue #637. In particular, never run payroll/compensation side effects on real employers merely to satisfy this check.

A normal repo unit test validates URL allowlisting, pass/fail evidence parsing and bounded GET behavior without contacting external services. The GitHub Actions workflow is manual and not an automatic production deployment or operational authorisation.


### Replay-resistant health evidence

The offline checker verifies the absolute `lastSuccessfulRunAt` timestamp against its own current clock as well as the server-reported `secondsSinceSuccess`. A stale cached response that claims a recent tick, an expired timestamp, or a timestamp beyond a small clock-skew window fails closed. The verifier cannot establish staging worker topology or control a scheduler; operations reviewers must still witness the actual deployment in #637.


### Job summary output

A GitHub Advanced Security review identified a network-to-file information-flow risk in the first staging checker version. The workflow now writes only fixed, reviewed PASS/FAIL text to the GitHub job summary. It never persists the upstream status code, headers, JSON payload, configured hostname or credentials. A regression test exercises this with a synthetic unexpected HTTP response; no network connection is made.


### Preflight deployment pinning

Before supplying the monitor token, the script now calls the existing, **public read-only** `GET /api/readiness/deployment` endpoint with no credential. It requires an exact SHA match to `PAYROLL_STAGING_EXPECTED_COMMIT_SHA` and a nonproduction `preview` or `staging` runtime. It refuses to request the authenticated health endpoint at all when the SHA is missing/mismatched, the deployment identifies itself as `production`, or the preflight is unavailable. An authorized operator must set the expected SHA to the exact inspected staged build after each update; do not derive it from an arbitrary PR number or assume that a CI green head has been deployed. This is evidence of deployed source identity, not proof that the separately hosted dedicated worker is alive.


## Manual scheduler activation / kill-switch staging evidence (OFF → ON → OFF)

The protected `workflow_dispatch` job now requires `expected_scheduler_state` to be selected as exactly **disabled** or **enabled**. The workflow remains read-only: it **never** invokes `POST /api/jobs/tick`, starts a worker, changes scheduler flags or accesses real employee data. Both modes first verify the expected deployed backend SHA by an unauthenticated GET to `/api/readiness/deployment`; the monitor-only token is sent to the allowlisted staging `GET /api/jobs/status` only after that check passes.

For a genuinely isolated synthetic-data staging tenant and an independently approved rehearsal, the authorized operator should:

- Set `CENTRAL_SCHEDULER_ENABLED=false` on the staging runtime and dispatch **disabled**. The job passes only if the authenticated status GET returns HTTP **503** with JSON `{ "ok": false, "state": "scheduler-disabled" }`. This is **evidence of the expected OFF state**, never evidence the scheduler is healthy.
- Independently authorize and configure `CENTRAL_SCHEDULER_ENABLED=true` on the isolated staging runtime and run a separately controlled worker/cron. Dispatch **enabled**. The job passes only if the endpoint returns HTTP **200**, a recent completed central scheduler tick, and a consistent valid lease state.
- Turn `CENTRAL_SCHEDULER_ENABLED=false` again without clearing prior successful receipt records. Dispatch **disabled**. The job must once again observe HTTP 503 and `scheduler-disabled` even when a recent success receipt still exists.

Retain all **three actual GitHub Actions run IDs**, deployed build SHA, operator identity, observed timestamps and the independently witnessed worker restart / alert evidence in the private operations register. The job summary contains **fixed reviewed PASS/FAIL text only**, never upstream response bodies, headers, tokens, hostnames or payroll information. Selecting the wrong expected state fails the job. A series of three observations is **not** a substitute for actual two-worker topology, notification delivery, restarts, downstream idempotency, payroll reconciliation or independent review under #637. Do not enable this scheduler on real employees just to complete an acceptance exercise.
