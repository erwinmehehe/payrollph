# Opt-in WFM schedule review reminders — engineering candidate

The scheduled worker can **suggest** a review when an already-acknowledged current schedule changes, or when a yet-unacknowledged work shift starts within 24 hours. It reuses existing authoritative employee schedule receipts and the Automation Studio event, task, email-outbox and retry pipeline. It does not assert a legal notice was delivered, nor prove physical presence, consent, attendance, leave compliance or pay entitlement.

## Fail-closed activation (all OFF by default)

- `WFM_SCHEDULE_RECEIPTS_ENABLED=true` and reviewed, exact `WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS` — existing receipt pilot prerequisite.
- `WFM_SCHEDULE_REVIEW_REMINDERS_ENABLED=true` — separate server kill switch.
- `WFM_SCHEDULE_REVIEW_REMINDERS_ORG_IDS` — exact comma-separated employer allowlist, strictly valid and a **subset** of the existing receipt allowlist.
- Central scheduler must be enabled and its worker/retry liveness independently witnessed. No notification is sent merely by enabling the scan: an authorized employer operator must **create from template, review, and separately publish** `workforce-employee-schedule-review` in Automation Studio. Template creation alone creates a draft, not a live rule.
- No production enablement or employer allowlist is made in this PR. Current source code alone is not delivery proof.

## Semantics and safety

- Candidate ESS accounts must be active, employee-role and employer-bound to an active employee. For multiple active accounts for a single worker, **skip** rather than choose a recipient.
- The total active account cohort is bounded at 200; >200 results in **zero notifications** and an explicit `cohort-too-large` result. This is not a full-company monitor or a paginated solution.
- The source service reacquires the existing roster lock and validates employee and tenant bindings. An invalid window/source remains unknown and generates no event. Trigger context contains only a day, content hash and purpose code; it contains no salary, timeclock, government ID or GPS coordinates.
- A stable `workforce.schedule_review_due` event key includes employer, worker, active login, work date, reason and exact schedule content hash. Re-running the hourly scheduler must not duplicate a rule execution for the same version and reason. Approved changes to the content yield a new key.
- Notification copy deliberately asks the employee to **sign in and verify their latest schedule**, not that a specific shift was missed or that an older snapshot is still authoritative.
- Scans are advisory. A schedule change can race with the subsequent event execution. Worker-initiated or human review must always reload the current schedule. Absence, pay changes, disciplinary measures and delivery consent are not inferred.
- Mail send and retries are owned by the existing governed outbox; the operator must separately validate sender/domain configuration, delivery failure visibility, opt-in expectations, lawful notice/consent requirements and scheduler liveness.

## Required evidence before any real-employer activation

Run the source/tenant/integration tests and relevant exact-head CI. In two fictional employers, verify invalid/disabled allowlists; duplicates and deactivated accounts; new hash versus same hash deduplication; rest/pending/outdated/unavailable day behavior; notification-rule draft versus published state; outbox retry without duplicate send; failed delivery and recoverable error; scheduler OFF and 201+ cohort skip; log retention and privacy. Independently review the manager/employee copy and complete WFM-01–14 app-level pilot acceptance.

No migrations, payroll amount changes, payout or government submissions are part of this increment.
