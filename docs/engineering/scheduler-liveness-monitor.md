# Central scheduler health and overdue alerts

PR #632 now runs central scheduler work from the dedicated worker and serializes scheduler starts with a database-backed owner lease. This status endpoint is read-only and does not run tasks.

GET /api/jobs/status requires the dedicated `x-scheduler-monitor-token` header (set through `SCHEDULER_MONITOR_TOKEN`, at least 32 bytes). This credential MUST be different from `WORKER_TOKEN` and cannot invoke POST /api/jobs/tick. There is no fallback to worker/TOTP master secrets; missing, short or reused monitor credentials fail closed with HTTP 503. Store the monitor token separately in the deployment secret manager and protected `payroll-staging` GitHub Environment, and never disclose it in URLs, public monitors, logs or GitHub comments. Configure an authorized HTTPS monitor to alert on HTTP 503.

The response includes only last completed delivery-drain timestamp, seconds since completion and sanitized lease status; it does not include organization data or the lease owner token. No successful tick within ten minutes is an overdue signal. Latest failed lease operation is also unhealthy. A 503 may indicate no worker, a stopped worker, a configuration problem or downstream errors, not necessarily payroll corruption.

Verify one active dedicated worker, worker service restart/exit reporting and /api/jobs/tick call coverage in the actual target runtime. A serverless Vercel web deployment does not itself prove that a persistent worker or external authenticated cron is operating. Isolated two-worker and restart tests, compensation idempotency, live environment and statutory payroll reviews remain separate release gates.


### Stale-owner safety improvement (2026-10-09)

In addition to the 30-second heartbeat, the central scheduler revalidates its fenced database lease before the start of the key statutory, automation, effective-dated HR and compensation job groups. A lease that has been stolen, expired or can no longer be refreshed stops **new** guarded work, rather than only raising an error after the entire scheduler cycle. Concurrent worker acquisition is now covered by a parallel PostgreSQL test. This is a **best-effort pre-work fencing gate**, not transaction-level fencing: already-running side effects cannot be canceled, and the downstream financial handlers still require their own idempotency/unique constraints. The independent two-worker staging/restart and live monitoring acceptance in #637 remains open.


### Missing-lease negative case

A recent `delivery-drain` row alone is not proof of a functioning leased central scheduler. The endpoint now fails closed with HTTP 503 and state `missing-or-invalid-lease` if the companion lease record is absent or has an unrecognized status; it also restricts emitted lease states to `running`, `completed`, or `failed` and never returns arbitrary job payloads. Regression tests cover missing, empty and invalid lease states. This remains a status check only, not a substitute for observed staging worker operations.

### Full-cycle lease-loss fencing

Every separate delivery drain (webhooks, email, marketing), retention/erasure, statutory sync, automation continuation, effective HR/compensation transition, notification, performance reminder, and evidence-sealing group now revalidates lease ownership before starting new work. Scheduled completion-state writes are also gated. This limits, but does not eliminate, races: a job already executing when a lease expires cannot be cancelled by these checks. Financial handlers must retain their own atomic idempotency and independent witnessed two-worker/restart validation under #637. A process that loses its lease must stop before starting further work, and its old owner must not overwrite the replacement owner's lease.

### Completion acknowledgements

A scheduler that loses the lease between its last action and final lease release now fails its completion acknowledgement rather than reporting success from a former owner. The `delivery-drain` last-success timestamp is recorded at the end of the work, so staging monitoring measures the age of a **completed** scheduler cycle instead of its start. These controls do not roll back already committed task side effects and do not certify retry idempotency; independent two-worker production-like staging is still required.


### Atomic final completion receipt

The final `delivery-drain` completion timestamp and JSON receipt are now written with one PostgreSQL `INSERT ... SELECT` under `SELECT ... FOR UPDATE` on the current lease row. An old worker that lost ownership during a takeover gets no write; the scheduler fails rather than publishing an incorrect healthy completion. A real isolated PostgreSQL test exercises a 16-minute abandoned lease, takeover, stale-owner rejection and new-owner success. This fences **completion evidence only**; it does not interrupt committed statutory/compensation effects or certify production concurrency. Continue to require witnessed staging and independent payroll review under #637.
