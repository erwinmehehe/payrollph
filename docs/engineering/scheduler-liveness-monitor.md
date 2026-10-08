# Central scheduler health and overdue alerts

PR #632 now runs central scheduler work from the dedicated worker and serializes scheduler starts with a database-backed owner lease. This status endpoint is read-only and does not run tasks.

GET /api/jobs/status requires the authorized x-worker-token header, using the same worker secret as /api/jobs/tick. Never disclose worker tokens in URLs, public monitors, logs or GitHub comments. Configure a trusted synthetic/production operations monitor to call it over HTTPS and alert on HTTP 503.

The response includes only last completed delivery-drain timestamp, seconds since completion and sanitized lease status; it does not include organization data or the lease owner token. No successful tick within ten minutes is an overdue signal. Latest failed lease operation is also unhealthy. A 503 may indicate no worker, a stopped worker, a configuration problem or downstream errors, not necessarily payroll corruption.

Verify one active dedicated worker, worker service restart/exit reporting and /api/jobs/tick call coverage in the actual target runtime. A serverless Vercel web deployment does not itself prove that a persistent worker or external authenticated cron is operating. Isolated two-worker and restart tests, compensation idempotency, live environment and statutory payroll reviews remain separate release gates.
