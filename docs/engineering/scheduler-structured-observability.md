# Scheduler observability A-4 — structured foundation

**Code status:** review candidate, not evidence of an active external log platform.

The authenticated `GET /api/jobs/cron` endpoint attaches an opaque `X-Request-ID` and logs a JSON event with five allowlisted fields: UTC timestamp, event `scheduler_cron`, requestId, state and bounded durationMs. Names, organization IDs, wages, headers, secrets, webhook bodies, errors and stack traces are never serialized by this utility.

Legal states: cron-started, cron-completed, cron-skipped, cron-error, cron-misconfigured and cron-disabled. Unauthenticated requests are deliberately not logged per-request to avoid attacker-driven unbounded event spam.

**Ops acceptance remains:** configure a managed log collector/error tracker with restricted access and retention, correlate scheduler lease receipts by safe request ID, alert on failed ticks and missing ticks, prove alert during synthetic outage, rehearse a partial/fenced scheduler run and capture clean restart/idempotent effects. A successful JSON log alone does not certify the scheduled job or satisfy P0-1. Extend the bounded event schema to background worker and payout gates only after tenant-data redaction review. No runtime flags are activated by this change.
