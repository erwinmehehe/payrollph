# Linaw HCM Business Process Monitor — bounded read-only pilot

Status: **DRAFT implementation, no live production enablement.** Tracked by #712 / PR #715.

## What is implemented

An original, Workday-inspired view of existing HCM business process instance status and recorded step dates. The process instance and instance step tables remain authoritative. This monitor does not own an approval or mutate a worker, position, compensation, payroll or payout record.

The monitor API is GET /api/hcm/bp-monitor?organizationId=POSITIVE_INTEGER&beforeId=OPTIONAL_POSITIVE_INTEGER. Results include the explicitly authorized employer, observation time, up to 30 process records, up to 750 associated step records, and an older-page cursor. The SQL filters both source tables to the requested employer before applying a ceiling. An oversized source step set returns unavailable/409 rather than presenting an incomplete timeline as complete.

Response excludes employee names/numbers, assignee names, decision notes, definition snapshots, salary, bank information and source metadata. Process statuses, step statuses, source IDs, PH display times, and real dueAt timestamps are limited to safe explicit fields.

## Feature gates

- HCM_BP_MONITOR_ENABLED is a server-only flag, OFF when absent. Both the page and GET API return not-found unless explicitly enabled.
- NEXT_PUBLIC_HCM_BP_MONITOR_ENABLED is a navigation-only build-time flag for HR Command Center. It is not a permission check.
- Server authorization enforces authenticated user, active explicitly requested organization membership, session policy, deny-only people.admin permission, company-wide owner/admin/HR role. Bookkeeper, manager, payroll-only and unit-scoped HR are not authorized.
- Keep both flags OFF for live organizations until independently approved synthetic staging results and a separate release decision. To roll back, disable the server flag and redeploy. Hiding navigation alone is insufficient.

## Display semantics

- Keyset pagination uses descending source instance ID. It is not a complete tenant-wide census or unbounded search.
- "Overdue" only applies to a source step with status pending and a dueAt timestamp earlier than the observation time. Null or invalid timestamp is "No due timestamp recorded". Waiting, declined and cancelled steps do not claim an active SLA. Completed steps are separate.
- Effective date is a business milestone, NOT a contractual SLA.
- This does not reproduce delegation, maker-checker, approver decision, cancellation, or action authorization. Owning HCM endpoints remain authoritative.
- A source error or step overflow is unavailable, not an "all clear".
- The client aborts requests on employer/cursor change, checks returned tenant ID, and refuses stale/unmatched envelopes.

## Release NO-GO matrix

- [ ] Exact-head CI, TypeScript, Node unit tests, security/CodeQL, SQL history, payroll isolation, Next production build all pass.
- [ ] Independent HR/HCM reviewer confirms workflow state and SLA semantics.
- [ ] Independent privacy/security review verifies selected-employer authorization, permission-set denial, response minimization, direct URL and API 403, and no cross-tenant leakage.
- [ ] DBA reviews tenant-scoped keyset and batched step query plans, real 30/750 limit behavior and database indexes in staging.
- [ ] Protected staging with two synthetic employers: unauthorized roles, missing steps, malformed/absent dueAt, source errors, excessive step source, stale cursor and employer switching.
- [ ] Keyboard/mobile/screen-reader review; observer timestamps and page-only filters clearly communicated.
- [ ] Release owner approves separate feature activation and rollback rehearsal. Green CI or a code merge does not mean pilot completion.

## Later phases

- Assignment target display only after separate field-level HR/security approval.
- Source drill-through with revalidated approver and maker-checker permissions.
- Role-scoped manager self-service with supervisory org authorization.
- SLA escalation policy engine, correction/send-back and rescind after reviewed process changes, never via this read-only monitor.
