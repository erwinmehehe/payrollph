# WFM Clock-In Watch — governed automation pilot

This is an **advisory, manager-reviewed clock-in check**, not an absence, payroll, or employee-discipline decision. It extends existing WFM Scheduling and Automation Studio to surface a **scheduled shift without a confirmed clock-in** during the first hours of work. PayrollPH never invents hours, deducts pay, changes roster assignments, auto-approves leave or touches bank operations from this signal.

## Default OFF

The scheduled monitor reads attendance **only when** the server-side environment variable `WFM_CLOCK_IN_WATCH_ENABLED=true` has been explicitly authorized in an isolated staging environment. Unset, empty, or `false` means no monitoring queries or alerts. An optional `WFM_CLOCK_IN_WATCH_GRACE_MINUTES` sets a whole number from **5 to 60** (default **20**); invalid values fail closed.

The existing temporal scheduler cadence is **approximately hourly**, so this is **not an instant push alert**. It still relies on the separately approved and healthy scheduler. If the scheduler is inactive, there is no automatic monitor.

## How it works

- Reads only existing, effective schedule assignments, employees, punches, approved leave and recorded separation data. A shift beginning on the previous Philippine calendar day can be checked shortly after midnight.
- Evaluates only current **Active** workers with a verified assigned schedule. Workers with unresolved draft/approved/released separation records are suppressed until HR corrects lifecycle evidence.
- Suppresses the entire work date when any approved leave exists, including partial-day leave, to avoid making false accusations. This is intentionally conservative until segment-level approved-absence reconciliation is independently reviewed.
- Suppresses alerts when a clock-in exists or is malformed/unknown. Multiple shift segments check their own clock-in window and preserve an open punch from a prior segment.
- After the configured grace period, while the shift is still active and within **180 minutes** of starting, creates a deterministic, organization/employee/date/shift/assignment-bound **Automation Studio event**. The unique event key avoids duplicate follow-ups across hourly runs.
- A **separately published and enabled** Automation Studio rule based on the included `workforce-clock-in-pending-manager-review` template can create a Workforce Ops task and send a manager notification. The mere presence of the template does **not** enable email, tasks, or automatic publication.
- Suppresses personal names, payroll amounts, bank records and raw punch details from the scheduler summary and event context. The existing automation permission checks remain authoritative.
- For this pilot, at most **200 active assignment rows** are inspected in a run. Larger cohorts are explicitly skipped and reported as `cohort-too-large` rather than partially processed. Enterprise throughput requires a separately reviewed paginated/leased batch worker and staging performance evidence.
- Invalid schedules or data-provider errors fail closed to the existing scheduler telemetry; payroll and current automation lanes continue running.

## Manual operator verification

1. On isolated staging with fictional employees, leave `WFM_CLOCK_IN_WATCH_ENABLED` OFF. Verify the normal timekeeping, pay rules, scheduler and existing reminders behave exactly as before.
2. Publish the approved follow-up template as an **inactive** Automation Studio rule and inspect its recipients/permissions. Explicitly enable it only after manager/security approval.
3. With the monitor ON, schedule a worker for an ordinary shift and another for an overnight shift. Verify the grace window, one deduplicated manager task, and no automatic attendance or wage adjustment.
4. Test early clock-ins, clock-ins recorded later by a device, approved leave (including partial-day leave), rest days, schedule overrides, invalid punches, outdated Active/separation status, and shifts with two segments. These cases must not create false absence decisions.
5. Test multi-tenant separation, invalid monitor configuration, >200 assignments, no eligible worker, and scheduler-disabled scenarios. Record sanitized evidence privately.
6. Ensure the existing payroll hold/approval process remains unchanged; obtain independent developer, HR/WFM manager and bookkeeper reviews. Real device certification is separate.

## Next WFM milestones toward Rippling parity

- Real-time or short-interval attendance watches using horizontally safe, leased tenant batches rather than the hourly pilot.
- Manager-configurable per-site reminder thresholds and holiday/rest-day/leave policies with correct approved-absence intervals.
- Better native/mobile notifications, push delivery, consent/preferences and retry reporting.
- Demand-aware roster draft preparation with approved availability, qualification and Philippine overtime/holiday cost preview, human review before any published assignment.
- Hardware biometric certification, multi-tenant scale and an independently reconciled real employer pay period.

The pilot is **not** Rippling-level scheduling AI or production certification.
