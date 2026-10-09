# Manual staging scheduler health verification

A manual-only GitHub Actions workflow, **Payroll Scheduler Staging Health (Manual)**, is provided for operators after PR #632 has been deployed in an **isolated staging** environment with synthetic employer data.

## Configure a protected GitHub environment
Create an environment named `payroll-staging` with independent required reviewers before storing a dedicated monitor-only credential. Configure GitHub environment variables `PAYROLL_STAGING_URL` (HTTPS staging origin with trailing slash), `PAYROLL_STAGING_EXPECTED_HOST` (exact nonproduction hostname), and `PAYROLL_PRODUCTION_HOST` (production hostname, to prevent accidentally targeting it). Store a dedicated, rotated **read-only scheduler monitor token** in the **environment secret** `PAYROLL_STAGING_MONITOR_TOKEN`; never paste it into the workflow YAML, CLI args, issue comments or repository files.

Run the secret-bearing job **only from the protected default `main` branch**, after validating the stage deployment commit in the deployment provider. An attempted manual dispatch from a different ref skips the secret-bearing job, even if a reviewer approves the environment. This monitor token must differ from the privileged worker credential and is accepted by `GET /api/jobs/status` only; it must not be usable to trigger scheduler work. It performs an authenticated, timeout-bounded, read-only GET to `/api/jobs/status`. An unexpected host, missing secret, HTTP 401/403/503, malformed evidence, stale scheduler age or failed lease fails closed. The raw HTTP response and token are not logged.

This workflow cannot prove that a worker is really configured or that employment/compensation work is correct. It checks only recent scheduler liveness in the **operator-selected** staging runtime. A connected, independent two-worker plus `/api/jobs/tick` concurrency/restart rehearsal, checked job idempotency and actual staging evidence remain necessary in issue #637. In particular, never run payroll/compensation side effects on real employers merely to satisfy this check.

A normal repo unit test validates URL allowlisting, pass/fail evidence parsing and bounded GET behavior without contacting external services. The GitHub Actions workflow is manual and not an automatic production deployment or operational authorisation.


### Replay-resistant health evidence

The offline checker verifies the absolute `lastSuccessfulRunAt` timestamp against its own current clock as well as the server-reported `secondsSinceSuccess`. A stale cached response that claims a recent tick, an expired timestamp, or a timestamp beyond a small clock-skew window fails closed. The verifier cannot establish staging worker topology or control a scheduler; operations reviewers must still witness the actual deployment in #637.
