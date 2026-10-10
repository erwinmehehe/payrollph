# Linaw HCM Manager Decision Inbox — read-only pilot checklist

**Status:** draft, feature flags OFF, not live, not a new approval engine.

## Purpose

This original Manager Decision Inbox uses three authoritative sources:

1. Pending HCM business-process steps, joined to their exact in-progress instance (and a linked pending approval task for approval-type steps).
2. Pending leave requests linked by approvalTaskId to a current approval_tasks record.
3. Pending overtime requests linked by approvalTaskId to a current approval_tasks record.

All pending requests in a department are NOT automatically assigned to a manager. A source task must match a candidate approver string and pass the existing canDecide policy recheck for the authenticated user. Each source has its own cursor; final approvals must use the owning source workflow, not this monitor.

Payroll approval tasks, compensation-change HCM processes and termination processes are excluded. No approval mutation endpoints are added.

## Security and release flags

- HCM_MANAGER_DECISION_INBOX_ENABLED=true gates API and page; missing server flag returns 404.
- NEXT_PUBLIC_HCM_MANAGER_DECISION_INBOX_ENABLED=true is optional Approvals workspace navigation only. It cannot grant API access.
- Both remain OFF in production until independently approved staging. Rollback requires disabling the server flag, not merely hiding navigation.
- Requires authenticated membership, valid organization session, deny-only workforce.manage permission, and a manager scoped to one concrete active org unit, or owner/admin/hr within authorized company-wide/exact-unit scope.
- Company-wide managers, unitless managers, bookkeepers, checkers, payroll processors and employees do not gain this HR preview.
- Every join to source requests, approval tasks, HCM process instances and employee identity uses the explicitly requested employer ID in SQL. Scoped managers see verified workers in their exact unit, not inferred descendants or employer-wide position-only processes.
- Delegation source reads are capped at 150, with an error on overflow. The existing canDecide function rechecks each distinct approver including role targets and active delegation chains.
- Two active company members with the same name do not establish unique named/delegated assignment evidence. Role-target visibility is still governed by role-specific canDecide.
- HCM process steps must be current, pending and linked to an in-progress source. Approval-type HCM steps must also reference an active pending approval task, and initiators cannot be shown their own HCM approval/review step as an eligible decision.
- No raw leave reasons, overtime reasons, approval task titles/details, delegation reasons, free-text notes, compensation, bank, payroll, statutory IDs, confidential documents or process snapshots are returned.
- API responses use private, no-store headers; no writes.

## Performance and display semantics

- Explicit positive organizationId in the URL; never silently select first membership.
- GET /api/hcm/manager-decision-inbox?organizationId=POSITIVE_ID&source=hcm|leave|overtime&beforeId=OPTIONAL_POSITIVE_ID.
- SQL filters tenant, status, unit and candidate assignment label before a 20+1 source limit, then revalidates identity/assignment. A candidate page can display fewer than 20, or no eligible records while an older page still exists; do not claim the whole queue is clear.
- Page counts describe only the current candidate page, not the entire employer.
- An overdue SLA requires an actual HCM step dueAt timestamp. Do not use leave start/end dates or overtime work dates as a contractual deadline.
- Stale browser requests are aborted; response envelope must match employer/source/cursor; switching employers remounts the client to reset its state.
- The UI is read-only; decision controls and any per-task deep links remain with source applications.

## Merge/activation NO-GO checklist

- [ ] Exact-head CI, TypeScript, synthetic PostgreSQL two-employer tests, build, CodeQL, security HTTP, financial isolation and DR checks pass.
- [ ] Independent HR reviewer matches cases to real source tasks and verifies payroll/compensation/termination exclusions.
- [ ] Independent security review tests member permission denials, same-name collision, delegation expiry, scoped units, source FK integrity, maker exclusion, session downgrade and direct URL substitution.
- [ ] DBA reviews bounded 20+1 queries, delegation ceiling, source join query plans and real latency.
- [ ] Protected two-employer staging with overlapping names/task IDs, source status races, missing approval linkage, dueAt null, gaps between authorized candidates and three-tab cursor behavior.
- [ ] Mobile, keyboard/screen-reader, loading/error and rapid tenant switching QA.
- [ ] Release owner approves server flag rollout, rollback rehearsal and data minimization.

**Code merge alone is not production enablement.** No feature flags are changed by this branch.

## Later work

Actual approval/rejection actions, per-record drill-through, delegated decision controls and cross-unit supervisory reporting require independent source governance and approval, and are NOT part of this read-only pilot.
