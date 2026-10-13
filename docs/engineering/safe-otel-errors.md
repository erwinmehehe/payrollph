# A-4 sanitized OpenTelemetry error telemetry — draft review

The existing scheduler records structured UUID-correlated events and returns X-Request-ID. This source-only addition introduces an OTLP/JSON Logs exporter for unhandled Next.js errors and authenticated cron failures. It sends strictly enumerated error codes and subsystem labels, a generated UUIDv4 and a timestamp. It intentionally omits exception messages, stack traces, request paths, headers, cookies, payroll amounts, names, banking details, Philippine IDs and any free text.

Default OFF. SAFE_OTEL_ERRORS_ENABLED must be exactly true and a separately approved HTTPS collector ending /v1/logs and 32+ byte bearer token must be configured. The existing pinned, DNS-validated outbound transport rejects unsafe destinations and redirects. Neither a provider account nor any secret or live application data is created or enabled in this PR.

Before activation: operator/DPO review of collector data residency, processing terms, access/retention and redaction; exact-head CI; production-mode Next.js synthetic error acceptance; synthetic PostgreSQL cron error acceptance; inspect actual received OTLP JSON and correlation; verify OFF-ON-OFF and failed provider behavior. No real employee, payroll, filing or bank data may be sent.

This is an A-4 foundation, NOT end-to-end tracing or full workflow logging. A separately reviewed plan is needed for worker/queue spans, downstream error-handling and log retention. Rollback: SAFE_OTEL_ERRORS_ENABLED=false; no migration.
