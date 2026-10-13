# A-4 sanitized OpenTelemetry error telemetry — release acceptance

## Source scope and data boundary

This default-OFF source addition exports only sanitized, allowlisted OTLP/JSON Logs records for unhandled Node.js Next.js server errors and authenticated scheduler cron failures. Records contain a generated v4 UUID, fixed subsystem and error-code labels, a fixed event name and a timestamp. Do **not** forward Error instances, exception messages, stacks, paths, headers, cookies, employer/tenant/employee identifiers, payment data, Philippine IDs, or arbitrary text.

Enable only when SAFE_OTEL_ERRORS_ENABLED is exactly "true", a separately approved HTTPS /v1/logs endpoint is configured, and OTLP_LOGS_BEARER_TOKEN is at least 32 bytes. Outbound transport validates DNS, pins a public IP, does not follow redirects, and aborts requests on a 2-second exporter deadline. The exporter masks remote failures as "failed" and may not prevent the scheduler from returning its own HTTP 503.

## Automated evidence (CI)

- npm test verifies malicious raw-field rejection, sanitized OTLP envelope, default OFF, reversible OFF -> ON -> OFF, negative collector status/exception, deadline/abort and no outbound call when already aborted.
- The isolated GitHub Actions CI checkout runs scripts/verify-safe-otel-next-runtime.mjs stage **before** its Next.js production build and verify **after** it. The script dynamically creates a CI-only, uncommitted route which throws a synthetic exception; starts the built Next.js app with sanitized telemetry enabled; checks an actual Next.js onRequestError event; uses an authenticated cron request with an unreachable synthetic PostgreSQL connection and checks HTTP 503 and its matching X-Request-ID; then removes the temporary route. No production endpoint is committed.
- The CI runtime probe intentionally configures a forbidden loopback OTLP endpoint, so it proves the local event hook, sanitization and failure isolation but **not receipt by an approved external collector**. No real employee, bank, tax or payroll data is used. The synthetic CI scheduler is enabled only in the child process with an unreachable database and its payroll worker remains OFF.
- Current-head lint/typecheck/build, payroll golden tests, security and browser checks remain required. A passing PR workflow is engineering evidence, **not** authorization to turn on telemetry in production.

## External staging acceptance — not yet signed

An independent security/operations operator must document the following against the **final head SHA** and approved *non-production* collector:

- [ ] DPO/security review of collector contract/processing terms, geography, access control, data retention, deletion and breach processes; record reviewer, timestamp, environment, approved endpoint owner and evidence link (never a credential).
- [ ] Run actual synthetic Next.js error on staging and inspect collector-received OTLP JSON, service name, timeUnixNano, fixed body/attributes, correlation UUID and timestamp.
- [ ] Trigger an authenticated **synthetic** PostgreSQL cron failure with worker/payout integrations disabled; capture HTTP 503, X-Request-ID, and matching collector event.
- [ ] Confirm collector records contain no names, free text, error messages, stacks, URL, IP, headers, cookies, employee/tenant IDs, government IDs, bank numbers, or bearer tokens. Inspect the collector's own ingestion/system logs for secret redaction.
- [ ] Exercise default OFF -> ON -> OFF without a collector delivery when OFF, test unreachable DNS/collector, HTTP 4xx/5xx, timeout, and response timing. Confirm provider failures never change payroll or scheduler outcome.
- [ ] Record approval from an independent engineering reviewer and independent privacy/DPO reviewer. Do not self-approve.

Record evidence links and the exact tested SHA in this PR before converting Draft to ready. These are **manual approvals and external telemetry checks**; neither CI nor this document substitutes for them.

## Operational limits and rollback

This is not distributed tracing: the web hook generates a new request UUID rather than exposing the incoming request or a full cross-service trace, whereas cron events reuse the request ID returned in X-Request-ID. No worker/queue spans or collector/provider are provisioned here. DNS work already in progress may finish in the background after a deadline, but no HTTP request is started once the transport sees an aborted signal. To disable: SAFE_OTEL_ERRORS_ENABLED=false; no schema migration or money movement is involved.
